# 构建 Android APK（debug 包，可直接安装）
#
# 用法：powershell -ExecutionPolicy Bypass -File tools\dev\build-apk.ps1
#
# 需要：JDK 21（脚本会用 D:\Android\jdk21）、Android SDK（D:\Android\Sdk）

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$mobile = Join-Path $root 'mobile'
$android = Join-Path $mobile 'android'

$env:JAVA_HOME = 'D:\Android\jdk21'
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:ANDROID_SDK_ROOT = 'D:\Android\Sdk'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host '1/3 构建前端…' -ForegroundColor Cyan
Push-Location $mobile
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }

Write-Host '2/3 同步到 Android 工程…' -ForegroundColor Cyan
npx cap sync android
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Pop-Location

Write-Host '3/3 编译 APK…' -ForegroundColor Cyan
Push-Location $android
cmd /c "gradlew.bat assembleDebug --no-daemon"
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Pop-Location

$apk = Join-Path $android 'app\build\outputs\apk\debug\app-debug.apk'
$dest = Join-Path $mobile 'dist-apk\CampusAssistant-mobile-debug.apk'
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
Copy-Item $apk $dest -Force

$hash = (Get-FileHash $dest -Algorithm SHA256).Hash
Write-Host ''
Write-Host 'APK 构建完成' -ForegroundColor Green
Write-Host "  路径: $dest"
Write-Host "  大小: $([math]::Round((Get-Item $dest).Length / 1MB, 1)) MB"
Write-Host "  SHA256: $hash"
