# LLM Wiki 整体架构（v2 — 投资研究专用）

> 面向**研究报告 + 投资分析**场景的 Postgres + pgvector 架构方案。
> 本文是 v2 设计的**单一真相文档**——schema、原则、SQL、迁移路径都在这里。
>
> **Status**: v2 已上线，schema 在生产 (`infra/init-v2.sql` + `infra/migrations/v2.1.0 → v2.6.3`)；v1 三表（wiki_pages / wiki_links / raw_sources）已废弃。本文档与代码同步到 2026-04-28。
>
> **关联文档**：
> - `CLAUDE.md` — wiki schema 与 ingest 工作流（人 / LLM 视角）
> - `infra/init-v2.sql` — v2 schema 的可执行 DDL（一次性运行即建库）
> - 参考实现：`demo/gbrain` — 通用知识大脑的开源实现，借鉴其"万物皆 page"+ provenance 设计

---

## 1. 设计目标

### 1.1 业务目标

支持研究员 + LLM agent 协作完成的核心工作流：

1. **每日 ingest**：fetch → 解析 → 结构化入库
2. **跨源 Q&A**：「NOW FY27 EPS 各 broker 怎么估」「天孚通信最近一次业绩 vs 一致预期」
3. **论点跟踪**：active thesis 状态机 + 自动 catalyst 提醒
4. **共识漂移监控**：Arete vs 街口的差距如何随时间变化
5. **跨实体关联**：「光模块产业链空头逻辑同时影响哪些股票」
6. **每日复盘 / IC briefing**：从 wiki 全量数据自动生成（已有 daily-review / daily-summarize skill）

### 1.2 非业务目标

- **不做** 实时大盘行情（用 Bloomberg / Wind）
- **不做** 量化回测（用专用平台）
- **不做** 通用知识库（不是企业 wiki）
- **不做** 自动交易决策（agent 只输出建议，PM 拍板）

### 1.3 设计约束

- **Postgres + pgvector 已部署**，env 配置 URL 即可
- **LLM 是主要编辑者**，研究员只做关键修订和拍板
- **DB 是唯一存储**：不维护 markdown 文件，不做 Obsidian 兼容、不做双向同步
- **3 个工程师月 MVP 上限**

### 1.4 关键原则：所有 summarization 由 wiki 自己完成

**不依赖上游解析器（mineru / fetch 平台）的任何 summarization 字段**——它们可能未来不存在或质量不一。

我们只信任上游提供的：
- ✅ **原文 markdown**（mineru 把 docx/pdf 转出来的 narrative）
- ✅ **content_list.json 的结构边界**（type=text/list/table/chart 的分段，**仅作 chunk 切分提示**）
- ✅ **API metadata**（researchType / title / createTime 等离散字段）

不依赖：
- ❌ AI 总结（tone / stock_recommendations / technology_trends 等）
- ❌ 任何上游"解读"性内容

**所有的语义提炼**（要点、结构性观察、tone、个股看法、行业判断）**都由 wiki 自身的 ingest agent 在读 narrative 时生成**，写入 `pages.content`、`facts` 等结构化字段。这样：
- 不绑死任何上游平台的特性
- 总结风格可控（按 CLAUDE.md schema）
- 上游格式变化不影响下游 schema

### 1.5 关键原则：Thin Harness, Fat Skill

借鉴 gbrain v0.20+ 设计：**core（`src/core/`）不调用 LLM，所有理解 / 推理工作 push 到 skill markdown**（`skills/ae-*/SKILL.md`）。

- core 只做**确定性落库**：SQL / 正则 / YAML 解析 / chunking。整个 ingest pipeline 主路径里没有一处 LLM 调用。
- 每个 skill 是一份 `SKILL.md`，agent（Claude Code 主会话 或 OpenAI durable runtime）按其指引执行三段式 / 多段式 CLI：
  ```
  prepare:next   → 取上下文，建 page 骨架
  agent          → 读 raw / backlinks，写 narrative
  write          → stdin 落库
  finalize       → 派生（links / facts / signals / timeline）
  ```
- 改流程改 markdown 即可，**不用动 TS 代码**——这是这套系统能在 4 周 MVP 内跑起来的关键。
- 详见 `doc/llm-touchpoints.md`。

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                  Layer 6: Client / Agent                          │
│  Claude Code (主会话, MCP)  │  CLI tool  │  Web UI (Phase 3)      │
└──────────────────┬───────────────────────────────────────────────┘
                   │ MCP / CLI
┌──────────────────▼───────────────────────────────────────────────┐
│              Layer 5: Skills (Fat Skill, markdown-driven)         │
│   ae-fetch-reports / ae-research-ingest / ae-enrich               │
│   ae-thesis-track  / ae-daily-review     / ae-daily-summarize     │
│   ae-analyze-ideabot / ae-analyze-timebot                         │
│   每个 skill = SKILL.md + 可选 agents/openai.yaml                  │
└────────┬───────────────────────────────────────────┬─────────────┘
         │ Claude Code 主会话当 LLM                   │ OpenAI durable runtime
         │                                           │ (gpt-5-mini 默认)
         │                                           ▼
         │                       ┌──────────────────────────────────────┐
         │                       │  Layer 4b: Durable Agent Runtime     │
         │                       │  src/agents/runtime.ts               │
         │                       │  src/core/minions/{worker,supervisor}│
         │                       │  对话历史 → agent_messages           │
         │                       │  tool 调用 → agent_tool_executions   │
         │                       │  job 状态 → minion_jobs (agent_run)  │
         │                       └──────────────────┬───────────────────┘
         │                                          │
         ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Layer 4a: Service / Business Logic (TS, no LLM)         │
│   ingest 三段式 (peek/commit/brief/pass → write → finalize)          │
│   stage-1 skeleton / stage-2 chunk + table artifact                 │
│   stage-3 narrative / stage-4 links / stage-5 facts                 │
│   stage-6 jobs / stage-7 timeline / stage-8 thesis                  │
│   embedding pipeline / minion worker (embed_chunks /                │
│      detect_signals / enrich_entity / agent_run /                   │
│      lint_run / facts_expire)                                       │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────────────┐
│                       Layer 3: Search                                │
│   keyword (tsvector, title^A + aliases^A + content^B + timeline^C)  │
│   vector (pgvector HNSW, 可关)                                       │
│   RRF fusion → source-boost → exclude-prefix → dedup                │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────────────┐
│              Layer 2: Postgres + pgvector (17 表)                    │
│   sources (多租户)                                                   │
│   pages (万物皆 page)  │ content_chunks │ links │ tags               │
│   facts │ theses │ signals │ timeline_entries (投资专属)              │
│   raw_files (markdown_url + triage_decision)                        │
│   raw_data (含 source='tables' artifact) │ page_versions │ events    │
│   minion_jobs │ agent_messages │ agent_tool_executions │ config      │
└──────────────────┬──────────────────────────────────────────────────┘
                   │ raw 不再落本地，按需 HTTP 拉
┌──────────────────▼──────────────────────────────────────────────────┐
│              Layer 1: Upstream (read-only)                           │
│   MongoDB ResearchReportRecord (元数据 + parseStatus)                 │
│   S3 parsedMarkdownS3 (mineru 解析后的 markdown，HTTP 直链)           │
└─────────────────────────────────────────────────────────────────────┘
                   ▲
                   │ ae-fetch-reports skill (手动 / 任意外部 scheduler)
                   │ (1) 查 ResearchReportRecord WHERE parseStatus='completed'
                   │ (2) INSERT raw_files (markdown_url + record_id 去重；研究方一份 researchId 可对应多稿)
                   │   raw 正文不落盘，ingest 时按需 fetch markdown_url
