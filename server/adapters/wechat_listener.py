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
import hashlib
import json
import re
import os
import shutil
import sys
import time
import subprocess
import threading
from datetime import datetime, timedelta
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
    # 群内闲杂事务（避免被「截止/报名」带成作业）
    "接龙", "投票", "问卷", "拼单", "二手", "失物", "招领", "打卡", "聚餐",
    "团建", "生日", "约饭", "开黑", "外卖", "拼车", "代取", "转让",
]

CLI_NAMES = ["wechat-cli", "wechat-cli.exe"]
KEYS_FILE = os.path.join(os.path.expanduser("~"), ".wechat-cli", "all_keys.json")
# 首次监听某个群时，回补最近 24 小时；之后按「上次同步时间」补齐（最多回溯 7 天）
BACKFILL_HOURS = 24
BACKFILL_LIMIT = 500
BACKFILL_MAX_DAYS = 7          # 关机很久时最多往回补 7 天，避免一次拉爆
OVERLAP_MINUTES = 2            # 与上次同步重叠 2 分钟，容忍时钟误差与漏拉
MARKER_FILE = os.path.join(os.path.dirname(KEYS_FILE), "campus_backfill.json")
POLL_DEFAULT = 30


def find_cli() -> str | None:
    """探测 wechat-cli：组件安装目录 → PATH → 解释器同目录 → 常见固定位置。

    注意：`bin/wechat-cli/` 只在「从界面点按钮下载组件」时才会有内容；
    用 pip 装进 venv 的情况下它一直是空的，**空目录不代表没装**——
    第三条（venv\\Scripts\\wechat-cli.exe）才是 pip 安装的落点。
    详见 docs/wechat-cli-install.md。
    """
    try:
        from services.component_installer import find_installed_exe

        installed = find_installed_exe()
        if installed and os.path.exists(installed):
            return installed
    except Exception:  # noqa: BLE001
        pass

    # 打包后：随安装包分发的组件（<exe目录>/bin/wechat-cli/wechat-cli.exe）
    if getattr(sys, "frozen", False):
        base = os.path.dirname(sys.executable)
        for c in (
            os.path.join(base, "bin", "wechat-cli", "wechat-cli.exe"),
            os.path.join(base, "bin", "wechat-cli.exe"),
            os.path.join(base, "wechat-cli.exe"),
        ):
            if os.path.exists(c):
                return c

    for name in CLI_NAMES:
        p = shutil.which(name)
        if p:
            return p

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


def _cli_env() -> dict:
    """给 wechat-cli 子进程准备 UTF-8 环境。

    它是 Python 程序，Windows 下 stdout 默认走 GBK；群名里带 emoji（如 😋 U+1F60B）
    时 json.dump 会抛 UnicodeEncodeError 并以 exit 1 退出——这就是「读取群列表失败」的真因。
    """
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["PYTHONLEGACYWINDOWSSTDIO"] = "0"
    return env


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
            env=_cli_env(),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        out = (r.stdout or b"").decode("utf-8", errors="replace")
        return r.returncode, out
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


def groups_probe(limit: int = 200) -> dict:
    """带诊断地列出群列表。

    返回 {groups, code, message, cli}：
    - CLI_MISSING   未找到 wechat-cli 可执行文件
    - KEYS_MISSING  已装 CLI 但未提取数据库密钥
    - CLI_FAILED    命令执行失败（附输出尾部）
    - PARSE_FAILED  输出不是可解析的 JSON（附输出头部，便于看格式变化）
    - EMPTY         JSON 可解析但没有任何群会话
    - OK            正常
    """
    path = find_cli()
    if not path:
        return {
            "groups": [],
            "code": "CLI_MISSING",
            "message": "未找到 wechat-cli 可执行文件。注意 bin/wechat-cli/ 为空属正常——"
            "pip 安装的入口在 venv 的 Scripts 目录下。可先手动输入群名，"
            "或参考 docs/wechat-cli-install.md 重新安装。",
            "cli": None,
        }
    if not keys_ready():
        return {
            "groups": [],
            "code": "KEYS_MISSING",
            "message": "已找到 wechat-cli，但还没有数据库密钥。请先点「初始化密钥」，或在下方手动输入群名。",
            "cli": path,
        }

    code, out = _run(["sessions", "--limit", str(limit)], timeout=60)
    if code != 0:
        tail = (out or "").strip()[-300:]
        return {
            "groups": [],
            "code": "CLI_FAILED",
            "message": f"wechat-cli 执行失败（exit {code}）。{tail}",
            "cli": path,
        }

    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        start, end = out.find("["), out.rfind("]")
        if start < 0 or end <= start:
            return {
                "groups": [],
                "code": "PARSE_FAILED",
                "message": "wechat-cli 输出不是 JSON，可能版本不兼容。输出开头：" + (out or "").strip()[:200],
                "cli": path,
            }
        try:
            data = json.loads(out[start : end + 1])
        except json.JSONDecodeError:
            return {
                "groups": [],
                "code": "PARSE_FAILED",
                "message": "无法解析群列表 JSON。输出开头：" + (out or "").strip()[:200],
                "cli": path,
            }

    groups = _extract_groups(data)
    if not groups:
        return {
            "groups": [],
            "code": "EMPTY",
            "message": "命令执行成功，但没有解析到群会话（字段可能变化）。输出开头："
            + (out or "").strip()[:200],
            "cli": path,
        }
    return {"groups": groups, "code": "OK", "message": "", "cli": path}


