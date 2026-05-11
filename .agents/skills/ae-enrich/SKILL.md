---
name: ae-enrich
description: 把 ingest Stage 4 自动建的红链 entity（confidence='low'）补全成正式 wiki 页。读 backlink source 提取相关信息，按 schema 模板写 narrative 落库。core 不调 LLM，agent 自己当 LLM。
metadata:
  short-description: 补全红链 entity 的元数据 + narrative
---

# ae-enrich

## 用途

ingest 跑完后会留下一堆 `confidence='low'` 的红链 entity——它们是被 source 页提到、自动建出来的占位 page，但 `content=''`，没有 narrative，没有 ticker / sector / aliases。

`$ae-enrich` 把这些补全：
0. **Type triage**：先判断当前 type 对不对（companies/Trainium → concepts/Trainium 这种纠错）
1. 选一个红链 entity
2. 读所有 backlink source 找出关于它的信息
3. 按 wiki schema（公司 / 行业 / 概念）写 narrative
4. 落库 + 按信息完整度更新 confidence

## 触发方式

- `$ae-enrich`（自动选 backlink 最多的红链）
- `$ae-enrich --type company`（只挑公司类）
- "帮我补全 Euglena 这个公司的页面"（自然语言也行）

## 流程

### Step 0：Type triage（30 秒，必跑）

ingest Stage 4 是按 wikilink 的 dir 前缀建 page 的——agent 把 `[[companies/Trainium]]` 拼错成 `companies/` 前缀，结果建出一个 type 错误的 stub。在投真正 enrich narrative 之前**先判断 type 对不对**：

| 现有 type | 真实身份 | 行动 |
|---|---|---|
| `company` 但 title 是芯片 / 协议 / 工艺 / 方法论 | concept | `enrich:retype <pageId> --new-type concept` |
| `company` 但 title 是垂直行业 / 主题概念 | industry | `enrich:retype <pageId> --new-type industry` |
| `company` 但 title 是匿名专家代号（"北美专家A"）/ 非投研实体 | 应当被删除 | 暂时跳过这个 page，回 Step 1 |
| `concept` 但 title 是真实公司（有股东 / 营收 / 上市）| company | `enrich:retype <pageId> --new-type company` |
| 其他：type 已经对 | — | 跳到 Step 1 写 narrative |

判断规则：**会出现在公司列表里的实体才是 company**（有股东、有营收、能上市）。芯片 / 协议 / 技术 / 工艺 / 产品线 / 项目代号都是 concept。

CLI 用法：

```bash
# 默认仅换 dir 前缀（companies/Super-Fusion → concepts/Super-Fusion）
bun src/cli.ts enrich:retype <pageId> --new-type concept --reason "Huawei interconnect protocol, not a company"

# 完整覆盖 slug（少见，仅当 name 部分也要改时用）
bun src/cli.ts enrich:retype <pageId> --new-type concept --new-slug "concepts/HBM3E"
```

**约束**：
- 仅允许 retype 到 company / industry / concept / thesis
- 当前 page.type='source' / 'brief' / 'output' 不能 retype（source ↔ brief 走 `ingest:promote`）
- 新 slug 不与现有 active page 冲突（冲突时 CLI 提示合并路径）
- 写入 `events.action='retype'` 审计事件

**为什么 retype 这么轻**：links / facts / signals / page_versions / raw_data 全部按 `page_id (bigint)` 引用 page，slug 改名不需要级联——一行 UPDATE 即可。

### Step 1：选下一个待 enrich 红链

```bash
cd ae-wiki-agent && bun src/cli.ts enrich:next [--type company|industry|concept]
```

输出 JSON：

```json
{
  "pageId": "13",
  "slug": "companies/Euglena",
  "type": "company",
  "title": "Euglena",
  "ticker": null,
  "backlinks": [
    {
      "sourcePageId": "12",
      "sourceSlug": "sources/meeting_minutes-20bfde-260427",
      "sourceTitle": "260417 - Euglena CEO 1x1",
      "sourceType": "source",
      "sourceDate": "2026-04-27"
    }
  ]
}
```

返回 `null` 时表示没有待 enrich 的，结束。

### Step 2：阅读所有 backlink source

对每个 backlink，用 MCP 工具 `get_page(slug)` 拿完整 narrative。

```
get_page("sources/meeting_minutes-20bfde-260427")
```

