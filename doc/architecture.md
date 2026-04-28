# LLM Wiki 整体架构（v2 — 投资研究专用）

> 面向**研究报告 + 投资分析**场景的 Postgres + pgvector 架构方案。
> 本文是 v2 设计的**单一真相文档**——schema、原则、SQL、迁移路径都在这里。
>
> **Status**: Draft v2. 全新设计；v1 三表（wiki_pages / wiki_links / raw_sources）已废弃，schema 文档已删除。
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

---

## 2. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                       Layer 6: Client / Agent                     │
│  Claude Code (MCP)  │  CLI tool  │  Web UI (后期)                 │
└──────────────────┬───────────────────────────────────────────────┘
                   │ MCP / API / SQL
┌──────────────────▼───────────────────────────────────────────────┐
│                      Layer 5: Skills (orchestration)              │
│   ingest    │   query   │   enrich   │   thesis-track   │ ...    │
│   daily-review (existing) │ daily-summarize (existing)            │
│   signal-detector (new)   │ consensus-monitor (new)               │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│                  Layer 4: Service / Business Logic                │
│   fact extraction   │   entity resolution   │   link extraction   │
│   embedding pipeline │   provenance tracking │   conflict detect  │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│                       Layer 3: Search                              │
│   keyword (tsvector)            │  vector (pgvector HNSW)         │
│   RRF fusion → boost → cosine rerank → backlink boost → dedup     │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│                  Layer 2: Postgres + pgvector                     │
│  pages (万物皆 page) │ content_chunks │ links │ tags              │
│  facts (投资专属) │ theses │ signals │ timeline_entries          │
│  raw_files │ raw_data │ page_versions │ events │ minion_jobs     │
│  sources (多租户) │ config                                        │
└──────────────────┬───────────────────────────────────────────────┘
                   │ ingest / sync
