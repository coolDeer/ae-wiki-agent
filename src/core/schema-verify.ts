/**
 * Post-migration schema verification with self-healing.
 *
 * 借鉴 gbrain v0.22.6.1 schema-verify。
 *
 * PgBouncer transaction-mode pooler 会**静默吞 ALTER TABLE** —— DDL 不报错，
 * 列也没建。Migration 系统的版本号涨了，但表是旧的。第一次 INSERT 才会炸。
 *
 * 解法：跑完 migration 后，对 `infra/init-v2.sql`（schema 真相源）和
 * `information_schema.columns` 做 diff，缺列用 `ALTER TABLE ADD COLUMN
 * IF NOT EXISTS` 自愈。失败抛带诊断信息的 error。
 *
 * CLI: `bun src/cli.ts verify-schema`
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "./db.ts";

export interface ExpectedColumn {
  table: string;
  column: string;
  /** CREATE TABLE / ALTER TABLE 里截下来的原始定义（type + 修饰） */
  definition: string;
}

const SCHEMA_FILE = path.resolve(import.meta.dir, "../../infra/init-v2.sql");

/**
 * 解析 init-v2.sql 抽出 (table, column, definition) 三元组。
 *
 * 处理：
 *   - CREATE TABLE IF NOT EXISTS <name> (...)
 *   - ALTER TABLE <name> ADD COLUMN IF NOT EXISTS <col> <def>
 * 跳过：
 *   - CONSTRAINT / UNIQUE / CHECK / PRIMARY KEY / FOREIGN KEY 行
 *   - 注释 / 空行
 */
export function parseExpectedColumns(): ExpectedColumn[] {
  const ddl = readFileSync(SCHEMA_FILE, "utf-8");
  const results: ExpectedColumn[] = [];

  const tableRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/gi;
  const SQL_KEYWORDS = new Set([
    "constraint",
    "unique",
    "check",
    "primary",
    "foreign",
    "exclude",
  ]);

  function processLine(table: string, line: string) {
    const trimmed = line.trim().replace(/,\s*$/, "");
    if (!trimmed) return;
    if (/^\s*(CONSTRAINT|UNIQUE|CHECK|PRIMARY\s+KEY|FOREIGN\s+KEY)/i.test(trimmed)) return;
    const m = trimmed.match(/^\s*(\w+)\s+(.+)$/);
    if (!m) return;
    const colName = m[1]!.toLowerCase();
    if (SQL_KEYWORDS.has(colName)) return;
    results.push({ table, column: colName, definition: m[2]!.trim() });
  }

  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(ddl)) !== null) {
    const tableName = match[1]!;
    const body = match[2]!;
    const lines = body.split("\n");
    let buf = "";
    for (const raw of lines) {
      const t = raw.trim();
      if (!t || t.startsWith("--")) {
        if (buf.trim()) {
          processLine(tableName, buf);
          buf = "";
        }
        continue;
      }
      buf += " " + t;
      if (t.endsWith(",")) {
        processLine(tableName, buf);
        buf = "";
      }
    }
    if (buf.trim()) processLine(tableName, buf);
  }

  // ALTER TABLE ... ADD COLUMN IF NOT EXISTS（init-v2.sql 里用得不多但有）
  const seen = new Set(results.map((r) => `${r.table}.${r.column}`));
  const alterRegex =
    /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+([^;,]+)/gi;
  let am: RegExpExecArray | null;
  while ((am = alterRegex.exec(ddl)) !== null) {
    const t = am[1]!;
    const c = am[2]!.toLowerCase();
    const d = am[3]!.trim().replace(/,\s*$/, "");
    const k = `${t}.${c}`;
    if (!seen.has(k)) {
      seen.add(k);
      results.push({ table: t, column: c, definition: d });
    }
  }

  return results;
}

/**
 * 把 CREATE TABLE 的列定义简化成可以喂给 ALTER TABLE ADD COLUMN 的形式：
 * 删 REFERENCES / CHECK / 内联 UNIQUE，保留 type / NOT NULL / DEFAULT。
 */
export function simplifyColumnDef(def: string): string {
  let out = def;
  out = out.replace(
    /REFERENCES\s+\w+\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+\w+(\s+\w+)?)*\s*/gi,
    ""
  );
  out = out.replace(/CHECK\s*\((?:[^()]*|\([^()]*\))*\)/gi, "");
  out = out.replace(/\bUNIQUE\b/gi, "");
  out = out.replace(/,\s*$/, "").trim();
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

export interface VerifyResult {
  checked: number;
  missing: Array<{ table: string; column: string }>;
  healed: Array<{ table: string; column: string }>;
  failed: Array<{ table: string; column: string; error: string }>;
}

async function getActualColumns(): Promise<Set<string>> {
  const rows = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const out = new Set<string>();
  for (const r of rows) out.add(`${r.table_name}.${r.column_name}`);
  return out;
}

async function getActualTables(): Promise<Set<string>> {
  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  return new Set(rows.map((r) => r.table_name));
}

/**
 * 跑完 migration 后调一次。
 *
 * 缺列 → ALTER TABLE ADD COLUMN IF NOT EXISTS 自愈。
 * 自愈失败 → 抛 actionable error。
 */
export async function verifySchema(): Promise<VerifyResult> {
  const expected = parseExpectedColumns();
  const actualColumns = await getActualColumns();
  const actualTables = await getActualTables();

  const result: VerifyResult = { checked: 0, missing: [], healed: [], failed: [] };

  for (const col of expected) {
    if (!actualTables.has(col.table)) continue;
    result.checked++;
    if (!actualColumns.has(`${col.table}.${col.column}`)) {
      result.missing.push({ table: col.table, column: col.column });
    }
  }

  if (result.missing.length === 0) return result;

  console.warn(`\n⚠️  schema-verify: 发现 ${result.missing.length} 列缺失`);
  for (const m of result.missing) console.warn(`  - ${m.table}.${m.column}`);
  console.warn(`  尝试 ALTER TABLE ADD COLUMN IF NOT EXISTS 自愈...\n`);

  const defMap = new Map<string, string>();
  for (const c of expected) defMap.set(`${c.table}.${c.column}`, c.definition);

  for (const m of result.missing) {
    const raw = defMap.get(`${m.table}.${m.column}`);
    if (!raw) {
      result.failed.push({ ...m, error: "schema 里没有定义" });
      continue;
    }
    const simple = simplifyColumnDef(raw);
    try {
      await sql.unsafe(
        `ALTER TABLE ${m.table} ADD COLUMN IF NOT EXISTS ${m.column} ${simple}`
      );
      result.healed.push({ table: m.table, column: m.column });
      console.log(`  ✓ ${m.table}.${m.column}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed.push({ ...m, error: msg });
      console.error(`  ✗ ${m.table}.${m.column}: ${msg}`);
    }
  }

  if (result.healed.length > 0) {
    console.log(
      `\n  schema-verify: 自愈 ${result.healed.length}/${result.missing.length} 列\n`
    );
  }

  if (result.failed.length > 0) {
    const list = result.failed
      .map((f) => `${f.table}.${f.column}: ${f.error}`)
      .join("\n  ");
    throw new Error(
      `schema-verify failed: ${result.failed.length} 列无法自愈：\n  ${list}\n` +
        "\n常见原因：PgBouncer transaction-mode 静默吞了 ALTER TABLE。\n" +
        "修法：直连 Postgres（不走 pooler）后重跑 migration 脚本。"
    );
  }

  return result;
}
