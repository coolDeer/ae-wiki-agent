---
name: ae-daily-summarize
description: 资深投资经理 (PM) 视角的每日简报。基于当日 ingest 的 source/brief 页（MCP 查 Postgres）+ 同日 daily-review 文件（如已生成）+ active thesis 列表（CLI），输出 IC briefing 风格的 wiki/output/daily-summarize-{date}.md。9 个固定章节：执行摘要 / 市场快照 / 组合影响 / 新建仓 / 减仓对冲 / 风险预警 / 催化剂日历 / 研究任务 / 路演要点。与 daily-review 形成 epistemic → operational 两层流水线（先复盘后决策）。
metadata:
  short-description: 生成 PM 视角的每日决策简报
---

# ae-daily-summarize

资深投资经理（PM / 投委会主席）视角的每日简报 skill。在 `$ae-daily-review` 完成后调用，把 epistemic 复盘转换为 operational 决策简报，输出到 `wiki/output/daily-summarize-{date}.md`。**最终报告统一用英文。**

## 触发方式

- `$ae-daily-summarize 2026-04-14` — 指定日期
- `$ae-daily-summarize` — 当天（Asia/Shanghai）
- 自然语言：「基于今天的 daily review 生成 PM 简报」

## 用途

- **每日 morning brief**：5-10 分钟读完决定今日是否调仓 / 加 hedge / 召集团队
- **IC / LP 沟通底稿**：§9 "路演要点" 直接做 talking points
- **团队任务派发**：§8 "研究任务清单" 可直接 copy 给研究员
- **风险监控**：每日强制扫描 active thesis 的 invalidation conditions

## 与 daily-review 的关系

| 维度 | daily-review | daily-summarize |
|---|---|---|
| 视角 | 资深投资者（epistemic）| 资深投资经理（operational）|
| 核心问 | "我今天学到了什么？" | "明天组合该做什么？" |
| 时间窗 | 单日 | 滚动 3-7 天 + 前瞻 1-2 周 |
| 持仓感 | 假想 / 不强 | **明确**（active thesis / hypothetical 组合）|
| Self-check | bias / 信源偏差 / 自我强化 | sizing / liquidity / cross-correlation |
| 依赖 | 仅当日 source / brief | source + **同日 daily-review** + active thesis |

```
ingest → $ae-daily-review → $ae-daily-summarize
        (复盘 / 求知)      (决策 / 执行)
```

## 数据来源

| 需要 | 用什么 |
|---|---|
| 当日 source / brief 列表 | `recent_activity({days:1, kinds:['page']})` 筛 slug 前缀 `sources/` / `briefs/` |
| 某 source 的关键章节 | `get_page(slug)`，重点取 `## 关键要点` / `## 结构性观察` / `## 与现有知识的关系` |
| 同日 daily-review 文件 | 直接 Read `wiki/output/daily-review-{date}.md`（agent 上一步刚生成）|
| Active thesis 清单 + 状态 | `bun src/cli.ts thesis:list --status active` |
| 单个 thesis 的 facts + signals | `bun src/cli.ts thesis:show <pageId>` |
| 跨标的相关性 / 行业暴露 | `search` + `list_entities({sector, type:'company'})` |
| 某公司最新催化剂时点 | `query_facts({entity, currentOnly:true})` 看是否有 period 在未来 |
| 多公司同指标横向矩阵 | `compare_table_facts({metric, entities?, periods?, sourceIdentifier?, currentOnly:true})` |
| 某 source 的原始表格 | `get_table_artifact({identifier, table_id?})` |

> 本项目**没有 `wiki/portfolio.md` 文件**（之前老 wiki 有，迁移后不再维护）。组合锚点统一用 `bun src/cli.ts thesis:list --status active` 拉 active thesis 当组合代理；都没有时用 hypothetical 组合并在 §3 顶部明确标注。

## 9 个固定章节（顺序固定，不可省略 / 增删 / 改写）

### §1 执行摘要（Executive Summary, 3-5 句）

