---
name: ae-research-ingest
description: 把 raw_files 中待处理的研究素材 ingest 进 wiki。Triage 流程：peek → 三选一 (commit 深 source / brief 轻量前沿 / pass 噪声) → write → finalize。Agent 当 LLM，core 只做确定性落库。
metadata:
  short-description: Triage + 三段式 ingest（agent 写 narrative）
---

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

| 信号 | 解读 |
|---|---|
| `pageCount >= 10` + `tableCount >= 3` | 大概率是数据型研报/周报 → **commit** |
| `pageCount = 1` + `titleCount <= 3` | 短素材（tweet / chat 散点）→ 通常 **brief** 或 **pass** |
| `topLevelSections` 含 `Q&A`、`专家观点`、`Earnings` 等 | 深度访谈 → **commit** |
| `tableCount = 0` + `pageCount = 1` | 文字流动态 → 看 preview 决定 brief / pass |

**`hasContentListV2: false` 的处理**：上游 mineru 没产出 V2，commit 会在 stage-2 失败。直接 `ingest:pass <id> --reason "V2 缺失"` 跳过；运维介入修上游后重启 ingest 流程。

> ⚠️ raw 正文不再落本地。peek 已经把全文 fetch 过一次（CLI 进程内已缓存）；
> agent 端如要看完整原文，直接打开 `markdownUrl` 读取；短素材通常只看 `preview` 就够。

---

## Step 2: 三分判定

读 `preview`（短素材够用），或对长素材直接打开 `markdownUrl` 读全文，按下表判定：

### 判定矩阵

| 类型 | 走 | 典型 researchType | 启发式 |
|---|---|---|---|
| **核心投资素材** | `commit` | `meeting_minutes`, `aletheia`, `scuttleblurb`, `acecamp_article`, `vital_knowledge`, `chat_brilliant`, `substack`, `acecamp_opinion` | 含具体公司/ticker / 财务数据 / 行业判断 / 估值讨论；研究员可直接据此调仓 |
| **前沿动态（brief）** | `brief` | `twitter`（部分）| 提到 AI / 模型 / 工具 / 平台动向，与投资**有边际信号但无 actionability**；产品发布、技术突破、行业八卦、模型对比 |
| **真噪声** | `pass` | `twitter`（多数）| 纯个人推广、感谢回复、自我营销、跟金融/科技/产业完全无关（如生活段子） |

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

```markdown
## Source Overview
（一段话总结：作者 / 主题 / 调研对象 / 关键时点）

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

- **不强制** `facts` / `timeline` 附录（短素材抽 fact 易污染）—— 没有就别写
- **wikilink 仍需要**：让 brief 加入图谱，未来 `[[companies/Anthropic]]` 可反向找到
- 长度控制在 ~60-180 English words，宁少勿多
- frontmatter tags 表达"我关注的主题"（`ai-frontier`, `newsletter`, `llm-tooling` 等）

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

| 症状 | 原因 | 解决 |
|---|---|---|
| `ingest:peek` 返回 null | 没有 pending raw_file | 先跑 `$ae-fetch-reports`；或检查 `WHERE deleted=0 AND ingested_at IS NULL AND skipped_at IS NULL` |
| `ingest:commit` 报"已 ingest" | rawFile 已被 ingest | 不能重复 commit；要重做需先撤销 `ingested_at` |
| `ingest:commit` 报"已被跳过" | rawFile 已 pass | 撤销 `skipped_at` 后再 commit |
| `ingest:write` 报 stdin 为空 | 忘记管道 / heredoc | 检查命令拼写 |
| Stage 5 抽 0 fact（source 页）| `facts` block 漏写或格式错 | 检查 `<!-- facts` 是否在新行开头、是否是 YAML 数组 |
| Stage 7 抽 0 timeline（source 页）| `timeline` 写成旧的 comment block，或根本没有明确事件 | 检查是否用了 `<!-- timeline -->` sentinel；没有明确离散事件时 0 timeline 也可能正常 |
| Stage 5 抽 0 fact（brief 页）| **正常** | brief 不强制 YAML，0 fact 符合预期 |
| Stage 4 创建一堆红链 entity | wikilink slug 写错 / 还没建过 | autoCreate=true，红链 confidence='low'，靠 enrich 补全 |
| 不确定 commit 还是 brief | 灰区 | 默认 brief（轻量、低成本） |

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
- entity 元数据补全（市值 / 关键人）→ `$ae-enrich`
- 论点状态机维护 → `$ae-thesis-track`
- brief 升级为 source（需要二次 ingest 同一份 raw）→ 暂未支持，撤销 ingest 后重跑
