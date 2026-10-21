"""API Key 安全存储（规格 §11：Windows 凭据管理器 / keyring，不落明文）。

优先 keyring，失败时回落到程序数据目录下的本地文件（权限 600），
并在设置页提示用户当前存储方式。
"""
import json
import os

from config import data_dir

SERVICE = "campus-assistant"
_FALLBACK = None


def _fallback_path() -> str:
    global _FALLBACK
    if _FALLBACK is None:
        _FALLBACK = os.path.join(data_dir(), "secrets.json")
    return _FALLBACK


def set_secret(name: str, value: str) -> dict:
    """name 如 glm_api_key。返回 {ok, backend}。"""
    try:
        import keyring

        keyring.set_password(SERVICE, name, value)
        return {"ok": True, "backend": "keyring"}
    except Exception:  # noqa: BLE001 - 无 keyring 后端时降级
        data = {}
        path = _fallback_path()
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                data = {}
        data[name] = value
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return {"ok": True, "backend": "file"}


def get_secret(name: str) -> str:
    try:
        import keyring

        value = keyring.get_password(SERVICE, name)
        if value:
            return value
    except Exception:  # noqa: BLE001
        pass

    path = _fallback_path()
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return (json.load(f) or {}).get(name, "")
        except (OSError, json.JSONDecodeError):
            return ""
    return ""


def delete_secret(name: str) -> None:
    try:
        import keyring

        keyring.delete_password(SERVICE, name)
    except Exception:  # noqa: BLE001
        pass
    path = _fallback_path()
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f) or {}
            data.pop(name, None)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except (OSError, json.JSONDecodeError):
            pass
