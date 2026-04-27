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
