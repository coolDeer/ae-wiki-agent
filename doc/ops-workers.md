# Worker / Job 队列 操作手册

> 面向运维 / on-call。覆盖 minion-worker 进程怎么起、怎么查状态、卡住怎么救。
> Schema 设计与 stage 流程见 `./architecture.md`，命令清单见 `./cli-commands.md`。

---

## 1. 心智模型（30 秒）

```
            ┌───────────────────────┐
            │  minion_jobs 表       │ ← 触发方：ingest stage 6 / cron / CLI 手挂
            │  (waiting/active/...)  │
            └───────────┬───────────┘
                        │ FOR UPDATE SKIP LOCKED
                        ↓
        ┌───────────────┴───────────────┐
        │                               │
   worker #1   worker #2   worker #3 ...（N 个独立进程，互不打架）
        │                               │
        ↓                               ↓
  pick → run → completeJob / failJob / paused
```

要点：
- 并发靠**多进程**（`SKIP LOCKED`），单进程内串行。
- 任务类型：`embed_chunks` / `detect_signals` / `enrich_entity` / `agent_run` / `lint_run` / `facts_expire`。
- 信号 SIGTERM/SIGINT 会 drain（跑完手上 job 再退）。

---

## 2. 启动 worker

### 单个 worker（前台调试用）

```bash
bun src/cli.ts worker
```

stdout 会实时打 `[worker] picked job ...` / `✓` / `FAILED`。Ctrl+C drain。

### 多并发（推荐生产）

```bash
scripts/run-workers.sh           # 默认 3 个
scripts/run-workers.sh 5         # 起 5 个
```

实际架构：bash → N 个独立 supervisor（每个 1 worker）→ 各自带 pid file
（`.runtime/supervisor-{1..N}.pid`）+ 指数退避重启。worker crash 时 supervisor
本地拉起新进程，不连坐其他 supervisor。

特点：
- 父进程 trap SIGTERM/SIGINT，forward 给所有 supervisor → supervisor 再 drain worker。
- 任一 supervisor 失败不影响其他；`wait` 阻塞到全部退出。
- 退出码：任一非零会冒泡到父进程退出码。

单独查某个 supervisor：

```bash
bun src/cli.ts jobs:supervisor status --pid-file .runtime/supervisor-1.pid

# 一次看全部
for f in .runtime/supervisor-*.pid; do
  bun src/cli.ts jobs:supervisor status --pid-file "$f"
done
```

### 后台 / 守护

```bash
# 简单粗暴：nohup + 日志
nohup scripts/run-workers.sh 3 > logs/workers.log 2>&1 &

# 也可以纯靠 supervisor 自愈，外层不用 while true 循环；
# 想加一层 systemd / launchd 挂 nohup 这条命令即可。
```

### 调多大并发？

经验法则：
- **OpenAI rate limit 是主瓶颈**：agent_run / embed_chunks 都打 OpenAI。先看你的 TPM/RPM 上限，N × 单 job QPS 不能超。
- **DB 连接**：每个 worker 进程 = 1 个 postgres-js pool。N=5 默认大约消耗 50 个连接，注意 PgBouncer / Postgres `max_connections`。
- **RSS**：每进程独立计数 `WIKI_WORKER_RSS_LIMIT_MB`（默认 0=关，生产建议 2048）。
- **起步**：日常 3，高峰 5。再多基本是浪费——队列空闲时 N 个进程都在 poll 也是负担。

---

## 3. 查状态

### 进程层

```bash
ps -ef | grep "cli.ts worker"          # 看 N 个 worker 是不是都活着
ps -o rss,pid,etime,command -p <pid>   # 看单个进程内存 / 跑了多久
```

### 队列层（最常用）

