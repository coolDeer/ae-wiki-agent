/**
 * page-demote-candidates
 *
 * Move legacy low-confidence entity pages back into entity_candidates when the
 * page only exists because old ingest promoted weak mentions directly.
 */

import { sql as drizzleSql } from "drizzle-orm";

import { Actor, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";
import type { PageType } from "~/core/schema/pages.ts";
import {
  autoRejectReasonForCandidate,
  upsertEntityCandidate,
} from "~/skills/entity-candidates/index.ts";

const ENTITY_TYPES = new Set(["company", "concept", "industry"]);
const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_CONTENT_CHARS = 1300;
const DEFAULT_STRONG_WEIGHT = 0.9;

export interface DemotePagesToCandidatesOptions {
  type?: string;
  limit?: number;
  dryRun?: boolean;
  actor?: string;
  maxContentChars?: number;
  strongWeight?: number;
  includeGenericPending?: boolean;
}

export interface DemotedCandidateRow {
  page: {
    id: string;
    slug: string;
    type: string;
    title: string;
    displayName: string | null;
    aliases: string[];
    contentChars: number;
  };
  weakInboundLinks: number;
  sourcePageIds: string[];
  candidateStatus: "pending" | "rejected";
  rejectReason: string | null;
  applied: boolean;
  candidateId: string | null;
  softDeleted: {
    page: boolean;
    weakInboundLinks: number;
    pageOwnedLinks: number;
    tags: number;
    rawData: number;
    contentChunks: number;
  };
}

export interface DemotePagesToCandidatesReport {
  dryRun: boolean;
  filters: {
    type?: string;
    limit: number;
    maxContentChars: number;
    strongWeight: number;
  };
  totalEligible: number;
  rows: DemotedCandidateRow[];
  summary: {
    pagesDemoted: number;
    candidatesTouched: number;
    rejectedCandidates: number;
    weakInboundLinksDeleted: number;
    pageOwnedLinksDeleted: number;
  };
}

interface EligiblePageRow {
  id: string;
  source_id: string;
  slug: string;
  type: string;
  title: string;
  display_name: string | null;
  aliases: string[] | null;
  content_chars: number;
  weak_inbound_links: number;
  source_page_ids: string[] | null;
}

interface CountRow {
  n: number;
}

export async function demotePagesToCandidates(
  opts: DemotePagesToCandidatesOptions = {}
): Promise<DemotePagesToCandidatesReport> {
  const actor = opts.actor ?? Actor.agentClaude;
  const dryRun = opts.dryRun ?? true;
  const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, 500);
  const maxContentChars = opts.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  const strongWeight = opts.strongWeight ?? DEFAULT_STRONG_WEIGHT;
  const type = opts.type && ENTITY_TYPES.has(opts.type) ? opts.type : undefined;
  const typeClause = type ? drizzleSql`AND p.type = ${type}` : drizzleSql``;

  const countRows = await db.execute(drizzleSql`
    WITH eligible AS (
      ${eligiblePagesQuery(typeClause, maxContentChars, strongWeight)}
    )
    SELECT COUNT(*)::int AS n FROM eligible
  `);
  const totalEligible = Number((countRows as unknown as CountRow[])[0]?.n ?? 0);

  const rows = await db.execute(drizzleSql`
    WITH eligible AS (
      ${eligiblePagesQuery(typeClause, maxContentChars, strongWeight)}
    )
    SELECT *
    FROM eligible
    ORDER BY type, id
    LIMIT ${limit}
  `);

  const reportRows: DemotedCandidateRow[] = [];
  const candidateIds = new Set<string>();
  let weakInboundLinksDeleted = 0;
  let pageOwnedLinksDeleted = 0;

  for (const row of rows as unknown as EligiblePageRow[]) {
    const pageId = BigInt(row.id);
    const aliases = row.aliases ?? [];
    const sourcePageIds = (row.source_page_ids ?? []).filter(Boolean);
    const autoRejectReason = opts.includeGenericPending
      ? null
      : autoRejectReasonForCandidate(row.slug);
    const candidateStatus = autoRejectReason ? "rejected" : "pending";
    const rejectReason = autoRejectReason
      ? `demoted-old-low-confidence-page:${autoRejectReason}`
      : null;
    let candidateId: string | null = null;
    let weakDeleted = 0;
    let ownedDeleted = 0;
    let tagsDeleted = 0;
    let rawDataDeleted = 0;
    let chunksDeleted = 0;

    if (!dryRun) {
      for (const sourcePageId of sourcePageIds) {
        const candidate = await upsertEntityCandidate({
          sourceId: row.source_id,
          proposedSlug: row.slug,
          proposedType: row.type as PageType,
          displayName: row.display_name ?? row.title,
          aliases,
          sourcePageId: BigInt(sourcePageId),
          actor,
          initialStatus: candidateStatus,
          rejectReason,
          metadata: {
            demotedFromPageId: row.id,
            demotedFromPageSlug: row.slug,
            demotedAt: new Date().toISOString(),
            demoteReason: "legacy-low-confidence-weak-mention-only",
            previousContentChars: row.content_chars,
          },
        });
        candidateId = candidate.id;
        candidateIds.add(candidate.id);
      }

      weakDeleted = await softDeleteWeakInboundLinks(pageId, actor, strongWeight);
      ownedDeleted = await softDeletePageOwnedLinks(pageId, actor);
      tagsDeleted = await softDeletePageRows("tags", pageId, actor);
      rawDataDeleted = await softDeletePageRows("raw_data", pageId, actor);
      chunksDeleted = await softDeletePageRows("content_chunks", pageId, actor);

      const demotedFrontmatter = JSON.stringify({
        demoted_by: "page:demote-candidates",
        demoted_reason: "legacy-low-confidence-weak-mention-only",
        demoted_to_candidate_id: candidateId,
        demoted_at: new Date().toISOString(),
      });
      await db.execute(drizzleSql`
        UPDATE pages
        SET
          status = 'archived',
          deleted = 1,
          frontmatter = frontmatter || ${demotedFrontmatter}::jsonb,
          update_by = ${actor},
          update_time = NOW()
        WHERE id = ${pageId}
      `);

      await db.insert(schema.events).values(
        withCreateAudit(
          {
            actor,
            action: "page_demoted_to_candidate",
            entityType: "page",
            entityId: pageId,
            payload: {
              candidateId,
              candidateStatus,
              rejectReason,
              sourcePageIds,
              weakInboundLinksDeleted: weakDeleted,
              pageOwnedLinksDeleted: ownedDeleted,
              page: {
                id: row.id,
                slug: row.slug,
                type: row.type,
                title: row.title,
              },
            },
          },
          actor
        )
      );
    }

    weakInboundLinksDeleted += weakDeleted;
    pageOwnedLinksDeleted += ownedDeleted;
    reportRows.push({
      page: {
        id: row.id,
        slug: row.slug,
        type: row.type,
        title: row.title,
        displayName: row.display_name,
        aliases,
        contentChars: row.content_chars,
      },
      weakInboundLinks: row.weak_inbound_links,
      sourcePageIds,
      candidateStatus,
      rejectReason,
      applied: !dryRun,
      candidateId,
      softDeleted: {
        page: !dryRun,
        weakInboundLinks: weakDeleted,
        pageOwnedLinks: ownedDeleted,
        tags: tagsDeleted,
        rawData: rawDataDeleted,
        contentChunks: chunksDeleted,
      },
    });
  }

  return {
    dryRun,
    filters: { type, limit, maxContentChars, strongWeight },
    totalEligible,
    rows: reportRows,
    summary: {
      pagesDemoted: dryRun ? 0 : reportRows.length,
      candidatesTouched: candidateIds.size,
      rejectedCandidates: reportRows.filter((r) => r.candidateStatus === "rejected").length,
      weakInboundLinksDeleted,
      pageOwnedLinksDeleted,
    },
  };
}

