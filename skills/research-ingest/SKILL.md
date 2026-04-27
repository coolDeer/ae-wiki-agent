---
name: research-ingest
description: 把 raw_files 中待处理的研究素材 ingest 进 wiki。Triage 流程：peek → 三选一 (commit 深 source / brief 轻量前沿 / pass 噪声) → write → finalize。Agent 当 LLM，core 只做确定性落库。
metadata:
  short-description: Triage + 三段式 ingest（agent 写 narrative）
---

# research-ingest

把 `raw_files` 里的研究素材加工成 wiki page。**先 triage 再 ingest** —— 不是所有素材都值得深 ingest，也不是所有素材都该被丢弃。

## 设计哲学

**core 不调 LLM**：`ae-wiki-agent` 的 ingest 主路径全是确定性 SQL / 正则 / YAML 解析。
**理解原文是 agent 的事**：agent（Claude Code）读 raw markdown → 三分判定 → 套对应模板写 narrative → 落库。

为什么三分：
- raw 来源参差（Daiwa 研报 / 长 tweet thread / @xx Thanks 噪声 / 中文 chat 散点纪要）
- 一刀切走 7 段 source 模板：短素材塞不满，agent 编造或大段标"无"
- 一刀切 pass 掉 twitter：丢失值得留痕的前沿动态（AI 工具 / 行业八卦 / 算力新闻）
- 三分让每类素材有合适的归宿

## 触发方式

- 显式：`$research-ingest`（默认处理 1 篇）
- 显式：`$research-ingest 5`（一次跑 5 篇）
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
  "rawMdAbsPath": "/Users/.../raw/2026-04-26/twitter/xxx.md",
  "title": "...",
  "researchType": "twitter",
  "rawCharCount": 9112,
  "preview": "...前 1500 字..."
}
```

返回 `null` 时表示没有待处理 raw_file，结束本轮。

---

## Step 2: 三分判定

读 `preview`（短素材够用），或 `Read rawMdAbsPath`（长素材 / 需要看末尾），按下表判定：

### 判定矩阵

| 类型 | 走 | 典型 researchType | 启发式 |
|---|---|---|---|
| **核心投资素材** | `commit` | `meeting_minutes`, `aletheia`, `scuttleblurb`, `acecamp_article`, `vital_knowledge`, `chat_brilliant`, `substack`, `acecamp_opinion` | 含具体公司/ticker / 财务数据 / 行业判断 / 估值讨论；研究员可直接据此调仓 |
| **前沿动态（brief）** | `brief` | `twitter`（部分）| 提到 AI / 模型 / 工具 / 平台动向，与投资**有边际信号但无 actionability**；产品发布、技术突破、行业八卦、模型对比 |
| **真噪声** | `pass` | `twitter`（多数）| 纯个人推广、感谢回复、自我营销、跟金融/科技/产业完全无关（如生活段子） |

### 边界判断口诀

- **能不能给某 thesis / industry / company 留个边际信号？**
  - 能 → brief（不深做）或 commit（深做）
  - 不能 → pass
- **有没有可量化的数字 / 财务事件 / 估值讨论？**
  - 有 → 倾向 commit（值得抽 facts）
  - 无 → brief 即可
- **PM 半年后翻回来会觉得有用吗？**
  - 是 → 至少 brief
  - 否 → pass

### 灰区处理

不确定 commit 还是 brief 时**默认走 brief**（轻量、低成本、不污染 source 池）。日后觉得需要 deep dive，可以补一个 source page 引用 brief。

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

返回 `{pageId, rawMdAbsPath, ...}`，type='source'，slug 前缀 `sources/`。

### Source narrative 模板（7 段必填）

```markdown
## 来源概要
（一段话总结：作者 / 主题 / 调研对象 / 关键时点）

## 关键要点
（3-7 条编号列表，每条引用具体数据。覆盖维度：
  1. 核心数据和变化（价格、产能、增速等定量信息）
  2. 关键判断与观点（即使没有具体数字）
  3. 行业参与者的行为模式（结构性观察容易被忽略，但对判断行业拐点至关重要）
  4. 与市场共识不同的观点（expectation gap）
  5. 时效性信号（前瞻指引、超预期 / 低于预期））

## 重要数据点
（表格优先：指标 | 数据 | 备注 | 来源）

## 值得注意的观点/引语
（blockquote 保留原文。优先收录：管理层表态、专家对结构性问题的判断、反直觉观点）

## 结构性观察
（非数字型的长期判断 —— 竞争对手行为模式 / 行业参与者心态变化 / 长期趋势的早期信号。
**此章节不得省略**，没有则写"无"）

## 与现有知识的关系
### 新增信息
### 印证之前观点
### 矛盾/需修正
（写之前先用 search 工具查 wiki 里已有的相关公司/行业页，建立交叉引用）

