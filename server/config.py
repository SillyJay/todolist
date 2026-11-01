"""配置读写（含 API Key 加密存储）。

实现要点（规格 §4 D9、§6 settings 表）：
- 普通配置存 SQLite settings 表（KV）
- API Key 用 keyring 库存系统密钥环（Windows 下走 DPAPI 凭据管理器），
  不落明文；settings 表只存占位标记
"""
import os
import sys

APP_NAME = "CampusAssistant"
SERVICE_NAME = "CampusAssistant"  # keyring service 名


def data_dir() -> str:
    """程序数据目录：%APPDATA%/CampusAssistant（规格 §4 D4）"""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    else:
        base = os.path.expanduser("~/.config")
    path = os.path.join(base, APP_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def db_path() -> str:
    return os.path.join(data_dir(), "campus_assistant.db")


def _writable(path: str) -> bool:
    try:
        os.makedirs(path, exist_ok=True)
        probe = os.path.join(path, ".write_test")
        with open(probe, "w", encoding="utf-8") as f:
            f.write("ok")
        os.remove(probe)
        return True
    except OSError:
        return False


def app_root() -> str:
    """助手（程序）所在目录。

    - 开发态：server/ 的父目录，即 campus-assistant/
    - 打包后：可执行文件所在目录；**若该目录不可写**（装在 Program Files 下），
      退回 %APPDATA%/CampusAssistant，保证 exports/ 与 workspace/ 能落盘。
    """
    if getattr(sys, "frozen", False):
        base = os.path.dirname(sys.executable)
        return base if _writable(base) else data_dir()
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def exports_dir() -> str:
    """ICS 导出目录（规格 §13.8：不得写入 C 盘，默认放在助手目录下 exports/）。"""
    target = os.path.join(app_root(), "exports")
    os.makedirs(target, exist_ok=True)
    return target


def set_secret(key: str, value: str) -> None:
    import keyring
    keyring.set_password(SERVICE_NAME, key, value)


def get_secret(key: str) -> str | None:
    import keyring
    try:
        return keyring.get_password(SERVICE_NAME, key)
    except Exception:
        return None