```

### 2.1 关键设计决策

| 决策                  | 选择                                                  | 理由                       |
| ------------------- | --------------------------------------------------- | ------------------------ |
| **Source of truth** | Postgres                                            | 多源 / 多人 / 时间轴查询的天然胜场     |
| **存储边界**          | DB 是唯一存储；raw 正文不落本地，ingest 时按 `raw_files.markdown_url` HTTP 拉 | 避免双写一致性 + 节省磁盘；进程内缓存使一次 ingest 只 fetch 一次 |
| **理解 vs 落库分层** | core 不调 LLM；推理 push 到 SKILL.md（Thin Harness, Fat Skill） | 改流程改 markdown 不动代码；core 全确定性，可单测 |
| **Agent runtime**  | 双轨：Claude Code 主会话（交互）+ OpenAI gpt-5-mini durable runtime（异步队列） | 同一份 SKILL.md 两条路径都能跑；durable runtime 历史落 `agent_messages` |
| **嵌入模型**            | OpenAI `text-embedding-3-large` (1536 维，可关)         | 中英文质量好；`EMBEDDING_DISABLED` 时退化为 keyword-only |
| **Chunking**        | recursive splitter（默认）；mineru content_list 边界（TODO） | 段级切分质量足够 MVP；mineru 接入待补 |
| **实体设计**            | 万物皆 page（gbrain 模式）+ 投资强查询字段直接进 pages 列             | 单一索引、跨类型 link 天然成立       |
| **Fact extractor**  | 三层：Tier A YAML block 直读（已上线）→ Tier B 正则（已跳过）→ Tier C LLM 兜底（TODO，决策跳 B 直接 C） | YAML 是 agent 在 narrative 里写的契约，零成本零误差；Tier C 要写 |
| **Async pipeline**  | Postgres 原生 `minion_jobs`（FOR UPDATE SKIP LOCKED）   | 不引入 Redis；6 类 job：embed_chunks / detect_signals / enrich_entity / agent_run / lint_run / facts_expire |
| **Triage**         | ingest 入口三分（commit / brief / pass）+ deleted=1 软删 + skipped_at 跳过 | 短素材塞 7 段 source 模板会污染；brief 给前沿动态留位置 |
| **多租户**             | `sources(id)` 表（gbrain 模式）                          | wiki / 个人笔记 / 实验区共库分区    |
| **软删除主流**       | 全表 `deleted SMALLINT` + partial unique `WHERE deleted=0` | append-only + 时间旅行查询；外键全移除靠应用层维护引用 |

---

## 3. 数据模型

> **v2 全新设计**。v1 三表仅作迁移参考，不作约束。
> 设计基础：投资分析需求 + gbrain 的"万物皆 page"思想。

### 3.0 设计原则

1. **万物皆 page**（gbrain 核心思想）— 公司、人物、行业、来源、论点、概念全部是 `pages` 表的行，用 `type` 字段区分。单一搜索索引、单一 embedding、跨类型 link 天然成立。

2. **投资强查询字段直接进 pages 列** — `ticker` / `exchange` / `aliases` / `sector` / `sub_sector` 不放 frontmatter JSONB，直接是列，因为这些是高频过滤维度。

3. **Facts 不是 page，是 attribute** — 财务数字（FY27 EPS、target price 等）单独建 `facts` 表，每条记录绑 entity page（subject）+ source page（citation）。这是 gbrain 没有、投资场景必需的。

4. **Thesis = page 的扩展** — narrative（bull/bear case）放 `pages.content`，结构化字段（direction/conviction/status）放 `theses` 表，主键即 page_id。

5. **raw_files 单独管** — 直连上游 MongoDB `ResearchReportRecord` 后下载的原始文件登记在 `raw_files`，ingest 后才创建 `pages` 记录。两者通过 `raw_files.ingested_page_id` 关联。

6. **Provenance 是一等公民** — `links` 带 `link_source` / `origin_page_id` / `origin_field`，`facts` 带 `source_page_id` / `valid_from` / `valid_to`，所有"谁说的、什么时候说的"可查。

7. **不支持物理删除（append-only + soft delete）** — 任何已写入的行都不 DELETE，主流是 `deleted SMALLINT` 软删；UNIQUE 全部改成 `partial unique WHERE deleted=0`（v2.1.0 完成）。语义辅助字段：
   - `pages.status = 'archived'` — 论点 / 输出页不再参与默认搜索，但历史可查
   - `facts.valid_to = <date>` — 标记 fact 失效（被新 fact 覆盖），原行保留
   - `theses.status = 'closed' | 'invalidated'` — 论点终止，记录 close 数据
   - `raw_files.skipped_at + skip_reason` — triage 主动跳过（v2.4.0），跟 `deleted=1` 语义分开
   - `signals.resolved = true` — 标记已处理，不删

   **好处**：
   - 不需要外键 ON DELETE CASCADE（已全部移除，应用层维护完整性）
   - 不会出现悬空引用 / 孤儿数据问题
   - 时间旅行查询天然成立（"3 个月前 wiki 怎么说"直接 SQL）
   - 审计 / 合规友好（任何变更可追溯，由 `events` 记录）

   **代价**：表会持续增长。MVP 阶段无影响；超大规模时按月分区或冷归档。

8. **Thin Harness, Fat Skill** — core（`src/core/`）严格不调 LLM。所有理解工作 push 到 `skills/ae-*/SKILL.md`，由 agent（Claude Code 主会话或 OpenAI durable runtime）执行。core 给 agent 提供的是确定性 CLI（`ingest:peek/commit/brief/pass/write/finalize` 等）+ MCP 查询接口（`search` / `get_page` / `query_facts` 等 7 个工具）。改流程改 markdown，不改 TS 代码。详见 `doc/llm-touchpoints.md`。

### 3.1 完整表清单（17 张）

| #   | 表名                       | 角色                                  | 核心字段                                                                         |
| --- | ------------------------ | ----------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `sources`                | 多租户分区（gbrain）                       | id, name, config                                                             |
| 2   | `pages`                  | **核心：万物皆 page**                     | slug, type, content, timeline, frontmatter, ticker, sector, aliases, embedding, tsv |
| 3   | `content_chunks`         | 分段 embedding                        | page_id, chunk_text, chunk_type, embedding                                   |
| 4   | `links`                  | 类型化边 + provenance                   | from_page_id, to_page_id, link_type, link_source, origin_page_id             |
| 5   | `tags`                   | m2m 标签                              | page_id, tag                                                                 |
| 6   | `facts`                  | **投资专属：时间序列数值**                     | entity_page_id, metric, period, value_numeric, source_page_id, valid_from/to |
| 7   | `theses`                 | **投资专属：论点状态机**                      | page_id (PK), target_page_id, direction, conviction, status, catalysts, validation_conditions |
| 8   | `signals`                | **投资专属：自动事件流**                      | signal_type, entity_page_id, thesis_page_id, severity, source_page_id        |
| 9   | `timeline_entries`       | 结构化时间线                              | entity_page_id, event_date, event_type, summary                              |
| 10  | `raw_files`              | 原始文件登记（v2.5.0+ 仅元数据 + S3 直链）       | research_id, markdown_url, triage_decision, ingested_page_id, skipped_at, skip_reason |
| 11  | `raw_data`               | JSONB sidecar（含 `source='tables'` 表格 artifact） | page_id, source, data                                            |
| 12  | `page_versions`          | 快照历史                                | page_id, content, timeline, frontmatter, edited_by, reason, snapshot_at      |
| 13  | `events`                 | 审计 log（含 `lint_run` / `facts_expire` 等系统事件） | actor, action, entity_type, entity_id, payload                  |
| 14  | `minion_jobs`            | 异步队列（gbrain）                        | name, status, data, attempts, progress, result, started_at, finished_at      |
| 15  | `agent_messages`         | **durable agent runtime 对话历史** (v2.6.0) | job_id, turn_index, role, content, model, stop_reason, tokens_in/out     |
| 16  | `agent_tool_executions`  | **durable agent runtime tool 调用** (v2.6.0) | job_id, turn_index, tool_use_id, tool_name, status, input, output, error |
| 17  | `config`                 | 配置 KV                               | id (即 key), value                                                            |

迁移链：v2.1.0 partial unique（软删感知）→ v2.2.0 aliases 并入 tsv → v2.3.0/v2.6.3 jieba（已回退）→ v2.4.0 raw_files 加 skipped_at → v2.5.0 raw_files 改 markdown_url → v2.5.1 加 triage_decision → v2.6.0 agent runtime → v2.6.1/.2 minion 加 cancelled / paused 状态。

后期再加（不在 MVP）：`access_tokens`、`mcp_request_log`（远程 MCP 鉴权 + 审计）。

### 3.1.5 通用字段约定（所有表统一）

所有 15 张表强制使用统一的主键 + 审计字段约定，对应 MySQL 团队规范。

#### 主键约定

| 类型            | Postgres 写法                                              | MySQL 等价                                        | 适用                                                                |
| ------------- | -------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| 自增 ID         | `id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` | `id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY` | 默认（`pages`、`content_chunks`、`links` 等 12 张表）                      |
| 自然键 TEXT      | `id TEXT PRIMARY KEY`                                    | `id VARCHAR(64) NOT NULL PRIMARY KEY`           | `sources` / `config` 用 'default' / 'embedding_model' 这类 string 主键 |
| 共享 PK（1:1 扩展） | `page_id BIGINT PRIMARY KEY`                             | `page_id BIGINT NOT NULL PRIMARY KEY`           | `theses`（page_id 同时作为 PK 和指向 pages 的关联）                           |

> `BIGINT GENERATED BY DEFAULT AS IDENTITY` 是 SQL:2003 标准写法（Postgres 10+ 支持），与 MySQL `BIGINT NOT NULL AUTO_INCREMENT` 语义直接对应。
> 选 `BY DEFAULT` 而非 `ALWAYS`：允许 INSERT 时显式指定 id（迁移历史数据、test fixture 时有用），不指定则自动生成；`ALWAYS` 则强制由系统生成、手动 override 需要 `OVERRIDING SYSTEM VALUE`。
> 旧的 `BIGSERIAL` 语法仍兼容，但已不推荐——它是 Postgres 私有语法糖，IDENTITY 是 SQL 标准。

#### 标准审计字段（每张表末尾必带）

```sql
extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人 ('agent:claude' / 'human:levin' / 'system:cron')
update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
```

**字段语义**：

| 字段 | 用途 |
|---|---|
| `extend` | 任意附加元数据，schema 演进的逃生通道（避免每次都加列） |
| `create_by` / `update_by` | actor 标识，约定格式 `<kind>:<name>`（`agent:claude` / `human:levin` / `system:cron`） |
| `create_time` / `update_time` | 行级时间戳；`update_time` 由应用层在每次 UPDATE 时显式 SET = NOW() |
| `deleted` | 逻辑删除标志。**所有默认查询必须带 `WHERE deleted = 0`** |

#### 与 §3.0 第 7 条「不支持物理删除」的关系

两者是**互补**而非冲突：
- `deleted = 1` 是**底层 / 系统级**软删除（误录入、重复行、废弃数据）— 普通查询完全过滤掉
- `pages.status = 'archived'` / `theses.status = 'closed'` / `signals.resolved = true` 是**业务级**生命周期状态 — 不同业务语义不同操作
- `facts.valid_to = <date>` 是**时间维度的版本切换**（被新值覆盖）— 历史可查

| 场景 | 用哪个？ |
|---|---|
| ingest 误把同一份 source 录入两次，要清理 | `deleted = 1`（系统级） |
| 论点已 close，未来不再 active | `theses.status = 'closed'`（业务级） |
| 旧的 fact 被新 fact 覆盖 | 旧行 `valid_to = today`，新行 `valid_from = today` |
| 公司从覆盖列表里下架（不再跟进）| `pages.status = 'archived'` |

#### update_time 由应用层维护

Postgres 没有 MySQL 的 `ON UPDATE CURRENT_TIMESTAMP` 列约束。我们**不在 DB 层做 trigger**，由应用层在每次 UPDATE 时显式 `SET update_time = NOW()`。

理由：
- 事务可控（trigger 黑盒、调试困难）
- 批量操作友好（避免每行 trigger 调用开销）
- 应用层 ORM / repository 可以统一封装这个逻辑（例如所有 update 路径走同一个 `bump_audit()` helper）

应用层范式（TypeScript / Drizzle 伪代码）：

```typescript
async function updatePage(db: Database, pageId: bigint, fields: Partial<Page>, actor: string) {
  await db.update(pages)
    .set({
      ...fields,
      updateTime: sql`NOW()`,
      updateBy: actor,
    })
    .where(and(eq(pages.id, pageId), eq(pages.deleted, 0)));
}
```

Drizzle 列定义层面也可以用 `$onUpdate(() => new Date())` 自动注入；但显式 SET 仍是推荐写法（事务里清晰可见）。

#### 默认查询模式

应用层封装 query helper，所有列表查询自动带 `deleted = 0` 过滤：

```typescript
async function queryPages(db: Database, filters: PageFilters = {}) {
  return db.select().from(pages)
    .where(and(eq(pages.deleted, 0), /* ...其他 filters */));
}
```

后续如果做 view 也可以：

```sql
CREATE VIEW pages_active AS
  SELECT * FROM pages WHERE deleted = 0;
