# ae-wiki-agent — 投资研究知识库

> 给 Claude Code 看的项目说明。包含**业务层**（投资 wiki schema / 工作流 / 约定）+ **代码层**（工程约定 / 命令 / 坑点）。
> 项目已 self-contained，可独立部署。

---

## 项目目标

面向投资研究的知识库 + agent 工作台。把 mongo / 平台 API 来的研报、电话会、调研纪要等素材，转成结构化、可查询、可推理的投资研究底座。Claude Code 是主要编辑者；PM / 分析师提供素材、提问、做决策。

流程主语言：**英文为主**，专业术语保持英文；中文可用于 aliases、原文引用、中文实体名和检索辅助。

设计哲学：**Thin Harness, Fat Skill**（参考 gbrain v0.20+）。core 不调 LLM，理解工作 push 到 agent skill markdown。详见 `./doc/llm-touchpoints.md`。

---

## 当前架构

```
┌────────────────────────────────────────────────────┐
│  输入层：MongoDB（团队既有 ResearchReportRecord）  │
└────────┬───────────────────────────────────────────┘
         │ bun cli fetch-reports（手动 / 内嵌调度入口）
         ↓
┌────────────────────────────────────────────────────┐
│  raw_files 表 ─ 元数据 + markdown_url（S3 直链）   │
│                  research_id 去重；不再落本地文件  │
└────────┬───────────────────────────────────────────┘
         │ ingest:peek/commit/write/finalize（按需 fetch URL）
         ↓
┌────────────────────────────────────────────────────┐
│  Postgres（线上 ae_wiki，唯一真相源）              │
│                                                     │
│  核心：pages / content_chunks / links              │
│  投资专属：facts / theses / signals / timeline     │
│  审计：events / page_versions / minion_jobs       │
└────────┬────────────────────┬──────────────────────┘
         │                    │
         ↓ MCP server         ↓ skills（agent 消费）
   search/get_page         research-ingest / enrich
   query_facts/...         thesis-track / daily-review
                           daily-summarize
```

### 仓库布局

```
ae-wiki-agent/                # 项目根
├── src/
│   ├── cli.ts                # 命令分发器，唯一入口
│   ├── core/
│   │   ├── db.ts             # postgres-js + drizzle 实例
│   │   ├── env.ts            # Zod 校验 + cached singleton
│   │   ├── audit.ts          # withAudit / withCreateAudit / Actor
│   │   ├── embedding.ts      # OpenAI embedding，可关
│   │   ├── types.ts
│   │   ├── mongo.ts
│   │   ├── schema/           # Drizzle schema（与 infra/init-v2.sql 同步）
│   │   └── search/
│   │       ├── hybrid.ts     # RRF + source-boost
│   │       └── source-boost.ts
│   ├── skills/
│   │   ├── fetch-reports/
│   │   ├── ingest/           # 8-stage pipeline
│   │   ├── enrich/           # 红链 entity 补全
│   │   └── thesis/           # 论点状态机
│   ├── workers/
│   │   └── minion-worker.ts  # FOR UPDATE SKIP LOCKED 队列消费
│   └── mcp/
│       ├── server.ts
│       └── queries.ts
│
├── infra/                    # ⭐ schema + 部署
│   ├── init-v2.sql           # schema 真相源
│   └── migrations/           # v2.1.0 / 2.2.0 / 2.3.0 ...
│
├── skills/                   # ⭐ Fat skill markdown（agent 工作流）
│   ├── fetch-reports/SKILL.md
│   ├── research-ingest/SKILL.md
│   ├── enrich/SKILL.md
│   ├── thesis-track/SKILL.md
│   ├── daily-review/SKILL.md
│   └── daily-summarize/SKILL.md
│
├── raw/                      # 原始素材，按 {date}/{researchType}/ 归档
│
├── doc/                      # 设计文档
│   ├── architecture.md
│   ├── llm-touchpoints.md
│   ├── gbrain-borrowings.md
│   └── gbrain-vs-self-build.md
│
├── scripts/
│   ├── deploy-schema.ts
│   └── run-*-migration.mjs
│
├── tests/                    # ⚠️ 目前空，待补
│
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── .env / .env.example
└── CLAUDE.md                 # 本文件
```

`.env` 里 `WORKSPACE_DIR=.` —— raw markdown 不再落盘，按需从 `raw_files.markdown_url` HTTP 拉。

---

## 4 个用户入口（skill 触发）

| 入口 | 触发 | 作用 |
|---|---|---|
| `$ae-fetch-reports` | 早 / 用户说"拉今天研报" | mongo → raw_files |
| `$ae-research-ingest` | fetch 后 / "ingest 一下" | raw → pages + facts + signals |
| `$ae-enrich` | 红链多了 / "补全 X" | confidence='low' entity → 正式 wiki 页 |
| `$ae-thesis-track` | PM 表态 / "看下论点" | 开仓 / 改 conviction / 关仓 |

