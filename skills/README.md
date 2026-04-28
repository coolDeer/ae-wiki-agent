# Skills

本目录存放项目的可复用 skill 定义，作为**规范源**（source of truth）存档。当前结构已经兼容 Codex skill 规范，可直接校验并同步安装到 Codex；同时也可继续同步到 Claude Code 的 slash command。

## 目录结构

```
skills/
├── README.md                    # 本文件
└── <skill-name>/
    └── SKILL.md                 # skill 规范（frontmatter + 正文）
```

## 现有 skill

| Skill | 用途 | 入口文件 |
|-------|------|---------|
| `ae-fetch-reports` | 从 aecapllc 平台拉取每日研究报告到 `raw/` | [ae-fetch-reports/SKILL.md](ae-fetch-reports/SKILL.md) |
| `ae-research-ingest` | Triage + 三段式 ingest（agent 写 narrative） | [ae-research-ingest/SKILL.md](ae-research-ingest/SKILL.md) |
| `ae-enrich` | 补全红链 entity（confidence='low' → 正式 wiki 页） | [ae-enrich/SKILL.md](ae-enrich/SKILL.md) |
| `ae-thesis-track` | 维护 active thesis 状态机 | [ae-thesis-track/SKILL.md](ae-thesis-track/SKILL.md) |
| `ae-daily-review` | 对当日 ingest 内容执行 7 问复盘，输出 `wiki/output/daily-review-{date}.md` | [ae-daily-review/SKILL.md](ae-daily-review/SKILL.md) |
| `ae-daily-summarize` | 把复盘转成 PM 简报，输出 `wiki/output/daily-summarize-{date}.md` | [ae-daily-summarize/SKILL.md](ae-daily-summarize/SKILL.md) |
| `ae-analyze-ideabot` | 拉取单个 IdeaBot 详情并结合 wiki 做综合分析 | [ae-analyze-ideabot/SKILL.md](ae-analyze-ideabot/SKILL.md) |
| `ae-analyze-timebot` | 拉取 TimeBot 周工时并为每位分析师生成 wiki 联动的研究建议 | [ae-analyze-timebot/SKILL.md](ae-analyze-timebot/SKILL.md) |

## 与 Codex / Claude 的关系

同一份 skill 可以有两个运行入口：

| 位置 | 作用 | 谁在维护 |
|------|------|---------|
| `skills/<name>/SKILL.md` | **规范源**，供 Codex 校验、安装、触发 | 本目录 |
| `.claude/commands/<name>.md` | Claude Code 实际识别的 slash command | 由 `skills/` 同步而来 |
| `~/.codex/skills/<name>/` | Codex 自动发现的本地 skill 安装目录 | 由 `skills/` 同步安装而来 |

**约定**：修改 skill 时优先修改 `skills/<name>/SKILL.md`，然后再同步到 `.claude/commands/<name>.md` 和 `~/.codex/skills/<name>/`。Codex 与 Claude 的入口内容应保持一致。

## 如何新增一个 skill

1. 在 `skills/<skill-name>/SKILL.md` 写规范，frontmatter 至少包含 `name` 和 `description`
2. 如需 Codex UI 元数据，在 `skills/<skill-name>/agents/openai.yaml` 写 `display_name`、`short_description`、`default_prompt`
3. 若有对应执行脚本，放到仓库的 `scripts/` 下，并在 SKILL.md 中引用
4. 如需兼容 Claude Code，再同步一份到 `.claude/commands/<skill-name>.md`
5. 如需让本机 Codex 自动发现，再安装到 `~/.codex/skills/<skill-name>/`
6. 在本 README 的"现有 skill"表格中登记
