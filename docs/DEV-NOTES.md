# 开发环境说明（本机环境踩坑记录）

> 记录本机特有的环境问题与规避方式，换机器开发时可重新评估。

## Python 运行时

**问题**：`python -m venv` 在 `D:\HOMEWORK` 下创建虚拟环境后，venv 内部解释器启动报
`failed to open 'pyvenv.cfg'`（exit 107），ensurepip 也随之失败。系统 Python 3.12 与托管
Python 3.13 均复现，换到 `C:\Users\...\Temp` 下则正常。

**规避**：venv 建在托管运行时目录，不放在项目内：

```
C:\Users\SillyJay\.workbuddy\binaries\python\envs\campus-assistant\Scripts\python.exe
```

`app/src/main/backend.ts` 会自动探测该路径（无需配置）。若换机器后用项目内 venv，
把解释器放到 `server/.venv/Scripts/python.exe` 即可被优先识别；也可用环境变量
`BACKEND_PYTHON` 指定。

## pip 安装依赖

**问题**：pip 26.x 的默认 User-Agent 携带 JSON 串，清华镜像返回 403，表现为
`No matching distribution found`，且 `-v` 下可见 `403 None`。

**规避**：用包装脚本把 UA 改短后再调 pip：

```python
# 保存为 pipwrap.py
import sys
import pip._internal.network.session as s
s.user_agent = lambda: "pip/26.1.2"
from pip._internal.cli.main import main
sys.exit(main())
```

```bash
python pipwrap.py install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
```

## Electron 启动

**问题 1**：WorkBuddy 的运行环境全局设置了 `ELECTRON_RUN_AS_NODE=1`，导致 electron.exe
以 Node 模式启动，报 `Invalid file descriptor to ICU data received`。

**规避**：在**独立终端**里运行 `npm run dev`（普通终端无此变量）；必要时先
`set ELECTRON_RUN_AS_NODE=`（cmd）或 `unset ELECTRON_RUN_AS_NODE`（bash）。

**问题 2**：Electron 二进制下载走 GitHub，国内网络会卡住。

**规避**：设置镜像后重装：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

**问题 3**：本机显卡为虚拟显示适配器（GameViewer Virtual Display Adapter，远程/云桌面环境），
Electron 硬件加速初始化易失败导致进程静默退出。

**规避**：
- 主进程已调用 `app.disableHardwareAcceleration()` 强制软件渲染；
- Electron 版本锁定 37.x（与 WorkBuddy 自身一致，已验证可在此机器运行），未用 44.x；
- 主进程启动日志写入 `%APPDATA%\CampusAssistant\main.log`，GUI 无输出时先看该文件。

**问题 4**：PowerShell 7.6 在窄窗口下启动会崩（`totalWidth must be a non-negative value`），
与本项目无关。规避：窗口拉宽，或 `[Environment]::SetEnvironmentVariable('POWERSHELL_UPDATECHECK','Off','User')`，
或直接用 `dev.cmd` / cmd。

## Git 推送

本机 git 推送 GitHub 需要走本机代理（已在仓库内配置）：

```
git config http.proxy http://127.0.0.1:10177
```

## 版本偏差（SPEC-GAP）

- 规格要求 React 18，electron-vite 最新脚手架默认 React 19；两者 API 兼容，按 19 使用并在此记录偏差。
- 规格要求 Electron 最新稳定版；当前为 44.x。