export function formatDemotePagesToCandidatesReport(
  report: DemotePagesToCandidatesReport
): string {
  const lines: string[] = [];
  lines.push(
    `Page demote candidates ${report.dryRun ? "(dry-run)" : "(applied)"}: ${report.rows.length}/${report.totalEligible} shown`
  );
  lines.push(
    `filters: type=${report.filters.type ?? "all"} maxContentChars=${report.filters.maxContentChars} strongWeight=${report.filters.strongWeight}`
  );
  lines.push(
    `summary: pagesDemoted=${report.summary.pagesDemoted} candidatesTouched=${report.summary.candidatesTouched} rejectedCandidates=${report.summary.rejectedCandidates} weakLinksDeleted=${report.summary.weakInboundLinksDeleted}`
  );
  for (const row of report.rows.slice(0, 80)) {
    lines.push(
      `#${row.page.id} ${row.page.slug} (${row.page.type}, chars=${row.page.contentChars}, weakLinks=${row.weakInboundLinks}) -> ${row.candidateStatus}${row.candidateId ? ` #${row.candidateId}` : ""}`
    );
  }
  if (report.rows.length > 80) {
    lines.push(`... ${report.rows.length - 80} more rows omitted`);
  }
  return lines.join("\n");
}

function eligiblePagesQuery(
  typeClause: ReturnType<typeof drizzleSql>,
  maxContentChars: number,
  strongWeight: number
) {
  return drizzleSql`
    SELECT
      p.id::text,
      p.source_id,
      p.slug,
      p.type,
      p.title,
      p.display_name,
      COALESCE(p.aliases, ARRAY[]::text[]) AS aliases,
      LENGTH(COALESCE(p.content, ''))::int AS content_chars,
      (
        SELECT COUNT(*)::int
        FROM links l
        WHERE l.deleted = 0
          AND l.to_page_id = p.id
          AND l.from_page_id <> p.id
          AND ${weakLinkPredicate(strongWeight)}
      ) AS weak_inbound_links,
      (
        SELECT ARRAY(
          SELECT DISTINCT COALESCE(l.origin_page_id, l.from_page_id)::text
          FROM links l
          WHERE l.deleted = 0
            AND l.to_page_id = p.id
            AND l.from_page_id <> p.id
            AND COALESCE(l.origin_page_id, l.from_page_id) IS NOT NULL
            AND ${weakLinkPredicate(strongWeight)}
          ORDER BY 1
        )
      ) AS source_page_ids
    FROM pages p
    WHERE p.deleted = 0
      AND p.type IN ('company', 'concept', 'industry')
      ${typeClause}
      AND p.confidence = 'low'
      AND p.ticker IS NULL
      AND p.exchange IS NULL
      AND LENGTH(COALESCE(p.content, '')) <= ${maxContentChars}
      AND EXISTS (
        SELECT 1
        FROM links l
        WHERE l.deleted = 0
          AND l.to_page_id = p.id
          AND l.from_page_id <> p.id
          AND ${weakLinkPredicate(strongWeight)}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM links l
        WHERE l.deleted = 0
          AND l.to_page_id = p.id
          AND l.from_page_id <> p.id
          AND ${strongLinkPredicate(strongWeight)}
      )
      AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.deleted = 0 AND (f.entity_page_id = p.id OR f.source_page_id = p.id))
      AND NOT EXISTS (SELECT 1 FROM timeline_entries te WHERE te.deleted = 0 AND (te.entity_page_id = p.id OR te.source_page_id = p.id))
      AND NOT EXISTS (SELECT 1 FROM signals s WHERE s.deleted = 0 AND (s.entity_page_id = p.id OR s.thesis_page_id = p.id OR s.source_page_id = p.id))
      AND NOT EXISTS (SELECT 1 FROM theses th WHERE th.deleted = 0 AND (th.page_id = p.id OR th.target_page_id = p.id))
  `;
}