- 5-second pitch：今日核心信号 + 对组合的一句话影响 + 1 个明确行动建议
- 不超过 5 句；不引用 source（保留给后续章节）
- 范例："今日核心信号是 X；对 [[companies/Y]] 仓位形成 Z 影响；建议在开盘前 trim N%"

### §2 市场快照（Market Snapshot）

- 跨资产 1-line 状态：股 / 债 / 大宗 / 汇率 / 宏观信号
- **优先来源**：`vital_knowledge` / `aletheia Vital Dawn` 等宏观类 source
- 当天无宏观 source → 标"无新增宏观信号，沿用 [[sources/<最新宏观 slug>]]"
- 表格化，不超过 8 行

### §3 组合影响评估（Portfolio Impact）

- **遍历 active thesis**（`bun src/cli.ts thesis:list --status active`）
- 每条评分：**强利好 / 利好 / 中性 / 利空 / 强利空**
- 必须**引用具体 source** 说明影响来源
- 标注影响是 "thesis confirming / challenging / neutral"
- active thesis 为空时使用 hypothetical 组合，**§3 顶部明确标注 "无 active thesis，使用假想组合"**
- 表格形式
- 若多个 active thesis target 共享同一指标（例如 gross margin / capex / target price revision），优先用 `compare_table_facts` 给出相对强弱，而不是逐条 prose 主观排序

### §4 新建仓建议（New Position）

从今日 source 识别 1-3 个新机会，A/B/C 优先级。每条**必须包含**（缺一不可）：

- 标的 `[[companies/...]]`（含 ticker）
- 方向（long / short / pair / spread）
- **建议 sizing**（占组合 % 上限）
- **入场区间**（限价 / 市价）
- **止损位**（明确价格或 % drawdown）
- **目标位**（base / bull / bear case）
- **催化剂**（具体事件 + 预期时间）
- **主要风险** ≥2 条

与 daily-review Q4 的差异：daily-review 给"方向"，daily-summarize 给"sizing + 入场 + 止损"完整可执行单据。

若候选机会来自一组可横向比较的公司，必须先用 `compare_table_facts` 说明为什么 A 优于 B，或者为什么适合做 pair / spread。

无机会时写"建议保持当前仓位，无新增建仓信号"+ 1 句解释。

### §5 减仓 / 对冲建议（Reduce / Hedge）

- 优先动 active thesis 中的现有头寸（`thesis:list --status active`）
- 每条包含：
  - 标的 + 当前仓位（如可知）
  - 减仓比例 / 对冲规模
  - **理由**：今天的什么数据让我想动这个仓位
  - **执行优先级**：紧急（盘前/开盘立即）/ 一般（本周内）/ 监控（下周关注）
  - **替代方案**：减仓 vs 对冲 vs 部分平仓的权衡
- 无需要动的仓位 → "建议保持，无减仓信号"

若减仓 / 对冲理由来自“相对劣后”而非绝对恶化，必须给出 comparison 维度（metric / period / peer set），不能只写“表现较弱”。

### §6 风险预警（Risk Alerts）

- **扫描所有 active thesis 的 invalidation conditions**（`thesis:show` 看 validation_conditions JSONB），标注哪些今天接近触发
- 列今天新增的 tail risks（地缘 / 政策 / 行业事件）
- 列 cross-position correlation risk（如 3 个 AI 标的同涨同跌）
- 表格：风险描述 / 影响标的 / 触发概率 / 建议响应
- 当风险来自 peer spread 收窄 / 扩大、同链条 capex revision、或同类估值表的极端分位时，优先引用 `compare_table_facts`

### §7 催化剂日历（Catalyst Calendar，前瞻 1-2 周）

- 财报日（日期 + ticker + market expectation）
- 政策窗口（FOMC / 央行 / 政治事件）
- 行业会议 / 产品发布
- Active thesis 关键里程碑（`thesis:show` 看 catalysts JSONB 的 date 字段）
- 来源：当天 source 提到的时间节点 + thesis catalysts
- 表格：日期 / 事件 / 关联标的 / 预期影响

