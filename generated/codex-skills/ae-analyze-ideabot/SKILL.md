---
name: ae-analyze-ideabot
description: 按 name 从 aecapllc /agent/idea-bot/detail 拉取 IdeaBot 详情（仓位 / 方向 / score / events 等），结合 wiki 中已沉淀的公司 / 论点 / 行业 / 来源做交叉分析，生成该 idea 的综合研究报告。输出到 wiki/output/ideabot-{name}-{date}.md。
metadata:
  short-description: 拉取单个 IdeaBot 详情并结合 wiki 做综合分析
---

# ae-analyze-ideabot

按 name 拉取团队 IdeaBot 的单条详情记录，结合 wiki 已沉淀的公司 / 论点 / 行业 / 来源信息，**为这条 idea 生成一份综合的交叉分析报告**。

## 触发方式

- `$ae-analyze-ideabot NTNX` — 按名称模糊匹配（API 使用 MongoDB regex "i"）

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `$ARGUMENTS` | 是 | IdeaBot 名称（通常是 ticker 或标的简称），大小写不敏感，支持部分匹配 |

## 依赖

- Python 3 标准库（无 pip 依赖）
- `scripts/fetch_ideabot.py`

## 执行步骤

1. **拉取数据**
   ```bash
   python3 scripts/fetch_ideabot.py $ARGUMENTS
   ```

2. **脚本行为**
   - 调 `GET https://api.aecapllc.com/aecapllc-service/agent/idea-bot/detail?name={name}`
   - 完整响应保存到 `raw/ideabot/{name}.json`
   - stdout 打印 column / ls / progress / score / priority / analyst / sector / geo / marketCap / sizing / upside / events 数量
   - 未命中返回 exit 1，提示用户换关键字

3. **读取 IdeaBot 原始数据**
   - 读 `raw/ideabot/{name}.json`，取 `data` 字段
   - 核心字段：
     - **身份**：`name` / `column`（pipeline / research / archive）/ `ls`（Long / Short）/ `progress`（0-100）
     - **基本面**：`geo` / `sector` / `marketCap` / `adtv` / `vol`
     - **决策**：`sizing` / `upside` / `potlPnl` / `score` / `priority`
     - **owner**：`analyst` / `assignment`
     - **历史**：`events[]` — 评分变更 / 进度更新 / 评论等审计流水，按时间线梳理这条 idea 的演化
     - **时间戳**：`createTime` / `updateTime`

4. **Wiki 交叉查询（以 idea name 为锚点）**

   对这条 idea 在 wiki 中做多维度查找：

   1. **公司页**：`wiki/company/` 下是否已建档
      - 命中关键字：ticker / 英文名 / 中文名
      - 命中 → 读 frontmatter（`confidence` / `last_updated` / `tags`）和 `## 核心论点` / `## 风险因素` / `## 催化剂`
      - 未命中 → 标记"wiki 未建档"，这是 skill 报告的核心 gap

   2. **投资论点页**：`wiki/thesis/` 下 `target` 指向该标的的 thesis
      - 对照 IdeaBot 的 `ls` 方向 vs thesis `direction`，若冲突高亮为"观点分歧"
      - 检查 thesis `status` / `last_updated`，若 > 30 天未更新提示陈旧
      - 记录 thesis 的 `conviction` vs IdeaBot 的 `score` / `priority` 是否一致

   3. **相关来源**：`wiki/source/` 下近 60 天 `entities` 含该公司的 source
      - 提炼最新数据点、结构性观察、管理层表态
      - 特别关注与 IdeaBot events 时间线可印证/矛盾的片段

   4. **行业页**：`wiki/industry/` 对应 `sector` 的行业页
      - 读行业的"关键趋势" / "竞争格局" / "投资机会与风险"
      - 判断这条 idea 的论点是否与行业大趋势一致

   5. **对比 / 指标页**：`wiki/comparison/` 和 `wiki/metric/` 中涉及该标的的页面

   6. **TimeBot 关联**（可选加分）：`raw/timebot/*.json` 中最近 4 周是否有分析师在跟这个标的？投入多少工时？`consensus` 是否与 IdeaBot `ls` 一致？

5. **综合分析生成报告**

   基于第 3 步的 IdeaBot 画像和第 4 步的 wiki 交叉结果，独立思考并回答以下核心问题：

   - **这条 idea 当前处于什么阶段？** — 基于 `column` + `progress` + events 时间线判断（初筛 / 深度研究 / 即将建仓 / 已入库存档）
   - **论点 vs 证据**：IdeaBot 给的 `ls` / `score` / `sizing` / `upside` 背后的假设是否在 wiki 里有对应证据支撑？
   - **观点一致性**：IdeaBot 方向 vs wiki thesis 方向 vs wiki source 中最新观点 vs TimeBot 分析师 consensus，是否一致？分歧点在哪？
   - **Bull / Bear 情景**：基于 wiki 内容，给出该 idea 的正反两面论点，并指出最关键的验证 / 证伪条件
   - **催化剂**：近期有哪些可能驱动重定价的事件（财报 / 政策 / 产品周期 / 财年度切换）？从行业页和 source 页中提炼
   - **风险点**：IdeaBot `vol` + wiki 风险因素 + 行业系统性风险的综合提示
   - **sizing / priority 合理性**：基于 score、upside、potlPnl 和 wiki confidence 判断仓位建议是否合理

6. **下一步 action（具体可执行）**

   - 如果 wiki 未建档 → 指明要建的 company / thesis 页及最少必备章节
   - 如果 thesis 陈旧 → 指明要更新哪些章节、基于哪些新 source
   - 如果观点分歧 → 指明要做的关键访谈 / 数据验证
   - 如果催化剂临近 → 指明要跟踪的具体 metric 和时间点

