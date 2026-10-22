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
Electron **GPU 子进程无法启动**，报：

```
GPU process launch failed: error_code=18
FATAL:gpu_data_manager_impl_private.cc:415] GPU process isn't usable. Goodbye.
```

表现为窗口一闪而过、进程静默退出、控制台无任何 JS 报错（日志已落盘才看到）。

**规避**（已写入 `src/main/index.ts`）：

```ts
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
```

**问题 3b**：`D:\HOMEWORK` 目录 ACL 异常（含 `Everyone Deny DeleteSubdirectoriesAndFiles`
与非标准 SID 的显式 ACE），非管理员进程在此目录加载 Electron / 创建 Python venv 均失败
（Electron 直接 0xC0000005 崩溃，venv 报 pyvenv.cfg 打不开）。以管理员身份运行 WorkBuddy 后恢复正常。
**长期建议**：把项目迁到无特殊 ACL 的普通目录（如 `D:\projects\`），即可摆脱管理员依赖。

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

## 渲染进程连不上后端（CSP）

**问题**：页面显示「后端健康检查失败」，但主进程日志里 `[backend] healthy on port 8765` 正常，
渲染进程控制台报：

```
Refused to connect to 'http://127.0.0.1:8765/api/health' because it violates
the following Content Security Policy directive: "default-src 'self'"
```

**原因**：electron-vite 脚手架默认 CSP 只写了 `default-src 'self'`，没有放行 `connect-src`，
所有 fetch 到本机后端的请求都被浏览器安全策略拦掉。

**修复**（`src/renderer/index.html`）：

```
connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*
```

端口要写成通配（`*`），因为后端端口会自动顺延。

## 渲染进程日志进主进程日志

主进程监听 `webContents.on('console-message')`，把渲染进程的 console 输出转发到
`main.log`（前缀 `[renderer]`）。没有 DevTools 的场景下排查前端问题非常有效。

## wechat-cli 安装（微信监听依赖）

**走过的弯路**：

- npm 包 `@canghe_ai/wechat-cli` 只发布了 `darwin-arm64` 单架构二进制，Windows 装完跑不起来。
- PyPI 上的同名包不是这个项目，别装。
- `~\.workbuddy\skills\wechat-cli__skillhub` 只是 skill 说明 + 密钥提取脚本，**不含 CLI 本体**。

**可用做法**：从 GitHub 源码装进项目 venv（0.2.4，依赖 click / pycryptodome / zstandard）：

```bash
git clone https://github.com/huohuoer/wechat-cli.git "$TEMP/wcli"
"C:/Users/SillyJay/.workbuddy/binaries/python/envs/campus-assistant/Scripts/python.exe" -m pip install "$TEMP/wcli"
```

装完产物在 venv 里，不在仓库里：

| 位置 | 内容 |
|---|---|
| `...\envs\campus-assistant\Scripts\wechat-cli.exe` | console_scripts 入口（`wechat_cli.main:cli`） |
| `...\envs\campus-assistant\Lib\site-packages\wechat_cli\` | 包本体，约 476K |
| `%USERPROFILE%\.wechat-cli\` | 运行时数据：`config.json`、`all_keys.json`（数据库密钥）、`last_check.json` |

`server/adapters/wechat_listener.py` 的 `find_cli()` 会依次找：组件安装目录 →
PATH → 解释器同目录 → 常见安装位置。**第三条命中 venv 的 Scripts 目录**，所以
`bin/wechat-cli/` 是空目录也能正常工作（该目录由 `component_installer.install_dir()` 建出来，
仅用于「从 UI 下载组件」这条备用路径）。

⚠️ 源码目录在 `%TEMP%`，会被系统清理。重装前先确认 `wechat-cli --version` 还能跑；
如果 venv 被重建，上面的 pip 命令要重跑一次（`all_keys.json` 不用重生成）。
