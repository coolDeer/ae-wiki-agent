import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.0-llm-usage.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.0-llm-usage`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT COUNT(*)::int AS has
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'llm_usage'
    `;
    console.log(`  before.has_llm_usage: ${before[0].has}`);

    await tx.unsafe(ddl);

    const cols = await tx`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'llm_usage'
      ORDER BY ordinal_position
    `;
    console.log(`  cols: ${JSON.stringify(cols)}`);

    const idx = await tx`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'llm_usage'
      ORDER BY indexname
    `;
    console.log(`  idx:  ${JSON.stringify(idx)}`);

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