仔细阅读，提取出关于目标 entity 的所有信息：
- 数字（市值 / 收入 / 利润 / 关键比率）
- 关键人物（CEO / CFO / 其他高管）
- 商业模式 / 产品线 / 业务结构
- 竞争对手 / 行业地位
- 风险因素 / 催化剂

如果信息单一 source 不够（agent 判断），可以：
- `search "Euglena"` 看 wiki 里还有没有别的相关页
- 在可浏览且确有必要时，再核对公开信息（ticker / 上市地 / 官方名称）；优先官方站点、交易所或公司 IR，不要随手补未验证数据

### Step 3：选模板 + 写 narrative

按 entity type 选模板。**H2 标题必须使用下面的英文原文**，不要改成中文标题；deterministic page review 会按这些 heading 校验。

#### Company template

```markdown
## Company Overview
## Business Model
## Financial Summary
## Competitive Landscape
## Valuation
## Risk Factors
## Catalysts
## Key Timeline
## Sources
```

写作标准：
- `Company Overview`：一句话定义公司、国家 / listing status / ownership、核心业务。上市公司写 ticker / exchange；私有公司或子公司写 parent / funding / ownership / disclosure status，不要硬编 ticker。
- `Business Model`：收入来源、客户、产品线、单位经济或利润驱动；能量化就量化，不能量化就说明 source 未披露。
- `Financial Summary`：收入 / 利润 / margin / guidance / estimates / market cap / order backlog 等 source-backed 数字。没有可用数字时写清“no source-backed financial disclosure found”，并列出缺口。
- `Competitive Landscape`：竞品、上下游、份额、技术 / 成本 / 渠道差异。竞品必须用 wikilink，且不要把竞品并称写成 aliases。
- `Valuation`：只写 source 提供的 valuation、target price、multiple、funding valuation 或可验证市值；没有就写 valuation evidence unavailable。
- `Risk Factors`：技术、需求、监管、融资、客户集中、竞争、估值或执行风险，并标注 source。
- `Catalysts`：未来 3-12 个月能改变认知的事件，如 earnings、product launch、policy、capacity ramp、contract win、IPO、financing。
- `Key Timeline`：只列有明确日期或 period 的事件；不要把 FY2026E / 2H26 硬映射成具体日期。
- `Sources`：列出本页实际使用的 backlink source 和必要公开核验来源。

#### Industry template

```markdown
## Industry Overview
## Market Size And Growth
## Value Chain
## Competitive Landscape
## Key Trends
## Regulatory Environment
## Investment Opportunities And Risks
## Related Companies
## Sources
```

写作标准：
- `Industry Overview`：定义行业边界，明确包含 / 不包含什么，避免泛泛百科。
- `Market Size And Growth`：TAM / SAM / shipment / capacity / spending / growth rate / penetration；没有数字则写 source 未给出可验证 market size。
- `Value Chain`：上游 inputs、核心供应商、下游 customers、利润池和 bargaining power。
- `Competitive Landscape`：主要公司、份额、进入壁垒、成本曲线或技术路线。
- `Key Trends`：必须覆盖 demand drivers / supply constraints / technology shift / pricing cycle 中相关项。
- `Regulatory Environment`：政策、许可、补贴、出口管制、医保 / 能源 / 数据监管等；没有 material regulation 时说明。
- `Investment Opportunities And Risks`：写成投资机制，而不是行业描述：source evidence → business driver → revenue / margin / multiple / risk。
- `Related Companies`：列 relevant companies，并用 wikilink 区分 leaders / challengers / suppliers / customers。
- `Sources`：列实际使用来源。

#### Concept template

```markdown
## Definition
## Use In Investment Research
## Related Concepts
## Sources
```

写作标准：
- `Definition`：说明是什么、解决什么问题、**不是什么**；技术 / 会计 / 产业术语要给边界。
- `Use In Investment Research`：必须落到投资变量：revenue、margin、multiple、capex、working capital、policy risk、competitive moat 或 adoption curve。
- `Related Concepts`：区分 inputs / substitutes / downstream effects / commonly confused terms，尽量使用 wikilink。
- `Sources`：列 source-backed 定义和投资用途来源。

skill 本身就是模板源，不依赖额外 `templates/` 文件。

#### 写作约束

