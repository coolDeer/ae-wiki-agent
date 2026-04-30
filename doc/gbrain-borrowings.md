# gbrain 借鉴清单（活文档）

> **决策（2026-04-26）**：走路径 C — 继续 ae-wiki-agent，选择性借鉴 gbrain 的具体实现。
> 决策依据见 [gbrain-vs-self-build.md](./gbrain-vs-self-build.md)。
>
> 本文档是**长期工作参考**：列出每项要借鉴的能力、源文件位置、优先级、状态。
> 完成一项就把 ⬜ 改 ✅，并记录实际改了什么。

---

## 借鉴原则

1. **借实现，不借抽象** — gbrain 的具体算法 / 正则 / SQL 片段直接抄；它的整体架构（PageType enum、RESOLVER skill 框架）不抄
2. **保持我们的 schema 哲学** — facts-first 不变，gbrain 的 narrative-first 不接受
3. **借完即记** — 每次抄完更新本文档 + 在代码注释里标 `// borrowed from gbrain: <path>`
4. **MIT 协议** — gbrain 是 MIT，可自由商用，但保留出处注明

---

## 优先级 P0：影响数据完整性，必做

### ⬜ 1. recursive chunker（lossless invariant）

**当前状态**：`ae-wiki-agent/src/skills/ingest/stage-2-chunk.ts` 用最简单的 `\n\n+` 切分，丢失语义边界。

**gbrain 实现**：`demo/gbrain/src/core/chunkers/recursive.ts`（~205 LOC）

**核心算法**：
- 5 层分隔符递归（段落 → 行 → 句子 → 子句 → 词）
- 300-word target chunk + 50-word 句级 overlap
- **声明 lossless invariant**：非重叠部分能拼回原文

**借鉴动作**：
- 文件：直接拷贝到 `ae-wiki-agent/src/core/chunkers/recursive.ts`
- 接口：保持 `chunkText(text, opts) → TextChunk[]`
- stage-2 改为先调 `chunkText` 再写 content_chunks
- 跨 type 不切（mineru content_list.json 的 table/chart 作为整体 chunk）

**价值**：搜索召回率 ↑、表格不被切碎、可证明无损

---

### ⬜ 2. 解析 mineru content_list.json

**当前状态**：raw 文件落盘但只读 `.md`，`_content_list.json` 完全没下载、没解析。

**gbrain 实现**：N/A（gbrain 不处理 mineru，需要我们自己写）

**借鉴动作**（混合借鉴 + 自研）：
- fetch-reports 时顺便下载 `parsedContentListS3` 到 `raw/{date}/{type}/{file}_content_list.json`
- 借鉴 gbrain 的 chunker 接口设计（`ChunkInput { text, type, page_idx, bbox }`）
- 在 stage-2 优先用 content_list.json 的 type 边界，fallback 到 recursive chunker

**价值**：保留 mineru 的 `text/list/table/chart` 语义；离线可重做

---

### ⬜ 3. Citation 强制 `[Source:...]`

**当前状态**：CLAUDE.md 软约定 `（来源：[[source/X]]）`，agent 自觉，常漏。

**gbrain 实现**：`demo/gbrain/skills/ingest/SKILL.md` 第 41 行起 — `Citation Requirements (MANDATORY)`

**gbrain 规范**：
```
- User's statements:    [Source: User, {context}, YYYY-MM-DD]
- Meeting data:         [Source: Meeting "{title}", YYYY-MM-DD]
- Email/message:        [Source: email from {name} re: {subject}, YYYY-MM-DD]
- Web content:          [Source: {publication}, {URL}, YYYY-MM-DD]
- Social media:         [Source: X/@handle, YYYY-MM-DD](URL)
- Synthesis:            [Source: compiled from {sources}]
```

**借鉴动作**：
- 改写 stage-3 prompt（`stage-3-narrative.ts:buildPrompt`），加入 MANDATORY citation 章节
- 把"软约定"升级为 prompt 硬约束 + post-validation 检查（每个段落是否含 `[Source:` 或 `（来源：`）
- 检查失败 → 写 `signals(signal_type='narrative_missing_citation')`

**价值**：每条事实可审计、防 LLM 编造、provenance 完整

