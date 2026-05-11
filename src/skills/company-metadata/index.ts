/**
 * company-metadata audit
 *
 * Read-only diagnostics for company page identity fields: display_name,
 * aliases, and ticker. Fixes are intentionally done through enrich:save so
 * alias conflict checks, page review, page_versions, and audit events remain
 * centralized.
 */

import { sql } from "drizzle-orm";
import { db } from "~/core/db.ts";

export interface CompanyMetadataIssue {
  code:
    | "missing_display_name"
    | "display_name_sluggy"
    | "missing_aliases"
    | "sparse_aliases"
    | "display_name_missing_from_aliases"
    | "missing_ticker"
    | "ticker_suspicious"
    | "ticker_not_uppercase"
    | "ticker_missing_from_aliases"
    | "duplicate_ticker";
  severity: "error" | "warn";
  message: string;
  suggestion: string;
}

export interface CompanyMetadataRow {
  pageId: string;
  slug: string;
  title: string;
  displayName: string | null;
  ticker: string | null;
  aliases: string[];
  confidence: string | null;
  backlinks: number;
  issues: CompanyMetadataIssue[];
}

export interface CompanyMetadataAuditReport {
  generatedAt: string;
  filters: {
    limit: number;
    includeOk: boolean;
    confidence: string | null;
  };
  totalCompanies: number;
  totalProblemCompanies: number;
  issueCounts: Record<string, number>;
  rows: CompanyMetadataRow[];
}

export async function auditCompanyMetadata(opts: {
  limit?: number;
  includeOk?: boolean;
  confidence?: "low" | "medium" | "high";
} = {}): Promise<CompanyMetadataAuditReport> {
  const limit = opts.limit ?? 80;
  const includeOk = opts.includeOk ?? false;
  const confidenceFilter = opts.confidence
    ? sql`AND p.confidence = ${opts.confidence}`
    : sql``;

  const rows = (await db.execute(sql`
    WITH backlink_counts AS (
      SELECT to_page_id, COUNT(*)::int AS backlinks
      FROM links
      WHERE deleted = 0
      GROUP BY to_page_id
    ),
    duplicate_tickers AS (
      SELECT upper(trim(ticker)) AS ticker_key, COUNT(*)::int AS n
      FROM pages
      WHERE deleted = 0
        AND type = 'company'
        AND ticker IS NOT NULL
        AND trim(ticker) <> ''
      GROUP BY upper(trim(ticker))
      HAVING COUNT(*) > 1
    )
    SELECT
      p.id::text AS id,
      p.slug,
      p.title,
      p.display_name,
      p.ticker,
      p.aliases,
      p.confidence,
      COALESCE(b.backlinks, 0)::int AS backlinks,
      COALESCE(dt.n, 0)::int AS duplicate_ticker_count
    FROM pages p
    LEFT JOIN backlink_counts b ON b.to_page_id = p.id
    LEFT JOIN duplicate_tickers dt ON dt.ticker_key = upper(trim(p.ticker))
    WHERE p.deleted = 0
      AND p.type = 'company'
      ${confidenceFilter}
    ORDER BY
      COALESCE(b.backlinks, 0) DESC,
      CASE p.confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
      p.id ASC
  `)) as Array<{
    id: string;
    slug: string;
    title: string;
    display_name: string | null;
    ticker: string | null;
    aliases: string[] | null;
    confidence: string | null;
    backlinks: number;
    duplicate_ticker_count: number;
  }>;

  const audited = rows.map((row) => {
    const aliases = row.aliases ?? [];
    return {
      pageId: row.id,
      slug: row.slug,
      title: row.title,
      displayName: row.display_name,
      ticker: row.ticker,
      aliases,
      confidence: row.confidence,
      backlinks: row.backlinks,
      issues: buildIssues({
        slug: row.slug,
        title: row.title,
        displayName: row.display_name,
        ticker: row.ticker,
        aliases,
        confidence: row.confidence,
        duplicateTickerCount: row.duplicate_ticker_count,
      }),
    } satisfies CompanyMetadataRow;
  });

  const problemRows = audited.filter((row) => row.issues.length > 0);
  const visibleRows = (includeOk ? audited : problemRows).slice(0, limit);
  const issueCounts: Record<string, number> = {};
  for (const row of problemRows) {
    for (const issue of row.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      limit,
      includeOk,
      confidence: opts.confidence ?? null,
    },
    totalCompanies: audited.length,
    totalProblemCompanies: problemRows.length,
    issueCounts,
    rows: visibleRows,
  };
}

