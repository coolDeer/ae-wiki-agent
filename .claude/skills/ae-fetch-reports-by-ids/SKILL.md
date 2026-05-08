---
name: ae-fetch-reports-by-ids
description: 按指定 researchId 集合精准拉取报告到 raw_files 表。适合补抓特定报告、回填历史数据、或把用户给的 ID 列表批量落库。底层走 `bun src/cli.ts fetch-reports --research-ids <id1,id2,...>`。
metadata:
  short-description: 按 researchId 列表精准拉取指定报告到 raw_files
---

# ae-fetch-reports-by-ids

按用户给出的 `researchId` 列表，从上游 MongoDB 精准拉取对应报告落进 `raw_files` 表。

**适用场景：**

- 用户粘贴一批 researchId，想把这些具体报告入库再 ingest
- 补抓某次日期窗口没捞到的历史报告
- 验证特定报告的 markdown / V2 数据是否可用

不限日期、不限类型，只按 ID 匹配（自动跳过日期过滤）。

## 触发方式

- `$ae-fetch-reports-by-ids` + 用户粘贴的 ID 列表（JSON 数组 / 换行 / 逗号分隔均可）
- 自然语言：「把这几个 researchId 拉进来」「补抓一下这批报告」

## 执行步骤

1. 从 `$ARGUMENTS` 或用户消息提取 researchId 列表，支持以下格式：
   - JSON 数组：`["69f07ebb...", "69ead4c9..."]`
   - 逗号分隔：`69f07ebb...,69ead4c9...`
   - 换行分隔（从代码块或列表中解析）

2. 把 ID 列表拼成逗号分隔字符串，执行：

   ```bash
   cd /Users/levin/project/agent/ae-wiki-agent && \
   bun src/cli.ts fetch-reports --research-ids <id1,id2,...>
   ```

3. 报告结果：
   - `inserted`：新入库数量
   - `skippedExisting`：已存在、跳过数量
   - `skippedNoMd`：有 ID 但 mongodb 中无 markdown（解析未完成）
   - `failed`：写库失败数量
   - 列出每条成功记录的 `type/title`

## 示例调用

```bash
bun src/cli.ts fetch-reports --research-ids \
  69f07ebbcc43306ddf8825f7,69ead4c950645d44ec9de866,690ef01169a2e07959ada345
```

加 `--dry-run` 只预览不写库：

```bash
bun src/cli.ts fetch-reports --research-ids 69f07ebbcc43306ddf8825f7,... --dry-run
```

## 输出解读

```
[fetch-reports] 精准模式：researchIds × 19
✓ meeting_minutes/某报告标题
✓ acecamp_article/另一篇
...
[fetch-reports] 完成: { scanned: 19, inserted: 17, skippedExisting: 2, skippedNoMd: 0, failed: 0, dateRange: null }
```

- `scanned` 应等于传入的 ID 数量（精准模式不会多扫）
- `skippedNoMd`：该报告在 MongoDB 里 `parseStatus != completed` 或 `parsedMarkdownS3` 为空，无法入库

## 后续动作建议

入库完成后，用户可选：
- `$ae-research-ingest`：逐篇 triage（`ingest:peek` → `commit/brief/pass`）
- `$ae-batch-ingest N`：批量 ingest 新增的 N 篇

## 相关文件

- `src/skills/fetch-reports/index.ts` — 实现（`researchIds` 选项）
- `src/cli.ts` (case `fetch-reports`) — `--research-ids` 解析
- `skills/ae-fetch-reports-debug/SKILL.md` — 按 researchType 抽样的 debug 版本
- `skills/ae-fetch-reports/SKILL.md` — 日常日期窗口版本