```bash
# 列表（默认 20 条）
bun src/cli.ts jobs:list --limit 20
bun src/cli.ts jobs:list --status active        # 正在跑的
bun src/cli.ts jobs:list --status waiting       # 排队中
bun src/cli.ts jobs:list --status failed
bun src/cli.ts jobs:list --status paused
bun src/cli.ts jobs:list --name agent_run --status active

# 单个 job 详情（含 progress / result / error / data）
bun src/cli.ts jobs:get <job_id>
```

### Agent runtime 专项

`agent_run` job 跑起来后还有自己的对话历史 / tool 调用记录：

```bash
bun src/cli.ts agent:list --status running --limit 20
bun src/cli.ts agent:list --skill ae-enrich
bun src/cli.ts agent:get <job_id>     # 看 agent_messages / agent_tool_executions
```

### 一眼看健康（SQL 聚合）

CLI 没有内置 dashboard，最直接的是 psql：

```sql
-- 队列分布
SELECT name, status, COUNT(*)
FROM minion_jobs
WHERE deleted = 0
GROUP BY 1, 2
ORDER BY 1, 2;

-- 最近 1 小时失败的
SELECT id, name, attempts, max_attempts,
       LEFT(error, 80) AS err_head, finished_at
FROM minion_jobs
WHERE status = 'failed'
  AND deleted = 0
  AND finished_at > NOW() - INTERVAL '1 hour'
ORDER BY finished_at DESC;

-- 卡住超 30 分钟的 active job（worker 死了但 status 没回滚）
SELECT id, name, started_at, AGE(NOW(), started_at) AS stuck_for
FROM minion_jobs
WHERE status = 'active'
  AND deleted = 0
  AND started_at < NOW() - INTERVAL '30 minutes'
ORDER BY started_at;

-- 队列堆积：waiting 超过 1 小时的
SELECT name, COUNT(*), MIN(create_time) AS oldest
FROM minion_jobs
WHERE status = 'waiting' AND deleted = 0
GROUP BY name
HAVING MIN(create_time) < NOW() - INTERVAL '1 hour';
```

### 实时盯

```bash
watch -n 2 "bun src/cli.ts jobs:list --status active --limit 10"
```

或者直接 tail worker stdout（前面 `nohup ... > logs/workers.log` 那行）：

```bash
tail -f logs/workers.log
```

---

## 4. 干预 job

```bash
bun src/cli.ts jobs:pause   <job_id> [--reason "..."]    # 让 active 变 paused
bun src/cli.ts jobs:resume  <job_id>                     # paused → waiting，等下次 pick
bun src/cli.ts jobs:cancel  <job_id> [--reason "..."]    # 永久 cancel
bun src/cli.ts jobs:retry   <job_id>                     # failed/cancelled → waiting
```

注意：
- `pause` 是协作式——`agent_run` 的 supervisor 会在下一次 turn 检查 paused flag 后退出（抛 `JobPausedError`）；`embed_chunks` / `detect_signals` 这类一次性任务无法中途暂停，得等跑完。
- `cancel` 同理：协作式。如果想强行干掉一个失控的 agent_run，先 `cancel`，然后 kill worker 进程让 supervisor 重启时不再 pick 它。

---

## 5. 常见故障 & 处理

### Q1：worker 进程在但不消费 job

诊断：

```bash
# 1. 队列里有没有 waiting？
bun src/cli.ts jobs:list --status waiting --limit 5

# 2. 是不是被 EMBEDDING_DISABLED 跳掉了？
echo $EMBEDDING_DISABLED         # 应该是 false 或空
# worker 跳 embed_chunks 的逻辑见 worker.ts:33

# 3. 有没有 active 卡死占着位（按 SQL "卡住超 30 分钟" 那条查）
```

修：
- waiting 但 worker 不动 → 重启 worker（kill + run-workers.sh）
- 一堆 stuck active → 之前 worker crash 没清状态。手动改回 waiting：
  ```sql
  UPDATE minion_jobs
  SET status = 'waiting', started_at = NULL, update_time = NOW()
  WHERE status = 'active' AND deleted = 0
    AND started_at < NOW() - INTERVAL '30 minutes';
  ```

