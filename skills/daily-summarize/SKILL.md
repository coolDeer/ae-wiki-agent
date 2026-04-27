---
name: daily-summarize
description: 资深投资经理 (PM) 视角的每日简报。基于当日 ingest 的 source 页 + 同日 daily-review（如已生成）+ wiki/portfolio.md（如有），输出 IC briefing 风格的 wiki/output/daily-summarize-{date}.md。9 个固定章节：执行摘要 / 市场快照 / 组合影响 / 新建仓 / 减仓对冲 / 风险预警 / 催化剂日历 / 研究任务 / 路演要点。与 daily-review 形成 epistemic → operational 两层流水线（先复盘后决策）。
metadata:
  short-description: 生成 PM 视角的每日决策简报
---

# daily-summarize

资深投资经理（PM / 投委会主席）视角的每日简报 skill。在 `/daily-review` 完成后调用，把 epistemic 复盘转换为 operational 决策简报。

## 触发方式

- 显式调用：`$daily-summarize 2026-04-14`
- 不带参数：`$daily-summarize`
- 自然语言也可触发，例如“基于今天的 daily review 生成 PM 简报”

## 用途

- **每日 morning brief**：5–10 分钟读完即可决定今天是否需要调仓 / 加 hedge / 召集团队
- **IC / LP 沟通底稿**：直接基于"路演要点"章节做 1-on-1 或 IC 会议的 talking points
- **团队任务派发**：基于"研究任务清单"章节给下属研究员发指令
- **风险监控**：每日强制扫描 active thesis / portfolio 的 invalidation conditions

## 与 daily-review 的关系

| 维度         | daily-review            | daily-summarize                                 |
| ---------- | ----------------------- | ----------------------------------------------- |
| 视角         | 资深投资者 (epistemic)       | 资深投资经理 (operational)                            |
| 核心问        | "我今天学到了什么？"             | "明天组合该做什么？"                                     |
| 格式         | 7 问 7 答                 | IC briefing / Morning brief                     |
| 时间窗        | 单日                      | 滚动 3–7 天 + 前瞻 1–2 周                             |
| 持仓感        | 假想 / 不强                 | **明确**（读 portfolio.md / active thesis）          |
| Self-check | bias / 信源偏差 / wiki 自我强化 | sizing / liquidity / cross-correlation          |
| 依赖         | 仅 source 页（独立）          | source + **同日 daily-review** + portfolio.md（链式） |

**两者是 epistemic → operational 流水线**，`$daily-review` 先跑，`$daily-summarize` 后跑：

```
ingest → $daily-review → $daily-summarize
        (复盘 / 求知)    (决策 / 执行)
```

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `$ARGUMENTS` | 否 | 日期 `YYYY-MM-DD`，留空取当天（Asia/Shanghai） |

## 前置条件

- 当天 source 页已 ingest（`wiki/source/*-{日期短码}.md` 存在）
- **强烈建议**当天 `wiki/output/daily-review-{date}.md` 已生成（提升输出质量）
- **可选**`wiki/portfolio.md` 存在（提供 PM 实际持仓 / 假想组合的锚点；不存在时 fallback 到 active thesis 或 hypothetical）
- 已读 `AGENTS.md` / `CLAUDE.md` 了解 wiki schema

## 9 个固定章节（顺序固定，不可省略）

### §1 — 执行摘要（Executive Summary, 3-5 句话）

要求：
- 给"看到这个简报的 PM/IC 主席"的 5-second pitch
- **必须包含**：今日核心信号 + 对组合的一句话影响 + 1 个明确行动建议
- 不超过 5 句话；不引用 source（保留给后续章节）
- 写法范例："今日核心信号是 X；对 [[xxx]] 仓位形成 Y 影响；建议在 09:30 之前 trim Z%"

### §2 — 市场快照（Market Snapshot）

要求：
- 跨资产 1-line 状态：股 / 债 / 大宗 / 汇率 / 宏观信号
- **优先来源**：vital_knowledge / Vital Dawn / Market Analysis weekly 类 source（如有）
- 如当天无宏观 source，标注"无新增宏观信号，沿用 [[source/...]] 的判断"
- 表格化呈现，不超过 8 行

### §3 — 组合影响评估（Portfolio Impact Assessment）

要求：
- **逐一**遍历 `wiki/portfolio.md` 中的持仓（如无此文件，遍历 `wiki/thesis/*.md` 中 status=active 的；如均无，使用 hypothetical "AI / 半导体 / 中国消费 / 日本药妆 多策略组合"）
- 每个持仓的影响评分：**强利好 / 利好 / 中性 / 利空 / 强利空**
- 必须**引用具体 source** 说明影响来源
- 标注影响是 "thesis confirming / challenging / neutral"
- 表格形式

### §4 — 新建仓建议（New Position Recommendations）

