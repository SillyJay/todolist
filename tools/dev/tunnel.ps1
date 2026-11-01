# 仅测试用：Cloudflare 临时隧道
#
# 用途：校园网/公司网有客户端隔离，手机连不到电脑的 8765 端口时，
#       用 cloudflared 的「快速隧道」拿到一个临时公网地址，让手机能打开。
#
# 注意：这是**测试手段**，不是正式部署方案。正式方案见 docs/移动端测试隧道.md 结尾。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\dev\tunnel.ps1
#   （先确保后端已经在 8765 上跑着）

param(
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
# 控制台按 UTF-8 输出，避免中文变乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$exe = Join-Path $PSScriptRoot 'cloudflared.exe'

if (-not (Test-Path $exe)) {
    Write-Host '首次运行，下载 cloudflared…' -ForegroundColor Yellow
    Invoke-WebRequest `
        'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
        -OutFile $exe -TimeoutSec 180
    Write-Host ("下载完成: {0:N1} MB" -f ((Get-Item $exe).Length / 1MB)) -ForegroundColor Green
}

# 先确认后端在跑
try {
    $null = Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -TimeoutSec 5 -UseBasicParsing
} catch {
    Write-Host "后端没有在 127.0.0.1:$Port 上运行，请先启动 CampusAssistant（或 npm run dev）" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '正在建立隧道，等出现 https://xxx.trycloudflare.com 后：' -ForegroundColor Cyan
Write-Host '  手机打开  <地址>/m/?pair=1' -ForegroundColor Cyan
Write-Host '  配对码用  powershell -File tools\dev\pair-code.ps1 -AdminToken <密钥>' -ForegroundColor Cyan
Write-Host ''
Write-Host '按 Ctrl+C 结束隧道。地址每次重启都会变。' -ForegroundColor DarkGray
Write-Host ''

& $exe tunnel --url "http://127.0.0.1:$Port" --no-autoupdate
