#!/usr/bin/env bun
/**
 * Postgres 连通性 + schema 状态测试
 *
 * 检查：
 *   1. TCP / 认证连通
 *   2. Postgres 版本
 *   3. pgvector 扩展是否可用
 *   4. v2 schema 部署状态（15 张表是否齐全）
 *   5. config 表种子数据
 *
 * 用法：bun run scripts/test-pg.ts
 */

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url || url.includes("CHANGEME") || url.includes("PLACEHOLDER")) {
  console.error("✗ DATABASE_URL 未配置（请编辑 .env）");
  process.exit(1);
}

console.log(`连接到: ${url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")}\n`);

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
});

const EXPECTED_TABLES = [
  "sources",
  "pages",
  "content_chunks",
  "links",
  "tags",
  "facts",
  "theses",
  "signals",
  "timeline_entries",
  "raw_files",
  "raw_data",
  "page_versions",
  "events",
  "minion_jobs",
  "config",
];

try {
  // 1. 版本
  const versionRow = await sql`SELECT version() AS v`;
  console.log(`✓ ${versionRow[0]?.v?.split(",")[0] ?? "unknown"}`);

  // 2. pgvector 扩展
  const ext = await sql`
    SELECT extname, extversion
    FROM pg_extension
    WHERE extname IN ('vector', 'pg_trgm', 'pgcrypto')
    ORDER BY extname
  `;
  if (ext.length === 0) {
    console.log(`⚠ 未安装 pgvector / pg_trgm / pgcrypto 扩展（init-v2.sql 会自动 CREATE EXTENSION）`);
  } else {
    for (const e of ext) {
      console.log(`✓ extension ${e.extname} v${e.extversion}`);
    }
  }

  // 3. 检查 schema 部署
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const existingNames = new Set(tables.map((t) => t.table_name));
  const missing = EXPECTED_TABLES.filter((t) => !existingNames.has(t));
  const extra = tables
    .map((t) => t.table_name)
    .filter((t) => !EXPECTED_TABLES.includes(t));

  console.log(`\n表清单（v2 期望 15 张）:`);
  console.log(`  现有: ${tables.length}`);
  console.log(`  缺失: ${missing.length}${missing.length > 0 ? ` [${missing.join(", ")}]` : ""}`);
  if (extra.length > 0) console.log(`  额外: ${extra.length} [${extra.slice(0, 5).join(", ")}${extra.length > 5 ? ", ..." : ""}]`);

  if (missing.length === EXPECTED_TABLES.length) {
    console.log(`\n⚠ schema 尚未部署。运行：`);
    console.log(`    psql "$DATABASE_URL" -f infra/init-v2.sql`);
    process.exit(2);
  }

  if (missing.length > 0) {
    console.log(`\n⚠ schema 部分缺失，建议重跑 init-v2.sql`);
    process.exit(2);
  }

  // 4. config 表种子检查
  const cfg = await sql<{ id: string; value: string }[]>`
    SELECT id, value FROM config WHERE deleted = 0 ORDER BY id
  `;
  console.log(`\nconfig 表（${cfg.length} 项）:`);
  for (const c of cfg) {
    console.log(`  ${c.id} = ${c.value}`);
  }

  // 5. sources 默认分区
  const sources = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM sources WHERE deleted = 0
  `;
  console.log(`\nsources 表（${sources.length} 项）:`);
  for (const s of sources) {
    console.log(`  ${s.id}: ${s.name}`);
  }

  // 6. 各表行数（轻量统计）
  console.log(`\n各表行数:`);
  for (const tbl of EXPECTED_TABLES) {
    const r = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM ${sql(tbl)}`;
    const c = r[0]?.count ?? "0";
    if (c !== "0") console.log(`  ${tbl.padEnd(20)} ${c}`);
  }

  console.log(`\n✅ Postgres 全部检查通过`);
} catch (e) {
  console.error(`\n✗ 测试失败:`);
  console.error(e);
  process.exit(1);
} finally {
  await sql.end();
}