要求：
- 从今天的 source 中识别 **1-3 个**新机会
- 优先级排序（A/B/C）
- 每个建议**必须**包含：
  - 标的（[[company/...]]，含 ticker）
  - 方向（long / short / pair / spread）
  - **建议 sizing**（占组合 % 上限）
  - **入场区间**（限价 / 市价）
  - **止损位**（明确价格或 % drawdown）
  - **目标位**（base case / bull case / bear case）
  - **催化剂**（具体事件 + 预期时间）
  - **主要风险**（≥2 条）
- 与 daily-review Q4 的差异：daily-review 给"方向"，daily-summarize 给"sizing + 入场 + 止损"完整可执行单据
- 如今天无可建仓机会，写"建议保持当前仓位，无新增建仓信号"+ 1 句解释

### §5 — 减仓 / 对冲建议（Reduce / Hedge Recommendations）

要求：
- 优先动 portfolio.md 中的现有头寸
- 每个建议**必须**包含：
  - 标的 + 当前持仓 %（如可知）
  - 减仓比例 / 对冲规模
  - **理由**：今天的什么数据让我想动这个仓位？
  - **执行优先级**：紧急（盘前 / 开盘后立即）/ 一般（本周内）/ 监控（下周关注）
  - **替代方案**：减仓 vs 对冲 vs 部分平仓 的权衡
- 如无需要动的仓位，写"建议保持，无减仓信号"

### §6 — 风险预警（Risk Alerts）

要求：
- 扫描所有 active thesis 的 **invalidation conditions**，标注哪些在今天接近触发
- 列出今天新增的 **tail risks**（地缘 / 政策 / 行业事件）
- 列出 **cross-position correlation risk**（如：组合中 3 个 AI 标的同涨同跌的风险）
- 表格形式：风险描述 / 影响标的 / 触发概率 / 建议响应

### §7 — 催化剂日历（Catalyst Calendar，前瞻 1-2 周）

要求：
- 列出未来 1-2 周内的所有重要事件：
  - 财报日（具体日期 + ticker + market expectation）
  - 政策窗口（FOMC、央行会议、政治事件）
  - 行业会议 / 产品发布
  - Active thesis 的关键里程碑（如 SHR-1139 Phase 2 启动）
- 来源：当天 source 中提到的时间节点 + wiki 中已有 thesis 的时间线
- 表格形式：日期 / 事件 / 关联标的 / 预期影响

### §8 — 研究任务清单（Research To-Do）

要求：
- **直接复用** daily-review Q6 的"知识缺口"列表
- 每个任务赋予 owner（PM 自己 / 研究员 A / 研究员 B）+ 截止日
- 优先级排序
- 任务分类：channel check / 文献综述 / 财报分析 / 专家访谈 / 第三方数据采购
- 输出格式：可直接 copy-paste 给团队的任务派发清单

### §9 — 路演要点（Talking Points for IC / LP / 客户）

要求：
- 3-5 条**对外可说**的简短判断
- **避免**：内部分歧、未验证猜测、过度信心的 alpha 表述
- **包含**：今日核心 narrative、组合调整逻辑、关键风险、可量化的 conviction（"high / medium / low"）
- 写法应**立即可用**——直接 copy 进 LP letter 或 IC slide
- 中性偏保守的语气

## 自我审视章节（Self-Check）— 强制末尾

PM 视角的 4 个硬检查（区别于 daily-review 的 epistemic 红队）：

### Check 1: Sizing 合理性
- 新建仓 + 现有仓位的总 exposure 是否超出风控上限？
- 单一标的是否超过 5% / 单一行业是否超过 25% / 单一国家是否超过 40%？

### Check 2: Liquidity / 可执行性
- 推荐的 sizing 在标的的日均成交量下能否在 1-3 天内建仓 / 减仓而不显著推动价格？
- 止损位在流动性最差的时段能否实际触发？
- 港股 / A 股 / 日股 的市场结构差异是否考虑？

### Check 3: Cross-correlation 隐含风险
- 组合中是否有多个标的看似独立但实际上 ride 同一个 macro factor？（如多个 AI 标的都赌 NVIDIA Q4 财报；多个日股都赌日元贬值）
- 组合 beta / 风格因子敞口是否平衡？

### Check 4: vs 上次 brief 的一致性
- 今日 talking points 是否与 7 天前 / 30 天前的 IC brief 一致？
- 如不一致，是否有清晰的"什么数据改变了我的判断"解释？
- 避免"今天看多明天看空"的反复横跳给 LP 留下不专业印象

> **注**：与 daily-review 的 Q7 不同，daily-summarize 的 self-check 不做 confirmation bias / 信源偏差检查（那是 daily-review 的职责），只关心**操作可执行性**和**组合一致性**。

## 输出格式

文件路径：`wiki/output/daily-summarize-{date}.md`

