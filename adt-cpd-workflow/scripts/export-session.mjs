#!/usr/bin/env node
/**
 * 把 StarMind 会话存档导出为可读 Markdown。
 *
 * 用法：node scripts/export-session.mjs <session.v4.jsonl.zstd> <输出.md>
 *
 * 背景：会话文件是「多帧 zstd 串联」，每追加一条记录就追加一个 zstd 帧。
 * Node 的 zstdDecompressSync 只解第一帧就返回，所以这里按帧魔数 0x28B52FFD 切分后逐帧解压。
 * 会被误判的魔数（恰好出现在压缩数据内部）通过「解压失败即跳过」过滤掉。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function decodeSessionFile(file) {
  const buf = readFileSync(file)
  const starts = []
  let i = 0
  while ((i = buf.indexOf(MAGIC, i)) !== -1) { starts.push(i); i += 4 }
  const parts = []
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k]
    const to = k + 1 < starts.length ? starts[k + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(from, to))) } catch { /* 误判帧 */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

const fmt = ts => {
  if (!ts) return '—'
  const d = new Date(ts), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const clip = (s, n) => {
  s = String(s ?? '')
  return s.length > n ? s.slice(0, n) + `\n…（原文共 ${s.length} 字，此处截断）` : s
}
const textOf = content => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(p => p?.type === 'text').map(p => p.text).join('\n\n')
}

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) {
  console.error('用法：node scripts/export-session.mjs <session.v4.jsonl.zstd> <输出.md>')
  process.exit(2)
}

const events = decodeSessionFile(input)
  .split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l) } catch { return null } })
  .filter(Boolean)

const cfg = events.find(e => e.type === 'session') ?? {}
const out = []
const stats = { user: 0, assistant: 0, tools: 0 }
let turn = 0

out.push('# 对话记录')
out.push('')
out.push('> 由 StarMind 会话存档导出。推理过程未收录；过长工具输出已截断并标注原始字数。')
out.push('')
out.push(`- **会话 ID**：\`${cfg.id ?? 'unknown'}\``)
out.push(`- **开始时间**：${fmt(cfg.createdAt)}`)
out.push(`- **工作目录**：\`${cfg.cwd ?? ''}\``)
out.push(`- **事件数**：${events.length}`)
out.push('')
out.push('---')
out.push('')

for (const ev of events) {
  const d = ev.data ?? {}
  if (ev.type === 'turn/start') { turn = d.turn ?? turn; continue }

  if (ev.type === 'user/message') {
    if (d.source?.kind !== 'user') continue          // 跳过系统注入的上下文
    const text = textOf(d.content)
    if (!text.trim()) continue
    stats.user++
    out.push(`## 用户 · 第 ${turn || stats.user} 轮`, '', `*${fmt(ev.time)}*`, '', clip(text, 6000), '')
    continue
  }

  if (ev.type === 'assistant/message') {
    const text = textOf(d.message?.content)
    if (text.trim()) { stats.assistant++; out.push('### 助手', '', clip(text, 12000), '') }
    continue
  }

  if (ev.type === 'tool/call') {
    stats.tools++
    out.push(`<details><summary><code>${d.name}</code></summary>`, '', '```json', clip(d.arguments ?? '', 1200), '```', '', '</details>', '')
    continue
  }

  if (ev.type === 'tool/result') {
    const text = textOf(d.message?.content ?? d.content)
    if (!text.trim()) continue
    out.push('<details><summary>工具结果</summary>', '', '```text', clip(text, 1500), '```', '', '</details>', '')
    continue
  }

  if (ev.type === 'deliverables/presented') {
    out.push(`> 📎 交付物：${(d.files ?? []).map(f => f.path ?? f).join(', ')}`, '')
  }
}

out.push('---', '', `**统计**：用户提问 ${stats.user} 次 · 助手回复 ${stats.assistant} 段 · 工具调用 ${stats.tools} 次。`)

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, out.join('\n'), 'utf8')
console.log(`written ${output} (${(out.join('\n').length / 1024).toFixed(1)} KB, ${stats.user} 轮)`)
