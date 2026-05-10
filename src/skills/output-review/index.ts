/**
 * output review / backlog
 *
 * 针对 `wiki/output/*.md` 的 deterministic 质量检查。
 * 当前聚焦：
 *   - daily-review
 *   - daily-summarize
 *
 * 目标不是评判观点对错，而是检查：
 *   - 固定章节是否齐全
 *   - frontmatter 是否完整
 *   - 引用与长度是否达最低标准
 */

import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { getEnv } from "~/core/env.ts";

type OutputSubtype = "daily-review" | "daily-summarize";
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

export async function reviewOutputFile(filename: string): Promise<OutputReviewReport> {
  const filePath = resolveOutputFile(filename);
  const content = await fs.readFile(filePath, "utf8");
  return reviewOutputContent(filename, content);
}

export function reviewOutputContent(filename: string, content: string): OutputReviewReport {
  const parsed = matter(content);
  const data = asRecord(parsed.data);
  const subtype = inferSubtype(filename, data);
  const profile = PROFILE_BY_SUBTYPE[subtype];
  const body = parsed.content;
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

  return {
    filename,
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

export async function reviewOutputBacklog(opts: {
  subtype?: OutputSubtype | "all";
  limit?: number;
} = {}): Promise<OutputBacklogReport> {
  const subtype = opts.subtype ?? "all";
  const limit = opts.limit ?? 30;
  const files = await listOutputFiles();
  const filtered = files.filter((file) => {
    if (subtype === "all") return true;
    return file.startsWith(`${subtype}-`) || file.includes(`${subtype}-`);
  });
  const reports = await Promise.all(filtered.map((file) => reviewOutputFile(file)));
  const rows = reports
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "fail" ? -1 : 1;
      return a.filename < b.filename ? 1 : -1;
    })
    .slice(0, limit)
    .map((report) => ({
      filename: report.filename,
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
    lines.push("No output files found.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(
      `  [${row.status.toUpperCase()}] ${row.filename} subtype=${row.subtype} errors=${row.errors} warnings=${row.warnings} chars=${row.charCount} refs=${row.sourceRefCount}`
    );
  }
  return lines.join("\n");
}

async function listOutputFiles(): Promise<string[]> {
  const dir = path.resolve(getEnv().WORKSPACE_DIR, "wiki/output");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

function resolveOutputFile(filename: string): string {
  const safe = path.basename(filename);
  return path.resolve(getEnv().WORKSPACE_DIR, "wiki/output", safe);
}

function inferSubtype(filename: string, frontmatter: Record<string, unknown>): OutputSubtype {
  const subtype = frontmatter.subtype;
  if (subtype === "daily-review" || subtype === "daily-summarize") return subtype;
  if (filename.startsWith("daily-review-")) return "daily-review";
  return "daily-summarize";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
