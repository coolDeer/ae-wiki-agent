import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.9-link-type-check.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.9-link-type-check`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM pg_constraint
          WHERE conname='links_link_type_chk') AS has_chk,
        (SELECT COUNT(DISTINCT link_type)::int FROM links WHERE deleted=0) AS distinct_types,
        (SELECT COUNT(*)::int FROM links WHERE deleted=0
          AND link_type NOT IN ('mention','confirms','contradicts','supersedes',
                                 'cites','critiques','derives_from','tracks')) AS bad_rows
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    if (before[0].bad_rows > 0) {
      throw new Error(
        `存在 ${before[0].bad_rows} 行 link_type 不在白名单内，CHECK 会失败。先清理脏数据。`
      );
    }

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM pg_constraint
          WHERE conname='links_link_type_chk') AS has_chk,
        (SELECT COUNT(*)::int FROM links WHERE deleted=0) AS rows
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