- **English-first**：所有新写 narrative 默认用英文；中文仅用于 aliases、原文引用或官方中文名称
- **首次提及实体加 wikilink**：`[[companies/X|X]]`
- **每个数据点标注来源**：`（来源：[[sources/...]]）`
- **不编造**：信息只来自 backlink source 或公开 web；agent 脑补的不算
- **整页信心单独判断**：源码少、信息碎时可以保留 `confidence='low'`，不要为了“完成 enrich”硬 bump 到 `medium`

#### 写作边界

- narrative 里按人类可读方式写数字，不需要为了数据库做“小数归一”
- 没有明确数据时可以写 “not disclosed in available sources” / “no source-backed disclosure found”，同时说明缺的是 revenue、margin、ownership、valuation、market size 还是 timeline；不要补会计口径猜测。
- 如果同一 entity 只有 1 份 backlink source：
  可以 enrich，但要明确哪些信息只是单一来源说法
- 如果你发现这个 page 其实不该存在：
  不要在 enrich 里硬写，停下来交给用户决定是否保留或后续清理

### Step 4：落库

#### 模式判定（写之前必读）

先调 `mcp__ae-wiki__get_page(slug)` 看 `content` 字段：

| 现状 | 模式 | 命令 | 写什么 |
|---|---|---|---|
| 空 / < 200 字符（首次 enrich） | **write** | `enrich:save` | 完整 narrative（company 9 段 / industry 9 段 / concept 4 段，H2 必须用英文模板原文） |
| 已有 narrative ≥ 200 字符 | **append** | `enrich:save --append` | **只写本次新增** delta（1-3 段，禁止重复旧内容） |

> ⚠️ **NEVER overwrite paragraphs**——已有 narrative 一定走 append。投资 thesis 演化轨迹（「3 月看好 → 4 月质疑 → 5 月 unwind」）是核心知识资产，整页重写会丢失这条链。

#### Append 模式约束

写 delta 时 **必须** 满足：

1. **只写新东西**：不要复述 backlinks 里早就 enrich 过的信息，agent 看现有 content 自己判断什么是新
2. **明确的 (per [[sources/X]]) 出处**：每段 delta 显式带本次驱动 source 的 wikilink；多 source 时分段
3. **能用 typed wikilink 就用**（参见 ae-research-ingest/SKILL.md §9）：
   - `[[companies/X|confirms: prior view of...]]` 当 delta 印证之前结论
   - `[[companies/X|contradicts: prior view of...]]` 当 delta 反驳之前结论
4. **不带 frontmatter**：append 模式忽略 YAML，metadata 走 CLI flag 单独传

落库会自动包成：

```markdown
[现有 narrative 不动]

## Updates       ← 已存在则不重复加

### 2026-05-03 (per [[sources/aletheia-xxx]])

[你写的 delta]
```

多次 append 会在 `## Updates` 下不断追加 `### date` 块，时间序自然形成。

#### 命令

```bash
# 首次 enrich（content 空）
cd ae-wiki-agent && bun src/cli.ts enrich:save <pageId> [元数据 flags] < /tmp/narrative.md

# 重 enrich（已有 content）
cd ae-wiki-agent && bun src/cli.ts enrich:save <pageId> --append --append-source sources/X [元数据 flags] < /tmp/delta.md
```

可选 flag（write / append 两种模式都生效）：

| flag | 说明 |
|---|---|
| `--display-name X` | **必填（company / industry / concept）**：由 enrich skill 生成并写入 `pages.display_name` 的 canonical UI 名称，如 `Cambricon` / `Huawei` / `China AI Accelerators` |
| `--ticker X` | 把 ticker 字段填上（如 `2931.T` / `600519.SH`） |
| `--exchange X` | 交易所（`TSE` / `SSE` / `NYSE` ...） |
| `--sector X` | 行业（与 wiki/industry/ 对齐） |
| `--sub-sector X` | 细分行业 |
| `--country X` | 国家代码 / 名称 |
| `--aliases A,B,C` | 别名 merge（默认）；带逗号的法定名称用 JSON 数组，详见下文 §Aliases |
| `--confidence high\|medium\|low` | 默认 `medium`；调研充分可设 `high` |
| `--append` | **增量模式**（已有 content 时必须用） |
| `--append-source slug` | 关联 source slug（自动写到 update 块标题） |
| `--allow-alias-conflict` | 绕过自动 alias 冲突检查（罕见，仅合法双归属用） |

