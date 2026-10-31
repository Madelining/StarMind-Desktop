/** Export StarMind artwork on Windows, macOS or Linux, including native application and tray resources. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { iconSourceDigest, LINUX_ICON_SIZES } from './export-app-icons.mjs'
import { generateWindowsAppIcon } from '../dsh-plugin-desktop/scripts/generate-windows-app-icon.mjs'
import { generateMacAppIcon } from '../dsh-plugin-desktop/scripts/generate-mac-app-icon.mjs'

const root = resolve(import.meta.dirname, '..')
const sharp = createRequire(join(root, 'dsh-plugin-desktop/package.json'))('sharp')
const logoPath = join(root, 'assets/starmind-logo.svg')
const args = process.argv.slice(2)
if (args.includes('--logo')) {
  const input = args[args.indexOf('--logo') + 1]
  if (!input) throw new Error('--logo requires the path to the StarMind artwork')
  // An SVG wrapper gives bitmap and vector artwork the same renderer interface.
  const png = await sharp(resolve(input)).resize(1024, 1024, { fit: 'contain', background: '#00000000' }).png().toBuffer()
  writeFileSync(logoPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image width="1024" height="1024" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`)
}
const logo = readFileSync(logoPath, 'utf8').trim()
const logoData = 'data:image/svg+xml;base64,' + Buffer.from(logo).toString('base64')
const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><image width="1024" height="1024" href="${logoData}"/></svg>`
// Native welcome uses this asset as a CSS mask: its background must stay transparent.
const transparentMark = existsSync(join(root, 'assets/starmind/starmind-tray-on-light.svg'))
  ? readFileSync(join(root, 'assets/starmind/starmind-tray-on-light.svg'), 'utf8').replace(/ transform="[^"]*"/u, '')
  : logo.replace(/<rect\b[^>]*\/>/u, '')
const composerSvg = transparentMark
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function icnsChunk(type, bytes) {
  const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(bytes.length + 8, 4)
  return Buffer.concat([header, bytes])
}

for (const name of ['dsh-plugin-desktop-beta', 'dsh-plugin-desktop', 'dsh-desktop-next']) {
  const directory = join(root, name)
  const build = join(directory, 'build')
  mkdirSync(build, { recursive: true })
  writeFileSync(join(directory, 'src/starmind-artwork.ts'), '/** Generated from assets/starmind-logo.svg by scripts/export-starmind-icons.mjs. */\nexport const STARMIND_LOGO_SVG = ' + JSON.stringify(logo) + '\n')
  const iconSource = join(build, 'app-icon.icon')
  const iconAssets = join(iconSource, 'Assets')
  mkdirSync(iconAssets, { recursive: true })
  writeFileSync(join(iconAssets, 'StarMind.svg'), composerSvg)
  // Keep the historical filename usable for old native UI imports while replacing its artwork.
  writeFileSync(join(iconAssets, 'DeepSeek.svg'), composerSvg)
  const compositionPath = join(iconSource, 'icon.json')
  const composition = JSON.parse(readFileSync(compositionPath, 'utf8'))
  composition.fill = '#123D32'
  for (const group of composition.groups) {
    if (group.name?.includes('Badge')) group.hidden = true
    for (const layer of group.layers ?? []) if (layer['image-name'] === 'DeepSeek.svg' || layer['image-name'] === 'StarMind.svg') {
      layer['image-name'] = 'StarMind.svg'; layer.name = 'StarMind'; group.name = 'StarMind'
      layer.position = { scale: 1, 'translation-in-points': [0, 0] }
    }
  }
  writeFileSync(compositionPath, JSON.stringify(composition, null, 2) + '\n')
  await sharp(Buffer.from(appSvg)).ensureAlpha().withIccProfile('srgb').toColourspace('rgb16').png().toFile(join(build, 'app-icon.png'))
  await generateMacAppIcon(join(build, 'app-icon.png'), join(build, 'app-icon-mac.png'))
  await generateWindowsAppIcon(join(build, 'app-icon.png'), join(build, 'app-icon.ico'))
  const chunks = []
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    chunks.push(icnsChunk(type, await sharp(join(build, 'app-icon-mac.png')).resize(size, size).png().toBuffer()))
  }
  const icns = Buffer.concat(chunks)
  writeFileSync(join(build, 'app-icon.icns'), icnsChunk('icns', icns))
  mkdirSync(join(build, 'icons'), { recursive: true })
  for (const size of LINUX_ICON_SIZES) await sharp(Buffer.from(appSvg)).resize(size, size).png().toFile(join(build, `icons/${size}x${size}.png`))
  const traySource = transparentMark
  writeFileSync(join(build, 'tray-icon.svg'), traySource)
  for (const [filename, color, size] of [
    ['tray-iconTemplate.png', '#000000', 16], ['tray-iconTemplate@2x.png', '#000000', 32],
    ['tray-icon-blue.png', '#4D6BFE', 16], ['tray-icon-blue@1.25x.png', '#4D6BFE', 20],
    ['tray-icon-blue@1.5x.png', '#4D6BFE', 24], ['tray-icon-blue@2x.png', '#4D6BFE', 32],
  ]) {
    const original = existsSync(join(root, `assets/starmind/starmind-tray-on-light-${size}.png`))
      ? readFileSync(join(root, `assets/starmind/starmind-tray-on-light-${size}.png`)) : undefined
    const rendered = filename.includes('Template')
      ? await sharp(Buffer.from(traySource.replace(/fill="#[\da-f]+"/giu, 'fill="#000000"'))).resize(size, size).png().toBuffer()
      : original ?? await sharp(Buffer.from(traySource)).resize(size, size).png().toBuffer()
    writeFileSync(join(build, filename), rendered)
    if (existsSync(join(directory, 'assets'))) writeFileSync(join(directory, 'assets', filename), rendered)
  }
  for (const size of [16, 20, 24, 32]) {
    const source = join(root, `assets/starmind/starmind-tray-on-dark-${size}.png`)
    if (!existsSync(source)) continue
    const suffix = size === 16 ? '' : size === 20 ? '@1.25x' : size === 24 ? '@1.5x' : '@2x'
    for (const target of [build, join(directory, 'assets')]) {
      if (existsSync(target)) writeFileSync(join(target, `tray-icon-on-dark${suffix}.png`), readFileSync(source))
    }
  }
  const outputs = ['app-icon.png', 'app-icon-mac.png', 'app-icon.ico', 'app-icon.icns', ...LINUX_ICON_SIZES.map(size => `icons/${size}x${size}.png`)]
  writeFileSync(join(build, 'app-icon.resources.json'), JSON.stringify({
    source: 'app-icon.icon', sourceSha256: iconSourceDigest(iconSource),
    mac: { input: 'app-icon.icon', legacy: 'app-icon.icns', catalogName: 'Icon' },
    png: { platform: 'cross-platform', rendition: 'StarMind', size: 1024 },
    linux: { input: 'app-icon.png', sizes: LINUX_ICON_SIZES },
    outputs: Object.fromEntries(outputs.map(file => [file, hash(readFileSync(join(build, file)))])),
  }, null, 2) + '\n')
  console.log(`StarMind: exported app, tray and web artwork for ${name}`)
}
