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

# 强关键词：只认「真的要交东西」的说法
KEYWORDS = ["作业", "实验", "报告", "提交", "交到", "上传", "截止", "ddl", "DDL", "论文"]

# 负向词：活动/招募/广告类，即使含「截止」也不当作业
NEGATIVE = [
    # 招揽/广告
    "招募", "观众", "征集", "报名参赛", "大赛报名", "抽奖", "优惠", "包过",
    "代写", "代做", "兼职", "招聘", "点赞", "转发", "砍价",
    # 活动类（不是要交的作业）
    "赛事", "选拔赛", "大赛", "竞赛", "参赛", "讲座", "晚会", "社团招新", "活动报名",
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


def find_weixin_exe() -> str | None:
    """定位微信主程序（4.x = Weixin.exe）。"""
    candidates = [
        r"D://Program Files//Weixin//Weixin.exe",
        r"C://Program Files//Tencent//Weixin//Weixin.exe",
        r"C://Program Files//Tencent//WeChat//WeChat.exe",
        os.path.join(os.environ.get("PROGRAMFILES", ""), "Tencent", "Weixin", "Weixin.exe"),
        os.path.join(os.environ.get("PROGRAMFILES(X86)", ""), "Tencent", "WeChat", "WeChat.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Tencent", "Weixin", "Weixin.exe"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    # 兜底：从注册表/开始菜单找不到就返回 None
    return None


def launch_wechat() -> dict:
    """唤醒微信客户端（只启动进程，不注入、不控制 UI）。"""
    if wechat_running():
        return {"ok": True, "message": "微信已在运行"}
    exe = find_weixin_exe()
    if not exe:
        return {"ok": False, "code": "NOT_FOUND", "message": "没找到微信安装路径，请手动启动微信"}
    try:
        os.startfile(exe)  # noqa: S606 - 启动用户已安装的客户端
    except OSError as e:
        return {"ok": False, "code": "LAUNCH_FAILED", "message": f"启动失败：{e}"}
    return {"ok": True, "message": "已启动微信，请扫码/确认登录", "exe": exe}


def list_groups(limit: int = 200) -> list[dict]:
    """列出可监听的群（来自 sessions，过滤 is_group）。"""
    code, out = _run(["sessions", "--limit", str(limit)], timeout=60)
    if code != 0:
        return []
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        start, end = out.find("["), out.rfind("]")
        if start < 0 or end <= start:
            return []
        try:
            data = json.loads(out[start : end + 1])
        except json.JSONDecodeError:
            return []

    groups = []
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict) or not item.get("is_group"):
            continue
        groups.append(
            {
                "name": str(item.get("chat") or ""),
                "username": str(item.get("username") or ""),
                "unread": int(item.get("unread") or 0),
                "last_message": str(item.get("last_message") or "")[:60],
            }
        )
    groups.sort(key=lambda g: (-g["unread"], g["name"]))
    return groups


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
        self.last_poll = datetime.now().strftime("%H:%M:%S")

        # 有指定群：按群拉 history（每个会话能拿到多条，避免 new-messages 只给最后一条）
        if self.groups:
            messages: list[dict] = []
            for group in self.groups:
                code, out = _run(["history", group, "--limit", "30"], timeout=45)
                if code != 0:
                    self.last_error = (out.strip()[:200] or f"退出码 {code}")
                    continue
                messages.extend(parse_history(out, group))
        else:
            code, out = _run(["new-messages"], timeout=45)
            if code != 0:
                self.last_error = out.strip()[:300] or f"退出码 {code}"
                return
            messages = parse_new_messages(out)

        for msg in messages:
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


def parse_history(raw: str, group: str = "") -> list[dict]:
    """解析 `wechat-cli history "<群>"` 的输出。

    实测结构（v0.2.4）：messages 是字符串数组，格式
    "[2026-10-22 11:54] 发送人: 正文"
    """
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []

    chat = str(data.get("chat") or group)
    items = data.get("messages") or []
    out: list[dict] = []
    for line in items:
        if not isinstance(line, str):
            continue
        t, sender, text = _split_history_line(line)
        if not text:
            continue
        out.append(
            {
                "group": chat,
                "sender": sender,
                "text": text[:500],
                "time": t,
                "msg_id": _digest(chat, f"{t}|{sender}", text),
                "keyword_hit": _keyword_hit(text),
                "is_group": bool(data.get("is_group")),
                "msg_type": "",
            }
        )
    return out


def _split_history_line(line: str) -> tuple[str, str, str]:
    """'[2026-10-22 11:54] 张三: 正文' → ('2026-10-22 11:54', '张三', '正文')"""
    text = line.strip()
    t = ""
    if text.startswith("["):
        end = text.find("]")
        if end > 0:
            t = text[1:end].strip()
            text = text[end + 1 :].strip()
    sender, body = "", text
    if ":" in text:
        head, _, rest = text.partition(":")
        if len(head) <= 20:  # 发送人一般很短，避免误切正文里的冒号
            sender, body = head.strip(), rest.strip()
    return t, sender, body


def parse_new_messages(raw: str) -> list[dict]:
    """解析 `wechat-cli new-messages` 的 JSON。

    实测结构（2026-10, v0.2.4）：
    {"first_call": true, "unread_count": 112, "messages": [
      {"chat": "群名", "username": "xxx@chatroom", "is_group": true,
       "unread": 71, "last_message": "正文", "msg_type": "文本",
       "time": "12:22", "timestamp": 1792642929}]}
    注意：每个会话只给「最后一条消息」，不是完整消息流。
    """
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

    items = data.get("messages") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []

    out: list[dict] = []
    for m in items:
        if not isinstance(m, dict):
            continue
        text = str(m.get("last_message") or m.get("content") or m.get("text") or "").strip()
        if not text or text.startswith("["):
            # 「[18条] xxx」这类折叠预览不解析
            continue
        group = str(m.get("chat") or m.get("chat_name") or "")
        username = str(m.get("username") or "")
        ts = m.get("timestamp") or 0
        mid = f"{username}:{ts}" if username and ts else _digest(group, "", text)
        out.append(
            {
                "group": group,
                "sender": "",
                "text": text[:500],
                "time": str(m.get("time") or "") or datetime.now().isoformat(timespec="seconds"),
                "msg_id": mid,
                "keyword_hit": _keyword_hit(text),
                "is_group": bool(m.get("is_group")),
                "msg_type": str(m.get("msg_type") or ""),
            }
        )
    return out


SALUTATIONS = ("各位同学", "同学们", "大家好", "老师好", "各位", "亲们")

import re as _re

_EMOJI_CODE = _re.compile(r"\[[A-Za-z\u4e00-\u9fa5]{1,6}\]")
_EMOJI_CHAR = _re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF]+"
)


