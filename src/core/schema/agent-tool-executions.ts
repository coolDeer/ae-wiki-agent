import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

export const agentToolExecutions = pgTable(
  "agent_tool_executions",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    jobId: bigint("job_id", { mode: "bigint" }).notNull(),
    turnIndex: integer("turn_index").notNull(),
    toolUseId: text("tool_use_id").notNull(),
    toolName: text("tool_name").notNull(),
    status: text("status").notNull().default("pending"),
    input: jsonb("input").notNull().default({}),
    output: jsonb("output"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...auditFields,
  },
  (t) => ({
    toolUseUq: uniqueIndex("uq_agent_tool_exec_job_tool_use")
      .on(t.jobId, t.toolUseId)
      .where(sql`deleted = 0`),
    jobTurnIdx: index("idx_agent_tool_exec_job_turn").on(t.jobId, t.turnIndex),
    statusIdx: index("idx_agent_tool_exec_status").on(t.status, t.startedAt),
  })
);

export type AgentToolExecution = typeof agentToolExecutions.$inferSelect;
export type NewAgentToolExecution = typeof agentToolExecutions.$inferInsert;