### §8 研究任务清单（Research To-Do）

- **直接复用** daily-review §Q6 的"知识缺口"列表
- 每个任务赋 owner（PM / 研究员 A / B）+ 截止日 + 优先级
- 任务分类：channel check / 文献综述 / 财报分析 / 专家访谈 / 第三方数据
- 输出格式：可直接 copy-paste 给团队

### §9 路演要点（Talking Points）

- 3-5 条**对外可说**的简短判断
- **避免**：内部分歧、未验证猜测、过度信心的 alpha 表述
- **包含**：今日核心 narrative、组合调整逻辑、关键风险、可量化 conviction（high/medium/low）
- 直接 copy 进 LP letter 或 IC slide 不需修改
- 中性偏保守的语气

## Self-Check（强制末尾，4 项缺一不可）

PM 视角的 4 个硬检查（区别于 daily-review Q7 的 epistemic 红队）：

### Check 1: Sizing 合理性
- 新建仓 + 现有仓位的总 exposure 是否超出风控上限？
- 单一标的 ≤5% / 单一行业 ≤25% / 单一国家 ≤40%？

### Check 2: Liquidity / 可执行性
- 推荐 sizing 在标的日均成交量下能否 1-3 天建 / 减仓而不显著推动价格？
- 止损位在流动性最差时段能否实际触发？
- 港股 / A 股 / 日股的市场结构差异考虑了吗？

### Check 3: Cross-correlation 隐含风险
- 组合中是否多个标的看似独立但实际 ride 同一 macro factor？
- 组合 beta / 风格因子敞口是否平衡？

### Check 4: vs 上次 brief 的一致性
- 今日 talking points 是否与 7 / 30 天前的 IC brief 一致？
- 不一致时是否有"什么数据改变了我的判断"的清晰解释？
- 避免"今天看多明天看空"反复横跳给 LP 留下不专业印象
- 操作：Read `wiki/output/daily-summarize-{date - 7d}.md` 和 `{date - 30d}.md`（如存在）

## 执行步骤

1. **解析日期** — `$ARGUMENTS` 为空 → 当天

2. **检查前置**
   - `recent_activity({days:1, kinds:['page']})`，筛 source/brief，确认 ≥ 1 份当日新增；为 0 → 提示先跑 fetch + ingest，**不出报告**
   - `ls wiki/output/daily-review-{date}.md` —— **强烈建议**先存在；如不存在，先提示用户跑 `$ae-daily-review`，但允许选择继续（fallback：直接基于 source 做 PM 简报，但 §8 知识缺口质量会下降）

3. **拉组合锚点**
   ```bash
   bun src/cli.ts thesis:list --status active
   ```
   - 有 → 用作组合代理，§3 / §5 / §6 都基于它
   - 无 → 使用 hypothetical 组合（"假想多策略 long-only China-Asia"），§3 顶部明确标注

4. **建立 mental map**
   ```
   recent_activity({days: 7, limit: 30})
   ```

5. **读当日素材**
   - `get_page` 当日所有 source / brief，重点提取 §关键要点 / §结构性观察 / §与现有知识的关系
   - Read `wiki/output/daily-review-{date}.md`（如存在），**重点提取 Q4 / Q5 / Q6**——这是 PM 简报的基础（避免重复劳动）

6. **识别需要做 table comparison 的 trade cluster**
   遇到以下任一情况，必须跑 `compare_table_facts`：
   - 同一行业 / 同一 thesis basket 里有多个可比公司
   - 需要决定“买谁 / 减谁 / 做 pair 谁对谁”
   - 某个结论依赖 revision、ranking、spread、relative premium / discount
   - daily-review 已指出某张表很关键，但 prose 没有给出完整横向排序

   推荐动作：
   - 先用 `compare_table_facts({metric, entities, periods?, currentOnly:true})`
   - 如结果异常稀疏，再用 `get_table_artifact({identifier})` 回看原表

7. **拉 active thesis 详情（给 §3 / §6 / §7 用）**
   - 对每个 active thesis：`bun src/cli.ts thesis:show <pageId>`
   - 提取 catalysts / validation_conditions / 最新 facts / signals