```

但建议**应用层过滤**优于 view（避免 view 嵌套带来的查询计划问题）。

### 3.2 sources — 多租户分区

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE sources (
  id           TEXT PRIMARY KEY,                 -- 'default' | 'sandbox' | ...
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

INSERT INTO sources (id, name, description) VALUES
  ('default', '主投资研究 wiki', '默认 wiki 分区');
```

默认全部走 `default`。后期可加 `sandbox`（实验）/ `archive`（归档）等。

### 3.3 pages — 核心表（万物皆 page）

**整个 schema 的核心**。所有实体类型都是这张表的行。

```sql
CREATE TABLE pages (
  id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  source_id     TEXT NOT NULL DEFAULT 'default',
  slug          TEXT NOT NULL,                    -- 'companies/NVIDIA' / 'sources/arete-NOW-260316'
  type          TEXT NOT NULL,                    -- enum 见下
  title         TEXT NOT NULL,

  -- 内容（gbrain 风格的 compiled_truth + timeline 双字段）
  content       TEXT NOT NULL DEFAULT '',         -- 主体 markdown narrative
  timeline      TEXT NOT NULL DEFAULT '',         -- markdown 时间线段落（人读版本）
  frontmatter   JSONB NOT NULL DEFAULT '{}',      -- 结构化元数据
  content_hash  TEXT,                             -- SHA-256(content) 做变更检测

  -- 投资强查询字段（type='company' 时填）
  ticker        TEXT,                             -- 'NOW-US' / '600519.SH'
  exchange      TEXT,                             -- 'NASDAQ' | 'SHA' | 'HKEX'
  aliases       TEXT[],                           -- ['NOW', '思维克', 'ServiceNow Inc.']
  sector        TEXT,                             -- 一级行业
  sub_sector    TEXT,                             -- 二级行业
  country       TEXT,

  -- 检索
  embedding     vector(1536),                     -- 整页摘要向量（title + 首段）
  tsv           tsvector,                         -- 全文索引（trigger 维护）

  -- 组织 / 权限（继承自 raw_files.org_code 或人工创建时填）
  org_code      TEXT,                             -- 例 'JG1000'，后续作为多租户/权限边界

  -- 状态
  status        TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'draft' | 'archived'
  confidence    TEXT,                             -- 'high' | 'medium' | 'low'

  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0,                    -- 逻辑删除：0=未删除, 1=已删除
  CONSTRAINT pages_source_slug_key UNIQUE (source_id, slug)
);

CREATE INDEX idx_pages_type ON pages(type);
CREATE INDEX idx_pages_ticker ON pages(ticker) WHERE ticker IS NOT NULL;
CREATE INDEX idx_pages_aliases ON pages USING GIN(aliases);
CREATE INDEX idx_pages_frontmatter ON pages USING GIN(frontmatter);
CREATE INDEX idx_pages_sector ON pages(sector) WHERE sector IS NOT NULL;
CREATE INDEX idx_pages_tsv ON pages USING GIN(tsv);
CREATE INDEX idx_pages_embedding ON pages USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_pages_updated ON pages(update_time DESC);
CREATE INDEX idx_pages_title_trgm ON pages USING GIN(title gin_trgm_ops);
```

**`type` 枚举**：
- `company` — 公司（slug 例：`companies/NVIDIA`）
- `person` — 人物（slug 例：`persons/jensen-huang`）
- `industry` — 行业（slug 例：`industries/光模块`）
- `concept` — 概念（slug 例：`concepts/memory-supercycle`）
- `source` — 研究来源（slug 例：`sources/arete-NOW-260316`）
- `thesis` — 投资论点（slug 例：`theses/long-NVDA-AI-infra`）
- `output` — 分析输出（slug 例：`outputs/daily-review-2026-04-26`）

**tsvector trigger**（gbrain 模式）：

```sql
CREATE OR REPLACE FUNCTION update_pages_tsv() RETURNS trigger AS $$
BEGIN
  NEW.tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.content, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.timeline, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pages_tsv BEFORE INSERT OR UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION update_pages_tsv();
```

> **全文检索说明**：当前直接使用 Postgres `'simple'` 配置为 `title / aliases / content / timeline` 建 tsvector，不再做应用层中文预分词。

### 3.4 content_chunks — 分段 embedding

embedding 不放 page 级（粗），放 chunk 级（精细召回）。

```sql
CREATE TABLE content_chunks (
  id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  page_id       BIGINT NOT NULL,
  chunk_index   INTEGER NOT NULL,
  chunk_text    TEXT NOT NULL,
  chunk_type    TEXT NOT NULL DEFAULT 'text',     -- 'text' | 'list' | 'table' | 'chart' | 'compiled_truth'
  page_idx      INTEGER,                          -- mineru 提供的原文档页码
  embedding     vector(1536),
  model         TEXT NOT NULL DEFAULT 'text-embedding-3-large',
  token_count   INTEGER,
  embedded_at   TIMESTAMPTZ,
  UNIQUE (page_id, chunk_index),
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_chunks_page ON content_chunks(page_id);
CREATE INDEX idx_chunks_embedding ON content_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_chunks_type ON content_chunks(chunk_type);
```

`chunk_type` 来自 mineru content_list.json 的 type 字段，**只用作切分边界提示**——保留 type 让搜索可过滤（"找所有提到 1.6T 价格的表格" → `WHERE chunk_type='table'`）。

### 3.5 links — 类型化边 + provenance

```sql
CREATE TABLE links (
  id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  from_page_id    BIGINT NOT NULL,
  to_page_id      BIGINT NOT NULL,
  link_type       TEXT NOT NULL DEFAULT '',       -- '' (mention) | 'covers' | 'competes_with' | 'invests_in' | 'works_at' | 'attended' | 'subsidiary_of' | 'partners_with'
  context         TEXT NOT NULL DEFAULT '',       -- 链接周围 1-2 句上下文
  link_source     TEXT CHECK (link_source IS NULL OR link_source IN ('markdown', 'frontmatter', 'manual', 'extracted')),
  origin_page_id  BIGINT,
  origin_field    TEXT,                           -- frontmatter 字段名（如 'key_people'）
  weight          NUMERIC NOT NULL DEFAULT 1.0,   -- 边权重（如出现次数）
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0,                    -- 逻辑删除：0=未删除, 1=已删除
  CONSTRAINT links_unique UNIQUE NULLS NOT DISTINCT
    (from_page_id, to_page_id, link_type, link_source, origin_page_id)
);

CREATE INDEX idx_links_from ON links(from_page_id);
CREATE INDEX idx_links_to ON links(to_page_id);
CREATE INDEX idx_links_type ON links(link_type);
CREATE INDEX idx_links_source ON links(link_source);
```

**借鉴 gbrain 的 provenance**：`link_source` 区分链接来源（markdown 正文 / frontmatter 字段 / 手动 / 自动抽取），`origin_page_id` 记录"是哪个页面创建的这条边"，便于 reconciliation。

### 3.6 tags

```sql
CREATE TABLE tags (
  id        BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  page_id   BIGINT NOT NULL,
  tag       TEXT NOT NULL,
  UNIQUE (page_id, tag),
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_tags_tag ON tags(tag);
CREATE INDEX idx_tags_page ON tags(page_id);
```

### 3.7 facts — 时间序列结构化数值（投资专属，最重要）

把 narrative 里的数字升级为可 SQL 聚合的数据。**整个查询引擎的核心**。

