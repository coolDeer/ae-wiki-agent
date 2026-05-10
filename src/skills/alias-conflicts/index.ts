/**
 * alias-conflicts 诊断
 *
 * 找出多个 active page 共享同一 alias / title / slug-name 的情况。
 * 这是 entity 裂化和误合并的前置信号：同一个词同时指向多页，
 * search / resolveOrCreatePage / enrich merge 都会更容易漂。
 */

import { sql } from "drizzle-orm";

import { db } from "~/core/db.ts";

const ELIGIBLE_TYPES = ["company", "industry", "concept", "thesis"];

export interface AliasConflictPage {
  pageId: string;
  slug: string;
  title: string;
  type: string;
  confidence: string;
}

export interface AliasConflictRow {
  alias: string;
  pageCount: number;
  pages: AliasConflictPage[];
}

export interface AliasConflictReport {
  generatedAt: string;
  filters: {
    type: string | null;
    limit: number;
  };
  totalAliasesInConflict: number;
  rows: AliasConflictRow[];
}

export async function findAliasConflicts(opts: {
  type?: string;
  limit?: number;
} = {}): Promise<AliasConflictReport> {
  const limit = opts.limit ?? 50;
  if (opts.type && !ELIGIBLE_TYPES.includes(opts.type)) {
    throw new Error(
      `type='${opts.type}' 不支持。允许: ${ELIGIBLE_TYPES.join(" / ")}`
    );
  }

  const typeFilter = opts.type
    ? sql`AND p.type = ${opts.type}`
    : sql`AND p.type IN (${sql.join(
        ELIGIBLE_TYPES.map((t) => sql`${t}`),
        sql`, `
      )})`;

  const rows = (await db.execute(sql`
    WITH names AS (
      SELECT
        p.id,
        p.slug,
        p.title,
        p.type,
        COALESCE(p.confidence, 'unknown') AS confidence,
        lower(trim(v.alias)) AS alias_key,
        trim(v.alias) AS alias_original
      FROM pages p
      CROSS JOIN LATERAL (
        SELECT unnest(
          array_remove(
            ARRAY[
              p.title,
              split_part(p.slug, '/', 2)
            ] || COALESCE(p.aliases, ARRAY[]::text[]),
            NULL
          )
        ) AS alias
      ) v
      WHERE p.deleted = 0
        ${typeFilter}
        AND trim(v.alias) <> ''
    ),
    grouped AS (
      SELECT
        alias_key,
        MIN(alias_original) AS alias_display,
        COUNT(DISTINCT id)::int AS page_count
      FROM names
      GROUP BY alias_key
      HAVING COUNT(DISTINCT id) > 1
    )
    SELECT
      g.alias_display AS alias,
      g.page_count,
      n.id::text AS page_id,
      n.slug,
      n.title,
      n.type,
      n.confidence
    FROM grouped g
    JOIN names n ON n.alias_key = g.alias_key
    ORDER BY g.page_count DESC, g.alias_display ASC, n.id ASC
  `)) as Array<{
    alias: string;
    page_count: number;
    page_id: string;
    slug: string;
    title: string;
    type: string;
    confidence: string;
  }>;

  const groupedRows = new Map<string, AliasConflictRow>();
  for (const row of rows) {
    const existing = groupedRows.get(row.alias) ?? {
      alias: row.alias,
      pageCount: row.page_count,
      pages: [],
    };
    if (!existing.pages.some((page) => page.pageId === row.page_id)) {
      existing.pages.push({
        pageId: row.page_id,
        slug: row.slug,
        title: row.title,
        type: row.type,
        confidence: row.confidence,
      });
    }
    groupedRows.set(row.alias, existing);
  }

  const allRows = Array.from(groupedRows.values()).slice(0, limit);
  return {
    generatedAt: new Date().toISOString(),
    filters: {
      type: opts.type ?? null,
      limit,
    },
    totalAliasesInConflict: groupedRows.size,
    rows: allRows,
  };
}

export function formatAliasConflictReport(report: AliasConflictReport): string {
  const lines = [
    `Alias conflicts (${report.rows.length}/${report.totalAliasesInConflict} aliases shown)`,
    `  filter: type=${report.filters.type ?? "(all eligible)"}, limit=${report.filters.limit}`,
    "",
  ];

  if (report.rows.length === 0) {
    lines.push("No alias conflicts detected.");
    return lines.join("\n");
  }

  for (const row of report.rows) {
    lines.push(`  "${row.alias}" → ${row.pageCount} pages`);
    for (const page of row.pages) {
      lines.push(
        `    #${page.pageId.padStart(4)} [${page.type.padEnd(8)}] ${page.slug} (${page.confidence})`
      );
    }
    lines.push("");
  }

  lines.push("Suggested actions:");
  lines.push("  1. Decide whether this is a true duplicate or a legitimate ambiguous term.");
  lines.push("  2. For true duplicates, merge aliases into the canonical page and retype / retire the other page.");
  lines.push("  3. For ambiguous terms, remove the alias from weaker pages so entity resolution stops drifting.");
  return lines.join("\n");
}
