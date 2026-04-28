---
name: ae-daily-review
description: 资深投资者视角的每日复盘。基于当日 ingest 完成的 source / brief / 实体页（从 Postgres 经 MCP 查询），针对 7 个标准问题逐一回答，输出 wiki/output/daily-review-{date}.md。问题覆盖：认知变化 / 反共识数据 / 跨板块串联 / 多头机会 / 空头机会 / 知识缺口 / 自我红队。问题集由 schema 固定，避免临场设计盲区。
metadata:
  short-description: 生成 7 问结构化每日复盘
---

# ae-daily-review

资深投资者视角的每日复盘 skill。在 `$ae-fetch-reports` + `$ae-research-ingest` 完成后调用，对当天 ingest 进 Postgres 的内容做结构化提问，输出到 `wiki/output/daily-review-{date}.md`。**最终报告统一用英文。**

## 触发方式

- `$ae-daily-review 2026-04-14` — 复盘指定日期
- `$ae-daily-review` — 复盘当天（Asia/Shanghai）
- 自然语言：「基于今天 ingest 的内容做 daily review」

## 用途

- **日常复盘**：每日 ingest 后立即跑，5-10 分钟拿到结构化复盘
- **强制覆盖维度**：把 LLM 当作"7 个角度的研究助理"，避免每天临场设计问题导致的盲区
- **防自我强化**：Q7 强制做红队，避免 wiki 越用越偏（confirmation bias）
- **驱动下轮 ingest**：Q6 的"知识缺口"成为下一天的 ingest 优先级

## 数据来源（重要：本项目无 wiki/ 目录）

数据全部在 Postgres，**通过 MCP 工具查询**，不是 Glob 文件系统：

| 需要 | 用什么 |
|---|---|
| 当日新 ingest 的 source / brief 页 | `recent_activity({days:1, kinds:['page']})` 然后筛 slug 前缀 `sources/` / `briefs/` |
| 某 source 的完整 narrative | `get_page(slug)` 或 `get_page(pageId)` |
| 最近 7 天 mental map（事件 / 信号 / 新页）| `recent_activity({days:7})` 默认含 event + signal + page |
| 跨板块查相关公司 / 行业 | `search(query, {type, dateFrom, limit})` |
| 某公司的最新结构化数据点 | `query_facts({entity, metric?, currentOnly:true})` |
| 多标的 / 多期间数表横向比较 | `compare_table_facts({metric, entities?, periods?, sourceIdentifier?, currentOnly:true})` |
| 某 source 解析出的原始表格 sidecar | `get_table_artifact({identifier, table_id?})` |
| Active thesis 列表（给 Q5 用）| `bun src/cli.ts thesis:list --status active`（Bash 调）|
| Active thesis 的诊断 | `bun src/cli.ts thesis:show <pageId>` |

> **若 MCP 未连**：检查 `~/.mcp.json` 是否注册了 `ae-wiki` server（指向 `bun src/mcp/server.ts`）。`enabledMcpjsonServers` 在 `.claude/settings.local.json` 已配，但缺 `.mcp.json` 文件就用不了。

## 7 个标准问题（顺序固定，不可省略 / 增删 / 改写）

### Q1: 今天最大的认知变化是什么？

- **vs wiki 既有观点**：每条断言对照 wiki 老观点，标 ⚠️ 矛盾 / ✓ 印证 / ✦ 净新
- **每条引用具体 source**：`（来源：[[sources/<slug>]]）`
- **不超过 5 条**，按重要性排序
- 每条结构：`【1 句话核心判断】+【数据/证据】+【vs wiki 状态】+【投资含义】`

### Q2: 哪个数据点最反共识？Expectation gap 在哪？

- 至少 3 个 expectation gap，按 surprise 强度排序
- 每条：`【市场共识】vs【新数据点】=【gap 大小 + 方向（利好/利空/中性意外）】`
- 优先**定量** gap（数字 vs 数字），其次**定性** gap（行业行为 vs 共识叙事）
- 若 gap 来自同一张 period matrix table，或多个公司共享同一指标，优先调用 `compare_table_facts`，不要只复述 narrative prose

### Q3: 跨板块串联

