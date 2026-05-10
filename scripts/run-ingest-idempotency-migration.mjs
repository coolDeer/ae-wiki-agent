import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.11-ingest-idempotency.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(
  `[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.11-ingest-idempotency`
);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM pg_indexes WHERE indexname = 'uq_links') AS has_uq_links,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE indexname = 'uq_signals_thesis_source_type') AS has_uq_signals,
        (
          SELECT COUNT(*)::int
          FROM (
            SELECT 1
            FROM signals
            WHERE deleted = 0
              AND entity_page_id IS NOT NULL
              AND thesis_page_id IS NOT NULL
              AND source_page_id IS NOT NULL
            GROUP BY signal_type, entity_page_id, thesis_page_id, source_page_id
            HAVING COUNT(*) > 1
          ) x
        ) AS duplicate_signal_groups
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM pg_indexes WHERE indexname = 'uq_links') AS has_uq_links,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE indexname = 'uq_signals_thesis_source_type') AS has_uq_signals,
        (
          SELECT COUNT(*)::int
          FROM (
            SELECT 1
            FROM signals
            WHERE deleted = 0
              AND entity_page_id IS NOT NULL
              AND thesis_page_id IS NOT NULL
              AND source_page_id IS NOT NULL
            GROUP BY signal_type, entity_page_id, thesis_page_id, source_page_id
            HAVING COUNT(*) > 1
          ) x
        ) AS duplicate_signal_groups
    `;
    console.log(`  after:  ${JSON.stringify(after[0])}`);

    if (dryRun) throw new Error("__DRY_RUN_ROLLBACK__");
  });
} catch (e) {
  if (dryRun && e?.message === "__DRY_RUN_ROLLBACK__") {
    console.log("[migration] dry-run 已回滚");
    process.exit(0);
  }
  throw e;
}

console.log("[migration] 完成");
process.exit(0);
