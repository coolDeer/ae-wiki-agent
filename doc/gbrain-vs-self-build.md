# gbrain vs 自建（ae-wiki-agent）路径对比

> 写于 Phase 1 末期（2026-04-26），用于后续路径决策参考。
> 决策点：是否切换到 fork gbrain，还是继续 ae-wiki-agent。
>
> **✅ 决策已定（2026-04-26）：路径 C — 继续 ae-wiki-agent + 选择性借鉴 gbrain**
>
> 后续具体借鉴清单见：[gbrain-borrowings.md](./gbrain-borrowings.md)（活文档，可勾选进度）

## 背景

我们已经投入约 1 周搭建 ae-wiki-agent（TypeScript + Bun + Drizzle + Postgres + pgvector），完成度：

- 15 张表 schema 完整
- ingest pipeline 8 stages 骨架（核心 4 个完整实现）
- fetch-reports（MongoDB → raw_files）完整
- minion-worker（embed_chunks 已实现）
- MCP server + 5 工具
- 端到端跑通 1 条 substack（10 pages / 212 chunks / 6 facts / 8 links）

期间持续参考 [gbrain](https://github.com/garrytan/gbrain) — 由 Y Combinator 总裁 Garry Tan 开源，他自己跑生产 17,888 页知识。

核心问题：**直接换用 gbrain 是否更划算？**

---

## Layer 1：能力重叠（gbrain 已经做好的，约 70%）

| 能力 | gbrain 状态 | ae-wiki-agent 状态 |
|---|---|---|
| Postgres + pgvector + 双引擎（PGLite 开发 / Postgres 生产）| ✅ 17K 页生产实证 | ✅ 仅 Postgres |
| Hybrid search RRF | ✅ + multi-query expansion + 4 层 dedup | ✅ 基础 RRF |
| Recursive + semantic chunker（300-word + lossless invariant）| ✅ | ❌ 段级 fallback |
| 实体注册 + alias index | ✅ | ✅ |
| Typed links + provenance | ✅ Iron Law 强制 | ✅ schema 一致 |
| Event ledger append-only | ✅ timeline 派生 | ⚠️ 表有但未派生 |
| minion_jobs 异步队列 | ✅ 我们抄的就是它 | ✅ |
| MCP server（stdio）| ✅ | ✅ |
| **29 个内置 skill** | ✅ ingest / enrich / query / briefing / maintain / signal-detector / cron / data-research / cross-modal-review / ... | ❌ 0 个完整 |
| Citation 强制 `[Source:...]` | ✅ MANDATORY | ❌ 软约定 |
| Notability gate | ✅ `_brain-filing-rules.md` | ❌ 任何 wikilink 都建 |
| 编译为单文件 binary 部署 | ✅ `bun build --compile` | ❌ |
| 完整测试 + 生产实战 | ✅ 17,888 页验证 | ❌ 1 页 |

如果停下我们的项目，这 70% **直接拿来就能用**。

---

## Layer 2：投资场景特有（gbrain 完全没有，约 30%）

这部分必须自己加，gbrain 不存在：

| 我们需要 | gbrain 状态 |
|---|---|
| **`facts` 表 + valid_from/valid_to 时间旅行** | ❌ 完全没有，narrative-only |
| **`theses` 表 + 状态机**（long/short/conviction/catalysts/validation_conditions）| ❌ 没有 thesis 概念 |
| **`signals` 表** consensus_drift / earnings_surprise / thesis_validation | ❌ 没有投资语义 signal |
| **跨 broker fact 对比 / consensus tracking** | ❌ |
| **MongoDB `ResearchReportRecord` 上游** | ❌ gbrain 是文件 / API 输入，无 mongo 集成 |
| **mineru `parsedContentListS3` + 图片** | ❌ |
| **org_code 多租户 + ticker / sector / sub_sector / aliases 直接成列** | ❌ gbrain 把这些放 frontmatter JSONB |
| **research_type 的 21 种枚举** | ❌ |
| **完整 `raw_files` 登记 + research_id 去重** | ❌ gbrain 有 `sources/` 但更简单 |

---

## Layer 3：哲学冲突（小但根本）

gbrain 是**给 Garry Tan 个人用的 personal brain**：

| gbrain 的设计偏向 | 投资研究场景的需求 | 冲突点 |
|---|---|---|
| 优化"我认识的人" + "YC 关注的公司" | 优化"被多家 broker 覆盖的标的" | 没有跨 broker 共识层 |
| Iron Law: 任何提及必须有反链 | 一份 source 提 50 家公司是常态 | Iron Law 在投资场景过度链接 |
| 单一用户、个人偏好驱动 | 多分析师协作、PM 拍板审核 | 没有审核流 |
| Notability gate 防个人琐事入库 | 投资场景所有 ticker 都 notable | 直接套规则不合适 |
| narrative 是 source of truth | facts 是 source of truth | 根本架构差异 |

**最大根本差异**：gbrain 是"叙事驱动"，我们是"事实驱动"。这影响整个 schema 哲学。

---

## 三条可选路径

### 路径 A：直接用 gbrain（**不推荐**）

```
pros: 立刻有 29 个 skill / 完整工具链
cons: 缺 facts / theses / signals → 投资查询根本跑不起来
     需要把数字塞进 narrative + frontmatter，失去 SQL 聚合能力
     长期维护与上游 PR 不一定匹配
```

**不可行的原因**：「NOW FY27E EPS 各 broker 怎么估」这类查询，没 facts 表就是空 grep。

### 路径 B：Fork gbrain + 加投资层（**推荐**）

```
基础：fork garrytan/gbrain
保留：
  - 整个 src/core/（chunkers / search / engine / link-extraction / markdown / ...）
  - 大部分 skills/（ingest / enrich / briefing / maintain / cron-scheduler / 等）
  - MCP server 框架
  - 部署 / 测试 / build:linux 全套
增量加：
  - schema：facts / theses / signals / raw_files 4 张投资专属表
  - skills/ae-research-ingest/（替代 generic ingest，处理 mineru markdown）
  - skills/ae-fetch-reports/（aecapllc MongoDB → raw_files）
  - skills/ae-thesis-track/（长短仓状态机）
  - skills/consensus-monitor/（跨 broker drift）
  - core/research/（投资场景的 fact 抽取 / consensus 计算）
```

**迁移成本**：
- 学 gbrain 代码：1-2 周
- 加 4 张表 schema：1 天
- 改 ingest 适配 mineru：3-5 天
- 总：**~3-4 周**

**好处**：
- 直接拿到 gbrain 的 chunker / Iron Law / citation / hybrid search 这些"工艺活"
- 所有 maintenance skill（orphan / stale / broken link / citation audit）现成
- 跟随 gbrain 上游升级（vector 搜索改进、新功能）

**坏处**：
- fork 锁定了 gbrain 的核心抽象（PageType enum / link_type 等），未来自由演进会卡住
- 需要持续 cherry-pick 上游变更（gbrain 还在快速迭代）
- 文档不会再是"我们的"，而是 "gbrain 文档 + 我们的扩展"

### 路径 C：继续 ae-wiki-agent + 借鉴 gbrain（**当前状态延续**）

```
保留当前所有代码（~2000 行 TS）
按需借鉴 gbrain 的具体实现：
  - 借 chunkers/recursive.ts
  - 借 search/hybrid.ts 的 multi-query expansion / dedup
  - 借 ingest skill 的 Iron Law / citation 强制
  - 借 _brain-filing-rules.md 的 notability gate
  - 借 maintain skill 的 lint 检查清单
不借：
  - 整个 schema（我们的 facts/theses/signals 是核心价值）
  - skills 的 dispatch 框架（RESOLVER.md 那套对我们过重）
```

**成本**：
- 当前已投：~1 周
- 还要做：**3-6 个月**（补完 29 skill 的等价品）

**好处**：
- 完全自主，schema 哲学一致（投资 fact-first）
- 没有 fork 维护负担
- 跑通后是真正属于团队的

**坏处**：
- 3-6 个月才能到 gbrain 当前完整度
- maintenance skill / signal-detector 这些都得重写
- 测试覆盖度不可能短期内追上

---

## 决策矩阵

| 标准 | A：直接用 | B：Fork + 加 | C：继续 + 借鉴 |
|---|---|---|---|
| 投资场景核心能力（facts 查询）| ❌ | ✅ | ✅ |
| 时间到 MVP | 1 周 | 4 周 | 3-6 月 |
| 长期可控 | 受 gbrain 决定 | 中等（fork 滞后）| 完全自主 |
| 工程师人月 | 0.25 | 1-1.5 | 4-6 |
| 下游升级 | 跟随 gbrain | 偶尔 cherry-pick | 自己造 |
| 投资特化深度 | 浅 | 中 | 深 |
| 风险 | facts 查不动 | gbrain 抽象太重 | 时间黑洞 |

---

## 决策建议（按场景）

### 场景 1：本周就要给 PM 演示「NOW FY27 EPS 各 broker 估值」
→ **路径 C 继续**。我们现在的 facts 表已经能用，至少能跑出来 demo。

### 场景 2：接受 4 周时间换一整套生产级工具链
→ **路径 B 最划算**。会拿到：
- 比我们好 10 倍的 chunker
- 比我们成熟 10 倍的 hybrid search
- 现成的 maintenance / briefing / signal-detector
- 部署 / 测试 / build / CI 全套
- 持续吃 gbrain 的进化红利

### 场景 3：长远定位是商业化产品（卖给基金 / 给团队订阅）
→ **路径 C 自主可控更好**。fork 在商业上不利（依赖外部演进、license 风险）。

---

## 路径 B 的具体迁移路线（如果选）

```
Week 1: fork gbrain，跑通他们的 PGLite engine 本地 demo
        熟悉 src/core/ 关键模块（engine / chunkers / search / markdown）

Week 2: 在 init.sql 之外加 init-research.sql（4 张投资表）
        把我们的 facts/theses/signals/raw_files schema 拍上去
        把 ae-wiki-agent 的 fetch-reports 改写成 gbrain skill 风格

Week 3: 改造 gbrain 的 ingest skill 适配 mineru markdown + facts block
        新增 research-ingest skill（保留 gbrain generic ingest 处理通用 input）

Week 4: 把当前 ae-wiki-agent 的 1 条 substack 数据导入 fork 验证
        跑通端到端 + MCP
        废弃 ae-wiki-agent
```

---

## 当前 ae-wiki-agent 的"残值"分析

如果切到路径 B，已经投入的工作有多少能保留？

| 资产 | 是否保留 |
|---|---|
| Schema 设计（facts/theses/signals 等 4 张表）| ✅ 100% — 直接搬到 gbrain fork |
| MCP tool 设计（5 工具语义）| ⚠️ 复用语义，gbrain 已有自己的 MCP 框架 |
| 投资域知识（CLAUDE.md schema、prompt 等）| ✅ 100% |
| 1 条 substack ingest 验证数据 | ✅ raw_files 不变，直接重导 |
| TS 代码（~2000 行）| ❌ 大部分废弃，少量 helper 可借鉴 |
| init-v2.sql 完整 DDL | ⚠️ 部分搬迁（4 张投资表保留）|

**结论**：~30% 设计资产 + 0% 实现代码。但**设计资产是更难的部分**——schema 想清楚、原则定下来，搬迁是机械工作。

---

## 决策检查清单（决策时填）

Phase 1 末（当前）：
- [ ] 时间预算：4 周 还是 6 个月？
- [ ] 长期定位：内部工具 or 商业产品？
- [ ] 团队规模：1 人 or 多人？多人时 fork 学习曲线 ↑
- [ ] gbrain 上游活跃度：commit 频率 / 主要 contributor / 是否仍在维护？
- [ ] 是否能接受"维护一份 fork"的运维负担？
- [ ] 4 张投资表的设计是否已稳定？（频繁改 schema 在 fork 上很难做）

---

## 一句话总结

**"是否能直接用 gbrain"**：不能。`facts` 表缺失是硬伤。

**"应该 fork 还是继续"**：看时间预算和长期定位。

- 4 周拿 80% 工业级工具链 + 4 张定制表 → fork
- 4-6 个月完全自主 + 完整商业可控 → 继续 + 借鉴

中间没有便宜的路。

---

## 附：本对比基于的关键文档

- gbrain 仓库：`demo/gbrain/`
- gbrain ingest skill 设计：`demo/gbrain/skills/ingest/SKILL.md`
- gbrain 推荐 schema：`demo/gbrain/docs/GBRAIN_RECOMMENDED_SCHEMA.md`
- gbrain chunker 实现：`demo/gbrain/src/core/chunkers/recursive.ts` / `semantic.ts`
- 我们的架构：`doc/architecture.md`
- 我们的 schema：`infra/init-v2.sql`
- 我们的实现：`ae-wiki-agent/src/`