默认行为：
- `confidence` 默认从 `'low'` bump 到 `'medium'`
- entity 页如果当前 `display_name` 为空且命令没有传 `--display-name`，`enrich:save` 会拒绝写入；display name 必须由 enrich skill 显式生成
- 写一份 page_versions 快照（reason='enrich' / 'enrich:append'）
- 写一条 events 记录

建议：
- 只有在信息来源足够、核心字段比较完整时才接受默认 `medium`
- 如果仍然只有零散信息，显式传 `--confidence low`

### Aliases 必填规则（重要）

`display_name` 和 `aliases` 分工不同：

- `display_name`：页面和链接列表默认显示的 canonical 名称，只放一个最适合 UI 的名字；必须由 enrich skill 判断后通过 `--display-name` 写入。
- `aliases`：所有等价检索名 / 中文名 / ticker / 官方全称，用于搜索和去重。
- 不要把 source 中的上下文称呼误当 canonical display name，例如 `Huawei Ascend` 可以是某篇 source 的 link label，但 company page `companies/huawei` 的 `display_name` 应是 `Huawei`。

`pages.aliases TEXT[]` 是 stage-4 红链 dedupe 的核心。**enrich 必须填全所有等价名**，否则下次 ingest 写 narrative 用了不同形式（中文名 / 缩写 / 子公司带名 / 多重上市 ticker）就会建出 dup stub（典型事故：`companies/Coherent` 跟 `companies/II-VI Coherent` 因为 aliases 没填全成了两个 page）。

**中国公司硬规则**：凡是中国公司、且能从 source / 招股书 / 公司官网确认中文官方名或常用中文名，`--aliases` 必须包含中文名。最低要求：`英文品牌名 / 官方英文名 / 中文名 / ticker` 四类里能确认多少填多少，例如 `Muxi,MetaX,沐曦,沐曦集成电路（上海）股份有限公司`。缺中文 alias 会导致检索和去重混淆，尤其是国产半导体、光模块、新能源链条。

### ⚠️ 反模式：把竞品并称当成 alias（事故复盘）

**事故**：2026-05-06 enrich 行业页时，把 `新易盛` 写进了 `companies/innolight` 的 aliases。`新易盛` = Eoptolink (300502.SZ)，跟 InnoLight 中际旭创 (300308.SZ) 是两家**独立的同业竞品**，研报里频繁并称为 `中际旭创/新易盛` —— agent 把"并称"看成了"等同"。

**判别规则**：中文研报里见到 `A/B`、`A 和 B`、`A、B 等` 这类**并称**模式，**99% 是同业竞品而非别名**。常见陷阱：

| 并称表达 | 真实关系 |
|---|---|
| 中际旭创/新易盛 | InnoLight vs Eoptolink（两家光模块龙头）|
| 隆基/晶澳/天合 | LONGi vs JA Solar vs Trina（三家光伏龙头）|
| 宁德/比亚迪 | CATL vs BYD（两家电池龙头）|
| 茅台/五粮液 | Moutai vs Wuliangye（两家白酒）|
| 立讯/歌尔 | Luxshare vs GoerTek（两家果链组装）|

**判定操作**：加 alias 前如果心里浮现 "X/Y" 这种并称，先 search "Y" — 如果 wiki 里已经有独立 entity 页，那 Y 就是竞品，**不是别名**。

**自动护栏（v2.7.x+）**：`enrich:save` 在写入前会扫所有新加的 alias，命中下面任一规则就**直接拒绝**：

- 与另一个 active page 的 `title` 完全匹配（case-insensitive）
- 与另一个 active page 的 slug name-part（`split_part(slug,'/',2)`）匹配
- 出现在另一个 active page 的 `aliases` 数组里

报错示例：

```
enrich:save 拒绝写入：以下 alias 与已有 page 冲突...
  - "新易盛" 已属于 page #1381 (companies/eoptolink, title="eoptolink", matchedOn=alias)
```

**如何处理报错**：

1. **绝大多数情况**：拒绝是对的，agent 把竞品当成别名了。撤掉这次的写入。
2. **极少数合法双归属**（合并过渡期：如 II-VI 收购 Coherent 后短期都还有 II-VI 名；同 ticker 多上市地不同名等）：加 `--allow-alias-conflict` 强制写入，并在 narrative 里注明双归属理由。