- 找出今日 N 份 source 之间的**交叉印证或矛盾**
- 映射到现有 `[[concepts/...]]` / `[[industries/...]]` 中的 cross-cutting theme
- 每条标"强化 / 削弱 / 净新" theme，至少 3 条，每条引 ≥2 份 source
- 没有 cross-source pattern 时如实写"低密度日，无显著串联"

### Q4: 如果今天必须新建 1 个仓位，最高确信度方向？

**必须给出**（缺一不可）：
- 具体标的 `[[companies/...]]`（多标的也可）
- 方向（long / pair trade / spread）
- 催化剂（具体事件 + 预期时间）
- 时间窗口（短 1-3M / 中 6-12M / 长 1-3Y）
- 主要风险 ≥2 条
- 假想止损位 / invalidation condition
- 引用 source 支撑

不许"看好 AI 板块"这种空话，必须具体到 ticker + 具体逻辑。

### Q5: 如果今天必须减仓 / 翻空 1 个仓位，最该动什么？

- 同 Q4 的具体度要求
- 优先**动现有 active thesis**（先 `bun src/cli.ts thesis:list --status active` 拉清单）
- active thesis 为空时，可选今天 source 中**最被高估**的方向
- 必须明确"今天的什么数据让我想动这个仓位"

### Q6: 最大的知识缺口 + 应主动获取的信息

- 列 3-5 个知识缺口，按重要性排序
- 每条：`【缺口】+【为什么重要】+【建议获取方式】`（哪份财报 / 哪类专家访谈 / 哪个数据库）
- 同时列今天哪些 source **质量不足或单一信源**，需二手验证
- 这一条直接成为下一天 ingest 优先级

### Q7: 自我红队（meta + bias check）

至少 2 条具体 red-team 反问，并完成下方两条**硬指标**：

#### 硬指标 1：sell-side 占比
- 计算今日 source 中 sell-side（`meeting_minutes` / `arete` / `bernstein_research` / `aletheia` 等）的占比
- 占比 ≥ 50% 必须显式标注 `⚠️ sell-side 占比 X%，结论可能 inherently positive`
- 同时检查是否过度集中在某券商 / 分析师覆盖范围

#### 硬指标 2：output 页 7 天冷却期
- 引用 `outputs/...` 或同类聚合页时，先 `get_page` 看 `update_time`
- 距今 < 7 天的页面 **不得作为 anchor / ground truth**，只能作为"今天 query 的副产品"提及
- 防止 daily-review 反复引用自己刚生成的页面形成循环论证

其它 red-team 维度：
- confirmation bias：是否过度引用印证既有观点的 source？
- "我希望它真"判断：哪些结论是"愿意相信"而非"证据充分"，特别是依赖单一信源的强判断？
- wiki 自我强化：某些"老观点"超 30 天没被新数据挑战，但仍默认引用？

## 执行步骤

1. **解析日期** — `$ARGUMENTS` 为空 → 当天（Asia/Shanghai）；有值 → 直接用

2. **拉今日 ingest 的 source / brief 列表**
   ```
   recent_activity({days: 1, kinds: ['page']})
   ```
   筛 slug 前缀 `sources/` 或 `briefs/`。如返回为空 → 告诉用户"今日无 ingest 内容，建议先跑 `$ae-fetch-reports` + `$ae-research-ingest`"，**不出报告**。

3. **建立 mental map**（最近 7 天上下文）
   ```
   recent_activity({days: 7, limit: 30})
   ```
   重点看：新 thesis（slug 前缀 `theses/`）、近 7 天 signals、跨日重复出现的 entity。

4. **逐一 `get_page` 当日 source / brief**
   提取：`## 关键要点` / `## 结构性观察` / `## 与现有知识的关系`（这三段是 ingest 时强制要求的）。
   brief 页只读 `## 关键观察` + `## 投资视角`。

5. **识别高价值数表并做 comparison pass**
   对每个当日 source，遇到以下任一情况，必须优先走表格 comparison，而不是只看 prose：
   - 同一 source 里有 `Metric | FY2026E | FY2027E | ...` 这类 period matrix
   - 同一指标在多个公司之间可横向比较（如 revenue、gross margin、capex、target price）
   - narrative 提到“领先 / 落后 / highest / lowest / revision / spread”，但没有把相对位置讲清楚
   - `query_facts` 命中了 table provenance，但 facts 条数明显少于 source 中表格信息量

   推荐动作：
   - 先用 `compare_table_facts({metric, entities?, periods?, sourceIdentifier?, currentOnly:true})` 拿横向矩阵
   - 需要核原表时，再用 `get_table_artifact({identifier})`

