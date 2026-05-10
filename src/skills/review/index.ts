/**
 * Deterministic page review gate.
 *
 * 目标：
 *   1. 在 `ingest:write` 后立刻给出结构化质检反馈
 *   2. 在 `ingest:finalize` 前阻止明显不合格的 narrative 进入派生层
 *   3. 给 enrich / lint / 后续 dashboard 提供统一的 review 事件
 *
 * 设计原则：
 *   - 不调 LLM，只做确定性检查
 *   - 结果落 events(action='page_review')，便于审计和二次消费
 *   - fail 只代表“未达最小生产标准”，不是文学质量评价
 */

import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import matter from "gray-matter";
import * as YAML from "yaml";

import { Actor } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";
import { splitBody } from "~/core/markdown.ts";

import { extractTierA } from "../ingest/stage-5-tier-a.ts";

type ReviewSeverity = "error" | "warn";
type ReviewStatus = "pass" | "fail";

interface ReviewProfile {
  minChars: number;
  minWikiLinks: number;
  requiredSections: string[];
  requiredFrontmatterKeys?: string[];
  requireFactsBlock?: boolean;
  requireTimelineMarker?: boolean;
  requireRelationSubsections?: boolean;
}

export interface ReviewIssue {
  severity: ReviewSeverity;
  code: string;
  message: string;
  suggestion?: string;
}

export interface PageReviewReport {
  reviewVersion: number;
  pageId: string;
  slug: string;
  pageType: string;
  title: string;
  status: ReviewStatus;
  contentHash: string;
  generatedAt: string;
  metrics: {
    charCount: number;
    wordCount: number;
    wikiLinkCount: number;
    factsCount: number;
    timelineEntries: number;
    headingCount: number;
  };
  issues: ReviewIssue[];
}

export interface ReviewBacklogRow {
  pageId: string;
  slug: string;
  type: string;
  title: string;
  status: ReviewStatus;
  errors: number;
  warnings: number;
  contentHash: string;
  reviewedAt: string;
}

export interface ReviewBacklogReport {
  generatedAt: string;
  filters: {
    status: "fail" | "pass" | "all";
    limit: number;
  };
  totalPagesWithReview: number;
  totalMatching: number;
  rows: ReviewBacklogRow[];
}

interface PageMeta {
  id: bigint;
  slug: string;
  type: string;
  title: string;
  contentHash: string | null;
  frontmatter: Record<string, unknown>;
}

interface SectionBlock {
  level: number;
  title: string;
  normalizedTitle: string;
  body: string;
}

