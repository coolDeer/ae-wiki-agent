# ae-wiki CLI 命令说明

本文档汇总 `src/cli.ts`、`src/commands/agent.ts`、`src/commands/jobs.ts` 的全部命令。

## 运行方式

推荐先在项目根目录执行一次：

```bash
bun link
```

执行后可直接使用：

```bash
ae-wiki <command> [args...]
```

如果你的 shell 仍然找不到 `ae-wiki`，请临时使用：

```bash
bun src/cli.ts <command> [args...]
```

下文示例默认写成 `ae-wiki ...`，你可替换为 `bun src/cli.ts ...`。

---

## 全局帮助

```bash
ae-wiki --help
ae-wiki -h
ae-wiki help
```

---

## 1) 数据拉取

### `fetch-reports`

从上游同步研报元数据到 `raw_files` 队列。

```bash
ae-wiki fetch-reports [YYYY-MM-DD] [--date YYYY-MM-DD] [--all] [--limit N] [--dry-run]
```

- `YYYY-MM-DD`（位置参数）：按日期拉取（格式必须为 `YYYY-MM-DD`）
- `--date YYYY-MM-DD`：同上，显式传参
- `--all`：回到全量模式
- `--limit N`：限制条数
- `--dry-run`：只预览，不落库

示例：

```bash
ae-wiki fetch-reports 2026-04-29 --limit 50
ae-wiki fetch-reports --date 2026-04-29 --dry-run
```

---

## 2) Ingest（研报入库三段式）

推荐流程：`ingest:peek -> ingest:pass|commit|brief -> ingest:write -> ingest:finalize`

### `ingest:peek`

预览下一份待处理 raw，不写库。

```bash
ae-wiki ingest:peek
```

返回字段包含：`rawFileId`、`markdownUrl`、`title`、`researchType`、`preview`。

### `ingest:pass`

判定该 raw 无关，标记跳过（不建 page）。

```bash
ae-wiki ingest:pass <raw_file_id> --reason "..."
```

可选：
- `--actor <name>`（默认 `agent:claude`）

### `ingest:commit`

判定该 raw 值得入库，创建 `source` 页面骨架。

```bash
ae-wiki ingest:commit <raw_file_id>
```

### `ingest:brief`

判定该 raw 为轻量前沿动态，创建 `brief` 页面骨架。

```bash
ae-wiki ingest:brief <raw_file_id>
```

### `ingest:write`

从 stdin 读取 narrative，写入 `pages.content` 与 `page_versions`。

```bash
ae-wiki ingest:write <page_id> < narrative.md
```

### `ingest:finalize`

执行 Stage 4-8（links/facts/jobs/timeline/thesis）。

```bash
ae-wiki ingest:finalize <page_id>
```

### 兼容命令

#### `ingest:next`（legacy）

历史兼容入口：`peek + 自动 commit`。

```bash
ae-wiki ingest:next
```

#### `ingest:skip`

兜底回滚：commit 后发现不该入库，清理 page 并标记 raw。

```bash
ae-wiki ingest:skip <page_id> --reason "..."
```

可选：
- `--actor <name>`（默认 `agent:claude`）

#### `ingest`（已废弃）

```bash
ae-wiki ingest
```

该命令会直接报错并提示改用三段式。

---

## 3) Agent Runtime（durable）

> 说明：`agent:run` 是“入队 `agent_run` job”，需要 worker/supervisor 消费。

### `agent:run`

提交一个 agent 任务。

```bash
ae-wiki agent:run --skill <skill> [--prompt "..."] [--model X] [--max-turns N] [--follow]
```

- `--skill`：必填，指向 `skills/<skill>/SKILL.md`
- `--prompt`：覆盖默认提示词
- `--model`：覆盖默认模型
- `--max-turns`：最大轮次
- `--follow`：轮询到终态后输出最终 job

### `agent:list`

```bash
ae-wiki agent:list [--status S] [--skill X] [--limit N]
```

`--status` 可选值：
- `waiting`
- `active`
- `paused`
- `completed`
- `failed`
- `cancelled`

### `agent:show`

查看单个 job 详情。

```bash
ae-wiki agent:show <job_id>
```

### `agent:logs`

查看 transcript（messages + tool executions）。

```bash
ae-wiki agent:logs <job_id>
```

### `agent:replay`

用历史 job 参数创建一个新 job。

```bash
ae-wiki agent:replay <job_id> [--follow]
```

### `agent:pause`

```bash
ae-wiki agent:pause <job_id> [--reason "..."]
```

### `agent:resume`

```bash
ae-wiki agent:resume <job_id>
```

### `agent:cancel`

```bash
ae-wiki agent:cancel <job_id> [--reason "..."]
```

---

## 4) Jobs 队列与 Worker

### `worker`（兼容入口）

等价于 `jobs:worker`。

```bash
ae-wiki worker
```

### `jobs:worker`

