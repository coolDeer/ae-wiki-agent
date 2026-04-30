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

按 entity type 选模板：

| type | 章节模板 |
|---|---|
| **company** | 公司概况 / 商业模式 / 财务摘要 / 竞争格局 / 估值 / 风险因素 / 催化剂 / 关键时间线 / 相关页面 / 引用来源 |
| **industry** | 行业概况 / 市场规模与增长 / 产业链分析 / 竞争格局 / 关键趋势 / 监管环境 / 投资机会与风险 / 相关公司 / 引用来源 |
| **concept** | 定义 / 在投资研究中的应用 / 相关概念 / 引用来源 |

skill 本身就是模板源，不依赖额外 `templates/` 文件。

#### 写作约束

- **English-first**：所有新写 narrative 默认用英文；中文仅用于 aliases、原文引用或官方中文名称
- **首次提及实体加 wikilink**：`[[companies/X|X]]`
- **每个数据点标注来源**：`（来源：[[sources/...]]）`
- **不编造**：信息只来自 backlink source 或公开 web；agent 脑补的不算
- **整页信心单独判断**：源码少、信息碎时可以保留 `confidence='low'`，不要为了“完成 enrich”硬 bump 到 `medium`

#### 写作边界

- narrative 里按人类可读方式写数字，不需要为了数据库做“小数归一”
- 没有明确数据时可以写“未披露”或“待补充”，不要补会计口径猜测
- 如果同一 entity 只有 1 份 backlink source：
  可以 enrich，但要明确哪些信息只是单一来源说法
- 如果你发现这个 page 其实不该存在：
  不要在 enrich 里硬写，停下来交给用户决定是否保留或后续清理

### Step 4：落库

```bash
cd ae-wiki-agent && bun src/cli.ts enrich:save <pageId> [选项] < /tmp/narrative.md
```

可选 flag：

| flag | 说明 |
|---|---|
| `--ticker X` | 把 ticker 字段填上（如 `2931.T` / `600519.SH`） |
| `--exchange X` | 交易所（`TSE` / `SSE` / `NYSE` ...） |
| `--sector X` | 行业（与 wiki/industry/ 对齐） |
| `--sub-sector X` | 细分行业 |
| `--country X` | 国家代码 / 名称 |
| `--aliases A,B,C` | 别名列表（覆盖式更新；中英日韩混填）|
| `--confidence high\|medium\|low` | 默认 `medium`；调研充分可设 `high` |

默认行为：
- `confidence` 默认从 `'low'` bump 到 `'medium'`
- 写一份 page_versions 快照（reason='enrich'）
- 写一条 events 记录

建议：
- 只有在信息来源足够、核心字段比较完整时才接受默认 `medium`
- 如果仍然只有零散信息，显式传 `--confidence low`

### Aliases 必填规则（重要）

`pages.aliases TEXT[]` 是 stage-4 红链 dedupe 的核心。**enrich 必须填全所有等价名**，否则下次 ingest 写 narrative 用了不同形式（中文名 / 缩写 / 子公司带名 / 多重上市 ticker）就会建出 dup stub（典型事故：`companies/Coherent` 跟 `companies/II-VI Coherent` 因为 aliases 没填全成了两个 page）。

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
```

**注意事项**：
- aliases 元素之间用 `,` 分隔，单个元素可含空格（如 `Tencent Holdings Ltd`）
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
     ## 公司概况
     [[companies/Euglena|Euglena]]（株式会社ユーグレナ，2931.T）是日本上市的微藻技术公司...

     ## 商业模式
     三大板块（占比按 FY2026 收入）：
     - **Healthcare 90%**：核心 Q'SAI 子公司...
     - **Biofuels 0%**（2030E 30%）...
     - **Agriculture 4%** ...

     ## 财务摘要
     | 指标 | FY2026 | FY2030E | 备注 |
     ...

  4. bun src/cli.ts enrich:save 13 \
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

## 不在本 skill 范围

- 收集 raw markdown：`$ae-fetch-reports`
- 把 raw 加工成 wiki：`$ae-research-ingest`
- 论点状态机维护：`$ae-thesis-track`
- 跨 source consensus 比对：`$consensus-monitor`（待写）

## 链式触发

enrich 完一批后建议：

- 如果发现关键 entity 信息和已有论点冲突 → 触发 `$ae-daily-review`
- 如果新建了 industries/X 等概念页 → 检查相关公司页是否需要更新 `sector` 字段