```sql
CREATE TABLE facts (
  id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  entity_page_id  BIGINT NOT NULL,  -- subject: 关于哪个公司/行业
  metric          TEXT NOT NULL,                  -- 'revenue' | 'ebit' | 'eps_non_gaap' | 'target_price' | 'gross_margin' | 'fcf_margin' | ...
  period          TEXT,                           -- 'FY2027E' | '1Q26A' | '2026-04-25' | 'current'
  period_start    DATE,                           -- 用于按时间范围过滤
  period_end      DATE,
  value_numeric   NUMERIC,                        -- 主值
  value_text      TEXT,                           -- 非数值情形（如 'nm'）
  unit            TEXT,                           -- 'usd_m' | 'pct' | 'x' | 'usd' | 'cny_bn' | ...
  source_page_id  BIGINT,    -- citation: 哪份 source 提供
  confidence      NUMERIC NOT NULL DEFAULT 1.0,
  valid_from      DATE NOT NULL,                  -- 该 fact 何时开始有效
  valid_to        DATE,                           -- NULL = 当前 latest
  metadata        JSONB DEFAULT '{}',             -- 例: {"is_consensus": true, "broker": "..."}
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_facts_entity_metric ON facts(entity_page_id, metric);
CREATE INDEX idx_facts_metric_current ON facts(metric, valid_to) WHERE valid_to IS NULL;
CREATE INDEX idx_facts_period ON facts(period_start, period_end);
CREATE INDEX idx_facts_source ON facts(source_page_id);
```

**典型查询**：

```sql
-- "ServiceNow FY27 EPS 各 broker 估值"
SELECT sp.frontmatter->>'broker' AS broker, f.value_numeric, sp.title, sp.create_time
FROM facts f
JOIN pages ep ON ep.id = f.entity_page_id AND ep.ticker = 'NOW-US'
JOIN pages sp ON sp.id = f.source_page_id
WHERE f.metric = 'eps_non_gaap' AND f.period = 'FY2027E' AND f.valid_to IS NULL
ORDER BY sp.create_time DESC;

-- "2026-01-31 时对 NVDA 目标价的判断"（time travel）
SELECT f.value_numeric, sp.title
FROM facts f
JOIN pages ep ON ep.id = f.entity_page_id AND ep.ticker = 'NVDA-US'
JOIN pages sp ON sp.id = f.source_page_id
WHERE f.metric = 'target_price'
  AND f.valid_from <= '2026-01-31'
  AND (f.valid_to IS NULL OR f.valid_to > '2026-01-31');

-- "FY27E EBIT margin > 30% 的 SaaS 公司"
SELECT ep.title, ep.ticker, f.value_numeric AS ebit_margin
FROM pages ep
JOIN facts f ON f.entity_page_id = ep.id
WHERE ep.type = 'company'
  AND ep.sector = 'SaaS'
  AND f.metric = 'ebit_margin'
  AND f.period = 'FY2027E'
  AND f.value_numeric > 0.30
  AND f.valid_to IS NULL
ORDER BY f.value_numeric DESC;
```

### 3.8 theses — 投资论点状态机（投资专属）

`pages` 里有 thesis 的 narrative（bull/bear case），`theses` 加结构化列。主键即 page_id（1:1 扩展）。

```sql
CREATE TABLE theses (
  page_id            BIGINT PRIMARY KEY,
  target_page_id     BIGINT NOT NULL,  -- 标的（公司/行业 page）
  direction          TEXT NOT NULL,                          -- 'long' | 'short' | 'pair' | 'neutral'
  conviction         TEXT,                                   -- 'high' | 'medium' | 'low'
  status             TEXT NOT NULL,                          -- 'active' | 'monitoring' | 'closed' | 'invalidated'
  date_opened        DATE,
  date_closed        DATE,
  price_at_open      NUMERIC,
  price_at_close     NUMERIC,
  catalysts          JSONB NOT NULL DEFAULT '[]',            -- [{date, event, expected_impact}]
  validation_conditions JSONB NOT NULL DEFAULT '[]',         -- [{condition, status, last_checked}]
  pm_owner           TEXT,
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_theses_status ON theses(status) WHERE status IN ('active', 'monitoring');
CREATE INDEX idx_theses_target ON theses(target_page_id);
CREATE INDEX idx_theses_direction ON theses(direction);
```

**为什么不直接放 pages.frontmatter？**因为这些字段被高频 JOIN（`signals` 写入时要查 active thesis、`daily-summarize` 要列所有 active long/short）。直接是列性能更好。

#### 维护机制：半自动 — 自动写 signal，人工/agent 调状态

实际落地的分工与早期设计不同，**`signal-detector` 不会自动 UPDATE `theses` 行**。原因：投资判断有反身性，确定性脚本不应自动 close 论点。

**自动**（已上线）：
- ingest Stage 8 写 `signals(signal_type='thesis_validation', severity='info')`：source 提到 active thesis 的 target 时，提示"该 review 了"
- worker `detect_signals` 写 `signals(signal_type='consensus_drift' | 'fact_outlier')`：跨 source fact 偏离 >10% (info) / >20% (warning)
- 这两个产线**只写 signals**，不改 `theses` 任何字段

**人工 / agent CLI**（已上线，主流维护路径）：
- `thesis:open --target <slug> --direction <long|short|pair|neutral> --name "..."` — 开仓
- `thesis:write <pageId>` — stdin 落 narrative
- `thesis:update --conviction X / --add-catalyst JSON / --mark-condition "C:status[:signal_id]"` — 调状态
- `thesis:close <pageId> --reason validated|invalidated|stop_loss|manual` — 关仓
- `update_by` 区分 `agent:claude` / `agent:runtime` / `human:<name>`，可审计

**Agent 角色**：`ae-thesis-track` skill 让 agent 在 ingest 后主动跑 `thesis:list --status active` → `thesis:show <pageId>` → 据 signals 决定调用哪个 update 命令。属于"半自动 + 人在环"，详见 `skills/ae-thesis-track/SKILL.md`。

### 3.9 signals — 自动事件流（投资专属）

由两条产线写入：(1) ingest Stage 8 写 `thesis_validation` 提示 source 触及 active thesis 的 target；(2) worker `detect_signals` 跨 source fact 偏离比对写 `consensus_drift` / `fact_outlier`。**signals 只写不改 theses，状态机由 agent / PM 通过 `thesis:update` 主动推进**。

```sql
CREATE TABLE signals (
  id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  signal_type     TEXT NOT NULL,                  -- 'consensus_drift' | 'thesis_validation' | 'thesis_invalidation' | 'earnings_surprise' | 'rating_change' | 'price_target_change' | ...
  entity_page_id  BIGINT,
  thesis_page_id  BIGINT,
  source_page_id  BIGINT,
  severity        TEXT NOT NULL DEFAULT 'info',   -- 'critical' | 'warning' | 'info'
  title           TEXT NOT NULL,
  detail          TEXT,
  data            JSONB,
  resolved        BOOLEAN NOT NULL DEFAULT FALSE,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_signals_unresolved ON signals(detected_at DESC) WHERE NOT resolved;
CREATE INDEX idx_signals_entity ON signals(entity_page_id, detected_at DESC);
CREATE INDEX idx_signals_thesis ON signals(thesis_page_id) WHERE thesis_page_id IS NOT NULL;
CREATE INDEX idx_signals_severity ON signals(severity, detected_at DESC) WHERE NOT resolved;
```

### 3.10 timeline_entries — 结构化事件流（gbrain 模式）

每个 entity 的事件流（earnings / 评级变化 / 产品发布 / 论点开仓 等）。与 facts 互补：facts 是数值，timeline 是事件。

```sql
CREATE TABLE timeline_entries (
  id              BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  entity_page_id  BIGINT,
  source_page_id  BIGINT,
  event_date      DATE NOT NULL,
  event_type      TEXT NOT NULL,                  -- 'earnings' | 'guidance' | 'rating_change' | 'product_launch' | 'thesis_open' | 'thesis_close' | 'news' | 'other'
  summary         TEXT NOT NULL,
  detail          TEXT,
  metadata        JSONB DEFAULT '{}',
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_timeline_entity_date ON timeline_entries(entity_page_id, event_date DESC);
CREATE INDEX idx_timeline_event_type ON timeline_entries(event_type);
CREATE UNIQUE INDEX idx_timeline_dedup ON timeline_entries(entity_page_id, event_date, summary);
```

### 3.11 raw_files — 原始文件登记（v2.5.0+ 元数据 + S3 直链）

直连 MongoDB `ResearchReportRecord` 集合拉取的元数据登记在这；**正文不再落本地**，存 `parsedMarkdownS3` 直链 `markdown_url`，ingest 时按需 HTTP 拉。Triage 三分流程在 `triage_decision` 字段记录（v2.5.1）。

