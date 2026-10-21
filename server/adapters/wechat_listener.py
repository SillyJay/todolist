"""微信监听 Adapter（规格 §5 模块 3、§12.2）。

实测（2026-10）结论：
- 真实 CLI 是 GitHub `huohuoer/wechat-cli`（PyPI 上同名包是另一个项目，注意别装错）
- 它**没有 watch 命令**，模式是「读本地 SQLCipher 数据库」：
  先 `init` 从微信进程内存取密钥 → 之后用 `new-messages` 做增量拉取
  （增量状态存 ~/.wechat-cli/last_check.json）
- 所以这里改为**轮询**：每 N 秒执行一次 `new-messages`，解析后走同一套提取入库

约束：
- ⚠️ 红线：只读。只用 new-messages / sessions / search，绝不调用 send 类命令
- 需要微信桌面版运行；init 在 Windows 需要管理员权限
- 已知限制：微信版本过新（> 4.1.8）时密钥提取会失败
"""
import hashlib
import json
import os
import shutil
import subprocess
import threading
from datetime import datetime
from typing import Callable

KEYWORDS = [
    "作业", "截止", "提交", "ddl", "DDL", "交作业", "交报告", "报告",
    "实验", "任务", "考试", "测验", "签到", "提交时间", "前提交", "之前",
]

CLI_NAMES = ["wechat-cli", "wechat-cli.exe"]
KEYS_FILE = os.path.join(os.path.expanduser("~"), ".wechat-cli", "all_keys.json")
POLL_DEFAULT = 60


def find_cli() -> str | None:
    """探测 wechat-cli：应用安装目录 → PATH → 自带 Python 环境 → 常见位置。"""
    try:
        from services.component_installer import find_installed_exe

        installed = find_installed_exe()
        if installed and os.path.exists(installed):
            return installed
    except Exception:  # noqa: BLE001
        pass

    for name in CLI_NAMES:
        p = shutil.which(name)
        if p:
            return p

    import sys

    py_dir = os.path.dirname(sys.executable)
    for c in (
        os.path.join(py_dir, "wechat-cli.exe"),
        os.path.join(py_dir, "wechat-cli"),
        os.path.join(py_dir, "Scripts", "wechat-cli.exe"),
    ):
        if os.path.exists(c):
            return c

    for c in (
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "wechat-cli", "wechat-cli.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "wechat-cli", "wechat-cli.exe"),
        os.path.join(os.environ.get("APPDATA", ""), "npm", "wechat-cli.cmd"),
    ):
        if c and os.path.exists(c):
            return c
    return None


