/**
 * output review / backlog
 *
 * 针对 DB output pages（pages.type='output'）的 deterministic 质量检查。
 * 当前聚焦：
 *   - daily-review
 *   - daily-summarize
 *
 * 目标不是评判观点对错，而是检查：
 *   - 固定章节是否齐全
 *   - frontmatter 是否完整
 *   - 引用与长度是否达最低标准
 */

import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import matter from "gray-matter";

import { db, schema } from "~/core/db.ts";
import {
  normalizeOutputIdentifier,
  type OutputSubtype,
} from "~/skills/output/index.ts";

type ReviewStatus = "pass" | "fail";
type ReviewSeverity = "error" | "warn";

interface ReviewProfile {
  minChars: number;
  requiredFrontmatter: string[];
  requiredSections: string[];
}

export interface OutputReviewIssue {
  severity: ReviewSeverity;
  code: string;
  message: string;
}

export interface OutputReviewReport {
  filename: string;
  subtype: OutputSubtype;
  status: ReviewStatus;
  generatedAt: string;
  metrics: {
    charCount: number;
    sectionCount: number;
    sourceRefCount: number;
    qRefCount: number;
  };
  issues: OutputReviewIssue[];
}

export interface OutputBacklogRow {
  filename: string;
  pageId: string;
  subtype: OutputSubtype;
  status: ReviewStatus;
  errors: number;
  warnings: number;
  charCount: number;
  sourceRefCount: number;
}

export interface OutputBacklogReport {
  generatedAt: string;
  filters: {
    subtype: OutputSubtype | "all";
    limit: number;
  };
  summary: {
    pass: number;
    fail: number;
    dailyReview: number;
    dailySummarize: number;
  };
  rows: OutputBacklogRow[];
}

