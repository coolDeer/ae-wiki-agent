# ae-wiki-agent — 概念导览

> 给「想理解这套系统怎么运作」的人看。
>
> - 比 [architecture.md](./architecture.md) 浅（不展开 DDL / 迁移），比 [cli-commands.md](./cli-commands.md) 深（不只是命令清单）
> - 读完应该能心智地跑完一遍：从一份 PDF 研报 → 进 mongo → 进 wiki 表 → 给 PM 用
>
> **定位**：投资研究知识库 + agent 工作台。原始素材是 mineru 解析过的研报 / 调研纪要 / tweet thread / newsletter；产出物是结构化的 `pages` / `facts` / `theses` / `signals`，供 LLM agent 与 PM 跨 source 推理。

---

## 1. 一图看懂

```
┌───────────────────────────────────────────────────────────────────┐
│ 上游（不归本系统管）                                              │
│   mongo.ResearchReportRecord                                      │
│     ├─ parsedMarkdownS3       (原文 markdown)                     │
│     └─ parsedContentListV2S3  (mineru 结构化 block JSON)          │
└────────────┬──────────────────────────────────────────────────────┘
             │ fetch-reports
             ▼
┌───────────────────────────────────────────────────────────────────┐
│ raw_files (登记 + URL，不落正文)                                  │
│   research_id 去重 / triage_decision / parsed_content_list_v2_url │
└────────────┬──────────────────────────────────────────────────────┘
             │ ingest:peek → commit | brief | pass
             │ ingest:write → finalize (stage 1-8)
             ▼
┌───────────────────────────────────────────────────────────────────┐
│ Postgres (唯一真相源)                                             │
│                                                                   │
│   核心三表：pages / content_chunks / links                        │
│   投资专属：facts / theses / signals / timeline_entries           │
│   异步层  ：minion_jobs / agent_messages / agent_tool_executions  │
│   审计    ：events / page_versions / raw_data (sidecar)           │
└─────────┬──────────────────────────────────┬──────────────────────┘
          │ MCP tools                        │ skills
          ▼                                  ▼
   search / get_page              ae-fetch-reports / ae-research-ingest
   query_facts / list_entities    ae-enrich / ae-thesis-track
   get_table_artifact             ae-daily-review / ae-daily-summarize
   compare_table_facts
```

---

## 2. 万物皆 page

`pages` 是这个系统最核心的表。**任何被 wiki 沉淀下来的东西都是一个 page**——研报摘要、公司、行业、个人、概念、投资论点……每行都有 `slug`（唯一稳定标识，如 `companies/NVIDIA`）+ `type`（决定模板与规则）+ `content`（markdown narrative）。

| `type` | 说明 | slug 前缀 |
|---|---|---|
| `source` | 深度研报 / 调研纪要的摘要页（agent 写的 7 段） | `sources/` |
| `brief` | 轻量前沿动态（tweet / 单段 newsletter / chat 散点） | `briefs/` |
| `company` | 公司实体页 | `companies/` |
| `industry` | 行业页 | `industries/` |
| `person` | 人物页 | `persons/` |
| `concept` | 投研概念页（如 CXL、HBM） | `concepts/` |
| `thesis` | 投资论点页（带状态机） | `theses/` |
| `output` | 派生产物（daily-review / daily-summarize） | `outputs/` |

为什么万物皆 page？这样 search / 反向链接 / 审计 / 版本管理都只用一种数据形态对齐。详见 [architecture.md §2](./architecture.md)。

---

## 3. raw_files：「等候 ingest 的素材」

mongo 每天会有新研报落进来。`fetch-reports` 把它们登记到 `raw_files`：

```sql
raw_files (
  id,
  markdown_url,                   -- mongo doc.parsedMarkdownS3 直链
  parsed_content_list_v2_url,     -- mongo doc.parsedContentListV2S3 直链 (V2 必备)
  research_id,                    -- mongo doc.researchId（partial unique，去重）
  research_type,                  -- mongo doc.researchType 字符串映射
  title, tags, mongo_doc,
  triage_decision,                -- 'pending' | 'pass' | 'commit' | 'brief'
  ingested_page_id,               -- 已 ingest 后挂上来
  ingested_at, skipped_at, skip_reason,
  ...
)
```