```sql
CREATE TABLE raw_files (
  id                BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  source_id         TEXT NOT NULL DEFAULT 'default',
  -- v2.5.0：S3 直链替代本地文件
  markdown_url      TEXT NOT NULL,                 -- parsedMarkdownS3 HTTP 直链
  research_id       TEXT,                          -- 上游 ResearchReportRecord.researchId
  research_type     TEXT,                          -- 'meeting_minutes' | 'aletheia' | 'twitter' | ...
  org_code          TEXT,                          -- 上游 orgCode (如 'JG1000')
  title             TEXT,
  tags              TEXT[],                        -- 上游 tags[]
  mongo_doc         JSONB,                         -- 完整 MongoDB ResearchReportRecord 文档
  parse_status      TEXT,                          -- upstream parseStatus: 'completed' | 'pending' | ...
  -- v2.5.1：Triage 决策结果
  triage_decision   TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'commit' | 'brief' | 'pass'
  ingested_page_id  BIGINT,                        -- ingest 后回填
  ingested_at       TIMESTAMPTZ,
  -- v2.4.0：Triage 主动跳过（与 deleted=1 语义分开）
  skipped_at        TIMESTAMPTZ,
  skip_reason       TEXT,
  -- 标准审计字段（所有表统一）
  extend       JSONB,
  create_by    VARCHAR(64) NOT NULL DEFAULT '',
  update_by    VARCHAR(64) NOT NULL DEFAULT '',
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted      SMALLINT    NOT NULL DEFAULT 0
);

-- v2.1.0：partial unique（软删感知）
CREATE UNIQUE INDEX uq_raw_files_research_id ON raw_files (research_id)
  WHERE deleted = 0 AND research_id IS NOT NULL;

CREATE INDEX idx_raw_files_pending          ON raw_files (create_time);
CREATE INDEX idx_raw_files_research_type    ON raw_files (research_type);
CREATE INDEX idx_raw_files_triage_decision  ON raw_files (triage_decision);
CREATE INDEX idx_raw_files_org              ON raw_files (org_code);
CREATE INDEX idx_raw_files_skipped          ON raw_files (skipped_at) WHERE skipped_at IS NOT NULL;
```

**字段说明**：
- `markdown_url`：v2.5.0 起替代 `raw_path`。`fetchRawMarkdown(rf)` 进程内缓存，同 ingest 流程多次调用只 fetch 一次（见 `src/core/raw-loader.ts`）
- `research_id` partial unique（`WHERE deleted=0 AND research_id IS NOT NULL`）— fetch-reports 直接 `INSERT ... ON CONFLICT (research_id) WHERE deleted=0 AND research_id IS NOT NULL DO NOTHING`
- `triage_decision`：默认 `'pending'`；`ingest:peek` 不改；`commit/brief` 写对应值并建 page；`pass` 写 `'pass'` + 标 `skipped_at`
- `mongo_doc` 存完整 `ResearchReportRecord` 文档（含 `parsedMarkdownS3` / `parsedContentListS3` / `parseLockedBy` / 时间戳等），失去 schema 锁定但保留全部上游信息
- `org_code` 当前不强制（NULL 兼容旧数据），未来添加 access control 时可强制 `pages.org_code = raw_files.org_code`
- `tags` 在 ingest Stage 4 之外也会同步到 `tags` 表（m2m 行）便于按标签搜索

### 3.12 raw_data — JSONB sidecar（gbrain 模式）

任何对一个 page 的 sidecar 元数据（mineru content_list / 第三方 API 拉取 / markdown table artifacts 等）。

```sql
CREATE TABLE raw_data (
  id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  page_id     BIGINT NOT NULL,
  source      TEXT NOT NULL,                      -- 'mineru_content_list' | 'tables' | 'aecapllc_api' | 'finance_api' | ...
  data        JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (page_id, source),
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_raw_data_page ON raw_data(page_id);
```

当前约定里，`source='tables'` 表示 ingest Stage 2 从 raw markdown 中提取的表格 sidecar。详细格式见 `doc/table-artifacts.md`。

### 3.13 page_versions — 快照历史

每次 page content 大改时存一份快照。

```sql
CREATE TABLE page_versions (
  id            BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  page_id       BIGINT NOT NULL,
  content       TEXT NOT NULL,
  timeline      TEXT NOT NULL DEFAULT '',
  frontmatter   JSONB NOT NULL DEFAULT '{}',
  edited_by     TEXT,                             -- 'agent:claude' | 'human:levin' | 'system:auto'
  reason        TEXT,                             -- 'ingest' | 'manual edit' | 'enrich'
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_versions_page ON page_versions(page_id, snapshot_at DESC);
```

### 3.14 events — 审计 log

取代 wiki/log.md 的结构化版本。

```sql
CREATE TABLE events (
  id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor       TEXT NOT NULL,                      -- 'agent:claude' | 'human:levin' | 'system:cron' | ...
  action      TEXT NOT NULL,                      -- 'ingest' | 'create_page' | 'update_fact' | 'thesis_open' | 'signal_detected' | ...
  entity_type TEXT,
  entity_id   BIGINT,
  payload     JSONB,
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_events_ts ON events(ts DESC);
CREATE INDEX idx_events_actor_ts ON events(actor, ts DESC);
CREATE INDEX idx_events_action ON events(action, ts DESC);
```

### 3.15 minion_jobs — Postgres 原生异步队列（gbrain 模式）

不引入 Redis / Celery。worker 用 `FOR UPDATE SKIP LOCKED` 抢占 job（见 `src/core/minions/worker.ts`）。

```sql
CREATE TABLE minion_jobs (
  id           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name         TEXT NOT NULL,                     -- job 类型，见下表
  status       TEXT NOT NULL DEFAULT 'waiting',   -- waiting | active | paused | completed | failed | cancelled
  data         JSONB NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  progress     JSONB,                              -- 长跑 job 的中间进度（v2.6.0 加）
  result       JSONB,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  -- 标准审计字段（所有表统一）
  extend       JSONB,
  create_by    VARCHAR(64) NOT NULL DEFAULT '',
  update_by    VARCHAR(64) NOT NULL DEFAULT '',
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted      SMALLINT    NOT NULL DEFAULT 0
);

CREATE INDEX idx_jobs_pending ON minion_jobs(name, create_time);
CREATE INDEX idx_jobs_status  ON minion_jobs(status, create_time);
```

**Job name 列表**（见 `src/core/minions/types.ts` `MinionJobName`）：

| name | 触发 | handler | 备注 |
|---|---|---|---|
| `embed_chunks` | ingest Stage 6 | OpenAI embedding API | `EMBEDDING_DISABLED=true` 时被 worker 跳过 |
| `detect_signals` | ingest Stage 6 | 跨 source fact 偏离比对（>10% 写 info，>20% 写 warning） | 需 ≥1 条同 entity+metric+period 的 prior fact |
| `enrich_entity` | Stage 4 自动建红链时 | 起一个 `agent_run` job 跑 ae-enrich skill | 红链补全的自动化入口 |
| `agent_run` | enrich_entity / 用户显式 | OpenAI gpt-5-mini durable runtime（`src/agents/runtime.ts`） | 对话历史落 `agent_messages` / `agent_tool_executions` |
| `lint_run` | 外部 scheduler / 手动 (`ae-wiki lint:run`) | 5 项健康检查写 `events(action='lint_run')` | 见 §6 维护任务 |
| `facts_expire` | 外部 scheduler / 手动 (`ae-wiki facts:expire`) | 关闭 period_end 已过 N 天的 latest fact | 默认 90 天 |

`status` 状态机（v2.6.1 / v2.6.2 加 `cancelled` / `paused`）：
```
waiting → active → completed
              ↓
              → failed (attempts < max_attempts → waiting，否则终态)
              → paused (用户暂停，可 resume)
              → cancelled (用户取消，终态)
```

### 3.15.1 agent_messages — durable agent runtime 对话历史 (v2.6.0)

存 OpenAI gpt-5-mini durable runtime 跑 `agent_run` job 时的每轮对话。

```sql
CREATE TABLE agent_messages (
  id          BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  job_id      BIGINT NOT NULL,                    -- → minion_jobs.id (name='agent_run')
  turn_index  INTEGER NOT NULL,
  role        TEXT NOT NULL,                      -- 'system' | 'user' | 'assistant' | 'tool'
  content     JSONB NOT NULL,                     -- OpenAI message content（含 tool_calls）
  model       TEXT,
  stop_reason TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  metadata    JSONB NOT NULL DEFAULT '{}',
  -- 标准审计字段
  extend       JSONB,
  create_by    VARCHAR(64) NOT NULL DEFAULT '',
  update_by    VARCHAR(64) NOT NULL DEFAULT '',
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted      SMALLINT    NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX uq_agent_messages_job_turn  ON agent_messages (job_id, turn_index) WHERE deleted = 0;
CREATE INDEX        idx_agent_messages_job_turn ON agent_messages (job_id, turn_index);
```

用途：`ae-wiki agent:logs <job_id>` / `agent:replay` 通过这张表回放任意 job。崩溃 / 暂停后可从最后一轮恢复。

### 3.15.2 agent_tool_executions — durable agent runtime tool 调用 (v2.6.0)

每次 agent 调 MCP / CLI 工具时记一行，让长跑 job 可断点续跑。

```sql
CREATE TABLE agent_tool_executions (
  id           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  job_id       BIGINT NOT NULL,                   -- → minion_jobs.id
  turn_index   INTEGER NOT NULL,
  tool_use_id  TEXT NOT NULL,                     -- OpenAI tool_call.id
  tool_name    TEXT NOT NULL,                     -- 'search' | 'get_page' | 'ingest:commit' | ...
  status       TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'running' | 'completed' | 'failed'
  input        JSONB NOT NULL DEFAULT '{}',
  output       JSONB,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  metadata     JSONB NOT NULL DEFAULT '{}',
  -- 标准审计字段
  extend       JSONB,
  create_by    VARCHAR(64) NOT NULL DEFAULT '',
  update_by    VARCHAR(64) NOT NULL DEFAULT '',
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted      SMALLINT    NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX uq_agent_tool_exec_job_tool_use  ON agent_tool_executions (job_id, tool_use_id) WHERE deleted = 0;
CREATE INDEX        idx_agent_tool_exec_job_turn     ON agent_tool_executions (job_id, turn_index);
CREATE INDEX        idx_agent_tool_exec_status       ON agent_tool_executions (status, started_at);
```

