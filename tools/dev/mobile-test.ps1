# 一键启动手机测试环境（仅测试用）
#
# 做四件事：
#   1. 启动后端（0.0.0.0:8765，带本机密钥）
#   2. 起 Cloudflare 临时隧道
#   3. 生成一个配对码
#   4. 打印「手机要打开的地址 + 配对码」
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\dev\mobile-test.ps1
#   powershell -ExecutionPolicy Bypass -File tools\dev\mobile-test.ps1 -Ttl 3600
#
# 关闭：在这个窗口按 Ctrl+C

param(
    [int]$Port = 8765,
    [int]$Ttl = 1800
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$serverDir = Join-Path $root 'server'
$cfExe = Join-Path $PSScriptRoot 'cloudflared.exe'
$tokenFile = Join-Path $PSScriptRoot '.admin-token'

# ---------- 1. 本机密钥（持久化，脚本和桌面端都能用同一个） ----------
if (Test-Path $tokenFile) {
    $token = (Get-Content $tokenFile -Raw).Trim()
} else {
    $bytes = New-Object byte[] 24
    # PS 5.1（.NET Framework）没有 RandomNumberGenerator.Fill，用 GetBytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
    Set-Content -LiteralPath $tokenFile -Value $token -Encoding ascii
    Write-Host '已生成并保存本机密钥到 tools\dev\.admin-token' -ForegroundColor DarkGray
}

# ---------- 2. 找 Python ----------
$candidates = @(
    (Join-Path $root 'server\.venv\Scripts\python.exe'),
    (Join-Path $env:USERPROFILE '.workbuddy\binaries\python\envs\campus-assistant\Scripts\python.exe')
)
$python = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $python) {
    Write-Host '找不到 Python，无法启动后端。' -ForegroundColor Red
    exit 1
}

# ---------- 3. 后端 ----------
function Test-Backend {
    try {
        $null = Invoke-RestMethod "http://127.0.0.1:$Port/api/sync/health" `
            -Headers @{ 'X-Admin-Token' = $token } -TimeoutSec 3
        return $true
    } catch {
        return $false
    }
}

if (Test-Backend) {
    Write-Host "后端已在 $Port 运行" -ForegroundColor Green
} else {
    Write-Host '启动后端…' -ForegroundColor Yellow
    Start-Process -FilePath $python `
        -ArgumentList 'main.py', '--port', "$Port", '--host', '0.0.0.0', '--admin-token', $token `
        -WorkingDirectory $serverDir -WindowStyle Hidden | Out-Null

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Backend) { break }
        Write-Host '.' -NoNewline
    }
    if (-not (Test-Backend)) {
        Write-Host "`n后端启动失败，检查 $serverDir 下的日志。" -ForegroundColor Red
        exit 1
    }
    Write-Host "`n后端已就绪" -ForegroundColor Green
}

# ---------- 4. 隧道 ----------
if (-not (Test-Path $cfExe)) {
    Write-Host '下载 cloudflared…' -ForegroundColor Yellow
    Invoke-WebRequest `
        'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
        -OutFile $cfExe -TimeoutSec 180
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

$outLog = Join-Path $env:TEMP 'ca-tunnel.out.log'
$errLog = Join-Path $env:TEMP 'ca-tunnel.err.log'
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

$cf = Start-Process -FilePath $cfExe `
    -ArgumentList 'tunnel', '--url', "http://127.0.0.1:$Port", '--no-autoupdate' `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog

$publicUrl = ''
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $log = (Get-Content $outLog -ErrorAction SilentlyContinue) + (Get-Content $errLog -ErrorAction SilentlyContinue)
    $m = $log | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) {
        $publicUrl = $m.Matches[0].Value
        break
    }
}

if (-not $publicUrl) {
    Write-Host '隧道没拿到地址，看日志：' -ForegroundColor Red
    Get-Content $errLog -ErrorAction SilentlyContinue | Select-Object -Last 10
    exit 1
}

# ---------- 5. 配对码 ----------
$codeResp = Invoke-RestMethod "http://127.0.0.1:$Port/api/pair/code?ttl=$Ttl" `
    -Method Post -Headers @{ 'X-Admin-Token' = $token } -TimeoutSec 10

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' 手机打开这个地址' -ForegroundColor Cyan
Write-Host "   $publicUrl/m/" -ForegroundColor White
Write-Host ''
Write-Host ' 配对码（如果要求配对才用）' -ForegroundColor Cyan
Write-Host "   $($codeResp.code)    有效期 $([math]::Round($Ttl / 60)) 分钟" -ForegroundColor White
Write-Host ''
Write-Host " 本机密钥已保存在 tools\dev\.admin-token" -ForegroundColor DarkGray
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '按 Ctrl+C 结束隧道（结束后地址失效）' -ForegroundColor DarkGray

try {
    Wait-Process -Id $cf.Id
} finally {
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host '隧道已关闭' -ForegroundColor DarkGray
}