---

### ⬜ 4. Iron Law 反链一致性检查

**当前状态**：Stage 4 抽 wikilink 写正向 link ✓，但**没有"反链是否完整"的校验**。entity 页 narrative 不会自动列"被谁提到"。

**gbrain 实现**：`demo/gbrain/skills/ingest/SKILL.md` 第 39 行 — `Iron Law` + `_brain-filing-rules.md`

**gbrain 规范**：
> Every mention of a person or company with a brain page MUST create a back-link FROM that entity's page TO the page mentioning them. An unlinked mention is a broken brain.

**借鉴动作**：
- 借规范，不借实现（我们 schema 已支持反查 `links.to_page_id`）
- 加 `enrich-entity` skill：定期扫每个 entity，把 `SELECT * FROM links WHERE to_page_id = X` 的结果**渲染到 entity.content 的 "## 被以下 source 提及" 章节**
- 加 maintain skill 检查：每个 entity 的 inbound link 数量 vs narrative 里"被提及"列表的一致性

**价值**：防止 unlinked mention（gbrain 称之为 "broken brain"）；entity 页自动有内容

---

## 优先级 P1：质量提升，强烈建议

### ⬜ 5. semantic chunker（topic boundary 检测）

**gbrain 实现**：`demo/gbrain/src/core/chunkers/semantic.ts`

**算法**：
1. 句子分割
2. 每句 embed
3. 计算相邻句 cosine 相似度
4. Savitzky-Golay 滤波（5-window，3 阶多项式）
5. 找局部极小（topic 边界）
6. 按边界分组，超长组递归 split

**借鉴动作**：
- 同样直接拷贝实现
- 作为 chunker 的可选模式，需要 embedding 函数
- 默认仍用 recursive，长文档（> 5000 字）切到 semantic

**价值**：长 source（broker 模型 / 完整年报）chunk 边界更智能

---

### ⬜ 6. 4 层 search dedup

**当前状态**：`hybrid.ts` 用基本 RRF，没 dedup 后处理。

**gbrain 实现**：`demo/gbrain/src/core/search/dedup.ts`（如有）+ hybrid.ts 的后处理

**gbrain 的 4 层（推断，需读代码确认）**：
- cosineThreshold：相邻 chunk 太相似的去重
- maxTypeRatio：同 type 占比上限（防全是 source 类型刷屏）
- maxPerPage：单 page 取 top-N chunk
- 综合排序 + cutoff

**借鉴动作**：
- 阅读 `demo/gbrain/src/core/search/hybrid.ts` 完整实现 + dedup 模块
- 移植到 `ae-wiki-agent/src/core/search/`
- 加进 hybridSearch 的 pipeline

**价值**：搜索结果质量明显提升，特别是数据规模上来后

---

### ⬜ 7. multi-query expansion

**gbrain 实现**：search 时对 query 做扩展（同义词 / 改写 / 多种角度）→ 多次检索 → RRF 合并

**借鉴动作**：
- 找 gbrain `src/core/search/expansion.ts`
- 移植 query expansion 逻辑（一般是 LLM 调用生成 N 个改写）
- search MCP tool 加 `expand` 参数

**价值**：fuzzy 查询召回率 ↑（"光模块下行" 自动扩展为 "光模块价格战 / 1.6T 价格 / 800G 跌价"）

---

### ⬜ 8. compiled_truth ↔ timeline 强制分离

**当前状态**：`pages.content` 和 `pages.timeline` 是两个字段，但 ingest 都写到 `content`，`timeline` 字段为空。

**gbrain 实现**：`demo/gbrain/src/core/markdown.ts:splitBody` 用 `<!-- timeline -->` sentinel 强制分隔

**gbrain 哲学**：
- `compiled_truth`：综合，可被 agent 重写覆盖
- `timeline`：append-only event ledger，永不重写
- 双字段独立，timeline 不会因 narrative 重写而丢

**借鉴动作**：
- 改 stage-3 prompt：narrative 末尾加 `<!-- timeline -->` 后跟时间序列事件（earnings beat / rating change / 论点开仓）
- splitBody 解析后：compiled_truth → page.content，timeline → page.timeline
- stage-7（timeline 提取）从 timeline 字段派生 `timeline_entries` 行

