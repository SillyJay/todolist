<#
.SYNOPSIS
    构建可随安装包分发的后端与组件（PyInstaller）。

.DESCRIPTION
    产物：
      server\dist\campus-assistant-server.exe      后端服务（单文件）
      server\dist\bin\wechat-cli\wechat-cli.exe    微信监听组件（单文件，可选）

    随后 `npm run build:win` 会通过 electron-builder.yml 的 extraResources
    把这两个文件塞进安装包的 resources\backend\ 下。

.PARAMETER SkipWechat
    跳过 wechat-cli 构建（没装该包时必须加）。

.PARAMETER Py
    指定 Python 解释器（默认自动探测 venv / 托管运行时）。

.EXAMPLE
    .\build-backend.ps1
    .\build-backend.ps1 -SkipWechat
#>
param(
    [switch]$SkipWechat,
    [string]$Py = ""
)

# 注意：这里必须用 Continue。PS 5.1 在 ErrorActionPreference=Stop 时会把
# 原生命令写到 stderr 的内容（比如 python 的 ImportError）当成终止错误。
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root "server"

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }

function Test-PyModule($module) {
    & $Py -c "import $module" *> $null
    return ($LASTEXITCODE -eq 0)
}

# ---------- 1. 选解释器 ----------
Write-Step "选择 Python 解释器"
if (-not $Py) {
    $candidates = @(
        $env:BACKEND_PYTHON,
        (Join-Path $server ".venv\Scripts\python.exe"),
        (Join-Path $env:USERPROFILE ".workbuddy\binaries\python\envs\campus-assistant\Scripts\python.exe")
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { $Py = $c; break }
    }
    if (-not $Py) {
        $cmd = Get-Command python -ErrorAction SilentlyContinue
        if ($cmd) { $Py = $cmd.Source }
    }
}
if (-not $Py -or -not (Test-Path $Py)) {
    Write-Host "找不到 Python 解释器。请用 -Py 指定，或先创建 venv。" -ForegroundColor Red
    exit 1
}
$ver = & $Py -c "import sys;print(sys.version.split()[0])"
Write-Ok "$Py (Python $ver)"

# ---------- 2. 检查 PyInstaller ----------
Write-Step "检查 PyInstaller"
if (-not (Test-PyModule "PyInstaller")) {
    Write-Warn2 "未安装 PyInstaller，尝试从镜像安装…"
    $mirrors = @(
        "https://pypi.tuna.tsinghua.edu.cn/simple",
        "https://mirrors.aliyun.com/pypi/simple",
        "https://pypi.org/simple"
    )
    $installed = $false
    foreach ($m in $mirrors) {
        Write-Host "  尝试：$m"
        & $Py -m pip install pyinstaller -i $m --timeout 20 *> $null
        if (Test-PyModule "PyInstaller") { $installed = $true; break }
    }
    if (-not $installed) {
        Write-Host ""
        Write-Host "无法自动安装 PyInstaller（网络受限）。请任选其一：" -ForegroundColor Red
        Write-Host "  1) 换一台能访问 pypi 的机器执行：$Py -m pip install pyinstaller"
        Write-Host "  2) 手动下载 wheel 后本地安装：pip install .\pyinstaller-*.whl"
        Write-Host "  3) 配置代理后重跑：`$env:HTTPS_PROXY='http://127.0.0.1:7890'; .\build-backend.ps1"
        exit 1
    }
}
$piVer = (& $Py -m PyInstaller --version 2>&1 | Select-Object -Last 1)
Write-Ok "PyInstaller $piVer"

# ---------- 3. 构建后端 ----------
Write-Step "构建后端 campus-assistant-server.exe"
Push-Location $server
& $Py -m PyInstaller --noconfirm --clean campus_server.spec
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) {
    Write-Host "后端构建失败（PyInstaller 返回 $code）" -ForegroundColor Red
    exit 1
}
$serverDir = Join-Path $server "dist\campus-assistant-server"
$serverExe = Join-Path $serverDir "campus-assistant-server.exe"
if (-not (Test-Path $serverExe)) {
    Write-Host "未生成 $serverExe" -ForegroundColor Red
    exit 1
}
$mb = [math]::Round(((Get-ChildItem $serverDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Write-Ok "dist\campus-assistant-server\ ($mb MB，onedir)"

# ---------- 4. 构建 wechat-cli ----------
if ($SkipWechat) {
    Write-Warn2 "已跳过 wechat-cli（-SkipWechat）"
} elseif (-not (Test-PyModule "wechat_cli")) {
    Write-Warn2 "当前环境没装 wechat_cli，跳过。需要时先 pip install 它的源码目录"
} else {
    Write-Step "构建 wechat-cli.exe"
    Push-Location $server
    & $Py -m PyInstaller --noconfirm --clean wechat_cli.spec
    $code2 = $LASTEXITCODE
    Pop-Location
    if ($code2 -ne 0) {
        Write-Host "wechat-cli 构建失败（返回 $code2）" -ForegroundColor Red
        exit 1
    }
    $binDir = Join-Path $server "dist\bin"
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    $src = Join-Path $server "dist\wechat-cli"
    $dst = Join-Path $binDir "wechat-cli"
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    Copy-Item $src $dst -Recurse -Force
    $mb2 = [math]::Round(((Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
    Write-Ok "bin\wechat-cli\ ($mb2 MB，onedir)"
}

# ---------- 5. 组装成与安装包一致的布局 ----------
# dist\backend\
#   ├─ campus-assistant-server.exe     ← 打包后位于 resources\backend\
#   ├─ _internal\
#   └─ bin\wechat-cli\wechat-cli.exe   ← find_cli 的 frozen 分支就找这里
Write-Step "组装 dist\backend（与安装包内布局一致）"
$backendDir = Join-Path $server "dist\backend"
if (Test-Path $backendDir) { Remove-Item $backendDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $backendDir | Out-Null
Copy-Item (Join-Path $server "dist\campus-assistant-server\*") $backendDir -Recurse -Force

$cliOut = Join-Path $server "dist\wechat-cli"
if (Test-Path $cliOut) {
    $binCli = Join-Path $backendDir "bin\wechat-cli"
    New-Item -ItemType Directory -Force -Path (Split-Path $binCli) | Out-Null
    Copy-Item $cliOut $binCli -Recurse -Force
}
Write-Ok "dist\backend 就绪"

# ---------- 6. 汇总 ----------
Write-Step "完成"
Write-Host "  后端：$backendDir"
$cli = Join-Path $backendDir "bin\wechat-cli\wechat-cli.exe"
if (Test-Path $cli) { Write-Host "  组件：$cli" }
Write-Host ""
Write-Host "下一步：cd app && npm run build:win" -ForegroundColor Cyan