const PAGE_REVIEW_VERSION = 1;
const SECTION_HEADING_RE = /^(#{2,3})\s+(.+?)\s*$/;
const WIKILINK_RE = /\[\[[^[\]]+\]\]/g;
const TIMELINE_MARKER_RE = /<!--\s*timeline\s*-->/i;
const RELATION_SUBSECTIONS = [
  "New Information",
  "Confirms Existing View",
  "Contradictions Or Revisions",
] as const;

const REVIEW_PROFILES: Partial<Record<string, ReviewProfile>> = {
  source: {
    minChars: 1200,
    minWikiLinks: 2,
    requiredSections: [
      "Source Overview",
      "Key Takeaways",
      "Important Data Points",
      "Notable Quotes / Views",
      "Structural Observations",
      "Relation To Existing Knowledge",
      "Follow-ups",
    ],
    requiredFrontmatterKeys: ["research_id", "research_type", "markdown_url"],
    requireFactsBlock: true,
    requireTimelineMarker: true,
    requireRelationSubsections: true,
  },
  brief: {
    minChars: 120,
    minWikiLinks: 1,
    requiredSections: ["TL;DR", "Key Observations", "Links"],
    requiredFrontmatterKeys: ["research_id", "research_type", "markdown_url"],
  },
  company: {
    minChars: 900,
    minWikiLinks: 3,
    requiredSections: [
      "Company Overview",
      "Business Model",
      "Financial Summary",
      "Competitive Landscape",
      "Valuation",
      "Risk Factors",
      "Catalysts",
      "Key Timeline",
      "Sources",
    ],
  },
  industry: {
    minChars: 900,
    minWikiLinks: 3,
    requiredSections: [
      "Industry Overview",
      "Market Size And Growth",
      "Value Chain",
      "Competitive Landscape",
      "Key Trends",
      "Regulatory Environment",
      "Investment Opportunities And Risks",
      "Related Companies",
      "Sources",
    ],
  },
  concept: {
    minChars: 500,
    minWikiLinks: 2,
    requiredSections: [
      "Definition",
      "Use In Investment Research",
      "Related Concepts",
      "Sources",
    ],
  },
  thesis: {
    minChars: 800,
    minWikiLinks: 2,
    requiredSections: [
      "Core Thesis",
      "Bull Case",
      "Bear Case",
      "Key Assumptions",
      "Validation / Falsification Conditions",
      "Catalyst Timeline",
      "Risk Management",
      "Thesis Evolution",
      "Sources",
    ],
  },
};

export async function reviewNarrativeForPage(
  pageId: bigint,
  narrative: string
): Promise<PageReviewReport> {
  const page = await loadPageMeta(pageId);
  if (!page) throw new Error(`page #${pageId} 不存在或已删除`);
  return buildReviewReport(page, narrative);
}

export async function reviewStoredPage(pageId: bigint): Promise<PageReviewReport> {
  const [page] = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      frontmatter: schema.pages.frontmatter,
      content: schema.pages.content,
      timeline: schema.pages.timeline,
      contentHash: schema.pages.contentHash,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, pageId), eq(schema.pages.deleted, 0)))
    .limit(1);
  if (!page) throw new Error(`page #${pageId} 不存在或已删除`);

  const reconstructedNarrative = page.timeline.trim().length > 0
    ? `${page.content}\n\n<!-- timeline -->\n${page.timeline}`
    : page.content;

  return buildReviewReport(
    {
      id: page.id,
      slug: page.slug,
      type: page.type,
      title: page.title,
      contentHash: page.contentHash,
      frontmatter: asRecord(page.frontmatter),
    },
    reconstructedNarrative
  );
}

export async function persistPageReview(
  report: PageReviewReport,
  actor: string = Actor.agentClaude
): Promise<void> {
  await db.insert(schema.events).values({
    actor,
    action: "page_review",
    entityType: "page",
    entityId: BigInt(report.pageId),
    payload: report as unknown as Record<string, unknown>,
    createBy: actor,
    updateBy: actor,
  });
}

export async function ensurePageReviewPass(
  pageId: bigint,
  opts: { actor?: string; skipReview?: boolean } = {}
): Promise<PageReviewReport | null> {
  if (opts.skipReview) return null;

  const page = await loadPageMeta(pageId);
  if (!page) throw new Error(`page #${pageId} 不存在或已删除`);

  let report = await loadLatestReviewForHash(page.id, page.contentHash);
  if (!report) {
    report = await reviewStoredPage(page.id);
    await persistPageReview(report, opts.actor ?? Actor.systemIngest);
  }

  if (report.status === "fail") {
    throw new Error(
      `page review gate failed for page #${pageId} (${page.slug})\n${formatPageReviewReport(report)}`
    );
  }

  return report;
}