外加两个**消费者**：

| 入口 | 输出 | 何时用 |
|---|---|---|
| `$ae-daily-review` | `wiki/output/daily-review-{date}.md` | 当日 ingest 后做 epistemic 复盘 |
| `$ae-daily-summarize` | `wiki/output/daily-summarize-{date}.md` | 复盘后转 PM operational 简报 |

完整日循环：

```
fetch-reports → research-ingest → enrich → thesis-track（按需）
                                              ↓
                                       daily-review → daily-summarize
```

---

## CLI 快速参考

所有命令在 `ae-wiki-agent/` 目录跑：

```bash
# 数据获取
bun src/cli.ts fetch-reports [--limit N] [--dry-run]

# Ingest 三段式（gbrain "thin harness, fat skill" 模式）
bun src/cli.ts ingest:next                      # 取下一份 raw_file，建 page 骨架
bun src/cli.ts ingest:write <pageId>            # stdin 写 agent 生成的 narrative
bun src/cli.ts ingest:finalize <pageId>         # 跑 Stage 4-8 派生

# Enrich 红链
bun src/cli.ts enrich:list [--type T] [--limit N]
bun src/cli.ts enrich:next [--type T] [--skip N]
bun src/cli.ts enrich:save <pageId> [--ticker X --sector Y --aliases A,B --confidence high|medium]

# Thesis 状态机
bun src/cli.ts thesis:list [--status active]
bun src/cli.ts thesis:show <pageId>
bun src/cli.ts thesis:open --target <slug> --direction long|short --name "X" [--conviction X]
bun src/cli.ts thesis:write <pageId>            # stdin
bun src/cli.ts thesis:update <pageId> [--conviction X --add-catalyst JSON --mark-condition C:S]
bun src/cli.ts thesis:close <pageId> --reason validated|invalidated|stop_loss|manual [--note "..."]

# 后台
bun src/cli.ts worker                           # minion_jobs 队列处理

# 调试 / 局部重跑
bun src/cli.ts facts:re-extract <pageId>
bun src/cli.ts links:re-extract <pageId>

# 类型检查（每次代码改动后必跑）
./node_modules/.bin/tsc --noEmit
```

---

## 数据模型（Postgres，17 张表）

| 表 | 作用 | 关键字段 |
|---|---|---|
| `sources` | 多租户分区 | id |
| **`pages`** | **万物皆 page** | slug / type / content / aliases / ticker / sector / confidence |
| `content_chunks` | 分段 + embedding | page_id, chunk_text, embedding |
| `links` | 类型化边 | from_page_id, to_page_id, link_type, link_source |
| `tags` | m2m 标签 | page_id, tag |
| **`facts`** | **结构化数值（投资专属）** | entity_page_id, metric, period, value_numeric, unit, valid_from/to |
| **`theses`** | **投资论点状态机** | page_id, target_page_id, direction, conviction, status, catalysts, validation_conditions |
| **`signals`** | **自动事件流** | signal_type, severity, entity_page_id, thesis_page_id |
| `timeline_entries` | 结构化事件 | entity_page_id, event_date, event_type, summary |
| `raw_files` | mongo 原文登记 | research_id, markdown_url, triage_decision, ingested_page_id, skipped_at, skip_reason |
| `raw_data` | JSONB sidecar (含 `source='tables'` 表格 artifact) | page_id, source, data |
| `page_versions` | 快照 | page_id, content, reason, snapshot_at |
| `events` | 审计 log（含 `lint_run` / `facts_expire` 报告） | actor, action, entity_type, entity_id, payload |
| `minion_jobs` | 异步队列 | name, status, data, attempts, progress |
| **`agent_messages`** | durable agent runtime 对话历史 | job_id, role, content |
| **`agent_tool_executions`** | durable agent runtime tool call log | job_id, tool_name, input, output |
| `config` | KV | id, value |

详细 DDL 见 `./infra/init-v2.sql`。Drizzle schema 见 `src/core/schema/*.ts`。

最近迁移链：v2.5.0 raw_files.markdown_url（S3 直链）→ v2.5.1 raw_files.triage_decision → v2.6.0 agent_runtime（agent_messages / agent_tool_executions）→ v2.6.1/.2 minion cancelled/paused → v2.6.3 移除 jieba_tokens（回退 v2.3.0）。

### 数据库设计原则

