import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.ts";
import { getEnv } from "./env.ts";

const env = getEnv();

/**
 * postgres.js 客户端 — 高性能、原生 TS、Drizzle 默认搭配。
 *
 * 注意：v2 schema 的 vector 类型需要驱动支持。postgres.js 原生不识别 vector，
 * 但 INSERT 时把数组序列化为 '[0.1, 0.2, ...]' 字符串即可，SELECT 时 pgvector
 * 返回的也是该格式字符串，应用层手动 JSON.parse。详见 src/core/embedding.ts。
 */
export const sql = postgres(env.DATABASE_URL, {
  max: 10,                       // 连接池上限
  idle_timeout: 30,              // 空闲 30s 回收
  connect_timeout: 10,
  prepare: false,                // 兼容 PgBouncer / Supabase pooler
  types: {
    // pgvector：input 接受 number[]，output 也按字符串解析
    vector: {
      to: 1184,
      from: [1184],
      serialize: (v: number[] | string) =>
        Array.isArray(v) ? `[${v.join(",")}]` : v,
      parse: (s: string) => JSON.parse(s) as number[],
    },
  },
});

/**
 * Drizzle 客户端。所有业务代码通过这个跑 query。
 *
 * 用法：
 *   import { db, schema } from '~/core/db';
 *   const rows = await db.select().from(schema.pages).where(eq(schema.pages.deleted, 0));
 */
export const db = drizzle(sql, { schema });

export { schema };

// ─────────────────────────────────────────────────────────────────────────
// connectWithRetry — 借鉴 gbrain v0.22.2
//
// PgBouncer / Supabase pooler 冷启动 / 重启时第一次连接经常炸（"db starting"
// / "auth failed" 一秒后正常）。3 次 backoff（1s/2s/4s）+ 瞬态错误识别可以扛住。
// ─────────────────────────────────────────────────────────────────────────

const RETRYABLE_DB_PATTERNS = [
  /password authentication failed/i,
  /connection refused/i,
  /the database system is starting up/i,
  /Connection terminated unexpectedly/i,
  /ECONNRESET/i,
];

export function isRetryableDbConnectError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg) return false;
  return RETRYABLE_DB_PATTERNS.some((p) => p.test(msg));
}

export interface ConnectWithRetryOpts {
  attempts?: number;
  baseDelayMs?: number;
  noRetry?: boolean;
}

/**
 * 探测 DB 是否真的连得通。包一层重试。
 *
 * 调用点：CLI 长进程（worker / web）启动时调一次，避免 pooler 冷启动直接炸。
 * 内部就是 SELECT 1，连成功后立即返回；失败按 backoff 重试。
 *
 * env `WIKI_NO_RETRY_CONNECT=1` 可关掉重试。
 */
export async function connectWithRetry(
  opts: ConnectWithRetryOpts = {}
): Promise<void> {
  const noRetry = opts.noRetry ?? process.env.WIKI_NO_RETRY_CONNECT === "1";
  const attempts = noRetry ? 1 : opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await sql`SELECT 1`;
      return;
    } catch (e) {
      lastErr = e;
      const retryable = isRetryableDbConnectError(e);
      const isLast = i === attempts - 1;
      if (!retryable || isLast) throw e;
      const delay = baseDelayMs * Math.pow(2, i);
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[db] connect attempt ${i + 1} failed (${msg.slice(0, 80)}), retrying in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