export async function listReviewBacklog(opts: {
  status?: "fail" | "pass" | "all";
  limit?: number;
} = {}): Promise<ReviewBacklogReport> {
  const status = opts.status ?? "fail";
  const limit = opts.limit ?? 50;
  const statusFilter =
    status === "all" ? drizzleSql`` : drizzleSql`AND (x.payload->>'status') = ${status}`;

  const rows = (await db.execute(drizzleSql`
    WITH latest AS (
      SELECT DISTINCT ON (e.entity_id)
        e.entity_id,
        e.ts,
        e.payload
      FROM events e
      WHERE e.deleted = 0
        AND e.action = 'page_review'
        AND e.entity_type = 'page'
      ORDER BY e.entity_id, e.ts DESC, e.id DESC
    )
    SELECT
      p.id::text AS page_id,
      p.slug,
      p.type,
      p.title,
      x.ts,
      x.payload
    FROM latest x
    JOIN pages p ON p.id = x.entity_id
    WHERE p.deleted = 0
      ${statusFilter}
    ORDER BY x.ts DESC
    LIMIT ${limit}
  `)) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    ts: Date | string;
    payload: PageReviewReport;
  }>;

  const totalPagesWithReviewRows = (await db.execute(drizzleSql`
    SELECT COUNT(DISTINCT entity_id)::int AS n
    FROM events
    WHERE deleted = 0
      AND action = 'page_review'
      AND entity_type = 'page'
  `)) as Array<{ n: number }>;

  const totalMatchingRows = (await db.execute(drizzleSql`
    WITH latest AS (
      SELECT DISTINCT ON (e.entity_id)
        e.entity_id,
        e.payload
      FROM events e
      WHERE e.deleted = 0
        AND e.action = 'page_review'
        AND e.entity_type = 'page'
      ORDER BY e.entity_id, e.ts DESC, e.id DESC
    )
    SELECT COUNT(*)::int AS n
    FROM latest x
    JOIN pages p ON p.id = x.entity_id
    WHERE p.deleted = 0
      ${statusFilter}
  `)) as Array<{ n: number }>;

  return {
    generatedAt: new Date().toISOString(),
    filters: { status, limit },
    totalPagesWithReview: totalPagesWithReviewRows[0]?.n ?? 0,
    totalMatching: totalMatchingRows[0]?.n ?? 0,
    rows: rows.map((row) => ({
      pageId: row.page_id,
      slug: row.slug,
      type: row.type,
      title: row.title,
      status: row.payload.status,
      errors: row.payload.issues.filter((i) => i.severity === "error").length,
      warnings: row.payload.issues.filter((i) => i.severity === "warn").length,
      contentHash: row.payload.contentHash,
      reviewedAt: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
    })),
  };
}

export function formatPageReviewReport(report: PageReviewReport): string {
  const errorCount = report.issues.filter((i) => i.severity === "error").length;
  const warnCount = report.issues.filter((i) => i.severity === "warn").length;
  const lines = [
    `[page:review] ${report.status.toUpperCase()} ${report.slug} (${report.pageType}) ` +
      `errors=${errorCount} warnings=${warnCount} chars=${report.metrics.charCount} ` +
      `wikilinks=${report.metrics.wikiLinkCount} facts=${report.metrics.factsCount} timeline=${report.metrics.timelineEntries}`,
  ];

  for (const issue of report.issues) {
    lines.push(
      `  [${issue.severity.toUpperCase()}] ${issue.code}: ${issue.message}` +
        (issue.suggestion ? ` | fix: ${issue.suggestion}` : "")
    );
  }

  if (report.issues.length === 0) {
    lines.push("  no issues");
  }

  return lines.join("\n");
}

