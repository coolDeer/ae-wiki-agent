import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.7.6-deprecate-person-type.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.7.6-deprecate-person-type`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM pages WHERE type='person' AND deleted=0) AS active_persons,
        (SELECT COUNT(*)::int FROM pages WHERE type='person' AND deleted=1) AS deleted_persons,
        (SELECT COUNT(*)::int FROM links l
           JOIN pages p ON p.id = l.to_page_id
           WHERE p.type='person' AND l.deleted=0) AS active_links_to_persons
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    const after = await tx`
      SELECT
        (SELECT COUNT(*)::int FROM pages WHERE type='person' AND deleted=0) AS active_persons,
        (SELECT COUNT(*)::int FROM pages WHERE type='person' AND deleted=1) AS deleted_persons,
        (SELECT COUNT(*)::int FROM links l
           JOIN pages p ON p.id = l.to_page_id
           WHERE p.type='person' AND l.deleted=0) AS active_links_to_persons
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
