#!/usr/bin/env node
// npm owns dependency resolution. This tool preserves original archives and never runs their scripts.
import { createHash, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspectTarball } from '../src/archive.mjs'
import semver from '../vendor/semver/index.js'

const MAX_ARCHIVE = 256 * 1024 * 1024
const MAX_TOTAL = 256 * 1024 * 1024
export function validateRemote(value, allowedOrigins) {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || !allowedOrigins.has(url.origin)) {
    throw new Error(`不允许下载该地址：${url.origin}。请检查镜像，或显式使用 --allow-origin 加入可信制品源。`)
  }
  return url
}

export function verifyIntegrity(bytes, integrity) {
  if (typeof integrity !== 'string') throw new Error('锁文件缺少完整性校验值')
  const candidates = integrity.split(/\s+/u).map(value => /^(sha512|sha384|sha256)-([A-Za-z0-9+/]+=*)$/u.exec(value)).filter(Boolean)
  if (!candidates.length) throw new Error('锁文件没有 SHA-256 或更强的完整性校验值')
  for (const [, algorithm, encoded] of candidates) {
    const expected = Buffer.from(encoded, 'base64')
    const actual = createHash(algorithm).update(bytes).digest()
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return
  }
  throw new Error('下载的包与 npm 锁文件完整性校验不符')
}

export async function downloadArchive(url, origins, fetchImpl = fetch) {
  let current = validateRemote(url, origins)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(120_000), headers: { 'user-agent': 'StarMind-Offline-Preparer/1' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      current = validateRemote(new URL(response.headers.get('location'), current), origins)
      continue
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`包下载失败：HTTP ${response.status} ${current.origin}${current.pathname}`) }
    const announced = Number(response.headers.get('content-length'))
    if (announced > MAX_ARCHIVE) { await response.body?.cancel(); throw new Error('单个包超过 256 MiB') }
    const pieces = []
    let size = 0
    for await (const piece of response.body) {
      size += piece.byteLength
      if (size > MAX_ARCHIVE) { await response.body?.cancel().catch(() => {}); throw new Error('单个包超过 256 MiB') }
      pieces.push(Buffer.from(piece))
    }
    return Buffer.concat(pieces)
  }
  throw new Error('包下载重定向次数过多')
}

export function lockArtifacts(lock, localRoot) {
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || typeof lock.packages !== 'object') throw new Error('需要 npm v7+ 生成的完整 package-lock.json')
  const unique = new Map()
  for (const [path, record] of Object.entries(lock.packages)) {
    if (!path) continue
    if (record.link) throw new Error(`不支持 link/workspace 依赖：${path}`)
    if (record.inBundle) continue // Already preserved inside its parent's original archive.
    if (localRoot && path === `node_modules/${localRoot.name}`) continue
    if (!record.resolved || !/^https?:\/\//u.test(record.resolved)) throw new Error(`不支持非制品库依赖：${path}`)
    if (typeof record.integrity !== 'string') throw new Error(`包缺少校验值：${path}`)
    const key = `${record.resolved}\n${record.integrity}`
    unique.set(key, { path, url: record.resolved, integrity: record.integrity })
  }
  return [...unique.values()]
}

async function npmCliPath(explicit) {
  const options = explicit ? [resolve(explicit)] : [
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    process.env.npm_execpath,
  ].filter(Boolean)
  for (const candidate of options) if ((await stat(candidate).catch(() => null))?.isFile()) return candidate
  throw new Error('找不到 Node 附带的 npm。请使用包含 npm 的 Node 发行包，或 --npm-cli 指定 npm-cli.js。')
}

async function runNpm(cli, args, cwd, env = process.env) {
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, shell: false })
    const timer = setTimeout(() => { child.kill(); reject(new Error('npm 求解超时（15 分钟），请检查镜像是否齐全')); }, 15 * 60_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? accept() : reject(new Error(`npm 求解失败（退出码 ${code}），未生成交付包。`)) })
  })
}

export function parseArgs(args) {
  const result = { allowOrigins: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') { result.help = true; continue }
    const key = { '--plugin': 'plugin', '--tarball': 'tarball', '--registry': 'registry', '--output': 'output', '--npm-cli': 'npmCli', '--title': 'title', '--category': 'category', '--allow-origin': 'allowOrigins' }[arg]
    if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`未知或缺少值的参数：${arg}`)
    if (key === 'allowOrigins') result.allowOrigins.push(args[++i])
    else { if (result[key]) throw new Error(`参数重复：${arg}`); result[key] = args[++i] }
  }
  if (!result.help && (!result.registry || !result.output || Boolean(result.plugin) === Boolean(result.tarball))) throw new Error('必须提供 --registry、--output，以及 --plugin 或 --tarball 中的一项')
  return result
}