### 3.16 config — 配置 KV

```sql
CREATE TABLE config (
  id    TEXT PRIMARY KEY,                                        -- 配置 key（如 'embedding_model'），同时作为主键
  value TEXT NOT NULL,
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

INSERT INTO config (id, value) VALUES
  ('schema_version', '2'),
  ('embedding_model', 'text-embedding-3-large'),
  ('embedding_dimensions', '1536'),
  ('chunk_strategy', 'mineru-aware'),
  ('default_locale', 'en-US')
ON CONFLICT (id) DO NOTHING;
```

### 3.17 完整 ER 图

```
                    ┌─────────────┐
                    │   sources   │
                    └──────┬──────┘
                           │
                           ▼
         ┌──────────────────────────────────────┐
         │           pages (核心表)              │
         │ type ∈ {company, person, industry,   │
         │  source, thesis, concept, output}     │
         │ ticker / sector / aliases / tsv /     │
         │ embedding / content / frontmatter     │
         └─┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──────┘
           │  │  │  │  │  │  │  │  │  │  │
           │  │  │  │  │  │  │  │  │  │  └──▶ raw_data (sidecar JSONB)
           │  │  │  │  │  │  │  │  │  └──────▶ page_versions (history)
           │  │  │  │  │  │  │  │  └─────────▶ tags
           │  │  │  │  │  │  │  └────────────▶ content_chunks (embeddings)
           │  │  │  │  │  │  │
           │  │  │  │  │  │  └─links──▶ pages (从 page 出发的边)
           │  │  │  │  │  │
           │  │  │  │  │  └─facts.entity_page_id──▶ pages (subject)
           │  │  │  │  │       facts.source_page_id──▶ pages (citation)
           │  │  │  │  │
           │  │  │  │  └─timeline_entries.entity_page_id──▶ pages
           │  │  │  │
           │  │  │  └─theses.page_id (1:1 扩展) → target_page_id ─▶ pages
           │  │  │
           │  │  └─signals.entity_page_id / thesis_page_id ──▶ pages
           │  │
           │  └─raw_files.ingested_page_id (一对一) ──▶ pages
           │
           └─（events 通过 entity_id 弱引用任何表）

         ┌───────────────┐    ┌───────────────┐
         │  minion_jobs  │    │     config    │
         └───┬───────────┘    └───────────────┘
             │ name='agent_run'
             ▼
    ┌────────────────────────┐    ┌────────────────────────┐
    │   agent_messages       │    │ agent_tool_executions  │
    │   (job_id → minion_jobs│    │ (job_id → minion_jobs) │
    │    每轮对话历史)        │    │  每次 tool 调用记录)   │
    └────────────────────────┘    └────────────────────────┘
                  ▲
                  │ ingest Stage 6 入队 + Stage 4 红链 → enrich_entity
                  │ enrich_entity → 起 agent_run 跑 ae-enrich
                  │
              [ingest skill / agent runtime]
```

### 3.18 与 v1 三表的对应（仅供迁移参考）

| v1 表 | v2 替代 |
|---|---|
| `wiki_pages` | `pages`（重新设计，加 ticker/sector/aliases 等强查询字段；slug 取代 path）|
| `wiki_links` | `links`（加 provenance: link_source, origin_page_id）|
| `raw_sources` | `raw_files`（加 research_id / parse_status / ingested_page_id 等字段）|

迁移时**重建 schema**。如果需要历史内容，一次性把现有 `wiki/*.md` 跑一遍 ingest 导入 DB（作为 Phase 1 可选任务）；之后 `wiki/` 目录可归档或删除，不再维护。

---

## 4. Ingest Pipeline（关键流程）

### 4.1 端到端流程

```
[ae-fetch-reports skill]                          (手动 / 任意外部 scheduler)
    ↓ MongoDB 查 ResearchReportRecord WHERE parseStatus='completed'
    ↓ 对每条 record：partial unique 去重 ON CONFLICT (research_id) WHERE deleted=0 ...
    ↓ INSERT raw_files (markdown_url=parsedMarkdownS3, mongo_doc, research_type, tags, org_code...)
    ↓ ※ 正文不落本地，只存 S3 直链
[raw_files (triage_decision='pending', ingested_at IS NULL, skipped_at IS NULL) 队列]
    ↓
    ↓ ae-research-ingest skill — Triage 三分流程
    ↓
[ingest:peek <rawFileId 自动选下一个>]            (确定性 SQL，无 LLM)
    ├─ 进程内缓存 fetchRawMarkdown(rf) 一次
    ├─ 截取 preview (前 1500 字)
    └─ 返回 { rawFileId, markdownUrl, title, researchType, rawCharCount, preview }
    ↓
    ↓ agent (Claude Code 主会话 或 OpenAI durable runtime) 读 preview / 完整 raw
    ↓ 三选一：
    ├─→ ingest:pass <rf> --reason "..."          → 标 raw_files.skipped_at + skip_reason，结束
    │
    ├─→ ingest:commit <rf>     (核心投资素材)     → 走 source 路径
    │       ↓
    │       Stage 1: 建 page 骨架 (type='source', slug='sources/<prefix>-<title>-<date>')
    │             UPDATE raw_files SET triage_decision='commit', ingested_page_id=<pid>
    │       Stage 2: 切 content_chunks (recursive splitter) + 抽 raw_data(source='tables') 表格 artifact
    │       ↓
    │   agent 读完整 raw 写 7 段 source narrative + <!-- facts --> YAML + <!-- timeline --> 段
    │       ↓
    │   ingest:write <pageId>  (stdin 落 narrative + page_versions 快照)
    │       ↓
    │   ingest:finalize <pageId>
    │       ├─ Stage 4 链接抽取：[[wikilink]] → links；红链自动建 page (confidence='low')
    │       │           红链同时入队 minion_jobs(name='enrich_entity')
    │       ├─ Stage 5 facts：Tier A YAML 直读（已上线）/ Tier B 正则（已跳过）/ Tier C LLM（TODO，决策跳 B 直 C）
    │       ├─ Stage 6 jobs：minion_jobs(embed_chunks, detect_signals) 入队
    │       ├─ Stage 7 timeline：解析 <!-- timeline --> 之后的 YAML → timeline_entries
    │       └─ Stage 8 thesis：source 提到的 entity 命中 active thesis.target_page_id
    │                         → 写 signals(signal_type='thesis_validation', severity='info')
    │                         写 events(action='ingest_complete')
    │
    └─→ ingest:brief <rf>      (前沿动态弱相关)   → 走 brief 路径
            ↓
            Stage 1: 建 page 骨架 (type='brief', slug='briefs/<prefix>-<title>-<date>')
            Stage 2: 切 chunks（短素材通常 1 chunk，无表格）
            ↓
        agent 写 4 段精简 brief（TL;DR / Key Observations / Investment View / Links）
        + frontmatter (tags / url / platform)
            ↓
        ingest:write <pageId>
            ↓
        ingest:finalize <pageId>
            ├─ Stage 3 解析 frontmatter 合并到 pages.frontmatter
            ├─ Stage 4-8 跑同样流程；brief 通常 0 facts / 0 timeline 是预期
            └─ 完成

[兜底：commit/brief 后才发现内容是噪声]
    └─→ ingest:skip <pageId> --reason "..."    → 软删 page (deleted=1) + 标 raw_files.skipped_at
```

### 4.2 完成判据

- 控制台依次打印 `[stage4] / [stage5] / [stage6] / [stage7] / [stage8]`，最后一行 `✓ page #N finalized`
- `raw_files.ingested_page_id` 已写入

source 页正常应有 facts ≥ 1，brief 0 facts 是预期。

### 4.3 失败 / 重试

- 每个 stage 独立事务，单 stage 失败不影响已完成的
- minion_jobs 自带重试（`max_attempts=3`，attempts 递增）
- ingest 失败的 page 标 `status='draft'`，不参与默认搜索，研究员可见
- 派生 stage 全部幂等可重跑：`facts:re-extract <pageId>` / `links:re-extract <pageId>`

### 4.4 增量 vs 全量

- **增量**：fetch-reports 幂等（partial unique on `record_id` = mongo `_id`；`research_id` 不唯一）；`ingestPickPending()` 过滤 `ingested_at IS NULL AND skipped_at IS NULL AND triage_decision='pending'`
- **全量重建**：派生 stage 可逐 page 重跑，无需重 fetch；schema 升级时通过 `infra/migrations/vX.Y.Z-*.sql` + `scripts/run-X-migration.mjs` 跑迁移

### 4.5 维护任务（不在 ingest 主路径）

`lint_run` / `facts_expire` 是独立 minion job，定期跑：

- `ae-wiki lint:run` — 5 项健康检查（orphan_pages / stale_active_theses / unenriched_red_links / pending_raw_files / expired_latest_facts），写 `events(action='lint_run')`
- `ae-wiki facts:expire [--age 90]` — 把 `period_end < CURRENT_DATE - 90d` 的 latest fact 标 `valid_to`
- 实现：`src/skills/lint/index.ts` / `src/skills/facts/expire.ts`
- 也可作为 minion job 由外部 scheduler 拉起

---

## 5. Search & Query

