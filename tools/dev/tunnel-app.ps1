# 起隧道，指向「桌面 App 自己的后端」
#
# 用途：只保留一个后端（App 内置的那个），避免两个 worker 抢 AI 额度。
# 端口从 App 的日志里读，App 重启后端口变了也能自动找到。

param(
    [string]$LogPath = (Join-Path $env:APPDATA 'CampusAssistant\main.log')
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$exe = Join-Path $PSScriptRoot 'cloudflared.exe'
if (-not (Test-Path $exe)) {
    Write-Host '下载 cloudflared…' -ForegroundColor Yellow
    Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $exe -TimeoutSec 180
}

# 从日志里找最后一次出现的 backend port=NNNN
$port = $null
if (Test-Path $LogPath) {
    $line = Get-Content $LogPath -ErrorAction SilentlyContinue |
        Select-String -Pattern 'backend port=(\d+)' |
        Select-Object -Last 1
    if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}
if (-not $port) {
    Write-Host '没在日志里找到后端端口，请先启动桌面 App。' -ForegroundColor Red
    exit 1
}

Write-Host "App 后端端口: $port" -ForegroundColor Cyan
try {
    $null = Invoke-WebRequest "http://127.0.0.1:$port/api/health" -TimeoutSec 5 -UseBasicParsing
} catch {
    Write-Host "端口 $port 没有响应，App 可能已经退出。" -ForegroundColor Red
    exit 1
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

Write-Host '正在建立隧道…' -ForegroundColor Cyan
& $exe tunnel --url "http://127.0.0.1:$port" --no-autoupdate