def _extract_groups(data) -> list[dict]:
    """从 sessions 输出里抽取群会话；兼容裸数组与 {data:[...]} / {sessions:[...]} 包装。"""
    items = data
    if isinstance(data, dict):
        for key in ("sessions", "data", "items", "list"):
            if isinstance(data.get(key), list):
                items = data[key]
                break
        else:
            items = []
    if not isinstance(items, list):
        return []

    groups = []
    for item in items:
        if not isinstance(item, dict):
            continue
        is_group = item.get("is_group")
        if is_group is None:
            is_group = item.get("isGroup")
        username = str(item.get("username") or item.get("user_name") or "")
        if is_group is None:
            # 兜底：微信群 username 以 @chatroom 结尾
            is_group = username.endswith("@chatroom")
        if not is_group and not username.endswith("@chatroom"):
            continue
        name = str(item.get("chat") or item.get("name") or item.get("display_name") or username)
        groups.append(
            {
                "name": name,
                "username": username,
                "unread": int(item.get("unread") or 0),
                "last_message": str(item.get("last_message") or item.get("content") or "")[:60],
            }
        )
    groups.sort(key=lambda g: (-g["unread"], g["name"]))
    return groups


def list_groups(limit: int = 200) -> list[dict]:
    """兼容旧调用：只要群列表。"""
    return groups_probe(limit)["groups"]


def _log(msg: str) -> None:
    """安全打印。

    Windows 控制台/管道默认 GBK，群名里的 emoji（✨😋6️⃣）会让 print 抛
    UnicodeEncodeError，进而把轮询线程带崩（表现为「轮询异常: 'gbk' codec…」）。
    """
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        try:
            print(msg.encode("gbk", errors="replace").decode("gbk"), flush=True)
        except Exception:  # noqa: BLE001
            pass
    except Exception:  # noqa: BLE001
        pass