**对已存在的脏数据**：用 `--aliases-remove "X"` 把错填的 alias 撤回，再到正确的 page 上 `--aliases "X"` 加回。


**对 company 类，必须传**：

| 类别 | 必须包含 | 示例（companies/Tencent）|
|---|---|---|
| 英文规范全名 | ✅ | `Tencent Holdings`, `Tencent Holdings Ltd` |
| 中文名 | ✅（如适用）| `腾讯`, `腾讯控股` |
| 所有上市 ticker | ✅ | `0700.HK`, `TCEHY`（ADR）, `TCTZF`（OTC）|
| 常见缩写 / 商业名 | ✅ | `Tencent`（短名），`HK700` |
| 历史名 / 合并前名 | ✅（如适用）| `II-VI Coherent` 类合并产生的别名 |

**对 concept 类，必须传**：

| 类别 | 必须包含 | 示例（concepts/HBM3E）|
|---|---|---|
| 全称 | ✅ | `High-Bandwidth Memory 3E` |
| 缩写 | ✅ | `HBM3E`, `HBM3e` |
| 中文等价 | ✅（如适用）| `高带宽内存 3E` |
| 同义术语 | ✅（如适用）| `HBM3 Extended` |

**对 industry 类**：英文 + 中文 + 常见行业代码（如 `GICS-451030 Tech Hardware`）。

**3 种操作模式**：

| 模式 | flag | 语义 | 何时用 |
|---|---|---|---|
| **merge（默认）** | `--aliases A,B,C` | 跟现有 aliases 合并、case-insensitive 去重 | 大多数情况 —— 加新发现的 alias，不动现有 |
| **replace** | `--aliases-replace A,B,C` | 完全覆盖现有 aliases | 仅当确定要清空旧的，从头重建 |
| **remove** | `--aliases-remove X,Y` | 删指定项（case-insensitive 匹配）| 修错的 alias（"Tencent Music" 错填进 Tencent 页）|

`--aliases` 与 `--aliases-remove` 可组合（先删后加，net update）。`--aliases-replace` 与前两者**互斥**。

三个 alias flag 都支持两种格式：
- 简单逗号列表：`--aliases "Tencent,腾讯,0700.HK"`
- JSON 数组：`--aliases '["Arista Networks, Inc.","Arista Networks Inc.","ANET"]'`

当单个 alias 自身含逗号时必须用 JSON 数组，不要写成 `--aliases "Arista Networks, Inc.,ANET"`，否则 shell/CLI 会把 `Inc.` 当成独立 alias。

```bash
# 典型：merge 模式（默认）—— 加 4 个新 alias，原有的保留
bun src/cli.ts enrich:save 100 \
  --aliases "腾讯,腾讯控股,0700.HK,TCEHY" \
  < /tmp/narrative.md

# 修错：删一个错填的
bun src/cli.ts enrich:save 100 \
  --aliases-remove "Tencent Music" \
  < /tmp/narrative.md

# 组合：删一个错的同时加 2 个新的
bun src/cli.ts enrich:save 100 \
  --aliases-remove "Tencent Music" \
  --aliases "腾讯,0700.HK" \
  < /tmp/narrative.md

# 完全覆盖（少用）
bun src/cli.ts enrich:save 100 \
  --aliases-replace "Tencent,腾讯,Tencent Holdings,0700.HK" \
  < /tmp/narrative.md

# alias 自身含逗号：用 JSON 数组
bun src/cli.ts enrich:save 249 \
  --aliases '["Arista Networks, Inc.","Arista Networks Inc.","ANET"]' \
  < /tmp/narrative.md
```

**注意事项**：
- 简单格式下 aliases 元素之间用 `,` 分隔，单个元素可含空格（如 `Tencent Holdings Ltd`）
- 不要塞 wiki 内部 slug（写 `Tencent` 不写 `companies/Tencent`）
- merge 模式不会丢 stage-4 自动预填的 namePart（`[[companies/Tencent]]` 建 stub 时已存了 `Tencent`）

**aliases 没填全的代价**：
- 下次 ingest 同 entity 的另一种写法会建 dup stub
- 修法贵：得 `enrich:retype` + 手工合并 facts/links/page_versions
- 大规模 ingest 后能堆出几十个 dup（参考 scaling 分析 N≈50 文档）

### Step 5：循环或停止

