# install-codebuddy.ps1 — LLM_in_Work × CodeBuddy Windows 一次性准备脚本
# 做四件事（全部 per-user，无需管理员）：
#   1) 把 API key 写入 %USERPROFILE%\.codebuddy\api.key
#   2) 部署跨平台 wrapper cbc-claude.js 到 %USERPROFILE%\.llm_in_codebuddy\
#   3) 探测本机 WorkBuddy 安装目录里的 CodeBuddy CLI
#   4) 写入用户级环境变量（CODEBUDDY_BIN + 三套件的 LLM_IN_*_CLAUDE_BIN）
# 之后【重新打开 PowerShell 窗口】再分别运行 LLM_in_Word/LLM_in_PowerPoint/LLM_in_Excel 目录里的 install.ps1。
[CmdletBinding()]
param(
    [string]$ApiKey,                       # 不传则交互式询问（也可提前放好 %USERPROFILE%\.codebuddy\api.key）
    [string]$CodebuddyBin                  # 手动指定 codebuddy CLI 绝对路径（自动探测失败时用）
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw '本脚本仅用于 Windows。macOS 请参考 README。' }

Write-Host '== LLM_in_Work x CodeBuddy：Windows 环境准备 ==' -ForegroundColor Cyan

# ---- 0) Node 检查（install.ps1 也需要）----
$Node = Get-Command node.exe -ErrorAction SilentlyContinue
if (!$Node) { throw '未找到 Node.js。请先安装 Node.js 22.12+ 或 24+（https://nodejs.org，LTS 版即可）。' }
Write-Host "[OK] Node.js: $($Node.Source)"

# ---- 1) API key ----
$KeyDir = Join-Path $env:USERPROFILE '.codebuddy'
$KeyFile = Join-Path $KeyDir 'api.key'
if ($ApiKey) {
    New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
    [IO.File]::WriteAllText($KeyFile, $ApiKey.Trim())
}
if (!(Test-Path $KeyFile) -or !(Get-Content $KeyFile -Raw).Trim()) {
    if (!$ApiKey) {
        $ApiKey = Read-Host '请粘贴 CodeBuddy API key（ck_ 开头。获取路径：WorkBuddy - 个人信息 - 管理中心 - 访问密钥。直接回车=跳过：聊天仍可用，生图/抠图不可用）'
        if ($ApiKey) {
            New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
            [IO.File]::WriteAllText($KeyFile, $ApiKey.Trim())
        }
    }
}
if ((Test-Path $KeyFile) -and (Get-Content $KeyFile -Raw).Trim()) {
    Write-Host "[OK] API key 已就位: $KeyFile"
} else {
    Write-Warning '未配置 API key：生图/抠图功能将不可用，聊天功能不受影响（走本机 CLI 登录态）。'
}

# ---- 2) 部署 wrapper ----
$CbDir = Join-Path $env:USERPROFILE '.llm_in_codebuddy'
New-Item -ItemType Directory -Force -Path $CbDir | Out-Null
$Wrapper = Join-Path $CbDir 'cbc-claude.js'
Copy-Item (Join-Path $PSScriptRoot 'cbc-claude.js') $Wrapper -Force
& $Node.Source --check $Wrapper
if ($LASTEXITCODE -ne 0) { throw 'cbc-claude.js 语法校验失败，安装包可能不完整。' }
Write-Host "[OK] wrapper 已部署: $Wrapper"

# ---- 3) 探测 CodeBuddy CLI ----
function Find-Cli([string]$Hint) {
    if ($Hint -and (Test-Path $Hint)) { return (Resolve-Path $Hint).Path }
    $roots = @(
        (Join-Path $env:LOCALAPPDATA 'Programs'),
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)}
    ) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($root in $roots) {
        foreach ($app in @('WorkBuddy', 'CodeBuddy', 'workbuddy', 'codebuddy')) {
            $base = Join-Path $root $app
            if (!(Test-Path $base)) { continue }
            # app.asar.unpacked\cli 下递归找 codebuddy.exe（最多 3 层）
            $hits = Get-ChildItem -Path $base -Recurse -Depth 4 -Filter 'codebuddy.exe' -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match 'app\.asar\.unpacked' } | Select-Object -First 1
            if ($hits) { return $hits.FullName }
        }
    }
    # PATH 兜底
    $cmd = Get-Command codebuddy.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}
$Cli = Find-Cli $CodebuddyBin
if ($Cli) {
    Write-Host "[OK] 找到 CodeBuddy CLI: $Cli"
} else {
    Write-Warning '未自动找到 CodeBuddy CLI（需要本机已安装 WorkBuddy Windows 版）。'
    Write-Warning '  - 若已安装 WorkBuddy：请找到安装目录下 resources\app.asar.unpacked\ 里的 codebuddy.exe，'
    Write-Warning '    然后重跑本脚本：.\install-codebuddy.ps1 -CodebuddyBin "C:\完整路径\codebuddy.exe"'
    Write-Warning '  - 若未安装 WorkBuddy：聊天功能不可用（生图/抠图只需 API key，仍可用）。'
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
Write-Host '  详细说明与排障见 README-WINDOWS.md'
