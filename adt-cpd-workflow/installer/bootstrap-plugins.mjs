#!/usr/bin/env node
/**
 * bootstrap-plugins.mjs —— 安装器预置插件（B 方案）
 *
 * 由 NSIS 的 customInstall 步骤调用，作用：在用户目录里准备好 desktop profile，
 * 并把 plugin-kit.json 里登记的插件装进去，使「装完安装包就带插件」。
 *
 * 设计约束（重要）：
 *   1. 幂等。重复执行只补缺，不动已装的包。
 *   2. 不覆盖已存在且看起来合法的 profile —— 升级安装时必须保留用户自己的插件与设置。
 *   3. 只做「profile 骨架 + 装包 + 登记 bundles」，不启动应用、不改应用文件。
 *   4. 任何一步失败都以非零码退出并写日志，NSIS 侧只做提示，不阻断安装。
 *
 * 用法：
 *   node bootstrap-plugins.mjs --home <DSH_HOME> --kit <plugin-kit 目录> \
 *        [--profile desktop] [--node <node.exe>] [--pnpm <pnpm.mjs>] \
 *        [--exclude a,b] [--store-dir <pnpm store>] [--offline] [--dry-run]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const opt = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = args[i + 1]
  return next && !next.startsWith('--') ? next : true
}
const flag = name => args.includes(`--${name}`)

const home = opt('home')
const kitDir = opt('kit')
const profileName = opt('profile', 'desktop')
const nodeBin = opt('node', process.execPath)
const pnpmJs = opt('pnpm')
const exclude = String(opt('exclude', '')).split(',').map(s => s.trim()).filter(Boolean)
const storeDir = opt('store-dir')
const offline = flag('offline')
const dryRun = flag('dry-run')

if (!home || !kitDir) {
  console.error('用法：node bootstrap-plugins.mjs --home <DSH_HOME> --kit <kit 目录> [--pnpm <pnpm.mjs>] [--exclude a,b] [--dry-run]')
  process.exit(2)
}

const log = []
const say = line => { log.push(line); console.log(line) }

const kit = JSON.parse(readFileSync(join(kitDir, 'plugin-kit.json'), 'utf8'))
const profileDir = join(home, 'profiles', profileName)
const markerPath = join(profileDir, '.plugin-kit.json')

say(`[kit] profile = ${profileName}`)
say(`[kit] home    = ${home}`)
say(`[kit] profile = ${profileDir}`)

// ── 1. profile 骨架 ────────────────────────────────────────────────
const pkgPath = join(profileDir, 'package.json')
const defaults = kit.defaultBundles ?? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

if (!existsSync(pkgPath)) {
  say('[kit] profile 不存在，创建最小骨架')
  if (!dryRun) {
    mkdirSync(profileDir, { recursive: true })
    // 与桌面端 createDesktopWebProfile 一致：先只有模板带来的两个组合层，
    // 其余组合层由本脚本在装完包后登记。
    const pkg = {
      name: `dsh-profile-${profileName}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...defaults] } },
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    // 桌面端后续会自己补齐其余文件；这两个空文件让 profile 目录形状符合预期。
    for (const f of ['cordis.yml', 'pnpm-workspace.yaml']) {
      const p = join(profileDir, f)
      if (!existsSync(p)) writeFileSync(p, f === 'cordis.yml' ? '[]\n' : 'packages:\n  - "."\n', 'utf8')
    }
  }
}
else {
  say('[kit] profile 已存在，保留现有内容（只补缺）')
}

// ── 2. 决定装哪些插件 ──────────────────────────────────────────────
const wanted = kit.plugins.filter(p => p.required !== false && !exclude.includes(p.name))
say(`[kit] 待装插件 ${wanted.length} 个：${wanted.map(p => p.name).join(', ')}`)

const pnpmArgs = spec => {
  const args = ['add', spec, '--dir', profileDir]
  if (storeDir) args.push('--store-dir', storeDir)
  args.push(offline ? '--offline' : '--prefer-offline')
  return args
}

function runPnpm(spec) {
  if (!pnpmJs) {
    say('[kit] 未提供 --pnpm，跳过实际安装（dry 模式）')
    return false
  }
  const r = spawnSync(nodeBin, [pnpmJs, ...pnpmArgs(spec)], { encoding: 'utf8' })
  const ok = r.status === 0
  say(`[kit] ${ok ? 'ok  ' : 'FAIL'} ${spec}${ok ? '' : `\n${(r.stderr || r.stdout || '').trim().split('\n').slice(-4).join('\n')}`}`)
  return ok
}

let installed = 0
let failed = 0
for (const plugin of wanted) {
  // 包体可能在 kit 内（随安装包分发），也可能在仓库的 plugins/vendor（开发时）
  const candidates = plugin.vendorDir
    ? [resolve(kitDir, plugin.vendorDir), resolve(kitDir, '..', 'plugins', plugin.vendorDir)]
    : []
  const vendorAbs = candidates.find(p => existsSync(join(p, 'package.json'))) ?? null
  let spec
  if (vendorAbs) {
    spec = `file:${vendorAbs}`
  }
  else {
    spec = `${plugin.name}@${plugin.version}`
    say(`[kit] ${plugin.name} 无 vendor 副本，改用 npm 源：${spec}`)
  }
  if (dryRun) { say(`[dry-run] pnpm add ${spec} --dir ${profileDir}`); continue }
  if (runPnpm(spec)) installed++; else failed++
}

// ── 3. 登记 dsh.profile.bundles ────────────────────────────────────
if (!dryRun && existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.dsh ??= {}
  pkg.dsh.profile ??= {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? [...pkg.dsh.profile.bundles] : []
  for (const b of defaults) if (!bundles.includes(b)) bundles.unshift(b)
  const added = []
  for (const plugin of wanted) {
    // 只有声明了 dsh.bundle 的包才进组合层；否则会把非 bundle 包装进 profile 导致启动失败
    if (plugin.bundle === false) continue
    if (!bundles.includes(plugin.name)) { bundles.push(plugin.name); added.push(plugin.name) }
  }
  // base 必须排在 web 之前
  const bi = bundles.indexOf('@deepseek-ai/dsh-base')
  const wi = bundles.indexOf('@deepseek-ai/dsh-web-app')
  if (bi !== -1 && wi !== -1 && wi < bi) {
    bundles.splice(wi, 1)
    bundles.splice(bundles.indexOf('@deepseek-ai/dsh-base') + 1, 0, '@deepseek-ai/dsh-web-app')
  }
  pkg.dsh.profile.bundles = bundles
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  say(`[kit] bundles 已登记，新增 ${added.length} 条${added.length ? '：' + added.join(', ') : ''}`)

  writeFileSync(markerPath, JSON.stringify({
    schema: 1,
    at: new Date().toISOString(),
    installed: wanted.map(p => `${p.name}@${p.version}`),
    failed: failed > 0 ? true : undefined,
  }, null, 2) + '\n', 'utf8')
}

say(`[kit] 完成：成功 ${installed}，失败 ${failed}`)
process.exit(failed > 0 ? 1 : 0)
