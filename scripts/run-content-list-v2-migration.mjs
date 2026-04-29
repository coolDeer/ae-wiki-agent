import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.1-content-list-v2.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.1-content-list-v2`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='raw_files'
            AND column_name='parsed_content_list_v2_url') AS rf_has_v2,
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='content_chunks'
            AND column_name='section_path') AS cc_has_section
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='raw_files'
            AND column_name='parsed_content_list_v2_url') AS rf_has_v2,
        (SELECT COUNT(*)::int FROM information_schema.columns
          WHERE table_schema='public' AND table_name='content_chunks'
            AND column_name='section_path') AS cc_has_section
    `;
    console.log(`  after:  ${JSON.stringify(after[0])}`);

    const backfilled = await tx`
      SELECT COUNT(*)::int AS n
      FROM raw_files
      WHERE parsed_content_list_v2_url IS NOT NULL
    `;
    console.log(`  raw_files with V2 URL after run: ${backfilled[0].n}`);

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