> 上游已保证 `researchId` 唯一；研究项有重复时加 `-n` 后缀区分。

**重点**：raw markdown / V2 JSON **不落本地**；ingest 阶段按 URL HTTP 拉。这样 mongo 同步是秒级的（之前是分钟级）。

进度状态：
- `pending` → 还没 triage，是 `ingest:peek` 候选
- `pass` → agent 判定噪声，不建 page
- `commit` → 已建 source page
- `brief` → 已建 brief page

---

## 4. Triage：三选一不是二选一

「该不该 ingest」不是 yes/no，而是三选一：

| 类型 | 走 | 何时 |
|---|---|---|
| **核心投资素材** | `commit` → type='source'（7 段） | 研报 / 调研纪要 / 含具体公司/财务数据 |
| **前沿动态** | `brief` → type='brief'（4 段） | 长 tweet / 单段 newsletter / chat 散点；弱投资但值得留痕 |
| **真噪声** | `pass`（不建 page） | 个人推广 / 感谢回复 / 跟金融科技完全无关 |

设计动机：
- 一刀切 7 段：短素材塞不满，agent 编造或大段标"无"
- 一刀切 pass：丢失值得留痕的前沿动态（AI 工具新闻、行业八卦）
- 三分让每类素材有合适归宿

`brief` 比想象中重要——它是 wiki 跟"前沿动态"链接的入口，便宜、快速、不污染 source 池。日后觉得 brief 值得 deep dive，用 `ingest:promote <pageId>` 升级成 source。

---

## 5. content_chunks vs raw_data sidecar：两条管道

**这是这次大重构后的核心心智模型，必须理清。**

ingest Stage 2 拿到 V2 content_list（mineru 结构化 block JSON），分两条管道写出：

```
            mineru 上游
                │
                │ V2 content_list (page[] of block[])
                ▼
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
 chunkContentListV2     buildTableBundleFromV2
   (V2 chunker)          (HTML 表 → 结构化)
       │                 │
       ▼                 ▼
   content_chunks       raw_data
   (搜索召回用)         (source='tables', 精确取数用)
       │                 │
       ▼                 ▼
 hybrid search        stage-5 Tier B / MCP 表格工具
```

| | content_chunks | raw_data sidecar |
|---|---|---|
| **目的** | 给搜索召回用 | 给 fact 抽取 / 跨 page 对比用 |
| **形态** | 自然语言 chunk + section_path + embedding | 解析好的 `{headers, rows[][], table_id}` JSON |
| **粒度** | 块级（200-800 tokens） | 整张表 |
| **典型查询** | "NVDA 数据中心营收增速" → 召回相关段 | "AI 硬件总表里 NVDA 的 27 年 EPS" → 直读 cell |

**重点**：两条管道都从 V2 派生，不再依赖 markdown 解析。

---

## 6. V2 block-aware chunker：怎么切才不傻

mineru 给的 V2 是**结构化的二维数组**：外层 `page[]`（物理分页），内层 `block[]`（每个 block 有 type=`title` / `paragraph` / `list` / `table` / `page_header` / `page_footer` / `page_number` 等）。

V2 chunker（`src/core/chunkers/v2-block.ts`）的策略：

1. **drop 噪声**：`page_header` / `page_footer` / `page_number` 整页噪声直接丢（避免数字签名 / 页眉混进 chunk）
2. **section 边界**：`title` block 不单独成 chunk，但维护 `sectionStack`，给每个 chunk 注入 `section_path`（全路径 e.g. `["专家观点", "Q3 风险"]`）
3. **token-budget 滚动**：paragraph 累积到 ~800 tokens flush 一次；超大单段不切（保完整语义）
4. **table 独立成块**：表格永远单独一个 chunk，prefix 加 `caption`
5. **list 原子**：list ≤2400 token 不拆 item；超大才按 item 切带 1 overlap

