# 一键安装插件（Windows / PowerShell）
#
# 用途：把 plugins/manifest.json 里登记的插件装进 StarMind Desktop 的 profile，
#       让新机器在装完 StarMind 之后补齐同一套能力。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1            从 npm 安装
#   powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1 -Offline   用 plugins/vendor 离线安装
#   powershell -ExecutionPolicy Bypass -File scripts\install-plugins.ps1 -DryRun    只打印将要执行的命令
#
# 注意：本脚本直接改 profile 的 package.json 与 node_modules，效果等价于应用内「插件」页安装。
#       执行前请关闭 StarMind；装完重启客户端生效。

[CmdletBinding()]
param(
    [string]$DshHome,
    [string]$Profile = 'desktop',
    [switch]$Offline,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'plugins\manifest.json'
if (-not (Test-Path $manifestPath)) { throw "找不到 $manifestPath" }
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

# --- 1. 定位 DSH home -------------------------------------------------
function Resolve-DshHome {
    param([string]$Explicit)
    if ($Explicit) { return $Explicit }
    if ($env:DSH_HOME) { return $env:DSH_HOME }
    $marker = Join-Path $env:APPDATA 'StarMind Beta\home\desktop-next-last-home.json'
    if (Test-Path $marker) {
        $found = (Get-Content $marker -Raw -Encoding UTF8 | ConvertFrom-Json).home
        if ($found -and (Test-Path $found)) { return $found }
    }
    $candidates = @((Join-Path $env:USERPROFILE '.dsh-beta'), (Join-Path $env:USERPROFILE '.dsh'))
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    throw '未找到 DSH home，请用 -DshHome 显式指定（例如 %USERPROFILE%\.dsh-beta）'
}

$dshHomeResolved = Resolve-DshHome -Explicit $DshHome
$profileDir = Join-Path $dshHomeResolved "profiles\$Profile"
if (-not (Test-Path $profileDir)) {
    throw "profile 不存在：$profileDir（先启动一次 StarMind 让它初始化）"
}
Write-Host "DSH home : $dshHomeResolved"
Write-Host "profile  : $profileDir"

# --- 2. 定位随客户端附带的 node / pnpm ---------------------------------
function Find-Runtime {
    $localAppData = $env:LOCALAPPDATA
    $roots = @(
        (Join-Path $localAppData 'Programs\StarMind Beta\resources\runtime'),
        (Join-Path $localAppData 'Programs\StarMind\resources\runtime')
    )
    foreach ($root in $roots) {
        $deps = Join-Path $root 'x64\primary-runtime\dependencies'
        $nodeExe = Join-Path $deps 'node\bin\node.exe'
        $pnpmJs = Join-Path $deps 'pnpm\bin\pnpm.mjs'
        if ((Test-Path $nodeExe) -and (Test-Path $pnpmJs)) {
            return [pscustomobject]@{ Node = $nodeExe; Pnpm = $pnpmJs }
        }
    }
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($nodeCmd -and $pnpmCmd) {
        return [pscustomobject]@{ Node = $nodeCmd.Source; Pnpm = $pnpmCmd.Source }
    }
    throw '未找到 node / pnpm。请安装 Node.js 20.12 以上，或确认 StarMind 已正确安装'
}

$rt = Find-Runtime
Write-Host "node     : $($rt.Node)"
Write-Host "pnpm     : $($rt.Pnpm)"
Write-Host ''

# --- 3. 逐个安装 -------------------------------------------------------
foreach ($plugin in $manifest.plugins) {
    if ($Offline -and $plugin.vendorDir) {
        $vendor = Join-Path $repoRoot ("plugins\" + ($plugin.vendorDir -replace '/', '\'))
        if (-not (Test-Path $vendor)) { throw "离线目录缺失：$vendor" }
        $spec = "file:$vendor"
    }
    else {
        # vendorDir 为 null（例如 dsh-univer-office，包体近 190MB）时一律走 npm
        $spec = "$($plugin.name)@$($plugin.version)"
    }

    $label = "$($plugin.name)@$($plugin.version)"
    if ($DryRun) {
        Write-Host "[dry-run] pnpm add $spec --dir $profileDir"
        continue
    }

    Write-Host "-> 安装 $label ..."
    & $rt.Node $rt.Pnpm add $spec --dir $profileDir --prefer-offline 2>&1 |
        ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { throw "安装失败：$label（退出码 $LASTEXITCODE）" }
}

# --- 4. 把插件登记进 dsh.profile.bundles -------------------------------
$pkgPath = Join-Path $profileDir 'package.json'
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $pkg.dsh) {
    $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{})
}
if (-not $pkg.dsh.profile) {
    $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{})
}
if (-not $pkg.dsh.profile.bundles) {
    $pkg.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @()
}

$bundles = New-Object System.Collections.Generic.List[string]
foreach ($b in $pkg.dsh.profile.bundles) { $bundles.Add([string]$b) }

$added = @()
foreach ($plugin in $manifest.plugins) {
    if ($plugin.bundle -and -not $bundles.Contains($plugin.name)) {
        $bundles.Add($plugin.name)
        $added += $plugin.name
    }
}
$pkg.dsh.profile.bundles = $bundles.ToArray()

if ($DryRun) {
    Write-Host ("[dry-run] 将写入 bundles: " + ($bundles -join ', '))
}
else {
    # 必须无 BOM：应用的 JSON 解析器不接受 BOM
    [System.IO.File]::WriteAllText($pkgPath, (ConvertTo-Json -InputObject $pkg -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
    if ($added.Count -gt 0) {
        Write-Host ("-> bundles 已更新，新增: " + ($added -join ', '))
    }
    else {
        Write-Host '-> bundles 已是最新，无新增'
    }
}

# --- 5. 汇总 -----------------------------------------------------------
Write-Host ''
Write-Host '完成。请重启 StarMind，然后在「设置 -> 插件」中确认以下条目已启用：'
foreach ($plugin in $manifest.plugins) {
    Write-Host "  - $($plugin.name)@$($plugin.version)"
}
Write-Host ''
Write-Host '提示：dsh-remote 还需在「设置 -> 远程工作区」添加机器；modlens 需单独确认引擎可用。'