export async function prepareOffline(options) {
  const registry = new URL(options.registry)
  const origins = new Set([registry.origin, ...(options.allowOrigins ?? []).map(value => new URL(value).origin)])
  validateRemote(registry.href, origins)
  if (registry.search) throw new Error('registry 地址不能包含查询参数')
  const output = resolve(options.output)
  if (await stat(output).catch(() => null)) throw new Error('输出文件已存在，请选择新路径')
  const npmCli = await npmCliPath(options.npmCli)
  let plugin, rootBytes
  if (options.tarball) {
    rootBytes = await readFile(resolve(options.tarball))
    const inspected = inspectTarball(rootBytes)
    plugin = { name: inspected.manifest.name, version: inspected.manifest.version }
  } else {
    const matched = /^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)@(.+)$/u.exec(options.plugin)
    if (!matched || !semver.valid(matched[2])) throw new Error('--plugin 必须为精确版本，例如 dsh-example@1.2.3（不接受 latest 或版本范围）')
    plugin = { name: matched[1], version: matched[2] }
  }
  if (!semver.valid(plugin.version)) throw new Error('插件版本无效')
  const temporary = await mkdtemp(join(tmpdir(), 'starmind-prepare-'))
  const pending = `${output}.${process.pid}.tmp`
  try {
    const dependencies = { [plugin.name]: rootBytes ? pathToFileURL(resolve(options.tarball)).href : plugin.version }
    await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: 'starmind-offline-preparation', version: '1.0.0', private: true, dependencies }))
    await writeFile(join(temporary, '.npmrc'), `registry=${registry.href}\nignore-scripts=true\naudit=false\nfund=false\n`)
    const args = ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--include=optional', '--registry', registry.href, '--cache', join(temporary, 'npm-cache')]
    console.error(`正在通过 npm 求解 ${plugin.name}@${plugin.version}，不会执行插件脚本。`)
    await runNpm(npmCli, args, temporary)
    const lockBytes = await readFile(join(temporary, 'package-lock.json'))
    const lock = JSON.parse(lockBytes)
    const artifacts = lockArtifacts(lock, rootBytes ? plugin : undefined)
    if (artifacts.length + (rootBytes ? 1 : 0) > 1000) throw new Error('依赖包数量超过市场默认上限 1000，请拆分插件或调整部署限额')
    const packages = [], identities = new Map()
    let total = 0
    const include = bytes => {
      const info = inspectTarball(bytes)
      const risks = [...(info.installRisks ?? []), ...['preinstall', 'install', 'postinstall'].filter(name => info.manifest.scripts?.[name]).map(name => `scripts.${name}`)]
      if (risks.length) throw new Error(`${info.manifest.name}@${info.manifest.version} 需要安装脚本或本地编译；请先提供离线预构建包：${risks.join(', ')}`)
      const id = `${info.manifest.name}@${info.manifest.version}`
      const previous = identities.get(id)
      if (previous && previous !== info.sha256) throw new Error(`同一版本出现不同内容：${id}`)
      if (previous) return
      identities.set(id, info.sha256)
      total += bytes.length
      if (total > MAX_TOTAL) throw new Error('离线包原始制品总大小超过市场默认上限 256 MiB，请拆分插件')
      packages.push({ filename: `${info.manifest.name.replace(/^@/u, '').replaceAll('/', '-')}-${info.manifest.version}.tgz`, contentsBase64: bytes.toString('base64') })
      console.error(`已收集 ${id} (${bytes.length} bytes)`)
    }
    if (rootBytes) include(rootBytes)
    for (const artifact of artifacts) {
      const bytes = await downloadArchive(artifact.url, origins)
      verifyIntegrity(bytes, artifact.integrity)
      include(bytes)
    }
    if (!identities.has(`${plugin.name}@${plugin.version}`)) throw new Error('npm 锁文件没有包含目标插件')
    const bundle = {
      schema: 'starmind.enterprise-market.bundle', schemaVersion: 1, plugin,
      ...(options.title ? { title: options.title } : {}), ...(options.category ? { category: options.category } : {}),
      packages,
      prepared: { tool: 'starmind-prepare-offline/1', node: process.version, registry: registry.href, lockSha256: createHash('sha256').update(lockBytes).digest('hex'), createdAt: new Date().toISOString(), scriptsExecuted: false },
    }
    await mkdir(dirname(output), { recursive: true })
    await writeFile(pending, `${JSON.stringify(bundle)}\n`, { flag: 'wx' })
    // link/rename without replacing a user's existing deliverable.
    const { link } = await import('node:fs/promises')
    await link(pending, output)
    await rm(pending)
    console.error(`完成：${output}，共 ${packages.length} 个原始包。上传市场后仍会再次校验依赖闭包。`)
    return { plugin, packageCount: packages.length, output }
  } finally {
    await rm(pending, { force: true })
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.help) console.log('用法：node tools/prepare-offline.mjs --plugin name@1.2.3 | --tarball plugin.tgz --registry https://你的npm镜像/ --output plugin.dshbundle.json [--allow-origin https://可信制品源] [--npm-cli /path/npm-cli.js]')
    else await prepareOffline(options)
  } catch (error) { console.error(`准备失败：${error.message}`); process.exitCode = 1 }
}
