import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.5-pg-trgm-suggestions.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.5-pg-trgm-suggestions`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM pg_extension WHERE extname='pg_trgm') AS has_trgm,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname='public' AND indexname='idx_pages_title_trgm') AS title_idx,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname='public' AND indexname='idx_pages_slug_trgm') AS slug_idx
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM pg_extension WHERE extname='pg_trgm') AS has_trgm,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname='public' AND indexname='idx_pages_title_trgm') AS title_idx,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname='public' AND indexname='idx_pages_slug_trgm') AS slug_idx
    `;
    console.log(`  after:  ${JSON.stringify(after[0])}`);

    // smoke test similarity
    const probe = await tx`SELECT similarity('Lumentum', 'Lumetum') AS sim`;
    console.log(`  similarity('Lumentum','Lumetum') = ${probe[0].sim}`);

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