**价值**：narrative 重写时不丢事件、event ledger 自动派生

---

## 优先级 P2：长期价值，按需借鉴

### ⬜ 9. Notability gate（防止脏 entity 入库）

**当前状态**：Stage 4 任何 wikilink 都建 page（confidence='low'）。9 entity 里有 1-2 个是脏的（如 "Texas Instruments" 因为一句感谢就建了）。

**gbrain 实现**：`demo/gbrain/skills/_brain-filing-rules.md`

**gbrain 规则**（个人 brain 视角，需调整为投资视角）：
- 提及次数 ≥ 2
- 关联到核心论点 / 数据点
- 不是顺嘴提一句

**借鉴动作**：
- 阅读 `_brain-filing-rules.md` 完整规则
- 改造为投资版 `skills/_research-filing-rules.md`：
  - 任何 ticker / 已知 broker 名 / 行业名 → 必建
  - 公司名仅出现 1 次 + 不在 facts block 里 → 候选池，不建
- Stage 4 引入 gate，候选池写入 `signals(signal_type='entity_candidate', severity='info')` 让人审

**价值**：长期 entity 库干净度，防止"破窗效应"

---

### ⬜ 10. data-research skill（结构化数据抽取）

**gbrain 实现**：`demo/gbrain/src/core/data-research.ts` + `skills/data-research/`

**功能**：
- 处理 CSV / 表格 / API JSON 等结构化输入
- 字段抽取（MRR / ARR 正则）
- 去重 / tracker 解析

**借鉴动作**：
- 读 `data-research.ts` 完整实现
- 移植正则到 ae-wiki-agent 的 stage-5 Tier B
- 特别参考"MRR/ARR regex"、"HTML stripping"、"dedup"等细节

**价值**：fact 抽取 Tier B 直接复用成熟正则；表格类 source 处理质量提升

---

### ⬜ 11. fail-improve 循环

**gbrain 实现**：`demo/gbrain/src/core/fail-improve.ts`

**功能**：
- "Deterministic-first, LLM-fallback 循环"
- JSONL 失败日志
- 自动测试生成

**借鉴动作**：
- Stage 5 fact 抽取出错时记 JSONL 失败 case → 持续优化 Tier B 正则
- 应用到所有 LLM 调用路径（Stage 3 / Tier C）

**价值**：系统自我演进、错误模式可追溯

---

### ⬜ 12. backoff 自适应限流

**gbrain 实现**：`demo/gbrain/src/core/backoff.ts`

**功能**：
- CPU / 内存监控
- exponential backoff
- "active hours multiplier"（高峰期更保守）

**借鉴动作**：
- 移植到 ae-wiki-agent 的 minion-worker
- 给 OpenAI / Anthropic API 调用加 backoff
- 特别是 embed_chunks 任务大批量跑时防 rate limit

**价值**：生产稳定性、API 限流自适应

---

### ⬜ 13. maintain skill（健康检查）

**gbrain 实现**：`demo/gbrain/skills/maintain/`

**功能**（gbrain 文档）：
- stale info detection
- orphan pages
- broken citations
- benchmarks

**借鉴动作**：
- 我们 maintain skill 的清单（在 architecture.md §6.2）：stale page / broken link / fact 一致性 / 重复实体合并候选
- 借 gbrain 的具体 SQL 查询
- 加投资特化检查：
  - active thesis 超过 30 天没新 fact 入库 → warning
  - 同 entity / metric / period 多 source 且 value 差 > 15% → consensus_drift signal

**价值**：长期数据质量、自动发现治理债

---

### ⬜ 14. briefing skill（每日复盘）

**gbrain 实现**：`demo/gbrain/skills/briefing/`

**功能**：每日从 brain context 编译简报

**借鉴动作**：
- 我们已有 daily-review / daily-summarize 在主 wiki，可作为参考
- 借 gbrain briefing 的 query 编排逻辑
- 输出仍走我们的 `pages (type='output')` 表

**价值**：现成 prompt 工程；日常使用闭环

---

## 优先级 P3：工程基建，跑稳了再做

### ⬜ 15. 单文件 binary 编译

