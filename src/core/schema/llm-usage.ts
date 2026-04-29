import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

/**
 * 通用 token 用量表 —— 所有 OpenAI 调用统一登记。
 * 与 agent_messages 并存：agent_messages 是会话历史，llm_usage 是计量。
 */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    source: text("source").notNull(),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    totalTokens: integer("total_tokens"),
    requestCount: integer("request_count").notNull().default(1),
    jobId: bigint("job_id", { mode: "bigint" }),
    metadata: jsonb("metadata").notNull().default({}),
    ...auditFields,
  },
  (t) => ({
    timeIdx: index("idx_llm_usage_create_time")
      .on(sql`create_time DESC`)
      .where(sql`deleted = 0`),
    sourceTimeIdx: index("idx_llm_usage_source_time")
      .on(t.source, sql`create_time DESC`)
      .where(sql`deleted = 0`),
    modelTimeIdx: index("idx_llm_usage_model_time")
      .on(t.model, sql`create_time DESC`)
      .where(sql`deleted = 0`),
    jobIdx: index("idx_llm_usage_job")
      .on(t.jobId)
      .where(sql`deleted = 0 AND job_id IS NOT NULL`),
  })
);

export type LlmUsage = typeof llmUsage.$inferSelect;
export type NewLlmUsage = typeof llmUsage.$inferInsert;

export type LlmUsageSource =
  | "embedding"
  | "agent_runtime"
  | "web_chat"
  | "fact_extract"
  | "chunker_llm"
  | "query_expansion";
