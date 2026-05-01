#!/usr/bin/env bun
/**
 * ae-wiki CLI 入口
 *
 * Ingest triage 流程（gbrain "thin harness, fat skill" 模式）：
 *   ae-wiki ingest:peek                              # 看下一份 raw（不写库），返回 V2 信号 + preview
 *   ae-wiki ingest:commit <raw_id>                   # 深度 source（建 page type=source）
 *   ae-wiki ingest:brief  <raw_id>                   # 轻量 brief（建 page type=brief）
 *   ae-wiki ingest:pass   <raw_id> --reason "..."    # 噪声跳过（不建 page）
 *   ae-wiki ingest:write  <id> --file file.md        # 从文件读 narrative 落库
 *   ae-wiki ingest:finalize <id>                     # 跑 Stage 4-8 收尾（断点可续）
 *
 * 编排 skill：skills/ae-research-ingest/SKILL.md（agent 读后执行）。
 *
 * skill 模块按需 dynamic import，避免没填 env 时 help 也跑不起来。
 */

const cmd = process.argv[2];
const args = process.argv.slice(3);

function getFlag(name: string): boolean {
  return args.includes(name);
}
function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}
function jsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, current) => (typeof current === "bigint" ? current.toString() : current),
    2
  );
}

function printHelp(): void {
  console.log(`Usage:
  ae-wiki fetch-reports [YYYY-MM-DD] [--date YYYY-MM-DD] [--all] [--limit N] [--dry-run]
                                          # 默认拉昨天（按 createTime，本地时区）；--all 回到旧的全量模式

  # —— Triage 流程（推荐）：peek → pass | commit → write → finalize ——
  ae-wiki ingest:peek                     # 列下一份候选 raw 的预览（不写库）
  ae-wiki ingest:pass <raw_file_id> --reason "..."
                                          # peek 后判定无关：标 raw_file skip（不建 page）
  ae-wiki ingest:commit <raw_file_id>     # peek 后判定值得（核心投资素材）：建 page (type=source)
  ae-wiki ingest:brief <raw_file_id>      # peek 后判定为前沿动态（弱相关）：建 page (type=brief)
  ae-wiki ingest:write <page_id> [--file <path>]  # 从 --file 或 stdin 读 narrative，落 pages.content + page_versions
  ae-wiki ingest:finalize <page_id>       # 跑 Stage 4-8 收尾

  # —— 兜底 / 升级 ——
  ae-wiki ingest:skip <page_id> --reason "..."
                                          # commit/brief 后才发现不对（清理 page + 标 raw_file）
  ae-wiki ingest:promote <page_id>        # brief → source：改 type/slug，老 stage_done 软删，等待重写 narrative

  ae-wiki worker                          # minion-worker 后台进程（兼容入口）
  ae-wiki verify-schema                   # 跑完 migration 后自查表/列；缺列自愈

  # —— Durable agent runtime ——
  ae-wiki agent:run --skill <skill> [--prompt "..."] [--model X] [--max-turns N] [--follow]
  ae-wiki agent:list [--status S] [--skill X] [--limit N]
  ae-wiki agent:show <job_id>
  ae-wiki agent:logs <job_id>
  ae-wiki agent:replay <job_id> [--follow]
  ae-wiki agent:pause <job_id> [--reason "..."]
  ae-wiki agent:resume <job_id>
  ae-wiki agent:cancel <job_id> [--reason "..."]
  ae-wiki jobs:worker
  ae-wiki jobs:supervisor start [--detach] [--pid-file PATH]
  ae-wiki jobs:supervisor status [--pid-file PATH]
  ae-wiki jobs:supervisor stop [--pid-file PATH]
  ae-wiki jobs:list [--status S] [--name N] [--limit N]
  ae-wiki jobs:get <job_id>
  ae-wiki jobs:pause <job_id> [--reason "..."]
  ae-wiki jobs:resume <job_id>
  ae-wiki jobs:cancel <job_id> [--reason "..."]
  ae-wiki jobs:retry <job_id>

  ae-wiki enrich:list [--type T] [--limit N]    # 列出待 enrich 的红链 entity
  ae-wiki enrich:next [--type T] [--skip N]     # 取下一个红链 + backlink 上下文
  ae-wiki enrich:save <page_id> [--display-name X] [--ticker X] [--sector Y] [--confidence high|medium]
                       [--aliases A,B,C]               # 默认：merge 进现有 aliases（case-insensitive 去重）
                       [--aliases-replace A,B,C]       # 显式完全覆盖（与 --aliases / --aliases-remove 互斥）
                       [--aliases-remove X,Y]          # 从现有 aliases 删除指定项（可与 --aliases 组合）
                                                # 从 stdin 读 narrative 落库 + 更新元数据
  ae-wiki enrich:retype <page_id> --new-type company|industry|concept|thesis [--new-slug X] [--reason "..."]
                                                # 红链 type 错了（companies/Trainium → concepts/Trainium）
                                                # 默认仅换 dir 前缀；--new-slug 完整覆盖
  ae-wiki enrich:retrigger [--min-score N=0.5] [--min-backlinks N=3] [--min-new-backlinks N=2]
                       [--type T] [--limit N=30] [--dry-run] [--json]
                                                # 找完整度低 + backlink 多 + 新增 backlink 多的 page 重 enqueue
                                                # 解决"NVIDIA 永久 conf=low"问题

  ae-wiki thesis:list [--status S] [--direction D]                   # 列论点
  ae-wiki thesis:show <page_id>                                      # 单论点诊断（含 facts/signals）
  ae-wiki thesis:open --target <slug> --direction long|short|pair|neutral --name "X"
                       [--conviction high|medium|low] [--owner X]
                       [--price-open X] [--date-opened YYYY-MM-DD]   # 建论点骨架
  ae-wiki thesis:write <page_id>                                     # stdin 写 narrative
  ae-wiki thesis:update <page_id> [--conviction X] [--status X]
                       [--add-catalyst '{"date":...,"event":...,"expected_impact":...}']
                       [--mark-condition 'CONDITION:STATUS[:signal_id]']
                       [--reason X]                                  # 仅状态变更
  ae-wiki thesis:close <page_id> --reason validated|invalidated|stop_loss|manual
                       [--price-close X] [--date-closed YYYY-MM-DD]
                       [--note "retrospective text"]                 # 归档

  ae-wiki facts:re-extract <page_id>      # 重跑 Stage 5（针对单页）
  ae-wiki links:re-extract <page_id>      # 重跑 Stage 4（针对单页）

  # —— Web UI ——
  ae-wiki web [--port 3000]               # 启动只读 web UI（home / search / page / theses / entities / outputs / queue）

  # —— 维护任务（也可作为 minion job 跑：lint_run / facts_expire） ——
  ae-wiki lint:run [--stale-days N] [--raw-age-days N] [--fact-age-days N] [--sample N]
                                          # 跑 5 项健康检查 + 写 events(action='lint_run')
  ae-wiki orphans [--type T] [--confidence low|medium|high] [--min-age-days N] [--limit N] [--json]
                                          # 列出无入站 link 的实体页（red-link explosion 诊断）
                                          # 默认 type ∈ {company,industry,concept,thesis}，--json 输出结构化数据
  ae-wiki duplicates [--type T] [--min-sim 0.7] [--limit N] [--json]
                                          # 找潜在重复实体（trgm > 阈值 + 同 type）
                                          # 离线 lint，不写 events；agent / 人工 review 后用 enrich:retype 合并
  ae-wiki facts:expire [--age N]          # 把 period_end 已过 N 天 (默认 90) 的 latest fact 标 valid_to

  ae-wiki --help

参考：
  skills/ae-research-ingest/SKILL.md  研报 ingest 编排
  skills/ae-enrich/SKILL.md           红链补全编排
  skills/ae-thesis-track/SKILL.md     投资论点状态机`);
}

