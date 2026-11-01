# 生成「团队插件基线」离线包（在打包机 / 你的机器上跑）
#
# 产出：starmind-plugin-baseline-<基线号>.zip
#   ├── baseline.json          基线元数据（版本、来源机器、插件清单）
#   ├── plugins/<包名>/         插件包体（含各自的 bundleDependencies）
#   └── store/                 （可选）pnpm store 快照，用于真正零外网的安装
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File offline\make-bundle.ps1
#   powershell -ExecutionPolicy Bypass -File offline\make-bundle.ps1 -Baseline 2026.11 -IncludeStore
#   powershell -ExecutionPolicy Bypass -File offline\make-bundle.ps1 -Ship @('dsh-remote','dsh-plugin-save-token')
#
# 建议：默认打全部 7 个（不含 dsh-univer-office，187MB 单独处理）

[CmdletBinding()]
param(
    [string]$DshHome,
    [string]$Profile = 'desktop',
    [string]$OutDir = 'dist',
    [string]$Baseline = (Get-Date -Format 'yyyy.MM'),
    [string[]]$Ship,
    [switch]$IncludeStore,
    [switch]$Zip
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# ---------- 1. 定位环境 ----------
function Resolve-DshHome {
    param([string]$Explicit)
    if ($Explicit) { return $Explicit }
    if ($env:DSH_HOME) { return $env:DSH_HOME }
    $marker = Join-Path $env:APPDATA 'StarMind Beta\home\desktop-next-last-home.json'
    if (Test-Path $marker) {
        $found = (Get-Content $marker -Raw -Encoding UTF8 | ConvertFrom-Json).home
        if ($found -and (Test-Path $found)) { return $found }
    }
    foreach ($c in @((Join-Path $env:USERPROFILE '.dsh-beta'), (Join-Path $env:USERPROFILE '.dsh'))) {
        if (Test-Path $c) { return $c }
    }
    throw '未找到 DSH home，请用 -DshHome 指定'
}

$dshHomeResolved = Resolve-DshHome -Explicit $DshHome
$profileDir = Join-Path $dshHomeResolved "profiles\$Profile"
$modulesDir = Join-Path $profileDir 'node_modules'
if (-not (Test-Path $modulesDir)) { throw "profile 未安装任何依赖：$modulesDir" }

# 默认打包清单：来自仓库的 plugins/manifest.json（不含大件）
$manifestPath = Join-Path $repoRoot 'plugins\manifest.json'
$defaultShip = @()
if (Test-Path $manifestPath) {
    $manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $defaultShip = @($manifest.plugins | Where-Object { $_.vendorDir -ne $null } | ForEach-Object { $_.name })
}
if (-not $Ship -or $Ship.Count -eq 0) { $Ship = $defaultShip }
if (-not $Ship -or $Ship.Count -eq 0) { throw '没有可打包的插件：请检查 plugins/manifest.json 或用 -Ship 指定' }

Write-Host "DSH home : $dshHomeResolved"
Write-Host "profile  : $profileDir"
Write-Host "基线号   : $Baseline"
Write-Host "插件数   : $($Ship.Count)"
Write-Host ''

# ---------- 2. 准备输出目录 ----------
$stage = Join-Path $OutDir "starmind-plugin-baseline-$Baseline"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'plugins') | Out-Null

