# 调度（cron）总览

ae-wiki 有两层调度，**职责严格分离**：

| 层 | 跑什么 | 调度方 | 何时用 |
|---|---|---|---|
| **OS 层（launchd）** | 纯脚本：`fetch-reports` / `worker` daemon | macOS launchd | 不需要 agent 思考的任务 |
| **Agent 层（Claude Code `/schedule`）** | 需要 LLM 推理的 skill：`$ae-research-ingest` / `$ae-daily-review` 等 | Claude Code harness | 需要 agent 写 narrative / 复盘的任务 |

两层有时序依赖：OS 层先把数据拉下来，agent 层第二天醒来发现有新 raw 待 ingest。

---

## 一、OS 层（launchd） —— 一键安装

### 安装

```bash
cd ae-wiki-agent
./scripts/cron/install-launchd.sh
```

会做这些事：
1. 在 `~/Library/LaunchAgents/` 创建 2 个 plist（替换好你的项目路径）
2. `launchctl bootstrap` 加载它们
3. `worker` 立刻启动并 KeepAlive；`fetch-reports` 等明早 8 点

### 现在跑了什么

```bash
launchctl print gui/$(id -u)/com.ae-wiki.worker         # 看 worker 状态
launchctl print gui/$(id -u)/com.ae-wiki.fetch-reports  # 看 fetch 状态
```

### 立刻触发一次 fetch（不等 8 点）

```bash
launchctl kickstart -p gui/$(id -u)/com.ae-wiki.fetch-reports
tail -f ~/Library/Logs/ae-wiki/fetch-reports.log
```

### 卸载

```bash
./scripts/cron/uninstall-launchd.sh
# 日志保留在 ~/Library/Logs/ae-wiki/
```

### 调整时间 / 频率

直接改 `infra/launchd/com.ae-wiki.fetch-reports.plist` 里的 `StartCalendarInterval`，再跑一次 `install-launchd.sh`（installer 是幂等的，自动 bootout 旧版重 load）。

例如改成"每 4 小时跑一次"：

```xml
<key>StartInterval</key>
<integer>14400</integer>  <!-- 4 hours in seconds -->
```

（删掉 `StartCalendarInterval` 那段，换成 `StartInterval`）

---

## 二、Agent 层（Claude Code `/schedule`）

OS 层无法跑 `$ae-research-ingest` 这种需要 agent 写 narrative 的任务——那需要 Claude Code 这个 LLM runtime。

用 Claude Code 内置的 `/schedule` skill：

### 推荐时间表

```
06:00  OS 层：fetch-reports  → mongo 拉新 raw_files
       ↓
       (launchd 自动跑，agent 还在睡)
       ↓
09:00  Agent 层：$ae-research-ingest 循环跑完所有 pending raw_files
       ↓
       (agent 根据 raw markdown 写 narrative，落库)
       ↓
17:00  Agent 层：$ae-daily-review → $ae-daily-summarize
       ↓
       (PM 下班前看到当天复盘 + 简报)
```

注意 OS 层我设的是 8 点，比 agent 9 点早 1 小时，给 fetch 充足的时间跑完。

### Claude Code 端配置

在 Claude Code 里打：

```
/schedule 9:00 daily $ae-research-ingest
/schedule 17:00 daily $ae-daily-review && $ae-daily-summarize
```

`/schedule` 会注册到 Claude Code 的 trigger 系统，每天准时唤醒一个 Claude session 跑这些 skill。

也可以指定具体 skill 选项：

```
/schedule 9:00 daily ingest 当天所有 pending raw_files，每篇都按 skills/research-ingest/SKILL.md 流程跑
/schedule 17:00 daily 跑 daily-review 然后 daily-summarize
```

### 用 `$schedule list` 查看

```
/schedule list
```

输出当前注册的所有定时任务。

### 取消

```
/schedule remove <id>
```

---

## 三、完整周末流程图

```
                                    [周一]
                                       ↓
06:00 ── launchd ── fetch-reports ── 50 篇 raw_files 落到 raw/2026-04-XX/...
                                       ↓
                                  raw_files 表 +50 行（ingested_at IS NULL）
                                       ↓
        24/7 ── launchd ── worker ── 后台跑 embed_chunks（需要 EMBEDDING 开启时）/ detect_signals
                                       ↓
09:00 ── Claude Code ── $ae-research-ingest ── 循环 ingest:next → write → finalize
                                       ↓
                                  pages +50 / facts +N / signals +M / timeline +K
                                       ↓
12:00 ── PM 上班 ── $ae-thesis-track list --status active
                  ── 看哪些 active thesis 被新 source 影响
                                       ↓
17:00 ── Claude Code ── $ae-daily-review ── 7 问 epistemic 复盘
                  ── $ae-daily-summarize ── PM 简报（含 sizing/止损/路演要点）
                                       ↓
                                  wiki/output/daily-{review,summarize}-{date}.md
                                       ↓
                                  PM 周末看完，决定下周操作
```

---

## 四、故障排查

### launchd job 没跑

```bash
# 先看注册了没
launchctl print gui/$(id -u)/com.ae-wiki.fetch-reports

# 看错误日志
tail -50 ~/Library/Logs/ae-wiki/fetch-reports.err.log

# 看启动的 PATH 是否对
cat ~/Library/LaunchAgents/com.ae-wiki.fetch-reports.plist | grep ProgramArguments -A 3
```

常见问题：
- **`bun: command not found`** → `scripts/cron/fetch-reports.sh` 已经 export 了 `~/.bun/bin`，如果还报错说明 bun 装在别的位置，改 sh 文件
- **`.env` 没读到** → bun 自动读 cwd 下的 .env；plist 里 `WorkingDirectory` 已设，应该 OK
- **macOS 沉睡时不跑** → 笔记本合盖时 launchd 也停。Power Nap 不一定够。固定时间任务推荐用台式机/服务器或者 Hammerspoon

### worker 反复崩溃

```bash
tail -f ~/Library/Logs/ae-wiki/worker.err.log
```

`KeepAlive=true` + `ThrottleInterval=10` 会拉起，但崩 10 次以上 launchd 自己会停。需要：
1. 修代码
2. 重新跑 install-launchd.sh

### Agent 层定时没触发

Claude Code `/schedule` 依赖 Claude Code 在线（不是后台进程，是 daemon-style 服务）。检查：
1. Claude Code 是否在系统启动后保持运行
2. `/schedule list` 看 trigger 是否还在
3. 有没有时区错配（Claude Code 用本机时区）

---

## 五、CI/Linux 部署

如果未来上 Linux 服务器，把 launchd 换成 systemd：

```ini
# /etc/systemd/system/ae-wiki-fetch.service
[Unit]
Description=ae-wiki fetch-reports
After=network.target

[Service]
Type=oneshot
WorkingDirectory=/srv/ae-wiki/ae-wiki-agent
ExecStart=/srv/ae-wiki/ae-wiki-agent/scripts/cron/fetch-reports.sh
User=ae-wiki

# /etc/systemd/system/ae-wiki-fetch.timer
[Unit]
Description=Run ae-wiki fetch-reports daily

[Timer]
OnCalendar=*-*-* 08:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

worker 同理（`Type=simple` + `Restart=always`）。

shell 脚本（`scripts/cron/*.sh`）跨平台直接复用。

---

## 六、不在本文档范围

- Anthropic / OpenAI API 配额报警 → 装个 datadog / sentry
- 数据库备份 → DBA 配 pg_dump cron
- 上游 mongo 监控 → 数据源方负责
