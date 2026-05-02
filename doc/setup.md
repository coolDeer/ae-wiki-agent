# 部署 / 启动手册

> 面向新机器（开发本地 / 服务器）。覆盖从 0 到 worker 跑起来的完整步骤。
> 运维操作（查状态 / 故障处理 / 容量规划）见 `./ops-workers.md`。

---

## 适用前提

本手册假设：

- 已有可用的 **Postgres**（schema 已部署）—— 通过 `DATABASE_URL` 连接
- 已有可用的 **MongoDB**（团队上游 ResearchReportRecord）
- 已有可用的 **OpenAI API key** + 当前出口 IP **OpenAI 支持区域**（中国直连会 403）

不满足任一条都先解决，再回来跑下面步骤。

---

## 5 步跑起来

### 1. 装 Bun

项目用 Bun 1.3.13+ 做 runtime（不能用 Node，代码用了 `Bun.CryptoHasher` / `Bun.stdin.text()` 等 Bun-only API）。

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc            # 或 ~/.zshrc
bun --version               # 1.3.x
```

替代方式：`brew install oven-sh/bun/bun` (macOS) / `npm install -g bun`（已有 Node）。

### 2. 拉代码 + 装依赖

```bash
git clone <repo> ae-wiki-agent
cd ae-wiki-agent
bun install
```

### 3. 配 `.env`

```bash
cp .env.example .env
vim .env
```

必填 4 个：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 现有 Postgres 连接串 |
| `MONGODB_URI` | mongo 连接串 |
| `MONGODB_DB` | mongo 库名 |
| `OPENAI_API_KEY` | OpenAI key |

生产推荐再加：

```bash
WIKI_WORKER_RSS_LIMIT_MB=2048   # 防内存泄漏 watchdog（生产强推）
EMBEDDING_DISABLED=false         # 默认就是 false；千万别误设 true，不然搜索退化为纯 keyword
```

完整字段说明见 `.env.example` 注释或 `CLAUDE.md` 的"环境变量"章节。

### 4. 验证连通

三个 smoke test，全 ✓ 才能往下走：

```bash
bun scripts/test-pg.ts        # PG 通 + 17 张表齐 + 扩展齐
bun scripts/test-mongo.ts     # mongo 通 + ResearchReportRecord 可读
bun x tsc --noEmit   # 类型 OK
```

常见报错：

- `pgvector / pg_trgm / pgcrypto` 缺：找 DBA 装扩展
- mongo 连不上：检查 VPC / 防火墙
- tsc 报 schema 类型错：拉最新代码 + `bun install`

### 5. 起 worker

**长驻方案（推荐）**：

```bash
mkdir -p logs .runtime
nohup scripts/run-workers.sh 3 > logs/workers.log 2>&1 &
disown
```

`run-workers.sh` 起 N 个独立 supervisor，每个管 1 worker，crash 自带指数退避重启。`disown` 让进程脱离 SSH，退出 shell 不杀进程。

**验证**：

```bash
ps -ef | grep -E "supervisor|jobs:worker" | grep -v grep
# 应该看到 N 对 supervisor + worker

bun src/cli.ts jobs:supervisor status --pid-file .runtime/supervisor-1.pid
# "running": true, "status": "running", "workerPid": ...

tail -f logs/workers.log
# [worker] minion-worker 启动 (interval=2000ms, rss_limit=2048MB) ×N
```

---

## 触发日批

worker 池只是消费队列。要真的 fetch + ingest + 出 daily-review，跑日批：

### 手动一次

```bash
# 已有 worker 长驻 → 用 --keep-workers 让脚本跑完不关 worker
nohup scripts/run-daily.sh 3 --keep-workers \
  > logs/run-daily-$(date +%Y%m%d).log 2>&1 &
disown
```

### cron 定时（推荐）

每天定时跑：

```bash
crontab -e
```

```cron
# 北京 8:30 = UTC 0:30
30 0 * * * cd /home/<user>/ae-wiki-agent && \
  ./scripts/run-daily.sh 3 --keep-workers \
  >> logs/run-daily.log 2>&1
```

`run-daily.sh` 内部会：

1. 起 3 个 worker（如果你已有长驻 worker 池，新起的会**抢同一个队列**——所以要么完全交给长驻 worker（待 `worker_count=0` 支持后），要么去掉长驻）
2. fetch-reports
3. 排 ingest job 进队列
4. 等 ingest 全做完（不等下游 cascade，下游让 worker 后台跑）
5. 触发 daily-review + daily-summarize
6. `--keep-workers` 时退出，worker 池继续运行

---

## 状态查看

```bash
# 一眼看队列
bun scripts/_ops-counts.ts

# job 列表
bun src/cli.ts jobs:list --status active
bun src/cli.ts jobs:list --status waiting --limit 10
bun src/cli.ts jobs:list --status failed --limit 10

# agent 专项
bun src/cli.ts agent:list --status running

# 看每个 supervisor
for f in .runtime/supervisor-*.pid; do
  bun src/cli.ts jobs:supervisor status --pid-file "$f"
done
```

完整运维操作见 `./ops-workers.md`。

---

## 关闭

```bash
# 优雅停所有 supervisor（worker 各自 drain 手上 job 后退出）
for f in .runtime/supervisor-*.pid; do
  bun src/cli.ts jobs:supervisor stop --pid-file "$f"
done

# 或直接给 run-workers.sh 父进程 SIGTERM
pkill -TERM -f "scripts/run-workers.sh"
```

强杀（仅在卡住时用，会留 active 状态僵尸）：

```bash
pkill -KILL -f "cli.ts jobs:worker"
```

---

## 进阶：systemd 守护（可选）

`nohup + disown` 简单但没监控。生产想要"机器重启自动起 / 进程崩了再起"建议挂 systemd unit。详见 `./ops-workers.md` 的"systemd 守护"章节（待补，目前 macOS 主要用 nohup 方案）。
