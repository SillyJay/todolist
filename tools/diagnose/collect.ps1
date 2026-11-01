<#
.SYNOPSIS
    CampusAssistant 诊断收集器（打包版专用）。

.DESCRIPTION
    在「已经打开 CampusAssistant」的机器上运行，收集：
      - 系统/权限/进程/端口
      - 微信安装路径、版本、进程
      - 内置 wechat-cli 版本与密钥文件状态（不读内容）
      - 主动执行一次 init 并把完整输出记下来（定位密钥提取失败）
      - main.log 全量 + 运行期间的实时时间线
    最后在桌面生成一个 zip，发给开发者即可。

    隐私：不收集 Cookie、密钥内容、聊天正文；日志里「已入库：标题」默认打码。

.PARAMETER Minutes
    监控时长（分钟）。默认 5；传 0 表示只收集不监控。

.PARAMETER Full
    保留日志里的任务标题（默认打码）。仅在开发者明确要求时使用。

.PARAMETER NoProbe
    不主动执行 wechat-cli init（只看现状，不做任何写入）。

.EXAMPLE
    .\collect.ps1                 # 收集 + 监控 5 分钟
    .\collect.ps1 -Minutes 0      # 只收集
#>
param(
    [int]$Minutes = 5,
    [switch]$Full,
    [switch]$NoProbe,
    [switch]$ForceInit
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$hostName = $env:COMPUTERNAME
$outDir = Join-Path ([Environment]::GetFolderPath('Desktop')) ("CampusAssistant-诊断-$hostName-$stamp")
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Write-Section($file, $title) {
    $line = "`r`n===== $title =====`r`n"
    Add-Content -LiteralPath (Join-Path $outDir $file) -Value $line -Encoding UTF8
}

# 用 Start-Process + 重定向文件：PowerShell 5.1 没有 ProcessStartInfo.ArgumentList，
# 必须走这条才能在 5.1 / 7 上都能跑。
# 用 .NET Process 直接起进程：
#   - PS 5.1 的 Start-Process + 重定向拿不到 ExitCode（实测为 $null）
#   - ProcessStartInfo.ArgumentList 只有 .NET Core 有，5.1 只能用 Arguments 字符串
function Dump-Command($file, $title, $cmd, $argList, $timeoutSec = 60) {
    $path = Join-Path $outDir $file
    Write-Section $file $title
    try {
        $parts = @()
        foreach ($a in $argList) {
            $s = [string]$a
            if ($s -match '[\s"]') { $parts += ('"' + ($s -replace '"', '\"') + '"') } else { $parts += $s }
        }
        $argStr = $parts -join ' '

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $cmd
        $psi.Arguments = $argStr
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        # wechat-cli 输出是 UTF-8；中文系统默认按 GBK 读会变乱码，这里显式指定
        $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
        $psi.StandardErrorEncoding = [Text.Encoding]::UTF8

        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $soTask = $proc.StandardOutput.ReadToEndAsync()
        $seTask = $proc.StandardError.ReadToEndAsync()

        $code = ''
        if (-not $proc.WaitForExit($timeoutSec * 1000)) {
            try { $proc.Kill() } catch {}
            $code = 'timeout'
            "（超时 ${timeoutSec}s，已终止）" | Add-Content -LiteralPath $path -Encoding UTF8
        } else {
            $code = $proc.ExitCode
        }
        $so = ''
        $se = ''
        try { $so = $soTask.Result } catch {}
        try { $se = $seTask.Result } catch {}

        "exit_code = $code" | Add-Content -LiteralPath $path -Encoding UTF8
        '--- stdout ---' | Add-Content -LiteralPath $path -Encoding UTF8
        if ($so) { $so.TrimEnd() | Add-Content -LiteralPath $path -Encoding UTF8 }
        '--- stderr ---' | Add-Content -LiteralPath $path -Encoding UTF8
        if ($se) { $se.TrimEnd() | Add-Content -LiteralPath $path -Encoding UTF8 }
    } catch {
        "调用失败: $($_.Exception.Message)" | Add-Content -LiteralPath $path -Encoding UTF8
    }
}
# 只把输出拿回来、不落盘：用于可能包含聊天内容的命令（sessions）
function Invoke-Capture($cmd, $argList, $timeoutSec = 60) {
    $result = @{ code = ''; out = ''; err = '' }
    try {
        $parts = @()
        foreach ($a in $argList) {
            $s = [string]$a
            if ($s -match '[\s"]') { $parts += ('"' + ($s -replace '"', '\"') + '"') } else { $parts += $s }
        }
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $cmd
        $psi.Arguments = ($parts -join ' ')
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $soTask = $proc.StandardOutput.ReadToEndAsync()
        $seTask = $proc.StandardError.ReadToEndAsync()
        if (-not $proc.WaitForExit($timeoutSec * 1000)) {
            try { $proc.Kill() } catch {}
            $result.code = 'timeout'
        } else {
            $result.code = $proc.ExitCode
        }
        try { $result.out = $soTask.Result } catch {}
        try { $result.err = $seTask.Result } catch {}
    } catch {
        $result.err = $_.Exception.Message
    }
    return $result
}
# ---------- 1. 系统信息 ----------
Write-Host '[1/8] 收集系统信息…'
$sys = Join-Path $outDir '01-系统.txt'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$isAdmin = $false
try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    $isAdmin = $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {}

@(
    "采集时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "计算机名: $hostName",
    "用户: $($env:USERDOMAIN)\$($env:USERNAME)",
    "管理员权限: $isAdmin",
    "系统: $($os.Caption) $($os.Version) build $($os.BuildNumber)",
    "架构: $($os.OSArchitecture)",
    "制造商/型号: $($cs.Manufacturer) / $($cs.Model)",
    "内存: $([math]::Round($cs.TotalPhysicalMemory/1GB,1)) GB",
    "区域: $((Get-Culture).Name)  代码页: $([Console]::OutputEncoding.CodePage)  界面语言: $((Get-UICulture).DisplayName)",
    "PowerShell: $($PSVersionTable.PSVersion)",
    "是否为虚拟机(推测): $($cs.Model -match 'Virtual|VMware|VirtualBox|KVM')"
) | Set-Content -LiteralPath $sys -Encoding UTF8

# ---------- 2. 应用与进程 ----------
Write-Host '[2/8] 收集应用与进程…'
$appFile = Join-Path $outDir '02-应用与进程.txt'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appCandidates = @(
    (Join-Path (Split-Path -Parent $scriptDir) 'CampusAssistant\app.exe'),
    (Join-Path (Split-Path -Parent $scriptDir) 'app.exe'),
    'C:\Users\Public\Desktop\CampusAssistant\app.exe'
)
$appProc = Get-CimInstance Win32_Process -Filter "Name='app.exe'" -ErrorAction SilentlyContinue
$appExe = $null
# 优先从正在运行的进程反推（安装位置千奇百怪，Desktop\currently\... 这种很常见）
if ($appProc) {
    foreach ($ap in @($appProc)) { if ($ap.ExecutablePath -and (Test-Path $ap.ExecutablePath)) { $appExe = $ap.ExecutablePath; break } }
}
if (-not $appExe) {
    foreach ($c in $appCandidates) { if (Test-Path $c) { $appExe = $c; break } }
}

@(
    "脚本目录: $scriptDir",
    "检测到的程序: $(if ($appExe) { $appExe } else { '未在预期位置找到（可从任务管理器查看 app.exe 路径）' })",
    "app.exe 版本: $(if ($appExe) { (Get-Item $appExe).VersionInfo.FileVersion } else { '未知' })",
    "app.exe 进程数: $(@($appProc).Count)"
) | Set-Content -LiteralPath $appFile -Encoding UTF8

if ($appProc) {
    '--- app.exe 进程 ---' | Add-Content -LiteralPath $appFile -Encoding UTF8
    $appProc | ForEach-Object { "PID=$($_.ProcessId)  $($_.ExecutablePath)" } | Add-Content -LiteralPath $appFile -Encoding UTF8
}

$backend = Get-CimInstance Win32_Process -Filter "Name='campus-assistant-server.exe'" -ErrorAction SilentlyContinue
@(
    '',
    "后端进程数: $(@($backend).Count)"
) | Add-Content -LiteralPath $appFile -Encoding UTF8
if ($backend) { $backend | ForEach-Object { "PID=$($_.ProcessId)  $($_.ExecutablePath)" } | Add-Content -LiteralPath $appFile -Encoding UTF8 }

'--- 监听端口 8700-8799 ---' | Add-Content -LiteralPath $appFile -Encoding UTF8
try {
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -ge 8700 -and $_.LocalPort -le 8799 } |
        ForEach-Object { "port=$($_.LocalPort) pid=$($_.OwningProcess)" } |
        Add-Content -LiteralPath $appFile -Encoding UTF8
} catch { '（读取端口失败）' | Add-Content -LiteralPath $appFile -Encoding UTF8 }

