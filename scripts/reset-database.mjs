// import { sql } from "../src/core/db.ts";

// const dryRun = process.argv.includes("--dry-run");

// const TRUNCATE_TABLES = [
//   "agent_tool_executions",
//   "agent_messages",
//   "minion_jobs",
//   "events",
//   "page_versions",
//   "raw_data",
//   "timeline_entries",
//   "signals",
//   "theses",
//   "facts",
//   "tags",
//   "links",
//   "content_chunks",
//   "raw_files",
//   "pages",
//   "config",
//   "sources",
// ];

// const CONFIG_SEEDS = [
//   ["schema_version", "2"],
//   ["embedding_model", "text-embedding-3-large"],
//   ["embedding_dimensions", "1536"],
//   ["chunk_strategy", "mineru-aware"],
//   ["default_locale", "zh-CN"],
//   ["fact_extract_tier_a_enabled", "true"],
//   ["fact_extract_tier_b_enabled", "true"],
//   ["fact_extract_tier_c_enabled", "true"],
//   ["fact_extract_llm_model", "gpt-5-mini"],
//   ["fact_extract_llm_max_cost_per_page", "0.10"],
//   ["fact_extract_pct_auto_convert", "true"],
//   ["fact_extract_outlier_zscore_threshold", "3.0"],
// ];

// console.log(`[reset-db] ${dryRun ? "DRY-RUN" : "REAL RUN"} clear database`);

// try {
//   await sql.begin(async (tx) => {
//     const before = await tx`
//       SELECT
//         (SELECT COUNT(*) FROM raw_files WHERE deleted = 0) AS raw_files,
//         (SELECT COUNT(*) FROM pages WHERE deleted = 0) AS pages,
//         (SELECT COUNT(*) FROM facts WHERE deleted = 0) AS facts,
//         (SELECT COUNT(*) FROM theses WHERE deleted = 0) AS theses,
//         (SELECT COUNT(*) FROM signals WHERE deleted = 0) AS signals,
//         (SELECT COUNT(*) FROM minion_jobs WHERE deleted = 0) AS minion_jobs
//     `;
//     console.log(`  before: ${JSON.stringify(before[0])}`);

//     await tx.unsafe(`TRUNCATE TABLE ${TRUNCATE_TABLES.join(", ")} RESTART IDENTITY`);

//     await tx`
//       INSERT INTO sources (id, name, description, create_by, update_by)
//       VALUES ('default', '主投资研究 wiki', '默认 wiki 分区', 'system:reset', 'system:reset')
//     `;

//     for (const [id, value] of CONFIG_SEEDS) {
//       await tx`
//         INSERT INTO config (id, value, create_by, update_by)
//         VALUES (${id}, ${value}, 'system:reset', 'system:reset')
//       `;
//     }

//     const after = await tx`
//       SELECT
//         (SELECT COUNT(*) FROM raw_files WHERE deleted = 0) AS raw_files,
//         (SELECT COUNT(*) FROM pages WHERE deleted = 0) AS pages,
//         (SELECT COUNT(*) FROM facts WHERE deleted = 0) AS facts,
//         (SELECT COUNT(*) FROM theses WHERE deleted = 0) AS theses,
//         (SELECT COUNT(*) FROM signals WHERE deleted = 0) AS signals,
//         (SELECT COUNT(*) FROM minion_jobs WHERE deleted = 0) AS minion_jobs,
//         (SELECT COUNT(*) FROM sources WHERE deleted = 0) AS sources,
//         (SELECT COUNT(*) FROM config WHERE deleted = 0) AS config
//     `;
//     console.log(`  after:  ${JSON.stringify(after[0])}`);

//     if (dryRun) {
//       console.log("[reset-db] DRY-RUN，回滚事务");
//       throw new Error("__DRY_RUN_ROLLBACK__");
//     }
//   });
// } catch (error) {
//   if (dryRun && error?.message === "__DRY_RUN_ROLLBACK__") {
//     console.log("[reset-db] dry-run 已回滚，退出");
//     process.exit(0);
//   }
//   throw error;
// }

// console.log("[reset-db] 完成");
