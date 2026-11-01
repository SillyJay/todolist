# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置：wechat-cli.exe（内置于安装包，用户无需装 Python）。

用法（在 server/ 目录）：
    python -m PyInstaller --noconfirm --clean wechat_cli.spec

产物：server/dist/wechat-cli.exe
"""
from PyInstaller.utils.hooks import collect_submodules

hidden = []
for pkg in ("wechat_cli", "click"):
    try:
        hidden += collect_submodules(pkg)
    except Exception:  # noqa: BLE001
        pass

a = Analysis(
    ["wechat_cli_launcher.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=hidden,
    excludes=["playwright", "tkinter", "matplotlib", "pandas", "numpy"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="wechat-cli",
    debug=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="wechat-cli",
)
