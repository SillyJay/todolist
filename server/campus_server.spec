# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置：后端服务（campus-assistant-server.exe）。

用法（在 server/ 目录）：
    python -m PyInstaller --noconfirm --clean campus_server.spec

产物：server/dist/campus-assistant-server/campus-assistant-server.exe（onedir）

关于 playwright：
  学习通的作业页只能用浏览器抓（HTTP 会被 3004 签名校验拦掉），
  playwright 必须打进包，否则打包版用户「同步作业」一律失败。
  代価是 _internal 多约 100MB（driver 里带 node）。
  浏览器不用下载：代码里用 channel="msedge"，复用系统自带 Edge。
"""
from PyInstaller.utils.hooks import collect_all, collect_submodules

hidden = [
    # uvicorn 的动态导入（缺了会启动即崩）
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    # keyring 在 Windows 用凭据管理器
    "keyring.backends.Windows",
    # SQLite 方言
    "sqlalchemy.dialects.sqlite",
    # anyio / apscheduler 的运行时后端
    "anyio._backends._asyncio",
    "apscheduler.triggers.cron",
    "apscheduler.triggers.interval",
]

# 第三方 vendor 组件（wcdb-key-tool，微信 4.1+ 只读扫描）必须显式收集，
# 否则冻结后 adapters.wcdb_runtime 里的 fallback 会找不到文件。
hidden += ["vendor", "vendor.wcdb_key_tool_windows"]

for pkg in ("uvicorn", "apscheduler", "icalendar", "keyring", "watchdog", "sqlalchemy"):
    try:
        hidden += collect_submodules(pkg)
    except Exception:  # noqa: BLE001
        pass

# playwright 的 driver（node + cli.js）是数据文件，必须显式收集
pw_datas, pw_binaries, pw_hidden = collect_all("playwright")

# vendor 的 .py 同时作为数据文件带上（importlib 回退路径会用）
import os as _os
pw_datas = list(pw_datas) + [(_os.path.join("vendor", "wcdb_key_tool_windows.py"), "vendor")]
hidden += pw_hidden

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=pw_binaries,
    datas=pw_datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 这些是可选分析库，不是运行时依赖
        "tkinter",
        "matplotlib",
        "pandas",
        "numpy",
        "scipy",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="campus-assistant-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# onedir：exe 与 _internal 同目录。
# 相比 onefile，启动更快，且进程树只有一层（onefile 会 fork 子进程，
# 父进程被杀后子进程仍占着 exe 文件/端口）。
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="campus-assistant-server",
)