**为什么不用 markdown chunker**：markdown 解析靠 `\n\n` 边界，无法识别页眉、不知道 section 层级、把 table 当文本拆碎。V2 给了天然的语义边界。

每个 chunk 写库时还附带：
- `section_path TEXT[]` — 全路径 section 标题
- `page_idx INTEGER` — 跨页 chunk 取首块的页码
- `chunk_text` — chunk_text 顶部嵌入 `section_path` 行，让小块也有语境

---

## 7. raw_data sidecar：结构化表格的回收站

agent 写 narrative 时，往往会把 50 行的"AI 硬件总表"摘要成 3 行带过。但下游想精确查 "NVDA 27 年 EPS = 15.2" 时需要原表 50 行的完整数据。

`raw_data` 表（`source='tables'`）就是干这个的：在 Stage 2 用 `buildTableBundleFromV2` 从 V2 的 `<table>` HTML（含 rowspan/colspan）解析出结构化的 `{headers, rows[][], table_id}`，落库后供：

- **stage-5 Tier B** 抽 fact（行=公司、列=period 的 matrix table 自动展开成 N×M 个 fact）
- **MCP `get_table_artifact(slug)`** 直接返回 JSON
- **MCP `compare_table_facts(metric, entities, periods)`** 跨实体对比

```sql
raw_data (
  page_id, source='tables',
  data: {
    kind: 'tables',
    version: 1,
    extractedAt,
    tableCount,
    tables: [
      {
        table_id: 't1',
        headers: ['所属板块','股票代码','公司名称','24年EPS','25年预期EPS',...],
        rows: [
          ['AI芯片','NVDA.O','英伟达','3.0','4.8',...],
          ['AI芯片','AVGO.O','博通','4.8','6.8',...],
          ...
        ],
        row_count, column_count,
        raw_markdown,        -- 整张表 markdown 渲染
        row_markdowns: [...] -- 每行 pipe-delimited，给 fact source_quote 用
      },
      ...
    ]
  }
)
```

---

## 8. Wikilink + 红链：图谱怎么自然生长

agent 写 narrative 时**首次提到的实体必须加 wikilink**：

```markdown
英伟达 [[companies/NVIDIA]] 上季度营收 $35B，超出彭博一致预期 ...
带动 [[industries/光模块]] 整体上修。
```

ingest Stage 4 从 `pages.content` 抽出所有 wikilink slug：

```ts
[[(companies|persons|industries|concepts|sources|theses|outputs)/<slug>]]
```

对每个 slug 调 `resolveOrCreatePage`：

```
slug 已存在？─┬─是 → 拿 pageId
              └─否 → 自动建空壳 page
                       confidence='low'           ← 红链标记
                       title=slug 末尾段
                       content=NULL               ← 等 enrich
                       入队 enrich_entity job     ← 后台补全
```

「**红链**」= 指向了一个空壳 page 的链接（Obsidian 术语）。设计意图：

- agent 不需要预先建好所有公司，写到哪儿就长出哪儿
- source ingest 不阻塞在「先建公司页」
- 即使是空壳，`links` 表也保留了反向边，能查「哪些 source 提到 NVIDIA」

`confidence` 字段约定：

| 值 | 含义 |
|---|---|
| `low` | 自动建的空壳 / 红链，没人确认过 |
| `medium` | enrich agent 跑过，有 ticker / sector / aliases / narrative |
| `high` | 人类 reviewed 或经过深度研究 |

`ae-enrich` skill 专门干 low → medium 升级。`enrich:list` 列所有候选，`enrich:save` 落 narrative + bump。

---

## 9. facts：可查询的数值化记忆

narrative 是给人 / LLM 读的；`facts` 是给程序查的。stage-5 三层抽取：

| Tier | 来源 | 实现 |
|---|---|---|
| **A** | narrative 末尾的 `<!-- facts ... -->` YAML 块 | `stage-5-tier-a.ts` |
| **B** | raw_data sidecar 的结构化表格 | `stage-5-tier-b.ts` |
| **C** | LLM 从 prose 兜底抓漏 | `stage-5-tier-c.ts`（用 `OPENAI_FACT_EXTRACT_MODEL`） |

