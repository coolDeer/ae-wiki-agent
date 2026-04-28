# systemd Snippets

这一层先提供最小可用的 Linux 部署骨架，目标是把 `ae-wiki-agent` 的 durable
runtime 先稳定跑起来：

- `ae-wiki-worker.service`
  常驻消费 `minion_jobs`，包括 `agent_run` 在内的后台任务都由它执行

## 用法

1. 把仓库部署到目标机器，例如 `/opt/ae-wiki-agent`
2. 确认 `bun` 可执行路径和 `EnvironmentFile` 路径正确
3. 复制 service 文件到 `/etc/systemd/system/`
4. 执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ae-wiki-worker.service
sudo systemctl status ae-wiki-worker.service
```

## 与 gbrain 的关系

这不是 gbrain 那种完整 `supervisor` 进程管理器，而是更轻的第一步：

- 进程守护交给 `systemd`
- job durability 仍然来自 Postgres 里的 `minion_jobs`
- 后续如果继续向 gbrain 靠拢，可以再把 worker 管理升级成单独的
  `jobs supervisor` 命令