# ---------- 3. 拷贝包体 ----------
$entries = @()
foreach ($name in $Ship) {
    $src = Join-Path $modulesDir ($name -replace '/', '\')
    if (-not (Test-Path (Join-Path $src 'package.json'))) {
        Write-Warning "跳过 $name：profile 里没有安装"
        continue
    }
    $pkgJson = Get-Content (Join-Path $src 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $safeName = ($name -replace '[@/]', '_').Trim('_')
    $dst = Join-Path $stage "plugins\$safeName"
    # 用 robocopy 保持目录结构；bundleDependencies 是离线安装必需的，不能省
    $null = robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw "拷贝失败：$name（robocopy $LASTEXITCODE）" }

    $sizeMb = [math]::Round(((Get-ChildItem $dst -Recurse -File | Measure-Object -Sum Length).Sum / 1MB), 1)
    $entries += [pscustomobject]@{
        name = $name
        version = $pkgJson.version
        license = $pkgJson.license
        dir = "plugins/$safeName"
        sizeMb = $sizeMb
        bundle = [bool]$pkgJson.dsh.bundle
    }
    Write-Host ("  + {0,-28} v{1,-10} {2,6} MB" -f $name, $pkgJson.version, $sizeMb)
}

# ---------- 4. 可选：pnpm store 快照（真正零外网才需要）----------
$storeNote = $null
if ($IncludeStore) {
    $storeCandidates = @(
        (Join-Path $env:LOCALAPPDATA 'pnpm\store'),
        (Join-Path $env:USERPROFILE '.pnpm-store')
    )
    $store = $storeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($store) {
        Write-Host "→ 复制 pnpm store：$store（这一步可能很慢、很大）"
        $null = robocopy $store (Join-Path $stage 'store') /E /NFL /NDL /NJH /NJS /NP
        $storeNote = "已包含 pnpm store 快照；导入时使用 --offline，无需访问 npm"
    }
    else {
        Write-Warning '没找到 pnpm store，跳过。离线安装时依赖仍需解析'
        $storeNote = '未包含 store；导入时依赖仍需能解析（内网需 npm 镜像或联网）'
    }
}

# ---------- 5. 写基线元数据 ----------
$baselineDoc = [ordered]@{
    schema = 1
    baseline = $Baseline
    createdAt = (Get-Date).ToString('s')
    source = [ordered]@{
        machine = $env:COMPUTERNAME
        user = $env:USERNAME
        dshHome = $dshHomeResolved
        profile = $Profile
        os = [System.Environment]::OSVersion.VersionString
    }
    store = [bool]$IncludeStore
    storeNote = $storeNote
    plugins = $entries
}
[System.IO.File]::WriteAllText((Join-Path $stage 'baseline.json'), (ConvertTo-Json -InputObject $baselineDoc -Depth 6), (New-Object System.Text.UTF8Encoding($false)))

# 附一份给用户看的说明，避免共享盘上只有一个孤零零的 zip
$storeLine = '未包含 pnpm store：安装时需要能解析依赖（内网 npm 镜像或联网）'
if ($storeNote) { $storeLine = $storeNote }
@"
StarMind 团队插件基线 $Baseline
=================================

包含插件（$($entries.Count) 个）：
$($entries | ForEach-Object { "  - $($_.name)  v$($_.version)  (~$($_.sizeMb) MB)" } | Out-String)

怎么装：
  1. 双击本目录（或解压后目录）里的 import-bundle.cmd
  2. 按提示等待完成，重启 StarMind

注意：
  - 装的是「插件能力」，不包含你的 SSH 机器列表、API Key、个人设置
  - $storeLine
"@ | Set-Content (Join-Path $stage 'README.txt') -Encoding UTF8

# ---------- 6. 打包 ----------
$totalMb = [math]::Round(((Get-ChildItem $stage -Recurse -File | Measure-Object -Sum Length).Sum / 1MB), 1)
Write-Host ''
Write-Host "目录已就绪：$stage（$totalMb MB）"

if ($Zip) {
    $zipPath = Join-Path $OutDir "starmind-plugin-baseline-$Baseline.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal
    $zipMb = [math]::Round(((Get-Item $zipPath).Length / 1MB), 1)
    Write-Host "已打包：$zipPath（$zipMb MB）"
    Write-Host ''
    Write-Host '把它放到公司共享盘，例如：'
    Write-Host "  \\fileserver\starmind\plugins\$Baseline\"
}
else {
    Write-Host '未加 -Zip，只生成目录。要出压缩包请加 -Zip'
}
