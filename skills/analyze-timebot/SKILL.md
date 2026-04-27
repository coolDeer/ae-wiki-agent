---
name: analyze-timebot
description: 拉取并分析团队 TimeBot 周工时记录。从 aecapllc /agent/time-bot/recent-week 获取指定周（默认当前周）所有人的工时条目与周总结，保存到 raw/timebot/{weekOf}.json；随后结合 wiki 内容，为每位分析师生成个性化的工作复盘、研究建议与投资思路，输出到 wiki/output/timebot-{weekOf}.md。
metadata:
  short-description: 拉取 TimeBot 周工时并为每位分析师生成 wiki 联动的研究建议
---

# analyze-timebot

拉取团队 TimeBot 某一周的工作记录，再结合 wiki 中已沉淀的公司 / 论点 / 行业 / 来源信息，**为每位分析师产出一份个性化的复盘与研究建议**。

## 触发方式

- `$analyze-timebot` — 当前周
- `$analyze-timebot 2026-04-17` — 指定周（必须是该周的**周五**日期）

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `$ARGUMENTS` | 否 | 周标识日期 `YYYY-MM-DD`，**必须是周五**；留空默认当前周（即今天之后的最近一个周五，含今天） |

## 依赖

- Python 3 标准库（无 pip 依赖）
- `scripts/fetch_timebot.py`

## 执行步骤

1. **拉取数据**
   - `$ARGUMENTS` 为空：
     ```bash
     python3 scripts/fetch_timebot.py
     ```
   - 有值：
     ```bash
     python3 scripts/fetch_timebot.py $ARGUMENTS
     ```

2. **脚本行为**
   - 调 `GET https://api.aecapllc.com/aecapllc-service/agent/time-bot/recent-week?weekOf={date}`
   - 把完整响应（含 `code` / `data` / `message`）保存到 `raw/timebot/{weekOf}.json`
   - stdout 打印：用户数 / 记录数 / 总工时 / 按分类工时汇总
   - 幂等：重复运行会覆盖同日文件

3. **读取 TimeBot 原始数据**
   - 读 `raw/timebot/{weekOf}.json`
   - 每个 `data[]` 项 = 一位分析师的分组：
     - `userId` / `realName`
     - `weeklySummary` — 该用户当周周总结（每人每周至多一条，可能为 null）
     - `records[]` — 所有工时条目
   - 每条 `records[]`：`category` / `categoryName` / `nameOrTopic` / `consensus` / `oneOnOne` / `attendee` / `hours` / `notes` / `date`（= weekOf）

4. **构建分析师画像（对每一位 `data[]` 项）**

   先在内存中为每位分析师聚合以下信号，再进入下一步：

   | 信号 | 来源 | 用途 |
   |------|------|------|
   | 总工时 / 工时分类分布 | `records[].hours + categoryName` | 判断本周重心（研究 / 评审 / 专家网络 / 会议） |
   | 覆盖标的集合 | `records[].nameOrTopic` 去重 flatten | 对应 wiki 里的公司 / 行业 |
   | 多空倾向 | `records[].consensus` | 与 thesis `direction` 做对照 |
   | 专家访谈对象 | `category=5 (Expert)` 时的 `attendee` | 判断是否值得 ingest 为 source 页 |
   | 周总结 | `weeklySummary` | 分析师自述本周主题 |
   | 会议备注 | `category=11 (Meeting)` 的 `notes` | 识别决策 / 风险信号 |

5. **Wiki 交叉查询（对每位分析师的每个标的）**

   对每个在 `nameOrTopic` 中出现的标的：

   1. **查公司页**：`wiki/company/` 下是否有对应页面（中文名、英文名、ticker 任一命中即可）
      - 有 → 读其 frontmatter（`confidence` / `last_updated` / `tags`）和 `## 核心论点` / `## 风险因素` / `## 催化剂` 章节
      - 没有 → 标记"wiki 尚未建档"
   2. **查论点**：`wiki/thesis/` 下 `target` 指向该公司的 thesis，看 `status` / `direction` / `conviction` 是否与分析师本周方向一致
   3. **查最新来源**：`wiki/source/` 下近 30 天 `entities` 含该公司的页，提炼最新数据点或结构性观察
   4. **查行业页**：若标的属于已建档行业，读 `wiki/industry/` 的关键趋势
   5. **识别差距**：
      - 分析师投入了大量工时但 wiki 无对应页面 → 建议立即建档
      - wiki 有 thesis 但 `last_updated` > 30 天且分析师本周在跟进 → 建议更新
      - 分析师 `consensus` 与 wiki thesis `direction` 冲突 → 高亮为"观点分歧"