def _clean_title(title: str) -> str:
    t = _EMOJI_CODE.sub("", title or "")
    t = _EMOJI_CHAR.sub("", t)
    t = t.strip(" ｜|:：，,。.、-—~～\n\t")
    return (t[:30] or "未命名任务")


def clean_message_text(text: str) -> str:
    """清洗群消息：去掉称呼行、纯 emoji 行、引用符号，压缩空行。"""
    lines = []
    for raw in (text or "").splitlines():
        line = raw.strip().lstrip(">").strip()
        if not line:
            continue
        if line.endswith("：") or line.endswith(":"):
            if any(line.startswith(s) for s in SALUTATIONS):
                continue
        probe = _EMOJI_CODE.sub("", line).strip(" ：:，,。!！")
        if any(probe == s for s in SALUTATIONS):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def _digest(group: str, sender: str, text: str) -> str:
    return hashlib.sha1(f"{group}|{sender}|{text}".encode("utf-8")).hexdigest()[:16]


def _keyword_hit(text: str) -> bool:
    if any(n in text for n in NEGATIVE):
        return False
    return any(k in text for k in KEYWORDS)


def message_to_task(msg: dict) -> dict | None:
    """消息 → 任务草稿（关键词命中才提取，省 token）。"""
    if not msg.get("keyword_hit"):
        return None
    from ai.extract import extract

    cleaned = clean_message_text(msg["text"])
    if not cleaned:
        return None
    draft = extract(cleaned, source="wechat")
    if not draft.get("is_task"):
        return None

    # 防误报：本地规则解析且没识别到截止时间的，一律不入库
    # （群消息里「作业」二字太常见，广告/闲聊会大量误伤）
    if draft.get("engine") != "llm" and not draft.get("ddl"):
        return None
    return {
        "title": _clean_title(draft.get("title") or cleaned[:20]),
        "course_name": draft.get("course_name"),
        "ddl": draft.get("ddl"),
        "summary": draft.get("summary"),
        "confidence": draft.get("confidence") or 0.4,
        "raw_text": cleaned,
        "source_msg_id": msg["msg_id"],
        "group": msg.get("group"),
    }
