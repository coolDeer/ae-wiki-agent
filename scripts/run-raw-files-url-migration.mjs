import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.5.0-raw-files-url.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.5.0-raw-files-url`);

try {
  await sql.begin(async (tx) => {
    // 跑前快照
    const before = await tx`
      SELECT
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE deleted = 0)         AS active,
        COUNT(*) FILTER (WHERE mongo_doc IS NULL)   AS no_mongo_doc
      FROM raw_files
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    // 验证 markdown_url 已加
    const cols = await tx`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='raw_files'
        AND column_name IN ('markdown_url','raw_path')
      ORDER BY column_name
    `;
    const colNames = cols.map((c) => c.column_name);
    if (!colNames.includes("markdown_url")) throw new Error("markdown_url 没加上");
    if (colNames.includes("raw_path")) throw new Error("raw_path 没删干净");
    console.log(`  ✓ 列结构: + markdown_url, - raw_path`);

    // 验证索引干净
    const idx = await tx`
      SELECT indexname FROM pg_indexes
      WHERE tablename='raw_files' AND indexname='uq_raw_files_path'
    `;
    if (idx.length > 0) throw new Error("uq_raw_files_path 没删干净");
    console.log(`  ✓ uq_raw_files_path 已删`);

    // 回填验证
    const stats = await tx`
      SELECT
        COUNT(*)                                                   AS total,
        COUNT(*) FILTER (WHERE markdown_url IS NOT NULL)           AS with_url,
        COUNT(*) FILTER (WHERE markdown_url IS NULL)               AS without_url,
        COUNT(*) FILTER (WHERE update_by = 'system:migration-v2.5.0') AS backfilled
      FROM raw_files
      WHERE deleted = 0
    `;
    console.log(`  after:  ${JSON.stringify(stats[0])}`);

    // 没 markdown_url 的样本（应当只有 mongo_doc 缺 parsedMarkdownS3 的极端老行）
    const orphans = await tx`
      SELECT id, research_id, research_type, title
      FROM raw_files
      WHERE deleted = 0 AND markdown_url IS NULL
      ORDER BY id DESC
      LIMIT 5
    `;
    if (orphans.length > 0) {
      console.warn(`  ⚠️  ${orphans.length} 行 markdown_url 仍为 NULL（样本）：`);
      for (const o of orphans) {
        console.warn(`     #${o.id} ${o.research_type}/${o.title?.slice(0, 60)}`);
      }
    }

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
