import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { parseArgs } from 'node:util'

export const PLUGIN = '@starmind/enterprise-market-smoke'
export const HELPER = '@starmind/enterprise-market-smoke-helper'
export const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)

// Small deterministic USTAR writer, for these five synthetic fixtures only.
// Production preparation must use the package-manager-produced original tarballs.
function tarball(files) {
  const blocks = []
  for (const [name, text] of Object.entries(files)) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(name) || Buffer.byteLength(name) > 99) throw new Error('Invalid fixture path')
    const body = Buffer.from(text)
    const header = Buffer.alloc(512)
    header.write(name, 0, 100)
    const octal = (number, offset, length) => header.write(number.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii')
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8)
    octal(body.length, 124, 12); octal(0, 136, 12)
    header.fill(0x20, 148, 156)
    header.write('0', 156); header.write('ustar\0', 257, 6); header.write('00', 263, 2)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks), { level: 9 })
}

export function createFixtures({ output, origin = 'http://127.0.0.1:18765', nodeVersion = process.versions.node, baselineId }) {
  const url = new URL(origin)
  if (url.origin !== origin || url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Fixtures require a plain loopback origin')
  if (baselineId !== undefined && !/^[0-9a-f]{64}$/.test(baselineId)) throw new Error('An explicit baseline ID must be a 64-character lowercase export digest')
  const root = resolve(output)
  if (existsSync(root) && readdirSync(root).length !== 0) throw new Error('Output must be absent or empty; existing files are never removed')
  mkdirSync(root, { recursive: true })
  const files = []
  const packages = []
  const json = value => JSON.stringify(value, null, 2) + '\n'
  function put(path, bytes, role) {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const target = join(root, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, buffer)
    files.push({ path, size: buffer.length, sha256: hash(buffer), role })
  }
  const timestamp = '2026-11-03T00:00:00.000Z'
  function addPackage(name, version, source, dependencyVersion) {
    const manifest = {
      name, version, type: 'module', exports: './index.js', license: 'MIT',
      engines: { node: '>=22.19.0', ...(name === PLUGIN ? { dsh: '>=0.2.2-alpha.2 <0.3.0' } : {}) },
      ...(dependencyVersion ? { dependencies: { [HELPER]: dependencyVersion }, dsh: { bundle: { patch: 'cordis.patch.yml' } } } : {}),
    }
    const contents = { 'package/package.json': json(manifest), 'package/index.js': source }
    if (name === PLUGIN) contents['package/cordis.patch.yml'] = "- insert:\n    - id: enterprise-market-smoke\n      name: '@starmind/enterprise-market-smoke'\n"
    const bytes = tarball(contents)
    const integrity = 'sha512-' + hash(bytes, 'sha512', 'base64')
    const base = `packages/${Buffer.from(name).toString('base64url')}/${version}`
    put(`${base}/package.tgz`, bytes, 'tarball')
    put(`${base}/metadata.json`, json({ ...manifest, dist: { integrity } }), 'metadata')
    packages.push({ name, version, publishedAt: timestamp, metadataPath: `${base}/metadata.json`, tarballPath: `${base}/package.tgz`, integrity })
  }
  addPackage(HELPER, '1.0.0', "export const message = 'helper 1.0.0';\n")
  addPackage(HELPER, '1.1.0', "export const message = 'helper 1.1.0';\n")
  for (const [version, helper] of [['1.0.0', '1.0.0'], ['1.1.0', '1.1.0'], ['1.2.0', '1.1.0']]) {
    const source = `import { message } from '${HELPER}';\nexport const name = 'enterprise-market-smoke';\nexport function apply(ctx) {\n${version === '1.2.0' ? "  throw new Error('INTENTIONAL_FIXTURE_ACTIVATION_FAILURE');" : `  ctx.logger.info('StarMind fixture ${version}: ' + message);`}\n}\n`
    addPackage(PLUGIN, version, source, helper)
  }
  const catalog = {
    format: 1, title: { en: 'StarMind fixture market', zh: 'StarMind 测试市场' },
    description: { en: 'Synthetic fixtures, never deploy as production plugins', zh: '仅用于接入验证，含故意失败版本，不得用于生产' },
    plugins: [{ name: PLUGIN, title: { en: 'Enterprise market smoke', zh: '企业市场接入探针' },
      description: { en: '1.0 and 1.1 load; 1.2 intentionally throws', zh: '1.0/1.1正常加载；1.2故意抛错' },
      author: 'StarMind test fixture', 'dist-tags': { latest: '1.1.0', 'failure-probe': '1.2.0' },
      versions: ['1.0.0', '1.1.0', '1.2.0'].map(version => ({ version, publishTimestamp: Date.parse(timestamp) / 1000, source: { type: 'npm' }, engines: { dsh: '>=0.2.2-alpha.2 <0.3.0' } })) }],
  }
  put('catalog.json', json(catalog), 'catalog')
  const release = {
    schema: 'starmind.enterprise-market.release', schemaVersion: 1,
    marketId: 'com.company.starmind.fixtures', releaseName: 'SYNTHETIC-TEST-ONLY', createdAt: timestamp,
    deployment: { expectedOrigin: origin },
    runtime: { baselineId: baselineId ?? 'beta-0.2.2-alpha.2-win32-x64', dshVersion: '0.2.2-alpha.2', nodeVersion, pnpmVersion: '11.28.5', platform: 'win32', arch: 'x64' },
    catalogPath: 'catalog.json', packages,
    packageTags: { [PLUGIN]: { latest: '1.1.0' }, [HELPER]: { latest: '1.1.0' } },
    resources: [], files,
    verification: { requiredCaseIds: ['baseline', `single:${PLUGIN}@1.0.0`, `single:${PLUGIN}@1.1.0`, 'combined:initial'] },
    preparedWith: { toolVersion: 'design-fixtures-v1', nodeVersion: process.versions.node, pnpmVersion: '11.28.5' },
  }
  const releaseBytes = Buffer.from(json(release))
  writeFileSync(join(root, 'release.json'), releaseBytes)
  const snapshotId = hash(releaseBytes)
  writeFileSync(join(root, 'verification.json'), json({ schemaVersion: 1, snapshotId, assurance: 'fixture-only', status: 'not-run', cases: [], note: 'Archive/hash tests do not verify a real DSH Host or authorize production publication.' }))
  return { root, snapshotId, packages: packages.length, expectedOrigin: origin }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' }, origin: { type: 'string' }, 'node-version': { type: 'string' }, 'baseline-id': { type: 'string' } } })
    if (!values.output) throw new Error('Usage: node create-fixtures.mjs --output <empty-directory> [--origin http://127.0.0.1:18765] [--node-version <target-version>]')
    console.log(JSON.stringify(createFixtures({ output: values.output, origin: values.origin, nodeVersion: values['node-version'], baselineId: values['baseline-id'] })))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