1. **来源至上**：所有 wiki 内容必须可追溯到 raw_files
2. **软删除**：`deleted=1` 而非物理删；UNIQUE 约束已改 partial `WHERE deleted=0`
3. **审计完整**：每行有 `create_by/update_by/created_at/updated_at`，审计走 `events` 表
4. **Provenance 一等公民**：`facts.source_page_id` / `links.origin_page_id` / `signals.source_page_id`
5. **时间旅行**：`facts.valid_from/valid_to` 记录"某指标某 period 在 X 日的 latest 是多少"
6. **不用外键**：应用层维护完整性（避免迁移痛苦）

---

## Page Schema（写 narrative 时的结构指引）

写 narrative 时按 page type 选模板，落地到 `pages.content`。**所有 agent 新写内容默认用英文**；frontmatter 里的核心字段（ticker/sector 等）通过 CLI flag 写入 pages 表对应列；其他元数据进 `pages.frontmatter` JSONB。

### 1. Source（来源摘要）

正文必含 7 段 + 末尾 YAML 块（供 Stage 5/7 直读）。详见 `./skills/ae-research-ingest/SKILL.md`。

```markdown
## Source Overview
## Key Takeaways       # 编号列表，覆盖 5 维度
                    # 1. 核心数据和变化
                    # 2. 关键判断与观点
                    # 3. 行业参与者的行为模式（结构性观察容易被忽略，但对判断行业拐点至关重要）
                    # 4. 与市场共识不同的观点（expectation gap）
                    # 5. 时效性信号（前瞻指引、超预期 / 低于预期）
## Important Data Points # 表格优先
## Notable Quotes / Views # blockquote 保留原文
                    # 优先：管理层表态、专家对结构性问题的判断、反直觉观点
## Structural Observations # 非数字判断（不得省略，没有则写"none"）
                    # 竞争对手行为模式 / 行业参与者心态变化 / 长期趋势的早期信号
## Relation To Existing Knowledge
   ### New Information / Confirms Existing View / Contradictions Or Revisions
## Follow-ups

<!-- facts
- entity: companies/<slug>
  metric: revenue | eps_non_gaap | target_price | gross_margin | ...
  period: FY2027E | 1Q26A | current | YYYY-MM-DD
  value: <number>
  unit: usd_m | pct | x | jpy_m | usd | cny_bn | ...
  source_quote: "..."
-->

<!-- timeline
- entity: companies/<slug>
  date: YYYY-MM-DD
  event_type: earnings | guidance | rating_change | product_launch | news | other
  summary: <一句话>
-->
```

> **关于 source 编译质量**：source 页是后续所有 wiki 操作的基础（实体页更新、日报、论点跟踪都基于 source，不会回读 raw）。提取容易偏向抓数字而漏掉结构性观点——后者往往才是判断拐点的关键。每次 ingest 前先问自己：这份报告里有没有"非数字但很重要"的判断？不确定时宁可多写。

### 2. Company

```markdown
## Company Overview
## Business Model
## Financial Summary
## Competitive Landscape
## Valuation
## Risk Factors
## Catalysts
## Key Timeline
## Sources
```

CLI flag 同步写：`--ticker --exchange --sector --sub-sector --country --aliases --confidence`

### 2.5 Brief（轻量前沿动态）

短素材专用模板（twitter / 单段 newsletter / 散点 chat 等），跟投资研究**弱相关但值得留痕**的内容（AI 工具 / 科技动态 / 行业八卦）。

写到 `pages.content`，要求**精简**（50-300 字），**禁止 7 段铺陈**：

```markdown
## TL;DR
<一句话摘要>

## Key Observations
- <要点 1，能用 wikilink 就用：[[industries/AI]] / [[companies/OpenAI]]>
- <要点 2>
- <要点 3>

## Investment View (Optional)
<这条动态如果对某个 thesis / industry / company 有边际信号，写一句；没有就省略本段>

## Links
- Original: <URL>
- Platform: twitter / substack / ...
```

特点：
- frontmatter 用 `tags` 表达"我关注的主题"（如 `['ai-frontier','llm','newsletter']`）
- **不要求** facts/timeline YAML 块（短素材里硬抽 fact 容易污染数据）
- Stage 5（fact）/ Stage 7（timeline）会跑但通常无产出 — 这是预期
- search 默认包含 brief 页；如要"只搜深度 source"可加 `WIKI_SEARCH_EXCLUDE=briefs/`

适用场景判定（agent 在 `ingest:peek` 后判断）：
- **commit (source)**：研报 / 纪要 / aletheia / scuttleblurb / acecamp_article 等深度内容 → 走 7 段
- **brief**：长 tweet thread / 单段 newsletter / chat_brilliant 散点 / vital_knowledge digest → 走简模板
- **pass**：纯噪声（@xx Thanks、纯个人推广无信息量）

### 3. Industry

