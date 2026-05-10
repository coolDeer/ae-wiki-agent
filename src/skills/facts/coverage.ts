/**
 * facts coverage backlog
 *
 * 目标：找出“看起来应该有 fact，但结构化层为空/偏薄”的 page。
 *
 * 当前重点看 source / brief：
 *   - 有 table artifact
 *   - 或 narrative 里有 facts block marker
 *   - 但 source_page_id 对应的 facts 数为 0 或很少
 */

import { sql } from "drizzle-orm";

import { db } from "~/core/db.ts";

export interface FactsCoverageRow {
  pageId: string;
  slug: string;
  type: string;
  title: string;
  factsCount: number;
  hasFactsBlock: boolean;
  tableCount: number;
  contentChars: number;
  numericTokenCount: number;
  coverageRisk: "high" | "medium";
  reason: string;
}

export interface FactsCoverageReport {
  generatedAt: string;
  filters: {
    type: "source" | "brief" | "all";
    limit: number;
  };
  summary: {
    highRisk: number;
    mediumRisk: number;
  };
  rows: FactsCoverageRow[];
}

export async function getFactsCoverageBacklog(opts: {
  type?: "source" | "brief" | "all";
  limit?: number;
} = {}): Promise<FactsCoverageReport> {
  const type = opts.type ?? "all";
  const limit = opts.limit ?? 30;
  const typeFilter =
    type === "all"
      ? sql`AND p.type IN ('source', 'brief')`
      : sql`AND p.type = ${type}`;

  const rows = (await db.execute(sql`
    WITH fact_counts AS (
      SELECT source_page_id, COUNT(*)::int AS n
      FROM facts
      WHERE deleted = 0 AND source_page_id IS NOT NULL
      GROUP BY source_page_id
    ),
    table_counts AS (
      SELECT
        rd.page_id,
        COALESCE((rd.data->>'tableCount')::int, 0) AS table_count
      FROM raw_data rd
      WHERE rd.deleted = 0
        AND rd.source = 'tables'
    )
    SELECT
      p.id::text AS page_id,
      p.slug,
      p.type,
      p.title,
      p.content,
      COALESCE(fc.n, 0) AS facts_count,
      COALESCE(tc.table_count, 0) AS table_count
    FROM pages p
    LEFT JOIN fact_counts fc ON fc.source_page_id = p.id
    LEFT JOIN table_counts tc ON tc.page_id = p.id
    WHERE p.deleted = 0
      ${typeFilter}
      AND (
        tc.table_count > 0
        OR p.content ~ '<!--\\s*facts'
      )
    ORDER BY
      COALESCE(tc.table_count, 0) DESC,
      COALESCE(fc.n, 0) ASC,
      p.id DESC
    LIMIT ${limit}
  `)) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    content: string;
    facts_count: number;
    table_count: number;
  }>;

  const mapped = rows
    .map((row) => {
      const hasFactsBlock = /<!--\s*facts\b/i.test(row.content);
      const contentChars = stripMarkdown(row.content).length;
      const numericTokenCount = (row.content.match(/\b\d[\d.,%xmbnk]*\b/gi) ?? []).length;
      const coverageRisk =
        row.table_count > 0 && row.facts_count === 0
          ? "high"
          : row.facts_count <= 1
            ? "medium"
            : null;
      if (!coverageRisk) return null;
      const reason =
        row.table_count > 0 && row.facts_count === 0
          ? `has ${row.table_count} table artifacts but no extracted facts`
          : hasFactsBlock && row.facts_count === 0
            ? "facts block exists but no facts landed in facts table"
            : `only ${row.facts_count} facts extracted despite data-like page`;
      return {
        pageId: row.page_id,
        slug: row.slug,
        type: row.type,
        title: row.title,
        factsCount: row.facts_count,
        hasFactsBlock,
        tableCount: row.table_count,
        contentChars,
        numericTokenCount,
        coverageRisk,
        reason,
      } satisfies FactsCoverageRow;
    })
    .filter((row): row is FactsCoverageRow => row !== null);

  return {
    generatedAt: new Date().toISOString(),
    filters: { type, limit },
    summary: {
      highRisk: mapped.filter((row) => row.coverageRisk === "high").length,
      mediumRisk: mapped.filter((row) => row.coverageRisk === "medium").length,
    },
    rows: mapped,
  };
}

export function formatFactsCoverage(report: FactsCoverageReport): string {
  const lines = [
    `Facts coverage backlog (${report.rows.length} shown)`,
    `  filter: type=${report.filters.type} limit=${report.filters.limit}`,
    `  summary: high_risk=${report.summary.highRisk} medium_risk=${report.summary.mediumRisk}`,
    "",
  ];
  if (report.rows.length === 0) {
    lines.push("No facts coverage gaps detected.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(
      `  risk=${row.coverageRisk} [${row.type}] #${row.pageId} ${row.slug} facts=${row.factsCount} tables=${row.tableCount} numeric_tokens=${row.numericTokenCount}`
    );
    lines.push(`    reason: ${row.reason}`);
  }
  return lines.join("\n");
}

function stripMarkdown(content: string): string {
  return content
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, "$2")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
