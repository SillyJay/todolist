# 打包与分发

> 目标：把「Electron 前端 + Python 后端 + wechat-cli 组件」打成一个用户双击就能用的 Windows 应用。
> 本文记录完整流程和踩过的坑，避免重复试错。

## 一、整体结构

```
构建产物（app\dist\win-unpacked\）
├── app.exe                        Electron 主程序（改名自 electron.exe）
└── resources\
    ├── app.asar                   前端 + 主进程代码
    └── backend\                   ← 由 build-backend.ps1 产出，extraResources 复制进来
        ├── campus-assistant-server.exe
        ├── _internal\             PyInstaller 运行时
        └── bin\wechat-cli\
            ├── wechat-cli.exe     微信监听组件（用户机器无需 Python）
            └── _internal\
```

主进程 `backend.ts` 在打包态直接执行：

```
resources/backend/campus-assistant-server.exe --port <动态端口>
```

`wechat_listener.find_cli()` 的 frozen 分支会找 `<exe目录>\bin\wechat-cli\wechat-cli.exe`。

## 二、两步构建

### 1. 构建后端与组件

```powershell
cd <repo>
.\build-backend.ps1            # 或 npm run build:backend（在 app 目录）
```

产出：
- `server\dist\backend\`（后端 onedir）
- `server\dist\backend\bin\wechat-cli\`（组件 onedir）

> 需要 PyInstaller。脚本会自动从清华/阿里云镜像安装；网络全断时会给出三种手动方案。

### 2. 构建安装包

```powershell
cd app
npm run build:win              # 正常网络
npm run build:win:offline      # 网络受限：只出 win-unpacked，跳过签名工具与 Electron 下载
```

> **网络受限时必须用 `build:win:offline`**：默认的 `electron-builder --win` 会去 GitHub
> 下载 Electron zip 与 winCodeSign/nsis，国内环境经常卡住（表现为「unpacking default
> Electron distribution」之后长时间无输出）。
> `--config.electronDist=node_modules/electron/dist` 让它直接复用本机已解压的 Electron。

## 三、踩过的四个坑

### 坑 1：onefile 会 fork 子进程

PyInstaller `--onefile` 的 exe 启动时会解压并 fork 一个子进程。后果：

- 杀父进程后子进程仍在，占着 exe 文件和端口
- 下一次构建报 `PermissionError: [WinError 5] 拒绝访问`（因为 exe 被占用）

**解决**：两个 spec 都改成 `COLLECT`（onedir）。启动更快，进程树只有一层。
如果坚持 onefile，杀进程必须用 `taskkill /PID <pid> /T /F`（`/T` 杀进程树）。

### 坑 2：冻结后的 wechat-cli 不认 `PYTHONIOENCODING`

未打包时给子进程设 `PYTHONIOENCODING=utf-8` 就能正确输出 UTF-8；
但 PyInstaller 冻结后的 exe **忽略这个变量**，仍按控制台代码页（简中是 GBK）输出：

- 群名里的 emoji → `UnicodeEncodeError` → 进程 `exit 1`
- 即使没崩，JSON 也是 GBK 字节，后端按 UTF-8 解码 → 乱码 → 解析失败

**解决**：`server/wechat_cli_launcher.py` 在 import 业务代码**之前**把
`sys.stdout/stderr` 换成 UTF-8 的 `TextIOWrapper`。

### 坑 3：`find_cli()` 里的局部 `import sys`

函数体内原来有一句 `import sys`，Python 因此把 `sys` 当局部变量；
新加的 `getattr(sys, "frozen")` 位于该 import 之前 → `UnboundLocalError`。
**只有打包后才暴露**（开发态走不到 frozen 分支）。

**解决**：删掉函数内的 `import sys`，统一用模块级 import。

### 坑 4：装在 Program Files 下不可写

`app_root()` 原来在 frozen 时固定返回 exe 目录。装到 `C:\Program Files\` 后
`exports/`、`workspace/` 都写不进去。

**解决**：`config.app_root()` 增加可写探测，不可写时回退 `%APPDATA%\CampusAssistant`。

## 四、验证清单

```powershell
# 1) 后端 exe 能独立跑
.\server\dist\backend\campus-assistant-server.exe --port 8835
curl http://127.0.0.1:8835/api/health

# 2) 内置组件能被找到
(Invoke-RestMethod http://127.0.0.1:8835/api/adapters/wechat/status).env.path
# 期望：...\dist\backend\bin\wechat-cli\wechat-cli.exe

# 3) 群列表能读（证明组件可用）
(Invoke-RestMethod http://127.0.0.1:8835/api/adapters/wechat/groups).code
# 期望：OK

# 4) 打包后的应用能拉起后端
#    启动 app\dist\win-unpacked\app.exe，然后看日志
Get-Content "$env:APPDATA\CampusAssistant\main.log" -Tail 20
# 期望包含：[backend] starting: ...\resources\backend\campus-assistant-server.exe
#           [backend] healthy on port xxxx
```

## 五、已知限制

| 项 | 说明 |
|---|---|
| 安装包体积 | win-unpacked ≈ 465 MB（Electron 195 MB + 后端 12 MB + 组件 29 MB + 其余） |
| NSIS 安装包 | 需要额外下载 winCodeSign/nsis，网络受限时只能出 win-unpacked 目录 |
| Chromium | 小雅功能依赖 Playwright，**未内置**，首次使用需下载（约 150 MB） |
| 微信监听 | 内置的是组件本体，但仍需用户本机有微信 4.x 并完成一次 `init`（提密钥） |
| 代码签名 | 未签名，Windows SmartScreen 会提示"未知发布者" |
