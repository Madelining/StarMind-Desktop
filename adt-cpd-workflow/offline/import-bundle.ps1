# 一键导入团队插件基线（终端用户跑这个）
#
# 用法（三种都行）：
#   1. 双击同目录下的 import-bundle.cmd          ← 推荐给同事，最简单
#   2. 把 starmind-plugin-baseline-*.zip 拖到 import-bundle.cmd 图标上
#   3. powershell -ExecutionPolicy Bypass -File import-bundle.ps1 -Bundle <zip 或目录>
#
# 它做的事：把基线包落到 <DSH_HOME>\starmind-kit\<基线号>\ → 生成 plugin-kit → 调 installer\bootstrap-plugins.mjs 安装
# 不做的事：不启动应用、不改 App 安装目录、不碰你的 SSH/API Key/个人设置
#
# 为什么包体要「落地」而不是用完就删：
#   pnpm 会把插件记成 file: 依赖，指向这个目录。目录删了，profile 下次 pnpm install 就会失败。

[CmdletBinding()]
param(
    [string]$Bundle,
    [string]$DshHome,
    [string]$Profile = 'desktop',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repoRoot = Split-Path -Parent $here
$bootstrap = Join-Path $repoRoot 'installer\bootstrap-plugins.mjs'
if (-not (Test-Path $bootstrap)) { throw "找不到 $bootstrap" }

function Info($m) { Write-Host $m }
function Fail($m) { Write-Host ''; Write-Host "错误：$m" -ForegroundColor Red; exit 1 }

# ---------- 1. 找到基线包 ----------
if (-not $Bundle) {
    $candidates = @(Get-ChildItem -Path $here -Filter 'starmind-plugin-baseline-*.zip' -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
    if ($candidates.Count -gt 0) { $Bundle = $candidates[0].FullName }
    elseif (Test-Path (Join-Path $here 'baseline.json')) { $Bundle = $here }
    else { Fail "没找到基线包。请把 starmind-plugin-baseline-*.zip 放在本目录，或拖到 import-bundle.cmd 上。" }
}
if (-not (Test-Path $Bundle)) { Fail "基线包不存在：$Bundle" }
Info "基线包：$Bundle"

# ---------- 2. 解析 DSH home（必须在落地前拿到）----------
if (-not $DshHome) {
    if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME }
    else {
        $marker = Join-Path $env:APPDATA 'StarMind Beta\home\desktop-next-last-home.json'
        if (Test-Path $marker) { $DshHome = (Get-Content $marker -Raw -Encoding UTF8 | ConvertFrom-Json).home }
        elseif (Test-Path (Join-Path $env:USERPROFILE '.dsh-beta')) { $DshHome = Join-Path $env:USERPROFILE '.dsh-beta' }
        elseif (Test-Path (Join-Path $env:USERPROFILE '.dsh')) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
    }
}
if (-not $DshHome) { Fail '找不到 StarMind 的数据目录。请先启动一次客户端，或用 -DshHome 指定。' }
Info "数据目录：$DshHome"

# ---------- 3. 把基线包落到 <DSH_HOME>\starmind-kit\ ----------
$tmp = $null
if ((Get-Item $Bundle).PSIsContainer) {
    $sourceDir = (Get-Item $Bundle).FullName
}
else {
    $tmp = Join-Path $env:TEMP ("starmind-kit-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    Info "解压基线包……"
    Expand-Archive -Path $Bundle -DestinationPath $tmp -Force
    $sourceDir = $tmp
}

$baselinePath = Join-Path $sourceDir 'baseline.json'
if (-not (Test-Path $baselinePath)) {
    if ($tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    Fail '基线包不完整：缺少 baseline.json'
}
$baselineDoc = Get-Content $baselinePath -Raw -Encoding UTF8 | ConvertFrom-Json

$kitRoot = Join-Path $DshHome 'starmind-kit'
$kitDir = Join-Path $kitRoot $baselineDoc.baseline
if (Test-Path $kitDir) { Remove-Item $kitDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $kitRoot | Out-Null
Copy-Item $sourceDir $kitDir -Recurse -Force
if ($tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
Info "包体落地：$kitDir"

Info ''
Info "基线号：$($baselineDoc.baseline)    生成于：$($baselineDoc.createdAt)"
Info "插件（$($baselineDoc.plugins.Count) 个）："
foreach ($p in $baselineDoc.plugins) { Info ("  - {0,-28} v{1}" -f $p.name, $p.version) }
Info ''

# ---------- 4. 生成给 bootstrap 用的 plugin-kit ----------
$kit = [ordered]@{
    schema = 1
    profile = $Profile
    defaultBundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app')
    plugins = @($baselineDoc.plugins | ForEach-Object {
        [ordered]@{
            name = $_.name
            version = $_.version
            vendorDir = $_.dir
            required = $true
            bundle = $_.bundle
        }
    })
}
$kitPath = Join-Path $kitDir 'plugin-kit.json'
[System.IO.File]::WriteAllText($kitPath, (ConvertTo-Json -InputObject $kit -Depth 6), (New-Object System.Text.UTF8Encoding($false)))

# ---------- 5. 找 node / pnpm ----------
$deps = $null
foreach ($root in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\StarMind Beta\resources\runtime'),
        (Join-Path $env:LOCALAPPDATA 'Programs\StarMind\resources\runtime'))) {
    $candidate = Join-Path $root 'x64\primary-runtime\dependencies'
    if ((Test-Path (Join-Path $candidate 'node\bin\node.exe')) -and
        (Test-Path (Join-Path $candidate 'pnpm\bin\pnpm.mjs'))) { $deps = $candidate; break }
}
if (-not $deps) { Fail "没找到 StarMind 自带的 node/pnpm。请确认客户端已安装（期望位置：%LOCALAPPDATA%\Programs\StarMind Beta\resources\runtime）" }
$node = Join-Path $deps 'node\bin\node.exe'
$pnpm = Join-Path $deps 'pnpm\bin\pnpm.mjs'
Info "node：$node"
Info ''

# ---------- 6. 调 bootstrap ----------
$bootstrapArgs = @($bootstrap, '--home', $DshHome, '--kit', $kitDir, '--profile', $Profile, '--node', $node, '--pnpm', $pnpm)
if ($baselineDoc.store) {
    $storePath = Join-Path $kitDir 'store'
    if (Test-Path $storePath) { $bootstrapArgs += @('--store-dir', $storePath, '--offline') }
}
if ($DryRun) { $bootstrapArgs += '--dry-run'; Info '[dry-run] 只演练，不实际安装' }

Info '开始安装……（首次可能需要几分钟，请勿关闭窗口）'
Info ''
& $node @bootstrapArgs
$code = $LASTEXITCODE

Info ''
if ($code -eq 0) {
    Info '完成。请重启 StarMind，在「设置 → 插件」里确认这些条目已启用：'
    foreach ($p in $baselineDoc.plugins) { Info ("  - {0}@{1}" -f $p.name, $p.version) }
    Info ''
    Info '还需要你自己配的（安装包不带）：'
    Info '  · 设置 → 远程工作区：添加你的测试机（dsh-remote 的机器列表是空的）'
    Info '  · 模型 provider 与 API Key'
}
else {
    Write-Host "安装未完全成功（退出码 $code）。" -ForegroundColor Yellow
    Write-Host '常见原因：内网无法访问 npm 源，且基线包没有带 pnpm store。' -ForegroundColor Yellow
    Write-Host '解决办法：请管理员用 make-bundle.ps1 -IncludeStore 重新生成基线包。' -ForegroundColor Yellow
}
exit $code