# ---------- 3. 微信 ----------
Write-Host '[3/8] 收集微信信息…'
$wxFile = Join-Path $outDir '03-微信.txt'
$wxKeys = @(
    @('HKCU', 'Software\Tencent\Weixin'),
    @('HKLM', 'SOFTWARE\Tencent\Weixin'),
    @('HKLM', 'SOFTWARE\WOW6432Node\Tencent\Weixin'),
    @('HKCU', 'Software\Tencent\WeChat'),
    @('HKLM', 'SOFTWARE\Tencent\WeChat'),
    @('HKLM', 'SOFTWARE\WOW6432Node\Tencent\WeChat')
)
$wxLines = New-Object System.Collections.ArrayList
[void]$wxLines.Add("采集时间: $(Get-Date -Format 'HH:mm:ss')")
foreach ($k in $wxKeys) {
    $p = $null
    try {
        $p = (Get-ItemProperty -Path ("{0}:\{1}" -f $k[0], $k[1]) -ErrorAction Stop).InstallPath
    } catch {}
    if ($p) { [void]$wxLines.Add("注册表 $($k[0])\$($k[1]) -> $p") }
}
$wxProcs = Get-CimInstance Win32_Process -Filter "Name='Weixin.exe' OR Name='WeChat.exe'" -ErrorAction SilentlyContinue
[void]$wxLines.Add("微信进程数: $(@($wxProcs).Count)")
if ($wxProcs) {
    $exe = @($wxProcs)[0].ExecutablePath
    [void]$wxLines.Add("微信路径: $exe")
    if ($exe -and (Test-Path $exe)) {
        [void]$wxLines.Add("微信版本: $((Get-Item $exe).VersionInfo.FileVersion)")
    }
    foreach ($wp in $wxProcs) { [void]$wxLines.Add("  PID=$($wp.ProcessId) 启动=$($wp.CreationDate)") }
    [void]$wxLines.Add("窗口标题: $((Get-Process -Id (@($wxProcs)[0].ProcessId) -ErrorAction SilentlyContinue).MainWindowTitle)")
} else {
    [void]$wxLines.Add('未检测到微信进程（请确认微信已登录并保持窗口打开）')
}
$wxLines | Set-Content -LiteralPath $wxFile -Encoding UTF8

