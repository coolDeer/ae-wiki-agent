---
name: daily-review
description: 资深投资者视角的每日复盘。基于当日 ingest 完成的 wiki 内容（source + entity 页面），针对 7 个标准化问题逐一回答，输出 wiki/output/daily-review-{date}.md。问题覆盖：认知变化 / 反共识数据 / 跨板块串联 / 多头机会 / 空头机会 / 知识缺口 / 自我红队。问题集由 schema 固定，避免每天临场设计问题导致的盲区。
metadata:
  short-description: 生成 7 问结构化每日复盘
---

# daily-review

资深投资者视角的每日复盘 skill。在每日 ingest（`/fetch-reports` + ingest 工作流）完成后调用，对当天的 wiki 内容做结构化提问与回答，输出到 `wiki/output/daily-review-{date}.md`。

## 触发方式

- 显式调用：`$daily-review 2026-04-14`
- 不带参数：`$daily-review`
- 自然语言也可触发，例如“基于今天 ingest 的内容做 daily review”

## 用途

- **日常复盘**：每天 ingest 结束后立即跑一次，5-10 分钟内拿到当日复盘
- **决策辅助**：把 LLM 当作"7 个角度的研究助理"——每天用同一组问题强制覆盖全维度
- **防自我强化**：Q7 强制做红队，避免 wiki 越用越偏（confirmation bias）
- **驱动下轮 ingest**：Q6 的"知识缺口"列表直接成为下一天的 ingest 优先级

## 与其他 output 的区别

| Output | 形式 | 长度 | 触发 |
|---|---|---|---|
| `投资总结报告-{date}.md` | 综合分析报告 | 长（300-500 行） | 主动生成 |
| `daily-review-{date}.md` | 7 问 7 答 | 中（200-300 行） | 每日自动 / 半自动 |
| `comparison/` | 跨页 / 跨日对比 | 中 | 按需，固化关键拐点 |

> **建议组合**：每日 `daily-review` 必跑；当 `daily-review` 揭示重大叙事修正时，再创建 `comparison` 页固化；周末或月末再跑一次综合 `投资总结报告`。

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `$ARGUMENTS` | 否 | 日期 `YYYY-MM-DD`，留空则取当天（Asia/Shanghai） |

## 前置条件

- 当天 source 页已经 ingest 完毕（`wiki/source/*-{date短码}.md` 存在）
- 已读取 `wiki/index.md` 和 `wiki/log.md` 形成 mental map
- 已读 `AGENTS.md` / `CLAUDE.md` 了解 wiki schema 和约定

## 7 个标准问题（不可省略，顺序固定）

### Q1: 今天最大的认知变化是什么？

要求：
- **vs wiki 既有观点**——必须明确指出今天的判断与昨天 / 历史 source 哪一条形成矛盾、印证或净新（net new）
- **每条认知变化引用具体 source**：`（来源：[[source/...]]）`
- **不超过 5 条**，按重要性排序
- 每条结构：`【1 句话核心判断】+ 【数据 / 证据】+ 【vs wiki 状态：⚠️ 矛盾 / ✓ 印证 / ✦ 净新】+ 【投资含义】`

### Q2: 哪个数据点最反共识？Expectation gap 在哪里？

要求：
- 至少 3 个 expectation gap，按 surprise 强度排序
- 每条结构：`【市场共识】vs【新数据点】= 【gap 大小】`
- 标注 gap 的"方向"（利好 / 利空 / 中性但意外）
- 优先选**定量** gap（数字 vs 数字），其次是**定性** gap（行业行为 vs 共识叙事）
- 引用 source

### Q3: 跨板块串联

要求：
- 找出今天 N 份 source 之间的**交叉印证或矛盾**
- 把它们映射到现有 `wiki/concept/` 或 `wiki/comparison/` 中的 cross-cutting theme（如 [[concept/反内卷]]、"算力去英伟达化"、"十五五能源"）
- **强化 / 削弱 / 净新 theme** 三种状态
- 至少 3 条串联，每条引用 ≥2 份 source

### Q4: 如果今天必须新建 1 个仓位，最高确信度方向？