function buildReviewReport(page: PageMeta, narrative: string): PageReviewReport {
  const profile = REVIEW_PROFILES[page.type];
  const parsed = matter(narrative);
  const mergedFrontmatter = {
    ...page.frontmatter,
    ...asRecord(parsed.data),
  };
  const rawBody = parsed.content;
  const { compiledTruth, timeline } = splitBody(rawBody);
  const sections = collectSections(compiledTruth);
  const wikiLinkCount = (compiledTruth.match(WIKILINK_RE) ?? []).length;
  const facts = extractTierA(compiledTruth);
  const timelineEntries = parseTimelineEntries(timeline);
  const contentHash = sha256(narrative);

  const issues: ReviewIssue[] = [];
  const charCount = visibleText(compiledTruth).length;
  const wordCount = countWords(compiledTruth);

  if (!profile) {
    issues.push({
      severity: "warn",
      code: "no_profile",
      message: `No deterministic review profile for page type "${page.type}"`,
    });
  } else {
    if (charCount < profile.minChars) {
      issues.push({
        severity: "error",
        code: "content_too_short",
        message: `Narrative body is too short (${charCount} chars < ${profile.minChars})`,
        suggestion: "Expand the page with actual investment content, not just metadata or bullets.",
      });
    }

    for (const requiredSection of profile.requiredSections) {
      const section = findSection(sections, requiredSection);
      if (!section) {
        issues.push({
          severity: "error",
          code: "missing_section",
          message: `Missing required section "${requiredSection}"`,
          suggestion: `Add a ## ${requiredSection} section using the page schema template.`,
        });
        continue;
      }

      if (visibleText(section.body).length < 20) {
        issues.push({
          severity: "warn",
          code: "thin_section",
          message: `Section "${requiredSection}" is present but too thin`,
          suggestion: "Add concrete evidence, comparisons, or citations instead of heading-only scaffolding.",
        });
      }
    }

    if (profile.requiredFrontmatterKeys) {
      for (const key of profile.requiredFrontmatterKeys) {
        const value = mergedFrontmatter[key];
        if (
          value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim().length === 0)
        ) {
          issues.push({
            severity: "error",
            code: "missing_frontmatter_key",
            message: `Missing required frontmatter key "${key}"`,
            suggestion: "Preserve source provenance fields from stage 1 and do not overwrite them away.",
          });
        }
      }
    }

    if (wikiLinkCount < profile.minWikiLinks) {
      issues.push({
        severity: "warn",
        code: "too_few_wikilinks",
        message: `Only ${wikiLinkCount} wikilinks found (< ${profile.minWikiLinks})`,
        suggestion: "Link the first mention of material entities so the page joins the graph.",
      });
    }

    if (profile.requireFactsBlock) {
      if (!/<!--\s*facts\b/i.test(compiledTruth)) {
        issues.push({
          severity: "error",
          code: "missing_facts_block",
          message: "Missing <!-- facts ... --> YAML block",
          suggestion: "Append the facts YAML block even when there are only a few high-value datapoints.",
        });
      } else if (facts.length === 0) {
        issues.push({
          severity: "warn",
          code: "empty_facts_block",
          message: "Facts block exists but no valid facts were parsed",
          suggestion: "Check YAML formatting and include at least the high-signal metrics mentioned in the source.",
        });
      }
    }

    if (profile.requireTimelineMarker) {
      if (!TIMELINE_MARKER_RE.test(rawBody)) {
        issues.push({
          severity: "warn",
          code: "missing_timeline_marker",
          message: "Missing <!-- timeline --> marker",
          suggestion: "Add a timeline block for dated events, even if the final list is short.",
        });
      } else if (timeline.trim().length > 0 && timelineEntries === 0) {
        issues.push({
          severity: "warn",
          code: "invalid_timeline_yaml",
          message: "Timeline block exists but no valid timeline entries were parsed",
          suggestion: "Ensure timeline YAML is an array of {date, event_type, summary}.",
        });
      }
    }

    if (profile.requireRelationSubsections) {
      const relationMissing = RELATION_SUBSECTIONS.every(
        (sectionName) => !findSection(sections, sectionName)
      );
      if (relationMissing) {
        issues.push({
          severity: "warn",
          code: "missing_relation_subsections",
          message: 'Relation To Existing Knowledge is missing the expected subheads ("New Information", "Confirms Existing View", "Contradictions Or Revisions")',
          suggestion: "Split the relation section into the three comparison buckets so downstream review can scan deltas faster.",
        });
      }
    }
  }

  const structuralObservations = findSection(sections, "Structural Observations");
  if (
    page.type === "source" &&
    structuralObservations &&
    visibleText(structuralObservations.body).toLowerCase() === "none"
  ) {
    issues.push({
      severity: "warn",
      code: "structural_observations_none",
      message: 'Structural Observations is literally "none"',
      suggestion: "Double-check whether the source contains participant behavior, competitive pattern, or early-cycle signals.",
    });
  }

  return {
    reviewVersion: PAGE_REVIEW_VERSION,
    pageId: page.id.toString(),
    slug: page.slug,
    pageType: page.type,
    title: page.title,
    status: issues.some((issue) => issue.severity === "error") ? "fail" : "pass",
    contentHash,
    generatedAt: new Date().toISOString(),
    metrics: {
      charCount,
      wordCount,
      wikiLinkCount,
      factsCount: facts.length,
      timelineEntries,
      headingCount: sections.length,
    },
    issues,
  };
}

