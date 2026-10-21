"""微信监听 Adapter（规格 §5 模块 3、§12.2）。

链路：wechat-cli 子进程 → JSONL 逐行解析 → 群过滤 → 关键词过滤 → AI/规则提取 → 入库

约束：
- ⚠️ 红线：微信侧只读。不下发消息、不控制 UI、不注入进程。
- wechat-cli 需要用户自行安装（微信 4.x 登录态），本文件只做探测与封装。
"""
import hashlib
import json
import os
import shutil
import subprocess
import threading
from datetime import datetime, timedelta
from typing import Callable

# L0 关键词：命中才进入 AI 提取，省 token
KEYWORDS = [
    "作业", "截止", "提交", "ddl", "DDL", "交作业", "交报告", "报告",
    "实验", "任务", "考试", "测验", "签到", "提交时间", "前提交", "之前",
]

CLI_NAMES = ["wechat-cli", "wechat-cli.exe"]


def find_cli() -> str | None:
    """探测 wechat-cli：PATH → %LOCALAPPDATA%\\wechat-cli → npm 全局。"""
    for name in CLI_NAMES:
        p = shutil.which(name)
        if p:
            return p

    candidates = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "wechat-cli", "wechat-cli.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "wechat-cli", "wechat-cli.exe"),
        os.path.join(os.environ.get("APPDATA", ""), "npm", "wechat-cli.cmd"),
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def wechat_running() -> bool:
    """检测微信进程。tasklist 输出在中文系统是 GBK，需手动解码。"""
    try:
        r = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq WeChat.exe"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        raw = r.stdout or b""
        text = raw.decode("gbk", errors="ignore") if isinstance(raw, bytes) else str(raw)
        return "WeChat.exe" in text
    except (OSError, subprocess.SubprocessError):
        return False


def cli_status() -> dict:
    """返回 {installed, path, wechat_running, cli_ok, cli_message}"""
    path = find_cli()
    info = {
        "installed": bool(path),
        "path": path,
        "wechat_running": wechat_running(),
        "cli_ok": False,
        "cli_message": "",
    }
    if not path:
        info["cli_message"] = "未检测到 wechat-cli，请先安装（见 README 说明）"
        return info
    try:
        r = subprocess.run(
            [path, "status"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        out = (r.stdout or b"").decode("utf-8", errors="ignore") or (r.stderr or b"").decode(
            "utf-8", errors="ignore"
        )
        info["cli_ok"] = r.returncode == 0
        info["cli_message"] = out.strip()[:300]
    except (OSError, subprocess.SubprocessError) as e:
        info["cli_message"] = f"调用失败：{e}"
    return info


class WeChatListener:
    """子进程监听器：解析 stdout 的 JSONL（处理半行缓冲）。"""

    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.thread: threading.Thread | None = None
        self.groups: list[str] = []
        self.on_message: Callable[[dict], None] | None = None
        self.state = "offline"  # offline / running / not_configured
        self.connected = False
        self.last_error = ""
        self.last_messages: list[dict] = []
        self.received = 0
        self._buf = ""

    # ---------- 生命周期 ----------

    def start(self, groups: list[str], on_message: Callable[[dict], None]) -> dict:
        if self.proc and self.proc.poll() is None:
            return {"ok": True, "message": "已在监听中"}

        path = find_cli()
        if not path:
            self.state = "not_configured"
            return {"ok": False, "code": "CLI_NOT_FOUND", "message": "未检测到 wechat-cli"}
        if not wechat_running():
            self.state = "offline"
            return {
                "ok": False,
                "code": "WECHAT_NOT_RUNNING",
                "message": "微信未启动，请先登录微信 4.x 桌面版",
            }

        self.groups = [g for g in groups if g.strip()]
        self.on_message = on_message
        args = [path, "watch", "--follow", "--jsonl"]
        if self.groups:
            args += ["--groups", ",".join(self.groups)]

        try:
            self.proc = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (OSError, subprocess.SubprocessError) as e:
            self.last_error = str(e)
            return {"ok": False, "code": "SPAWN_FAILED", "message": f"启动失败：{e}"}

        self.state = "running"
        self.connected = False
        self.thread = threading.Thread(target=self._read_loop, daemon=True)
        self.thread.start()
        return {"ok": True, "message": f"已开始监听（{len(self.groups) or '全部'} 个群）"}

    def stop(self) -> dict:
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.terminate()
            except OSError:
                pass
        self.state = "offline"
        self.connected = False
        self.proc = None
        return {"ok": True, "message": "已停止监听"}

    def status(self) -> dict:
        alive = bool(self.proc and self.proc.poll() is None)
        if not alive and self.state == "running":
            self.state = "offline"
        return {
            "state": self.state if alive or self.state == "not_configured" else "offline",
            "groups": self.groups,
            "connected": self.connected,
            "received": self.received,
            "last_error": self.last_error,
            "recent": self.last_messages[-10:],
        }

    # ---------- 读取 ----------

    def _read_loop(self) -> None:
        assert self.proc is not None
        stdout = self.proc.stdout
        if stdout is None:
            return
        for raw in stdout:  # 逐行
            line = raw.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                # 半行缓冲：与下一行拼接再试一次
                self._buf += line
                try:
                    msg = json.loads(self._buf)
                    self._buf = ""
                except json.JSONDecodeError:
                    if len(self._buf) > 20000:  # 防止无限增长
                        self._buf = ""
                    continue
            self.connected = True
            self._handle(msg)

        err = ""
        if self.proc and self.proc.stderr:
            try:
                err = self.proc.stderr.read()[:300]
            except (OSError, ValueError):
                err = ""
        if err:
            self.last_error = err
            # 退出码非 0 时区分「微信未登录」与「版本不符」
            if "login" in err.lower() or "登录" in err:
                self.last_error = "微信似乎未登录，请确认微信已登录后重试"
            elif "version" in err.lower():
                self.last_error = "wechat-cli 与当前微信版本不匹配，请升级 wechat-cli"
        self.state = "offline"
        self.connected = False

    def _handle(self, msg: dict) -> None:
        if msg.get("type") not in (None, "message", "msg"):
            return  # 心跳/事件类消息忽略
        text = msg.get("content") or msg.get("text") or ""
        group = msg.get("group") or msg.get("room") or msg.get("chat") or ""
        sender = msg.get("sender") or msg.get("from") or ""
        if not text:
            return

        if self.groups and group and group not in self.groups:
            return

        item = {
            "group": group,
            "sender": sender,
            "text": text[:500],
            "time": msg.get("time") or datetime.now().isoformat(timespec="seconds"),
            "msg_id": str(msg.get("server_id_str") or msg.get("id") or _digest(group, sender, text)),
            "keyword_hit": _keyword_hit(text),
        }
        self.received += 1
        self.last_messages.append(item)
        if len(self.last_messages) > 50:
            self.last_messages = self.last_messages[-50:]

        if self.on_message:
            try:
                self.on_message(item)
            except Exception as e:  # noqa: BLE001
                self.last_error = f"回调异常：{e}"


def _digest(group: str, sender: str, text: str) -> str:
    h = hashlib.sha1(f"{group}|{sender}|{text}".encode("utf-8")).hexdigest()
    return h[:16]


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


def next_scan_window() -> tuple[str, str]:
    """诊断用：返回未来 7 天窗口。"""
    now = datetime.now()
    return now.isoformat(timespec="seconds"), (now + timedelta(days=7)).isoformat(timespec="seconds")