### 5.1 查询分类

| 查询类型 | 走哪条路径 | 示例 |
|---|---|---|
| **精确结构化** | facts / pages SQL | "NOW FY27 EPS 是多少" |
| **关键词搜索** | tsvector | "搜光模块" |
| **语义搜索** | pgvector HNSW | "找和'memory supercycle'相关的 source" |
| **混合搜索** | RRF(keyword + vector) | "最近关于 HDD 的讨论" |
| **时间过滤** | pages.create_time / facts.valid_from | "过去 7 天的 source" |
| **图遍历** | links + pages | "Arete 覆盖且 FY27 EPS > $5 的公司" |
| **多跳推理** | 多查询合并（agent 编排）| "最近上调 NVDA 目标价的 broker 也在哪些股票上看多" |

### 5.2 Hybrid Search SQL 模板

借鉴 gbrain 的 RRF 实现：

```sql
WITH
  keyword AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, $q) DESC) AS rk
    FROM pages
    WHERE tsv @@ $q
      AND create_time >= $date_from
    LIMIT 50
  ),
  semantic AS (
    SELECT page_id AS id,
           ROW_NUMBER() OVER (ORDER BY embedding <=> $q_emb) AS rk
    FROM content_chunks
    LIMIT 50
  ),
  fused AS (
    SELECT id,
           COALESCE(1.0 / (60 + k.rk), 0) + COALESCE(1.0 / (60 + s.rk), 0) AS rrf_score
    FROM keyword k
    FULL OUTER JOIN semantic s USING (id)
  )
SELECT p.*, f.rrf_score
FROM fused f
JOIN pages p ON p.id = f.id
ORDER BY f.rrf_score DESC
LIMIT 10;
```

加 `compiled_truth boost` / `backlink boost` 等可选 enhancement，但 v1 先跑通基础 RRF。

### 5.3 MCP Tools 设计

给 Claude / agent 暴露的 7 个工具（不给裸 SQL）。实现见 `src/mcp/server.ts` + `src/mcp/queries.ts`：

| Tool | 用途 |
|---|---|
| `search(query, filters)` | hybrid search（keyword + 可选 vector + RRF + source-boost），返回 page list |
| `get_page(slug or id)` | 拿完整 page（含 frontmatter / tags / link counts / status / confidence）|
| `query_facts(entity, metric?, period?, table_only?, table_id?, include_raw_table?)` | 结构化事实查询，可限定来自表格 artifact |
| `get_table_artifact(identifier, table_id?)` | 拿 page 的 `raw_data(source='tables')` 表格 artifact（v2.5+，见 `doc/table-artifacts.md`）|
| `compare_table_facts(metric, entities?, periods?, source_identifier?, current_only?)` | 跨实体 / period 的对比矩阵（基于表格 fact） |
| `list_entities(type, filters)` | 实体列表（按 sector / ticker / confidence / ...） |
| `recent_activity(days, kinds?)` | 最近活动（events + signals + new pages） |

**禁止**：直接 SQL execute（即使 read-only）。生产事故风险太高。`.mcp.json` 已配好，新开 Claude Code 会话自动连。

---

## 6. Skills 现状

### 6.1 已上线（8 个）

每个 skill 由一份 `skills/<name>/SKILL.md` 定义，可选 `agents/openai.yaml` 让 OpenAI durable runtime 调用。Claude Code 主会话与 OpenAI runtime 跑同一份 SKILL.md。

| Skill | SKILL.md | OpenAI runtime | 触发 / 作用 |
|---|---|---|---|
| `ae-fetch-reports` | ✓ | ✓ | 手动 / 外部 scheduler — MongoDB → raw_files |
| `ae-research-ingest` | ✓ | ✓ | fetch 后 — Triage 三分 + 三段式 ingest |
| `ae-enrich` | ✓ | ✓ | Stage 4 自动入队 / 手动 — 红链 entity 补全 |
| `ae-thesis-track` | ✓ | ✓ | PM 表态 / ingest 后回看 — 论点状态机 |
| `ae-daily-review` | ✓ | ✓ | 当日 ingest 后 — 7 问 epistemic 复盘 |
| `ae-daily-summarize` | ✓ | ✓ | daily-review 后 — PM operational 简报 |
| `ae-analyze-ideabot` | ✓ | ✓ | 用户指定 — 单条 IdeaBot 综合分析 |
| `ae-analyze-timebot` | ✓ | ✓ | 用户指定 — 周工时 + 个性化研究建议 |

### 6.2 自动化分层

| 自动 | 半自动（worker 可代跑） | 全人工（PM/agent 必须出席） |
|---|---|---|
| ingest Stage 6 入队 `embed_chunks` / `detect_signals` | `enrich_entity` job → `agent_run` 跑 ae-enrich（OpenAI durable runtime） | `thesis:open` / `thesis:update --mark-condition` / `thesis:close` |
| ingest Stage 8 命中 active thesis 写 signal | `lint_run` 外部触发 / `facts_expire` 外部触发 | conviction bump / drop |
| Stage 5 fact YAML 直读 | | catalyst 命中判定 / stop_loss 触发 |

worker (`bun src/cli.ts worker` 或 `jobs:supervisor`) 跑起来后，红链补全完全异步；不跑的话 agent 也可走三段式 CLI 手动 enrich。

### 6.3 计划中（未实现）

| Skill | 状态 | 说明 |
|---|---|---|
| `consensus-monitor` | TODO | Arete vs 街口的差距漂移；待 facts 表数据量足够后启动 |
| `catalyst-tracker` | TODO | 维护 timeline 中 expected catalysts；目前由 ae-thesis-track 兼顾 |
| Stage 5 Tier C LLM 兜底 | TODO | 决策已固化（跳过 Tier B 直接 Tier C），代码待写；模型 `OPENAI_FACT_EXTRACT_MODEL=gpt-5-mini` |

### 6.4 Skill 间数据流

```
ae-fetch-reports → raw_files (markdown_url + mongo_doc)
    ↓
ae-research-ingest (peek/commit/brief/pass → write → finalize)
    ├→ pages (source/brief)
    ├→ content_chunks
    ├→ facts (Tier A YAML)
    ├→ links + 红链 pages (confidence='low') → minion_jobs(enrich_entity)
    ├→ timeline_entries
    └→ signals (Stage 8 命中 active thesis)
         ↓
ae-enrich (manually 或 worker 自动) → 把红链 entity 补成正式 wiki 页
         ↓
ae-thesis-track (PM 触发) → theses 表（catalysts / validation_conditions）
         ↓
ae-daily-review (读 source/brief/signals/active thesis) → wiki/output/daily-review-{date}.md
         ↓
ae-daily-summarize (读 review + thesis + facts) → wiki/output/daily-summarize-{date}.md
```

注：daily-review / daily-summarize 输出**写文件而非 page**（与早期设计不同）。文件路径：`wiki/output/`。`WORKSPACE_DIR=.` 配置控制根目录。

---

## 7. 技术选型

### 7.1 已确定

| 层         | 选型                                                 |
| --------- | -------------------------------------------------- |
| 数据库       | Postgres 16-17 + pgvector 0.8.2                    |
| Embedding | OpenAI `text-embedding-3-large` (1536)             |
| 主语言       | **TypeScript** strict + **Bun 1.3.13** runtime（不能用 Node 跑：用了 `Bun.CryptoHasher` / `Bun.stdin.text()`） |
| ORM       | Drizzle ORM 0.36（pgvector 支持完善、TS-native、SQL-like）  |
| Postgres 客户端 | `postgres.js`（高性能，Drizzle 默认搭配；`prepare:false` 兼容 PgBouncer） |
| 上游数据源    | **MongoDB**（直连 `ResearchReportRecord` 集合）+ S3（HTTP GET parsedMarkdownS3）|
| MongoDB 客户端 | `mongodb` 官方 Node 驱动 |
| 接入 Claude / OpenAI | MCP server (`@modelcontextprotocol/sdk`) + OpenAI durable runtime (`src/agents/runtime.ts`，模型默认 `gpt-5-mini`) |

### 7.2 待选

| 项 | 候选 | 倾向 |
|---|---|---|
| Runtime | Bun / Node.js | **Bun**（与 gbrain 一致，启动快、原生 TS、内置 test runner）|
| Web 框架（后期）| Hono / Next.js / 不做 | 先不做，MCP 够用；要做选 Hono（Bun 原生）|
| 富文本编辑器（后期）| TipTap / Slate | 等真要 Web UI 再选 |
| 队列 worker | Postgres-native (minion_jobs) / BullMQ | **minion_jobs**（不引入 Redis）|
| 监控 | Sentry / 自建 logging | Sentry |
| 部署 | Docker Compose（单机）/ K8s | Compose 起步 |
| 测试 | `bun test` / Vitest | `bun test`（Bun 原生）|

### 7.3 不引入

- ❌ Redis（minion_jobs 替代）
- ❌ Elasticsearch（pgvector + tsvector 替代）
- ❌ Pinecone / Weaviate（pgvector 替代）
- ❌ MySQL（一个 Postgres 解决全部）
- ⚠️ MongoDB 是**只读上游**（ResearchReportRecord），我们不写它，自身不依赖 Mongo 做存储；JSONB 解决半结构化

### 7.4 环境变量

`src/core/env.ts` Zod 校验唯一入口；所有读 `process.env` 都过它。完整清单见 `CLAUDE.md §环境变量`。

