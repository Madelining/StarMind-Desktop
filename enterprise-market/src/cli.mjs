#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMarket } from './store.mjs';
import { startMarketServer } from './server.mjs';
export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...args] = argv;
  const { values } = parseArgs({ args, options: {
    'data-dir': { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'publisher' },
    port: { type: 'string' }, host: { type: 'string' }, origin: { type: 'string' }, config: { type: 'string' },
    lock: { type: 'string' }, id: { type: 'string' },
  } });
  const config = values.config ? JSON.parse(await readFile(resolve(values.config), 'utf8')) : {};
  const dataDir = values['data-dir'] ?? config.dataDir;
  if (command === 'help') { console.log('Commands: create-user --data-dir DIR --name USER [--role admin|publisher]; revoke-user --data-dir DIR --id USER_ID; serve --data-dir DIR [--host 127.0.0.1 --port 8787 --origin URL] [--config JSON]; check --data-dir DIR; unlock --data-dir DIR --lock writer|server'); return; }
  if (!dataDir) throw new Error('请用 --data-dir 指定持久化数据目录。');
  if (command === 'create-user') {
    const market = await openMarket(dataDir);
    console.log(JSON.stringify(await market.createUser(values.name, values.role), null, 2));
    return;
  }
  if (command === 'revoke-user') {
    const market = await openMarket(dataDir);
    await market.mutation(state => {
      const user = state.users.find(item => item.id === values.id);
      if (!user) throw new Error('用户不存在。');
      user.disabled = true;
      state.audit.push({ id: 'local-' + Date.now(), at: new Date().toISOString(), actor: { id: 'local-cli', name: 'local administrator' }, action: 'user-revoked', target: user.id, details: {} });
    });
    console.log(JSON.stringify({ revoked: values.id }));
    return;
  }
  if (command === 'unlock') {
    if (!['writer', 'server'].includes(values.lock)) throw new Error('--lock 必须是 writer 或 server。');
    const lockPath = join(resolve(dataDir), values.lock + '.lock');
    const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'));
    if (owner.host !== hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('锁拥有者未知或来自另一主机，请人工检查；本命令不强制删除。');
    let running = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
    if (running) throw new Error('锁记录的进程仍在运行，拒绝解除。');
    await rm(lockPath, { recursive: true });
    console.log(JSON.stringify({ unlocked: values.lock, previousPid: owner.pid }));
    return;
  }
  if (command === 'check') {
    const market = await openMarket(dataDir);
    const state = await market.readState();
    console.log(JSON.stringify({ schemaVersion: 1, users: state.users.length, publications: state.releases.length, auditEntries: state.audit.length }));
    return;
  }
  if (command === 'serve') {
    const instance = await startMarketServer({ ...config, dataDir, host: values.host ?? config.host, port: values.port ? Number(values.port) : config.port, publicOrigin: values.origin ?? config.publicOrigin, onError: (error, context) => console.error(JSON.stringify({ ...context, error: error.message })) });
    console.log(JSON.stringify({ listening: instance.origin, dataDir: resolve(dataDir) }));
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await instance.close(); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
    return instance;
  }
  throw new Error('未知命令，请运行 help。');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(JSON.stringify({ error: { code: error.code ?? 'CLI_ERROR', message: error.message, details: error.details } })); process.exitCode = 1; });
