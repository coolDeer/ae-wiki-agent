---
name: ae-batch-ingest
description: 用 subagent 并行批量跑 ae-research-ingest，避免主对话 context 爆量。按指定数量挑 pending raw_files，每个分配给独立 subagent 处理，主对话只接收摘要。
---

# ae-batch-ingest

**这个 skill 不自己 ingest**——它是一个**编排器**，把 ae-research-ingest 的实际工作 fan-out 给 subagents，主对话只协调和汇总。

## 何时用

| 场景 | 用 |
|---|---|
| 单篇 / 想精读 / 手把手控制 | `$ae-research-ingest`（主对话亲自跑）|
| 5+ 篇批量 / 不想在主对话写多个 narrative | **`$ae-batch-ingest`**（本 skill）|
| 100+ 篇 / 长期后台跑 / 服务器有 worker 池 | enqueue agent_run + 服务器 worker（不用本 skill）|

## 触发方式

- `$ae-batch-ingest` — 默认 batch=5, concurrency=3
- `$ae-batch-ingest 10` — 处理 10 篇
- `$ae-batch-ingest 20 --concurrency 5` — 调高并行（注意 OpenAI rate limit）
- `$ae-batch-ingest --ids 348,347,346` — 指定具体 rawFileIds（绕过 peek）
- 自然语言：「批量 ingest 10 篇」「用 subagent 跑 20 篇」

## 关键约束

### 1. 不要 peek，用具体 rawFileId

**peek 是有状态的**：多个 subagent 并行调 peek 会拿到同一行 → 重复处理 + 浪费。

正确做法：编排器（你）**先查 DB 拿 N 个 pending rawFileIds**，每个 subagent 收到**指定的 rawFileId**，subagent 直接调 `ingest:commit <id>` / `ingest:brief <id>` / `ingest:pass <id>`，跳过 peek。

```sql
-- 编排器先跑这个查询拿 ID 列表
SELECT id, title, research_type
FROM raw_files
WHERE deleted=0 AND ingested_page_id IS NULL AND skipped_at IS NULL
ORDER BY id ASC
LIMIT N;
```

### 2. 并发度有限制

默认 concurrency=3。同时跑太多有两个风险：
- **OpenAI rate limit**：每个 subagent 都调 LLM，3 个同时调通常没问题；超过 5 注意 RPM/TPM
- **DB 连接**：每个 subagent 进程拉一个 pool，并发太高耗连接

参数 `--concurrency` 上限建议 **5**。

### 3. 失败重试是编排器的责任

subagent 跑挂了不会自动 retry（不像 agent_run 走 minion_jobs）。编排器（你）收到失败结果后：
- 把失败的 rawFileId 收集起来
- 报告给用户
- 用户决定是否重 spawn

不要循环重 spawn 同一个失败的 subagent——可能 raw 本身有问题（V2 缺失 / chunk 太长等），多次 retry 浪费。

## 编排流程

```
1. 解析参数（count / concurrency / ids）
2. 查 DB 拿 pending rawFileIds（除非用户指定 --ids）
3. 切分成 concurrency-sized batch
4. 对每个 batch:
   - 单条消息里同时 spawn concurrency 个 Agent 工具调用
   - 每个 Agent 拿到一个 rawFileId
   - 等所有 batch 内的 subagent 返回再开下一批
5. 汇总结果：
   - decision 分布（commit / brief / pass）
   - 总 facts / wikilinks / red links 数
   - 失败的 rawFileId 列表
6. 报告给用户
```

## Subagent prompt 模板

每个 subagent 收到的 prompt 必须包含：

```
You are processing raw_file #<rawFileId> for ae-wiki-agent.

Project root: /Users/levin/project/agent/ae-wiki-agent
Skill spec to follow: .claude/skills/ae-research-ingest/SKILL.md (read it first)

Steps:
1. cd /Users/levin/project/agent/ae-wiki-agent
2. Read the skill spec at .claude/skills/ae-research-ingest/SKILL.md
3. **Do NOT call `ingest:peek`**. The orchestrator already chose raw_file #<rawFileId>.
4. Fetch the raw markdown:
   - First: bun -e "import { sql } from './src/core/db.ts'; const r = await sql\`SELECT markdown_url, title, research_type, raw_char_count FROM raw_files WHERE id=<rawFileId>\`; console.log(JSON.stringify(r[0])); await sql.end();"
   - Then: curl -s <markdownUrl> -o /tmp/raw-<rawFileId>.md
5. Triage (commit / brief / pass) per skill rules. Use v2Stats heuristics + content density.
6. Run the chosen command:
   - commit: bun src/cli.ts ingest:commit <rawFileId>  → returns pageId
   - brief:  bun src/cli.ts ingest:brief  <rawFileId>  → returns pageId
   - pass:   bun src/cli.ts ingest:pass   <rawFileId> --reason "<reason>"  → done, return summary
7. If commit/brief: write narrative to raw/narrative-<pageId>.md per skill template
   (7-section for commit, 4-section for brief), then:
   - bun src/cli.ts ingest:write <pageId> --file raw/narrative-<pageId>.md
   - bun src/cli.ts ingest:finalize <pageId>
8. Return a concise JSON result (max 300 chars):
   {
     "rawFileId": <id>,
     "decision": "commit" | "brief" | "pass",
     "pageId": <pageId or null>,
     "title": "<short title>",
     "factCount": <int>,
     "wikilinkCount": <int>,
     "redLinksCreated": <int>,
     "summary": "<one-sentence what the source is about>"
   }

Constraints:
- English narrative; YAML frontmatter required (tags, view_side; brief also needs url, platform)
- Typed wikilinks where appropriate ([[slug|TYPE: display]])
- Facts must have source_quote
- DO NOT modify other raw_files
- DO NOT skip the finalize step
- If commit fails (raw already ingested / no V2), mark pass with reason and return
```

## 结果汇总格式

完成所有 batch 后，给用户一个紧凑报告：

```
✓ batch ingest 完成 N/M 篇

decision 分布:
  commit  N1   (生成 X facts, Y wikilinks)
  brief   N2   (生成 P facts, Q wikilinks)
  pass    N3

新建红链: company X, concept Y, industry Z

失败 (N4):
  raw#... title=...  err=...
```

详细每篇 detail 不展开（subagent 已经把 narrative 落库了，要看走 `bun src/cli.ts get_page <pageId>` 或 web UI）。

## 与 ae-research-ingest 的边界

| ae-research-ingest | ae-batch-ingest |
|---|---|
| 主对话亲自跑 | spawn subagent 跑 |
| 单篇深度 / 教学 | 多篇并发 / 工厂化 |
| context 重 | context 轻 |
| 完整 SKILL.md 教学体内嵌 | 引用 ae-research-ingest 的 SKILL.md，不重复 |

**Subagent 实际上 follow ae-research-ingest 的 SKILL.md**——本 skill 只负责"如何拆任务、如何 spawn、如何汇总"。

## 不在本 skill 范围

- 单篇高质量 ingest → `$ae-research-ingest`
- 服务器后台批量跑 → `bun src/cli.ts agent:run --skill ae-research-ingest`（× N 个）+ supervisor
- 已 ingested page 的更新 / 重 ingest → `ingest:promote` / `enrich:save --append`
