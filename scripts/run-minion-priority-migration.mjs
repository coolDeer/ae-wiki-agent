import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.4-minion-jobs-priority.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.4-minion-jobs-priority`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='minion_jobs'
            AND column_name='priority') AS has_priority,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='idx_jobs_pick') AS has_pick_idx
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='minion_jobs'
            AND column_name='priority') AS has_priority,
        (SELECT COUNT(*)::int FROM pg_indexes
          WHERE schemaname='public' AND indexname='idx_jobs_pick') AS has_pick_idx
    `;
    console.log(`  after:  ${JSON.stringify(after[0])}`);

    const dist = await tx`
      SELECT name, priority, COUNT(*)::int AS n
      FROM minion_jobs WHERE deleted = 0
      GROUP BY name, priority
      ORDER BY name, priority DESC
    `;
    console.log(`  priority distribution:`);
    console.table(dist);

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
