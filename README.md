# ae-wiki-agent

投资研究 wiki agent — Postgres + pgvector 后端 + MongoDB 上游 + Claude MCP。

设计文档见 [`./doc/architecture.md`](./doc/architecture.md)。
DDL 见 [`../infra/init-v2.sql`](../infra/init-v2.sql)。

## 快速开始

```bash
# 1. 装依赖
bun install

# 2. 配置 env
cp .env.example .env
# 填入实际的 DATABASE_URL / MONGODB_URI / OPENAI_API_KEY / ANTHROPIC_API_KEY

# 3. 部署 v2 schema（如未部署）
psql "$DATABASE_URL" -f ../infra/init-v2.sql

# 4. 类型检查
bun typecheck

# 5. 第一个动作：从 MongoDB 拉研究报告到 raw_files 表
bun run fetch-reports

# 6. 把 raw_files 跑 ingest pipeline
bun run ingest

# 7. (后台) 启动异步 worker（embedding / signal-detection / enrichment）
bun run worker
```

## 项目结构

```
ae-wiki-agent/
├── src/
│   ├── core/                       基础设施层
│   │   ├── env.ts                  环境变量校验（Zod）
│   │   ├── db.ts                   postgres.js + Drizzle 客户端
│   │   ├── mongo.ts                MongoDB 上游连接
│   │   ├── embedding.ts            OpenAI embedding wrapper
│   │   ├── audit.ts                update_time / update_by 注入 helper
│   │   ├── types.ts                共享类型
│   │   └── schema/                 Drizzle schema（与 init-v2.sql 一一对应）
│   │       ├── sources.ts
│   │       ├── pages.ts
│   │       ├── content-chunks.ts
│   │       ├── links.ts
│   │       ├── tags.ts
│   │       ├── facts.ts
│   │       ├── theses.ts
│   │       ├── signals.ts
│   │       ├── timeline-entries.ts
│   │       ├── raw-files.ts
│   │       ├── raw-data.ts
│   │       ├── page-versions.ts
│   │       ├── events.ts
│   │       ├── minion-jobs.ts
│   │       ├── config.ts
│   │       └── index.ts
│   ├── skills/                     业务能力层
│   │   ├── fetch-reports/          MongoDB → raw_files
│   │   └── ingest/                 raw_files → pages/facts/links/...
│   │       ├── stage-1-skeleton.ts
│   │       ├── stage-2-chunk.ts
│   │       ├── stage-3-narrative.ts
│   │       ├── stage-4-links.ts
│   │       ├── stage-5-facts.ts
│   │       ├── stage-6-jobs.ts
│   │       ├── stage-7-timeline.ts
│   │       └── stage-8-thesis.ts
│   ├── workers/
│   │   └── minion-worker.ts        Postgres 原生异步队列 runner
│   ├── mcp/                        Phase 2: MCP server
│   │   └── server.ts
│   └── cli.ts                      CLI 入口
└── tests/
```

## 设计原则（参考 architecture.md）

1. 万物皆 page（gbrain 思想）
2. 投资强查询字段直接进 pages 列（ticker / sector / aliases）
3. Facts 是 attribute，不是 page
4. 不做物理删除（append-only + soft archive）
5. 应用层维护 `update_time` / `update_by`（不靠 trigger）
6. 不引入外键约束（应用层控制完整性）
7. 三层 fact 抽取：YAML / 正则 / LLM 兜底（默认全开）

## Phase 0 状态

- [x] 项目骨架
- [x] Drizzle schema（15 张表）
- [x] env / db / mongo / embedding 基础工具
- [x] fetch-reports skill v0
- [x] ingest skill 8 stage 骨架
- [ ] 完整 stage 实现（Phase 1）
- [ ] minion-worker 实现（Phase 1）
- [ ] MCP server（Phase 2）
