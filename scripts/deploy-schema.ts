#!/usr/bin/env bun
/**
 * 部署 v2 schema（infra/init-v2.sql）到 DATABASE_URL 指定的 Postgres。
 *
 * 用 postgres.js 直接执行整个 SQL 文件，免装 psql。
 *
 * 用法：
 *   bun run scripts/deploy-schema.ts
 *   bun run scripts/deploy-schema.ts --dry-run    # 仅打印将执行的 SQL
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const SQL_PATH = path.resolve(import.meta.dir, "../infra/init-v2.sql");
const url = process.env.DATABASE_URL;
const dryRun = process.argv.includes("--dry-run");

if (!url || url.includes("CHANGEME") || url.includes("PLACEHOLDER")) {
  console.error("✗ DATABASE_URL 未配置");
  process.exit(1);
}

console.log(`SQL 文件: ${SQL_PATH}`);
console.log(`目标: ${url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")}`);
console.log(dryRun ? "[dry-run]\n" : "");

const sqlContent = readFileSync(SQL_PATH, "utf-8");
console.log(`SQL 大小: ${sqlContent.length.toLocaleString()} 字符 / ${sqlContent.split("\n").length} 行\n`);

if (dryRun) {
  console.log("=== 前 50 行预览 ===");
  console.log(sqlContent.split("\n").slice(0, 50).join("\n"));
  process.exit(0);
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 30,
  idle_timeout: 5,
  prepare: false,
});

try {
  console.log("执行中...");
  // postgres.js 的 .unsafe() 支持多语句 + DO 块 + 函数定义
  const result = await sql.unsafe(sqlContent);
  console.log(`✓ 执行完成`);

  // 部署后立刻数表
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  console.log(`\n✓ 现有 ${tables.length} 张表:`);
  console.log(`  ${tables.map((t) => t.table_name).join(", ")}`);

  // 检查 sources 默认分区
  const defaultSrc = await sql`SELECT id, name FROM sources WHERE id = 'default'`;
  if (defaultSrc.length > 0) {
    console.log(`\n✓ sources.default 已存在: ${defaultSrc[0]?.name}`);
  }

  // 检查 config 种子
  const cfgCount = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM config`;
  console.log(`✓ config 种子项: ${cfgCount[0]?.count}`);

  console.log(`\n✅ schema 部署完成`);
} catch (e) {
  console.error(`\n✗ 部署失败:`);
  console.error(e);
  process.exit(1);
} finally {
  await sql.end();
}
