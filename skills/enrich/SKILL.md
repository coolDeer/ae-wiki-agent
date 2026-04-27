---
name: enrich
description: 把 ingest Stage 4 自动建的红链 entity（confidence='low'）补全成正式 wiki 页。读 backlink source 提取相关信息，按 schema 模板写 narrative 落库。core 不调 LLM，agent 自己当 LLM。
metadata:
  short-description: 补全红链 entity 的元数据 + narrative
---

# enrich

## 用途

ingest 跑完后会留下一堆 `confidence='low'` 的红链 entity——它们是被 source 页提到、自动建出来的占位 page，但 `content=''`，没有 narrative，没有 ticker / sector / aliases。

`$enrich` 把这些补全：
1. 选一个红链 entity
2. 读所有 backlink source 找出关于它的信息
3. 按 wiki schema（公司 / 行业 / 概念 / 人物）写 narrative
4. 落库 + 提升 confidence 到 'medium'

## 触发方式

- `$enrich`（自动选 backlink 最多的红链）
- `$enrich --type company`（只挑公司类）
- "帮我补全 Euglena 这个公司的页面"（自然语言也行）

## 流程

### Step 1：选下一个待 enrich 红链

```bash
cd ae-wiki-agent && bun src/cli.ts enrich:next [--type company|industry|person|concept]
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
- 用 web search（如果用户开启）查公开信息（市值 / ticker / 上市地）

### Step 3：选模板 + 写 narrative

按 entity type 选模板：

| type | 章节模板 |
|---|---|
| **company** | 公司概况 / 商业模式 / 财务摘要 / 竞争格局 / 估值 / 风险因素 / 催化剂 / 关键时间线 / 相关页面 / 引用来源 |
| **industry** | 行业概况 / 市场规模与增长 / 产业链分析 / 竞争格局 / 关键趋势 / 监管环境 / 投资机会与风险 / 相关公司 / 引用来源 |
| **person** | 基本信息 / 投资理念 or 管理风格 / 关键观点与语录 / 业绩记录 / 相关页面 / 引用来源 |
| **concept** | 定义 / 在投资研究中的应用 / 相关概念 / 引用来源 |

完整模板见 `templates/{type}-template.md`。

#### 写作约束

- **中文为主**，专业术语保留英文（P/E、EBIT、ROIC 等）
- **首次提及实体加 wikilink**：`[[companies/X|X]]`
- **每个数据点标注来源**：`（来源：[[source/...]]）`
- **不编造**：信息只来自 backlink source 或公开 web；agent 脑补的不算
- **标注信心**：每个声明心里有数 confidence（high / medium / low），最后给整页一个 confidence

#### 数字归一

- 货币：写明币种（"50 B JPY" / "3.2 B USD"）
- 百分比：小数（52.6% → 0.526）
- 时间：YYYY-MM-DD 或 FY2027E / 1Q26A 这种行业惯例

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
- `confidence` 自动从 `'low'` bump 到 `'medium'`（除非 agent 充分调研后选 `high`）
- 写一份 page_versions 快照（reason='enrich'）
- 写一条 events 记录

### Step 5：循环或停止

- 如果还有待 enrich：循环回 Step 1（可以加 `--skip 1` 跳过当前再取下一个）
- 如果一批做完：跟用户报告"补全了 X 个 entity，分别是：..."

## 完整范例

```
[user] $enrich --type company

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
| `enrich:next` 返回 null | 没有 confidence='low' 的 page | OK，全部已 enrich |
| backlink 数量为 0 | entity 是用户手动建的、不是 ingest 自动建 | 跳过或用 web search 找信息 |
| 同一份 source 反复出现 | 这个 entity 只被一份 source 提过 | 信息不足时如实标 confidence='low'，留 TODO |
| 写完发现关键信息缺失（如 ticker） | source 没说 | 留空。enrich 不必一次完美，未来 ingest 新 source 提到时再补 |

## 不在本 skill 范围

- 收集 raw markdown：`$fetch-reports`
- 把 raw 加工成 wiki：`$research-ingest`
- 论点状态机维护：`$thesis-track`（待写）
- 跨 source consensus 比对：`$consensus-monitor`（待写）

## 链式触发

enrich 完一批后建议：

- 如果发现关键 entity 信息和已有论点冲突 → 触发 `$daily-review`
- 如果新建了 industries/X 等概念页 → 检查相关公司页是否需要更新 `sector` 字段
