---

## name: ae-research-ingest
description: 把 raw_files 中待处理的研究素材 ingest 进 wiki。Triage 流程：peek → 三选一 (commit 深 source / brief 轻量前沿 / pass 噪声) → write → finalize。Agent 当 LLM，core 只做确定性落库。
metadata:
  short-description: Triage + 三段式 ingest（agent 写 narrative）

# ae-research-ingest

把 `raw_files` 里的研究素材加工成 wiki page。**先 triage 再 ingest** —— 不是所有素材都值得深 ingest，也不是所有素材都该被丢弃。

## 设计哲学

**core 不调 LLM**：`ae-wiki-agent` 的 ingest 主路径全是确定性 SQL / 正则 / YAML 解析。
**理解原文是 agent 的事**：agent（Codex / runtime）读 raw markdown → 三分判定 → 套对应模板写 narrative → 落库。

为什么三分：

- raw 来源参差（Daiwa 研报 / 长 tweet thread / @xx Thanks 噪声 / chat 散点纪要）
- 一刀切走 7 段 source 模板：短素材塞不满，agent 编造或大段标"无"
- 一刀切 pass 掉 twitter：丢失值得留痕的前沿动态（AI 工具 / 行业八卦 / 算力新闻）
- 三分让每类素材有合适的归宿

## 触发方式

- 显式：`$ae-research-ingest`（默认处理 1 篇）
- 显式：`$ae-research-ingest 5`（一次跑 5 篇）
- 自然语言：「帮我 ingest 今天的研报」「过一下今天 fetch 的素材」

---

## 流程总览

```
ingest:peek
  ↓ 看预览，三选一：
  ├─ 核心投资素材    → ingest:commit  → write (7 段 source 模板) → finalize
  ├─ 前沿动态弱相关  → ingest:brief   → write (4 段 brief 模板)  → finalize
  └─ 真噪声          → ingest:pass --reason "..."   (停止)

兜底：commit/brief 后才发现不对 → ingest:skip <pageId> --reason "..."
```

---

## Step 1: Peek 看预览

```bash
cd ae-wiki-agent && bun src/cli.ts ingest:peek
```

返回 JSON（**不写库**）：

```json
{
  "rawFileId": "6",
  "markdownUrl": "https://aecapllc.s3.../xxx.md",
  "title": "...",
  "researchType": "twitter",
  "rawCharCount": 9112,
  "preview": "...前 1500 字...",
  "hasContentListV2": true,
  "v2Stats": {
    "pageCount": 26,
    "blockCount": 247,
    "tableCount": 17,
    "titleCount": 11,
    "topLevelSections": ["¶ 本周板块观点", "¶ 前沿趋势", "¶ 海外", ...]
  },
  "warning": null
}
```

返回 `null` 时表示没有待处理 raw_file，结束本轮。

**用 `v2Stats` 辅助 triage**（0 阅读量也能粗判）：


| 信号                                             | 解读                                            |
| ---------------------------------------------- | --------------------------------------------- |
| `pageCount >= 10` + `tableCount >= 3`          | 大概率是数据型研报/周报 → **commit**                     |
| `pageCount = 1` + `titleCount <= 3`            | 短素材（tweet / chat 散点）→ 通常 **brief** 或 **pass** |
| `topLevelSections` 含 `Q&A`、`专家观点`、`Earnings` 等 | 深度访谈 → **commit**                             |
| `tableCount = 0` + `pageCount = 1`             | 文字流动态 → 看 preview 决定 brief / pass             |


`**hasContentListV2: false` 的处理**：上游 mineru 没产出 V2，commit 会在 stage-2 失败。直接 `ingest:pass <id> --reason "V2 缺失"` 跳过；运维介入修上游后重启 ingest 流程。

> ⚠️ raw 正文不再落本地。peek 已经把全文 fetch 过一次（CLI 进程内已缓存）；
> agent 端如要看完整原文，直接打开 `markdownUrl` 读取；短素材通常只看 `preview` 就够。

---

## Step 2: 三分判定

读 `preview`（短素材够用），或对长素材直接打开 `markdownUrl` 读全文，按下表判定：

### 判定矩阵


| 类型              | 走        | 典型 researchType                                                                                                                      | 启发式                                                                     |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **核心投资素材**      | `commit` | `meeting_minutes`, `aletheia`, `scuttleblurb`, `acecamp_article`, `vital_knowledge`, `chat_brilliant`, `substack`, `acecamp_opinion` | 含具体公司/ticker / 财务数据 / 行业判断 / 估值讨论；研究员可直接据此调仓                            |
| **前沿动态（brief）** | `brief`  | `twitter`（部分）                                                                                                                        | 提到 AI / 模型 / 工具 / 平台动向，与投资**有边际信号但无 actionability**；产品发布、技术突破、行业八卦、模型对比 |
| **真噪声**         | `pass`   | `twitter`（多数）                                                                                                                        | 纯个人推广、感谢回复、自我营销、跟金融/科技/产业完全无关（如生活段子）                                    |


