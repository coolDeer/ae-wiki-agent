#!/usr/bin/env bun
/**
 * ae-wiki CLI 入口
 *
 * Ingest 走三段式（gbrain "thin harness, fat skill" 模式）：
 *   ae-wiki ingest:next                    # 拿待处理 raw_file 上下文
 *   ae-wiki ingest:write <id> < file.md    # stdin 把 agent 写的 narrative 落库
 *   ae-wiki ingest:finalize <id>           # 跑 Stage 4-8 收尾
 *
 * 编排 skill：skills/research-ingest/SKILL.md（agent 读后执行）。
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

function printHelp(): void {
  console.log(`Usage:
  ae-wiki fetch-reports [--limit N] [--dry-run]

  # —— Triage 流程（推荐）：peek → pass | commit → write → finalize ——
  ae-wiki ingest:peek                     # 列下一份候选 raw 的预览（不写库）
  ae-wiki ingest:pass <raw_file_id> --reason "..."
                                          # peek 后判定无关：标 raw_file skip（不建 page）
  ae-wiki ingest:commit <raw_file_id>     # peek 后判定值得（核心投资素材）：建 page (type=source)
  ae-wiki ingest:brief <raw_file_id>      # peek 后判定为前沿动态（弱相关）：建 page (type=brief)
  ae-wiki ingest:write <page_id>          # 从 stdin 读 narrative，落 pages.content + page_versions
  ae-wiki ingest:finalize <page_id>       # 跑 Stage 4-8 收尾

  # —— 兼容入口 / 兜底 ——
  ae-wiki ingest:next                     # legacy：peek + 自动 commit（短素材不推荐）
  ae-wiki ingest:skip <page_id> --reason "..."
                                          # 兜底：commit 后才发现不对（清理 page + 标 raw_file）

  ae-wiki worker                          # minion-worker 后台进程

  ae-wiki enrich:list [--type T] [--limit N]    # 列出待 enrich 的红链 entity
  ae-wiki enrich:next [--type T] [--skip N]     # 取下一个红链 + backlink 上下文
  ae-wiki enrich:save <page_id> [--ticker X] [--sector Y] [--aliases A,B] [--confidence high|medium]
                                                # 从 stdin 读 narrative 落库 + 更新元数据

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

  ae-wiki --help

参考：
  skills/research-ingest/SKILL.md  研报 ingest 编排
  skills/enrich/SKILL.md           红链补全编排
  skills/thesis-track/SKILL.md     投资论点状态机`);
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
      const result = await fetchReports({
        limit: limit ? parseInt(limit, 10) : undefined,
        dryRun: getFlag("--dry-run"),
      });
      console.log("\n[fetch-reports] 完成:", result);
      break;
    }

    case "ingest": {
      console.error(
        "命令 `ingest` 已废弃。改用三段式：ingest:next → agent 写 narrative → ingest:write → ingest:finalize\n" +
        "见 skills/research-ingest/SKILL.md"
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
      console.log(JSON.stringify(
        {
          rawFileId: result.rawFileId.toString(),
          rawMdPath: result.rawMdPath,
          rawMdAbsPath: result.rawMdAbsPath,
          title: result.title,
          researchType: result.researchType,
          rawCharCount: result.rawCharCount,
          preview: result.preview,
        },
        null,
        2
      ));
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
        console.error("ingest:pass 需要 --reason \"...\"（说明为何跳过）");
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
      console.log(JSON.stringify(
        {
          rawFileId: result.rawFileId.toString(),
          pageId: result.pageId.toString(),
          rawMdPath: result.rawMdPath,
          rawMdAbsPath: result.rawMdAbsPath,
          title: result.title,
          researchType: result.researchType,
        },
        null,
        2
      ));
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
      console.log(JSON.stringify(
        {
          rawFileId: result.rawFileId.toString(),
          pageId: result.pageId.toString(),
          rawMdPath: result.rawMdPath,
          rawMdAbsPath: result.rawMdAbsPath,
          title: result.title,
          researchType: result.researchType,
          pageType: "brief",
        },
        null,
        2
      ));
      break;
    }

    case "ingest:next": {
      const { ingestPrepareNext } = await import("./skills/ingest/index.ts");
      const result = await ingestPrepareNext();
      if (!result) {
        console.log("(没有待处理的 raw_files)");
        process.exit(0);
      }
      console.log(JSON.stringify(
        {
          rawFileId: result.rawFileId.toString(),
          pageId: result.pageId.toString(),
          rawMdPath: result.rawMdPath,
          rawMdAbsPath: result.rawMdAbsPath,
          title: result.title,
          researchType: result.researchType,
        },
        null,
        2
      ));
      break;
    }

    case "ingest:write": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("ingest:write 需要 page_id 参数");
        process.exit(1);
      }
      const { ingestWriteNarrative } = await import("./skills/ingest/index.ts");
      // 从 stdin 读 narrative
      const narrative = await Bun.stdin.text();
      if (!narrative.trim()) {
        console.error("stdin 为空，请用管道传 narrative：bun cli ingest:write <id> < file.md");
        process.exit(1);
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
      const { ingestFinalize } = await import("./skills/ingest/index.ts");
      await ingestFinalize(BigInt(pageIdStr));
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
        console.error("ingest:skip 需要 --reason \"...\"（说明为何跳过）");
        process.exit(1);
      }
      const actor = getArg("--actor") ?? "agent:claude";
      const { ingestSkip } = await import("./skills/ingest/index.ts");
      const result = await ingestSkip(BigInt(pageIdStr), reason, actor);
      console.log(JSON.stringify(
        { pageId: pageIdStr, rawFileId: result.rawFileId?.toString() ?? null },
        null,
        2
      ));
      break;
    }

    case "worker": {
      const { runWorker } = await import("./workers/minion-worker.ts");
      await runWorker();
      break;
    }

    case "enrich:list": {
      const { enrichList } = await import("./skills/enrich/index.ts");
      const type = getArg("--type") as
        | "company" | "person" | "industry" | "concept" | "thesis" | "output"
        | undefined;
      const limit = getArg("--limit");
      const rows = await enrichList({
        type,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      console.log(JSON.stringify(rows.map((r) => ({ ...r, pageId: r.pageId.toString() })), null, 2));
      break;
    }

    case "enrich:next": {
      const { enrichPrepareNext } = await import("./skills/enrich/index.ts");
      const type = getArg("--type") as
        | "company" | "person" | "industry" | "concept" | "thesis" | "output"
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
      console.log(JSON.stringify({
        pageId: ctx.pageId.toString(),
        slug: ctx.slug,
        type: ctx.type,
        title: ctx.title,
        ticker: ctx.ticker,
        backlinks: ctx.backlinks.map((b) => ({
          ...b,
          sourcePageId: b.sourcePageId.toString(),
        })),
      }, null, 2));
      break;
    }

    case "thesis:list": {
      const { thesisList } = await import("./skills/thesis/index.ts");
      const status = getArg("--status") as
        | "active" | "monitoring" | "closed" | "invalidated" | undefined;
      const direction = getArg("--direction") as
        | "long" | "short" | "pair" | "neutral" | undefined;
      const limit = getArg("--limit");
      const rows = await thesisList({
        status,
        direction,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
      console.log(JSON.stringify(rows.map((r) => ({ ...r, pageId: r.pageId.toString() })), null, 2));
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
      console.log(JSON.stringify({
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
        signals: result.signals.map((s) => ({ ...s, id: s.id.toString() })),
      }, null, 2));
      break;
    }

    case "thesis:open": {
      const target = getArg("--target");
      const direction = getArg("--direction") as
        | "long" | "short" | "pair" | "neutral" | undefined;
      const name = getArg("--name");
      if (!target || !direction || !name) {
        console.error("thesis:open 需要 --target <slug> --direction <long|short|pair|neutral> --name <title>");
        process.exit(1);
      }
      const conviction = getArg("--conviction") as
        | "high" | "medium" | "low" | undefined;
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
      console.log(JSON.stringify({
        pageId: result.pageId.toString(),
        slug: result.slug,
        targetPageId: result.targetPageId.toString(),
      }, null, 2));
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
      const conviction = getArg("--conviction") as
        | "high" | "medium" | "low" | undefined;
      const status = getArg("--status") as
        | "active" | "monitoring" | "closed" | "invalidated" | undefined;
      const addCatalystStr = getArg("--add-catalyst");
      const markConditionStr = getArg("--mark-condition");
      let addCatalyst: { date: string; event: string; expected_impact: string } | undefined;
      if (addCatalystStr) {
        try {
          addCatalyst = JSON.parse(addCatalystStr);
        } catch (e) {
          console.error("--add-catalyst 不是合法 JSON：" + (e as Error).message);
          process.exit(1);
        }
      }
      let markCondition: { condition: string; status: "pending" | "met" | "unmet" | "invalidated"; evidence_signal_id?: string } | undefined;
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
        | "validated" | "invalidated" | "stop_loss" | "manual" | undefined;
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
      const aliasesStr = getArg("--aliases");
      const confArg = getArg("--confidence");
      const confidence =
        confArg === "high" || confArg === "medium" || confArg === "low"
          ? confArg
          : undefined;
      await enrichSave(BigInt(pageIdStr), narrative, {
        ticker: getArg("--ticker"),
        sector: getArg("--sector"),
        subSector: getArg("--sub-sector"),
        country: getArg("--country"),
        exchange: getArg("--exchange"),
        aliases: aliasesStr ? aliasesStr.split(",").map((s) => s.trim()) : undefined,
        confidence,
      });
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

    case "links:re-extract": {
      const pageIdStr = args[0];
      if (!pageIdStr) {
        console.error("links:re-extract 需要 page_id");
        process.exit(1);
      }
      const { stage4Links } = await import("./skills/ingest/stage-4-links.ts");
      const { Actor } = await import("./core/audit.ts");
      await stage4Links({
        pageId: BigInt(pageIdStr),
        rawFileId: 0n,
        rawMarkdown: "",
        contentListJson: undefined,
        actor: Actor.systemIngest,
      });
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
