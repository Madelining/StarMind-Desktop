/** Headless adapter to the same official operation used by `dsh plugin`. */
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations'
import { bundledPnpmEntry } from './bundled-pnpm.ts'
import { NEXT_PACKAGE, NextProfiles, profileName } from './profiles.ts'
import { withDesktopPnpmPolicy } from './pnpm-policy.ts'
import { readEnterpriseMarketConfig } from './enterprise-market.ts'

async function main(): Promise<void> {
  const name = profileName(process.argv[2])
  const home = process.env.DSH_HOME
  if (!home) throw new Error('Next plugin operations require their owning home')
  if (readEnterpriseMarketConfig(home).enabled) throw new Error('企业模式请在 StarMind 企业插件市场执行包安装、更新和卸载；此 CLI 入口已停用，避免绕过批准版本。')
  const result = await runPluginCommand({ profile: name, home,
    dir: new NextProfiles(home).directory(name), installAnchor: NEXT_PACKAGE, cwd: process.cwd(),
  }, withDesktopPnpmPolicy(process.argv.slice(3)), {
    execution: 'cli', command: process.execPath, args: ['--expose-internals', bundledPnpmEntry(NEXT_PACKAGE)],
    outputBytes: 16384, lockWaitMs: 120000,
    onOutput: (text, stream) => { process[stream].write(text) },
  })
  process.exitCode = result.exitCode
}

void main().catch((cause: unknown) => {
  process.stderr.write(`Next plugin operation failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
  process.exitCode = 1
})

