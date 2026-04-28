import { sql } from "../src/core/db.ts";
import { readFileSync } from "node:fs";

const dryRun = process.argv.includes("--dry-run");
const ddl = readFileSync(
  new URL("../infra/migrations/v2.6.0-agent-runtime.sql", import.meta.url),
  "utf-8"
)
  .replace(/^\s*BEGIN\s*;\s*$/gim, "")
  .replace(/^\s*COMMIT\s*;\s*$/gim, "");

console.log(`[migration] ${dryRun ? "DRY-RUN" : "REAL RUN"} v2.6.0-agent-runtime`);

try {
  await sql.begin(async (tx) => {
    const before = await tx`
      SELECT
        COUNT(*) FILTER (WHERE table_name = 'minion_jobs')             AS has_minion_jobs,
        COUNT(*) FILTER (WHERE table_name = 'agent_messages')          AS has_agent_messages,
        COUNT(*) FILTER (WHERE table_name = 'agent_tool_executions')   AS has_agent_tool_executions
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('minion_jobs', 'agent_messages', 'agent_tool_executions')
    `;
    console.log(`  before: ${JSON.stringify(before[0])}`);

    await tx.unsafe(ddl);

    const cols = await tx`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'minion_jobs' AND column_name = 'progress') OR
          (table_name = 'agent_messages' AND column_name IN ('job_id', 'turn_index', 'content')) OR
          (table_name = 'agent_tool_executions' AND column_name IN ('job_id', 'tool_use_id', 'status'))
        )
      ORDER BY table_name, column_name
    `;
    console.log(`  cols:   ${JSON.stringify(cols)}`);

    const idx = await tx`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'uq_agent_messages_job_turn',
          'uq_agent_tool_exec_job_tool_use',
          'idx_jobs_agent_skill'
        )
      ORDER BY indexname
    `;
    console.log(`  idx:    ${JSON.stringify(idx)}`);

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
