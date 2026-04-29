import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.3-revert-record-id.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.3-revert-record-id`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='raw_files'
            AND column_name='record_id') AS rf_has_record_id,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='uq_raw_files_record_id') AS new_unique_present,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='idx_raw_files_research_id') AS grouping_idx_present,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='uq_raw_files_research_id') AS old_unique_present
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='raw_files'
            AND column_name='record_id') AS rf_has_record_id,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='uq_raw_files_record_id') AS new_unique_present,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='idx_raw_files_research_id') AS grouping_idx_present,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='uq_raw_files_research_id') AS old_unique_present
    `;
    console.log(`  after:  ${JSON.stringify(after[0])}`);

    if (dryRun) {
      console.log("[migration] DRY-RUN，回滚事务");
      throw new Error("__DRY_RUN_ROLLBACK__");
    }
  });
} catch (e) {
  if (dryRun && e?.message === "__DRY_RUN_ROLLBACK__") {
    console.log("[migration] dry-run 已回滚，退出");
    process.exit(0);
  }
  throw e;
}

console.log("[migration] 完成");
process.exit(0);
