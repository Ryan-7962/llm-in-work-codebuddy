# install-codebuddy.ps1 — LLM_in_Work × CodeBuddy Windows 一次性准备脚本
# 做四件事（全部 per-user，无需管理员）：
#   1) 把 API key 写入 %USERPROFILE%\.codebuddy\api.key（聊天 + 生图/修图/抠图都需要）
#   2) 部署跨平台 wrapper cbc-claude.js 到 %USERPROFILE%\.llm_in_codebuddy\
#   3) 探测 codebuddy CLI：优先用 WorkBuddy 自带的（装了 WorkBuddy 就有，无需另装），
#      其次独立版官方安装器 / npm 全局 / PATH；都没有时才提示装独立版
#   4) 写入用户级环境变量（CODEBUDDY_BIN + 三套件的 LLM_IN_*_CLAUDE_BIN）
# 之后【重新打开 PowerShell 窗口】再分别运行 LLM_in_Word/LLM_in_PowerPoint/LLM_in_Excel 目录里的 install.ps1。
[CmdletBinding()]
param(
    [string]$ApiKey,                       # 不传则交互式询问（也可提前放好 %USERPROFILE%\.codebuddy\api.key）
    [string]$CodebuddyBin,                 # 手动指定 codebuddy CLI 绝对路径（自动探测失败时用）
    [switch]$SkipCliInstall                # 找不到 CLI 时不代跑官方安装器（默认会先询问）
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw '本脚本仅用于 Windows。macOS 请参考 README。' }

Write-Host '== LLM_in_Work x CodeBuddy：Windows 环境准备 ==' -ForegroundColor Cyan

# ---- 0) Node 检查（bridge 服务与 install.ps1 都需要）----
$Node = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$Node) { throw '未找到 Node.js。请先安装 Node.js 22.12+ 或 24+（https://nodejs.org，LTS 版即可）。' }
Write-Host "[OK] Node.js: $($Node.Source)"

# ---- 1) API key（用 WorkBuddy 自带 CLI 时，聊天也依赖它）----
$KeyDir = Join-Path $env:USERPROFILE '.codebuddy'
$KeyFile = Join-Path $KeyDir 'api.key'
if ($ApiKey) {
    New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
    [IO.File]::WriteAllText($KeyFile, $ApiKey.Trim())
}
if (!(Test-Path $KeyFile) -or !(Get-Content $KeyFile -Raw).Trim()) {
    if (!$ApiKey) {
        $ApiKey = Read-Host '请粘贴 CodeBuddy API key（ck_ 开头。获取路径：WorkBuddy - 个人信息 - 管理中心 - 访问密钥。直接回车=跳过：聊天、生图、修图、抠图将全部不可用）'
        if ($ApiKey) {
            New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
            [IO.File]::WriteAllText($KeyFile, $ApiKey.Trim())
        }
    }
}
if ((Test-Path $KeyFile) -and (Get-Content $KeyFile -Raw).Trim()) {
    Write-Host "[OK] API key 已就位: $KeyFile"
} else {
    Write-Warning '未配置 API key：聊天、生图、修图、抠图将全部不可用（用 WorkBuddy 自带 CLI 时，认证就靠这个 key）。'
}

# ---- 2) 部署 wrapper ----
$CbDir = Join-Path $env:USERPROFILE '.llm_in_codebuddy'
New-Item -ItemType Directory -Force -Path $CbDir | Out-Null
$Wrapper = Join-Path $CbDir 'cbc-claude.js'
Copy-Item (Join-Path $PSScriptRoot 'cbc-claude.js') $Wrapper -Force
& $Node.Source --check $Wrapper
if ($LASTEXITCODE -ne 0) { throw 'cbc-claude.js 语法校验失败，安装包可能不完整。' }
Write-Host "[OK] wrapper 已部署: $Wrapper"