def _load_marker() -> dict:
    """每个群"是否已回补过 24 小时"的标记：{"groups": {"群名": "2026-10-23T00:10:00"}}"""
    try:
        with open(MARKER_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_marker(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(MARKER_FILE), exist_ok=True)
        with open(MARKER_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


def backfill_since(hours: int = BACKFILL_HOURS) -> str:
    """回补起点，格式与 CLI 的 --start-time 一致。"""
    return (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M:%S")


def keys_ready() -> bool:
    return os.path.exists(KEYS_FILE)


def is_admin() -> bool:
    """当前进程是否有管理员权限（读微信进程内存需要它）。"""
    try:
        import ctypes

        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:  # noqa: BLE001 - 非 Windows / 受限环境
        return False


WECHAT_EXE_CANDIDATES = (
    r"C:\Program Files\Tencent\Weixin\Weixin.exe",
    r"C:\Program Files (x86)\Tencent\Weixin\Weixin.exe",
    r"C:\Program Files\Tencent\WeChat\WeChat.exe",
    r"C:\Program Files (x86)\Tencent\WeChat\WeChat.exe",
)


def _wechat_from_registry() -> str | None:
    """微信不一定装在 C 盘（实测有装在 D:\\Program Files\\Weixin 的），
    优先读注册表里的 InstallPath。"""
    try:
        import winreg

        keys = [
            (winreg.HKEY_CURRENT_USER, r"Software\Tencent\Weixin"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Tencent\Weixin"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Tencent\Weixin"),
            (winreg.HKEY_CURRENT_USER, r"Software\Tencent\WeChat"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Tencent\WeChat"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Tencent\WeChat"),
        ]
        for hive, sub in keys:
            try:
                with winreg.OpenKey(hive, sub) as k:
                    install, _ = winreg.QueryValueEx(k, "InstallPath")
            except OSError:
                continue
            for name in ("Weixin.exe", "WeChat.exe"):
                p = os.path.join(str(install), name)
                if os.path.exists(p):
                    return p
    except Exception:  # noqa: BLE001 - 非 Windows / 注册表不可读
        pass
    return None


def wechat_exe() -> str | None:
    """找微信主程序（4.x 叫 Weixin.exe，3.x 叫 WeChat.exe）。"""
    from_reg = _wechat_from_registry()
    if from_reg:
        return from_reg
    for p in WECHAT_EXE_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def wechat_version() -> str:
    """读微信 exe 的文件版本（用于判断是否比 wechat-cli 支持的新）。"""
    path = wechat_exe()
    if not path:
        return ""
    try:
        import ctypes
        from ctypes import wintypes

        ver = ctypes.windll.version
        size = ver.GetFileVersionInfoSizeW(path, None)
        if not size:
            return ""
        buf = ctypes.create_string_buffer(size)
        if not ver.GetFileVersionInfoW(path, 0, size, buf):
            return ""
        ptr = ctypes.c_void_p()
        length = wintypes.UINT()
        if not ver.VerQueryValueW(buf, "\\", ctypes.byref(ptr), ctypes.byref(length)):
            return ""
        fixed = ctypes.cast(ptr, ctypes.POINTER(wintypes.DWORD * 4)).contents
        ms, ls = fixed[2], fixed[3]
        return f"{ms >> 16}.{ms & 0xFFFF}.{ls >> 16}.{ls & 0xFFFF}"
    except Exception:  # noqa: BLE001
        return ""


def _weixin_pids() -> list[int]:
    """当前所有 Weixin.exe 的 PID（tasklist CSV 解析）。"""
    try:
        r = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq Weixin.exe", "/FO", "CSV", "/NH"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        raw = r.stdout or b""
        text = raw.decode("gbk", errors="ignore") if isinstance(raw, bytes) else str(raw)
        pids = []
        for line in text.splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 2 and parts[0].lower().endswith("weixin.exe"):
                try:
                    pids.append(int(parts[1]))
                except ValueError:
                    pass
        return pids
    except Exception:  # noqa: BLE001
        return []


def _process_start_ts(pid: int) -> float | None:
    """进程启动时间（Unix 秒）。用 GetProcessTimes，避免引入 psutil。"""
    try:
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return None
        try:
            creation = wintypes.FILETIME()
            exit_t = wintypes.FILETIME()
            kernel = wintypes.FILETIME()
            user = wintypes.FILETIME()
            ok = kernel32.GetProcessTimes(
                h,
                ctypes.byref(creation),
                ctypes.byref(exit_t),
                ctypes.byref(kernel),
                ctypes.byref(user),
            )
            if not ok:
                return None
            quad = (creation.dwHighDateTime << 32) | creation.dwLowDateTime
            return quad / 10_000_000 - 11644473600
        finally:
            kernel32.CloseHandle(h)
    except Exception:  # noqa: BLE001
        return None


def wechat_uptime() -> float | None:
    """微信已经运行了多少秒（最短的那个进程）。没运行返回 None。"""
    pids = _weixin_pids()
    if not pids:
        return None
    now = time.time()
    starts = [_process_start_ts(p) for p in pids]
    starts = [s for s in starts if s]
    if not starts:
        return None
    return max(0.0, now - min(starts))


_last_auto_init_at = 0.0
AUTO_INIT_INTERVAL = 300  # 没密钥时每 5 分钟最多重试一次，避免反复扫内存


def maybe_auto_init() -> dict | None:
    """没有密钥时自动尝试提取，让用户「打开软件就能用」。

    以前这里要看「微信是不是刚启动」（老的内存扫描只在登录瞬间有效）。
    现在用 wcdb-key-tool 的只读运行时扫描，任何时刻都能取，所以没必要再卡时间窗，
    只要「微信在跑 + 没有密钥」就试一次，失败则 5 分钟后再试。
    """
    global _last_auto_init_at
    if keys_ready() or not wechat_running():
        return None
    now = time.time()
    if now - _last_auto_init_at < AUTO_INIT_INTERVAL:
        return None
    _last_auto_init_at = now
    _log("没有可用密钥，自动尝试提取（只读扫描）")
    res = run_init()
    if res and res.get("ok"):
        _log(f"自动提取成功：{res.get('message')}")
    else:
        _log(f"自动提取失败：{(res or {}).get('message', '')[:120]}")
    return res

def _documents_dir() -> str:
    """Documents 可能被重定向到其他盘，优先读注册表。"""
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
        ) as k:
            val, _ = winreg.QueryValueEx(k, "Personal")
            import os as _os

            return _os.path.expandvars(str(val))
    except Exception:  # noqa: BLE001
        return os.path.join(os.path.expanduser("~"), "Documents")


def configured_db_dir() -> str:
    """用户在设置里手动指定的微信数据目录（优先级最高）。"""
    try:
        from db.database import SessionLocal
        from db.models import Setting

        db = SessionLocal()
        try:
            row = db.get(Setting, "wechat_db_dir")
            return (row.value or "").strip() if row else ""
        finally:
            db.close()
    except Exception:  # noqa: BLE001
        return ""


def _pick_wxid_dir(root: str) -> str | None:
    """在 xwechat_files 下挑一个存在 db_storage 的 wxid 目录（多个取最新）。"""
    try:
        if not os.path.isdir(root):
            return None
        best = None
        best_mtime = -1.0
        for name in os.listdir(root):
            dbdir = os.path.join(root, name, "db_storage")
            if os.path.isdir(dbdir):
                m = os.path.getmtime(dbdir)
                if m > best_mtime:
                    best_mtime = m
                    best = os.path.join(root, name)
        return best
    except OSError:
        return None


_db_dir_cache: list = ["", ""]


def _refresh_db_dir_cache() -> None:
    d, src = _detect_db_dir()
    _db_dir_cache[0] = d
    _db_dir_cache[1] = src


def find_db_dir(force: bool = False) -> tuple[str, str]:
    """探测微信数据目录（带缓存；force=True 重新扫）。"""
    if force or (not _db_dir_cache[0] and _db_dir_cache[1] == ""):
        _refresh_db_dir_cache()
    return _db_dir_cache[0], _db_dir_cache[1]


def reset_db_dir_cache() -> None:
    """用户改了「微信数据目录」设置后调用，让下次探测生效。"""
    _db_dir_cache[0] = ""
    _db_dir_cache[1] = ""


def _config_ini_roots() -> list[str]:
    """微信把「文件保存位置」记在 %APPDATA%\\Tencent\\xwechat\\config\\*.ini 里，
    内容就是数据根目录路径。用户把聊天记录搬到别的盘后，这个文件会跟着更新，
    比按盘符瞎猜可靠得多。"""
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return []
    roots: list[str] = []
    for cfg_dir in (
        os.path.join(appdata, "Tencent", "xwechat", "config"),
        os.path.join(appdata, "Tencent", "WeChat", "config"),
        os.path.join(appdata, "Tencent", "WeChat"),
    ):
        if not os.path.isdir(cfg_dir):
            continue
        for name in os.listdir(cfg_dir):
            if not name.lower().endswith(".ini"):
                continue
            path = os.path.join(cfg_dir, name)
            try:
                with open(path, "rb") as fh:
                    raw = fh.read(2048)
            except OSError:
                continue
            for enc in ("utf-8", "gbk", "utf-16"):
                try:
                    text = raw.decode(enc).strip().strip("\x00")
                except (UnicodeDecodeError, LookupError):
                    continue
                if not text:
                    continue
                # ini 里就一行路径；也可能带 key=value
                candidate = text.splitlines()[0].strip().strip('"')
                if "=" in candidate:
                    candidate = candidate.split("=", 1)[1].strip().strip('"')
                if candidate and os.path.isdir(candidate):
                    roots.append(candidate)
                    break
    return roots


def _detect_db_dir() -> tuple[str, str]:
    """探测微信数据目录，返回 (目录, 来源)。

    wechat-cli 需要的是「包含 db_storage 的那一层」，也就是
    ...\\xwechat_files\\<wxid>\\ 这个目录（实测传它可用）。

    探测顺序：
      1. 设置项 wechat_db_dir（用户手动指定）
      2. 注册表 Documents 下的 xwechat_files
      3. 各盘符常见位置（含微信安装目录旁）
    """
    configured = configured_db_dir()
    invalid_manual = ""
    if configured:
        p = configured
        if os.path.isdir(os.path.join(p, "db_storage")):
            return p, "手动指定"
        if os.path.isdir(p) and os.path.basename(p) == "db_storage":
            return os.path.dirname(p), "手动指定"
        # 手填的路径失效（用户搬过目录/换了盘）时不要卡死在这里，
        # 继续走自动探测；都探测不到再把这个值带回去给界面提示。
        invalid_manual = configured

    roots: list[str] = []
    # ① 微信配置里记录的位置（用户搬家后仍然准确）
    for base in _config_ini_roots():
        roots.append(os.path.join(base, "xwechat_files"))
        roots.append(base)
    # ② 注册表 Documents
    docs = _documents_dir()
    roots.append(os.path.join(docs, "xwechat_files"))
    exe = wechat_exe()
    if exe:
        install = os.path.dirname(exe)
        roots.append(os.path.join(install, "xwechat_files"))
        roots.append(os.path.join(os.path.dirname(install), "xwechat_files"))

    # 逐个盘符碰运气（用户常见做法：把文档/微信数据搬到 D 盘）
    for letter in "CDEFGH":
        roots.append(os.path.join(f"{letter}:\\", "xwechat_files"))
        roots.append(os.path.join(f"{letter}:\\", "System", "Documents", "xwechat_files"))
        roots.append(os.path.join(f"{letter}:\\", "Documents", "xwechat_files"))
        roots.append(os.path.join(f"{letter}:\\", "Tencent", "xwechat_files"))

    seen = set()
    for root in roots:
        if root in seen:
            continue
        seen.add(root)
        picked = _pick_wxid_dir(root)
        if picked:
            return picked, root

    if invalid_manual:
        return invalid_manual, "手动指定（路径不存在）"
    return "", "未找到"


PBKDF2_ITERATIONS = 256000
PBKDF2_DKLEN = 32


def derive_keys(passphrase_hex: str, db_dir: str = "") -> dict:
    """用 passphrase 派生所有数据库密钥（WeChat 4.1+ 专用）。

    背景（见 wechat-cli issue 与社区文章）：4.0.x 的进程内存里是 PBKDF2 **派生后**
    的加密密钥（`x'<hex>'` 文本），内存扫描能直接拿到；4.1+ 内存里只剩**派生前的
    passphrase**，所以 wechat-cli 的扫描永远是「0 hex 模式」。

    这里按微信的固定参数自己算：
        enc_key = PBKDF2-HMAC-SHA512(passphrase, salt, 256000, dklen=32)
    其中 salt 是每个 .db 文件的前 16 字节。

    passphrase 从哪来：第三方工具 wx_key（DLL 注入）读出来的一串 hex。
    我们只接收这一串、算完就丢，不落盘、不写日志。
    """
    raw = (passphrase_hex or "").strip().replace(" ", "").replace("0x", "").replace("0X", "")
    if not re.fullmatch(r"[0-9a-fA-F]{32,128}", raw):
        return {"ok": False, "code": "BAD_PASSPHRASE", "message": "passphrase 应为 32~128 位十六进制字符"}
    passphrase = bytes.fromhex(raw)

    target_dir = db_dir.strip() or find_db_dir()[0]
    if not target_dir:
        return {"ok": False, "code": "DB_DIR_MISSING", "message": "找不到微信数据目录"}
    if os.path.basename(target_dir) != "db_storage":
        candidate = os.path.join(target_dir, "db_storage")
        if os.path.isdir(candidate):
            target_dir = candidate
    if not os.path.isdir(target_dir):
        return {"ok": False, "code": "DB_DIR_MISSING", "message": f"目录不存在：{target_dir}"}

    result: dict[str, dict] = {}
    for root, _dirs, files in os.walk(target_dir):
        for name in files:
            if not name.endswith(".db"):
                continue
            path = os.path.join(root, name)
            try:
                size = os.path.getsize(path)
                if size < 4096:
                    continue
                with open(path, "rb") as fh:
                    page1 = fh.read(4096)
            except OSError:
                continue
            salt = page1[:16]
            enc_key = hashlib.pbkdf2_hmac("sha512", passphrase, salt, PBKDF2_ITERATIONS, dklen=PBKDF2_DKLEN)
            rel = os.path.relpath(path, target_dir).replace("/", "\\")
            result[rel] = {
                "enc_key": enc_key.hex(),
                "salt": salt.hex(),
                "size_mb": round(size / 1024 / 1024, 1),
            }

    if not result:
        return {"ok": False, "code": "NO_DB", "message": f"目录里没有可用的 .db 文件：{target_dir}"}

    cfg_dir = os.path.join(os.path.expanduser("~"), ".wechat-cli")
    os.makedirs(cfg_dir, exist_ok=True)
    keys_path = os.path.join(cfg_dir, "all_keys.json")
    # 先备份旧的，派生失败还能退回
    if os.path.exists(keys_path):
        try:
            shutil.copy2(keys_path, keys_path + ".bak")
        except OSError:
            pass
    with open(keys_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)
    with open(os.path.join(cfg_dir, "config.json"), "w", encoding="utf-8") as fh:
        json.dump({"db_dir": target_dir}, fh, ensure_ascii=False)

    _log(f"passphrase 派生完成：{len(result)} 个数据库")
    return {
        "ok": True,
        "message": f"已派生 {len(result)} 个数据库的密钥",
        "count": len(result),
        "db_dir": target_dir,
        "keys_path": keys_path,
        "sample": list(result.keys())[:5],
    }

def _write_keys(keys: dict, db_dir: str) -> str:
    """把密钥写成 wechat-cli 认识的两个配置（all_keys.json + config.json）。"""
    cfg_dir = os.path.join(os.path.expanduser("~"), ".wechat-cli")
    os.makedirs(cfg_dir, exist_ok=True)
    keys_path = os.path.join(cfg_dir, "all_keys.json")
    if os.path.exists(keys_path):
        try:
            shutil.copy2(keys_path, keys_path + ".bak")
        except OSError:
            pass
    with open(keys_path, "w", encoding="utf-8") as fh:
        json.dump(keys, fh, indent=2, ensure_ascii=False)
    db_storage = db_dir if os.path.basename(db_dir) == "db_storage" else os.path.join(db_dir, "db_storage")
    with open(os.path.join(cfg_dir, "config.json"), "w", encoding="utf-8") as fh:
        json.dump({"db_dir": db_storage}, fh, ensure_ascii=False)
    return keys_path

def run_init(force: bool = False) -> dict:
    """执行 wechat-cli init（需微信运行；Windows 需管理员权限）。"""
    if not wechat_running():
        return {"ok": False, "message": "微信未启动，请先登录微信桌面版", "code": "WECHAT_NOT_RUNNING"}

    db_dir, db_source = find_db_dir()

    # ① 微信 4.1+ 首选：wcdb-key-tool 的只读运行时扫描（MIT，vendor/）
    #    4.1 之后进程内存里只剩 passphrase，wechat-cli 的 x'<hex>' 扫描必然 0 命中，
    #    而这条路径实测 4.1.15.56 可以 20/20 拿到密钥。
    try:
        from adapters.wcdb_runtime import extract as wcdb_extract

        keys, wmsg = wcdb_extract(db_dir)
        if keys:
            keys_path = _write_keys(keys, db_dir)
            _log(f"wcdb 只读扫描成功：{len(keys)} 个数据库")
            return {
                "ok": True,
                "code": "OK",
                "message": f"密钥提取成功（{wmsg}）",
                "output": wmsg,
                "keys_path": keys_path,
                "db_dir": db_dir,
                "db_dir_source": db_source,
                "method": "wcdb-runtime",
                "admin": is_admin(),
                "wechat_version": wechat_version(),
            }
        _log(f"wcdb 只读扫描未命中：{wmsg}")
    except Exception as e:  # noqa: BLE001
        _log(f"wcdb 只读扫描异常：{type(e).__name__}: {e}")

    # ② 回退：老版本（4.0.x）走 wechat-cli 的内存扫描
    args = ["init"]
    if db_dir:
        args += ["--db-dir", db_dir]
    if force:
        args.append("--force")

    code, out = _run(args, timeout=240)
    ok = keys_ready()
    tail = "\n".join(out.strip().splitlines()[-10:])
    v = wechat_version()
    admin = is_admin()

    if ok:
        # CLI 在已有密钥时会直接说「已初始化，用 --force 重新提取」，
        # 这种情况不算本次真的提取成功，文案要区分开。
        already = ("已初始化" in out) and ("--force" in out or "已存在" in out)
        return {
            "ok": True,
            "message": "密钥已存在，本次未重新提取" if already else "密钥提取成功",
            "output": tail,
            "code": "OK",
            "admin": admin,
            "wechat_version": v,
            "db_dir": db_dir,
            "db_dir_source": db_source,
        }

    # 情况一：连数据目录都没找到 —— 和"版本不兼容"完全是两回事，不能混为一谈
    dir_missing = ("未能自动检测到微信数据目录" in out) or ("未找到微信数据目录" in out)
    if dir_missing and not db_dir:
        return {
            "ok": False,
            "code": "DB_DIR_MISSING",
            "message": (
                "找不到微信数据目录。请打开微信 → 设置 → 文件管理，复制"
                "「文件保存位置」，再到本页「微信数据目录」里手动指定（选到 wxid_ 开头的那一层）。"
            ),
            "output": tail,
            "admin": admin,
            "wechat_version": v,
            "db_dir": "",
            "db_dir_source": db_source,
        }

    # 情况二：目录找到了，但进程里取不到密钥 —— 基本就是微信版本不兼容
    reasons = []
    if not admin:
        reasons.append("当前不是管理员权限，读不到微信进程内存")
    if v:
        reasons.append(f"本机微信版本 {v}")
    if "0 hex模式" in out or "0 hex patterns" in out:
        return {
            "ok": False,
            "code": "KEY_NOT_IN_MEMORY",
            "message": (
                "没能从微信进程里取到密钥。请确认微信已登录并保持运行；"
                "仍然失败的话，把 诊断工具\\collect.bat 生成的包发给开发者。"
            ),
            "output": tail,
            "admin": admin,
            "wechat_version": v,
            "db_dir": db_dir,
            "db_dir_source": db_source,
        }
    if "未能从任何微信进程中提取到密钥" in out:
        reasons.append("微信进程里没有可用的密钥（多为微信版本比组件新）")
    elif "未提取到任何密钥" in out:
        reasons.append("20 个数据库一个都没解开（多数是微信版本不兼容）")
    msg = "未能提取到密钥"
    if reasons:
        msg += "：" + "；".join(reasons)
    return {
        "ok": False,
        "message": msg,
        "output": tail,
        "code": "KEY_EXTRACT_FAILED",
        "admin": admin,
        "wechat_version": v,
        "db_dir": db_dir,
        "db_dir_source": db_source,
    }

_BOOT_INIT_TRIED = False


def auto_init_keys(force: bool = False) -> dict:
    """开机自动提取数据库密钥：微信在跑且密钥缺失时才动手，每个进程最多试一次。"""
    global _BOOT_INIT_TRIED
    if _BOOT_INIT_TRIED and not force:
        return {"ok": True, "skipped": True, "message": "本次启动已尝试过"}
    _BOOT_INIT_TRIED = True

    if keys_ready() and not force:
        return {"ok": True, "skipped": True, "message": "密钥已存在，跳过"}
    if not find_cli():
        return {"ok": False, "code": "CLI_MISSING", "message": "未安装 wechat-cli，跳过自动提取"}
    if not wechat_running():
        return {"ok": False, "code": "WECHAT_NOT_RUNNING", "message": "微信未运行，跳过自动提取"}
    return run_init()


# cli_status 每次都要起子进程问版本 + tasklist，太慢；缓存 60 秒
_CLI_STATUS_CACHE: dict = {"at": 0.0, "data": None}
CLI_STATUS_TTL = 60


def cli_status(force: bool = False) -> dict:
    now = time.time()
    if (
        not force
        and _CLI_STATUS_CACHE["data"] is not None
        and now - _CLI_STATUS_CACHE["at"] < CLI_STATUS_TTL
    ):
        return dict(_CLI_STATUS_CACHE["data"])

    path = find_cli()
    _db_dir, _db_dir_src = find_db_dir()
    info = {
        "installed": bool(path),
        "path": path,
        "wechat_running": wechat_running(),
        "initialized": keys_ready(),
        "version": "",
        "cli_message": "",
        # 提取密钥的两个关键条件：管理员权限、微信版本
        "admin": is_admin(),
        "wechat_version": wechat_version(),
        "wechat_exe": wechat_exe() or "",
        "db_dir": _db_dir,
        "db_dir_source": _db_dir_src,
    }
    if not path:
        info["cli_message"] = "未检测到 wechat-cli"
        _CLI_STATUS_CACHE["at"] = time.time()
        _CLI_STATUS_CACHE["data"] = dict(info)
        return info
    code, out = _run(["--version"], timeout=20)
    info["version"] = out.strip().splitlines()[0] if out.strip() else ""
    info["cli_message"] = "" if code == 0 else out.strip()[:200]

    # 组件安装信息（供界面展示"装在哪、什么时候装的、多大"）
    try:
        from services.component_installer import install_location

        loc = install_location()
        info["install_dir"] = loc.get("active")
        manifest = os.path.join(loc.get("active") or "", "manifest.json")
        if os.path.exists(manifest):
            with open(manifest, encoding="utf-8") as f:
                data = json.load(f)
            info["installed_at"] = data.get("installed_at")
            info["installed_size"] = data.get("size")
            info["install_source"] = data.get("source")
    except Exception:  # noqa: BLE001 - 仅展示用，失败不影响主流程
        pass

    # 说明：当前没有组件更新源，不做自动升级（详见 docs）
    info["auto_update"] = False
    _CLI_STATUS_CACHE["at"] = time.time()
    _CLI_STATUS_CACHE["data"] = dict(info)
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
        self.marker = _load_marker()   # {"groups": {群名: {"last_sync_at": iso}}}

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
            "backfilled": list((self.marker.get("groups") or {}).keys()),
        }

    # ---------- 轮询 ----------

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._poll_once()
            except Exception as e:  # noqa: BLE001
                self.last_error = f"轮询异常：{e}"
            self._stop.wait(self.interval)

    def _window_for(self, state) -> tuple[str, str]:
        """返回 (起始时间字符串, 模式说明)。state 支持新格式 dict 与旧的字符串标记。"""
        now = datetime.now()
        last = None
        if isinstance(state, dict):
            last = state.get("last_sync_at")
        elif isinstance(state, str) and state:
            last = state  # 兼容旧标记（写的是首次回补时间）

        if last:
            try:
                ts = datetime.fromisoformat(last) - timedelta(minutes=OVERLAP_MINUTES)
            except ValueError:
                ts = now - timedelta(minutes=OVERLAP_MINUTES)
            floor = now - timedelta(days=BACKFILL_MAX_DAYS)
            if ts < floor:
                ts = floor
            return ts.strftime("%Y-%m-%d %H:%M:%S"), "增量补齐"
        return backfill_since(), f"首次回补 {BACKFILL_HOURS}h"

    def _poll_once(self) -> None:
        self.last_poll = datetime.now().strftime("%H:%M:%S")

        # 有指定群：按群拉 history。
        # 时间窗由「上次同步到哪」决定：
        #   - 没同步过 → 回补最近 24 小时
        #   - 同步过   → 从 last_sync_at 往前推 2 分钟（重叠容错），最多回溯 7 天
        # 这样「关机几天再打开」也能补齐，不再受 30 条上限限制。
        if self.groups:
            messages: list[dict] = []
            group_state = self.marker.get("groups") or {}
            for group in self.groups:
                since, mode = self._window_for(group_state.get(group))
                code, out = _run(
                    [
                        "history",
                        group,
                        "--start-time",
                        since,
                        "--limit",
                        str(BACKFILL_LIMIT),
                    ],
                    timeout=180,
                )
                if code != 0:
                    self.last_error = (out.strip()[:200] or f"退出码 {code}")
                    continue

                got = parse_history(out, group)
                messages.extend(got)
                group_state[group] = {"last_sync_at": datetime.now().isoformat(timespec="seconds")}
                self.marker["groups"] = group_state
                _save_marker(self.marker)
                _log(f"[wechat] {mode}「{group}」自 {since} 起：{len(got)} 条")
        else:
            code, out = _run(["new-messages"], timeout=45)
            if code != 0:
                self.last_error = out.strip()[:300] or f"退出码 {code}"
                return
            messages = parse_new_messages(out)

        for msg in messages:
            if self.groups and msg["group"] not in self.groups:
                continue
            # 系统消息（入群提示、撤回、红包等）是 XML 原文，直接丢弃
            text = (msg.get("text") or "").lstrip()
            if text.startswith(("<?xml", "<sysmsg", "<msg")):
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