```yaml
---
type: output
title: "投资经理每日简报 — YYYY-MM-DD"
date: "YYYY-MM-DD"
sources: [所有今日 source 的 wiki link + daily-review 同日 link 如有]
portfolio_ref: "wiki/portfolio.md or null"
tags: [daily-summarize, pm-brief, ic-briefing]
last_updated: "YYYY-MM-DD"
---

# 投资经理每日简报 — YYYY-MM-DD

## §1 执行摘要
[3-5 句话]

## §2 市场快照
[表格]

## §3 组合影响评估
[表格 + 说明]

## §4 新建仓建议
[A/B/C 优先级，每条完整可执行单据]

## §5 减仓 / 对冲建议
[优先级 + 标的 + 比例 + 理由]

## §6 风险预警
[表格]

## §7 催化剂日历
[表格]

## §8 研究任务清单
[可派发任务]

## §9 路演要点
[3-5 条可对外说的简短判断]

## Self-Check
[4 个硬指标]

## 引用来源
[完整 source + daily-review 引用]
```

## 执行步骤

1. **确定日期** — `$ARGUMENTS` 为空时取当天（Asia/Shanghai）
2. **检查前置** —
   - Glob `wiki/source/*-{日期短码}.md`，确认有 ≥ 1 份当日 source
   - Glob `wiki/output/daily-review-{date}.md`，**强烈建议**先存在；如不存在，**先提示用户跑 `$daily-review`**，但允许用户选择继续（用 fallback：直接基于 source 做 PM 简报）
3. **读 portfolio 锚点** —
   - 优先 Read `wiki/portfolio.md`
   - 不存在则 Glob `wiki/thesis/*.md` 找 active thesis
   - 都没有则使用 hypothetical 组合（"假想多策略 long-only China-Asia 组合"），并在 §3 顶部明确标注
4. **建立 mental map** —
   - Read `wiki/index.md` + `wiki/log.md` 最近 5 条
5. **读当日 source 页 + daily-review** —
   - 重点提取 daily-review 的 Q4 / Q5 / Q6（已经做过 actionable 工作，PM 简报建立在它们之上）
   - Source 页只读 §关键要点 + §结构性观察 + §与现有知识的关系
6. **逐章节作答** — 严格按 §1-§9 + Self-Check 顺序和格式要求
7. **写文件** — `wiki/output/daily-summarize-{YYYY-MM-DD}.md`
8. **更新 index.md** — Output 表新增一行
9. **追加 log.md** — `## [YYYY-MM-DD] daily-summarize | PM 简报`，body 简述 §1 / §4 首选标的 / §5 首选减仓 / §6 最大风险 / §9 talking points 第一条
10. **总结** — 告知用户文件路径 + 9 章节一行摘要 + 是否有需要立即执行的操作（紧急减仓 / 加 hedge）

## 重要约束

- **章节顺序固定**——不要增删 / 重排
- **§4 / §5 必须完整可执行单据**——sizing + 入场 + 止损 + 目标都要有；空话不接受
- **§3 必须 reference portfolio.md 或 active thesis**——不能空泛地说"AI 板块"
- **§9 路演要点必须立即可用**——直接 copy-paste 给 IC / LP 不需修改
- **Self-Check 4 项缺一不可**
- **如 daily-review 同日已生成，必须引用其 Q4/Q5/Q6**——避免重复劳动；daily-summarize 是 daily-review 的"决策化转换"
- **不要修改任何 source / entity / portfolio 页面**——daily-summarize 是只读综合，输出只在 `wiki/output/`
- **如组合需要紧急行动**（§4/§5 中有"紧急"优先级）——必须在 §1 执行摘要中明确突出，不能藏在后面章节

## 与现有工作流的衔接

- **触发顺序**：`$fetch-reports` → ingest → `$daily-review` → **`$daily-summarize`**
- **输出归档**：`wiki/output/daily-summarize-{date}.md` 与 `daily-review-{date}.md` 并列
- **跨日跟踪**：连续 N 天的 daily-summarize 形成"PM 决策时间序列"。Self-Check 4 强制对照 7/30 天前的简报，防止反复横跳
- **Schema 引用**：`AGENTS.md` / `CLAUDE.md` 的 ingest 工作流章节应提及"建议运行 daily-summarize"

## 相关文件

- `skills/daily-review/SKILL.md` — 上游 epistemic 复盘 skill
- `wiki/portfolio.md` — PM 实际持仓 / 假想组合（PM 自维护）
- `.claude/commands/daily-summarize.md` — Claude Code 的 slash command 入口（如需兼容 Claude）
- `AGENTS.md` / `CLAUDE.md` — wiki schema
- `wiki/thesis/` — Active thesis 集合（fallback portfolio 锚点）
- `CLAUDE.md` / `AGENTS.md` — wiki schema
- `.claude/commands/daily-summarize.md` — Slash command 入口
