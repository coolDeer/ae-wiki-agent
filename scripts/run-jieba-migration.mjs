import { sql } from "../src/core/db.ts";
import { tokenizeForIndex } from "../src/core/tokenize.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.3.0-jieba-tokens.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.3.0-jieba-tokens`);

await sql.begin(async (tx) => {
  // 1. 跑 DDL
  await tx.unsafe(ddl);

  // 验证 column + trigger
  const cols = await tx`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='pages' AND column_name='tokens_zh'
  `;
  if (cols.length === 0) throw new Error("tokens_zh 列没加上");
  console.log("  ✓ tokens_zh column added");

  const fn = await tx`SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname='update_pages_tsv'`;
  if (!fn[0]?.def?.includes("tokens_zh")) throw new Error("trigger 函数没更新");
  console.log("  ✓ trigger references tokens_zh");

  // 2. backfill 现有行
  const rows = await tx`SELECT id, content FROM pages WHERE deleted=0 AND tokens_zh IS NULL`;
  console.log(`  backfilling ${rows.length} pages...`);
  for (const r of rows) {
    const tokens = tokenizeForIndex(r.content || "");
    await tx`UPDATE pages SET tokens_zh = ${tokens} WHERE id = ${r.id}`;
  }
  console.log(`  ✓ ${rows.length} pages tokens_zh filled (trigger 自动重算 tsv)`);

  if (dryRun) throw new Error("DRY_RUN_ROLLBACK");
}).catch((e) => {
  if (e.message === "DRY_RUN_ROLLBACK") {
    console.log("[migration] ✅ DRY-RUN ok（已 ROLLBACK）");
  } else {
    throw e;
  }
});

if (!dryRun) console.log("[migration] ✅ COMMITTED");
await sql.end();
