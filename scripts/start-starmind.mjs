/** Launch the StarMind development app with its own persistent product data. */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env }
env.DSH_DESKTOP_NEXT_HOME = env.STARMIND_HOME || env.DSH_DESKTOP_NEXT_HOME || join(root, '.starmind', 'home')
env.DSH_TELEMETRY_DISABLED ??= '1'
const child = spawn(process.execPath, [join(root, 'dsh-plugin-desktop-beta', 'scripts', 'start.mjs')], { cwd: root, env, stdio: 'inherit' })
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