### 边界判断口诀

- **只要能给某 company / industry / thesis 留下明确边际信息，就优先不 pass**
  - 能，但信息密度不够深 source → **brief**
  - 能，而且足以支撑 7 段 source 模板 / 后续会反复被引用 → **commit**
  - 只有完全无研究价值 → **pass**
- **有没有可量化的数字 / 财务事件 / 估值讨论？**
  - 有 → 倾向 commit（值得抽 facts）
  - 无 → brief 即可
- **PM 半年后翻回来会觉得有用吗？**
  - 是 → 至少 brief
  - 否 → pass

### 灰区处理

不确定 commit 还是 brief 时**默认走 brief**（轻量、低成本、不污染 source 池）。

不确定 brief 还是 pass 时也**默认走 brief**。`pass` 只留给以下情形：

- 纯个人推广 / 感谢回复 / 自我营销
- 与金融、科技、产业研究完全无关
- 没有任何可沉淀到 `company / industry / thesis` 的边际信息

换句话说：

- `pass` 要非常保守
- `brief` 是默认缓冲层
- 日后觉得 brief 值得 deep dive，可以再补一个 source page 引用 brief

---

## Step 3a: Pass（跳过）

```bash
cd ae-wiki-agent && bun src/cli.ts ingest:pass <rawFileId> --reason "<简短说明>"
```

reason 必填，建议格式：「非投资素材：xxx」/「纯个人推广」/「重复 source 已 ingest」。
不建 page，只标 `raw_files.skipped_at` + `skip_reason`，可审计。

→ 回到 Step 1 处理下一份。

---

## Step 3b: Commit（核心投资素材，走 source 模板）

```bash
cd ae-wiki-agent && bun src/cli.ts ingest:commit <rawFileId>
```

返回 `{pageId, markdownUrl, ...}`，type='source'，slug 前缀 `sources/`。

### Source narrative 模板（7 段必填）

**Write the final narrative in English.** Keep ticker symbols, accounting terms, and product names in their standard English forms. Chinese may appear only inside direct quotes, aliases, or source titles when necessary.

**Add a YAML frontmatter block at the top of every source narrative.** At minimum, include `tags` and `view_side`.

```markdown
---
tags: [semiconductor, memory]
view_side: neutral
---

## Source Overview
（一段话总结：主题 / 调研对象 / 关键时点）

## Key Takeaways
（3-7 条编号列表，每条引用具体数据。覆盖维度：
  1. 核心数据和变化（价格、产能、增速等定量信息）
  2. 关键判断与观点（即使没有具体数字）
  3. 行业参与者的行为模式（结构性观察容易被忽略，但对判断行业拐点至关重要）
  4. 与市场共识不同的观点（expectation gap）
  5. 时效性信号（前瞻指引、超预期 / 低于预期））

## Important Data Points
（表格优先：指标 | 数据 | 备注 | 来源）

## Notable Quotes / Views
（blockquote 保留原文。优先收录：管理层表态、专家对结构性问题的判断、反直觉观点）

## Structural Observations
（非数字型的长期判断 —— 竞争对手行为模式 / 行业参与者心态变化 / 长期趋势的早期信号。
**此章节不得省略**，没有则写"None."）

## Relation To Existing Knowledge
### New Information
### Confirms Existing View
### Contradictions / Revisions
（写之前先用 search 工具查 wiki 里已有的相关公司/行业页，建立交叉引用）

## Follow-ups
```

#### 结构化附录：`facts` 走 comment block，`timeline` 走独立尾段

`facts` 现在仍然由 Stage 5 从 `pages.content` 里直读 `<!-- facts ... -->` block。

`timeline` 不再写成 `<!-- timeline ... -->` 包裹块。当前代码会把 `<!-- timeline -->` 之后的整段正文切进 `pages.timeline`，再由 Stage 7 把它解析成 YAML 数组。

```markdown
<!-- facts
- entity: companies/<slug>
  metric: revenue | ebit | eps_non_gaap | target_price | gross_margin | ...
  period: FY2027E | 1Q26A | current | YYYY-MM-DD
  value: <number>
  unit: usd_m | pct | x | usd | cny_bn
  source_quote: "<原文片段>"
-->

<!-- timeline -->

- entity: companies/<slug>
  date: 2026-04-15
  event_type: earnings | guidance | rating_change | product_launch | news | other
  summary: <一句话>
```

