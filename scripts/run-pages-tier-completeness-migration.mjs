import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.7-pages-tier-completeness.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.7-pages-tier-completeness`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_name='pages' AND column_name='tier') AS has_tier,
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_name='pages' AND column_name='completeness_score') AS has_score,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='idx_pages_completeness') AS has_idx
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_name='pages' AND column_name='tier') AS has_tier,
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_name='pages' AND column_name='completeness_score') AS has_score,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='idx_pages_completeness') AS has_idx,
        (SELECT COUNT(*)::int FROM pages WHERE deleted = 0) AS rows_total,
        (SELECT COUNT(*)::int FROM pages WHERE deleted = 0 AND tier = 3) AS rows_default_tier,
        (SELECT COUNT(*)::int FROM pages WHERE deleted = 0 AND completeness_score = 0) AS rows_default_score
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
