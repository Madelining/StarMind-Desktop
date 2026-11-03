import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { openMarket } from '../src/store.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const terminal = createInterface({ input: stdin, output: stdout })
try {
  let config
  try { config = JSON.parse(await readFile('market.config.json', 'utf8')) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    const bytes = await readFile('market.config.example.json')
    await writeFile('market.config.json', bytes, { flag: 'wx' })
    config = JSON.parse(bytes)
  }
  const name = (await terminal.question('发布用户名称：')).trim()
  const market = await openMarket(config.dataDir)
  const receipt = await market.createUser(name, 'publisher')
  console.log(`\n用户：${receipt.user.name}\n发布令牌（只显示一次，请私下交给该用户）：\n${receipt.token}\n\n在市场右上角“发布者登录”中输入令牌，即可自行上传和发布插件。`)
} catch (error) { console.error(`创建失败：${error.message}`); process.exitCode = 1 }
finally { terminal.close() }