要求：
- **必须给出具体标的**（[[company/...]] wiki link，多个标的也可）
- **必须给出**：
  - 方向（long / pair trade / spread 等）
  - 催化剂（具体事件 + 预期时间）
  - 时间窗口（短期 1-3 月 / 中期 6-12 月 / 长期 1-3 年）
  - 主要风险（至少 2 条）
  - 假想止损位 / invalidation condition
- **不许空话**："看好 AI 板块"不算回答，必须具体到 ticker 和具体逻辑
- 引用 source 支撑

### Q5: 如果今天必须减仓 / 翻空 1 个仓位，最该动的是什么？

要求：
- 同 Q4 的具体度要求，但反向
- 优先**动现有 wiki 中的 active thesis**（如 [[wiki/thesis/...]] 中标记 `direction: long, status: active` 的）
- 如果 active thesis 为空，可选今天 source 中**最被高估**的方向
- 必须明确"今天的什么数据让我想动这个仓位"

### Q6: 最大的知识缺口 + 应主动获取的信息

要求：
- **明确列出 3-5 个知识缺口**，按重要性排序
- 每条：`【缺口描述】+ 【为什么重要】+ 【建议获取方式】`（如：哪个 ticker 的财报 / 哪类专家访谈 / 哪个数据库）
- 同时列出今天哪些 source **质量不足或单一信源**，需要二手验证
- 这一条直接影响下一天的 ingest 优先级

### Q7: 自我红队（meta + bias check）

要求：
- 检查今天 7 问的回答中有没有：
  1. **confirmation bias**：是否过度引用了印证既有观点的 source 而忽略矛盾的？
  2. **集体性来源偏差**：今天的 source 是否过度集中在某一类？
     - **必做硬指标**：计算今天 source 中 sell-side（meeting_minutes / broker_report 类型）占比；若 ≥ 50%，必须在 Q7 显式标注"⚠️ sell-side 占比偏高（X%），结论可能 inherently positive"
     - 同时检查是否过度集中在某个具体券商 / 某个分析师覆盖范围
  3. **"我希望它真"的判断**：哪些结论是"愿意相信"而非"证据充分"？特别是依赖单一信源的强判断
  4. **wiki 自我强化（含 comparison 页冷却期）**：
     - 当前 wiki 中是否有某些"老观点"已经超过 30 天没被新数据挑战，但仍被默认引用？
     - **必做硬约束**：daily-review 引用 `wiki/comparison/` 或 `wiki/output/` 页面时，必须区分：
       - **稳定共识**（创建 / 最后更新 ≥ 7 天前）→ 可作为 anchor 引用
       - **新页面**（创建 / 最后更新 < 7 天）→ **不得作为 anchor**，只能作为"今天 query 的副产品"提及
     - 例外：如该页面的来源 source 都 ≥ 7 天稳定，则 comparison 页可作为整理性引用
     - 这条防止 daily-review 反复引用自己刚创建的 comparison 页形成循环论证
- 至少给出 2 条**具体的 red-team 反问**

## 输出格式

文件路径：`wiki/output/daily-review-{date}.md`

```yaml
---
type: output
title: "投资研究每日复盘 — YYYY-MM-DD"
date: "YYYY-MM-DD"
sources: [所有今日 source 的 wiki link]
tags: [daily-review, qa, 资深投资者视角]
last_updated: "YYYY-MM-DD"
---

# 投资研究每日复盘 — YYYY-MM-DD

> 基于当日 N 份 source（M 份新增 / K 份历史交叉引用）回答 7 个标准问题。
> 问题集由 `skills/daily-review/SKILL.md` 固定，避免临场设计盲区。

## Q1: 今天最大的认知变化

[内容]

## Q2: 反共识数据点 / Expectation Gap

[内容]

## Q3: 跨板块串联

[内容]

## Q4: 高确信度多头方向

[内容]

## Q5: 高确信度空头 / 减仓方向

[内容]

## Q6: 知识缺口与下一步 ingest 优先级

[内容]

## Q7: 自我红队（Bias Check）

[内容]

## 引用来源

[完整 source 列表]
```

## 执行步骤