### Q2：worker RSS 涨爆 / OOM

症状：进程 RSS 几小时从 ~70MB 涨到几个 GB（已知问题，watchdog 已上）。

修：
- 配 `WIKI_WORKER_RSS_LIMIT_MB=2048`（在 `.env`）。watchdog 会在阈值时把 `running=false` 让主循环退出，外层 systemd / `while true` 拉起新进程。详见 worker.ts:298-327。
- 没有外层 restart 时，可以 `crontab` 每小时 `pkill -TERM -f "cli.ts worker"` + `scripts/run-workers.sh 3`。

### Q3：某类 job 持续 FAIL

```bash
bun src/cli.ts jobs:list --status failed --name <name> --limit 10
bun src/cli.ts jobs:get <job_id>          # 看 error 栈
```

常见原因：
- `embed_chunks`：OpenAI 429 / 网络。worker 自带 retry（attempts < maxAttempts 时回 waiting），等 rate limit 过了自然恢复。
- `agent_run`：agent 工作流问题（skill prompt / tool 调用错）。看 `agent_messages` / `agent_tool_executions` 复盘：
  ```bash
  bun src/cli.ts agent:get <job_id>
  ```
- `enrich_entity`：通常因为目标 page 已经被人手动 enrich 过了（confidence 不再 low），handler 会自己返回 noop status，不会 fail。

### Q4：手挂一个维护任务

```bash
# Lint 全表
bun src/cli.ts lint:run

# 让某个 fact 过期
bun src/cli.ts facts:expire --age-days 90
```

也可以入队让 worker 跑：

```sql
INSERT INTO minion_jobs (name, status, data, priority, ...)
VALUES ('lint_run', 'waiting', '{"staleDays": 30}', 50, ...);
```

实操还是 CLI 直跑省事。

---

## 6. 关闭 / 重启

如果是用 `scripts/run-workers.sh` 起的（推荐路径），优先按 supervisor 走：

```bash
# 优雅关每个 supervisor（自动 drain 其 worker，删 pid file）
for f in .runtime/supervisor-*.pid; do
  bun src/cli.ts jobs:supervisor stop --pid-file "$f"
done

# 或者 trap 路径：直接给 run-workers.sh 父进程 SIGTERM
# （它会 forward 给所有 supervisor）
kill -TERM <run-workers.sh PID>
```

如果是裸 `bun src/cli.ts worker`（无 supervisor）：

```bash
# 优雅关：drain 完手上 job 再退
pkill -TERM -f "cli.ts jobs:worker"

# 强杀（仅在 drain 卡住时用——会留下 active 状态，需要手动清）
pkill -KILL -f "cli.ts jobs:worker"
```

部署节奏建议：
1. 先 stop（按上面方式）。
2. 等几秒确认进程都退（`ps -ef | grep -E "supervisor|jobs:worker"` 应没输出）。
3. 重启 `scripts/run-workers.sh N`。

---

## 7. 容量规划速查表

| 场景 | N | 备注 |
|---|---|---|
| 本地开发 | 1 | 前台跑 `bun src/cli.ts worker`，看 log 直接 |
| 日常生产 | 3 | `scripts/run-workers.sh` 默认 |
| 高峰 / 大批 ingest | 5-8 | 同时盯紧 OpenAI quota + DB 连接 |
| 只跑 enrich 批量 | 2-3 | enrich 内部还会再起 agent_run，并发本身就放大了 |

---

## 8. 相关文件 / 阅读

- `src/core/minions/worker.ts` — 主循环 + watchdog
- `src/core/minions/queue.ts` — addJob / completeJob / failJob 等队列原语
- `src/agents/runtime.ts` — agent_run 的 supervisor / pause / cancel 语义
- `scripts/run-workers.sh` — 多进程启动脚本
- `./architecture.md` — ingest stage 6 触发哪些 job
- `./llm-touchpoints.md` — 哪些 job 调 LLM、调几次
