/**
 * 业务数据清空脚本（破坏性！）。
 *
 *   bun scripts/reset-database.mjs --dry-run    # 看 before/after，事务回滚
 *   bun scripts/reset-database.mjs              # 真清
 *
 * 清掉所有业务表 + 重置 IDENTITY 自增；保留 schema 结构与 init-v2.sql 一致。
 * 之后回种 sources('default') 与 config 默认值。
 */

import { sql } from "../src/core/db.ts";

const dryRun = process.argv.includes("--dry-run");

// 与 infra/init-v2.sql 全表对齐（v2.7.0 起含 llm_usage）。无 FK，不需要拓扑序。
const TRUNCATE_TABLES = [
  "agent_tool_executions",
  "agent_messages",
  "llm_usage",
  "minion_jobs",
  "events",
  "page_versions",
  "raw_data",
  "timeline_entries",
  "signals",
  "theses",
  "facts",
  "tags",
  "links",
  "content_chunks",
  "raw_files",
  "pages",
  "config",
  "sources",
];

// config 表当前 src 不读（保留作未来配置位）；这里更新到与代码默认一致的语义。
const CONFIG_SEEDS = [
  ["schema_version", "2"],
  ["embedding_model", "text-embedding-3-large"],
  ["embedding_dimensions", "1536"],
  ["chunk_strategy", "v2-block-aware"],
  ["default_locale", "zh-CN"],
  ["fact_extract_tier_a_enabled", "true"],
  ["fact_extract_tier_b_enabled", "true"],
  ["fact_extract_tier_c_enabled", "true"],
  ["fact_extract_llm_model", "gpt-5-mini"],
  ["fact_extract_pct_auto_convert", "true"],
];

console.log(`[reset-db] ${dryRun ? "DRY-RUN" : "REAL RUN"} clear business data`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*) FROM raw_files     WHERE deleted = 0) AS raw_files,
        (SELECT COUNT(*) FROM pages         WHERE deleted = 0) AS pages,
        (SELECT COUNT(*) FROM content_chunks WHERE deleted = 0) AS content_chunks,
        (SELECT COUNT(*) FROM raw_data      WHERE deleted = 0) AS raw_data,
        (SELECT COUNT(*) FROM facts         WHERE deleted = 0) AS facts,
        (SELECT COUNT(*) FROM theses        WHERE deleted = 0) AS theses,
        (SELECT COUNT(*) FROM signals       WHERE deleted = 0) AS signals,
        (SELECT COUNT(*) FROM minion_jobs   WHERE deleted = 0) AS minion_jobs,
        (SELECT COUNT(*) FROM events        WHERE deleted = 0) AS events,
        (SELECT COUNT(*) FROM agent_messages WHERE deleted = 0) AS agent_messages
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(`TRUNCATE TABLE ${TRUNCATE_TABLES.join(", ")} RESTART IDENTITY`);

    await tx`
      INSERT INTO sources (id, name, description, create_by, update_by)
      VALUES ('default', '主投资研究 wiki', '默认 wiki 分区', 'system:reset', 'system:reset')
    `;

    for (const [id, value] of CONFIG_SEEDS) {
      await tx`
        INSERT INTO config (id, value, create_by, update_by)
        VALUES (${id}, ${value}, 'system:reset', 'system:reset')
      `;
    }

    const after = await tx`
      SELECT
        (SELECT COUNT(*) FROM raw_files     WHERE deleted = 0) AS raw_files,
        (SELECT COUNT(*) FROM pages         WHERE deleted = 0) AS pages,
        (SELECT COUNT(*) FROM content_chunks WHERE deleted = 0) AS content_chunks,
        (SELECT COUNT(*) FROM raw_data      WHERE deleted = 0) AS raw_data,
        (SELECT COUNT(*) FROM facts         WHERE deleted = 0) AS facts,
        (SELECT COUNT(*) FROM sources       WHERE deleted = 0) AS sources,
        (SELECT COUNT(*) FROM config        WHERE deleted = 0) AS config
    `;
    console.log(`  after:  ${JSON.stringify(after[0])}`);

    if (dryRun) {
      console.log("[reset-db] DRY-RUN，回滚事务");
      throw new Error("__DRY_RUN_ROLLBACK__");
    }
  });
} catch (error) {
  if (dryRun && error?.message === "__DRY_RUN_ROLLBACK__") {
    console.log("[reset-db] dry-run 已回滚，退出");
    process.exit(0);
  }
  throw error;
}

console.log("[reset-db] 完成");
process.exit(0);