const SECTION_HEADING_RE = /^##\s+(.+?)\s*$/gm;
const SOURCE_REF_RE = /\[\[(sources|briefs)\//g;
const PROFILE_BY_SUBTYPE: Record<OutputSubtype, ReviewProfile> = {
  "daily-review": {
    minChars: 5000,
    requiredFrontmatter: [
      "type",
      "subtype",
      "title",
      "date",
      "sources",
      "tags",
      "last_updated",
    ],
    requiredSections: [
      "Q1: Biggest Change In Understanding Today",
      "Q2: Most Contrarian Data Point / Expectation Gap",
      "Q3: Cross-Sector Connections",
      "Q4: Highest-Conviction Long",
      "Q5: Highest-Conviction Short / Reduce",
      "Q6: Knowledge Gaps And Next Ingest Priorities",
      "Q7: Red Team / Bias Check",
      "Sources",
    ],
  },
  "daily-summarize": {
    minChars: 7000,
    requiredFrontmatter: [
      "type",
      "subtype",
      "title",
      "date",
      "sources",
      "active_thesis_count",
      "portfolio_mode",
      "tags",
      "last_updated",
    ],
    requiredSections: [
      "1. Executive Summary",
      "2. Market Snapshot",
      "3. Portfolio Impact",
      "4. New Positions",
      "5. Reduce / Hedge",
      "6. Risk Alerts",
      "7. Catalyst Calendar",
      "8. Research To-Do",
      "9. Talking Points",
      "Self-Check",
    ],
  },
};

export async function reviewOutputFile(identifier: string): Promise<OutputReviewReport> {
  const page = await loadOutputPage(identifier);
  return reviewOutputParsed(page.slug, asRecord(page.frontmatter), page.content ?? "");
}

export function reviewOutputContent(identifier: string, content: string): OutputReviewReport {
  const parsed = matter(content);
  return reviewOutputParsed(identifier, asRecord(parsed.data), parsed.content);
}

function reviewOutputParsed(
  identifier: string,
  data: Record<string, unknown>,
  body: string
): OutputReviewReport {
  const subtype = inferSubtype(identifier, data);
  const profile = PROFILE_BY_SUBTYPE[subtype];
  const sectionTitles = Array.from(body.matchAll(SECTION_HEADING_RE)).map((m) => m[1]!.trim());
  const sourceRefCount = (body.match(SOURCE_REF_RE) ?? []).length;
  const qRefCount = (body.match(/^##\s+Q\d|^##\s+\d+\./gm) ?? []).length;
  const charCount = body.replace(/\s+/g, " ").trim().length;

  const issues: OutputReviewIssue[] = [];
  for (const key of profile.requiredFrontmatter) {
    const value = data[key];
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0)
    ) {
      issues.push({
        severity: "error",
        code: "missing_frontmatter",
        message: `Missing required frontmatter key "${key}"`,
      });
    }
  }
  if (data.type !== "output") {
    issues.push({
      severity: "error",
      code: "wrong_type",
      message: `Frontmatter type should be "output" (got ${String(data.type ?? "(missing)")})`,
    });
  }
  if (data.subtype !== subtype) {
    issues.push({
      severity: "error",
      code: "wrong_subtype",
      message: `Frontmatter subtype should be "${subtype}"`,
    });
  }
  if (charCount < profile.minChars) {
    issues.push({
      severity: "warn",
      code: "short_output",
      message: `Output body is shorter than expected (${charCount} < ${profile.minChars})`,
    });
  }
  for (const section of profile.requiredSections) {
    if (!sectionTitles.includes(section)) {
      issues.push({
        severity: "error",
        code: "missing_section",
        message: `Missing required section "${section}"`,
      });
    }
  }
  if (sourceRefCount < 5) {
    issues.push({
      severity: "warn",
      code: "low_source_refs",
      message: `Only ${sourceRefCount} source/brief references found`,
    });
  }
  if (subtype === "daily-review" && qRefCount < 7) {
    issues.push({
      severity: "error",
      code: "missing_questions",
      message: `Daily review should expose 7 question headings (found ${qRefCount})`,
    });
  }
  if (subtype === "daily-summarize" && qRefCount < 9) {
    issues.push({
      severity: "error",
      code: "missing_sections",
      message: `Daily summarize should expose 9 numbered sections (found ${qRefCount})`,
    });
  }
  if (subtype === "daily-summarize") {
    addDailySummarizeChecks(data, body, issues);
  }

  return {
    filename: identifier,
    subtype,
    status: issues.some((issue) => issue.severity === "error") ? "fail" : "pass",
    generatedAt: new Date().toISOString(),
    metrics: {
      charCount,
      sectionCount: sectionTitles.length,
      sourceRefCount,
      qRefCount,
    },
      issues,
  };
}

function addDailySummarizeChecks(
  data: Record<string, unknown>,
  body: string,
  issues: OutputReviewIssue[]
): void {
  const activeThesisCount = parseCount(data.active_thesis_count);
  const portfolioMode = typeof data.portfolio_mode === "string" ? data.portfolio_mode : null;
  const sources = Array.isArray(data.sources) ? data.sources.map((item) => String(item)) : [];
  const hasDailyReview = sources.some((source) => source.includes("daily-review-"));
  const newPositions = getSectionBody(body, "4. New Positions");
  const reduceHedge = getSectionBody(body, "5. Reduce / Hedge");

  if (hasDailyReview) {
    for (const q of [4, 5, 6]) {
      if (!new RegExp(`\\bQ${q}\\b|§Q${q}\\b`, "i").test(body)) {
        issues.push({
          severity: "error",
          code: "missing_daily_review_reuse",
          message: `Daily summarize sources include daily-review, but Q${q} is not explicitly referenced or reused`,
        });
      }
    }
  }

  if (activeThesisCount === 0) {
    if (portfolioMode !== "watchlist") {
      issues.push({
        severity: "error",
        code: "wrong_portfolio_mode",
        message:
          'active_thesis_count is 0, so frontmatter portfolio_mode should be "watchlist"',
      });
    }
    if (!/watchlist|no active thesis|research brief/i.test(body)) {
      issues.push({
        severity: "error",
        code: "missing_watchlist_disclaimer",
        message:
          "active_thesis_count is 0, so the brief must explicitly state watchlist / no-active-thesis mode",
      });
    }
    if (/%\s*NAV|\bNAV\b|\bsizing\b|\bentry\b|\bstop\b|\btarget\b/i.test(newPositions)) {
      issues.push({
        severity: "error",
        code: "watchlist_has_execution_fields",
        message:
          "watchlist mode should not include NAV sizing, entry, stop, or target fields in New Positions",
      });
    }
    return;
  }

  if (activeThesisCount != null && activeThesisCount > 0 && portfolioMode && portfolioMode !== "active-thesis") {
    issues.push({
      severity: "error",
      code: "wrong_portfolio_mode",
      message:
        'active_thesis_count is positive, so frontmatter portfolio_mode should be "active-thesis"',
    });
  }

  if (!isNoActionSection(newPositions)) {
    const required = [
      ["sizing", /\bsizing\b|\bsize\b|% NAV|position size/i],
      ["entry", /\bentry\b|limit price|market on open|入场/i],
      ["stop", /\bstop\b|invalidation|止损/i],
      ["target", /\btarget\b|base case|bull case|bear case|目标/i],
      ["catalyst", /\bcatalyst\b|催化/i],
      ["risk", /\brisk\b|风险/i],
    ] as const;
    for (const [field, pattern] of required) {
      if (!pattern.test(newPositions)) {
        issues.push({
          severity: "error",
          code: "incomplete_trade_sheet",
          message: `New Positions section is missing executable trade-sheet field: ${field}`,
        });
      }
    }
  }

  if (!isNoActionSection(reduceHedge)) {
    const required = [
      ["instrument/action", /\breduce\b|\bhedge\b|\btrim\b|\bshort\b|减仓|对冲/i],
      ["sizing", /\bsizing\b|\bsize\b|% NAV|比例|notional/i],
      ["rationale", /\brationale\b|\breason\b|why|理由/i],
      ["priority", /\bpriority\b|urgent|monitor|优先|紧急/i],
    ] as const;
    for (const [field, pattern] of required) {
      if (!pattern.test(reduceHedge)) {
        issues.push({
          severity: "error",
          code: "incomplete_reduce_hedge",
          message: `Reduce / Hedge section is missing executable field: ${field}`,
        });
      }
    }
  }
}

function parseCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getSectionBody(body: string, sectionTitle: string): string {
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, "m").exec(body);
  if (!match || match.index == null) return "";
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const next = /^##\s+/m.exec(rest);
  return next && next.index != null ? rest.slice(0, next.index) : rest;
}

function isNoActionSection(section: string): boolean {
  if (!section.trim()) return true;
  return /no (new )?(position|trade|opportunit|action)|no need to|hold current|保持|not actionable|watchlist only|research task/i.test(
    section
  );
}

export async function reviewOutputBacklog(opts: {
  subtype?: OutputSubtype | "all";
  limit?: number;
} = {}): Promise<OutputBacklogReport> {
  const subtype = opts.subtype ?? "all";
  const limit = opts.limit ?? 30;
  const pages = await listOutputPages({
    subtype,
    limit: Math.max(limit * 5, 100),
  });
  const reports = await Promise.all(
    pages.map((page) => reviewOutputParsed(page.slug, asRecord(page.frontmatter), page.content ?? ""))
  );
  const pageIdBySlug = new Map(pages.map((page) => [page.slug, page.id.toString()]));
  const rows = reports
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "fail" ? -1 : 1;
      return a.filename < b.filename ? 1 : -1;
    })
    .slice(0, limit)
    .map((report) => ({
      filename: report.filename,
      pageId: pageIdBySlug.get(report.filename) ?? "",
      subtype: report.subtype,
      status: report.status,
      errors: report.issues.filter((i) => i.severity === "error").length,
      warnings: report.issues.filter((i) => i.severity === "warn").length,
      charCount: report.metrics.charCount,
      sourceRefCount: report.metrics.sourceRefCount,
    }));

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      subtype,
      limit,
    },
    summary: {
      pass: reports.filter((r) => r.status === "pass").length,
      fail: reports.filter((r) => r.status === "fail").length,
      dailyReview: reports.filter((r) => r.subtype === "daily-review").length,
      dailySummarize: reports.filter((r) => r.subtype === "daily-summarize").length,
    },
    rows,
  };
}

