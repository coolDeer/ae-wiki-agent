---
name: ae-fetch-reports-debug
description: ae-fetch-reports 的 debug / 抽样版本——指定一组 researchType，每个类型只拉 N 条样本到 raw_files，方便测试 ingest pipeline 对不同来源类型的处理。底层走 `bun src/cli.ts fetch-reports --all --types ... --per-type N`。
metadata:
  short-description: 抽样拉取每个 researchType N 条到 raw_files（debug 用）
---

# ae-fetch-reports-debug

`ae-fetch-reports` 的抽样版本。**不是**生产入口，专为以下场景设计：

- 想测试 ingest pipeline 对某个新 researchType 的支持
- 想给 wiki 灌一些**多类型样本**做演示 / 教学
- 想验证 chunker / triage / facts 抽取在不同来源格式下的稳健性

不会替代 `$ae-fetch-reports`——日常拉新研报仍走默认 skill（按日期窗口）。

## 触发方式

- `$ae-fetch-reports-debug` — 默认拉用户描述的那一组类型，每类型 2 条
- `$ae-fetch-reports-debug meeting_minutes,acecamp_article --per-type 3` — 自定义类型 + 配额
- 自然语言：「拉一些 meeting_minutes 和 twitter 各两篇看看」「灌一批样本进 raw_files」

## 默认抽样集

如果用户**没指定** `--types`，默认拉这 7 个类型，每类型 2 条：

```
meeting_minutes
acecamp_article
merit
trendforce
semi_analysis
bernstein_research
twitter
```

总计最多 14 篇。这套组合覆盖：
- 深度纪要（meeting_minutes）
- 中文研究文章（acecamp_article）
- 顶级 broker（merit / bernstein_research）
- 行业数据库（trendforce / semi_analysis）
- 散点社交媒体（twitter）

## CLI 映射

```bash
# 默认抽样集（每类型 2 条）
bun src/cli.ts fetch-reports --all \
  --types meeting_minutes,acecamp_article,merit,trendforce,semi_analysis,bernstein_research,twitter \
  --per-type 2

# 用户自定义
bun src/cli.ts fetch-reports --all --types <T1,T2,...> --per-type <N>

# 加日期窗口（与 --types / --per-type 兼容；不传 --all 则默认昨天）
bun src/cli.ts fetch-reports 2026-04-25 --types meeting_minutes --per-type 5
```

注意：

- **必须传 `--all`** 才能跳过日期过滤，否则会被默认"昨天"窗口卡住——debug 通常想抓近期任意样本，不在意日期。
- `--types` 是 **researchType 名称**（与 `core/mongo.ts` `RESEARCH_TYPE_NAMES` 一致），逗号分隔，不接受数字 id。
- `--per-type N` 包含**已存在**的 raw_file——如果某类型已落库 ≥N 条，本次不再为该类型拉新；满足"每类型至少 N 个样本可玩"的语义。

## 已知 researchType 名称（对齐 mongo enum）

```
1  acecamp_article        12 vital_knowledge
2  acecamp_opinion        13 transcript_task
3  merit                  14 semi_analysis
4  thirdbridge            15 trytrata
5  youtube                16 scuttleblurb
6  trendforce             17 bernstein_research
7  r&research             18 aletheia
8  meeting_minutes        19 chat_brilliant
9  research_report_file   20 arete
10 thirteen_d_report      21 twitter
11 substack
```

未知名称会被忽略并警告（不中断）；全部无效则抛错退出。

## 执行步骤

1. 解析 `$ARGUMENTS`：
   - 空 → 用默认抽样集 + per-type 2
   - 含逗号分隔类型名 → 用作 `--types`
   - 含 `--per-type N` → 覆盖默认 2
2. 运行：

   ```bash
   cd /Users/levin/project/agent/ae-wiki-agent && \
   bun src/cli.ts fetch-reports --all --types <...> --per-type <N>
   ```

3. 报告结果：列出按 type 分组的 inserted / skippedExisting 计数，附最近 raw_file id。

## 输出解读

stdout 头几行会打印过滤信息：

```
[fetch-reports] 全量模式（--all），跳过日期过滤
[fetch-reports] researchType 过滤: meeting_minutes, twitter, ...
[fetch-reports] 每 researchType 最多拉 2 条
✓ meeting_minutes/...
✓ twitter/...
[fetch-reports] 完成: { scanned: 47, inserted: 12, skippedExisting: 2, skippedNoMd: 0, failed: 0, dateRange: null }
```

`scanned` 通常 >> `inserted + skippedExisting`，因为 perTypeLimit 早退会跳过同类型剩余文档（不计入任何 skipped 计数，只是抽样满了）。

## 后续动作建议

- 跑完后用户决定是否 `$ae-research-ingest`（单篇 triage）或 `$ae-batch-ingest N`（批量）处理新增样本
- 不建议对 debug 样本跑全量 batch——一般只挑感兴趣的几篇 commit，剩下 pass 掉

## 与 ae-fetch-reports 的边界

| 维度 | ae-fetch-reports | ae-fetch-reports-debug |
|---|---|---|
| 目的 | 日常拉新 | 抽样测试 |
| 默认日期窗口 | 昨天 | 关闭（`--all`）|
| 默认 researchType 范围 | 全部 | 7 类抽样集 |
| 默认数量 | 不限 | 每类 2 条 |
| 适用频率 | 每天 | 偶发 |

## 相关文件

- `src/skills/fetch-reports/index.ts` — 实现（同一份，`types` / `perTypeLimit` 由本 skill 触发）
- `src/cli.ts` (case `fetch-reports`) — `--types` / `--per-type` 解析
- `src/core/mongo.ts` — `researchTypeNumber` / `researchTypeName` 名称-数字映射
- `.claude/skills/ae-fetch-reports/SKILL.md` — 生产版本入口
