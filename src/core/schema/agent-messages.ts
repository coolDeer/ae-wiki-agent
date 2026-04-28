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

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    jobId: bigint("job_id", { mode: "bigint" }).notNull(),
    turnIndex: integer("turn_index").notNull(),
    role: text("role").notNull(),
    content: jsonb("content").notNull(),
    model: text("model"),
    stopReason: text("stop_reason"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    ...auditFields,
  },
  (t) => ({
    jobTurnUq: uniqueIndex("uq_agent_messages_job_turn")
      .on(t.jobId, t.turnIndex)
      .where(sql`deleted = 0`),
    jobTurnIdx: index("idx_agent_messages_job_turn").on(t.jobId, t.turnIndex),
  })
);

export type AgentMessage = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;