export function formatOutputReview(report: OutputReviewReport): string {
  const lines = [
    `[output:review] ${report.status.toUpperCase()} ${report.filename} (${report.subtype}) chars=${report.metrics.charCount} refs=${report.metrics.sourceRefCount}`,
  ];
  if (report.issues.length === 0) {
    lines.push("  no issues");
    return lines.join("\n");
  }
  for (const issue of report.issues) {
    lines.push(`  [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}`);
  }
  return lines.join("\n");
}

export function formatOutputBacklog(report: OutputBacklogReport): string {
  const lines = [
    `Output backlog (${report.rows.length} shown)`,
    `  filter: subtype=${report.filters.subtype} limit=${report.filters.limit}`,
    `  summary: pass=${report.summary.pass} fail=${report.summary.fail} daily_review=${report.summary.dailyReview} daily_summarize=${report.summary.dailySummarize}`,
    "",
  ];
  if (report.rows.length === 0) {
    lines.push("No output pages found.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(
      `  [${row.status.toUpperCase()}] ${row.filename} page_id=${row.pageId} subtype=${row.subtype} errors=${row.errors} warnings=${row.warnings} chars=${row.charCount} refs=${row.sourceRefCount}`
    );
  }
  return lines.join("\n");
}

async function loadOutputPage(identifier: string): Promise<{
  id: bigint;
  slug: string;
  content: string;
  frontmatter: unknown;
}> {
  const normalized = normalizeOutputIdentifier(identifier);
  const numericId = /^\d+$/.test(normalized) ? BigInt(normalized) : null;
  const conditions = [
    eq(schema.pages.deleted, 0),
    eq(schema.pages.type, "output"),
    numericId ? eq(schema.pages.id, numericId) : eq(schema.pages.slug, normalized),
  ];

  const [page] = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      content: schema.pages.content,
      frontmatter: schema.pages.frontmatter,
    })
    .from(schema.pages)
    .where(and(...conditions))
    .limit(1);

  if (!page) throw new Error(`output page not found: ${identifier}`);
  return page;
}

async function listOutputPages(opts: {
  subtype: OutputSubtype | "all";
  limit: number;
}): Promise<Array<{ id: bigint; slug: string; content: string; frontmatter: unknown }>> {
  const conditions = [eq(schema.pages.deleted, 0), eq(schema.pages.type, "output")];
  if (opts.subtype !== "all") {
    conditions.push(
      drizzleSql`(${schema.pages.frontmatter}->>'subtype' = ${opts.subtype} OR ${schema.pages.slug} LIKE ${`outputs/${opts.subtype}-%`})`
    );
  }

  return db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      content: schema.pages.content,
      frontmatter: schema.pages.frontmatter,
    })
    .from(schema.pages)
    .where(and(...conditions))
    .orderBy(desc(schema.pages.updateTime))
    .limit(opts.limit);
}

function inferSubtype(identifier: string, frontmatter: Record<string, unknown>): OutputSubtype {
  const subtype = frontmatter.subtype;
  if (subtype === "daily-review" || subtype === "daily-summarize") return subtype;
  if (identifier.includes("daily-review-")) return "daily-review";
  return "daily-summarize";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
