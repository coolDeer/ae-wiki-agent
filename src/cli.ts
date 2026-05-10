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
                       [--types T1,T2,...] [--per-type N]
                                          # 默认拉昨天（按 createTime，本地时区）；--all 回到旧的全量模式
                                          # --types：仅拉指定 researchType（debug / 抽样）
                                          # --per-type：每个 researchType 最多 N 条（与 --types 配合）

  # —— Triage 流程（推荐）：peek → pass | commit → write → finalize ——
  ae-wiki ingest:peek                     # 列下一份候选 raw 的预览（不写库）
  ae-wiki ingest:pass <raw_file_id> --reason "..."
                                          # peek 后判定无关：标 raw_file skip（不建 page）
  ae-wiki ingest:commit <raw_file_id>     # peek 后判定值得（核心投资素材）：建 page (type=source)
  ae-wiki ingest:brief <raw_file_id>      # peek 后判定为前沿动态（弱相关）：建 page (type=brief)
  ae-wiki ingest:write <page_id> [--file <path>]  # 从 --file 或 stdin 读 narrative，落 pages.content + page_versions，并跑 deterministic review
  ae-wiki ingest:append <page_id> [--source <slug>] [--file <path>]
                                          # 增量追加 dated update block（enrich 重复触发用，保留观点演化）
                                          # 现有 content 为空时退化为 write 模式
  ae-wiki ingest:finalize <page_id> [--skip-review]
                                          # 先过 page review gate，再跑 Stage 4-8；--skip-review 仅紧急兜底

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
                       # entity 页 display_name 为空时 --display-name 必填，由 enrich skill 生成
                       [--aliases A,B,C]               # 默认：merge 进现有 aliases（case-insensitive 去重）
                       [--aliases-replace A,B,C]       # 显式完全覆盖（与 --aliases / --aliases-remove 互斥）
                       [--append [--append-source slug]] # 增量追加 dated update（已 enriched 的 entity 复 enrich 用）
                       [--aliases-remove X,Y]          # 从现有 aliases 删除指定项（可与 --aliases 组合）
                       [--allow-alias-conflict]        # 默认禁止：新 alias 与其它 page 撞 title/slug/alias 时报错
                                                # 从 stdin 读 narrative 落库 + 更新元数据
  ae-wiki enrich:retype <page_id> --new-type company|industry|concept|thesis [--new-slug X] [--reason "..."]
                                                # 红链 type 错了（companies/Trainium → concepts/Trainium）
                                                # 默认仅换 dir 前缀；--new-slug 完整覆盖
  ae-wiki enrich:retrigger [--min-score N=0.5] [--min-backlinks N=3] [--min-new-backlinks N=2]
                       [--type T] [--limit N=30] [--dry-run] [--json]
                                                # 找完整度低 + backlink 多 + 新增 backlink 多的 page 重 enqueue
                                                # 解决"NVIDIA 永久 conf=low"问题
  ae-wiki enrich:backlog [--type T] [--limit N] [--json] [--include-in-flight]
                                                # enrich pipeline 待处理队列：low confidence / low completeness / backlink growth

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
  ae-wiki thesis:backlog [--status S] [--stale-days N] [--signal-days N] [--limit N] [--json]
                                                # thesis upkeep 队列：过久未更新 / unresolved conditions / recent signals
  ae-wiki entity:stale [--type T] [--stale-days N] [--limit N] [--json]
                                                # compiled entity page 落后于新 high-value evidence（typed source / facts / timeline / signals）的积压队列
  ae-wiki entity:update-candidates [--type T] [--limit N] [--json]
                                                # 按优先级列出值得 refresh 的 entity；普通 mention backlink 不单独触发
  ae-wiki entity:refresh <slug|id> [--dry-run] [--source-limit N]
                                                # 保守追加 entity update block，只消费 high-value evidence 写进 ## Updates

  ae-wiki facts:re-extract <page_id>      # 重跑 Stage 5（针对单页）
  ae-wiki facts:coverage [--type source|brief|all] [--limit N] [--json]
                                          # 找看起来应有 fact、但结构化层覆盖偏弱的 source / brief 页
  ae-wiki output:review <filename> [--json]
                                          # 跑 deterministic output review，检查 wiki/output 下 daily-review / daily-summarize 的结构与引用
  ae-wiki output:backlog [--subtype daily-review|daily-summarize|all] [--limit N] [--json]
                                          # 查看 output 质量 backlog，优先修 fail 的 daily outputs
  ae-wiki links:re-extract <page_id>      # 重跑 Stage 4（针对单页）
  ae-wiki page:review <page_id> [--json]  # 跑 deterministic page review，检查 schema / wikilink / provenance / blocks
  ae-wiki page:review-backlog [--status fail|pass|all] [--limit N] [--json]
                                          # 查看最近 page review 结果，优先清理 fail backlog

  # —— PM dashboard / consensus drift ——
  ae-wiki entity:pulse <slug|id> [--recent N] [--facts N]
                                          # entity 级 typed-edge breakdown + 最近 inbound source + facts 概览
  ae-wiki consensus:show <slug|id> --metric M [--period P]
                                          # 跨 source 看同一 metric 的观测分布 + drift（rising/falling/stable + outliers）

  # —— Web UI ——
  ae-wiki web [--port 9083]               # 启动只读 web UI（home / search / page / theses / entities / outputs / queue）

  # —— 维护任务（也可作为 minion job 跑：lint_run / facts_expire） ——
  ae-wiki lint:run [--stale-days N] [--raw-age-days N] [--fact-age-days N] [--sample N]
                                          # 跑健康检查（orphans / stale thesis / red links / pending raw / expired facts / review failures / alias conflicts）
  ae-wiki orphans [--type T] [--confidence low|medium|high] [--min-age-days N] [--limit N] [--json]
                                          # 列出无入站 link 的实体页（red-link explosion 诊断）
                                          # 默认 type ∈ {company,industry,concept,thesis}，--json 输出结构化数据
  ae-wiki duplicates [--type T] [--min-sim 0.7] [--limit N] [--json]
                                          # 找潜在重复实体（trgm > 阈值 + 同 type）
                                          # 离线 lint，不写 events；agent / 人工 review 后用 enrich:retype 合并
  ae-wiki alias-conflicts [--type T] [--limit N] [--json]
                                          # 找多个 active page 共用同一 alias / title / slug-name 的情况
  ae-wiki page:merge-candidates [--type T] [--min-sim 0.7] [--limit N] [--json] [--include-human-review]
                                          # 汇总 duplicates + alias-conflicts；默认过滤高风险项，--include-human-review 可把人工复核候选也带上
  ae-wiki page:merge <canonical_page_id> <duplicate_page_id> [--reason "..."] [--dry-run] [--skip-narrative-fusion]
                                          # 把 duplicate entity page 合并进 canonical；必要时只迁结构化引用，不自动融合 narrative
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
      const typesArg = getArg("--types");
      const perTypeArg = getArg("--per-type");
      const researchIdsArg = getArg("--research-ids");
      const result = await fetchReports({
        limit: limit ? parseInt(limit, 10) : undefined,
        dryRun: getFlag("--dry-run"),
        date,
        all: getFlag("--all"),
        types: typesArg ? typesArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        perTypeLimit: perTypeArg ? parseInt(perTypeArg, 10) : undefined,
        researchIds: researchIdsArg ? researchIdsArg.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
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

    case "ingest:append": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("ingest:append 需要 page_id 参数");
        console.error(
          "  bun cli ingest:append <id> [--source <slug>] [--file <path>]"
        );
        process.exit(1);
      }
      const { ingestAppendNarrative } = await import("./skills/ingest/index.ts");
      const fileFlagIdx = args.indexOf("--file");
      let delta: string;
      if (fileFlagIdx !== -1) {
        const filePath = args[fileFlagIdx + 1];
        if (!filePath) {
          console.error("--file 需要路径参数");
          process.exit(1);
        }
        delta = await Bun.file(filePath).text();
      } else {
        delta = await Bun.stdin.text();
      }
      if (!delta.trim()) {
        console.error("delta 内容为空（用 --file <path> 或 stdin pipe）");
        process.exit(1);
      }
      const sourceSlug = getArg("--source");
      const result = await ingestAppendNarrative(BigInt(pageIdStr), delta, {
        sourceSlug,
      });
      console.log(JSON.stringify(result));
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
      await ingestFinalize(BigInt(pageIdStr), {
        ...(fromStage ? { fromStage } : {}),
        skipReview: getFlag("--skip-review"),
      });
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

    case "thesis:backlog": {
      const { formatThesisBacklog, getThesisBacklog } = await import(
        "./skills/thesis/backlog.ts"
      );
      const statusArg = getArg("--status");
      const status =
        statusArg === "active" ||
        statusArg === "monitoring" ||
        statusArg === "closed" ||
        statusArg === "invalidated"
          ? statusArg
          : undefined;
      const staleDaysStr = getArg("--stale-days");
      const signalDaysStr = getArg("--signal-days");
      const limitStr = getArg("--limit");
      const report = await getThesisBacklog({
        status,
        staleDays: staleDaysStr ? parseInt(staleDaysStr, 10) : undefined,
        signalDays: signalDaysStr ? parseInt(signalDaysStr, 10) : undefined,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
      });
      if (getFlag("--json")) console.log(jsonStringify(report));
      else console.log(formatThesisBacklog(report));
      break;
    }

    case "entity:stale": {
      const { formatEntityStaleReport, getEntityStaleReport } = await import(
        "./skills/entity-refresh/index.ts"
      );
      const staleDaysStr = getArg("--stale-days");
      const limitStr = getArg("--limit");
      const report = await getEntityStaleReport({
        type: getArg("--type"),
        staleDays: staleDaysStr ? parseInt(staleDaysStr, 10) : undefined,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
      });
      if (getFlag("--json")) console.log(jsonStringify(report));
      else console.log(formatEntityStaleReport(report));
      break;
    }

    case "entity:update-candidates": {
      const { formatEntityUpdateCandidates, getEntityUpdateCandidates } = await import(
        "./skills/entity-refresh/index.ts"
      );
      const limitStr = getArg("--limit");
      const report = await getEntityUpdateCandidates({
        type: getArg("--type"),
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
      });
      if (getFlag("--json")) console.log(jsonStringify(report));
      else console.log(formatEntityUpdateCandidates(report));
      break;
    }

    case "entity:refresh": {
      const ident = args[0];
      if (!ident) {
        console.error("entity:refresh 需要 entity slug 或 page id");
        process.exit(1);
      }
      const { refreshEntityPage } = await import("./skills/entity-refresh/index.ts");
      const sourceLimitStr = getArg("--source-limit");
      const report = await refreshEntityPage(ident, {
        dryRun: getFlag("--dry-run"),
        sourceLimit: sourceLimitStr ? parseInt(sourceLimitStr, 10) : undefined,
      });
      console.log(jsonStringify(report));
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
          allowAliasConflict: args.includes("--allow-alias-conflict"),
          confidence,
          append: args.includes("--append"),
          appendSourceSlug: getArg("--append-source"),
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

    case "enrich:backlog": {
      const { formatEnrichBacklog, getEnrichBacklog } = await import(
        "./skills/enrich/backlog.ts"
      );
      const limitStr = getArg("--limit");
      const report = await getEnrichBacklog({
        type: getArg("--type"),
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
        includeInFlight: getFlag("--include-in-flight"),
      });
      if (getFlag("--json")) console.log(jsonStringify(report));
      else console.log(formatEnrichBacklog(report));
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
      const { fetchRawMarkdown } = await import("./core/raw-loader.ts");
      const { db, schema } = await import("./core/db.ts");
      const { sql: drizzleSql } = await import("drizzle-orm");
      const linked = await db
        .select()
        .from(schema.rawFiles)
        .where(
          drizzleSql`EXISTS (
            SELECT 1 FROM events e
            WHERE e.action = 'ingest_start'
              AND e.entity_type = 'page'
              AND e.entity_id = ${BigInt(pageIdStr)}
              AND (e.payload->>'rawFileId')::bigint = ${schema.rawFiles.id}
          )`
        )
        .limit(1);
      const rawFile = linked[0] ?? null;
      const rawMarkdown = rawFile ? await fetchRawMarkdown(rawFile) : "";
      await stage5Facts({
        pageId: BigInt(pageIdStr),
        rawFileId: rawFile?.id ?? 0n,
        rawMarkdown,
        contentListJson: undefined,
        actor: Actor.systemIngest,
      });
      break;
    }

    case "facts:coverage": {
      const { formatFactsCoverage, getFactsCoverageBacklog } = await import(
        "./skills/facts/coverage.ts"
      );
      const typeArg = getArg("--type");
      const type =
        typeArg === "source" || typeArg === "brief" || typeArg === "all"
          ? typeArg
          : undefined;
      const limitStr = getArg("--limit");
      const report = await getFactsCoverageBacklog({
        type,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
      });
      if (getFlag("--json")) console.log(jsonStringify(report));
      else console.log(formatFactsCoverage(report));
      break;
    }

    case "output:review": {
      const filename = args[0];
      if (!filename) {
        console.error("output:review 需要 filename，例如 daily-review-2026-04-28.md");
        process.exit(1);
      }
      const { formatOutputReview, reviewOutputFile } = await import(
        "./skills/output-review/index.ts"
      );
      const report = await reviewOutputFile(filename);
      if (getFlag("--json")) console.log(jsonStringify(report));
      else console.log(formatOutputReview(report));
      break;
    }

    case "output:backlog": {
      const subtypeArg = getArg("--subtype");
      const subtype =
        subtypeArg === "daily-review" ||
        subtypeArg === "daily-summarize" ||
        subtypeArg === "all"
          ? subtypeArg
          : undefined;
      const limitStr = getArg("--limit");
      const { formatOutputBacklog, reviewOutputBacklog } = await import(
        "./skills/output-review/index.ts"
      );
      const report = await reviewOutputBacklog({
        subtype,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
      });
      if (getFlag("--json")) console.log(jsonStringify(report));
      else console.log(formatOutputBacklog(report));
      break;
    }

    case "web": {
      const portStr = getArg("--port");
      const port = portStr ? parseInt(portStr, 10) : 9083;
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

    case "alias-conflicts": {
      const { findAliasConflicts, formatAliasConflictReport } = await import(
        "./skills/alias-conflicts/index.ts"
      );
      const limitStr = getArg("--limit");
      const asJson = args.includes("--json");
      try {
        const report = await findAliasConflicts({
          type: getArg("--type"),
          limit: limitStr ? parseInt(limitStr, 10) : undefined,
        });
        if (asJson) {
          console.log(jsonStringify(report));
        } else {
          console.log(formatAliasConflictReport(report));
        }
      } catch (e) {
        console.error(`[alias-conflicts] ${(e as Error).message}`);
        process.exit(1);
      }
      break;
    }

    case "page:merge": {
      const canonicalPageIdStr = args[0];
      const duplicatePageIdStr = args[1];
      if (!canonicalPageIdStr || !duplicatePageIdStr) {
        console.error("page:merge 需要 canonical_page_id 和 duplicate_page_id");
        console.error(
          '示例: bun src/cli.ts page:merge 1713 1743 --reason "merge duplicate industry page" --dry-run'
        );
        process.exit(1);
      }
      const { mergePages } = await import("./skills/page-merge/index.ts");
      const report = await mergePages(BigInt(canonicalPageIdStr), BigInt(duplicatePageIdStr), {
        reason: getArg("--reason"),
        actor: getArg("--actor") ?? "agent:claude",
        dryRun: getFlag("--dry-run"),
        skipNarrativeFusion: getFlag("--skip-narrative-fusion"),
      });
      console.log(jsonStringify(report));
      break;
    }

    case "page:merge-candidates": {
      const { findMergeCandidates, formatMergeCandidates } = await import(
        "./skills/merge-candidates/index.ts"
      );
      const minSimStr = getArg("--min-sim");
      const limitStr = getArg("--limit");
      const report = await findMergeCandidates({
        type: getArg("--type"),
        minSim: minSimStr ? parseFloat(minSimStr) : undefined,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
        includeHumanReview: getFlag("--include-human-review"),
      });
      if (getFlag("--json")) {
        console.log(jsonStringify(report));
      } else {
        console.log(formatMergeCandidates(report));
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

    case "page:review": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("page:review 需要 page_id");
        process.exit(1);
      }
      const { formatPageReviewReport, reviewStoredPage } = await import(
        "./skills/review/index.ts"
      );
      const report = await reviewStoredPage(BigInt(pageIdStr));
      if (getFlag("--json")) {
        console.log(jsonStringify(report));
      } else {
        console.log(formatPageReviewReport(report));
      }
      process.exit(report.status === "fail" ? 2 : 0);
    }

    case "page:review-backlog": {
      const { formatReviewBacklogReport, listReviewBacklog } = await import(
        "./skills/review/index.ts"
      );
      const statusArg = getArg("--status");
      const status =
        statusArg === "fail" || statusArg === "pass" || statusArg === "all"
          ? statusArg
          : undefined;
      const limitStr = getArg("--limit");
      const report = await listReviewBacklog({
        status,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
      });
      if (getFlag("--json")) {
        console.log(jsonStringify(report));
      } else {
        console.log(formatReviewBacklogReport(report));
      }
      break;
    }

    case "entity:pulse": {
      const ident = args[0];
      if (!ident) {
        console.error("entity:pulse 需要 entity slug 或 page id");
        process.exit(1);
      }
      const { entityPulse } = await import("./mcp/queries.ts");
      const recentLimit = getArg("--recent");
      const factLimit = getArg("--facts");
      const result = await entityPulse({
        identifier: ident,
        recentLimit: recentLimit ? parseInt(recentLimit, 10) : undefined,
        factLimit: factLimit ? parseInt(factLimit, 10) : undefined,
      });
      console.log(JSON.stringify(result, (_, v) =>
        typeof v === "bigint" ? v.toString() : v, 2));
      break;
    }

    case "consensus:show": {
      const ident = args[0];
      const metric = getArg("--metric");
      if (!ident || !metric) {
        console.error("consensus:show 需要 entity slug + --metric");
        console.error("示例: bun src/cli.ts consensus:show companies/MediaTek --metric revenue");
        process.exit(1);
      }
      const { consensusView } = await import("./mcp/queries.ts");
      const period = getArg("--period");
      const result = await consensusView({
        entity: ident,
        metric,
        period,
      });
      console.log(JSON.stringify(result, (_, v) =>
        typeof v === "bigint" ? v.toString() : v, 2));
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