### Source 写作约束

- `view_side`（frontmatter，必填）：
  只允许四个值：`buy_side | sell_side | neutral | unknown`
- `view_side` 必须**根据内容和 framing 判断**，不要按 `research_type` 机械映射
- `research_type` 只能作为弱提示，不能作为最终依据
- 判断优先顺序：
  1. 先看文章本身的写法、立场、受众、结论结构
  2. 再看来源机构 / publisher / 是否是 broker-style note
  3. 仍不确定就写 `unknown`
- `view_side` 不是质量评分，而是**观点位置标签**：
  - `sell_side`：broker / analyst coverage / target price / model-update 风格材料
  - `buy_side`：基金 / PM / 内部研究 memo 风格材料
  - `neutral`：原始披露、数据看板、客观纪要、事实型汇编，不明显偏 buy/sell side
  - `unknown`：无法从 `research_type` 和内容可靠判断
- 实操判断：
  - 明显是评级、目标价、coverage、模型更新、broker audience → `sell_side`
  - 明显是投资者 / PM / 内部研究 memo 口吻 → `buy_side`
  - 更像原始信息、数据看板、纪要整理、事实汇编 → `neutral`
  - 看不出来、证据不够 → `unknown`
- `facts`：
只写原文**明确给出的**数字、口径、估值、指引，不要把你的推断塞进 fact。
- `timeline`：
只写**明确的离散事件**，例如业绩披露、指引更新、评级调整、产品发布、已发生的会议/管理层表态。
- 如果只有结构性判断、没有明确事件日期：
写进 `## 结构性观察`，**不要**硬编 timeline。
- 如果没有可抽取 fact：
`facts` 块可以省略，但对深度 source 来说通常说明提炼还不够，先回头检查一遍原文。
- 如果没有明确 timeline 事件：
`<!-- timeline -->` 整段都省略。

---

## Step 3c: Brief（前沿动态，走轻量模板）

```bash
cd ae-wiki-agent && bun src/cli.ts ingest:brief <rawFileId>
```

返回 `{pageId, markdownUrl, ...}`，type='brief'，slug 前缀 `briefs/`。

### Brief narrative 模板（精简 4 段，50-300 字）

**Write the brief in English.** Keep it compact, link-rich, and easy to skim.

**顶部必须有 YAML frontmatter**（被 stage3 自动解析合并到 `pages.frontmatter`）：

```markdown
---
tags: [ai-frontier, llm-tooling, anthropic-ecosystem]
view_side: unknown
url: https://x.com/xxx/status/...
platform: twitter
---

## TL;DR
<一句话摘要，含主要 wikilink>

## Key Observations

- <要点 1，能用 wikilink 就用：[[industries/AI]] / [[companies/OpenAI]]>
- <要点 2>
- <要点 3>
（最多 5 条）

## Investment View
<这条动态如果对某个 thesis / industry / company 有边际信号，写 1-2 句；
没有就省略本段或写"无 actionability，watchlist">

## Links
- Original: <URL>（与 frontmatter.url 一致）
- Platform: twitter / substack / ...
```

### Brief 写作约束

- `view_side`（frontmatter，必填）：
  只允许 `buy_side | sell_side | neutral | unknown`
  对 brief 来说，大多数材料应为 `neutral` 或 `unknown`；只有非常明确的 broker / internal-investor 视角才写 `sell_side` / `buy_side`
- **不强制** `facts` / `timeline` 附录（短素材抽 fact 易污染）—— 没有就别写
- **wikilink 仍需要**：让 brief 加入图谱，未来 `[[companies/Anthropic]]` 可反向找到
- 长度控制在 ~60-180 English words，宁少勿多
- frontmatter tags 表达"我关注的主题"（`ai-frontier`, `newsletter`, `llm-tooling` 等）

---

## Wikilink 纪律（写 narrative 前必读）

写 narrative 时所有 `[[dir/slug]]` 都会被 stage-4 抽取入 `links` 表。**slug 写错的代价不对称**——选错前缀会污染图。

### 1. 红链分两类：能 auto-create 的 vs 不能的


| Wikilink 类型                                                   | 红链行为                                                                     | 你应该怎么做                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------ |
| `[[companies/X]]` `[[concepts/X]]` `[[industries/X]]`         | stage-4 **自动建 stub**（confidence='low'），enrich 队列后续补                      | 直接写。新实体被发现是 enrich 流程的入口 |
| `[[sources/X]]` `[[theses/X]]` `[[outputs/X]]` `[[briefs/X]]` | stage-4 **拒绝 auto-create**，只记 `events.action='wikilink_unresolved'`，链不入库 | **必须先验证存在**，否则改写成纯文本     |