def _run(args: list[str], timeout: int = 60) -> tuple[int, str]:
    path = find_cli()
    if not path:
        return -1, "未找到 wechat-cli"
    try:
        r = subprocess.run(
            [path, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return r.returncode, (r.stdout or b"").decode("utf-8", errors="ignore")
    except subprocess.TimeoutExpired:
        return -2, f"命令超时（{timeout}s）"
    except (OSError, subprocess.SubprocessError) as e:
        return -3, f"调用失败：{e}"


def wechat_running() -> bool:
    """检测微信进程（4.x=Weixin.exe，3.x=WeChat.exe）。tasklist 中文输出是 GBK。"""
    try:
        r = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        raw = r.stdout or b""
        text = raw.decode("gbk", errors="ignore") if isinstance(raw, bytes) else str(raw)
        return "Weixin.exe" in text or "WeChat.exe" in text
    except (OSError, subprocess.SubprocessError):
        return False


def keys_ready() -> bool:
    return os.path.exists(KEYS_FILE)


def run_init() -> dict:
    """执行 wechat-cli init（需微信运行；Windows 需管理员权限）。"""
    if not wechat_running():
        return {"ok": False, "message": "微信未启动，请先登录微信桌面版"}
    code, out = _run(["init"], timeout=240)
    ok = keys_ready()
    tail = "\n".join(out.strip().splitlines()[-8:])
    return {
        "ok": ok,
        "message": "密钥提取成功" if ok else "未能提取到密钥（最常见原因：微信版本过新）",
        "output": tail,
        "code": code,
    }


def cli_status() -> dict:
    path = find_cli()
    info = {
        "installed": bool(path),
        "path": path,
        "wechat_running": wechat_running(),
        "initialized": keys_ready(),
        "version": "",
        "cli_message": "",
    }
    if not path:
        info["cli_message"] = "未检测到 wechat-cli"
        return info
    code, out = _run(["--version"], timeout=20)
    info["version"] = out.strip().splitlines()[0] if out.strip() else ""
    info["cli_message"] = "" if code == 0 else out.strip()[:200]
    return info


class WeChatListener:
    """轮询式监听：定时执行 new-messages，解析新消息后回调。"""

    def __init__(self) -> None:
        self.thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.groups: list[str] = []
        self.on_message: Callable[[dict], None] | None = None
        self.state = "offline"  # offline / running / not_configured / not_initialized
        self.last_error = ""
        self.last_messages: list[dict] = []
        self.received = 0
        self.interval = POLL_DEFAULT
        self.last_poll = ""

    # ---------- 生命周期 ----------

    def start(
        self,
        groups: list[str],
        on_message: Callable[[dict], None],
        interval: int = POLL_DEFAULT,
    ) -> dict:
        if self.thread and self.thread.is_alive():
            return {"ok": True, "message": "已在监听中"}

        if not find_cli():
            self.state = "not_configured"
            return {"ok": False, "code": "CLI_NOT_FOUND", "message": "未检测到 wechat-cli"}
        if not keys_ready():
            self.state = "not_initialized"
            return {
                "ok": False,
                "code": "NOT_INITIALIZED",
                "message": "尚未初始化：请先点「初始化」从微信进程提取密钥",
            }
        if not wechat_running():
            self.state = "offline"
            return {"ok": False, "code": "WECHAT_NOT_RUNNING", "message": "微信未启动"}

        self.groups = [g.strip() for g in groups if g.strip()]
        self.on_message = on_message
        self.interval = max(30, int(interval or POLL_DEFAULT))
        self._stop.clear()
        self.state = "running"
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()
        return {
            "ok": True,
            "message": f"已开始监听（每 {self.interval} 秒检查一次，{len(self.groups) or '全部'} 个群）",
        }

    def stop(self) -> dict:
        self._stop.set()
        self.state = "offline"
        return {"ok": True, "message": "已停止监听"}

    def status(self) -> dict:
        if self.thread and self.thread.is_alive():
            self.state = "running"
        elif self.state == "running":
            self.state = "offline"
        return {
            "state": self.state,
            "groups": self.groups,
            "connected": keys_ready(),
            "received": self.received,
            "interval": self.interval,
            "last_poll": self.last_poll,
            "last_error": self.last_error,
            "recent": self.last_messages[-10:],
        }

    # ---------- 轮询 ----------

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._poll_once()
            except Exception as e:  # noqa: BLE001
                self.last_error = f"轮询异常：{e}"
            self._stop.wait(self.interval)

    def _poll_once(self) -> None:
        code, out = _run(["new-messages", "--limit", "50"], timeout=45)
        self.last_poll = datetime.now().strftime("%H:%M:%S")
        if code != 0:
            self.last_error = out.strip()[:300] or f"退出码 {code}"
            return
        for msg in parse_new_messages(out):
            if self.groups and msg["group"] not in self.groups:
                continue
            self.received += 1
            self.last_messages.append(msg)
            if len(self.last_messages) > 50:
                self.last_messages = self.last_messages[-50:]
            if self.on_message:
                try:
                    self.on_message(msg)
                except Exception as e:  # noqa: BLE001
                    self.last_error = f"回调异常：{e}"


def parse_new_messages(raw: str) -> list[dict]:
    """解析 new-messages 的 JSON 输出（字段命名做兼容）。"""
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start < 0 or end <= start:
            return []
        try:
            data = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            return []

    if isinstance(data, dict):
        items = data.get("messages") or data.get("data") or data.get("items") or []
        if isinstance(items, dict):
            items = items.get("messages") or []
    elif isinstance(data, list):
        items = data
    else:
        items = []

    out: list[dict] = []
    for m in items:
        if not isinstance(m, dict):
            continue
        text = str(m.get("content") or m.get("text") or m.get("message") or "").strip()
        if not text:
            continue
        group = str(
            m.get("chat_name") or m.get("chat") or m.get("talker") or m.get("room") or m.get("session") or ""
        )
        sender = str(m.get("sender_name") or m.get("sender") or m.get("from") or "")
        mid = str(
            m.get("server_id_str") or m.get("id") or m.get("msg_id") or _digest(group, sender, text)
        )
        out.append(
            {
                "group": group,
                "sender": sender,
                "text": text[:500],
                "time": str(m.get("create_time") or m.get("time") or "")
                or datetime.now().isoformat(timespec="seconds"),
                "msg_id": mid,
                "keyword_hit": _keyword_hit(text),
            }
        )
    return out


def _digest(group: str, sender: str, text: str) -> str:
    return hashlib.sha1(f"{group}|{sender}|{text}".encode("utf-8")).hexdigest()[:16]


def _keyword_hit(text: str) -> bool:
    return any(k in text for k in KEYWORDS)


def message_to_task(msg: dict) -> dict | None:
    """消息 → 任务草稿（关键词命中才提取，省 token）。"""
    if not msg.get("keyword_hit"):
        return None
    from ai.extract import extract

    draft = extract(msg["text"], source="wechat")
    if not draft.get("is_task"):
        return None
    return {
        "title": draft.get("title") or msg["text"][:20],
        "course_name": draft.get("course_name"),
        "ddl": draft.get("ddl"),
        "summary": draft.get("summary"),
        "confidence": draft.get("confidence") or 0.4,
        "raw_text": msg["text"],
        "source_msg_id": msg["msg_id"],
        "group": msg.get("group"),
    }
