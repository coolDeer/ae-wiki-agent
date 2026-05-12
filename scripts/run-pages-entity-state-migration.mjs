#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  let text = "";
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

loadDotEnv();

const dryRun = process.argv.includes("--dry-run");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const migrationPath = resolve(
  process.cwd(),
  "infra/migrations/v2.8.4-pages-entity-state.sql"
);
const migrationSql = readFileSync(migrationPath, "utf8");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sql.begin(async (tx) => {
    await tx.unsafe(migrationSql);
    if (dryRun) {
      console.log("[dry-run] v2.8.4-pages-entity-state applied in transaction; rolling back");
      throw new Error("__ROLLBACK_DRY_RUN__");
    }
  });
  console.log("v2.8.4-pages-entity-state migration applied");
} catch (error) {
  if (dryRun && error instanceof Error && error.message === "__ROLLBACK_DRY_RUN__") {
    console.log("[dry-run] rollback complete");
  } else {
    throw error;
  }
} finally {
  await sql.end();
}
