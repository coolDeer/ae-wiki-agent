import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.6.3-remove-jieba-tokens.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.6.3-remove-jieba-tokens`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'pages'
        AND column_name IN ('content', 'tokens_zh', 'timeline', 'tsv')
      ORDER BY column_name
    `;
    console.log(`  before: ${JSON.stringify(before)}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'pages'
        AND column_name IN ('content', 'tokens_zh', 'timeline', 'tsv')
      ORDER BY column_name
    `;
    console.log(`  after:  ${JSON.stringify(after)}`);

    const fn = await tx`
      SELECT pg_get_functiondef('update_pages_tsv'::regproc) AS def
    `;
    console.log(`  trigger_uses_removed_column=${Boolean(fn[0]?.def?.includes("tokens_zh"))}`);

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