┌──────────────────▼───────────────────────────────────────────────┐
│                       Layer 1: Raw                                 │
│  raw/{date}/{type}/*.md         (mineru parsed markdown)          │
│  raw/{date}/{type}/*_content_list.json  (mineru structured)       │
│  raw/{date}/{type}/*.meta.json  (sidecar with API metadata)       │
│  raw/*.xlsx / *.pdf             (broker models, raw uploads)      │
└──────────────────────────────────────────────────────────────────┘
                   ▲
                   │ fetch-reports skill
                   │ (1) MongoDB 查 ResearchReportRecord
                   │ (2) S3 下载 parsedMarkdownS3
                   │ (3) 写 raw/ + INSERT raw_files (research_id 唯一去重)
                   │
              MongoDB ─┐
              S3       ─┘ (上游研究平台)
```

### 2.1 关键设计决策

| 决策                  | 选择                                                  | 理由                       |
| ------------------- | --------------------------------------------------- | ------------------------ |
| **Source of truth** | Postgres                                            | 多源 / 多人 / 时间轴查询的天然胜场     |
| **存储边界**          | DB 是唯一存储，不维护 markdown 文件                                  | 避免双写一致性问题；agent 编辑 DB 即可，不需要 Obsidian |
| **嵌入模型**            | OpenAI `text-embedding-3-large` (1536 维)            | 中英文质量好                   |
| **Chunking**        | mineru content_list.json 的 type 边界（首选）→ 段级 fallback | 利用已有解析，不重新切              |
| **实体设计**            | 万物皆 page（gbrain 模式）+ 投资强查询字段直接进 pages 列             | 单一索引、跨类型 link 天然成立       |
| **Fact extractor**  | 三层：YAML block 直读 → 正则 → LLM（兜底）                     | 从可靠到不可靠，最大化 zero-cost 部分 |
| **Async pipeline**  | Postgres 原生 `minion_jobs` 表（gbrain 模式）              | 不引入 Redis                |
| **多租户**             | `sources(id)` 表（gbrain 模式）                          | wiki / 个人笔记 / 实验区共库分区    |

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

7. **不支持物理删除（append-only + soft archive）** — 任何已写入的 page / fact / link 都不 DELETE，只通过状态字段标记：
   - `pages.status = 'archived'` — 不再参与默认搜索，但历史可查
   - `facts.valid_to = <date>` — 标记 fact 失效（被新 fact 覆盖），原行保留
   - `signals.resolved = true` — 标记已处理，不删
   - `theses.status = 'closed' | 'invalidated'` — 论点终止，记录 close 数据

   **好处**：
   - 不需要外键 ON DELETE CASCADE（已全部移除）
   - 不会出现悬空引用 / 孤儿数据问题
   - 时间旅行查询天然成立（"3 个月前 wiki 怎么说"直接 SQL）
   - 审计 / 合规友好（任何变更可追溯）

   **代价**：表会持续增长。MVP 阶段无影响；超大规模时按月分区或冷归档。

### 3.1 完整表清单（15 张）

| #   | 表名                 | 角色                | 核心字段                                                                         |
| --- | ------------------ | ----------------- | ---------------------------------------------------------------------------- |
| 1   | `sources`          | 多租户分区（gbrain）     | id, name, config                                                             |
| 2   | `pages`            | **核心：万物皆 page**   | slug, type, content, frontmatter, ticker, sector, embedding, tsv             |
| 3   | `content_chunks`   | 分段 embedding      | page_id, chunk_text, chunk_type, embedding                                   |
| 4   | `links`            | 类型化边 + provenance | from_page_id, to_page_id, link_type, link_source, origin_page_id             |
| 5   | `tags`             | m2m 标签            | page_id, tag                                                                 |
| 6   | `facts`            | **投资专属：时间序列数值**   | entity_page_id, metric, period, value_numeric, source_page_id, valid_from/to |
| 7   | `theses`           | **投资专属：论点状态机**    | page_id (PK), target_page_id, direction, conviction, status                  |
| 8   | `signals`          | **投资专属：自动事件流**    | signal_type, entity_page_id, thesis_page_id, severity, detected_at           |
| 9   | `timeline_entries` | 结构化时间线            | entity_page_id, event_date, event_type, summary                              |
| 10  | `raw_files`        | 原始文件登记            | raw_path, research_id, parse_status, ingested_page_id                        |
| 11  | `raw_data`         | JSONB sidecar     | page_id, source, data                                                        |
| 12  | `page_versions`    | 快照历史              | page_id, content, edited_by, snapshot_at                                     |
| 13  | `events`           | 审计 log            | actor, action, entity_id, payload                                            |
| 14  | `minion_jobs`      | 异步队列（gbrain）      | name, status, data, attempts                                                 |
| 15  | `config`           | 配置 KV             | id (即 key), value                                                            |

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

#### 维护机制：signal-detector 自动建议 + Phase 2 人工 API override

**Phase 1（默认）— 全自动**：
- `theses` 行不由人工创建。每次 ingest Stage 8 检测到关联 active thesis 的 entity 出现关键 fact 变化（如 EPS miss / 目标价大幅修订）→ `signal-detector` 自动写入 `signals`
- 当 signals 累积到一定密度或严重度（详见 signal-detector skill 规则）→ 自动 UPDATE `theses` 的 `conviction` / `status` / `validation_conditions[].status`
- 自动调整都带 `update_by = 'agent:signal-detector'`，可审计、可回滚

**Phase 2 — 人工 API override**：
新增 endpoint（CLI / MCP tool / Web UI 后期）：
- `thesis.create(target_page_id, direction, conviction, ...)` — 人工新建论点
- `thesis.update(page_id, fields)` — 人工修改 conviction / status / catalysts 等
- `thesis.close(page_id, reason)` — 人工平仓
- 任何人工 update 写 `update_by = 'human:<name>'`，所以可一眼区分 agent vs 人

**冲突解决**：人工 update 后，signal-detector 检测到自动建议时不强制覆盖人工值；改为写一条 `signals (severity='warning', signal_type='thesis_human_override_suggestion')`，让 PM 看见。

### 3.9 signals — 自动事件流（投资专属）

`signal-detector` skill 自动写入。任何"值得 PM 注意"的离散事件。

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

### 3.11 raw_files — 原始文件登记

直连 MongoDB `ResearchReportRecord` 集合拉取的 markdown 先登记在这，ingest 后才创建 pages 记录。两者通过 `ingested_page_id` 关联。

```sql
CREATE TABLE raw_files (
  id                BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  source_id         TEXT NOT NULL DEFAULT 'default',
  raw_path          TEXT NOT NULL UNIQUE,         -- 'raw/2026-04-26/meeting_minutes/xxx.md'
  research_id       TEXT,                          -- 上游 ResearchReportRecord.researchId
  research_type     TEXT,                          -- 'meeting_minutes' | 'arete' | 'twitter' | ...
  org_code          TEXT,                          -- 上游 orgCode (如 'JG1000')，后续作为多租户/权限边界
  title             TEXT,
  tags              TEXT[],                        -- 上游 tags[]
  mongo_doc         JSONB,                         -- 完整 MongoDB ResearchReportRecord 文档
  parse_status      TEXT,                          -- upstream parseStatus: 'completed' | 'pending' | ...
  ingested_page_id  BIGINT,
  ingested_at       TIMESTAMPTZ,
  -- 标准审计字段（所有表统一）
  extend       JSONB,
  create_by    VARCHAR(64) NOT NULL DEFAULT '',
  update_by    VARCHAR(64) NOT NULL DEFAULT '',
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted      SMALLINT    NOT NULL DEFAULT 0,

  CONSTRAINT raw_files_research_id_key UNIQUE (research_id)   -- fetch-reports 去重 key
);

CREATE INDEX idx_raw_files_pending       ON raw_files (create_time DESC) WHERE ingested_at IS NULL;
CREATE INDEX idx_raw_files_research_type ON raw_files (research_type);
CREATE INDEX idx_raw_files_org           ON raw_files (org_code) WHERE org_code IS NOT NULL;
CREATE INDEX idx_raw_files_tags          ON raw_files USING GIN (tags);
```

**字段说明**：
- `research_id` 全局 UNIQUE — fetch-reports 直接 `INSERT ... ON CONFLICT (research_id) DO NOTHING` 去重
- `mongo_doc` 存完整 `ResearchReportRecord` 文档（含 `parsedMarkdownS3` / `parsedContentListS3` / `parseLockedBy` / 时间戳等所有字段），失去 schema 锁定但保留全部上游信息
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

不引入 Redis / Celery。

```sql
CREATE TABLE minion_jobs (
  id           BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name         TEXT NOT NULL,                     -- 'embed_chunks' | 'extract_facts' | 'enrich_entity' | 'detect_signals'
  status       TEXT NOT NULL DEFAULT 'waiting',   -- 'waiting' | 'active' | 'completed' | 'failed'
  data         JSONB NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  result       JSONB,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  -- 标准审计字段（所有表统一）
  extend       JSONB,                                            -- 扩展信息（任意 JSON 元数据）
  create_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 创建人（'agent:claude' / 'human:levin' / ...）
  update_by    VARCHAR(64) NOT NULL DEFAULT '',                  -- 更新人
  create_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 创建时间
  update_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),               -- 更新时间（应用层维护）
  deleted      SMALLINT    NOT NULL DEFAULT 0                    -- 逻辑删除：0=未删除, 1=已删除
);

CREATE INDEX idx_jobs_pending ON minion_jobs(name, create_time) WHERE status = 'waiting';
CREATE INDEX idx_jobs_status ON minion_jobs(status, create_time DESC);
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
         └───────────────┘    └───────────────┘
                  ▲
                  │ ingest 流程异步入队
                  │
              [ingest skill]
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
[fetch-reports skill]
    ↓ MongoDB 查 ResearchReportRecord WHERE parseStatus='completed'
    ↓ 对每条 record：先查 raw_files 是否已存在 (research_id 去重) → 没有则下载 parsedMarkdownS3
    ↓ 写 raw/{date}/{type}/*.md + INSERT raw_files (含 org_code, tags, mongo_doc)
[raw_files (ingested_at IS NULL) 队列]
    ↓ ingest skill
    ↓
[Stage 1: 登记 raw_files + 创建 pages 骨架]
    ├─ INSERT INTO raw_files (raw_path, research_id, research_type, ...)
    ├─ INSERT INTO pages (slug='sources/<prefix>-<title>-<date>', type='source', title, ...)
    ├─ UPDATE raw_files SET ingested_page_id = <new page id>
    └─ 写 events: 'ingest_start'
    ↓
[Stage 2: 内容分段（不依赖上游 summary）]
    ├─ 读 raw markdown + 可选读 content_list.json 的 type 边界
    ├─ 切分为 chunks，保留 chunk_type / page_idx
    ├─ 表格 / 图表 chunk 单独标记，便于后续过滤
    └─ 写 content_chunks（embedding 留空，等异步任务）
    ↓
[Stage 3: agent 生成 wiki narrative（核心）]
    ├─ Claude 读 raw markdown（必要时按 chunk 顺序）
    ├─ 按 CLAUDE.md source 页 schema 生成结构化 wiki content：
    │   - 来源概要 / 关键要点 / 重要数据点
    │   - 值得注意的观点引语 / 结构性观察
    │   - 与现有知识的关系 / 后续跟进项
    ├─ 写 pages.content（人 + LLM 都能读的 markdown）
    └─ Agent 自带产出 tone / 个股看法 / 行业判断（写到 frontmatter JSONB）
    ↓
[Stage 4: 实体识别 + 链接抽取]
    ├─ 从 pages.content 提取：
    │   - [[wikilink]] / [Name](path) markdown link
    │   - 已知 ticker (NOW / 600519.SH / ...)
    │   - alias 匹配: pages.aliases[]
    ├─ 不存在的实体 → 自动建 pages 记录（type='company' 等，confidence='low'，待 enrich）
    └─ 写 links (link_source='extracted', origin_page_id)
    ↓
[Stage 5: 事实抽取]
    ├─ Tier A: <!-- facts ... --> YAML block 直读（agent 在 Stage 3 写入）
    ├─ Tier B: 正则 (revenue $X / FY27 EPS $X.XX / 目标价 X)
    ├─ Tier C: LLM call（默认启用 Haiku，自动跑；可通过 config.fact_extract_llm_enabled 关闭）
    └─ 写 facts（带 valid_from = source 页的 create_time::date）
    ↓
[Stage 6: 异步任务入队]
    ├─ minion_jobs: embed_chunks → 调 OpenAI embedding
    ├─ minion_jobs: enrich_entity → 给红链补全（公司基本面、关键人）
    └─ minion_jobs: detect_signals → 跨 source 比对，发现 expectation gap
    ↓
[Stage 7: timeline 提取]
    ├─ agent 在 Stage 3 narrative 中已识别的事件（earnings / guidance / rating）
    └─ 写 timeline_entries
    ↓
[Stage 8: thesis 关联]
    ├─ 如果 source 关联的 entity 有 active thesis → 写 signals
    │   （'thesis_validation' 或 'thesis_invalidation'）
    └─ 写 events: 'ingest_complete'
```

### 4.2 失败 / 重试

- 每个 stage 独立事务，单 stage 失败不影响已完成的
- minion_jobs 自带重试（max_attempts=3，exponential backoff）
- ingest 失败的 page 标 `status='draft'`，不参与默认搜索，研究员可见

### 4.3 增量 vs 全量

- **增量**：fetch-reports 已经幂等（已存在跳过），ingest 也按 `raw_files.ingested_at IS NULL` 过滤待 ingest 的
- **全量重建**：保留 `rebuild` 风格命令，从 raw/ 重新跑（用于 schema 升级 / extractor 升级时）

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

给 Claude / agent 暴露的 5 个工具（不给裸 SQL）：

| Tool | 用途 |
|---|---|
| `search(query, filters)` | hybrid search，返回 page list |
| `get_page(slug or id)` | 拿完整 page（含 frontmatter 中的 tone / 个股看法等 agent 提炼字段）|
| `query_facts(entity, metric?, period?)` | 结构化事实查询 |
| `list_entities(type, filters)` | 实体列表（按 sector / status / ...）|
| `recent_activity(days, kinds?)` | 最近活动（events + signals + new pages）|

**禁止**：直接 SQL execute（即使 read-only）。生产事故风险太高。

---

## 6. Skills 演化

### 6.1 现有 skill → 新架构下的角色

| Skill | 改动 | 后台 |
|---|---|---|
| `fetch-reports` | **重写**：HTTP API → 直连 MongoDB；写入扩展 raw_files（含 org_code / tags / mongo_doc）| MongoDB + S3 |
| `daily-review` | 改成查 Postgres 而非 grep markdown | events/signals |
| `daily-summarize` | 同上 | facts/theses |
| `analyze-ideabot` | 同上 | facts |
| `analyze-timebot` | 同上 | events |

### 6.2 新增 skill

| Skill | 触发 | 作用 |
|---|---|---|
| `ingest` | fetch-reports 后 / 手动 | 跑 Stage 1-8 ingest pipeline |
| `enrich` | 红链 entity / 手动 | 补全 entity 元数据（市值、关键人、产品线）|
| `query` | 用户提问 | 编排 MCP tools 回答问题 |
| `thesis-track` | active thesis 状态变化 | 维护 theses 表，关联 catalysts |
| `signal-detector` | ingest 后台任务 | 检测 expectation gap / consensus drift / earnings surprise |
| `consensus-monitor` | 每日 / 实时 | 跟踪 Arete vs 街口的差距漂移 |
| `catalyst-tracker` | 每周 | 维护 timeline_entries 中 expected catalysts |
| `maintain` | 每周 / 月 | 健康检查（stale page / broken link / fact 一致性 / 重复实体合并候选）|

### 6.3 Skill 间数据流

```
fetch-reports → raw/
    ↓
ingest → pages + content_chunks + facts + links + timeline_entries
    ↓
signal-detector → signals
    ↓
daily-review (读 events + signals + facts) → 写 pages (type='output', slug='outputs/daily-review-{date}')
    ↓
daily-summarize (读 events + signals + theses) → 写 pages (type='output', slug='outputs/daily-summarize-{date}')
```

---

## 7. 技术选型

### 7.1 已确定

| 层         | 选型                                                 |
| --------- | -------------------------------------------------- |
| 数据库       | Postgres 16-17 + pgvector 0.8.2                    |
| Embedding | OpenAI `text-embedding-3-large` (1536)             |
| 主语言       | **TypeScript**（runtime 倾向 Bun，与 gbrain 一致；scripts/ 下的 fetch_reports.py 是 Python legacy，Phase 1 重写为 TS）|
| ORM       | Drizzle ORM（pgvector 支持完善、TS-native、SQL-like）       |
| Postgres 客户端 | `postgres.js`（高性能，Drizzle 默认搭配） |
| 上游数据源    | **MongoDB**（直连 `ResearchReportRecord` 集合）+ S3（下载 parsedMarkdownS3）|
| MongoDB 客户端 | `mongodb` 官方 Node 驱动 |
| 接入 Claude | MCP server (`@modelcontextprotocol/sdk` TypeScript) |

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

```bash
# Postgres（v2 wiki 主存储）
DATABASE_URL=postgresql://ae_root:<password>@<host>:54329/ae_wiki

# MongoDB（上游研究报告元数据，只读）
MONGODB_URI=mongodb://<user>:<password>@<host>:27017/<auth_db>
MONGODB_DB=<db_name>                # 含 ResearchReportRecord 集合的库
MONGODB_COLLECTION=ResearchReportRecord

# OpenAI（embedding + 兜底 fact 抽取）
OPENAI_API_KEY=sk-...
OPENAI_EMBEDDING_MODEL=text-embedding-3-large

# OpenAI（agent runtime / embedding / 未来 fact fallback）
OPENAI_API_KEY=sk-...

# 可选：S3（如需直接 boto3 / aws-sdk 访问；HTTP GET 也够）
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-southeast-1
```

---

## 8. Migration 路径

> v2 是**全新 schema**。不做"在 v1 三表上 ALTER"的增量演进——会留下半生不熟的混合 schema。

### Phase 0：准备（本周）

- [ ] 完成本架构文档评审
- [ ] 编写 `infra/init-v2.sql`（15 张新表的完整 DDL）
- [ ] 在 Postgres 实例上**重建 schema**（DROP v1 三表 → CREATE v2 全部表）
- [ ] 写 ingest skill 的 v0 骨架（仅 Stage 1-3）

### Phase 1：MVP（4 周）

- [ ] 完整 ingest pipeline（Stage 1-8）
- [ ] 5 个 MCP tools 上线
- [ ] **可选**：把现有 `wiki/source/*.md` 跑一次 ingest 导入 DB（仅作为历史内容迁移；导入完 wiki/ 目录可归档/删除）
- [ ] daily-review / daily-summarize 改为从 Postgres 读 + 输出到 `pages` 表（type='output'）
- [ ] 一周生产试用，发现 schema 缺口

### Phase 2：增强（4 周）

- [ ] signal-detector + consensus-monitor 上线
- [ ] thesis 状态机 + catalyst tracker
- [ ] entity enrich pipeline（自动补全 alias / sector / 关键人）
- [ ] daily-review / daily-summarize 输出查看入口（CLI / 简易 web 渲染）

### Phase 3：稳态（持续）

- [ ] Web UI（如需，根据团队规模决定）
- [ ] 多人协作（auth + permissions）
- [ ] 高级分析 dashboard
- [ ] 外部集成（Bloomberg / Wind 数据）

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

## 10. 待决问题（请研究员定夺）

下列问题影响后续实施，需要在 Phase 0 之前明确：

1. **历史 wiki 内容是否导入？**
   - 选项 A：跑一次 ingest pipeline 把现有 `wiki/source/*.md` 全量导入 DB
   - 选项 B：完全新起炉灶，旧内容不导入
   - 建议：A（挑空闲日批量跑），导入完 `wiki/` 目录归档

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

## 12. 决策清单（给研究员的 1 页摘要）

| 问题         | 我的建议                       | 等你拍板  |
| ---------- | -------------------------- | ----- |
| 主存储        | Postgres + pgvector        | ✅ 已定  |
| 实体设计       | 万物皆 page + 投资字段直接成列        | ✅ 已定  |
| 存储边界       | DB 唯一存储，不维护 markdown       | ✅ 已定  |
| 主语言        | TypeScript + Bun + Drizzle | ✅ 已定  |
| Fact 抽取策略  | 三层全开（YAML / 正则 / LLM 兜底）   | ✅ 已定  |
| LLM 兜底     | 默认开启（Tier C，Haiku 模型）      | ✅ 已定  |
| Thesis 维护  | signal-detector 自动建议（Phase 2 加人工 API override）| ✅ 已定 |
| Entity 自动建 | 自动 + `confidence='low'` 标记 | ✅ 已定 |
| 历史 wiki 导入 | 一次性批量后归档原 wiki/            | ⚠️ 待定 |
| MVP 周期     | 4 周                        | ⚠️ 待定 |
| 是否做 Web UI | Phase 3 再说                 | ⚠️ 待定 |

确认后我就开始 Phase 0：写 `infra/init-v2.sql` schema migration + ingest skill v0 骨架。
