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


def set_secret(key: str, value: str) -> None:
    import keyring
    keyring.set_password(SERVICE_NAME, key, value)


def get_secret(key: str) -> str | None:
    import keyring
    try:
        return keyring.get_password(SERVICE_NAME, key)
    except Exception:
        return None
