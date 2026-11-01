"""微信 4.1+ 密钥提取（只读运行时扫描）的封装。

底层用的是 vendor/wcdb_key_tool_windows.py（MIT，TANGandXUE/wcdb-key-tool）。
它做的事：
  1. 在微信进程内存里定位 `com.Tencent.WCDB.Config.Cipher` 对象
  2. 解出候选 `x'<64hex key><32hex salt>'`
  3. 用数据库第一页的 HMAC-SHA512 校验（校验过才算数）
  4. 对每个库用 salt 做 PBKDF2-HMAC-SHA512(256000) 派生出该库的 AES-256 密钥

为什么不用 wechat-cli 自带的 init：
  4.1+ 内存里只剩 passphrase，老的 `x'...'` 内存扫描永远 0 命中
  （实测 4.1.15.56：扫描 5 个进程、ASCII/UTF-16 全 0）。

这里只读、不注入、不改微信行为；调用方负责把结果写进 ~/.wechat-cli/all_keys.json。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

_VENDOR_OK = False
_WK = None


def _load():
    """按需导入 vendor 模块（非 Windows 平台直接返回 None）。"""
    global _VENDOR_OK, _WK
    if _VENDOR_OK:
        return _WK
    if sys.platform != "win32":
        return None
    try:
        # 兼容源码运行（server/ 在 sys.path）与 PyInstaller 打包
        try:
            from vendor import wcdb_key_tool_windows as wk  # type: ignore
        except ImportError:
            import importlib.util

            here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            path = os.path.join(here, "vendor", "wcdb_key_tool_windows.py")
            spec = importlib.util.spec_from_file_location("wcdb_key_tool_windows", path)
            wk = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(wk)
        _WK = wk
        _VENDOR_OK = True
        return _WK
    except Exception:  # noqa: BLE001
        return None


def available() -> bool:
    return _load() is not None


def extract(db_dir: str = "") -> tuple[dict | None, str]:
    """扫描微信进程内存拿密钥。

    返回 (keys, message)：
      keys = {相对路径: {"enc_key", "salt", "size_mb"}}，失败时 None
    """
    wk = _load()
    if wk is None:
        return None, "vendor 组件不可用（仅支持 Windows）"

    target = db_dir.strip() if db_dir else ""
    if not target:
        try:
            target = wk.auto_detect_db_dir() or ""
        except Exception:  # noqa: BLE001
            target = ""
    if not target:
        return None, "找不到微信 db_storage 目录"
    if os.path.basename(target) != "db_storage":
        candidate = os.path.join(target, "db_storage")
        if os.path.isdir(candidate):
            target = candidate
    if not os.path.isdir(target):
        return None, f"目录不存在：{target}"

    tmp = os.path.join(tempfile.gettempdir(), "ca-wcdb-keys.json")
    try:
        if os.path.exists(tmp):
            os.remove(tmp)
        # 上游函数自己会写 JSON，并在完全没拿到密钥时抛 RuntimeError
        wk._scan_memory_raw_key(target, tmp)  # noqa: SLF001
        with open(tmp, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as e:  # noqa: BLE001
        return None, f"{type(e).__name__}: {e}"
    finally:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass

    data.pop("_db_dir", None)
    clean = {
        rel: {
            "enc_key": v.get("enc_key", ""),
            "salt": v.get("salt", ""),
            "size_mb": v.get("size_mb", 0),
        }
        for rel, v in data.items()
        if isinstance(v, dict) and v.get("enc_key")
    }
    if not clean:
        return None, "扫描完成但没有通过 HMAC 校验的密钥"
    return clean, f"只读扫描命中 {len(clean)} 个数据库"