```markdown
## Industry Overview
## Market Size And Growth
## Value Chain
## Competitive Landscape
## Key Trends
## Regulatory Environment
## Investment Opportunities And Risks
## Related Companies
## Sources
```

### 4. Thesis

```markdown
## Core Thesis         # One sentence
## Bull Case
## Bear Case
## Key Assumptions
## Validation / Falsification Conditions   # 表格：条件 | 状态 | 最新证据
## Catalyst Timeline
## Risk Management      # stop loss / re-evaluate triggers
## Thesis Evolution     # 每次 conviction 变化记录
## Sources
```

`catalysts` 和 `validation_conditions` 用 `thesis:update --add-catalyst / --mark-condition` 命令结构化进 JSONB。详见 `./skills/ae-thesis-track/SKILL.md`。

### 5. Person

```markdown
## Basic Information
## Investment Style / Management Style
## Key Views And Quotes
## Track Record
## Sources
```

### 6. Concept

```markdown
## Definition
## Use In Investment Research
## Related Concepts
## Sources
```

### 7. Comparison

```markdown
## Comparison Overview
## Comparison Dimensions
## Comparison Table
## Conclusion
## Sources
```

### 8. Metric

```markdown
## Metric Definition
## Data Log
## Trend Analysis
## Related Pages
```

完整 frontmatter 字段清单见上方各 page type 的 schema 段落（已自含）。

---

## 命名 / 链接 / 引用约定

### Slug 规则

- `pages.slug` 是唯一稳定标识，格式 `<dir>/<name>`
- `dir` ∈ `companies | persons | industries | concepts | sources | theses | outputs`
- 公司 slug 用规范英文名（如 `companies/Tencent`、`companies/600519.SH`），别名走 `aliases` 列
- 中文行业 / 概念可用中文（`industries/半导体`），但建议尽量英文
- 禁止字符：`/ \ : * ? " < > |`（slug 内容里）

### Wikilink

- `[[companies/Euglena|Euglena]]` 或 `[[companies/Euglena]]`
- 正文首次提及实体**必须**加 wikilink
- Stage 4 自动从 narrative 抽取 wikilink → links 表（typed-edge）

### 引用 / Citation

- 数据点：`（来源：[[sources/...]]）`
- 带时间：`（来源：[[sources/Arete-NVDA-260315]]，2025Q3）`
- 多 source 一致：标主要 source

### 矛盾处理

新信息与已有矛盾时：

1. **不删除**旧信息
2. 旧信息后加 `> ⚠️ 更新（YYYY-MM-DD）：[新内容]（来源：[[sources/X]]）`
3. 重大矛盾在 `events` 表记一条 action='conflict'

### 标签约定

frontmatter 中 `tags` 使用 YAML 列表，小写英文，多词用短横线：

| 分类 | 示例 |
|---|---|
| 行业 | `semiconductor`, `saas`, `fintech`, `ev`, `biotech`, `consumer` |
| 策略 | `value`, `growth`, `momentum`, `event-driven`, `distressed` |
| 地域 | `china`, `us`, `japan`, `southeast-asia`, `europe` |
| 主题 | `ai`, `deglobalization`, `aging-population`, `energy-transition` |
| 状态 | `needs-update`, `high-conviction`, `contrarian` |

---

## fetch / ingest 工作流细节

### 去重（fetch-reports 已自动处理）

- `raw_files.research_id` partial unique（`WHERE deleted=0 AND research_id IS NOT NULL`）
- `ON CONFLICT (research_id) WHERE deleted = 0 AND research_id IS NOT NULL DO NOTHING`：mongo 同 research_id 重推不重复入库

### Research type 处理

aecapllc API 不定期出新 `researchTypeName`：

- **正文不再落盘**：mongo 同步只入 `raw_files` 表（`markdown_url` 存 S3 直链），ingest 阶段按需 HTTP 拉
- **Source 页 slug 用缩写前缀**：`ace-` / `cb-` / `mm-` / `sb-` / `vk-` / `sub-` / `twitter-`
- **frontmatter `research_type` 保留 API 原值**，`source_type` 走 schema enum 最近映射：
  - `chat_brilliant` / `meeting_minutes` → `transcript`
  - `acecamp_article` / `scuttleblurb` / `substack` → `article` 或 `newsletter`
  - `vital_knowledge` → `newsletter`
  - 无映射 → `article`
- **不扩展 schema enum**：enum 是"语义分类"（抽象），researchType 是"来源标识"（具体），两者分离

### Ingest 三段式

