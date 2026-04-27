import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.4.0-raw-files-skipped.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.4.0-raw-files-skipped`);

try {
await sql.begin(async (tx) => {
  await tx.unsafe(ddl);

  // 验证列
  const cols = await tx`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='raw_files' AND column_name IN ('skipped_at','skip_reason')
    ORDER BY column_name
  `;
  if (cols.length !== 2) throw new Error(`期望 2 列 (skipped_at, skip_reason)，实际 ${cols.length}`);
  console.log(`  ✓ 列已加: ${cols.map((c) => c.column_name).join(", ")}`);

  // 验证索引
  const idx = await tx`
    SELECT indexname FROM pg_indexes
    WHERE tablename='raw_files' AND indexname='idx_raw_files_skipped'
  `;
  if (idx.length === 0) throw new Error("idx_raw_files_skipped 没建上");
  console.log("  ✓ 索引已建");

  // 检查 backfill 效果
  const backfilled = await tx`
    SELECT id, raw_path, skipped_at, skip_reason
    FROM raw_files
    WHERE update_by = 'system:migration-v2.4.0'
    ORDER BY id
  `;
  console.log(`  ✓ backfill 了 ${backfilled.length} 行：`);
  for (const r of backfilled) {
    console.log(`    - raw_file #${r.id} (${r.raw_path.slice(-50)}): ${r.skip_reason}`);
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