第二类的设计原因：source 页只能由 `ingest:commit/brief` 建，thesis 页只能由 `thesis:open` 建，outputs 由 daily-* 建——agent narrative 里手写这种 wikilink 通常是凭直觉猜 slug，slug 错了会落一堆孤儿空 source/thesis 页。

**禁用通配符 / 占位符语法**：`[[companies/*]]`、`[[companies/<name>]]`、`[[companies/?]]` 这种**不是合法 wikilink**——slug 里的 `* ? < > | : \ "` 都是 CLAUDE.md slug 规则禁止的字符（stage-4 会静默丢弃这种 ref）。要表达"还需建若干 company stub"用纯文本：

- ✅ `Recommend follow-up: extract company-specific mentions (Tianbang, TRS, Jinxinnong) and create stubs.`
- ❌ `create/confirm [[companies/*]] stubs ...`（事故案例：narrative-1 真这么写过，建了个 `companies/`* 空 stub）

### 2. 写 `[[sources/X]]` 或 `[[theses/X]]` 之前必查

两种验证方式（任选）：

**方式 A：`resolve_wikilink` MCP 工具（推荐）**

```
mcp__ae-wiki__resolve_wikilink({
  hint: "h200 csp channel check",   // 自由文本 hint（英中皆可）
  type: "source"                     // 限定 type，匹配更准
})
```

返回最多 5 个候选 + `advice` 字段，告诉你要不要直接用 best_match：

- `confident match` → 用候选 `slug` 写 wikilink
- `low-confidence matches` → 调 `get_page` 进一步确认再用
- `no match found` → **改写成纯文本**，不要写成 wikilink

**方式 B：`search` 工具兜底**

```
mcp__ae-wiki__search({ query: "H200 channel check", type: "source", keyword_only: true })
```

### 3. Aspirational thesis 只能用纯文本

写 `## Follow-ups` 段时构想"未来想 open 的论点"——**不要**写成 `[[theses/X]]` wikilink（即便 stage-4 现在会拒绝建，也不要让坏习惯进 narrative）。改写成：

```markdown
- Build thesis: AWS-AI-reacceleration — long AMZN with conviction triggers on (a) ...
```

真要 open thesis 时显式跑 `thesis:open --target ... --name ...`，建好后再回填 wikilink。

### 4. 类型推断：companies/ vs concepts/

**写 wikilink 前先想 type**。常见错误：

- `[[companies/Trainium]]` ❌ Trainium 是 [[companies/Amazon]] 的产品 → 应当写 `[[concepts/Trainium]]` 或就用 `[[companies/Amazon|AWS Trainium]]`
- `[[companies/HBM3E]]` ❌ HBM 是内存技术 → `[[concepts/HBM3E]]`
- `[[companies/CoWoS]]` ❌ 封装技术 → `[[concepts/CoWoS]]`

判断规则：**会出现在公司列表里的实体才是 company**（有股东、有营收、能上市）。芯片 / 协议 / 技术 / 工艺 / 产品线都是 concept。

### 5. wikilink slug 跟 fact entity slug **必须 case 一致**

narrative 内不能这样：

```markdown
正文：[[industries/Hog-Farming]] 行业...

<!-- facts
- entity: industries/hog-farming    ❌ 跟正文 wikilink case 不一致
  metric: ...
-->
```

**事故案例**：page #1 的 narrative 正文写 `[[industries/Hog-Farming]]`（大写），fact YAML 写 `entity: industries/hog-farming`（小写）。Stage 4 建了 #6 `industries/Hog-Farming`，Stage 5 没找到精确匹配又建了 #7 `industries/hog-farming` —— 两个 page 同实体，互不知情。

**规则（必守）**：

- 同一份 narrative 内，wikilink 的 slug 和 fact YAML / timeline YAML 的 entity slug 必须**逐字符一致**
- 推荐用 **kebab-case 小写**作为 slug 标准格式（`companies/jingdong-mall`、`industries/hog-farming`、`concepts/hbm3e`）
- 公司名用**可读名**（中文或英文），**不要**用 ticker / stock code（详见 §6）
- 中文 entity 直接用中文（`industries/半导体`），不用拼音
- **不要**为了"看起来好看" capitalize 词首字母（`Hog-Farming` 反而不利于匹配）

**为什么这条比 wikilink 纪律更严格**：stage-4 / stage-5 / stage-7 用同一个 helper 做实体查找，case 不一致会绕过 alias dedupe 机制（虽然 helper 现在做了大小写不敏感处理，但跨 page 间的 case 不一致还是会被你自己 narrative 看到时困扰）。