```
ingest:next         → 取 raw_file，HTTP fetch markdown_url，建 pages 骨架，切 chunks
                      返回 {pageId, markdownUrl, ...}
agent               → 通过 markdownUrl 拉原文（preview 已在 peek 输出），按 source 模板写 narrative
                      （可主动 search 已有 wiki 页交叉引用）
ingest:write        → stdin 落 narrative，写 page_versions
ingest:finalize     → 重新 fetch markdown_url，跑 Stage 4 链接 / 5 facts / 6 jobs / 7 timeline / 8 thesis
```

> 大型文档（>50 页）分章节处理，每段确认。

### Lint（健康检查）

用户要求 lint 或定期维护时：

1. 检查**孤立页面** — 无入站链接的页面（query: `pages` 里没出现在 `links.to_page_id` 的）
2. 检查**过时信息** — 超过 30 天未更新的 active thesis（query: `theses WHERE status='active' AND update_time < NOW() - 30d`）
3. 检查**页面间矛盾** — 不同页面对同一事实的不一致描述
4. 检查**红链** — `pages WHERE confidence='low'` 还没 enrich 的
5. 检查**标签一致性** — `tags` 表 group by 看拼写是否统一
6. 检查**来源覆盖** — `raw_files WHERE ingested_at IS NULL`
7. 检查**财务数据时效** — `facts WHERE valid_to IS NULL AND period_end < CURRENT_DATE - 90d`
8. 跑完后写 `events (action='lint_run', payload={...})`

---

## Aliases 列与搜索

### 别名（aliases 列）

每个 entity page 的 `aliases TEXT[]` 列存所有等价名：

- 公司：英文全名 / 中文名 / 别称 / ticker（多国上市的多个 ticker 都填）
- 例：`companies/Tencent.aliases = ['腾讯','腾讯控股','Tencent Holdings','700.HK','TCEHY']`

aliases 已自动并入 `pages.tsv`（与 title 同权重 A），任何别名都能被 keyword 搜索命中。

### Source-aware ranking

`hybridSearch` 在 keyword + vector 通道都用 `slug` 前缀做 boost：

- `sources/Arete-` 1.5（深度模型）
- `sources/MS-/BofA-/Daiwa-` 1.3（顶级 broker）
- `sources/cb-` 0.6（chat brilliant 散点纪要，dampen）
- `companies/ industries/ thesis/` 1.4-1.5（策展页优先）

可通过 env `WIKI_SOURCE_BOOST="prefix:mult,..."` 覆盖。完整表见 `src/core/search/source-boost.ts`。

---

## MCP Tools（Claude Code 通过 stdio 调用）

7 个工具（`src/mcp/`）：

| Tool | 用途 |
|---|---|
| `search(query, filters)` | hybrid search（keyword + 可选 vector + RRF）|
| `get_page(slug)` | 拿完整 page（含 frontmatter）|
| `query_facts(entity, metric?, period?, table_only?, table_id?, include_raw_table?)` | 结构化 fact 查询，可限定表格 artifact |
| `get_table_artifact(identifier, table_id?)` | 拿 page 的表格 artifact（`raw_data.source='tables'`）|
| `compare_table_facts(metric, entities?, periods?, ...)` | 跨实体 / period 的对比矩阵（基于表格 fact）|
| `list_entities(type, filters)` | 实体列表 |
| `recent_activity(days, kinds?)` | 最近 events / signals / new pages |

**禁止**：直接 SQL execute（即使 read-only）。所有查询走 MCP 工具。

`.mcp.json` 已配好；新开 Claude Code 会话自动连。

---

## 调度

OS 层（launchd / systemd / cron）的脚本与 unit 文件已从仓库移除——不维护内部约定的部署器。运行时按需起：

- **手动**：`bun src/cli.ts fetch-reports` / `bun src/cli.ts worker` / `bun src/cli.ts agent:run --skill ae-...`
- **任意外部 scheduler**：cron / launchd / systemd / Airflow / GitHub Actions 等都可以直接 `cd ae-wiki-agent && bun src/cli.ts <cmd>` 触发；项目本身不绑定任何一种。
- **Claude Code `/schedule`**：交互层把 `$ae-research-ingest` 等 skill 挂到固定时间，是上层 agent 端的事，不在 wiki core 范围。

后续若要把"定时任务"做进 wiki，应建 `schedules` 表 + worker poll，而不是 vendoring OS 启动脚本。

---

## 技术栈（代码层）

| 层 | 选型 | 注意 |
|---|---|---|
| Runtime | **Bun 1.3.13** | 不用 Node 跑——代码用了 `Bun.CryptoHasher` / `Bun.stdin.text()` |
| Lang | TypeScript strict | `tsc --noEmit` 必须 pass |
| ORM | Drizzle 0.36 | 见下方"Drizzle 坑点" |
| DB driver | postgres-js (`postgres` @3.x) | `prepare: false`（PgBouncer 兼容） |
| Validation | Zod | env 唯一入口 `core/env.ts` |
| Embedding | `openai` SDK | text-embedding-3-large（1536 维截断），可关 |
| MCP | `@modelcontextprotocol/sdk` | stdio 模式 |

