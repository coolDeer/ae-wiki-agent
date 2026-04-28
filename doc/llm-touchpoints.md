# LLM 介入点地图

> 描述 ae-wiki-agent 当前架构中，哪些步骤调用 LLM / embedding，哪些是纯逻辑。
> 配套阅读：[gbrain-borrowings.md](./gbrain-borrowings.md)（gbrain 同类型设计参考）

## 核心设计原则

**core 不调 LLM**（gbrain "thin harness, fat skill" 模式）。`ae-wiki-agent` 的 ingest 主路径全是确定性 SQL / 正则 / YAML 解析。"理解原文 → 写 narrative" 是 agent 层（`skills/ae-research-ingest/SKILL.md`）的职责。

**为什么这样设计**：
- prompt 在 skill 里随时可改，不用动代码 / 重部署
- agent 写时可以主动查 wiki 已有页交叉引用，比单次 API 调用质量高
- 失败时 agent 看得见、可以重试 / 问用户 / 跳过
- 所有结构化数据（facts / links / timeline / signals）由 Stage 4-8 从 narrative 里冷抽取（正则 / YAML / SQL）

**应用准则**：新增 stage / worker 优先确定性方案；必须用 LLM 时套 fail-improve 模式（先正则，失败才 LLM，结果写 JSONL 用于反向补正则）。

---

## 1. 写入侧（ingest pipeline）

### Core 内：0 处 LLM 推理

整条 ingest pipeline（Stage 1-8）+ minion-worker 都不调 LLM。各 stage 职责：

| Stage | 行为 | 调外部模型？ |
|---|---|---|
| 1 骨架 | INSERT pages 行 | ❌ |
| 2 chunk | 段级切分（按 `\n\n+`）| ❌ |
| 3 落 narrative | 写 page.content + 快照 page_versions（**不写 prompt，agent 提供**）| ❌ |
| 4 链接 | 正则解析 wikilink / md link | ❌ |
| 5 facts | Tier A 直读 YAML 块 | ❌（Tier C 设计中，未实现）|
| 6 jobs | 把任务塞 minion_jobs 队列 | ❌ |
| 7 timeline | 直读 YAML 块 | ❌ |
| 8 thesis | active thesis 关联 SQL JOIN | ❌ |

### Agent 层（`skills/ae-research-ingest/SKILL.md`）：1 处推理

唯一"理解原文 → 生成结构化 markdown"的 LLM 步骤由 agent 在 Step 1（`ingest:next`）和 Step 2（`ingest:write`）之间完成：阅读 raw markdown → 按 schema 写 narrative + 末尾 `<!-- facts -->` / `<!-- timeline -->` YAML 块。

模型由 agent 当时的运行时决定。当前 durable runtime 默认走 `OPENAI_AGENT_MODEL`，core 不再固定 ingest 模型。

### Core 内：设计了未实现的 LLM 兜底

| 模块 | 模型（env） | 用途 |
|---|---|---|
| **Stage 5 Tier C** | `gpt-5-mini`（`OPENAI_FACT_EXTRACT_MODEL`） | Tier A 抓不到时 LLM 兜底抽 fact（套 fail-improve 模式，先正则） |
| **worker `enrich_entity`** | TBD | 红链 entity 补全市值 / 关键人 / 产品线 |

这两个加起来仍然只是"core 内 ≤2 处 LLM 调用"，且都是 fallback 性质——主路径仍然走 agent。

### Embedding（不是 LLM 推理）

**Stage 6 → worker `embed_chunks`**：OpenAI `text-embedding-3-large`（3072 dim → 截断到 1536，与 schema vector(1536) 对齐）。每个 chunk 一次。

### 纯逻辑（不调外部模型）

- Stage 1 骨架 SQL
- Stage 2 段级 chunk（按 `\n\n+` 切，未来 port gbrain recursive chunker）
- Stage 4 wikilink / markdown link 正则抽取
- Stage 5 **Tier A**（直读 Stage 3 写入的 YAML 块，YAML.parse）
- Stage 7 timeline（YAML 块解析）
- Stage 8 thesis 关联（`links` × `theses` SQL JOIN）
- worker `detect_signals`（同 entity+metric+period 数值比对，priorAvg + delta% 阈值）

---

## 2. 查询侧

| 路径 | 模型 | 逻辑 |
|---|---|---|
| **Hybrid search** (`ae-wiki-agent/src/core/search/hybrid.ts`) | OpenAI embedding（query 向量化） | `tsvector` keyword + `pgvector` semantic → RRF 融合，**不调 LLM 推理** |
| **MCP tools** (`src/mcp/server.ts`) | 上层 agent（Claude Code / API agent） | server 只是 SQL 包装；推理在 agent 那一层 |

---

## 3. Skills 层（agent 当 LLM）

`skills/` 下的 daily-review / daily-summarize / analyze-ideabot / analyze-timebot 是 **Claude Code 当 agent** 的入口：读 wiki + facts + signals → 输出复盘 / 简报。

这一层 LLM 介入最多，但都是消费 wiki，不写回结构化表（除了产出 `wiki/output/*.md`）。

---

## 4. 与 gbrain 的对比

| 层级 | ae-wiki-agent | gbrain |
|---|---|---|
| ingest 主路径（理解原文）| 不在 core 里——agent 在 `research-ingest` skill 里读 raw + 写 narrative | 不在 core 里——agent skill（media-ingest / meeting-ingestion 等）|
| Chunking | 段级（确定性）| 三档可选，最贵的一档调 Haiku 找语义边界 |
| 查询扩写 | 没有 | Haiku 生成多 query → RRF 融合 |
| 音频 | 没有 | 内置 Whisper |
| 后台任务 | minion-worker 跑 embed / detect_signals（无 LLM）| minion-worker 还跑 subagent job——一个完整的 LLM tool-loop，可被任意 skill 调起 |
| 质量门 | 没有 | cross-modal-review 用第二个模型反检 |
| 失败回退 | 没有 | fail-improve 框架 + JSONL 学习曲线 |

**核心架构对齐**（v2.1.0 后）：
- 两边都是 "Thin Harness, Fat Skills"
- LLM 几乎全在 agent 编排层（skills），core binary 只做工具/基础设施
- 区别：gbrain skill 数量 29 个、覆盖更广；ae-wiki-agent skills 还在补建（research-ingest 已就位，enrich / thesis-track 等待写）