async function main(): Promise<void> {
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    process.exit(0);
  }

  switch (cmd) {
    case "fetch-reports": {
      const { fetchReports } = await import("./skills/fetch-reports/index.ts");
      const limit = getArg("--limit");
      const positional = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
      const dateFlag = getArg("--date");
      const date = dateFlag ?? positional;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.error(`fetch-reports 的位置参数必须是 YYYY-MM-DD（收到 "${date}"）`);
        process.exit(1);
      }
      const result = await fetchReports({
        limit: limit ? parseInt(limit, 10) : undefined,
        dryRun: getFlag("--dry-run"),
        date,
        all: getFlag("--all"),
      });
      console.log("\n[fetch-reports] 完成:", result);
      break;
    }

    case "ingest":
    case "ingest:next": {
      console.error(
        "命令 `ingest` / `ingest:next` 已下线。改用 triage 流程：\n" +
          "  ingest:peek → ingest:commit | ingest:brief | ingest:pass → ingest:write → ingest:finalize\n" +
          "见 skills/ae-research-ingest/SKILL.md"
      );
      process.exit(1);
    }

    case "ingest:peek": {
      const { ingestPeek } = await import("./skills/ingest/index.ts");
      const result = await ingestPeek();
      if (!result) {
        console.log("(没有待处理的 raw_files)");
        process.exit(0);
      }
      console.log(
        jsonStringify({
          rawFileId: result.rawFileId.toString(),
          markdownUrl: result.markdownUrl,
          title: result.title,
          researchType: result.researchType,
          rawCharCount: result.rawCharCount,
          preview: result.preview,
          hasContentListV2: result.hasContentListV2,
          v2Stats: result.v2Stats,
          ...(result.warning ? { warning: result.warning } : {}),
        })
      );
      break;
    }

    case "ingest:pass": {
      const rawFileIdStr = args[0];
      if (!rawFileIdStr) {
        console.error("ingest:pass 需要 raw_file_id 参数");
        process.exit(1);
      }
      const reason = getArg("--reason");
      if (!reason) {
        console.error('ingest:pass 需要 --reason "..."（说明为何跳过）');
        process.exit(1);
      }
      const actor = getArg("--actor") ?? "agent:claude";
      const { ingestPass } = await import("./skills/ingest/index.ts");
      await ingestPass(BigInt(rawFileIdStr), reason, actor);
      break;
    }

    case "ingest:commit": {
      const rawFileIdStr = args[0];
      if (!rawFileIdStr) {
        console.error("ingest:commit 需要 raw_file_id 参数");
        process.exit(1);
      }
      const { ingestCommit } = await import("./skills/ingest/index.ts");
      const result = await ingestCommit(BigInt(rawFileIdStr));
      console.log(
        jsonStringify({
          rawFileId: result.rawFileId.toString(),
          pageId: result.pageId.toString(),
          markdownUrl: result.markdownUrl,
          title: result.title,
          researchType: result.researchType,
        })
      );
      break;
    }

    case "ingest:brief": {
      const rawFileIdStr = args[0];
      if (!rawFileIdStr) {
        console.error("ingest:brief 需要 raw_file_id 参数");
        process.exit(1);
      }
      const { ingestBrief } = await import("./skills/ingest/index.ts");
      const result = await ingestBrief(BigInt(rawFileIdStr));
      console.log(
        jsonStringify({
          rawFileId: result.rawFileId.toString(),
          pageId: result.pageId.toString(),
          markdownUrl: result.markdownUrl,
          title: result.title,
          researchType: result.researchType,
          pageType: "brief",
        })
      );
      break;
    }

    case "ingest:write": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("ingest:write 需要 page_id 参数");
        process.exit(1);
      }
      const { ingestWriteNarrative } = await import("./skills/ingest/index.ts");
      const fileFlagIdx = args.indexOf("--file");
      let narrative: string;
      if (fileFlagIdx !== -1) {
        const filePath = args[fileFlagIdx + 1];
        if (!filePath) {
          console.error("--file 需要路径参数：bun cli ingest:write <id> --file <path>");
          process.exit(1);
        }
        narrative = await Bun.file(filePath).text();
        if (!narrative.trim()) {
          console.error(`文件为空：${filePath}`);
          process.exit(1);
        }
      } else {
        narrative = await Bun.stdin.text();
        if (!narrative.trim()) {
          console.error(
            "stdin 为空。用 --file <path> 或管道：bun cli ingest:write <id> --file file.md / < file.md"
          );
          process.exit(1);
        }
      }
      await ingestWriteNarrative(BigInt(pageIdStr), narrative);
      break;
    }

    case "ingest:finalize": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("ingest:finalize 需要 page_id 参数");
        process.exit(1);
      }
      const fromRaw = getArg("--from");
      let fromStage: number | undefined;
      if (fromRaw !== undefined) {
        const n = parseInt(fromRaw, 10);
        if (!Number.isFinite(n) || n < 4 || n > 8) {
          console.error("--from 必须是 4-8 之间的整数（stage 编号）");
          process.exit(1);
        }
        fromStage = n;
      }
      const { ingestFinalize } = await import("./skills/ingest/index.ts");
      await ingestFinalize(BigInt(pageIdStr), fromStage ? { fromStage } : {});
      break;
    }

    case "ingest:skip": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("ingest:skip 需要 page_id 参数");
        process.exit(1);
      }
      const reason = getArg("--reason");
      if (!reason) {
        console.error('ingest:skip 需要 --reason "..."（说明为何跳过）');
        process.exit(1);
      }
      const actor = getArg("--actor") ?? "agent:claude";
      const { ingestSkip } = await import("./skills/ingest/index.ts");
      const result = await ingestSkip(BigInt(pageIdStr), reason, actor);
      console.log(jsonStringify({ pageId: pageIdStr, rawFileId: result.rawFileId?.toString() ?? null }));
      break;
    }

    case "ingest:promote": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("ingest:promote 需要 page_id 参数（type='brief' 的 page）");
        process.exit(1);
      }
      const actor = getArg("--actor") ?? "agent:claude";
      const { ingestPromote } = await import("./skills/ingest/index.ts");
      const result = await ingestPromote(BigInt(pageIdStr), actor);
      console.log(
        jsonStringify({
          pageId: pageIdStr,
          oldSlug: result.oldSlug,
          newSlug: result.newSlug,
          rawFileId: result.rawFileId?.toString() ?? null,
        })
      );
      break;
    }

    case "worker": {
      const { connectWithRetry } = await import("./core/db.ts");
      await connectWithRetry();
      const { runJobsCommand } = await import("./commands/jobs.ts");
      await runJobsCommand(["worker"]);
      break;
    }

    case "verify-schema": {
      const { verifySchema } = await import("./core/schema-verify.ts");
      const result = await verifySchema();
      console.log(
        `\n[verify-schema] checked=${result.checked} missing=${result.missing.length} healed=${result.healed.length} failed=${result.failed.length}`
      );
      if (result.missing.length === 0) console.log("  schema OK");
      process.exit(result.failed.length > 0 ? 1 : 0);
    }

    case "agent:run":
    case "agent:list":
    case "agent:show":
    case "agent:logs":
    case "agent:replay":
    case "agent:pause":
    case "agent:resume":
    case "agent:cancel": {
      const { runAgentCommand } = await import("./commands/agent.ts");
      await runAgentCommand([cmd.slice("agent:".length), ...args]);
      break;
    }

    case "jobs:worker":
    case "jobs:supervisor":
    case "jobs:list":
    case "jobs:get":
    case "jobs:pause":
    case "jobs:resume":
    case "jobs:cancel":
    case "jobs:retry": {
      const { runJobsCommand } = await import("./commands/jobs.ts");
      await runJobsCommand([cmd.slice("jobs:".length), ...args]);
      break;
    }

    case "enrich:list": {
      const { enrichList } = await import("./skills/enrich/index.ts");
      const type = getArg("--type") as
        | "company"
        | "industry"
        | "concept"
        | "thesis"
        | "output"
        | undefined;
      const limit = getArg("--limit");
      const rows = await enrichList({
        type,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      console.log(jsonStringify(rows.map((row) => ({ ...row, pageId: row.pageId.toString() }))));
      break;
    }

    case "enrich:next": {
      const { enrichPrepareNext } = await import("./skills/enrich/index.ts");
      const type = getArg("--type") as
        | "company"
        | "industry"
        | "concept"
        | "thesis"
        | "output"
        | undefined;
      const skipStr = getArg("--skip");
      const ctx = await enrichPrepareNext({
        type,
        skip: skipStr ? parseInt(skipStr, 10) : 0,
      });
      if (!ctx) {
        console.log("(没有 confidence='low' 的待 enrich 红链)");
        process.exit(0);
      }
      console.log(
        jsonStringify({
          pageId: ctx.pageId.toString(),
          slug: ctx.slug,
          type: ctx.type,
          title: ctx.title,
          ticker: ctx.ticker,
          backlinks: ctx.backlinks.map((backlink) => ({
            ...backlink,
            sourcePageId: backlink.sourcePageId.toString(),
          })),
        })
      );
      break;
    }

    case "thesis:list": {
      const { thesisList } = await import("./skills/thesis/index.ts");
      const status = getArg("--status") as
        | "active"
        | "monitoring"
        | "closed"
        | "invalidated"
        | undefined;
      const direction = getArg("--direction") as
        | "long"
        | "short"
        | "pair"
        | "neutral"
        | undefined;
      const limit = getArg("--limit");
      const rows = await thesisList({
        status,
        direction,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      console.log(jsonStringify(rows.map((row) => ({ ...row, pageId: row.pageId.toString() }))));
      break;
    }

    case "thesis:show": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("thesis:show 需要 page_id");
        process.exit(1);
      }
      const { thesisShow } = await import("./skills/thesis/index.ts");
      const result = await thesisShow(BigInt(pageIdStr));
      if (!result) {
        console.error(`thesis #${pageIdStr} 不存在`);
        process.exit(1);
      }
      console.log(
        jsonStringify({
          pageId: result.thesis.pageId.toString(),
          slug: result.page.slug,
          title: result.page.title,
          targetSlug: result.targetSlug,
          direction: result.thesis.direction,
          conviction: result.thesis.conviction,
          status: result.thesis.status,
          dateOpened: result.thesis.dateOpened,
          dateClosed: result.thesis.dateClosed,
          priceAtOpen: result.thesis.priceAtOpen,
          priceAtClose: result.thesis.priceAtClose,
          catalysts: result.thesis.catalysts,
          validationConditions: result.thesis.validationConditions,
          narrative_chars: result.page.content.length,
          recentFacts: result.recentFacts,
          signals: result.signals.map((signal) => ({ ...signal, id: signal.id.toString() })),
        })
      );
      break;
    }

    case "thesis:open": {
      const target = getArg("--target");
      const direction = getArg("--direction") as
        | "long"
        | "short"
        | "pair"
        | "neutral"
        | undefined;
      const name = getArg("--name");
      if (!target || !direction || !name) {
        console.error("thesis:open 需要 --target <slug> --direction <long|short|pair|neutral> --name <title>");
        process.exit(1);
      }
      const conviction = getArg("--conviction") as "high" | "medium" | "low" | undefined;
      const { thesisOpen } = await import("./skills/thesis/index.ts");
      const result = await thesisOpen({
        targetSlug: target,
        direction,
        name,
        conviction,
        pmOwner: getArg("--owner"),
        priceAtOpen: getArg("--price-open"),
        dateOpened: getArg("--date-opened"),
      });
      console.log(
        jsonStringify({
          pageId: result.pageId.toString(),
          slug: result.slug,
          targetPageId: result.targetPageId.toString(),
        })
      );
      break;
    }

    case "thesis:write": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("thesis:write 需要 page_id");
        process.exit(1);
      }
      const { thesisWrite } = await import("./skills/thesis/index.ts");
      const narrative = await Bun.stdin.text();
      if (!narrative.trim()) {
        console.error("stdin 为空");
        process.exit(1);
      }
      await thesisWrite(BigInt(pageIdStr), narrative);
      break;
    }

    case "thesis:update": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("thesis:update 需要 page_id");
        process.exit(1);
      }
      const { thesisUpdate } = await import("./skills/thesis/index.ts");
      const conviction = getArg("--conviction") as "high" | "medium" | "low" | undefined;
      const status = getArg("--status") as
        | "active"
        | "monitoring"
        | "closed"
        | "invalidated"
        | undefined;
      const addCatalystStr = getArg("--add-catalyst");
      const markConditionStr = getArg("--mark-condition");
      let addCatalyst:
        | { date: string; event: string; expected_impact: string }
        | undefined;
      if (addCatalystStr) {
        try {
          addCatalyst = JSON.parse(addCatalystStr);
        } catch (e) {
          console.error("--add-catalyst 不是合法 JSON：" + (e as Error).message);
          process.exit(1);
        }
      }
      let markCondition:
        | {
            condition: string;
            status: "pending" | "met" | "unmet" | "invalidated";
            evidence_signal_id?: string;
          }
        | undefined;
      if (markConditionStr) {
        const parts = markConditionStr.split(":");
        if (parts.length < 2) {
          console.error("--mark-condition 格式 'condition:status[:signal_id]'");
          process.exit(1);
        }
        markCondition = {
          condition: parts[0]!,
          status: parts[1] as "pending" | "met" | "unmet" | "invalidated",
          ...(parts[2] ? { evidence_signal_id: parts[2] } : {}),
        };
      }
      await thesisUpdate(BigInt(pageIdStr), {
        conviction,
        status,
        addCatalyst,
        markCondition,
        pmOwner: getArg("--owner"),
        reason: getArg("--reason"),
      });
      break;
    }

    case "thesis:close": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("thesis:close 需要 page_id");
        process.exit(1);
      }
      const reason = getArg("--reason") as
        | "validated"
        | "invalidated"
        | "stop_loss"
        | "manual"
        | undefined;
      if (!reason) {
        console.error("thesis:close 需要 --reason validated|invalidated|stop_loss|manual");
        process.exit(1);
      }
      const { thesisClose } = await import("./skills/thesis/index.ts");
      await thesisClose(BigInt(pageIdStr), {
        reason,
        priceAtClose: getArg("--price-close"),
        dateClosed: getArg("--date-closed"),
        note: getArg("--note"),
      });
      break;
    }

    case "enrich:save": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("enrich:save 需要 page_id");
        process.exit(1);
      }
      const { enrichSave } = await import("./skills/enrich/index.ts");
      const narrative = await Bun.stdin.text();
      if (!narrative.trim()) {
        console.error("stdin 为空");
        process.exit(1);
      }
      const parseList = (s: string | undefined): string[] | undefined =>
        s !== undefined
          ? s.split(",").map((item) => item.trim()).filter((item) => item.length > 0)
          : undefined;

      const confArg = getArg("--confidence");
      const confidence =
        confArg === "high" || confArg === "medium" || confArg === "low"
          ? confArg
          : undefined;
      try {
        await enrichSave(BigInt(pageIdStr), narrative, {
          displayName: getArg("--display-name"),
          ticker: getArg("--ticker"),
          sector: getArg("--sector"),
          subSector: getArg("--sub-sector"),
          country: getArg("--country"),
          exchange: getArg("--exchange"),
          aliases: parseList(getArg("--aliases")),
          aliasesReplace: parseList(getArg("--aliases-replace")),
          aliasesRemove: parseList(getArg("--aliases-remove")),
          confidence,
        });
      } catch (e) {
        console.error(`[enrich:save] ${(e as Error).message}`);
        process.exit(1);
      }
      break;
    }

    case "enrich:retype": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("enrich:retype 需要 page_id");
        process.exit(1);
      }
      const newType = getArg("--new-type");
      if (!newType) {
        console.error("enrich:retype 需要 --new-type company|industry|concept|thesis");
        process.exit(1);
      }
      if (!["company", "industry", "concept", "thesis"].includes(newType)) {
        console.error(
          `--new-type='${newType}' 不合法。允许值：company / industry / concept / thesis`
        );
        process.exit(1);
      }
      const { enrichRetype } = await import("./skills/enrich/index.ts");
      try {
        const result = await enrichRetype(BigInt(pageIdStr), {
          newType: newType as "company" | "industry" | "concept" | "thesis",
          newSlug: getArg("--new-slug"),
          reason: getArg("--reason"),
        });
        console.log(
          jsonStringify({
            pageId: result.pageId.toString(),
            from: { type: result.oldType, slug: result.oldSlug },
            to: { type: result.newType, slug: result.newSlug },
          })
        );
      } catch (e) {
        console.error(`[enrich:retype] ${(e as Error).message}`);
        process.exit(1);
      }
      break;
    }

    case "enrich:retrigger": {
      const { runRetrigger, formatRetriggerTable } = await import(
        "./skills/enrich/retrigger.ts"
      );
      const minScoreStr = getArg("--min-score");
      const minBacklinksStr = getArg("--min-backlinks");
      const minNewStr = getArg("--min-new-backlinks");
      const limitStr = getArg("--limit");
      const asJson = args.includes("--json");
      const dryRun = args.includes("--dry-run");
      try {
        const r = await runRetrigger({
          type: getArg("--type"),
          minScore: minScoreStr ? parseFloat(minScoreStr) : undefined,
          minBacklinks: minBacklinksStr ? parseInt(minBacklinksStr, 10) : undefined,
          minNewBacklinks: minNewStr ? parseInt(minNewStr, 10) : undefined,
          limit: limitStr ? parseInt(limitStr, 10) : undefined,
          dryRun,
        });
        if (asJson) console.log(jsonStringify(r));
        else console.log(formatRetriggerTable(r));
      } catch (e) {
        console.error(`[enrich:retrigger] ${(e as Error).message}`);
        process.exit(1);
      }
      break;
    }

    case "facts:re-extract": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("facts:re-extract 需要 page_id");
        process.exit(1);
      }
      const { stage5Facts } = await import("./skills/ingest/stage-5-facts.ts");
      const { Actor } = await import("./core/audit.ts");
      await stage5Facts({
        pageId: BigInt(pageIdStr),
        rawFileId: 0n,
        rawMarkdown: "",
        contentListJson: undefined,
        actor: Actor.systemIngest,
      });
      break;
    }

    case "web": {
      const portStr = getArg("--port");
      const port = portStr ? parseInt(portStr, 10) : 3000;
      const { connectWithRetry } = await import("./core/db.ts");
      await connectWithRetry();
      const { startWebServer } = await import("./web/server.ts");
      await startWebServer({ port });
      // Bun.serve 会保持进程不退；这里不能 process.exit
      return;
    }

    case "lint:run": {
      const { runLint } = await import("./skills/lint/index.ts");
      const staleDays = getArg("--stale-days");
      const rawAgeDays = getArg("--raw-age-days");
      const factAgeDays = getArg("--fact-age-days");
      const sampleSize = getArg("--sample");
      const report = await runLint({
        staleDays: staleDays ? parseInt(staleDays, 10) : undefined,
        rawAgeDays: rawAgeDays ? parseInt(rawAgeDays, 10) : undefined,
        factAgeDays: factAgeDays ? parseInt(factAgeDays, 10) : undefined,
        sampleSize: sampleSize ? parseInt(sampleSize, 10) : undefined,
      });
      console.log(jsonStringify(report));
      break;
    }

    case "orphans": {
      const { findOrphans, formatOrphanTable } = await import(
        "./skills/orphans/index.ts"
      );
      const confArg = getArg("--confidence");
      const confidence =
        confArg === "low" || confArg === "medium" || confArg === "high"
          ? confArg
          : undefined;
      const minAgeStr = getArg("--min-age-days");
      const limitStr = getArg("--limit");
      const asJson = args.includes("--json");
      try {
        const report = await findOrphans({
          type: getArg("--type"),
          confidence,
          minAgeDays: minAgeStr ? parseInt(minAgeStr, 10) : undefined,
          limit: limitStr ? parseInt(limitStr, 10) : undefined,
        });
        if (asJson) {
          console.log(jsonStringify(report));
        } else {
          console.log(formatOrphanTable(report));
        }
      } catch (e) {
        console.error(`[orphans] ${(e as Error).message}`);
        process.exit(1);
      }
      break;
    }

    case "duplicates": {
      const { findDuplicates, formatDuplicateTable } = await import(
        "./skills/duplicates/index.ts"
      );
      const minSimStr = getArg("--min-sim");
      const limitStr = getArg("--limit");
      const asJson = args.includes("--json");
      try {
        const report = await findDuplicates({
          type: getArg("--type"),
          minSim: minSimStr ? parseFloat(minSimStr) : undefined,
          limit: limitStr ? parseInt(limitStr, 10) : undefined,
        });
        if (asJson) {
          console.log(jsonStringify(report));
        } else {
          console.log(formatDuplicateTable(report));
        }
      } catch (e) {
        console.error(`[duplicates] ${(e as Error).message}`);
        process.exit(1);
      }
      break;
    }

    case "facts:expire": {
      const { expireFacts } = await import("./skills/facts/expire.ts");
      const age = getArg("--age");
      const result = await expireFacts({
        ageDays: age ? parseInt(age, 10) : undefined,
      });
      console.log(jsonStringify(result));
      break;
    }

    case "links:re-extract": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("links:re-extract 需要 page_id");
        process.exit(1);
      }
      const { stage4Links } = await import("./skills/ingest/stage-4-links.ts");
      const { Actor } = await import("./core/audit.ts");
      const stage4Result = await stage4Links({
        pageId: BigInt(pageIdStr),
        rawFileId: 0n,
        rawMarkdown: "",
        contentListJson: undefined,
        actor: Actor.systemIngest,
      });
      if (stage4Result.unresolved.length > 0) {
        console.log("");
        console.log(
          `⚠️  ${stage4Result.unresolved.length} wikilinks unresolved (events.action='wikilink_unresolved'):`
        );
        for (const u of stage4Result.unresolved) {
          const hint =
            u.suggestions[0]
              ? ` → 建议 ${u.suggestions[0].slug} (sim=${u.suggestions[0].similarity.toFixed(2)})`
              : " → 无相似建议，建议改纯文本";
          console.log(`     [[${u.slug}]] (${u.inferredType})${hint}`);
        }
      }
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exit(1);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