每条 fact 写库：

```
facts (
  entity_page_id    → 这是谁的指标（NVIDIA）
  source_page_id    → 哪个 source 写的（sources/Arete-NVDA-260315）
  metric            → revenue / eps_non_gaap / target_price / gross_margin / ...
  period            → FY2027E / 1Q26A / current / 2026-04-15
  value_numeric     → 数值
  unit              → usd_m / pct / x / cny_bn / ...
  confidence        → 0-1
  valid_from / valid_to  → 时间旅行：valid_to=NULL 表示当前最新
  metadata          → table_id / row_index / cell_ref / source_quote / ...
)
```

**时间旅行机制**：当新 source 给出同 `(entity, metric, period)` 的更新值，老的 fact 标 `valid_to=today`（不是删除），新 fact `valid_to=NULL`。这样能查「3 月 15 日时 Arete 估的 NVDA FY27 EPS 是多少」。

MCP `query_facts(entity, metric?, period?)` 是查询入口。

---

## 10. theses + signals：投资论点状态机

`theses` 是投资论点页的状态机部分（page 本体的 type='thesis'）。除了 narrative 还带：

```
theses (
  page_id           → 论点页 (type='thesis')
  target_page_id    → 标的实体（companies/X 或 industries/Y）
  direction         → 'long' | 'short'
  conviction        → 数字打分
  status            → 'active' | 'closed'
  catalysts         → JSONB 数组（待发生的催化剂）
  validation_conditions  → JSONB 数组（怎样算证实/证伪）
)
```

`ae-thesis-track` skill 维护：开仓 / 改 conviction / 标 catalyst 命中 / 关仓归档。

`signals` 是自动检测出来的事件流：

```
signals (
  signal_type   → 'thesis_validation' | 'expectation_gap' | ...
  entity_page_id, thesis_page_id, source_page_id
  severity      → 'info' / 'warn' / 'alert'
  data          → JSONB 详情
)
```

**两条触发线**：

- **stage-8** 在 ingest 完成时扫一遍：本 source 提到的实体里有没有 active thesis 的 target → 写一条 `thesis_validation` signal（`severity='info'`，提示 PM 「新 source 触及」）
- **`detect_signals` minion job**（worker 异步跑）：跨 source 比对发现 expectation gap

### Enrich vs Thesis-track：wiki 的两层

经常被混淆，一句话区分：

> **`ae-enrich` 是「让 wiki 长出来」，`ae-thesis-track` 是「让 wiki 帮你做决策」。**

| | `ae-enrich` | `ae-thesis-track` |
|---|---|---|
| 关心 | 个体页面**内容** | 跨页面的投资**判断** |
| 数据形态 | narrative + 元数据（ticker/sector/aliases） | catalysts / conditions / conviction（状态机） |
| 触发 | stage 4 自动入队 + `enrich:next` 手动 | PM 表态 / 周期 review，从 0 → 开仓 |
| 典型操作 | 把空壳红链填满，`confidence: low → medium/high` | open / write / update --add-catalyst / --mark-condition / close |
| 失败语义 | 信息不足时保 `low`，等下次 source 来再补 | invalidated / stop_loss → `thesis:close --reason ...` |

可以这么记：enrich 是**编辑器**，thesis-track 是**仪表盘**。两者通过 `pages` 共享底层数据，但服务的人和频率不同——enrich 是后台持续跑的（红链一长出来就派活），thesis-track 是 PM 每周 review 时才动。

---

## 11. 八阶段 ingest pipeline