### 6. ticker / stock code **不能**当 slug

**不要写 `[[companies/300750.SZ]]` / `[[companies/AAPL]]` / `[[companies/3931.HK]]`**——ticker 不是公司名，是该公司的某个市场代码。多重上市的公司一票多 ticker，把 ticker 当 slug 会建出 N 个相同实体的 page。

正确写法：

| ❌ 错（agent 实际撞过事故）| ✅ 对 |
|---|---|
| `[[companies/300750.SZ]]` | `[[companies/CATL]]` 或 `[[companies/宁德时代]]` |
| `[[companies/002594.SZ]]` | `[[companies/BYD]]` |
| `[[companies/AAPL]]` | `[[companies/Apple]]` |
| `[[companies/3931.HK]]` | `[[companies/CALB]]` |

**ticker 的归宿**：
- enrich:save 时通过 `--ticker 300750.SZ` 写到 `pages.ticker` 列
- 多重上市的多 ticker 都填到 `pages.aliases`（`["300750.SZ", "Contemporary Amperex Technology", "宁德时代"]`）

**Stage 4 已加 guard**：narrative 里写 ticker-like wikilink（`\d{3,6}\.(SZ|SH|HK|TW|TO|JP|KS)` 或 `^[A-Z]{1,5}$`）会被静默丢弃 + 控制台 warning。所以即使 agent 一时手快写了 ticker wikilink，stage-4 也不会建出错的 stub。

**事故案例**：钠离子电池调研 narrative 一行写了 6 个 ticker wikilink（CATL/BYD/EVE/CALB/Gotion/Sunwoda 全是 `[[companies/<ticker>]]` 形式），建出 6 个 ticker-slug 的空 stub。修复 = 重 retype + 移 ticker 到 ticker 列。

### 7. 没有 `persons/` 这个 type

**不要写 `[[persons/X]]`**——这个 type 已被废弃。CEO / CFO / 高管 / 创始人的信息应当：

- 写在所属公司的 `[[companies/X]]` narrative 或 frontmatter.management 字段里
- 高管引言放在 source 页的 `## Notable Quotes / Views`，引用时用 `Andy Jassy（[[companies/Amazon]] CEO）`
- 匿名专家（"北美广告专家A"）只出现在 source 正文，不需要建实体页

### 8. 出错怎么办

不小心写了不存在的 `[[sources/X]]`，stage-4 不会建空 page，但 `events` 表会留 `wikilink_unresolved` 记录（含 trgm 相似度建议）。Lint：

```sql
SELECT payload->>'slug' AS bad_slug, payload->'suggestions'->0->>'slug' AS suggested
FROM events WHERE action = 'wikilink_unresolved' AND deleted = 0
ORDER BY ts DESC LIMIT 20;
```

修复路径：根据 suggested 改 narrative 里的 wikilink → 重跑 `links:re-extract <pageId>`。

---

## Frontmatter 字段白名单（写 frontmatter 前必读）

`pages.frontmatter` 是 JSONB —— **stage-3 不做 schema 校验**，agent 写什么 key 都会落库。这意味着 agent 自创字段是真实风险（事故案例：narrative-146 / -152 自创 `authors: ['久谦 / AceCamp']`，但原文 0 处提及"久谦"，纯属凭模式记忆瞎编）。

**规则：narrative frontmatter 只能用以下白名单 key，禁止自创。**

### Source 页（`type='source'`）允许的 frontmatter key


| Key             | 谁写入             | 用途                                                                               | 备注                                                                               |
| --------------- | --------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `tags`          | agent           | 主题标签数组（小写英文，短横线分隔）                                                               | 同时被 web UI 和 search 消费                                                           |
| `view_side`     | agent           | 观点位置标签：`buy_side`, `sell_side`, `neutral`, `unknown`                                 | **必填**；供 daily-review Q7 聚合偏见结构使用                                                |
| `research_id`   | **stage-1 自动写** | 上游 mongo `_id`                                                                   | agent 不要重写                                                                       |
| `research_type` | **stage-1 自动写** | 上游 type（`acecamp_article` / `merit` / `meeting_minutes` / `semi_analysis` / ...） | agent 不要重写；web UI 读这个字段渲染                                                        |
| `markdown_url`  | **stage-1 自动写** | 解析后 markdown S3 直链                                                               | agent 不要重写；fetch raw 用                                                           |
| `publish_date`  | **stage-1 自动写** | 上游 `mongo_doc.createTime` 的 `YYYY-MM-DD`                                         | agent 不要重写。原文里若有更精确的发布日，写在 `## Source Overview` 叙事里                              |
| `original_url`  | **stage-1 自动写** | 上游 `mongo_doc.reportUrl`（原始 PDF / docx）                                          | agent 不要重写。区别于 markdown_url 是解析后的                                                |
| `file_type`     | **stage-1 自动写** | `pdf` / `docx` / `pptx` ...（来自 `mongo_doc.detectedFileType` / `finalType`）       | agent 不要重写                                                                       |


