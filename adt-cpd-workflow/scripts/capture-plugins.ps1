# 重新采集当前 profile 的插件清单（并同步 vendor 副本）
#
# 背景：manifest.json 记录的是「某台机器某个时刻装了哪些插件」。谁在客户端里装了一个新插件，
#       这份清单就过时了。本脚本直接从 profile 的 package.json + node_modules 重新采集，
#       保留人工撰写过的 purpose / provides，只刷新机器可读的事实（版本、许可证、体积、bundle 声明）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts\capture-plugins.ps1            # 采集并写入
#   powershell -ExecutionPolicy Bypass -File scripts\capture-plugins.ps1 -DryRun    # 只看差异
#   powershell -ExecutionPolicy Bypass -File scripts\capture-plugins.ps1 -NoVendor  # 只更新清单，不拷贝包体
#
# 采完记得 git add -A && git commit，否则清单还是旧的。

[CmdletBinding()]
param(
    [string]$DshHome,
    [string]$Profile = 'desktop',
    [switch]$DryRun,
    [switch]$NoVendor,
    [long]$MaxVendorBytes = 52428800   # 50 MB 以上的包不入 vendor
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'plugins\manifest.json'
$vendorRoot = Join-Path $repoRoot 'plugins\vendor'

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
$profilePkg = Get-Content (Join-Path $profileDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$previous = [ordered]@{}
$capturedFrom = $null
if (Test-Path $manifestPath) {
    $old = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $capturedFrom = $old.capturedFrom
    foreach ($p in $old.plugins) { $previous[$p.name] = $p }
}

$entries = @()
$index = 0
foreach ($dep in $profilePkg.dependencies.PSObject.Properties) {
    $index++
    $name = $dep.Name
    $pkgDir = Join-Path $profileDir "node_modules\$name"
    if (-not (Test-Path (Join-Path $pkgDir 'package.json'))) {
        Write-Warning "跳过 $name：node_modules 里没有它（可能需要先装一次）"
        continue
    }
    $pkg = Get-Content (Join-Path $pkgDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $files = Get-ChildItem $pkgDir -Recurse -File
    $bytes = ($files | Measure-Object -Sum Length).Sum

    $isBundle = [bool]($pkg.dsh -and $pkg.dsh.bundle)
    $relVendor = "vendor/$name"
    $vendorDir = $null
    $vendorNote = $null
    if ($isBundle) {
        if ($bytes -gt $MaxVendorBytes) {
            $vendorNote = ("包体 {0:N1} MB，超过 {1} MB 阈值，不放入 vendor；安装时从 npm 拉取。" -f ($bytes / 1MB), ($MaxVendorBytes / 1MB))
        }
        elseif ($NoVendor) {
            $vendorNote = '本次以 -NoVendor 运行，未同步包体副本。'
        }
        else {
            $vendorDir = $relVendor
            $target = Join-Path $repoRoot ("plugins\" + ($relVendor -replace '/', '\'))
            if ($DryRun) {
                Write-Host ("[dry-run] 同步 {0} -> {1} ({2:N1} MB / {3} 文件)" -f $name, $relVendor, ($bytes / 1MB), $files.Count)
            }
            else {
                if (Test-Path $target) { Remove-Item $target -Recurse -Force }
                New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
                Copy-Item $pkgDir $target -Recurse -Force
                Write-Host ("-> 已同步 {0} -> {1} ({2:N1} MB / {3} 文件)" -f $name, $relVendor, ($bytes / 1MB), $files.Count)
            }
        }
    }

    $prev = $previous[$name]
    $entry = [ordered]@{
        name       = $name
        version    = $pkg.version
        license    = $pkg.license
        bundle     = $isBundle
        vendorDir  = $vendorDir
        purpose    = if ($prev -and $prev.purpose) { $prev.purpose } else { '' }
    }
    if ($prev -and $prev.provides) { $entry.provides = $prev.provides }
    if ($vendorNote) { $entry.vendorNote = $vendorNote }
    if ($pkg.dsh -and $pkg.dsh.engines) { $entry.engines = $pkg.dsh.engines }
    elseif ($prev -and $prev.engines) { $entry.engines = $prev.engines }
    if ($prev -and $prev.requiresExternal) { $entry.requiresExternal = $prev.requiresExternal }
    $entry.priority = if ($prev -and $prev.priority) { $prev.priority } else { 100 + $index }
    $entries += [pscustomobject]$entry

    $flag = if ($prev) { '更新' } else { '新增' }
    Write-Host ("[{0}] {1}@{2}  {3:N1} MB  bundle={4}" -f $flag, $name, $pkg.version, ($bytes / 1MB), $isBundle)
}

$stale = $previous.Keys | Where-Object { $_ -notin ($entries | ForEach-Object { $_.name }) }
foreach ($s in $stale) { Write-Host "[移除] $s（profile 里已不存在）" -ForegroundColor Yellow }

# 安装顺序由 priority 决定（与 bundles 的应用顺序一致），文件里的排列也照它来
$entries = @($entries | Sort-Object priority)

$manifest = [ordered]@{
    capturedAt      = (Get-Date -Format 'yyyy-MM-dd')
    capturedFrom    = if ($capturedFrom) { $capturedFrom } else { [ordered]@{ product = 'StarMind Desktop (Beta)'; dshHome = $dshHomeResolved; profile = $Profile } }
    note            = '记录导出时刻 profile package.json 里的全部第三方依赖。bundles 顺序即 cordis 组合层的应用顺序，不要随意调整。这份清单会随使用者自行安装插件而漂移，更新请重跑 scripts/capture-plugins.ps1。'
    productBundles  = if ($old) { $old.productBundles } else { @() }
    productBundlesNote = if ($old -and $old.productBundlesNote) { $old.productBundlesNote } else { '上列由 StarMind 发行版自带，随客户端提供，不需要也不应该由本仓库安装。' }
    plugins         = $entries
}

if ($DryRun) {
    Write-Host ''
    Write-Host ("[dry-run] 将写入 {0} 条插件记录，未改动任何文件" -f $entries.Count)
}
else {
    $manifest | ConvertTo-Json -Depth 20 | Set-Content $manifestPath -Encoding UTF8
    Write-Host ''
    Write-Host ("已写入 {0}（{1} 条记录）" -f $manifestPath, $entries.Count)
    Write-Host '别忘了 git add -A && git commit'
}