---

## 启动 / 运行

### 一次性

```bash
bun install
cp .env.example .env
# 填 DATABASE_URL / MONGODB_URI / OPENAI_API_KEY

# 部署 schema（线上 DB 已部署过，本地新 DB 才需要）
bun scripts/deploy-schema.ts
```

### 测试

**目前 0 测试**（已知缺口，Tier 0 优先级）。手测靠跑命令 + 直接查 DB。

---

## 工程约定（8 条）

### 1. 审计字段强制 helper

每张表都有 `create_by / update_by / created_at / updated_at / deleted`。**绝不允许绕过 helper**：

```typescript
// INSERT
import { withCreateAudit, Actor } from "~/core/audit.ts";
await db.insert(schema.X).values(
  withCreateAudit({ field: value }, Actor.agentClaude)
);

// UPDATE
import { withAudit } from "~/core/audit.ts";
await db.update(schema.X).set(
  withAudit({ field: value }, actor)
).where(...);
```

`Actor` 常量：`agentClaude / agentSignalDetector / agentEnricher / systemFetch / systemIngest / systemCron / systemInit / human(name)`。

### 2. ID 类型

所有 PK 是 `BIGINT GENERATED BY DEFAULT AS IDENTITY`。Drizzle 类型 `bigint("id", { mode: "bigint" })`，TS 侧是 native `bigint`。

CLI 跨进程传 ID 用字符串：`pageId.toString()` / `BigInt(pageIdStr)`。

### 3. 软删除 + partial unique

所有 UNIQUE 约束都是 `partial unique index WHERE deleted = 0`（迁移 v2.1.0 完成）。后果：

- **Drizzle 不能用 `unique()`**：得用 `uniqueIndex("name").on(...).where(sql\`deleted = 0\`)`
- **ON CONFLICT 必须带 where**：

```typescript
.onConflictDoNothing({
  target: schema.rawFiles.researchId,
  // partial 索引谓词必须显式写，否则 PG 找不到 conflict target
  where: sql`deleted = 0 AND research_id IS NOT NULL`,
})
```

不写 `where:` 会报：`there is no unique or exclusion constraint matching the ON CONFLICT specification`。

### 4. NULLS NOT DISTINCT

PG 15+ 支持，但 Drizzle 0.36 的 `uniqueIndex` builder 没暴露。当前在 `init-v2.sql` 里手维护（`uq_links` / `idx_timeline_dedup`），Drizzle schema 加注释说明。

### 5. raw markdown 加载

raw 正文不再落本地，统一从 `raw_files.markdown_url` HTTP 拉：

```typescript
import { fetchRawMarkdown } from "~/core/raw-loader.ts";
const md = await fetchRawMarkdown(rf);  // 进程内缓存，同 ingest 流程多次调用只 fetch 一次
```

老代码里的 `path.resolve(env.WORKSPACE_DIR, rf.rawPath)` 已废弃。`WORKSPACE_DIR` 现仅用于 `wiki/output/` 等派生产物。

### 6. CLI 命令模式

`src/cli.ts` 是单一 dispatcher，每个命令一个 switch case。新加命令的步骤：

1. 在 `src/skills/X/index.ts` 写业务函数（pure，不读 process.argv）
2. 在 `cli.ts` 加 case：解析 args → 调业务函数 → 输出 JSON / 字符串
3. 更新 `printHelp()` 帮助文本

dynamic import 是约定：`const { foo } = await import("./skills/X/index.ts")` ——避免 env 没填时连 help 都跑不起来。

### 7. 三段式 skill 模式

每个写流程都是：

```
prepare:next   → 取上下文，建 page 骨架，返回 JSON
agent          → 读 raw / backlinks，写 narrative
write          → stdin 落库（page.content + page_versions 快照）
finalize       → 派生（links / facts / signals / timeline）
```

每段都是幂等且可重跑（`facts:re-extract` 之类是为重跑用的）。新写 skill 沿用此模式。

### 8. tsv 全文索引维护

`pages.tsv` 由 `update_pages_tsv` trigger 自动维护，组成：

```
title (A) || aliases (A) || content (B) || timeline (C)
```

`trg_pages_tsv` 直接基于 `title + aliases + content + timeline` 维护 tsvector，应用层不再做预分词。

---

## Drizzle 坑点