**Stage-1 已自动写入 7 个字段**（`title` / `research_id` / `research_type` / `markdown_url` / `publish_date` / `original_url` / `file_type`）。对 source 页，`pages.title` 一律直接使用 `raw_files.title`。agent 只需要专注 `tags` 和 `view_side`。**不要在 narrative frontmatter 里重写这些自动字段**——重写会盖掉准确值。

### Brief 页（`type='brief'`）允许的 frontmatter key


| Key          | 谁写入       | 用途                                                                                                         | 备注                                 |
| ------------ | --------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `tags`       | agent     | 同上                                                                                                         | 必须                                 |
| `view_side`  | agent     | 观点位置标签：`buy_side`, `sell_side`, `neutral`, `unknown`                                | 必须                                 |
| `url`        | agent     | 原始 URL（同正文 `## Links` 段一致）                                                                                 | 必须；web UI 渲染为可点链接                  |
| `platform`   | agent     | `twitter` / `substack` / `chat` 等                                                                          | 必须                                 |
| stage-1 自动字段 | stage-1   | 同 source（`research_id` / `research_type` / `markdown_url` / `publish_date` / `original_url` / `file_type`） | agent 不要重写                         |


### Entity 页（`company` / `concept` / `industry` / `thesis`）允许的 frontmatter key


| Key          | 谁写入              | 用途                                                                        | 备注                        |
| ------------ | ---------------- | ------------------------------------------------------------------------- | ------------------------- |
| `title`      | agent（可选）        | 通常等于 slug 末段；要改名时写这个                                                      | stage-3 同步到 `pages.title` |
| `management` | agent（仅 company） | CEO / CFO 映射，例 `management: { ceo: 'Andy Jassy', cfo: 'Brian Olsavsky' }` | 替代独立 person 页             |


其他字段（`ticker` / `sector` / `aliases` / `confidence` 等）通过 `enrich:save` 的 CLI flag 写入 pages 表的对应列，不进 frontmatter。

### `title` 规则（source / brief）

对 `source` 和 `brief`，标题一律直接使用上游 `raw_files.title`。

- agent **不要**在 frontmatter 里写 `title`
- agent **不要**清洗、改写、缩短、翻译标题
- 标题如果看起来脏、长、带日期前缀，也先保留原值

一句话理解：

- `raw_files.title` = source / brief 的正式标题
- `frontmatter.title` 不属于 source / brief 的可写字段

### 禁止的字段（曾被 agent 自创过）

- ❌ `authors` —— 原文里**有**作者署名时，写在 `## Source Overview` 第一段叙事里。原文里**没有**就不要写。raw_files / mongo_doc 上游也不带 author 字段，没有 ground truth。
- ❌ `source_type` —— `pages.type` 列已经标了；不要在 frontmatter 重复
- ❌ `category` / `topic` / `subject` —— 用 `tags` 表达
- ❌ `publish_date`（agent 手写）—— stage-1 自动从 `mongo_doc.createTime` 写了；agent **重写就覆盖了准确值**
- ❌ `research_type` / `markdown_url` / `research_id` / `original_url` / `file_type`（agent 手写）—— 同上，stage-1 已自动填
- ❌ 任何中文 key —— frontmatter key 必须是英文 snake_case

### 添加新字段的流程

如果发现 raw_files / mongo_doc 里有新的有用字段（例如未来上游加了 `analyst_team` 或 `target_company`），**不要在 narrative frontmatter 里手写**。改 `src/skills/ingest/stage-1-skeleton.ts` 让 stage-1 自动拉取，再来更新这份白名单。原则：**结构化字段必须有 ground truth 来源**，要么是上游 raw_files，要么是 CLI flag（`enrich:save --ticker`），不能由 agent 凭空填。

### 出错怎么办

老 page 已经有 frontmatter 自创字段（如 `authors`），用 SQL 显式删除：

```sql
UPDATE pages
SET frontmatter = frontmatter - 'authors' - 'source_type' - 'publish_date'
WHERE id = <pageId>;
```

### 为什么这条纪律重要

