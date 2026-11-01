"""运行环境自检：依赖组件是否齐全（尤其是打包版）。

学习通的作业页只能靠 playwright + 系统 Edge 抓取，
打包时漏收依赖会表现为「同步作业一律失败」，所以这里提供可自查的接口。
"""
import importlib.util
import os
import shutil
import sys

from fastapi import APIRouter

router = APIRouter()

EDGE_CANDIDATES = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedgewebview2.exe",
)


def _edge() -> str | None:
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    return shutil.which("msedge")


@router.get("/components")
def components() -> dict:
    """只做「有没有」，不真正启动浏览器（毫秒级）。"""
    try:
        has_pw = importlib.util.find_spec("playwright") is not None
    except (ImportError, ValueError):
        has_pw = False
    return {
        "frozen": bool(getattr(sys, "frozen", False)),
        "python": sys.version.split()[0],
        "playwright": has_pw,
        "edge": _edge(),
    }


@router.post("/components/probe")
def probe() -> dict:
    """真启动一次 Edge 验证 playwright 可用（约 2-5 秒）。"""
    if importlib.util.find_spec("playwright") is None:
        return {"ok": False, "message": "playwright 未安装"}
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(
                channel="msedge", headless=True, args=["--no-sandbox"]
            )
            version = browser.version
            browser.close()
        return {"ok": True, "version": version, "edge": _edge()}
    except Exception as e:  # noqa: BLE001 - 自检接口要能报错而不是 500
        return {"ok": False, "message": f"{type(e).__name__}: {e}"}