# ---------- 3b. 微信数据目录探测 ----------
Write-Host '[3b] 探测微信数据目录…'
$dbFile = Join-Path $outDir '03b-数据目录.txt'
$dbLines = New-Object System.Collections.ArrayList
$docs = $null
try {
    $docs = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop).Personal
    if ($docs) { $docs = [Environment]::ExpandEnvironmentVariables($docs) }
} catch {}
if (-not $docs) { $docs = Join-Path $env:USERPROFILE 'Documents' }
[void]$dbLines.Add("Documents 目录: $docs")

$roots = New-Object System.Collections.ArrayList
[void]$roots.Add((Join-Path $docs 'xwechat_files'))
if ($wxProcs) {
    $wxExe0 = @($wxProcs)[0].ExecutablePath
    if ($wxExe0) {
        $inst = Split-Path -Parent $wxExe0
        [void]$roots.Add((Join-Path $inst 'xwechat_files'))
        [void]$roots.Add((Join-Path (Split-Path -Parent $inst) 'xwechat_files'))
    }
}
foreach ($letter in @('C','D','E','F','G','H')) {
    [void]$roots.Add((Join-Path "${letter}:\" 'xwechat_files'))
    [void]$roots.Add((Join-Path "${letter}:\System\Documents" 'xwechat_files'))
    [void]$roots.Add((Join-Path "${letter}:\Documents" 'xwechat_files'))
}

$detected = ''
$seenRoots = @{}
foreach ($r in $roots) {
    if ($seenRoots.ContainsKey($r)) { continue }
    $seenRoots[$r] = $true
    if (-not (Test-Path $r)) { continue }
    $subs = Get-ChildItem $r -Directory -ErrorAction SilentlyContinue
    foreach ($s in $subs) {
        if (Test-Path (Join-Path $s.FullName 'db_storage')) {
            [void]$dbLines.Add("命中: $r")
            [void]$dbLines.Add("   wxid 目录: $($s.FullName)")
            if (-not $detected) { $detected = $s.FullName }
        }
    }
}
if ($detected) {
    [void]$dbLines.Add("将使用: $detected")
} else {
    [void]$dbLines.Add('未探测到。请让用户在 微信 → 设置 → 文件管理 里查看保存位置，或在 App 设置里手动指定。')
}

$cliCfg = Join-Path $env:USERPROFILE '.wechat-cli\config.json'
if (Test-Path $cliCfg) {
    [void]$dbLines.Add('wechat-cli 现有配置: ' + (Get-Content $cliCfg -Raw -Encoding UTF8))
}
$dbLines | Set-Content -LiteralPath $dbFile -Encoding UTF8
# ---------- 4. wechat-cli 组件 ----------
Write-Host '[4/8] 收集 wechat-cli 组件信息…'
$cliFile = Join-Path $outDir '04-组件.txt'
$cliCandidates = @()
if ($appExe) {
    $cliCandidates += (Join-Path (Split-Path -Parent $appExe) 'resources\backend\bin\wechat-cli\wechat-cli.exe')
}
$cliCandidates += (Join-Path $env:USERPROFILE '.workbuddy\binaries\python\envs\campus-assistant\Scripts\wechat-cli.exe')
$cliCandidates += 'D:\projects\campus-assistant-merged\server\dist\backend\bin\wechat-cli\wechat-cli.exe'
$cliExe = $null
foreach ($c in $cliCandidates) { if (Test-Path $c) { $cliExe = $c; break } }
if (-not $cliExe) {
    $w = & where.exe wechat-cli 2>$null
    if ($LASTEXITCODE -eq 0 -and $w) { $cliExe = @($w)[0] }
}
@(
    "组件路径: $(if ($cliExe) { $cliExe } else { '未找到' })",
    "检查过的路径:",
    ($cliCandidates -join "`r`n")
) | Set-Content -LiteralPath $cliFile -Encoding UTF8
if ($cliExe) {
    Dump-Command '04-组件.txt' 'wechat-cli --version' $cliExe @('--version') 30 | Out-Null
}

# ---------- 5. 密钥状态与 init 实测 ----------
Write-Host '[5/8] 检查密钥并实测 init（最多 4 分钟）…'
$keyFile = Join-Path $outDir '05-密钥与初始化.txt'
$keysPath = Join-Path $env:USERPROFILE '.wechat-cli\all_keys.json'
$markerPath = Join-Path $env:USERPROFILE '.wechat-cli\campus_backfill.json'
$initLines = New-Object System.Collections.ArrayList
[void]$initLines.Add("管理员权限: $isAdmin")
if (-not $isAdmin) {
    [void]$initLines.Add('  ！当前不是管理员：几乎必然读不到密钥，请右键以「以管理员身份运行」重新打开 app 与诊断脚本')
}
if (Test-Path $keysPath) {
    $ki = Get-Item $keysPath
    [void]$initLines.Add("密钥文件: 存在，$($ki.Length) 字节，修改时间 $($ki.LastWriteTime)")
} else {
    [void]$initLines.Add('密钥文件: 不存在（说明从未成功提取过）')
}
if (Test-Path $markerPath) { [void]$initLines.Add("回补标记: 存在 ($((Get-Item $markerPath).Length) 字节)") } else { [void]$initLines.Add('回补标记: 不存在') }
$initLines | Set-Content -LiteralPath $keyFile -Encoding UTF8

if ($cliExe -and -not $NoProbe) {
    $initArgs = @('init')
    if ($detected) { $initArgs += @('--db-dir', $detected) }
    if ($ForceInit) { $initArgs += '--force' }
    Write-Host ('      正在执行 wechat-cli ' + ($initArgs -join ' ') + '（可能需要几分钟）…')
    $initRes = Invoke-Capture $cliExe $initArgs 240
    Write-Section '05-密钥与初始化.txt' ('wechat-cli ' + ($initArgs -join ' ') + '（实测）')
    "exit_code = $($initRes.code)" | Add-Content -LiteralPath $keyFile -Encoding UTF8
    '--- stdout ---' | Add-Content -LiteralPath $keyFile -Encoding UTF8
    if ($initRes.out) { $initRes.out.TrimEnd() | Add-Content -LiteralPath $keyFile -Encoding UTF8 }
    '--- stderr ---' | Add-Content -LiteralPath $keyFile -Encoding UTF8
    if ($initRes.err) { $initRes.err.TrimEnd() | Add-Content -LiteralPath $keyFile -Encoding UTF8 }

    if (Test-Path $keysPath) {
        "init 后密钥文件: 存在 ($((Get-Item $keysPath).Length) 字节)" | Add-Content -LiteralPath $keyFile -Encoding UTF8
    } else {
        'init 后密钥文件: 仍不存在 → 提取失败' | Add-Content -LiteralPath $keyFile -Encoding UTF8
    }

    # 注意：sessions 的 JSON 里含群名、发送人、聊天正文。
    # 这里只记录「能不能解析、有几条」，绝不把内容写进报告。
    Write-Host '      正在验证密钥是否可用（不记录聊天内容）…'
    $sessRes = Invoke-Capture $cliExe @('sessions', '--limit', '1') 60
    Write-Section '05-密钥与初始化.txt' 'wechat-cli sessions（仅统计，不含内容）'
    "exit_code = $($sessRes.code)" | Add-Content -LiteralPath $keyFile -Encoding UTF8
    $parsed = $null
    try { $parsed = $sessRes.out | ConvertFrom-Json -ErrorAction Stop } catch {}
    if ($null -ne $parsed) {
        $count = @($parsed).Count
        "JSON 可解析: 是，返回 $count 条" | Add-Content -LiteralPath $keyFile -Encoding UTF8
        if ($count -gt 0) {
            $first = @($parsed)[0]
            "首条字段: is_group=$($first.is_group)  unread=$($first.unread)  (群名/发送人/正文已省略)" | Add-Content -LiteralPath $keyFile -Encoding UTF8
        }
    } else {
        "JSON 可解析: 否（输出长度 $($sessRes.out.Length) 字符，内容已省略）" | Add-Content -LiteralPath $keyFile -Encoding UTF8
        if ($sessRes.err) {
            '--- stderr ---' | Add-Content -LiteralPath $keyFile -Encoding UTF8
            $sessRes.err.TrimEnd() | Add-Content -LiteralPath $keyFile -Encoding UTF8
        }
    }
} elseif ($NoProbe) {
    '（按参数要求跳过 init 实测）' | Add-Content -LiteralPath $keyFile -Encoding UTF8
}

# ---------- 6. 应用日志 ----------
Write-Host '[6/8] 复制应用日志…'
$logPath = Join-Path $env:APPDATA 'CampusAssistant\main.log'
$logOut = Join-Path $outDir '06-日志-main.txt'
if (Test-Path $logPath) {
    $lines = Get-Content -LiteralPath $logPath -Encoding UTF8 -Tail 1200
    if (-not $Full) {
        $lines = $lines | ForEach-Object {
            if ($_ -match '已入库：') { ($_ -replace '已入库：.*$', '已入库：***') } else { $_ }
        }
    }
    $lines | Set-Content -LiteralPath $logOut -Encoding UTF8
    "（来源：$logPath，总大小 $((Get-Item $logPath).Length) 字节，已取最后 1200 行）" | Add-Content -LiteralPath $logOut -Encoding UTF8
} else {
    "未找到日志文件：$logPath" | Set-Content -LiteralPath $logOut -Encoding UTF8
}

$eLogDir = Join-Path $env:APPDATA 'campus-assistant'
$eOut = Join-Path $outDir '07-日志-electron.txt'
$eLines = New-Object System.Collections.ArrayList
if (Test-Path $eLogDir) {
    Get-ChildItem $eLogDir -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object {
        [void]$eLines.Add("--- $($_.FullName) ---")
        [void]$eLines.AddRange(@(Get-Content -LiteralPath $_.FullName -Encoding UTF8 -Tail 500))
    }
}
if ($eLines.Count -eq 0) { [void]$eLines.Add('（无 Electron 侧日志）') }
$eLines | Set-Content -LiteralPath $eOut -Encoding UTF8

# ---------- 7. 时间线监控 ----------
$tlFile = Join-Path $outDir '08-运行时间线.txt'
"[$(Get-Date -Format 'HH:mm:ss')] 开始监控，时长 $Minutes 分钟" | Set-Content -LiteralPath $tlFile -Encoding UTF8
if ($Minutes -gt 0) {
    Write-Host "[7/8] 开始监控 $Minutes 分钟（请正常操作软件，复现问题）…"
    $pos = 0
    if (Test-Path $logPath) { $pos = (Get-Item $logPath).Length }
    $lastSnapshot = ''
    $endAt = (Get-Date).AddMinutes($Minutes)
    while ((Get-Date) -lt $endAt) {
        # 新增日志
        if (Test-Path $logPath) {
            try {
                $fs = [IO.File]::Open($logPath, 'Open', 'Read', 'ReadWrite')
                if ($fs.Length -gt $pos) {
                    [void]$fs.Seek($pos, 'Begin')
                    $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
                    $chunk = $sr.ReadToEnd()
                    $pos = $fs.Position
                    $sr.Close()
                    foreach ($ln in ($chunk -split "`r?`n")) {
                        if (-not $ln) { continue }
                        if (-not $Full -and $ln -match '已入库：') { $ln = ($ln -replace '已入库：.*$', '已入库：***') }
                        "[$(Get-Date -Format 'HH:mm:ss')] $ln" | Add-Content -LiteralPath $tlFile -Encoding UTF8
                    }
                }
                $fs.Close()
            } catch {}
        }
        # 进程快照
        $snap = @()
        $snap += 'app=' + (@(Get-Process -Name app -ErrorAction SilentlyContinue).Count)
        $snap += 'backend=' + (@(Get-Process -Name campus-assistant-server -ErrorAction SilentlyContinue).Count)
        $snap += 'weixin=' + (@(Get-Process -Name Weixin, WeChat -ErrorAction SilentlyContinue).Count)
        $snapStr = $snap -join ' '
        if ($snapStr -ne $lastSnapshot) {
            "[$(Get-Date -Format 'HH:mm:ss')] [进程] $snapStr" | Add-Content -LiteralPath $tlFile -Encoding UTF8
            $lastSnapshot = $snapStr
        }
        Start-Sleep -Seconds 2
    }
    "[$(Get-Date -Format 'HH:mm:ss')] 监控结束" | Add-Content -LiteralPath $tlFile -Encoding UTF8
} else {
    '（未启用监控）' | Add-Content -LiteralPath $tlFile -Encoding UTF8
}

# ---------- 8. 说明与打包 ----------
Write-Host '[8/8] 生成说明并打包…'
$readme = Join-Path $outDir 'README.txt'
@'
CampusAssistant 诊断包
======================

包含内容
--------
01-系统.txt          系统版本、用户、是否管理员、区域设置
02-应用与进程.txt     app.exe / 后端的进程路径、版本、监听端口
03-微信.txt          微信安装路径（注册表）、版本、进程、窗口标题
04-组件.txt          wechat-cli 组件位置与版本
05-密钥与初始化.txt   密钥文件是否存在 + 一次真实 init 的完整输出（定位失败原因）
06-日志-main.txt     应用主日志（最后 3000 行）
07-日志-electron.txt Electron 侧日志
08-运行时间线.txt     监控期间的应用操作时间线（日志新增 + 进程变化）

没有收集什么
------------
- 没有 Cookie、没有密钥内容（只检查密钥文件是否存在）
- 没有聊天正文、没有任务标题（日志里的标题已打码）
- 没有截图、没有账号密码

怎么用
------
把整个 zip 发给开发者即可。

如果开发者需要更详细的信息，可以再用 -Full 参数重新跑一次
（会在日志中保留任务标题），或延长监控时长：
    collect.bat 10
'@ | Set-Content -LiteralPath $readme -Encoding UTF8

$zip = "$outDir.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zip -CompressionLevel Optimal

Write-Host ''
Write-Host '============================================'
Write-Host ' 收集完成'
Write-Host " 文件夹: $outDir"
Write-Host " 压缩包: $zip"
Write-Host ' 把这个 zip 发给开发者即可'
Write-Host '============================================'