# ---- 3) 探测 codebuddy CLI（WorkBuddy 自带的优先）----
function Find-Cli([string]$Hint) {
    if ($Hint -and (Test-Path $Hint)) { return (Resolve-Path $Hint).Path }

    # 3.0) WorkBuddy / CodeBuddy 客户端自带的 CLI —— 装了 WorkBuddy 就有，无需另装
    #      2026-11 实测：Windows 版 WorkBuddy 自带 app.asar.unpacked\cli\bin\codebuddy（v2.165.0，node 脚本）
    $roots = @()
    if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA 'Programs') }
    if ($env:ProgramFiles) { $roots += $env:ProgramFiles }
    if (${env:ProgramFiles(x86)}) { $roots += ${env:ProgramFiles(x86)} }
    foreach ($root in $roots) {
        foreach ($app in @('WorkBuddy', 'CodeBuddy')) {
            $base = Join-Path $root $app
            foreach ($leaf in @('codebuddy.exe', 'codebuddy')) {
                $embedded = Join-Path $base "resources\app.asar.unpacked\cli\bin\$leaf"
                if (Test-Path $embedded) { return $embedded }
            }
        }
    }

    # 3.1) 独立版官方安装器默认位置
    $native = Join-Path $env:LOCALAPPDATA 'codebuddy\bin\codebuddy.exe'
    if (Test-Path $native) { return $native }
    # 3.2) npm 全局
    if ($env:APPDATA) {
        $npmBin = Join-Path $env:APPDATA 'npm\node_modules\@tencent-ai\codebuddy-code\bin\codebuddy'
        if (Test-Path $npmBin) { return $npmBin }
    }
    # 3.3) PATH
    $cmd = Get-Command codebuddy.exe, codebuddy.cmd, codebuddy -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return $null
}
$Cli = Find-Cli $CodebuddyBin
if ($Cli -and $Cli -match 'app\.asar\.unpacked') {
    Write-Host "[OK] 使用 WorkBuddy 自带 CLI: $Cli" -ForegroundColor Green
    Write-Host '     无需安装独立版 CLI，也无需做 CLI 登录（认证走 API key）。'
} elseif ($Cli) {
    Write-Host "[OK] 找到 CodeBuddy CLI: $Cli"
} elseif (-not $SkipCliInstall) {
    Write-Warning '未找到任何 codebuddy CLI（本机似乎没装 WorkBuddy）。聊天功能需要 CLI，可选择安装独立版。'
    $ans = Read-Host '是否现在由本脚本代跑官方安装器？（irm https://copilot.tencent.com/cli/install.ps1 | iex）(y/N)'
    if ($ans -eq 'y' -or $ans -eq 'Y') {
        Write-Host '正在运行官方安装器……' -ForegroundColor Cyan
        $inst = [scriptblock]::Create((Invoke-RestMethod https://copilot.tencent.com/cli/install.ps1))
        & $inst
        # 官方安装器装完后重新探测
        $Cli = Find-Cli $null
        if ($Cli) { Write-Host "[OK] CodeBuddy CLI 安装成功: $Cli" }
        else { Write-Warning '安装器已执行但未探测到 CLI，请重开 PowerShell 后重跑本脚本确认。' }
    } else {
        Write-Host '请自行安装后重跑本脚本（二选一）：' -ForegroundColor Yellow
        Write-Host '  官方安装器（推荐，无需 Node）: irm https://copilot.tencent.com/cli/install.ps1 | iex'
        Write-Host '  npm 方式:                      npm install -g @tencent-ai/codebuddy-code'
    }
}

# 认证提醒：WorkBuddy 自带 CLI 走 API key（无需登录）；独立版 CLI 走自身登录态
if ($Cli) {
    $isEmbedded = $Cli -match 'app\.asar\.unpacked'
    Write-Host ''
    if ($isEmbedded) {
        Write-Host '[提示] 检测到 WorkBuddy 自带 CLI，认证走 API key，无需运行 codebuddy 登录。' -ForegroundColor Green
    } else {
        Write-Host '【重要】独立版 CLI 的聊天功能依赖 CLI 自身登录态。如从未登录过，请运行一次 codebuddy 按提示完成浏览器登录。' -ForegroundColor Yellow
    }
}

# ---- 4) 用户级环境变量（新开的窗口/进程生效）----
[Environment]::SetEnvironmentVariable('CODEBUDDY_BIN', [string]$Cli, 'User')
[Environment]::SetEnvironmentVariable('LLM_IN_WORD_CLAUDE_BIN', $Wrapper, 'User')
[Environment]::SetEnvironmentVariable('LLM_IN_POWERPOINT_CLAUDE_BIN', $Wrapper, 'User')
[Environment]::SetEnvironmentVariable('LLM_IN_EXCEL_CLAUDE_BIN', $Wrapper, 'User')
# 当前会话也立即可用
$env:CODEBUDDY_BIN = [string]$Cli
$env:LLM_IN_WORD_CLAUDE_BIN = $Wrapper
$env:LLM_IN_POWERPOINT_CLAUDE_BIN = $Wrapper
$env:LLM_IN_EXCEL_CLAUDE_BIN = $Wrapper
Write-Host '[OK] 环境变量已写入（用户级）：CODEBUDDY_BIN、LLM_IN_WORD/POWERPOINT/EXCEL_CLAUDE_BIN'

Write-Host ''
Write-Host '环境准备完成。接下来：' -ForegroundColor Green
Write-Host '  1. 重新打开一个 PowerShell 窗口（让环境变量生效）'
Write-Host '  2. 依次进入三个目录运行安装脚本：'
Write-Host '     cd LLM_in_Word;       .\install.ps1'
Write-Host '     cd ..\LLM_in_PowerPoint; .\install.ps1'
Write-Host '     cd ..\LLM_in_Excel;   .\install.ps1'
Write-Host '  3. 完全退出 Office（Word/PPT/Excel）再重新打开，功能区会出现 LLM_in 按钮'
Write-Host '  详细说明与排障见 README-WINDOWS.md 与 TROUBLESHOOTING.md'