| Stage | 触发 | 干啥 | 写哪 |
|---|---|---|---|
| 1 | `ingest:commit` / `:brief` | 建 page 骨架（slug + type + frontmatter） | `pages` + events |
| 2 | 同上 | V2 chunker → chunks; V2 table → sidecar | `content_chunks` + `raw_data` |
| 3 | `ingest:write` | 落 narrative；`<!-- timeline -->` 切给 page.timeline；frontmatter 合并 | `pages.content` + `page_versions` |
| 4 | `ingest:finalize` | wikilink → links + 自动建红链 + 入队 enrich | `links` + `pages` (低 confidence) + `minion_jobs` |
| 5 | 同上 | 三层 fact 抽取（A YAML / B 表格 / C LLM） | `facts` |
| 6 | 同上 | 入队 embed_chunks + detect_signals jobs | `minion_jobs` |
| 7 | 同上 | timeline YAML → entries | `timeline_entries` |
| 8 | 同上 | 检测命中 active thesis → 写 signal；写 `ingest_complete` event | `signals` + events |

**断点续跑**（v2.7.1+）：每个 finalize stage 成功写 `ingest_stage_done` event；重跑同 pageId 默认跳过已完成；`--from N` 强制 N..8 重跑。

---

## 12. 异步层：minion_jobs + durable agent runtime

不是所有事都同步跑。Stage 6 入队两类 page-级别 job：

| job name | handler | 干啥 |
|---|---|---|
| `embed_chunks` | worker 内置 | 调 OpenAI embedding API 给新 chunks 填 embedding |
| `detect_signals` | worker 内置 | 跨 source 比对发现 expectation gap |
| `enrich_entity` | worker 内置 → 派发 agent_run | Stage 4 自动建红链时入队，由 `ae-enrich` skill 真正补全 |
| `agent_run` | durable agent runtime | skill 名称指定（ae-enrich / ae-research-ingest 等），跑 LLM agent |

**durable agent runtime** 是 v2.6.0 加的新东西：agent 的对话历史和 tool calls 落 `agent_messages` / `agent_tool_executions`，崩溃可恢复。`ae-wiki agent:* / jobs:*` CLI 是控制面。

`bun src/cli.ts worker` 起后台进程消费 `minion_jobs`（`FOR UPDATE SKIP LOCKED` 队列）。

---

## 13. MCP tools：agent 怎么查 wiki

Claude Code 通过 stdio 调 MCP server（`src/mcp/server.ts`），暴露 7 个工具：

| 工具 | 用途 |
|---|---|
| `search(query, filters)` | hybrid 检索（keyword + 可选 vector + RRF），返回带 `section_path` 的命中 |
| `get_page(slug)` | 拿完整 page（含 frontmatter / 反链计数） |
| `query_facts(entity, metric?, period?)` | 结构化 fact 查询；`table_only=true` 限定表格出处 |
| `get_table_artifact(slug, table_id?)` | 拿 page 的全部 / 单张表格 artifact JSON |
| `compare_table_facts(metric, entities?, periods?)` | 跨实体 / period 对比矩阵 |
| `list_entities(type, filters)` | 实体列表 |
| `recent_activity(days, kinds?)` | 最近 events / signals / new pages |

**禁止直接 SQL**——所有查询走这 7 个口子。`.mcp.json` 已配，新会话自动连。

---

## 14. Hybrid search 的内部分层

`search(query)` 不是简单的 SELECT，是多通道 + 融合 + 重排的流程：

```
query
  │
  ├─ keyword 通道：pages.tsv 粗筛 + LATERAL 找最高 chunk
  │   ├─ slug 前缀加权 (sources/Arete- 1.5x, sources/cb- 0.6x ...)
  │   └─ 返回 ChunkCandidate[]
  │
  ├─ vector 通道：query embedding × content_chunks.embedding
  │   ├─ HNSW 索引 + slug source-factor
  │   └─ 返回 ChunkCandidate[]
  │   （EMBEDDING_DISABLED=true 时跳过整通道）
  │
  ├─ 多 query 扩展（opt-in）：用 OPENAI_AGENT_MODEL 改写出 2 个备选
  │
  ├─ RRF 融合：1/(K+rank) 累加，归一化
  │
  ├─ cosine re-score：blend = 0.7*rrf + 0.3*cosine
  │
  ├─ backlink boost：score *= 1 + 0.05*log(1+反链数)
  │
  ├─ dedup pipeline：jaccard / type-cap / max-per-page (intent-aware)
  │
  └─ bestChunkPerPage → 返回 page-level SearchHit (含 section_path)
```