1. **没有任何系统层护栏** —— stage-3 的 `gray-matter` parser 接受任何 YAML key，JSONB merge 接受任何 key
2. **search / facts / signals 都不读未文档化字段** —— 自创的 `authors: 久谦` 写下去是死字段，没人读，但污染了 page versions 历史
3. **schema 漂移是单向不可逆的** —— 一旦不同 page 自创了不同 key，未来任何想标准化字段（"我想读所有页的 publisher"）都要先扫一遍清理
4. **Agent hallucination 在没有 ground truth 验证时会持续** —— 这是 agent 行为问题，工具拦不住，只能靠纪律

---

## Step 4: Write（落库 narrative）

source 和 brief 共用同一个 write 命令。三种入口任选：

```bash
# A. --file 标志（推荐）：先写文件再读
bun src/cli.ts ingest:write <pageId> --file raw/narrative-<pageId>.md

# B. heredoc：短素材直接行内
cd ae-wiki-agent && bun src/cli.ts ingest:write <pageId> <<'EOF'
<narrative 全文>
EOF

# C. stdin redirect：兼容老用法
bun src/cli.ts ingest:write <pageId> < /tmp/narrative.md
```

---

## Step 5: Finalize（跑 Stage 4-8 派生）

```bash
cd ae-wiki-agent && bun src/cli.ts ingest:finalize <pageId>
```

跑：

- Stage 4 链接抽取（wikilinks → links 表，红链自动建 entity page）
- Stage 5 facts 抽取（直读末尾 YAML 块）
- Stage 6 异步 jobs 入队（embed_chunks / detect_signals）
- Stage 7 timeline 抽取（读取 `pages.timeline`，解析 `<!-- timeline -->` 之后的 YAML 数组）
- Stage 8 thesis 关联（active thesis 命中 → 写 signal）

source 和 brief 都跑同样的 5 个 stage —— brief 通常 facts/timeline 段无产出，是预期。

### 断点续跑

每个 stage 成功后写 `events.action='ingest_stage_done'`；失败写 `ingest_stage_failed`。
重跑同一个 pageId 时，**已完成的 stage 自动跳过**：

```bash
# Stage 5 崩了，修了 bug，直接重跑：
bun src/cli.ts ingest:finalize <pageId>
# 输出：[stage4] skipped (已完成；用 --from 4 强制重跑)
#      [stage5] running...
```

强制从某 stage 起重跑（覆盖已完成判断）：

```bash
bun src/cli.ts ingest:finalize <pageId> --from 5    # stage 5..8 都重跑
bun src/cli.ts ingest:finalize <pageId> --from 4    # 全量重跑
```

适用场景：stage 实现升级想批量回填、怀疑某 stage 数据有 bug、上次 markIngested 失败需重置。

---

## 完整范例

### 范例 A：Twitter brief

```
[agent]
1. bun src/cli.ts ingest:peek
   → {rawFileId: 6, title: "I finally got around...", researchType: "twitter", preview: "..."}

2. 看 preview：讲 Claude Skill 推广，提到 AI 编程工具趋势 + GPT-5.5
   判定 → brief（弱投资相关，但值得记录 AI 编程工具复杂度上升信号）

3. bun src/cli.ts ingest:brief 6
   → {pageId: 21, ...}

4. （可选）打开 `markdownUrl` 看完整原文
   search "Anthropic Skill" 看 wiki 已有页

5. 写 brief narrative（4 段精简） → /tmp/brief-21.md
   bun src/cli.ts ingest:write 21 < /tmp/brief-21.md

6. bun src/cli.ts ingest:finalize 21
   → 4 个红链自动建 (Jeffrey Emanuel / Anthropic / industries/AI 编程工具 / concepts/...)
```

### 范例 B：Meeting minutes 深 ingest

```
[agent]
1. bun src/cli.ts ingest:peek
   → {rawFileId: 14, title: "Updates on Domestic GPUs", researchType: "meeting_minutes", preview: "..."}

2. 看 preview：含具体公司名 / 产能数据 / 行业判断 → commit（核心投资素材）

3. bun src/cli.ts ingest:commit 14
   → {pageId: ..., ...}

4. 打开 `markdownUrl` 完整阅读
   search "国产 GPU" / "昇腾" / "寒武纪" 查 wiki 已有页

5. 写 source narrative（7 段 + `facts` block + 可选 `<!-- timeline -->` 尾段） → /tmp/narrative.md
   bun src/cli.ts ingest:write <pageId> < /tmp/narrative.md

6. bun src/cli.ts ingest:finalize <pageId>
```

### 范例 C：纯噪声 pass