**gbrain 命令**：
```bash
bun build --compile --target=bun-linux-x64 --outfile bin/gbrain-linux-x64 src/cli.ts
bun build --compile --target=bun-darwin-arm64 --outfile bin/gbrain-darwin-arm64 src/cli.ts
```

**借鉴动作**：
- 在 `package.json` scripts 加 `build:linux` / `build:darwin-arm` / `build:all`
- CI 自动构建 release artifact

**价值**：部署到 Linux server 不需装 Bun runtime

---

### ⬜ 16. 测试基础设施

**gbrain 实现**：`demo/gbrain/test/` + e2e 测试 + `bun test` + `formula_check.py` 风格的检查脚本

**借鉴动作**：
- 借测试组织方式（per-skill test fixture）
- e2e：spin up 测试 Postgres → ingest fixture → 验证表
- 加 schema regression 测试（每次 init-v2.sql 改动跑一次）

**价值**：重构无心理负担、回归保护

---

### ⬜ 17. CHANGELOG.md / VERSION 维护

**gbrain 实现**：`CHANGELOG.md` + `VERSION` 单文件

**借鉴动作**：
- 加 `ae-wiki-agent/CHANGELOG.md`
- 重大 schema 改动 / breaking 变更必记
- VERSION 跟 schema_version（config 表）联动

**价值**：发布管理、回滚参考

---

## 不借鉴的部分（明确 out-of-scope）

避免被 gbrain 抽象带偏：

| gbrain 的东西 | 不借的理由 |
|---|---|
| **Skill RESOLVER 框架** | 对单一 wiki 用例过重，我们直接 CLI 子命令足够 |
| **PageType enum** | 我们的 type 列表（含 thesis / output）和 gbrain 不同 |
| **整套 entity dirs** (`people/companies/meetings/concepts/deal/civic/project/source/media/yc`) | 我们只用 `companies/industries/concepts/sources/briefs/theses/outputs` |
| **`compiled_truth` 字段名** | 我们用 `content`，更通用 |
| **PGLite 引擎双轨** | 我们只跑 Postgres，简化引擎层 |
| **整个 `src/core/operations.ts` 的 41 个 contract op** | 过度抽象，我们的 5 个 MCP tool 够用 |
| **OpenClaw plugin 集成** | 我们不打算成为 OpenClaw plugin |
| **Skillify / Skillpack 元编程** | 不需要 skill marketplace |
| **Sales efficiency / Ramped sales 等业务 skill** | 跟我们投资场景无关 |

---

## 借鉴节奏

不一次性全做，按"出现痛点时再借"原则：

| 阶段 | 触发条件 | 该做的借鉴 |
|---|---|---|
| **现在（Phase 1.5）** | 已发现完整性问题 | P0 全部 4 项（chunker / mineru content_list / citation / iron law） |
| **第一次跑批（10+ source）** | 看到 search 召回率低 | P1 #5-7（semantic chunker / dedup / expansion） |
| **第一次有 active thesis** | 需要事件流时 | P1 #8（compiled_truth ↔ timeline） |
| **第一次发现脏 entity** | 自动建出 garbage | P2 #9（notability gate） |
| **第一次 LLM 抽错 fact** | 发现 Tier C 不可靠 | P2 #11（fail-improve） |
| **正式部署到 server** | — | P3 #15（binary 编译） |

---

## 实施 checklist 模板（每条借鉴用）

```
项：<编号> <名称>
状态：⬜ 计划 / 🚧 进行中 / ✅ 完成
负责人：
开始日期：
完成日期：
gbrain 源文件：
我们目标文件：
变更摘要：
- ...
测试 / 验证方式：
回滚方案：
后续改动空间：
```

---

## 参考索引

- gbrain 仓库本地副本：`demo/gbrain/`
- gbrain README：`demo/gbrain/README.md`
- gbrain CLAUDE.md：`demo/gbrain/CLAUDE.md`
- gbrain ingest skill：`demo/gbrain/skills/ingest/SKILL.md`
- gbrain 推荐 schema 文档：`demo/gbrain/docs/GBRAIN_RECOMMENDED_SCHEMA.md`
- 我们的架构：`doc/architecture.md`
- 路径决策：`doc/gbrain-vs-self-build.md`
