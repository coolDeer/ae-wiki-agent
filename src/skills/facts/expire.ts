/**
 * facts:expire — 把 period_end 已过 N 天的 latest fact 标 valid_to。
 *
 * 解决 CLAUDE.md 已知限制 #7："90 天前的 EPS 估计还会被当 latest 召回"。
 * 由 `facts_expire` minion job 与 CLI `ae-wiki facts:expire` 共用。
 */

import { sql } from "drizzle-orm";

import { Actor, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";

export interface ExpireFactsResult {
  ageDays: number;
  expiredAt: string;
  expiredCount: number;
  sampleIds: string[];
}

interface ExpireFactsOptions {
  ageDays?: number;
  /** 不写 audit event；用于诊断 / dry-run 编排（默认 false） */
  silent?: boolean;
}

export async function expireFacts(opts: ExpireFactsOptions = {}): Promise<ExpireFactsResult> {
  const ageDays = opts.ageDays ?? 90;

  const updated = (await db.execute(sql`
    UPDATE facts
    SET valid_to = CURRENT_DATE,
        update_time = NOW(),
        update_by = ${Actor.systemJobs}
    WHERE deleted = 0
      AND valid_to IS NULL
      AND period_end IS NOT NULL
      AND period_end < CURRENT_DATE - (${ageDays}::int * INTERVAL '1 day')
    RETURNING id::text AS id
  `)) as Array<{ id: string }>;

  const result: ExpireFactsResult = {
    ageDays,
    expiredAt: new Date().toISOString(),
    expiredCount: updated.length,
    sampleIds: updated.slice(0, 20).map((r) => r.id),
  };

  if (!opts.silent && updated.length > 0) {
    await db.insert(schema.events).values(
      withCreateAudit(
        {
          actor: Actor.systemJobs,
          action: "facts_expire",
          entityType: "fact",
          entityId: null,
          payload: result as unknown as Record<string, unknown>,
        },
        Actor.systemJobs
      )
    );
  }

  return result;
}