```
[agent]
1. bun src/cli.ts ingest:peek
   → {rawFileId: 4, title: "BREAKING Someone made Whisper...", researchType: "twitter"}

2. 看 preview：开源工具推广，跟投资完全无关 → pass

3. bun src/cli.ts ingest:pass 4 --reason "非投资素材：开源工具推广 tweet"
```

---

## 兜底：commit/brief 后才发现不对

如果 commit/brief 之后发现内容其实是噪声，用 `ingest:skip` 清理（软删 page + 标 raw_file skipped）：

```bash
bun src/cli.ts ingest:skip <pageId> --reason "..."
```

注意：这跟 pass 的区别 —— pass 只标 raw_file（没建 page），skip 会软删已建的 page。优先 pass。

---

## 升级：brief → source

如果一篇 brief 在写完后被发现值得深度处理（reading 后觉得信息密度足够支撑 7 段 source 模板），用 `ingest:promote` 把它升级：

```bash
bun src/cli.ts ingest:promote <pageId>
```

这一步只切换 **元数据**：

- `page.type` `brief` → `source`
- `page.slug` `briefs/...` → `sources/...`
- `raw_files.triage_decision` `brief` → `commit`
- 老的 `ingest_stage_done` events 软删（让 finalize 全 stage 重跑）

之后 agent 必须做的两件事：

```bash
# 1. 用 7 段 source 模板重写 narrative
bun src/cli.ts ingest:write <pageId> --file <path-to-7段.md>

# 2. 跑 finalize（自动从 stage 4 开始全跑，因为 stage_done 已软删）
bun src/cli.ts ingest:finalize <pageId>
```

**注意事项**：

- 已 ingest 的 chunks / facts / links 不会自动清理；finalize 重跑时会以新 narrative 重新抽取，但残留数据要靠 stage 内部 dedupe 处理（precedent: facts:re-extract / links:re-extract）
- 反向（source → brief）当前不支持。深度处理过的内容不应回退
- promote 之后 wikilink 文本可能仍是 `[[briefs/...]]`，但 links 表用 page_id 关联，不会断；只是显示文本可能略陈旧

---

## 完成后建议链式触发

按 `CLAUDE.md` 的工作流：

- **建议 `$ae-daily-review`**：对今天 ingest 的增量做 epistemic 复盘
- **建议 `$ae-daily-summarize`**：把复盘转成 PM operational 简报

---

## 故障排查


| 症状                             | 原因                                      | 解决                                                                                          |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ingest:peek` 返回 null          | 没有 pending raw_file                     | 先跑 `$ae-fetch-reports`；或检查 `WHERE deleted=0 AND ingested_at IS NULL AND skipped_at IS NULL` |
| `ingest:commit` 报"已 ingest"    | rawFile 已被 ingest                       | 不能重复 commit；要重做需先撤销 `ingested_at`                                                           |
| `ingest:commit` 报"已被跳过"        | rawFile 已 pass                          | 撤销 `skipped_at` 后再 commit                                                                   |
| `ingest:write` 报 stdin 为空      | 忘记管道 / heredoc                          | 检查命令拼写                                                                                      |
| Stage 5 抽 0 fact（source 页）     | `facts` block 漏写或格式错                    | 检查 `<!-- facts` 是否在新行开头、是否是 YAML 数组                                                         |
| Stage 7 抽 0 timeline（source 页） | `timeline` 写成旧的 comment block，或根本没有明确事件 | 检查是否用了 `<!-- timeline -->` sentinel；没有明确离散事件时 0 timeline 也可能正常                              |
| Stage 5 抽 0 fact（brief 页）      | **正常**                                  | brief 不强制 YAML，0 fact 符合预期                                                                  |
| Stage 4 创建一堆红链 entity          | wikilink slug 写错 / 还没建过                 | autoCreate=true，红链 confidence='low'，靠 enrich 补全                                             |
| 不确定 commit 还是 brief            | 灰区                                      | 默认 brief（轻量、低成本）                                                                            |


---

## Write 前自检

在执行 `ingest:write` 前快速过一遍：

- 这篇素材的归类对吗：`commit / brief / pass`
- 首次提到的重要实体是否加了 wikilink
- source 页是否真的写出了 `## 结构性观察`，而不只是数字摘录
- `facts` 是否只包含原文明示信息
- `timeline` 是否只包含有明确日期的离散事件
- brief 是否足够短，没有硬凑成 source

---

## 不在本 skill 范围

- raw 文件的去重、平台拉取 → `$ae-fetch-reports`
- entity 元数据补全（公司信息 / 市值）→ `$ae-enrich`
- 论点状态机维护 → `$ae-thesis-track`
- brief 升级为 source（需要二次 ingest 同一份 raw）→ 暂未支持，撤销 ingest 后重跑
