import { sql } from "drizzle-orm";

/**
 * UPDATE 时强制注入 update_time / update_by 的 helper。
 *
 * 用法：
 *   await db.update(pages)
 *     .set(withAudit({ title: 'new title' }, 'agent:claude'))
 *     .where(eq(pages.id, pageId));
 *
 * 不要让任何 UPDATE 路径绕过这个 helper（会丢失审计追踪）。
 */
export function withAudit<T extends Record<string, unknown>>(
  fields: T,
  actor: string
): T & { updateTime: ReturnType<typeof sql>; updateBy: string } {
  return {
    ...fields,
    updateTime: sql`NOW()`,
    updateBy: actor,
  } as T & { updateTime: ReturnType<typeof sql>; updateBy: string };
}

/**
 * INSERT 时也填 create_by / update_by（DB 默认空字符串，建议显式填）。
 */
export function withCreateAudit<T extends Record<string, unknown>>(
  fields: T,
  actor: string
): T & { createBy: string; updateBy: string } {
  return {
    ...fields,
    createBy: actor,
    updateBy: actor,
  };
}

/** Actor 命名约定。 */
export const Actor = {
  agentClaude: "agent:claude",
  agentSignalDetector: "agent:signal-detector",
  agentEnricher: "agent:enricher",
  systemFetch: "system:fetch-reports",
  systemIngest: "system:ingest",
  systemCron: "system:cron",
  systemInit: "system:init",
  human: (name: string) => `human:${name}`,
} as const;
