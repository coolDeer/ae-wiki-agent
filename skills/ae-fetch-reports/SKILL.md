---
name: ae-fetch-reports
description: 手动触发从上游 MongoDB ResearchReportRecord 同步已解析完成（parseStatus=completed）的研究报告元数据 + parsedMarkdownS3 直链到 raw_files 队列表（不下载正文），供后续 ae-research-ingest 按需 fetch。本 skill 是默认入口；外部 scheduler（cron / Airflow / GitHub Actions 等）也可直接调 `bun src/cli.ts fetch-reports`。
metadata:
  short-description: 手动从 mongo 拉新研究报告元数据到 raw_files 队列
---

# ae-fetch-reports

`bun src/cli.ts fetch-reports` 的 agent 入口。把 mongo 上游 `ResearchReportRecord` 里 `parseStatus='completed'` 的报告**元数据 + S3 URL** 同步到 `raw_files` 表，给 `$ae-research-ingest` 当输入。

**不再下载正文 / 不再写本地文件** —— ingest 阶段每次按 `markdown_url` HTTP 拉。

## 触发方式

- `$ae-fetch-reports` — **默认拉昨天**（按 `createTime`，本地时区）
- `$ae-fetch-reports 2026-04-25` — 拉指定日期（YYYY-MM-DD）
- `$ae-fetch-reports --all` — 跳过日期过滤，拉所有未同步的（旧的全量行为；补抓 / backfill 用）
- 自然语言：「拉一下昨天的研报」「补一下 4/25 漏的」「全量补抓」

## 何时用这个 skill

| 场景 | 是否用 skill |
|---|---|
| 日常自动拉（外部 scheduler 已配） | ❌ scheduler 直接调 `bun src/cli.ts fetch-reports` |
| 没接外部 scheduler / scheduler 失败补抓 | ✅ 用本 skill |
| 想立刻看新增内容（手动触发） | ✅ 用本 skill |
| 测试 / 限流（只想拉几篇看看）| ✅ 用本 skill 带数字参数 |

## 执行步骤

1. **解析参数**（按下表把 `$ARGUMENTS` 翻译成 CLI flag）

   | $ARGUMENTS | CLI |
   |---|---|
   | 空 | `bun src/cli.ts fetch-reports`（默认昨天）|
   | `YYYY-MM-DD`（如 `2026-04-25`）| `bun src/cli.ts fetch-reports 2026-04-25` |
   | `all` / `全量` / `补抓` | `bun src/cli.ts fetch-reports --all` |
   | 正整数 N | `bun src/cli.ts fetch-reports --all --limit N`（兼容旧用法 / 测试限流）|
   | 含日期 + 数字 | 组合，如 `bun src/cli.ts fetch-reports 2026-04-25 --limit 10` |

2. **运行 CLI**

   ```bash
   cd /Users/levin/project/agent/ae-wiki-agent && bun src/cli.ts fetch-reports [...]
   ```

   stdout 格式：

   ```
   [fetch-reports] 过滤 createTime ∈ [2026-04-26T00:00:00.000+08:00, 2026-04-27T00:00:00.000+08:00)
   ✓ meeting_minutes/Updates on Domestic GPUs
   ✓ twitter/...
   ...
   [fetch-reports] 完成: { scanned: 12, inserted: 4, skippedExisting: 8, skippedNoMd: 0, failed: 0,
                           dateRange: { start: "...", end: "..." } }
   ```

   `--all` 模式下首行变成 `全量模式（--all），跳过日期过滤`，`dateRange: null`。

3. **解读结果**

   | 字段 | 含义 |
   |---|---|
   | `scanned` | mongo cursor 扫了多少条（已经过日期过滤，除非 `--all`）|
   | `inserted` | 本次新落库的（= 新增文件数）|
   | `skippedExisting` | `research_id` 已在 raw_files 里，跳过（幂等）|
   | `skippedNoMd` | mongo doc 标 completed 但 `parsedMarkdownS3` 是 null（异常情况，记录但跳过）|
   | `failed` | INSERT 失败数（个别失败不中断整体）|
   | `dateRange` | 实际过滤区间（ISO 字符串），`null` 表示 `--all`|

4. **报告给用户**

   - 新增 `inserted` 篇报告，按 `researchType` 简单分类列一下（最多 10 条标题）
   - 询问是否立刻跑 `$ae-research-ingest` 处理新增内容

## 实际数据流（agent 心智模型）

```
mongo.ResearchReportRecord
  WHERE parseStatus='completed' AND parsedMarkdownS3 IS NOT NULL
  ORDER BY createTime DESC
        ↓
INSERT INTO raw_files (markdownUrl=parsedMarkdownS3, researchId, researchType,
                       title, mongoDoc=<full doc as JSONB>, parseStatus, ...)
  ON CONFLICT (research_id) WHERE deleted=0 DO NOTHING   (去重)
        ↓
ae-research-ingest:peek 拿 raw_file → fetch(markdownUrl) → 处理
```

正文留在 S3，每次 ingest 阶段按需 HTTP 拉。fetch-reports 只做元数据登记，从分钟级 → 秒级。

## 重要约束

- **默认日期窗口 = 本地时区昨天 [00:00, 24:00)**，按 `createTime` 过滤；`--all` 才退回旧的"全量未同步"行为
- 用 `createTime`（不是 `updateTime`）的原因：上游会对历史报告做批量 reparse / 元数据更新，这会刷新 `updateTime` 但不变 `createTime`；按 `createTime` 过滤才能拿到"真正昨天新进的内容"，避免历史 backfill 灌进队列
- mongo cursor 始终按 `createTime` 倒序，`--limit N` 控制条数
- **去重靠 `raw_files.research_id` partial unique index**（`WHERE deleted=0`），重复跑无副作用
- **不要在没确认的情况下连跑 ingest**：先把新文件清单展示给用户，由用户决定是否继续
- 单条 INSERT 失败不中断整体（catch 里只记 `failed++`），最后汇总报错
- **跟老项目的 Python 脚本无关**：本项目没有 `scripts/fetch_reports.py`，没有 `.meta.json` sidecar——所有元数据进 `raw_files.mongo_doc` JSONB 字段

## 后续动作建议

- 跑完后**默认建议** `$ae-research-ingest`，让用户决定是 triage 一篇还是批量处理
- 如果 `inserted=0`：告诉用户"没有新内容，最近一次 inserted 是 X 天前"（可选：查 `raw_files` 最大 created_at）
- 如果 `failed>0`：把失败的 researchId 列出来，提示可能的原因（DB 异常 / mongo cursor 中断）。注意 fetch-reports 不再做 HTTP 下载，URL 失效会推迟到 ingest 阶段才暴露

## 相关文件

- `src/skills/fetch-reports/index.ts` — 实现
- `src/cli.ts` (case `fetch-reports`) — CLI 入口
- `src/core/mongo.ts` — mongo client + ResearchReportRecord 类型 + researchType 枚举
- `CLAUDE.md` §"4 个用户入口" / §"调度" — 在整体流程里的位置