前台启动 worker 消费队列。

```bash
ae-wiki jobs:worker
```

### `jobs:supervisor`

管理守护进程。

```bash
ae-wiki jobs:supervisor start [--detach] [--pid-file PATH]
ae-wiki jobs:supervisor status [--pid-file PATH]
ae-wiki jobs:supervisor stop [--pid-file PATH]
```

### `jobs:list`

```bash
ae-wiki jobs:list [--status S] [--name N] [--limit N]
```

### `jobs:get`

```bash
ae-wiki jobs:get <job_id>
```

### `jobs:pause`

```bash
ae-wiki jobs:pause <job_id> [--reason "..."]
```

### `jobs:resume`

```bash
ae-wiki jobs:resume <job_id>
```

### `jobs:cancel`

```bash
ae-wiki jobs:cancel <job_id> [--reason "..."]
```

### `jobs:retry`

重试非 active 状态的 job，置回 `waiting`。

```bash
ae-wiki jobs:retry <job_id>
```

---

## 5) Enrich（红链补全）

### `enrich:list`

列出待 enrich 的 low-confidence 实体。

```bash
ae-wiki enrich:list [--type T] [--limit N]
```

`--type` 可选：`company | industry | concept | thesis | output`

### `enrich:next`

取下一条候选及 backlink 上下文。

```bash
ae-wiki enrich:next [--type T] [--skip N]
```

### `enrich:save`

从 stdin 写 narrative，并更新实体元数据。

```bash
ae-wiki enrich:save <page_id> [--ticker X] [--sector Y] [--sub-sector Z] [--country C] [--exchange E] [--aliases A,B] [--confidence high|medium|low] < narrative.md
```

---

## 6) Thesis（投资论点状态机）

### `thesis:list`

```bash
ae-wiki thesis:list [--status S] [--direction D] [--limit N]
```

- `--status`：`active | monitoring | closed | invalidated`
- `--direction`：`long | short | pair | neutral`

### `thesis:show`

```bash
ae-wiki thesis:show <page_id>
```

### `thesis:open`

新建论点骨架。

```bash
ae-wiki thesis:open --target <slug> --direction long|short|pair|neutral --name "X" [--conviction high|medium|low] [--owner X] [--price-open X] [--date-opened YYYY-MM-DD]
```

### `thesis:write`

从 stdin 写 narrative。

```bash
ae-wiki thesis:write <page_id> < thesis.md
```

### `thesis:update`

更新状态、信念、催化剂或验证条件。

```bash
ae-wiki thesis:update <page_id> [--conviction high|medium|low] [--status active|monitoring|closed|invalidated] [--add-catalyst '{"date":"...","event":"...","expected_impact":"..."}'] [--mark-condition 'CONDITION:STATUS[:signal_id]'] [--owner X] [--reason "..."]
```

`--mark-condition` 中 `STATUS` 可选：`pending | met | unmet | invalidated`

### `thesis:close`

归档并关闭论点。

```bash
ae-wiki thesis:close <page_id> --reason validated|invalidated|stop_loss|manual [--price-close X] [--date-closed YYYY-MM-DD] [--note "..."]
```

---

## 7) 维护与重跑

### `facts:re-extract`

重跑单页 Stage 5 facts 抽取。

```bash
ae-wiki facts:re-extract <page_id>
```

### `links:re-extract`

重跑单页 Stage 4 links 抽取。

```bash
ae-wiki links:re-extract <page_id>
```

### `lint:run`

执行健康检查并写 `events(action='lint_run')`。

```bash
ae-wiki lint:run [--stale-days N] [--raw-age-days N] [--fact-age-days N] [--sample N]
```

### `facts:expire`

将超过阈值天数的 latest facts 设置 `valid_to`（默认 90 天）。

```bash
ae-wiki facts:expire [--age N]
```

---

## 8) Web UI

### `web`

启动只读 Web UI。

```bash
ae-wiki web [--port 3000]
```

说明：该命令常驻，不会自动退出。

---

## 9) 常见问题

### Q1: `zsh: command not found: ae-wiki`

请先在项目根目录执行：

```bash
bun link
```

如果执行后当前终端仍未生效，开一个新终端再试；也可先临时改用：

```bash
bun src/cli.ts <command>
```

### Q1.1: 如何撤销 `bun link`？

在项目目录执行：

```bash
bun unlink ae-wiki-agent
```

或：

```bash
bun unlink
```

说明：执行后建议开一个新终端，避免当前 shell 缓存旧命令路径。

### Q2: `agent:run --follow` 一直不结束

通常是没有 worker 在消费 job。请先启动：

```bash
ae-wiki jobs:worker
# 或
ae-wiki jobs:supervisor start --detach
```

### Q3: 命令执行后就退出，是否正常？

正常。CLI 默认是“一次一个命令，执行即退出”；`web`、`jobs:worker` 这类是常驻命令。