```bash
# 必填
DATABASE_URL=postgresql://ae_root:<password>@<host>:54329/ae_wiki
MONGODB_URI=mongodb://<user>:<password>@<host>:27017/<auth_db>
MONGODB_DB=<db_name>                              # 含 ResearchReportRecord 集合的库
OPENAI_API_KEY=sk-...                             # embedding + agent runtime 共用

# 可选 — 模型
OPENAI_EMBEDDING_MODEL=text-embedding-3-large     # 默认
OPENAI_AGENT_MODEL=gpt-5-mini                     # durable agent runtime 默认模型
OPENAI_FACT_EXTRACT_MODEL=gpt-5-mini              # 预留给 Stage 5 Tier C（待实现）
EMBEDDING_DISABLED=false                          # true 时跳过 embedding 调用，搜索退化为 keyword-only

# 可选 — 路径
WORKSPACE_DIR=.                                   # wiki/output/ 等派生产物根目录；raw 已不再落盘

# 可选 — 上游 Mongo 集合名
MONGODB_COLLECTION=ResearchReportRecord           # 默认值

# 可选 — 搜索调优
WIKI_SOURCE_BOOST="sources/Arete-:1.5,sources/cb-:0.6,..."   # 覆盖默认 source-boost 表
WIKI_SEARCH_EXCLUDE=briefs/                       # 硬排除 slug 前缀，逗号分隔

# 可选 — S3 直接访问（HTTP GET markdown_url 通常够）
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-southeast-1
```

---

## 8. Migration 现状（截至 2026-04-28）

### Phase 0：准备 — ✅ 完成

- [x] 架构文档评审
- [x] `infra/init-v2.sql` 17 张表 DDL
- [x] Postgres schema 部署
- [x] ingest skill v0 骨架

### Phase 1：MVP — ✅ 完成

- [x] 完整 ingest pipeline（Stage 1-8 + Triage 三分）
- [x] 7 个 MCP tools 上线（含 `get_table_artifact` / `compare_table_facts`）
- [x] `daily-review` / `daily-summarize` 输出到 `wiki/output/{date}.md`（与早期"写到 pages 表"决定不同；改成文件方便人手翻）
- [x] 历史 `wiki/*.md` **不导入**（决定保留为只读历史）
- [x] 生产试用稳定（多日 ingest 跑通）

### Phase 2：增强 — 🟡 进行中

- [x] thesis 状态机 + catalyst CLI（`thesis:open / write / update / close`）
- [x] entity enrich pipeline（自动 + 手动两条路径都能跑）
- [x] **Durable agent runtime**（OpenAI gpt-5-mini + `agent_messages` / `agent_tool_executions`）— 让长跑 skill 可恢复 / 可回放
- [x] **Triage 三分流程** + brief page type
- [x] **表格 artifact**（`raw_data(source='tables')` + `get_table_artifact` / `compare_table_facts`）
- [x] **维护任务 minion job**（`lint_run` / `facts_expire`）
- [ ] `signal-detector` 升级（当前只做 fact 偏离比对，未来扩 expectation gap / earnings surprise）
- [ ] `consensus-monitor` 跨 broker 漂移监控
- [ ] `catalyst-tracker` 周度 timeline 维护
- [ ] Stage 5 Tier C LLM 兜底（决策已固化，代码待写）
- [ ] mineru `content_list.json` 接入 Stage 2

### Phase 3：稳态 — 🔴 待启动

- [ ] Web UI（如需，根据团队规模决定）
- [ ] 多人协作（auth + permissions）
- [ ] 高级分析 dashboard
- [ ] 外部集成（Bloomberg / Wind 数据）
- [ ] 单测 / E2E（当前 0 测，是 Tier 0 缺口）

---

## 9. 风险与缓解

| 风险                     | 影响                                | 缓解                                                 |
| ---------------------- | --------------------------------- | -------------------------------------------------- |
| **fact extractor 质量差** | facts 表数据噪声大，cross-source 查询不可信   | 三层降级（YAML > 正则 > LLM）；critical fact 人工复核           |
| **embedding 成本失控**     | OpenAI API 费用                     | minion_jobs 限流 + 增量 embed（只对新 chunk）               |
| **同名 page 误并**         | "Apple"（公司）vs "Apple"（人名）合并       | (source_id, slug) 联合 unique；同名实体用 type+slug 区分     |
| **ingest 阻塞日常**        | LLM extractor 慢 → 当日 fetch 不能即时复盘 | minion_jobs 异步；search 端容忍 fact 暂缺                  |
| **Postgres 单机故障**      | 全停摆                               | 每日 pg_dump + 异地 sync；监控 disk / WAL 大小              |
| **schema 演进**          | 改字段需要 migration                   | drizzle / alembic 严格管理；所有 ALTER 走 migration script |
| **表无限增长**             | append-only 模式下行数累积              | MVP 阶段无影响（< 100 万行）；超大规模时按 create_time 月份分区或冷归档至历史表 |

---

## 10. 当前未决 / 取舍候选

Phase 2 进行中的开放问题：

1. **Stage 5 Tier C LLM 兜底何时启动**
   - 触发条件：当 YAML block 命中率 < 50% 或某类 source 频繁 0 fact
   - 模型已选 `gpt-5-mini`（`OPENAI_FACT_EXTRACT_MODEL` 默认值）
   - 风险：成本失控；缓解：单 source 单次调用上限 + 进度落 `minion_jobs.progress`

2. **mineru `content_list.json` 接入 Stage 2**
   - 当前 chunker 是段级，长 markdown 切分质量差
   - 待评估上游是否稳定提供 + 实施成本

3. **DeepSeek slug 大小写规范**
   - 已发现 `companies/DeepSeek` / `companies/deepseek` 重复（slug 大小写不归一化）
   - 待补一个 hygiene 脚本或迁移规则

4. **是否在仓库里建 DB-backed 调度（`schedules` 表 + worker poll）**
   - 现状：项目已不维护 OS 层调度脚本（launchd/systemd/cron 均移除），所有定时任务依赖外部 scheduler 触发 `bun src/cli.ts <cmd>`
   - 候选：DB schedules 表 + minion worker 内置 cron-aware loop，让 `/scheduling` web 页可直接管 schedule
   - 暂未决：先维持外部 scheduler 模式，等确实有 PM 想在 UI 上加任务再做

---

## 11. 附录：与 gbrain 的差异

我们和 gbrain 共享的设计：
- Postgres + pgvector + hybrid search
- 万物皆 page（核心思想）
- Provenance（link_source, origin_page_id）
- 结构化 timeline_entries
- minion_jobs 异步队列
- raw_data sidecar JSONB
- MCP tools 接 Claude

我们额外的（gbrain 没有的）：
- **`pages.ticker / exchange / aliases / sector / sub_sector` 直接是列**：投资场景的高频过滤字段，gbrain 全在 frontmatter
- **`facts` 表**：投资研究的时间序列数值（gbrain 是 narrative-only）
- **`theses` 表**：投资论点状态机（gbrain 没有 thesis 概念）
- **`signals` 表**：基于 fact 的自动事件流（gbrain 是手动）
- **`raw_files` 表**：与 pages 解耦的 raw 文件登记（gbrain 用 sources sheet + page_path 混用）

gbrain 有但我们暂不做的：
- 意图分类器（query intent）
- Skill 元编程（skillify）
- Sales efficiency 分析（不是我们场景）
- Files 表（binary attachment 走 Supabase Storage）

---

## 12. 决策清单（落地后的 1 页摘要）

| 问题         | 决定                                    | 状态 |
| ---------- | ------------------------------------- | --- |
| 主存储        | Postgres 16-17 + pgvector 0.8.2       | ✅ 已落地 |
| 实体设计       | 万物皆 page + 投资字段（ticker / sector / aliases）直接成列 | ✅ 已落地 |
| 存储边界       | DB 唯一存储；raw 不落本地，存 `markdown_url` HTTP 拉 | ✅ 已落地（v2.5.0） |
| 主语言        | TypeScript strict + Bun 1.3.13 + Drizzle 0.36 | ✅ 已落地 |
| Thin Harness, Fat Skill | core 不调 LLM；推理 push 到 `SKILL.md` | ✅ 已落地 |
| Fact 抽取策略  | Tier A YAML 直读已上；Tier B 正则跳过；Tier C LLM 待补 | 🟡 部分 |
| Triage     | ingest 入口三分（commit / brief / pass） | ✅ 已落地（v2.4 + v2.5.1） |
| Entity 自动建 | 自动 + `confidence='low'` 标记 + Stage 4 入队 enrich_entity job | ✅ 已落地 |
| Thesis 维护  | 半自动（ingest Stage 8 + worker detect_signals 写 signal）+ PM/agent CLI 走状态机 | ✅ 已落地 |
| Agent runtime | 双轨：Claude Code 主会话 + OpenAI gpt-5-mini durable runtime（同一份 SKILL.md）| ✅ 已落地（v2.6.0） |
| 异步队列     | Postgres `minion_jobs` (FOR UPDATE SKIP LOCKED) | ✅ 已落地 |
| 维护任务     | `lint_run` / `facts_expire` minion job + CLI | ✅ 已落地 |
| 历史 wiki 导入 | 不导入；保留为只读历史                    | ✅ 已决 |
| Web UI     | Phase 3 再说                            | 🔴 待启动 |
| 单测 / E2E   | 当前 0 测，Tier 0 优先级缺口            | 🔴 待补 |

文档与 schema 真相源：`infra/init-v2.sql` + `infra/migrations/v2.1.0 → v2.6.3`。