- 如果还有待 enrich：循环回 Step 1（可以加 `--skip 1` 跳过当前再取下一个）
- 如果一批做完：跟用户报告"补全了 X 个 entity，分别是：..."

## 完整范例

```
[user] $ae-enrich --type company

[agent]
  1. bun src/cli.ts enrich:next --type company
     → {pageId: 13, slug: "companies/Euglena", backlinks: [{...}]}

  2. get_page("sources/meeting_minutes-20bfde-260427")
     → 完整 source narrative

  3. 按 company 模板写 narrative：
     ## Company Overview
     [[companies/Euglena|Euglena]]（株式会社ユーグレナ，2931.T）is a listed Japanese microalgae technology company...

     ## Business Model
     三大板块（占比按 FY2026 收入）：
     - **Healthcare 90%**：核心 Q'SAI 子公司...
     - **Biofuels 0%**（2030E 30%）...
     - **Agriculture 4%** ...

     ## Financial Summary
     | 指标 | FY2026 | FY2030E | 备注 |
     ...

  4. bun src/cli.ts enrich:save 13 \
       --display-name "Euglena" \
       --ticker 2931.T --exchange TSE \
       --sector biotechnology --sub-sector microalgae \
       --country JP \
       --aliases 'ユーグレナ,Euglena Co Ltd,尤格雷纳' \
       --confidence medium \
       < /tmp/narrative-13.md

  5. (循环) bun src/cli.ts enrich:next --type company --skip 0
     → 下一个红链
```

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `enrich:next` 返回 null | 没有 confidence='low' 的 page | OK，全部已 enrich；或当前候选都不是值得补的 entity |
| backlink 数量为 0 | entity 是用户手动建的、不是 ingest 自动建 | 跳过或用 web search 找信息 |
| 同一份 source 反复出现 | 这个 entity 只被一份 source 提过 | 信息不足时如实标 confidence='low'，留 TODO |
| 写完发现关键信息缺失（如 ticker） | source 没说 | 留空。enrich 不必一次完美，未来 ingest 新 source 提到时再补 |

## Write 前自检

- 目标 type 判断对吗：company / industry / concept
- narrative 是否真的回答了“这个实体为什么值得存在于 wiki”
- 首次提到的重要关联实体是否加了 wikilink
- 数据点是否都能回指到具体 `[[sources/...]]`
- 没把缺失信息硬补成确定事实
- `confidence` 是否和信息完整度匹配

## Typed wikilink（跨 source 关系标注）

写 narrative 时，凡是引用具体 source 论据/数据，用 typed wikilink 表达关系：

```
[[slug|TYPE: display]]
```

`TYPE` 在白名单内才生效，否则降级 mention：

| TYPE | 何时用 |
|------|--------|
| `mention` | 仅提及（默认，无 prefix）|
| `cites` | 引用 source 作为数据来源（最常用于 enrich） |
| `confirms` | 多个 source 给出一致数据时 |
| `contradicts` | source 间数据冲突时（在 Risk Factors 段标） |
| `supersedes` | 新版 source 取代旧版 |

**enrich narrative 里大多用 `cites`**——典型场景：

```markdown
## Financial Summary

1Q26 revenue TWD149b, GM 46.3% (per [[sources/Daiwa-MTK-260430|cites: Daiwa
1Q26 conference call notes]]).

## Risk Factors

Bottom-up WFE estimate diverges: Aletheia $200bn vs Morgan Stanley $150bn
(see [[sources/MS-WFE-260420|contradicts: MS WFE forecast]]).
```

不写 typed 也不会出错（默认 mention），但用对了能让 PM 一眼看出"这个 entity 页的某个数据点是哪几家研究机构的什么关系"。详细规则见 `ae-research-ingest/SKILL.md` 的「Wikilink 纪律 §9」。

## 不在本 skill 范围

- 收集 raw markdown：`$ae-fetch-reports`
- 把 raw 加工成 wiki：`$ae-research-ingest`
- 论点状态机维护：`$ae-thesis-track`
- 跨 source consensus 比对：`$consensus-monitor`（待写）

## 链式触发

enrich 完一批后建议：

- 如果发现关键 entity 信息和已有论点冲突 → 触发 `$ae-daily-review`
- 如果新建了 industries/X 等概念页 → 检查相关公司页是否需要更新 `sector` 字段
