/**
 * Structural page repair.
 *
 * Deterministic migration helper for legacy entity pages that predate the
 * current review schema. It preserves existing narrative, wraps it into the
 * page-type template, adds explicit placeholders for missing sections, and
 * re-runs review. It does not synthesize investment views.
 */

import { and, eq, sql as drizzleSql } from "drizzle-orm";
import matter from "gray-matter";

import { Actor, withAudit, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";
import {
  listReviewBacklog,
  persistPageReview,
  reviewNarrativeForPage,
  reviewStoredPage,
} from "~/skills/review/index.ts";

const REQUIRED_SECTIONS: Record<string, string[]> = {
  company: [
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
  industry: [
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
  concept: [
    "Definition",
    "Use In Investment Research",
    "Related Concepts",
    "Sources",
  ],
  thesis: [
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
};

const REPAIR_PLACEHOLDER =
  "Structural repair placeholder: no additional source-backed detail was present in the legacy narrative for this section.";

interface ParsedSection {
  title: string;
  body: string;
}

export interface PageRepairResultRow {
  pageId: string;
  slug: string;
  type: string;
  status: "repaired" | "reviewed" | "unchanged" | "skipped";
  beforeStatus: "pass" | "fail";
  afterStatus?: "pass" | "fail";
  beforeErrors: number;
  afterErrors?: number;
  reason?: string;
}

export interface PageRepairReport {
  generatedAt: string;
  dryRun: boolean;
  limit: number;
  rows: PageRepairResultRow[];
  summary: {
    repaired: number;
    reviewed: number;
    unchanged: number;
    skipped: number;
    passAfter: number;
    failAfter: number;
  };
}

export function repairLegacyEntityContent(
  type: string,
  content: string
): { repaired: string; changed: boolean } {
  const required = REQUIRED_SECTIONS[type];
  if (!required) return { repaired: content, changed: false };

  const parsed = matter(content);
  const frontmatter =
    Object.keys(parsed.data).length > 0
      ? matter.stringify("", parsed.data).trim()
      : "";
  const { preamble, sections } = parseH2Sections(parsed.content.trim());
  const usedIndexes = new Set<number>();
  const updates: ParsedSection[] = [];
  const unmatched: ParsedSection[] = [];
  const matched = new Map<string, ParsedSection>();

  for (const [index, section] of sections.entries()) {
    if (normalizeHeading(section.title) === "updates") {
      updates.push(section);
      usedIndexes.add(index);
      continue;
    }
    const requiredTitle = required.find(
      (title) => normalizeHeading(title) === normalizeHeading(section.title)
    );
    if (requiredTitle && !matched.has(requiredTitle)) {
      matched.set(requiredTitle, section);
      usedIndexes.add(index);
    }
  }

  for (const [index, section] of sections.entries()) {
    if (!usedIndexes.has(index)) unmatched.push(section);
  }

  const blocks: string[] = [];
  for (const [index, title] of required.entries()) {
    const section = matched.get(title);
    const bodyParts: string[] = [];
    if (section?.body.trim()) bodyParts.push(section.body.trim());

    if (index === 0) {
      const legacyParts = [
        preamble.trim(),
        ...unmatched.map((item) =>
          item.body.trim()
            ? `### ${item.title.trim()}\n\n${item.body.trim()}`
            : `### ${item.title.trim()}`
        ),
      ].filter(Boolean);
      if (legacyParts.length > 0) {
        bodyParts.push(["### Legacy Notes", ...legacyParts].join("\n\n"));
      }
    }

    if (bodyParts.length === 0) bodyParts.push(REPAIR_PLACEHOLDER);
    blocks.push(`## ${title}\n\n${bodyParts.join("\n\n")}`);
  }

  for (const update of updates) {
    blocks.push(`## ${update.title.trim()}\n\n${update.body.trim()}`.trim());
  }

  const body = `${blocks.join("\n\n").trim()}\n`;
  const repaired = frontmatter ? `${frontmatter}\n\n${body}` : body;
  return { repaired, changed: repaired.trim() !== content.trim() };
}

export async function repairReviewBacklog(opts: {
  limit?: number;
  dryRun?: boolean;
  actor?: string;
  allEntities?: boolean;
  forceAll?: boolean;
  minChars?: number;
} = {}): Promise<PageRepairReport> {
  const limit = opts.limit ?? 10;
  const dryRun = opts.dryRun ?? false;
  const actor = opts.actor ?? Actor.agentClaude;
  const allEntities = opts.allEntities ?? false;
  const forceAll = opts.forceAll ?? false;
  const minChars = opts.minChars ?? 500;
  const candidates = allEntities
    ? await listAllEntityRepairCandidates({ limit, minChars, forceAll })
    : (await listReviewBacklog({ status: "fail", limit })).rows.map((row) => ({
        pageId: row.pageId,
        slug: row.slug,
        type: row.type,
        title: row.title,
        beforeStatus: "fail" as const,
        beforeErrors: row.errors,
      }));
  const rows: PageRepairResultRow[] = [];

  for (const item of candidates) {
    const beforeErrors = item.beforeErrors;
    if (!REQUIRED_SECTIONS[item.type]) {
      rows.push({
        pageId: item.pageId,
        slug: item.slug,
        type: item.type,
        status: "skipped",
        beforeStatus: item.beforeStatus,
        beforeErrors,
        reason: `unsupported type ${item.type}`,
      });
      continue;
    }

    const [page] = await db
      .select()
      .from(schema.pages)
      .where(and(eq(schema.pages.id, BigInt(item.pageId)), eq(schema.pages.deleted, 0)))
      .limit(1);
    if (!page) {
      rows.push({
        pageId: item.pageId,
        slug: item.slug,
        type: item.type,
        status: "skipped",
        beforeStatus: item.beforeStatus,
        beforeErrors,
        reason: "page not found",
      });
      continue;
    }

    const { repaired, changed } = repairLegacyEntityContent(page.type, page.content);
    if (!changed) {
      const review = await reviewStoredOrNarrative(page.id, page.content, dryRun);
      if (!dryRun) await persistPageReview(review, actor);
      rows.push({
        pageId: item.pageId,
        slug: item.slug,
        type: item.type,
        status: item.beforeStatus === "fail" ? "unchanged" : "reviewed",
        beforeStatus: item.beforeStatus,
        afterStatus: review.status,
        beforeErrors,
        afterErrors: review.issues.filter((issue) => issue.severity === "error").length,
        reason: "content already matched structural template",
      });
      continue;
    }

    if (dryRun) {
      const review = await reviewNarrativeForPage(page.id, repaired);
      rows.push({
        pageId: item.pageId,
        slug: item.slug,
        type: item.type,
        status: "repaired",
        beforeStatus: item.beforeStatus,
        afterStatus: review.status,
        beforeErrors,
        afterErrors: review.issues.filter((issue) => issue.severity === "error").length,
        reason: "dry-run",
      });
      continue;
    }

    const contentHash = sha256(repaired);
    await db.insert(schema.pageVersions).values(
      withCreateAudit(
        {
          pageId: page.id,
          content: page.content,
          timeline: page.timeline,
          frontmatter: page.frontmatter as Record<string, unknown>,
          editedBy: actor,
          reason: "page:repair:before",
        },
        actor
      )
    );
    await db
      .update(schema.pages)
      .set(withAudit({ content: repaired, contentHash }, actor))
      .where(eq(schema.pages.id, page.id));

    await db.insert(schema.events).values(
      withCreateAudit(
        {
          actor,
          action: "page_repair",
          entityType: "page",
          entityId: page.id,
          payload: {
            beforeContentHash: page.contentHash,
            afterContentHash: contentHash,
            repairType: "structural_template_wrap",
          },
        },
        actor
      )
    );

    const afterReview = await reviewStoredPage(page.id);
    await persistPageReview(afterReview, actor);
    rows.push({
      pageId: item.pageId,
      slug: item.slug,
      type: item.type,
      status: "repaired",
      beforeStatus: item.beforeStatus,
      afterStatus: afterReview.status,
      beforeErrors,
      afterErrors: afterReview.issues.filter((issue) => issue.severity === "error").length,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRun,
    limit,
    rows,
    summary: {
      repaired: rows.filter((row) => row.status === "repaired").length,
      reviewed: rows.filter((row) => row.status === "reviewed").length,
      unchanged: rows.filter((row) => row.status === "unchanged").length,
      skipped: rows.filter((row) => row.status === "skipped").length,
      passAfter: rows.filter((row) => row.afterStatus === "pass").length,
      failAfter: rows.filter((row) => row.afterStatus === "fail").length,
    },
  };
}

export function formatPageRepairReport(report: PageRepairReport): string {
  const lines = [
    `Page repair ${report.dryRun ? "(DRY-RUN)" : ""}`,
    `  limit=${report.limit} repaired=${report.summary.repaired} reviewed=${report.summary.reviewed} pass_after=${report.summary.passAfter} fail_after=${report.summary.failAfter} skipped=${report.summary.skipped}`,
    "",
  ];
  for (const row of report.rows) {
    const after = row.afterStatus
      ? ` -> ${row.afterStatus} (${row.afterErrors ?? 0} errors)`
      : "";
    const reason = row.reason ? ` reason=${row.reason}` : "";
    lines.push(
      `  #${row.pageId.padStart(4)} ${row.slug} [${row.type}] ${row.status}: ${row.beforeStatus} (${row.beforeErrors} errors)${after}${reason}`
    );
  }
  return lines.join("\n");
}

async function listAllEntityRepairCandidates(opts: {
  limit: number;
  minChars: number;
  forceAll: boolean;
}): Promise<Array<{
  pageId: string;
  slug: string;
  type: string;
  title: string;
  beforeStatus: "pass" | "fail";
  beforeErrors: number;
}>> {
  const types = Object.keys(REQUIRED_SECTIONS);
  const rows = (await db.execute(drizzleSql`
    WITH latest_review AS (
      SELECT DISTINCT ON (entity_id)
        entity_id::bigint AS page_id,
        payload->>'status' AS status,
        (
          SELECT COUNT(*)::int
          FROM jsonb_array_elements(COALESCE(payload->'issues', '[]'::jsonb)) issue
          WHERE issue->>'severity' = 'error'
        ) AS errors
      FROM events
      WHERE deleted = 0 AND action = 'page_review' AND entity_type = 'page'
      ORDER BY entity_id, ts DESC
    )
    SELECT
      p.id::text AS page_id,
      p.slug,
      p.type,
      p.title,
      COALESCE(lr.status, 'fail') AS before_status,
      COALESCE(lr.errors, 0)::int AS before_errors
    FROM pages p
    LEFT JOIN latest_review lr ON lr.page_id = p.id
    WHERE p.deleted = 0
      AND p.type IN (${drizzleSql.join(types.map((type) => drizzleSql`${type}`), drizzleSql`, `)})
      AND (
        ${opts.forceAll}
        OR (
          length(trim(p.content)) >= ${opts.minChars}
          AND (
            lr.page_id IS NULL
            OR lr.status = 'fail'
            OR NOT EXISTS (
              SELECT 1
              FROM regexp_matches(p.content, '^##\\s+', 'm') AS _
            )
          )
        )
      )
    ORDER BY p.id ASC
    LIMIT ${opts.limit}
  `)) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    before_status: "pass" | "fail" | null;
    before_errors: number | null;
  }>;

  return rows.map((row) => ({
    pageId: row.page_id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    beforeStatus: row.before_status === "pass" ? "pass" : "fail",
    beforeErrors: row.before_errors ?? 0,
  }));
}

async function reviewStoredOrNarrative(
  pageId: bigint,
  narrative: string,
  dryRun: boolean
) {
  return dryRun ? reviewNarrativeForPage(pageId, narrative) : reviewStoredPage(pageId);
}

function parseH2Sections(body: string): { preamble: string; sections: ParsedSection[] } {
  const matches = Array.from(body.matchAll(/^##\s+(.+?)\s*$/gm));
  if (matches.length === 0) return { preamble: body, sections: [] };

  const first = matches[0]!;
  const preamble = body.slice(0, first.index).trim();
  const sections: ParsedSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const next = matches[i + 1];
    const title = current[1]!.trim();
    const start = current.index! + current[0].length;
    const end = next ? next.index! : body.length;
    sections.push({ title, body: body.slice(start, end).trim() });
  }
  return { preamble, sections };
}

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_#[\]()]/g, "")
    .replace(/[/:&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(value: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}