6. **可选：跨引用历史 source / entity**
   - 当日 source 在"## 与现有知识的关系"提到某历史 source / entity → `get_page(slug)`
   - 需要某行业最新动态 → `search("行业名 关键趋势", {type:'industry', limit:5})`
   - 某公司的最新财务事实 → `query_facts({entity:'companies/X', currentOnly:true, limit:20})`

7. **拉 active thesis 给 Q5 用**
   ```bash
   bun src/cli.ts thesis:list --status active
   ```
   重点候选：今日 source 触及到的 target。

8. **逐一作答 Q1–Q7**
   严格按上方"7 个标准问题"格式，每条断言带 source 引用。Q4/Q5 不许空话。Q7 两条硬指标必做。
   若某结论来自表格 comparison，正文里要明确写出比较维度（entity / metric / period），而不是只说“表格显示”。

9. **写文件**
   ```bash
   mkdir -p wiki/output
   # 写到 wiki/output/daily-review-{YYYY-MM-DD}.md
   ```

10. **总结报告给用户**
   - 文件路径
   - 7 问的一行摘要
   - 是否触发了重大叙事修正（Q1 ≥3 条 ⚠️ 矛盾 → 提示考虑做 comparison 页归档）

## 输出格式

```yaml
---
type: output
subtype: daily-review
title: "Daily Research Review - YYYY-MM-DD"
date: "YYYY-MM-DD"
sources: [当日所有 source / brief 的 slug]
sell_side_ratio: 0.42         # Q7 硬指标 1 的计算结果
tags: [daily-review, qa]
last_updated: "YYYY-MM-DD"
---

# Daily Research Review - YYYY-MM-DD

> Answering seven standard questions based on N source pages today
> (M newly ingested, K historical cross-references).
> The question set is fixed by `skills/ae-daily-review/SKILL.md`.

## Q1: Biggest Change In Understanding Today
[Content]

## Q2: Most Contrarian Data Point / Expectation Gap
[Content]

## Q3: Cross-Sector Connections
[Content]

## Q4: Highest-Conviction Long
[Content]

## Q5: Highest-Conviction Short / Reduce
[Content]

## Q6: Knowledge Gaps And Next Ingest Priorities
[Content]

## Q7: Red Team / Bias Check
[Hard Check 1] Sell-side ratio: X%（≥50% 时显式 ⚠️）
[Hard Check 2] Output-page 7-day cooling rule: pass / violation list
[At least two additional red-team questions]

## Sources
[Full source list in slug form]
```

## 重要约束

- **问题集是固定的**：不要根据当天素材自改 / 加 / 删问题——这是 skill 核心价值
- **每条断言必须可追溯**：`（来源：[[sources/<slug>]]）` 或 `（来源：[[briefs/<slug>]]）`
- **Q4 / Q5 必须给具体标的和具体逻辑**——不能用"看好 AI"这种空话糊弄
- **Q7 必须真做 red team**：sell-side 占比 + 7 天冷却期是硬约束，不是装样子
- **涉及多标的 / 多期间的关键数表时，必须优先用 `compare_table_facts`**——不要仅凭 narrative prose 做相对强弱判断
- **若 `compare_table_facts` 与 prose 摘要不一致，以表格 provenance 为准**，并在正文里指出 source narrative 可能压缩了信息
- **当天 ingest = 0 → 不出报告**：先建议用户跑 fetch + ingest
- **当天 ingest < 5 份**：可以正常做，但 Q3 跨板块串联可能写"低密度日，无显著串联"
- **不修改任何已有 page**：daily-review 是只读综合，输出只到 `wiki/output/`

## 下一步建议

跑完 daily-review 后，建议链式触发 `$ae-daily-summarize`，把 epistemic 复盘转成 PM operational 简报。

## 相关文件

- `src/mcp/server.ts` / `src/mcp/queries.ts` — MCP 工具实现
- `src/cli.ts` (case `thesis:list` / `thesis:show`) — active thesis CLI
- `skills/ae-daily-summarize/SKILL.md` — 下游 PM 简报 skill
- `CLAUDE.md` §"4 个用户入口" / §"MCP Tools" — 整体架构
