# 仅测试用：生成一个手机配对码
#
# 正常流程是在桌面 App「设置 → 同步 → 手机配对」点按钮生成。
# 这个脚本用于：后端是用命令行/开发模式起的，或者你只想快速拿一个码。

param(
    [Parameter(Mandatory = $true)]
    [string]$AdminToken,
    [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
# 控制台按 UTF-8 输出，避免中文变乱码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $r = Invoke-RestMethod `
        "http://127.0.0.1:$Port/api/pair/code" `
        -Method Post `
        -Headers @{ 'X-Admin-Token' = $AdminToken } `
        -TimeoutSec 10
} catch {
    Write-Host "请求失败：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host '检查后端是否在跑，以及 AdminToken 是否正确。' -ForegroundColor DarkGray
    exit 1
}

if (-not $r.ok) {
    Write-Host "生成失败：$($r.message)" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host ("  配对码   {0}" -f $r.code) -ForegroundColor Green
Write-Host ("  有效期   {0}" -f $r.expires_at) -ForegroundColor DarkGray
Write-Host ('  手机打开 https://<隧道地址>/m/?pair=1，输入上面的 6 位码') -ForegroundColor Cyan
Write-Host ''