export function formatCompanyMetadataAudit(report: CompanyMetadataAuditReport): string {
  const lines = [
    `Company metadata audit (${report.rows.length}/${report.totalProblemCompanies} problem companies shown; ${report.totalCompanies} total companies)`,
    `  filter: confidence=${report.filters.confidence ?? "(any)"}, include_ok=${report.filters.includeOk}, limit=${report.filters.limit}`,
    `  issue_counts: ${Object.entries(report.issueCounts)
      .map(([code, count]) => `${code}=${count}`)
      .join(" ") || "(none)"}`,
    "",
  ];

  if (report.rows.length === 0) {
    lines.push("No company metadata issues matching filter.");
    return lines.join("\n");
  }

  for (const row of report.rows) {
    lines.push(
      `  #${row.pageId.padStart(4)} ${row.slug} conf=${row.confidence ?? "unknown"} bl=${row.backlinks} display=${row.displayName ?? "-"} ticker=${row.ticker ?? "-"} aliases=${row.aliases.length}`
    );
    for (const issue of row.issues) {
      lines.push(`      [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
    lines.push("");
  }

  lines.push("Suggested fix pattern:");
  lines.push(`  printf '%s\\n' 'Metadata cleanup: normalized display name, aliases, and ticker.' | \\`);
  lines.push(`    bun src/cli.ts enrich:save <page_id> --append --display-name "Canonical Name" --ticker TICKER --aliases "Alias 1,Alias 2,TICKER"`);
  return lines.join("\n");
}

function buildIssues(row: {
  slug: string;
  title: string;
  displayName: string | null;
  ticker: string | null;
  aliases: string[];
  confidence: string | null;
  duplicateTickerCount: number;
}): CompanyMetadataIssue[] {
  const issues: CompanyMetadataIssue[] = [];
  const displayName = row.displayName?.trim() ?? "";
  const ticker = row.ticker?.trim() ?? "";
  const aliasSet = new Set(row.aliases.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const namePart = row.slug.split("/").slice(1).join("/").trim();

  if (!displayName) {
    issues.push({
      code: "missing_display_name",
      severity: "error",
      message: "display_name is empty, so UI falls back to slug/title.",
      suggestion: "Set --display-name to the company brand or legal short name.",
    });
  } else if (looksSluggy(displayName)) {
    issues.push({
      code: "display_name_sluggy",
      severity: "warn",
      message: `display_name="${displayName}" still looks like a slug.`,
      suggestion: "Use human casing, e.g. 'Delta Electronics' instead of 'delta-electronics'.",
    });
  }

  if (row.aliases.length === 0) {
    issues.push({
      code: "missing_aliases",
      severity: "error",
      message: "aliases array is empty.",
      suggestion: "Add canonical English name, common short name, Chinese name when applicable, and tickers.",
    });
  } else if (row.aliases.length < 2 && row.confidence !== "low") {
    issues.push({
      code: "sparse_aliases",
      severity: "warn",
      message: `only ${row.aliases.length} alias found on a non-low-confidence company.`,
      suggestion: "Add official legal name, common name, local-language name, ticker, and ADR/OTC tickers if applicable.",
    });
  }

  if (displayName && !aliasSet.has(displayName.toLowerCase())) {
    issues.push({
      code: "display_name_missing_from_aliases",
      severity: "warn",
      message: "display_name is not present in aliases.",
      suggestion: "Add the display name to aliases so search and entity resolution match the UI name.",
    });
  }

  if (!ticker) {
    if (row.confidence === "medium" || row.confidence === "high") {
      issues.push({
        code: "missing_ticker",
        severity: "warn",
        message: "ticker is empty on a curated company page.",
        suggestion: "If public, set the primary ticker; if private, leave ticker empty and add private-company aliases/context.",
      });
    }
  } else {
    if (isSuspiciousTicker(ticker)) {
      issues.push({
        code: "ticker_suspicious",
        severity: "error",
        message: `ticker="${ticker}" does not look like a normalized listed-company ticker.`,
        suggestion: "Verify against source evidence or official exchange/company IR, then normalize e.g. AAPL, 0700.HK, 600519.SH, 2308.TW.",
      });
    }
    if (ticker !== ticker.toUpperCase()) {
      issues.push({
        code: "ticker_not_uppercase",
        severity: "warn",
        message: `ticker="${ticker}" is not uppercase.`,
        suggestion: "Normalize ticker casing unless the exchange convention requires otherwise.",
      });
    }
    if (!aliasSet.has(ticker.toLowerCase())) {
      issues.push({
        code: "ticker_missing_from_aliases",
        severity: "warn",
        message: "ticker is not present in aliases.",
        suggestion: "Add ticker to aliases so ticker search resolves to this page.",
      });
    }
    if (row.duplicateTickerCount > 1) {
      issues.push({
        code: "duplicate_ticker",
        severity: "error",
        message: `ticker="${ticker}" appears on ${row.duplicateTickerCount} active company pages.`,
        suggestion: "Run page:merge-candidates or alias-conflicts; merge true duplicates or correct the wrong ticker.",
      });
    }
  }

  if (namePart && row.aliases.length > 0 && !aliasSet.has(namePart.toLowerCase())) {
    issues.push({
      code: "sparse_aliases",
      severity: "warn",
      message: `slug name "${namePart}" is not present in aliases.`,
      suggestion: "Keep the slug name in aliases unless it is a known bad/ambiguous alias.",
    });
  }

  return dedupeIssues(issues);
}

function looksSluggy(value: string): boolean {
  return value.includes("-") || value === value.toLowerCase();
}

function isSuspiciousTicker(value: string): boolean {
  const ticker = value.trim();
  if (!ticker) return false;
  if (/^(n\/a|na|none|null|unknown|private|private company)$/i.test(ticker)) return true;
  if (/[\s,，;；:：/\\]/.test(ticker)) return true;
  if (/[\u4e00-\u9fff]/.test(ticker)) return true;
  if (ticker.length > 16) return true;
  return !/^[A-Z0-9]{1,8}([.-][A-Z0-9]{1,6}){0,2}$/.test(ticker.toUpperCase());
}

function dedupeIssues(issues: CompanyMetadataIssue[]): CompanyMetadataIssue[] {
  const seen = new Set<string>();
  const out: CompanyMetadataIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}