1. **确定日期** — `$ARGUMENTS` 为空时取当天（Asia/Shanghai）
2. **检查前置条件** —
   - Glob `wiki/source/*-{date短码}.md` 确认有 ≥ 1 份当日 source（短码用 `260413` 这种形式，与现有命名一致）
   - 如果没有，提示用户先跑 `$fetch-reports` 或先完成 ingest
3. **读取 mental map** —
   - Read `wiki/index.md`（约 200 行，建立全局认知）
   - Read `wiki/log.md` 最近 3 条（了解前 1-2 天的关键状态）
4. **读取当日所有 source 页** —
   - Glob 所有 `wiki/source/*-{date短码}.md`
   - Read 每一份（或用 Grep 提取关键章节如 `## 关键要点`、`## 结构性观察`、`## 与现有知识的关系`）
5. **可选：读交叉引用的历史 source / entity 页** —
   - 如某份当日 source 在"## 与现有知识的关系"中提到某个历史 source，按需读取
6. **针对 Q1–Q7 逐一作答** —
   - 严格按问题要求的格式
   - 每条断言必须有 source 引用
   - Q4 / Q5 不许空话
7. **写文件** —
   - `wiki/output/daily-review-{YYYY-MM-DD}.md`
   - 严格按上面的输出格式
8. **更新 index.md** —
   - 在 Output 表格新增一行
9. **追加 log.md** —
   - 格式：`## [YYYY-MM-DD] daily-review | 7 问复盘`
   - body 简述：本次最大认知变化（Q1 一句话）、最大 expectation gap（Q2 一句话）、首选多头 / 空头方向、最大知识缺口
10. **总结报告给用户** —
    - 文件路径
    - 7 个问题答案的一行摘要
    - 是否触发了 comparison 页归档（如 Q1 揭示重大叙事修正）

## 重要约束

- **问题集是固定的**——不要根据当天素材自己改问题、加问题、删问题。这是 skill 的核心价值（强制覆盖维度）
- **每条断言必须可追溯**——`（来源：[[source/...]]）`
- **Q4 / Q5 必须给具体标的和具体逻辑**——这是最考验"资深投资者"含金量的地方，不能用"看好 AI"这种空话糊弄
- **Q7 必须真做 red team**——不是装样子。Q7 包含**两条硬指标**：
  1. 计算并显式标注 sell-side 占比（≥ 50% 必须警示）
  2. 引用 comparison/output 页面前必须检查"7 天冷却期"，新页面不得作 anchor
- **comparison / output 页 7 天冷却期**：daily-review 引用 `wiki/comparison/` 或 `wiki/output/` 时，若目标页面 `last_updated` 在 7 天内，**只能作为"今天 query 的副产品"提及**，不能作为 anchor / ground truth。这是防 wiki 自我强化的硬规则
- **如果当天 source < 5 份**——可以正常做 daily-review，但在文件顶部说明"低密度日"，Q3 跨板块串联可能写"无"
- **如果当天 source = 0**——直接告诉用户没有可复盘内容，建议先 `/fetch-reports` 再 ingest

## 与现有工作流的衔接

- **触发时机**：在 `/fetch-reports` + ingest 完成后立即跑
- **触发时机**：在 `$fetch-reports` + ingest 完成后立即跑
- **输出归档**：`wiki/output/daily-review-{date}.md` 与 `wiki/output/投资总结报告-{date}.md` 并列
- **跨日跟踪**：连续 N 天的 daily-review 形成"认知变化时间序列"。当某条认知变化反复出现或反复被推翻时，应触发 comparison 页归档
- **Schema 引用**：`AGENTS.md` / `CLAUDE.md` 的工作流章节应在 ingest 之后提及"建议运行 daily-review"

## 相关文件

- `scripts/fetch_reports.py` — 上游数据拉取
- `skills/fetch-reports/SKILL.md` — 拉取 skill
- `.claude/commands/daily-review.md` — Claude Code 的 slash command 入口（如需兼容 Claude）
- `AGENTS.md` / `CLAUDE.md` — wiki schema
- `wiki/output/投资总结报告-{date}.md` — 综合报告（与本 skill 互补）