这套是从 `gbrain` 借鉴的（见 `gbrain-borrowings.md`）。`WIKI_SEARCH_DEBUG=true` 打印中间分。

---

## 15. 命名约定速查

### slug
- 格式 `<dir>/<name>`，dir ∈ `companies | persons | industries | concepts | sources | theses | outputs | briefs`
- 公司用规范英文名（`companies/Tencent`），别名走 `aliases TEXT[]` 列
- 中文行业 / 概念可用中文（`industries/半导体`）

### aliases
- `pages.aliases TEXT[]` 存等价名：英文全名 / 中文名 / ticker
- 自动并入 `pages.tsv` 全文索引（与 title 同权重 A）
- 例：`companies/Tencent.aliases = ['腾讯','腾讯控股','Tencent Holdings','700.HK','TCEHY']`

### tags
- frontmatter 中的 `tags: [...]`，YAML 列表，小写英文 + 短横线
- 分类示例：`semiconductor` / `growth` / `china` / `ai-frontier` / `high-conviction`

### Citation
- 数据点：`（来源：[[sources/...]]）`
- 带时间：`（来源：[[sources/Arete-NVDA-260315]]，2025Q3）`

### 矛盾处理
- **不删**旧信息；旧信息后加 `> ⚠️ 更新（YYYY-MM-DD）：[新内容]（来源：...）`
- 重大矛盾在 `events` 表写 `action='conflict'`

---

## 16. 决策表：「我想做 X，应该读哪个表」

| 想做 | 读哪 | 怎么读 |
|---|---|---|
| 「天孚通信最近一次业绩怎么说」 | `pages.content` (sources/...) | MCP `search` |
| 「NVDA FY27 EPS 各 broker 估多少」 | `facts` | MCP `query_facts` |
| 「NVDA 跟 AVGO 估值对比」 | `raw_data` (tables) | MCP `compare_table_facts` |
| 「光模块产业链有哪些公司」 | `pages` + `links` | MCP `search` + `get_page` |
| 「我的多头论点状态」 | `theses` | `bun src/cli.ts thesis:list` 或 MCP `list_entities('thesis')` |
| 「最近 7 天新 ingest 了什么」 | `events` + `pages` | MCP `recent_activity` |
| 「哪些公司还没 enrich」 | `pages WHERE confidence='low'` | `bun src/cli.ts enrich:list` |
| 「3/15 时 Arete 估的 NVDA FY27 EPS」 | `facts WHERE valid_from <= '2026-03-15' AND (valid_to IS NULL OR valid_to > '2026-03-15')` | 暂无 MCP，要扩展 |

---

## 17. 8 个 skill 全景对比

按「**生产数据**还是**消费数据**」分两组。生产者写 wiki 表，消费者读 wiki 表生成派生产物。

### Producer：往 wiki 里写

| skill | 关心 | 数据形态 | 主入口 | 何时用 | 失败 / 边缘处理 |
|---|---|---|---|---|---|
| `ae-fetch-reports` | mongo 同步 | `raw_files` 元数据 + S3 URL | `bun cli fetch-reports [date\|--all]` | 每天定时 / "拉今天研报" | 上游 markdown_url 缺失 → skip 单条；mongo cursor 中断 → 整体重跑幂等 |
| `ae-research-ingest` | raw → 结构化 wiki | `pages` + `content_chunks` + `raw_data` + `facts` + `links` + `timeline_entries` | `$ae-research-ingest [N]` 或 `ingest:peek/commit/brief/pass/write/finalize` | fetch 后 / "ingest 一下" | V2 缺失 → 直接 pass；narrative 写错 → `ingest:skip`；finalize stage 崩 → 续跑 / `--from N` |
| `ae-enrich` | **个体页面**内容（红链补全） | narrative + 元数据（ticker / sector / aliases） | `enrich:next` 手动 / stage 4 自动入队 minion | 红链多了 / "补全 X" | source 信息不足 → 保 `low` 等下次 source；enrich 后才发现错 → 重跑覆盖 |
| `ae-thesis-track` | **跨页面**的投资判断（状态机） | `theses.catalysts` / `validation_conditions` / `conviction` JSONB | `thesis:open/write/update/show/list/close` | PM 表态 / "看下论点" / 周期 review | conditions 反例 → mark unmet；关键 invalidated → `close --reason invalidated` / `stop_loss` |