7. **输出报告到 `wiki/output/ideabot-{safeName}-{today}.md`**

   `safeName` 为 `name` 清洗后的文件名安全版本（同 fetch 脚本）。报告按下方模板组织。

8. **更新索引**

   在 `wiki/index.md` 的"分析输出 (Output)"表格追加一行引用。

## 输出约定

- 原始 JSON 落盘：`raw/ideabot/{safeName}.json`（不 ingest 到 `wiki/source/`，IdeaBot 是团队内部决策数据，非研究来源）
- 分析报告：`wiki/output/ideabot-{safeName}-{YYYY-MM-DD}.md`，英文
- 写完后在 `wiki/index.md` 的"分析输出"区追加一条引用

## 报告模板

```markdown
---
type: output
subtype: ideabot-analysis
idea_name: {name}
ls: {Long / Short}
column: {pipeline / research / archive}
progress: {0-100}
score: {int}
priority: {int}
analyst: {analyst}
generated_at: {YYYY-MM-DD}
wiki_company: "{wiki/company 是否建档}"
wiki_thesis: "{wiki/thesis 对应论点名或 none}"
---

# IdeaBot 综合分析 — {name} ({Long/Short})

## IdeaBot 快照
- **身份**：{name} / {column} / progress {x}% / score {x} / priority {x}
- **决策参数**：ls={Long/Short} / sizing={x} / upside={x} / potlPnl={x}
- **基本面**：{geo} / {sector} / marketCap {x} / adtv {x} / vol {x}
- **owner**：analyst={x} / assignment={x}
- **时间戳**：createTime={x} / updateTime={x}

### Events 时间线
（按 createTime 升序梳理关键事件：评分变更 / 进度更新 / 评论；每条一行）
- {time} — {type/content}
- ...

## Wiki 交叉参照

### 公司档案
- [[company/xxx]] 或 **wiki 未建档** — {last_updated}，confidence={x}
- 核心论点摘要：...
- 风险因素摘要：...
- 催化剂摘要：...

### 投资论点
- [[thesis/xxx]] — direction={x}，status={x}，last_updated={x}
- **方向一致性**：IdeaBot {ls} vs thesis {direction} — ✓ / ✗
- conviction vs IdeaBot score：...

### 最新来源（近 60 天）
- [[source/xxx]] ({date}) — 核心要点：...
- [[source/yyy]] ({date}) — 核心要点：...

### 行业背景
- [[industry/xxx]] — 关键趋势：...，与本 idea 的契合度：...

### TimeBot 关联（可选）
- 近 4 周分析师 {name} 投入 {x}h，consensus={x}
- 与 IdeaBot ls 一致性：✓ / ✗

## 综合判断

### 论点 vs 证据
（IdeaBot 给的方向和 sizing 背后的假设是否在 wiki 中被证据支撑？列出有证据支撑的点和缺证据的点）

### Bull Case
- ...
- ...

### Bear Case
- ...
- ...

### 关键验证 / 证伪条件
| 条件 | 方向 | 最新状态 | 下一步验证 |
|------|------|----------|-----------|
| ... | Bull | ... | ... |
| ... | Bear | ... | ... |

### 催化剂时间线
- {日期}：{事件}（来源：[[source/xxx]] 或行业页）
- ...

### 风险点
- ...

### sizing / priority 评估
（基于 score / upside / potlPnl / 波动率 / wiki confidence，判断当前仓位建议是否合理）

## 下一步 action（优先级排序）
1. **{最重要的一条}** — {具体 metric / 访谈对象 / 产出页面}
2. ...
3. ...

## 知识缺口
（wiki 缺哪些前置概念 / 对标公司 / 行业框架会阻碍对这条 idea 的判断）

## 引用来源
- [[source/xxx]]
- [[company/xxx]]
- [[industry/xxx]]
- raw/ideabot/{safeName}.json
```

## 边界情况

| 情况 | 处理 |
|------|------|
| `data: null`（未匹配） | 脚本 exit 1；skill 告知用户换关键字重试，不产出报告 |
| 匹配多条 | API 自动返回 updateTime 最新一条，照常处理 |
| wiki 完全无相关页面 | 报告依然生成，但以"wiki 未建档"为核心 gap，下一步 action 聚焦建档 |
| events 为空 | Events 时间线章节写"无事件记录"，其余照常 |
| sector / geo 字段缺失 | 跳过对应 wiki 行业查询，不报错 |

## 重要原则

- **建议必须具体可执行**：杜绝"加强研究""多跟踪"。每条 action 必须指明对象 / 方法 / 产出。
- **以 wiki 为证据锚点**：IdeaBot 给的 score / sizing 是"决策结果"，wiki 是"决策证据"。skill 的核心价值是检查两者是否匹配。
- **方向冲突必须高亮**：IdeaBot `ls` 与 wiki thesis `direction`、与最新 source 观点不一致时，必须在报告中明确标出并分析原因。
- **不评判分析师**：报告是助理视角的综合分析，措辞中性。
- **幂等**：同名 idea 重复运行会覆盖 raw/ 同名 JSON，但 wiki/output 按日期区分，保留历史快照。

## 相关文件

- `scripts/fetch_ideabot.py` — 数据拉取实现
- `raw/ideabot/` — 原始 JSON 归档目录
- `wiki/output/ideabot-*.md` — 历史分析报告
- `skills/analyze-timebot/SKILL.md` — 姐妹 skill，分析维度互补（TimeBot 看"做了什么"，IdeaBot 看"决策栈是什么"）