## 后续跟进项
```

#### 末尾必须输出 YAML 块（供 Stage 5/7 提取）

```markdown
<!-- facts
- entity: companies/<slug>
  metric: revenue | ebit | eps_non_gaap | target_price | gross_margin | ...
  period: FY2027E | 1Q26A | current | YYYY-MM-DD
  value: <number>
  unit: usd_m | pct | x | usd | cny_bn
  source_quote: "<原文片段>"
-->

<!-- timeline
- entity: companies/<slug>
  date: 2026-04-15
  event_type: earnings | guidance | rating_change | product_launch | news | other
  summary: <一句话>
-->
```

---

## Step 3c: Brief（前沿动态，走轻量模板）

```bash
cd ae-wiki-agent && bun src/cli.ts ingest:brief <rawFileId>
```

返回 `{pageId, rawMdAbsPath, ...}`，type='brief'，slug 前缀 `briefs/`。

### Brief narrative 模板（精简 4 段，50-300 字）

**顶部必须有 YAML frontmatter**（被 stage3 自动解析合并到 `pages.frontmatter`）：

```markdown
---
tags: [ai-frontier, llm-tooling, anthropic-ecosystem]
url: https://x.com/xxx/status/...
platform: twitter
---

## TL;DR
<一句话摘要，含主要 wikilink>

## 关键观察

- <要点 1，能用 wikilink 就用：[[industries/AI]] / [[companies/OpenAI]]>
- <要点 2>
- <要点 3>
（最多 5 条）

## 投资视角
<这条动态如果对某个 thesis / industry / company 有边际信号，写 1-2 句；
没有就省略本段或写"无 actionability，watchlist">

## 链接
- 原文：<URL>（与 frontmatter.url 一致）
- 平台：twitter / substack / ...
```

### Brief 写作约束

- **不强制** facts/timeline YAML 块（短素材抽 fact 易污染）—— 没有就别写
- **wikilink 仍需要**：让 brief 加入图谱，未来 `[[companies/Anthropic]]` 可反向找到
- 长度控制在 ~250 中文字内，宁少勿多
- frontmatter tags 表达"我关注的主题"（`ai-frontier`, `newsletter`, `llm-tooling` 等）

---

## Step 4: Write（落库 narrative）

source 和 brief 共用同一个 write 命令：

```bash
cd ae-wiki-agent && bun src/cli.ts ingest:write <pageId> <<'EOF'
<narrative 全文>
EOF
```

或写文件后管道：

```bash
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
- Stage 7 timeline 抽取（直读 YAML 块）
- Stage 8 thesis 关联（active thesis 命中 → 写 signal）

source 和 brief 都跑同样的 5 个 stage —— brief 通常 facts/timeline 段无产出，是预期。

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

4. （可选）Read rawMdAbsPath 看完整原文
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

4. Read rawMdAbsPath 完整阅读
   search "国产 GPU" / "昇腾" / "寒武纪" 查 wiki 已有页

5. 写 source narrative（7 段 + facts/timeline YAML） → /tmp/narrative.md
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

## 兼容入口（不推荐）

```bash
bun src/cli.ts ingest:next        # = peek + 自动 commit（直接建 type='source'，不走 triage）
```

仅用于"明确知道一定要 commit 走 source"的场景。批量处理时容易把 twitter 噪声塞进 source 池，请避免。

---

## 完成后建议链式触发

按 `CLAUDE.md` 的工作流：

- **建议 `$daily-review`**：对今天 ingest 的增量做 epistemic 复盘
- **建议 `$daily-summarize`**：把复盘转成 PM operational 简报

---

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `ingest:peek` 返回 null | 没有 pending raw_file | 先跑 `$fetch-reports`；或检查 `WHERE deleted=0 AND ingested_at IS NULL AND skipped_at IS NULL` |
| `ingest:commit` 报"已 ingest" | rawFile 已被 ingest | 不能重复 commit；要重做需先撤销 `ingested_at` |
| `ingest:commit` 报"已被跳过" | rawFile 已 pass | 撤销 `skipped_at` 后再 commit |
| `ingest:write` 报 stdin 为空 | 忘记管道 / heredoc | 检查命令拼写 |
| Stage 5 抽 0 fact（source 页）| narrative 末尾 YAML 块格式错 | 检查 `<!-- facts` 是否在新行开头 |
| Stage 5 抽 0 fact（brief 页）| **正常** | brief 不强制 YAML，0 fact 符合预期 |
| Stage 4 创建一堆红链 entity | wikilink slug 写错 / 还没建过 | autoCreate=true，红链 confidence='low'，靠 enrich 补全 |
| 不确定 commit 还是 brief | 灰区 | 默认 brief（轻量、低成本） |

---

## 不在本 skill 范围

- raw 文件的去重、平台拉取 → `$fetch-reports`
- entity 元数据补全（市值 / 关键人）→ `$enrich`
- 论点状态机维护 → `$thesis-track`
- brief 升级为 source（需要二次 ingest 同一份 raw）→ 暂未支持，撤销 ingest 后重跑
