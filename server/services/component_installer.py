"""组件安装器：wechat-cli 等外部二进制的下载/解压/校验/探测。

安装目录策略（用户要求）：**优先助手目录 D 盘，不可写时回落 C 盘 %APPDATA%**。
- 开发态：D:\\projects\\campus-assistant\\bin\\wechat-cli
- 打包后：<安装目录>\\bin\\wechat-cli（Program Files 常不可写 → 自动回落）
- 回落：%APPDATA%\\CampusAssistant\\bin\\wechat-cli

⚠️ 仅下载用户在界面上明确点击安装的组件，不做静默下载。
"""
import hashlib
import json
import os
import shutil
import tempfile
import zipfile
from datetime import datetime
from urllib.request import urlopen

from config import app_root, data_dir

COMPONENT = "wechat-cli"
EXE_NAMES = {"wechat-cli.exe", "wechat-cli"}


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


def install_dir() -> str:
    """返回组件安装目录（优先 D 盘助手目录，不可写回落 C 盘）。"""
    preferred = os.path.join(app_root(), "bin", COMPONENT)
    if _writable(preferred):
        return preferred
    fallback = os.path.join(data_dir(), "bin", COMPONENT)
    os.makedirs(fallback, exist_ok=True)
    return fallback


def install_location() -> dict:
    """给前端展示：优先目录、是否可写、实际使用目录。"""
    preferred = os.path.join(app_root(), "bin", COMPONENT)
    ok = _writable(preferred)
    return {
        "preferred": preferred,
        "preferred_writable": ok,
        "active": install_dir(),
        "fallback": os.path.join(data_dir(), "bin", COMPONENT),
    }


def find_installed_exe() -> str | None:
    """在安装目录里找可执行文件。"""
    for base in (install_dir(), os.path.join(data_dir(), "bin", COMPONENT)):
        if not os.path.isdir(base):
            continue
        for root, _dirs, files in os.walk(base):
            for name in files:
                if name.lower() in EXE_NAMES:
                    return os.path.join(root, name)
    return None


def install(source: str, expect_sha256: str | None = None, progress=None) -> dict:
    """从 URL / 本地路径安装：支持 .zip 与裸 exe。

    source 可为 https://...、file:///... 或本地绝对路径。
    """
    target = install_dir()
    os.makedirs(target, exist_ok=True)

    if progress:
        progress("downloading", 0)

    tmp_dir = tempfile.mkdtemp(prefix="ca-dl-")
    local = os.path.join(tmp_dir, "pkg")

    try:
        if source.startswith("http://") or source.startswith("https://"):
            with urlopen(source, timeout=60) as resp, open(local, "wb") as out:  # noqa: S310
                total = int(resp.headers.get("Content-Length") or 0)
                done = 0
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    if progress and total:
                        progress("downloading", int(done * 100 / total))
        else:
            src = source.replace("file:///", "").replace("file://", "")
            shutil.copy2(src, local)

        if expect_sha256:
            digest = hashlib.sha256(open(local, "rb").read()).hexdigest()
            if digest.lower() != expect_sha256.lower():
                return {
                    "ok": False,
                    "code": "CHECKSUM_MISMATCH",
                    "message": f"SHA256 不匹配，期望 {expect_sha256[:12]}… 实际 {digest[:12]}…",
                }

        if progress:
            progress("extracting", 0)

        if zipfile.is_zipfile(local):
            with zipfile.ZipFile(local) as zf:
                zf.extractall(target)
        else:
            name = os.path.basename(local)
            if not name.lower().endswith(".exe"):
                name = "wechat-cli.exe"
            shutil.copy2(local, os.path.join(target, name))
    except Exception as e:  # noqa: BLE001 - 下载/解压异常统一反馈
        return {"ok": False, "code": "INSTALL_FAILED", "message": f"安装失败：{type(e).__name__}: {e}"}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    exe = find_installed_exe()
    if not exe:
        return {
            "ok": False,
            "code": "EXE_NOT_FOUND",
            "message": "解压后没有找到 wechat-cli.exe，请确认下载包结构",
            "dir": target,
        }

    size = os.path.getsize(exe)
    manifest = {
        "component": COMPONENT,
        "source": source,
        "installed_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "exe": exe,
        "size": size,
    }
    with open(os.path.join(target, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    if progress:
        progress("done", 100)
    return {"ok": True, "exe": exe, "size": size, "dir": target, "message": "安装完成"}


def uninstall() -> dict:
    removed = []
    for base in (install_dir(), os.path.join(data_dir(), "bin", COMPONENT)):
        if os.path.isdir(base):
            shutil.rmtree(base, ignore_errors=True)
            removed.append(base)
    return {"ok": True, "removed": removed}
