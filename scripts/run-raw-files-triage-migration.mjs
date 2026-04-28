import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.5.1-raw-files-triage.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.5.1-raw-files-triage`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'raw_files'
        AND column_name IN ('triage_decision', 'skipped_at', 'skip_reason')
      ORDER BY column_name
    `;
    console.log(`  before: ${JSON.stringify(before)}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'raw_files'
        AND column_name IN ('triage_decision', 'skipped_at', 'skip_reason')
      ORDER BY column_name
    `;
    console.log(`  after:  ${JSON.stringify(after)}`);

    if (dryRun) {
      console.log("[migration] DRY-RUN，回滚事务");
      throw new Error("__DRY_RUN_ROLLBACK__");
    }
  });
} catch (error) {
  if (dryRun && error?.message === "__DRY_RUN_ROLLBACK__") {
    console.log("[migration] dry-run 已回滚，退出");
    process.exit(0);
  }
  throw error;
}

console.log("[migration] 完成");