8. **逐章节作答 §1-§9 + Self-Check**
   严格按上方格式。§4/§5 必须完整可执行单据。§9 必须立即可用。
   涉及横向选择时，要把 comparison 结果写成可执行判断，例如“[[companies/A]] FY2027E gross margin leads peer set by 380 bps, so it gets priority A over [[companies/B]]”。

9. **写文件**
   ```bash
   mkdir -p wiki/output
   # 写到 wiki/output/daily-summarize-{YYYY-MM-DD}.md
   ```

10. **总结报告给用户**
   - 文件路径
   - 9 章节一行摘要
   - **特别强调**：是否有"紧急"优先级的操作需要立即执行（紧急减仓 / 加 hedge）

## 输出格式

```yaml
---
type: output
subtype: daily-summarize
title: "Daily PM Brief - YYYY-MM-DD"
date: "YYYY-MM-DD"
sources: [当日 source/brief slug + daily-review 文件路径如有]
active_thesis_count: N        # §3 用到的 active thesis 数
tags: [daily-summarize, pm-brief, ic-briefing]
last_updated: "YYYY-MM-DD"
---

# Daily PM Brief - YYYY-MM-DD

## 1. Executive Summary
[3-5 sentences]

## 2. Market Snapshot
[Table, up to 8 rows]

## 3. Portfolio Impact
[Table by thesis with rating]

## 4. New Positions
[A/B/C priority, each as a fully executable trade sheet]

## 5. Reduce / Hedge
[Priority + instrument + sizing + rationale]

## 6. Risk Alerts
[Table]

## 7. Catalyst Calendar
[Table]

## 8. Research To-Do
[Assignable tasks]

## 9. Talking Points
[3-5 immediately usable talking points]

## Self-Check
- Sizing: ✓ / ⚠️ + notes
- Liquidity / Executability: ✓ / ⚠️ + notes
- Cross-correlation: ✓ / ⚠️ + notes
- Consistency vs prior brief: ✓ / ⚠️ + notes

## Sources
[Full source / brief slug list + daily-review + active thesis list]
```

## 重要约束

- **章节顺序固定**——不要增删 / 重排
- **§4 / §5 必须完整可执行单据**——sizing + 入场 + 止损 + 目标缺一不可，空话不接受
- **§3 必须 reference active thesis 或显式标 hypothetical**——不能空泛说"AI 板块"
- **涉及 peer ranking / revision table / period matrix 时，必须优先使用 `compare_table_facts`**——不要只靠 daily-review prose 二次转述
- **若 `compare_table_facts` 无法解释 trade choice，就不要硬下 sizing 指令**；先把它降级为 §8 研究任务
- **§9 路演要点必须立即可用**——直接 copy-paste 不需修改
- **Self-Check 4 项缺一不可**
- **同日 daily-review 已生成时必须引用其 Q4/Q5/Q6**——daily-summarize 是 daily-review 的"决策化转换"，避免重复劳动
- **不修改任何 page**——daily-summarize 是只读综合，输出只到 `wiki/output/`
- **§4/§5 中有"紧急"优先级 → §1 必须明确突出**——不能藏在后面章节

## 与现有工作流的衔接

- **触发顺序**：`$ae-fetch-reports` → ingest → `$ae-daily-review` → **`$ae-daily-summarize`**
- **输出归档**：`wiki/output/daily-summarize-{date}.md` 与 `daily-review-{date}.md` 并列
- **跨日跟踪**：连续 N 天的 daily-summarize 形成"PM 决策时间序列"，Self-Check 4 强制对照 7/30 天前防止反复横跳

## 相关文件

- `src/mcp/server.ts` / `src/mcp/queries.ts` — MCP 工具实现
- `src/cli.ts` (case `thesis:*`) — active thesis CLI
- `skills/ae-daily-review/SKILL.md` — 上游 epistemic 复盘 skill
- `CLAUDE.md` §"4 个用户入口" / §"MCP Tools" — 整体架构