### Consumer：从 wiki 派生产物

| skill | 关心 | 输出 | 何时用 | 输出位置 |
|---|---|---|---|---|
| `ae-daily-review` | epistemic 复盘（7 个标准问题） | 当日 ingest 增量的认知变化 / 反共识数据 / 红队挑战 | 当日 ingest 完成后 | `wiki/output/daily-review-{date}.md` |
| `ae-daily-summarize` | PM operational 简报（IC briefing 风格） | 9 章节：执行摘要 / 市场快照 / 组合影响 / 新建仓 / 减仓对冲 / 风险预警 / 催化剂日历 / 研究任务 / 路演要点 | review 之后 | `wiki/output/daily-summarize-{date}.md` |
| `ae-analyze-ideabot` | 单个 IdeaBot idea 综合分析 | 拉 IdeaBot 仓位 / score / events，跟 wiki 已有公司 / 论点交叉分析 | 用户问某 idea | `wiki/output/ideabot-{name}-{date}.md` |
| `ae-analyze-timebot` | 团队工时回顾 | 拉一周工时数据 + 给每个分析师生成研究建议 | 周工时复盘 | `wiki/output/timebot-{weekOf}.md` |

### 最易混淆：enrich vs thesis-track

详见 §10 末尾。一句话：**enrich 让 wiki 长出来（编辑器），thesis-track 让 wiki 帮你做决策（仪表盘）**。

### 一图看清调用链

```
Producer 链 (写)
   fetch-reports → research-ingest → enrich (自动) ↘
                                                    pages / facts / links / theses / signals ...
                                  ↓                ↗                                          ↑
                              thesis-track (按需) ┘                                          │
                                                                                              │
Consumer 链 (读 + 生成)                                                                       │
   daily-review                                                                              │
   daily-summarize                                                                           │
   analyze-ideabot          →  output/*.md  ←  全靠从这里读 ────────────────────────────────┘
   analyze-timebot
```

---

## 18. 心智模型 TL;DR

如果你只能记 6 件事：

1. **万物皆 page** — 一种数据形态对齐 search / 反链 / 审计
2. **三选一 triage** — `commit (深度)` / `brief (轻量)` / `pass (噪声)`
3. **content_chunks 给搜索，raw_data 给精确取数** — 两条管道都从 V2 派生
4. **Wikilink 自动长出红链 entity** — `confidence='low'` → 后台 enrich 升级
5. **facts 是时间旅行** — 旧值 `valid_to=today`，新值 `valid_to=NULL`
6. **enrich 让 wiki 长出来，thesis-track 让 wiki 帮你做决策** — 一个填内容，一个跑状态机

---

## 19. 进一步阅读

- [architecture.md](./architecture.md) — schema DDL + 设计原则 + 迁移历史（v1 → v2）
- [cli-commands.md](./cli-commands.md) — 全 CLI 命令清单与 flag 详解
- [llm-touchpoints.md](./llm-touchpoints.md) — 哪些点真正调 LLM
- [gbrain-borrowings.md](./gbrain-borrowings.md) — 从 gbrain 项目借鉴了什么
- [table-artifacts.md](./table-artifacts.md) — sidecar 表格管道详解
- `../skills/ae-research-ingest/SKILL.md` — agent 的 ingest 工作流（被 Claude Code 加载执行）
- `../infra/init-v2.sql` — schema 真相源（一次性建库）
- `../CLAUDE.md` — 给 Claude Code 看的项目说明（schema 摘要 + 工程约定）