1. **`nullsNotDistinct()` 在 `uniqueIndex` 上不可用**（仅在 deprecated `unique()` 上有）。需要时用 raw SQL 在 init-v2.sql 维护。
2. **`onConflictDoNothing({ target })` 的 partial unique 需要 `where`**（见上文）。
3. **数组参数不能直接传给 raw `sql\`= ANY(${arr})\``** —— 用 `inArray(col, arr)` operator 代替。
4. **`mode: "bigint"`** 必须显式声明，否则 Drizzle 把 BIGINT 当 number。
5. **vector 类型** 用 `customType<{...}>` 包装（见 `core/schema/pages.ts`）。

---

## DB 连接

```typescript
import { db, sql, schema } from "~/core/db.ts";

// drizzle ORM 风格
await db.select().from(schema.pages).where(eq(schema.pages.id, 1n));

// 原生 postgres-js 模板（适合 ad-hoc 查询 / 复杂 SQL）
const rows = await sql`SELECT * FROM pages WHERE id = ${1}`;
```

线上 DB：填在 `.env` 的 `DATABASE_URL`。schema 已部署（参考 `./infra/init-v2.sql` + `./infra/migrations/`）。

迁移流程（修改 schema）：

1. 改 `./infra/init-v2.sql`（真相源）
2. 同步 Drizzle schema（`src/core/schema/*.ts`）
3. 写迁移文件 `./infra/migrations/vX.Y.Z-描述.sql`
4. 写脚本 `scripts/run-X-migration.mjs`，**必须支持 `--dry-run`**（事务内 DDL + ROLLBACK）
5. 跑 dry-run 验证 → 真跑 → tsc 通过

---

## 环境变量

`core/env.ts` 是唯一入口，Zod 校验。**所有读 process.env 的代码都过它**。

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | postgres URL |
| `MONGODB_URI` | ✅ | — | mongo 连接串 |
| `MONGODB_DB` | ✅ | — | mongo 库名 |
| `MONGODB_COLLECTION` | — | ResearchReportRecord | |
| `OPENAI_API_KEY` | ✅ | — | embedding 用 |
| `OPENAI_EMBEDDING_MODEL` | — | text-embedding-3-large | |
| `EMBEDDING_DISABLED` | — | false | true 时跳过 embedding 调用，搜索退化为 keyword-only |
| `OPENAI_AGENT_MODEL` | — | `gpt-5-mini` | durable agent runtime 默认模型 |
| `OPENAI_FACT_EXTRACT_MODEL` | — | `gpt-5-mini` | 预留给未来 Stage 5 Tier C fact 抽取 |
| `WORKSPACE_DIR` | — | `.` | wiki/output/ 等派生产物根目录；raw 已不再落盘 |
| `WIKI_SOURCE_BOOST` | — | — | `"prefix:1.5,..."` 覆盖默认 source-boost 表 |
| `WIKI_SEARCH_EXCLUDE` | — | — | 硬排除 slug 前缀，逗号分隔 |

---

## 常见任务

### 加一张表

1. 改 `./infra/init-v2.sql` 加 CREATE TABLE
2. 写 `src/core/schema/X.ts` Drizzle schema
3. 在 `src/core/schema/index.ts` 加 `export * from "./X.ts"`
4. 写 `./infra/migrations/vX.Y.Z-add-X.sql`
5. 写 `scripts/run-add-X-migration.mjs`，dry-run + commit
6. tsc + 跑 migration

### 加一个 CLI 命令

1. 在 `src/skills/X/index.ts` 写业务函数（dynamic import 友好）
2. `src/cli.ts` 加 switch case + 帮助文本
3. tsc

### 加一个 minion job 类型

1. `src/workers/minion-worker.ts` 加 case 分支 + handler 函数
2. 触发方：在 stage-6 或别处 `db.insert(schema.minionJobs).values(...)` 入队
3. 测试：跑一次 worker 看任务被消费

### 改 hybrid search 排序

`src/core/search/hybrid.ts`。当前栈：

- keyword 通道：`content` 喂 `to_tsvector('simple', ...)` + ts_rank × source_factor
- vector 通道：HNSW 距离 / source_factor（embedding 关时整通道跳过）
- 融合：RRF（K=60）
- 后过滤：deleted / status / type / dateFrom / excludeSlugPrefixes

改 boost 表：`src/core/search/source-boost.ts` 的 `DEFAULT_SOURCE_BOOST`。

---

## LLM 介入点

**Core 不调 LLM**（gbrain "thin harness, fat skill" 模式）。所有 ingest stage / worker 都是确定性 SQL/正则/YAML 解析。

唯一需要 LLM 推理的是 ingest Step 2（agent 阅读 raw + 写 narrative），由 Claude Code 这一侧执行——prompt 在 `./skills/ae-research-ingest/SKILL.md` 里，可热改。

详见 `./doc/llm-touchpoints.md`。

---

## 重要原则