6. **为每位分析师生成建议（LLM 思考而不是机械填模板）**

   基于第 4 步的画像和第 5 步的 wiki 交叉结果，对每位分析师独立思考以下问题，落成一段有判断力的建议：

   - **工时配置**：本周工时分布是否合理？是否过度集中在会议 / 行政而研究不足？
   - **研究深度**：他跟进的标的 wiki 沉淀到什么程度了？是停留在数据点还是已形成 thesis？下一步应该补哪一块（商业模式 / 估值 / 催化剂 / 风险）？
   - **反共识机会**：他的 `consensus` 与 wiki / 市场主流观点有没有 expectation gap？值得放大的有哪些？
   - **跨标的串联**：他本周研究的多个标的之间、或与其他分析师研究的标的之间，有没有供应链 / 替代关系 / 共同驱动因子可以联动？
   - **下一步研究思路**（2-4 条具体 action）：
     - 应该做的专家访谈（指定对象类型）
     - 应该追踪的关键数据点（指明 metric）
     - 应该建立或更新的 wiki 页面
     - 应该关注的近期催化剂 / 财报 / 监管节点
   - **知识缺口**：wiki 里他覆盖的领域缺哪些前置概念 / 行业框架 / 对标公司？

   **原则**：建议必须具体、可执行，避免"多做研究""加强跟踪"这种空话。每条建议都应能让分析师下周立刻行动。

7. **输出报告到 `wiki/output/timebot-{weekOf}.md`**

   按下方模板组织。每位分析师一个独立 section；全团队汇总放在开头。

## Category 编码表

| code | name | code | name |
|------|------|------|------|
| 1 | New idea | 8 | Org |
| 2 | Research | 9 | Engagement |
| 3 | Review | 10 | Earnings |
| 4 | Analyst | 11 | Meeting |
| 5 | Expert | 12 | Trxn |
| 6 | Admin | 13 | Port |
| 7 | AI | | |

## 输出约定

- 原始 JSON 落盘：`raw/timebot/{weekOf}.json`（不 ingest 到 `wiki/source/`，TimeBot 是团队内部运营数据，非研究来源）
- 分析报告：`wiki/output/timebot-{weekOf}.md`，中文
- 写完后在 `wiki/index.md` 的"分析输出"区追加一条引用

## 报告模板

```markdown
---
type: output
subtype: timebot-weekly
week_of: {weekOf}
generated_at: {YYYY-MM-DD}
analysts: [张三, 李四, ...]
---

# TimeBot 周复盘与研究建议 — {weekOf}

## 团队总览

- 参与人数 / 总工时 / 分类分布（简短 2-3 行）
- 本周团队研究热点（高频出现的标的 / 行业）
- 交叉覆盖：多位分析师同时研究的标的
- 团队级知识缺口：本周高频出现但 wiki 未建档的标的

## {分析师姓名}

### 本周工作画像
- 工时：{总数}h（Research {x}h / Meeting {y}h / Expert {z}h ...）
- 覆盖标的：[[company/A]]、[[company/B]]、未建档: C
- 周总结（原文节选）：> ...

### Wiki 交叉参照
- [[company/A]]：last_updated={date}，thesis [[thesis/X]] 方向 long，本周 consensus 一致 ✓
- C：**wiki 未建档**，本周投入 {x}h，建议立即建 company 页
- [[thesis/Y]]：> 30 天未更新，分析师本周跟进了相关催化剂，建议更新

### 建议

**工时与优先级**
- {具体判断，如"会议占比偏高，建议下周压缩到 20% 以内腾出深度研究时间"}

**研究深度补齐**
- [[company/A]] 估值章节缺失 → 建议搭一个 DCF / 可比公司框架
- [[company/B]] 竞争格局未覆盖日本市场 → 参考 [[industry/Z]] 补充

**反共识机会**
- {若有 expectation gap，指出具体论点和依据}

**跨标的串联**
- A 和 B 在 {共同驱动因子} 上同向，建议搭一个 [[comparison/A-vs-B]] 框架

**下一步 action（优先级排序）**
1. {具体动作，如"访谈 1 位 X 行业上游供应商，验证 Y 数据点"}
2. {...}
3. {...}

### 知识缺口
- {该分析师覆盖领域 wiki 里缺的前置概念 / 对标 / 行业框架}

---

## {下一位分析师}
...
```

## 边界情况

| 情况 | 处理 |
|------|------|
| 该周无任何记录 | `data: []`，脚本照常落盘空数组，报告"该周无记录" |
| weekOf 非周五 | API 返回空数组；提示用户改用正确周五日期 |
| weekOf 格式非法 | 同上，返回空数组不抛错 |
| 某用户无 weeklySummary | 该用户 `weeklySummary` 为 null，分析时跳过 |

## 重要原则

- **建议必须具体可执行**：杜绝"加强研究""多跟踪"这种空话。每条 action 必须指明对象、方法、产出。
- **以 wiki 为记忆锚点**：判断分析师做得是否到位，标准是"wiki 是否因此更新了有价值的内容"，而不是工时多少。
- **不评判 / 不考核**：这份报告是研究助理视角的建议，不是 KPI 考评。用"建议"而不是"问题"措辞。
- **尊重分析师自述**：`weeklySummary` 是分析师自己的框架，优先围绕它展开而不是另起炉灶。
- **缺数据就说缺**：如果某分析师本周只有 Meeting / Admin 条目，没有研究信号，直接说"本周无研究产出可分析"，不要硬凑建议。

## 相关文件

- `scripts/fetch_timebot.py` — 数据拉取实现
- `raw/timebot/` — 原始 JSON 归档目录
- `wiki/output/timebot-*.md` — 历史周复盘报告
