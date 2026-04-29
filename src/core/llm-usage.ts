/**
 * Token 用量记录 —— fire-and-forget。
 * 失败只 warn 不抛，不影响调用方主流程。
 *
 * 写到 `llm_usage` 表，被 web /usage 页消费。
 */

import { db, schema } from "./db.ts";
import { withCreateAudit, Actor } from "./audit.ts";
import type { LlmUsageSource } from "./schema/llm-usage.ts";

export interface RecordUsageInput {
  source: LlmUsageSource;
  model: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  totalTokens?: number | null;
  requestCount?: number;
  jobId?: bigint | null;
  metadata?: Record<string, unknown>;
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  try {
    await db.insert(schema.llmUsage).values(
      withCreateAudit(
        {
          source: input.source,
          model: input.model,
          tokensIn: input.tokensIn ?? null,
          tokensOut: input.tokensOut ?? null,
          totalTokens:
            input.totalTokens ??
            (input.tokensIn != null || input.tokensOut != null
              ? (input.tokensIn ?? 0) + (input.tokensOut ?? 0)
              : null),
          requestCount: input.requestCount ?? 1,
          jobId: input.jobId ?? null,
          metadata: input.metadata ?? {},
        },
        Actor.systemUsage
      )
    );
  } catch (e) {
    console.warn(`[llm-usage] record failed: ${(e as Error).message}`);
  }
}