1. **来源至上** — 所有 wiki 内容必须可追溯到 raw_files
2. **不调 LLM 在 core** — 理解工作 push 到 skill / agent；core 只做确定性落库
3. **增量更新** — 不重写整页；矛盾标注，不删除
4. **交叉引用** — 积极建立 wikilink，让 typed-edge graph 长出来
5. **标注不确定性** — 每个 page 有 confidence；每个 fact 有 confidence_score
6. **English-first** — 新写 narrative / thesis / daily outputs 默认英文；中文主要用于 aliases、原文引用和中文检索
7. **审计完整** — 每个写操作都进 events 表，方便回放 / 故障定位
8. **DB 是真相** — `wiki/*.md` 是历史 / 衍生品；新内容走 ae-wiki-agent

---

## 已知限制 / TODO

| 项 | 影响 | 优先级 |
|---|---|---|
| **0 单测 / E2E** | 重构会导致回归 | ⭐⭐⭐ |
| Stage 5 Tier C LLM 兜底未实现 | 决策已固化（跳过 B，直接 C，见 `stage-5-facts.ts` 头注）；LLM 调用代码待写 | ⭐⭐ |
| chunker 是段级（mineru content_list 待接） | 长 markdown 切分质量差 | ⭐ |
| Embedding 默认关 | 搜索是纯 keyword，召回受限 | ⭐ |
| `ingest:next` legacy 兼容入口 | 标 deprecated 但未移除；批量处理时易把噪声塞进 source 池 | ⭐ |

### 近期完成（2026-04 triage 重构）

- ✅ **Triage 三分流程**：`ingest:peek` → `commit / brief / pass` 三选一（之前是二分 next/skip）。SKILL.md 已更新成默认工作流
- ✅ **`page.type='brief'`**：轻量前沿动态归宿（slug 前缀 `briefs/`，4 段精简模板，不强制 facts/timeline YAML）
- ✅ **`raw_files.skipped_at + skip_reason`**（migration v2.4.0）：跟 `deleted=1` 语义分开；`pickPending` 已加过滤；带 backfill 脚本
- ✅ **`ingest:pass / commit / brief / skip`** 四个新 CLI 命令上线（src/skills/ingest/index.ts）
- ✅ **Stage 3 frontmatter 解析**：narrative 顶部 YAML 块用 `gray-matter` 解析后合并进 `pages.frontmatter`（之前丢弃）
- ✅ **Stage 4 link_type 默认 `'mention'`**（之前空字符串）；旧数据已批量回填
- ✅ **`enrich_entity` minion handler 上线**：通过 `agent_run` 队列调起 `ae-enrich`（`src/core/minions/worker.ts`）
- ✅ **Durable agent runtime**：`agent_messages` / `agent_tool_executions` + supervisor / queue / worker 拆出 `src/core/minions/`；`ae-wiki agent:* / jobs:*` CLI 全套
- ✅ **MCP 表格 artifact**：`raw_data.source='tables'` + `get_table_artifact` / `compare_table_facts` / `query_facts(table_only)` 三件套（见 `doc/table-artifacts.md`）
- ✅ **`lint_run` / `facts_expire` minion job**：`ae-wiki lint:run` / `facts:expire` CLI 同步入口，亦可通过队列定时跑（`src/skills/lint`, `src/skills/facts/expire.ts`）

---

## 抽离独立仓库（已完成）

`raw/` `infra/` `skills/` `doc/` 都已经搬进本目录。`WORKSPACE_DIR=.`。
代码 + 脚本里所有相对路径已更新。

剩余可选步骤：

```bash
# 把本目录变成独立 git repo（与原 llm-wiki/ 解耦）
cd ae-wiki-agent
git init
git add .
git commit -m "extract from llm-wiki"
# 然后可以 mv 到任意位置 / push 到独立 remote
```

老的 llm-wiki/ 父目录现在只剩 `wiki/`（只读历史）+ `templates/` + `karpathy LLM Wiki.md` + 根 CLAUDE.md/AGENTS.md（与本文件高度重叠，可删）。

---

## 进一步阅读

- `./doc/architecture.md` — ingest 8-stage 详解 + 设计决策
- `./doc/llm-touchpoints.md` — LLM 调用点地图
- `./doc/gbrain-borrowings.md` — gbrain 借鉴清单
- `./skills/*/SKILL.md` — 每个 skill 的工作流（agent 读这些）
- `./infra/init-v2.sql` — schema 真相源
- `src/core/schema/*.ts` — Drizzle schema（与 SQL 同步）
- `./skills/*/SKILL.md` — 每个 skill 的工作流（agent 读这些）
- `./infra/init-v2.sql` — schema 真相源
- `src/core/schema/*.ts` — Drizzle schema（与 SQL 同步）
