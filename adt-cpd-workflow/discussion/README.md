# 对话记录

本目录保存与 StarMind 讨论方案时的完整会话记录，用于复盘「结论是怎么来的」，而不是只看最终文档。

| 文件 | 内容 | 规模 |
|---|---|---|
| `2026-11-01-ADT-CPD-方案讨论.md` | 从「自动化任务是什么」到「设计定稿 + 评审材料」的完整对话，含每次工具调用的入参与关键输出 | 约 127 KB |

## 记录了什么

- 用户的每一轮提问原文
- 助手的每一段回答原文
- 工具调用（`grep` / `pwsh` / `write` / `present` / `skill` 等）及其结果摘要
- 过长输出已截断，并标注原文总字数

## 没有记录什么

- **推理过程（reasoning）**：模型内部的思考链未收录。
- 图片类工具的输出内容（只保留调用记录）。
- 子 agent 的独立会话：它们有自己的会话存档，未并入本文档。

## 怎么再导出一份

会话存档位于 `<DSH_HOME>/sessions/<workspace>/<session-id>/session.v4.jsonl.zstd`。
这个文件是**多帧 zstd 串联**格式，Node 自带的 `zstdDecompressSync` 只解第一帧，需要用脚本逐帧解码：

```bash
node scripts/export-session.mjs <session.v4.jsonl.zstd 路径> <输出.md 路径>
```

脚本会把事件流渲染成 Markdown（用户 / 助手 / 工具调用 / 工具结果）。