async function loadPageMeta(pageId: bigint): Promise<PageMeta | null> {
  const [page] = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      contentHash: schema.pages.contentHash,
      frontmatter: schema.pages.frontmatter,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, pageId), eq(schema.pages.deleted, 0)))
    .limit(1);

  if (!page) return null;
  return {
    id: page.id,
    slug: page.slug,
    type: page.type,
    title: page.title,
    contentHash: page.contentHash,
    frontmatter: asRecord(page.frontmatter),
  };
}

async function loadLatestReviewForHash(
  pageId: bigint,
  contentHash: string | null
): Promise<PageReviewReport | null> {
  if (!contentHash) return null;

  const rows = await db
    .select({ payload: schema.events.payload })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.action, "page_review"),
        eq(schema.events.entityType, "page"),
        eq(schema.events.entityId, pageId),
        eq(schema.events.deleted, 0),
        drizzleSql`${schema.events.payload}->>'contentHash' = ${contentHash}`
      )
    )
    .orderBy(desc(schema.events.createTime))
    .limit(1);

  if (!rows[0]?.payload) return null;
  return rows[0].payload as unknown as PageReviewReport;
}

function collectSections(markdown: string): SectionBlock[] {
  const lines = markdown.split("\n");
  const sections: SectionBlock[] = [];
  let currentTitle: string | null = null;
  let currentLevel = 0;
  let currentBody: string[] = [];

  const flush = () => {
    if (!currentTitle) return;
    sections.push({
      level: currentLevel,
      title: currentTitle,
      normalizedTitle: normalizeHeading(currentTitle),
      body: currentBody.join("\n").trim(),
    });
  };

  for (const line of lines) {
    const heading = line.match(SECTION_HEADING_RE);
    if (heading) {
      flush();
      currentLevel = heading[1]!.length;
      currentTitle = heading[2]!.trim();
      currentBody = [];
      continue;
    }

    if (currentTitle) {
      currentBody.push(line);
    }
  }

  flush();
  return sections;
}

function findSection(sections: SectionBlock[], heading: string): SectionBlock | null {
  const normalizedTarget = normalizeHeading(heading);
  return sections.find((section) => section.normalizedTitle === normalizedTarget) ?? null;
}

function normalizeHeading(value: string): string {
  return value
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function visibleText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, "$2")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*`|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(markdown: string): number {
  const text = visibleText(markdown);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function parseTimelineEntries(timeline: string): number {
  if (!timeline.trim()) return 0;
  try {
    const parsed = YAML.parse(timeline);
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).date === "string" &&
        typeof (entry as Record<string, unknown>).event_type === "string" &&
        typeof (entry as Record<string, unknown>).summary === "string"
    ).length;
  } catch {
    return 0;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

export function formatReviewBacklogReport(report: ReviewBacklogReport): string {
  const { rows, filters, totalPagesWithReview } = report;
  const lines = [
    `Page review backlog (${rows.length}/${report.totalMatching} shown; reviewed pages=${totalPagesWithReview})`,
    `  filter: status=${filters.status}, limit=${filters.limit}`,
    "",
  ];

  if (rows.length === 0) {
    lines.push("No matching reviewed pages.");
    return lines.join("\n");
  }

  for (const row of rows) {
    lines.push(
      `  #${row.pageId.padStart(4)} [${row.type.padEnd(8)}] ${row.status.toUpperCase()} errors=${row.errors} warnings=${row.warnings} ${row.slug}`
    );
  }

  return lines.join("\n");
}
