---
name: fetch-reports
description: 从 aecapllc 研究平台拉取每日研究内容到 raw/ 目录。接受可选日期参数（YYYY-MM-DD），默认当天（Asia/Shanghai）。按 {date}/{researchTypeName} 组织文件，每份文件同目录写一份 {filename}.meta.json sidecar 记录 research_id/research_type/title/parse_status 等元数据，按 parseStatus 分流（completed 才下载，pending/processing 等下次运行，failed 警告），不重复下载已存在文件。
metadata:
  short-description: 拉取指定日期的研究报告到 raw/
---

# fetch-reports

从 aecapllc 研究平台获取每日研究内容并下载到 `raw/` 目录。

## 触发方式

- 显式调用：`$fetch-reports 2026-04-14`
- 不带参数：`$fetch-reports`
- 自然语言也可触发，例如“拉取今天的研报到 raw/”

## 用途

每日研究的入口 skill：
- 分析师早上通过此 skill 拉取前一天/当天的新增研究报告
- 定时任务可直接调用底层脚本，无人值守拉取
- 拉取完成后交由 `AGENTS.md` / `CLAUDE.md` 中定义的 ingest 工作流处理

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `$ARGUMENTS` | 否 | 日期 `YYYY-MM-DD`，留空则拉取当天（Asia/Shanghai） |

## 依赖

- 仅依赖 Python 3 标准库，无需 pip 安装任何包
- 需要项目根目录存在 `raw/` 和 `scripts/fetch_reports.py`

## 执行步骤

1. **运行拉取脚本**

   - `$ARGUMENTS` 为空：
     ```bash
     python3 scripts/fetch_reports.py
     ```
   - `$ARGUMENTS` 有值：
     ```bash
     python3 scripts/fetch_reports.py $ARGUMENTS
     ```

2. **脚本行为**

   - 调用 `GET https://api.aecapllc.com/aecapllc-service/agent/research/daily/list?date=...`（成功 code = 200）
   - 遍历 `data[]`，按 `parseStatus` 分流（mineru 解析状态机：pending → processing → completed / failed）：
     - `completed` + `parsedMarkdownS3` 非空 → 下载到 `raw/{date}/{researchTypeName}/{原始文件名}.md`
     - `pending` / `processing` → 跳过（解析中；下次运行会拿到，sync 任务每天 1am+8pm 双跑）
     - `failed` → 警告并跳过（需人工介入）
     - `completed` 但 `parsedMarkdownS3` 为空 → 异常情况，记录但跳过
   - 每份下载文件同目录写 `{原始文件名}.md.meta.json` sidecar，字段：
     - **向后兼容（CLAUDE.md 去重 key）**：`research_id` / `research_type` / `title` / `md_url` / `fetched_at` / `raw`
     - **新版 API 新增**：`record_id`（ResearchReportRecord 主键，对应 `_id`）/ `parse_status` / `report_url`（原始 docx/pdf URL）/ `parsed_content_list_s3` / `update_time` / `create_time`
   - 若文件已存在但 sidecar 缺失，会自动补写
   - 已存在的文件不会重复下载（幂等）
   - 打印统计：新下载 / 已存在 / 解析中 / 解析失败 / 无 md / 下载失败 + 按状态/类型汇总

3. **处理结果**

   脚本运行后向用户报告：
   - 本次新下载了多少份报告
   - 按 `researchTypeName` 分类列出新增文件
   - 询问用户是否立即对新文件执行 ingest 流程（遵循 `AGENTS.md` / `CLAUDE.md` 中 ingest 工作流）

## 重要约束

- **不要** 在未确认的情况下直接 ingest——先让用户看到新文件清单，由用户决定是否继续
- 下载失败时脚本会继续处理其他文件，不要因为个别失败就中断整个流程
- 脚本已禁用 SSL 证书校验，以兼容 macOS Homebrew Python 的证书问题
- `pending` / `processing` 状态的报告**下一次运行会自动拉到**（mineru 解析完成后状态推进到 `completed`），无需特殊处理；如果连续多天都看到同一份卡在 `pending`，可能是 mineru 解析端出问题
- 平台 sync 任务每天 1am 同步前一天数据、20:00 同步当天数据；早上跑 fetch 拿前一天最完整，晚上跑当天可能仍有解析中的

## 相关文件

- `scripts/fetch_reports.py` — 拉取逻辑实现
- `.claude/commands/fetch-reports.md` — Claude Code 的 slash command 入口（如需兼容 Claude）
- `AGENTS.md` / `CLAUDE.md` — ingest 工作流定义