function strongLinkPredicate(strongWeight: number) {
  return drizzleSql`(
    COALESCE(l.weight::numeric >= ${strongWeight}, false)
    OR COALESCE(l.link_type <> 'mention', false)
    OR COALESCE((l.link_source = 'frontmatter' AND l.origin_field = 'primary_entities'), false)
    OR COALESCE(l.origin_field IN ('facts_block', 'timeline_block'), false)
  )`;
}

function weakLinkPredicate(strongWeight: number) {
  return drizzleSql`NOT ${strongLinkPredicate(strongWeight)}`;
}

async function softDeleteWeakInboundLinks(
  pageId: bigint,
  actor: string,
  strongWeight: number
): Promise<number> {
  const rows = await db.execute(drizzleSql`
    UPDATE links l
    SET deleted = 1, update_by = ${actor}, update_time = NOW()
    WHERE l.deleted = 0
      AND l.to_page_id = ${pageId}
      AND l.from_page_id <> ${pageId}
      AND ${weakLinkPredicate(strongWeight)}
    RETURNING id::text
  `);
  return (rows as unknown[]).length;
}

async function softDeletePageOwnedLinks(pageId: bigint, actor: string): Promise<number> {
  const rows = await db.execute(drizzleSql`
    UPDATE links
    SET deleted = 1, update_by = ${actor}, update_time = NOW()
    WHERE deleted = 0
      AND (from_page_id = ${pageId} OR origin_page_id = ${pageId})
    RETURNING id::text
  `);
  return (rows as unknown[]).length;
}

async function softDeletePageRows(
  tableName: "tags" | "raw_data" | "content_chunks",
  pageId: bigint,
  actor: string
): Promise<number> {
  const rows = await db.execute(drizzleSql`
    UPDATE ${drizzleSql.identifier(tableName)}
    SET deleted = 1, update_by = ${actor}, update_time = NOW()
    WHERE deleted = 0 AND page_id = ${pageId}
    RETURNING id::text
  `);
  return (rows as unknown[]).length;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
