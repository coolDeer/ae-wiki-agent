/**
 * page-retire
 *
 * Conservatively archive useless auto-created entity pages. This is intentionally
 * stricter than page:merge: a page can only be retired when it has no active
 * semantic references left in the graph.
 */

import { and, eq, sql } from "drizzle-orm";

import { withAudit, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";

const RETIRABLE_TYPES = new Set(["company", "industry", "concept", "thesis"]);
const DEFAULT_MAX_CONTENT_CHARS = 300;

export interface RetirePageOptions {
  reason?: string;
  actor?: string;
  dryRun?: boolean;
  force?: boolean;
  maxContentChars?: number;
}

export interface RetirePageReport {
  page: {
    id: string;
    slug: string;
    type: string;
    title: string;
    confidence: string | null;
    contentChars: number;
  };
  dryRun: boolean;
  force: boolean;
  reason: string;
  blockers: string[];
  counts: {
    inboundLinks: number;
    outboundLinks: number;
    originLinks: number;
    entityFacts: number;
    sourceFacts: number;
    entityTimeline: number;
    sourceTimeline: number;
    entitySignals: number;
    thesisSignals: number;
    sourceSignals: number;
    thesisRows: number;
    targetTheses: number;
    tags: number;
    rawData: number;
    contentChunks: number;
  };
  softDeleted: {
    page: boolean;
    tags: number;
    rawData: number;
    contentChunks: number;
  };
}

export async function retirePage(
  pageId: bigint,
  opts: RetirePageOptions = {}
): Promise<RetirePageReport> {
  const actor = opts.actor ?? "agent:claude";
  const reason = opts.reason?.trim() || "page cleanup";
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  const maxContentChars = opts.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;

  const [page] = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      confidence: schema.pages.confidence,
      content: schema.pages.content,
      deleted: schema.pages.deleted,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);

  if (!page) throw new Error(`page #${pageId} 不存在`);
  if (page.deleted !== 0) throw new Error(`page #${pageId} 已经 deleted=${page.deleted}`);

  const contentChars = visibleChars(page.content);
  const counts = await collectReferenceCounts(pageId);
  const blockers = buildBlockers({
    type: page.type,
    confidence: page.confidence,
    contentChars,
    maxContentChars,
    counts,
    force,
  });

  const report: RetirePageReport = {
    page: {
      id: page.id.toString(),
      slug: page.slug,
      type: page.type,
      title: page.title,
      confidence: page.confidence,
      contentChars,
    },
    dryRun,
    force,
    reason,
    blockers,
    counts,
    softDeleted: {
      page: false,
      tags: 0,
      rawData: 0,
      contentChunks: 0,
    },
  };

  if (dryRun) return report;
  if (blockers.length > 0) {
    throw new Error(`page #${pageId} 不能 retire:\n${blockers.map((b) => `  - ${b}`).join("\n")}`);
  }

  const now = new Date();
  const retiredFrontmatter = JSON.stringify({
    retired_by: "page:retire",
    retired_reason: reason,
    retired_at: now.toISOString(),
  });
  const [tagsDeleted, rawDataDeleted, chunksDeleted] = await Promise.all([
    softDeleteRows(schema.tags, pageId, actor),
    softDeleteRows(schema.rawData, pageId, actor),
    softDeleteRows(schema.contentChunks, pageId, actor),
  ]);

  await db
    .update(schema.pages)
    .set(
      withAudit(
        {
          status: "archived",
          deleted: 1,
          frontmatter: sql`${schema.pages.frontmatter} || ${retiredFrontmatter}::jsonb`,
        },
        actor
      )
    )
    .where(eq(schema.pages.id, pageId));

  await db.insert(schema.events).values(
    withCreateAudit(
      {
        actor,
        action: "page_retire",
        entityType: "page",
        entityId: pageId,
        payload: {
          reason,
          page: report.page,
          counts,
          softDeleted: {
            tags: tagsDeleted,
            rawData: rawDataDeleted,
            contentChunks: chunksDeleted,
          },
        },
      },
      actor
    )
  );

  report.softDeleted = {
    page: true,
    tags: tagsDeleted,
    rawData: rawDataDeleted,
    contentChunks: chunksDeleted,
  };

  return report;
}

async function collectReferenceCounts(pageId: bigint): Promise<RetirePageReport["counts"]> {
  const [
    inboundLinks,
    outboundLinks,
    originLinks,
    entityFacts,
    sourceFacts,
    entityTimeline,
    sourceTimeline,
    entitySignals,
    thesisSignals,
    sourceSignals,
    thesisRows,
    targetTheses,
    tags,
    rawData,
    contentChunks,
  ] = await Promise.all([
    countSql`SELECT COUNT(*)::int AS n FROM links WHERE deleted = 0 AND to_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM links WHERE deleted = 0 AND from_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM links WHERE deleted = 0 AND origin_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM facts WHERE deleted = 0 AND entity_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM facts WHERE deleted = 0 AND source_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM timeline_entries WHERE deleted = 0 AND entity_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM timeline_entries WHERE deleted = 0 AND source_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM signals WHERE deleted = 0 AND entity_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM signals WHERE deleted = 0 AND thesis_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM signals WHERE deleted = 0 AND source_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM theses WHERE deleted = 0 AND page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM theses WHERE deleted = 0 AND target_page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM tags WHERE deleted = 0 AND page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM raw_data WHERE deleted = 0 AND page_id = ${pageId}`,
    countSql`SELECT COUNT(*)::int AS n FROM content_chunks WHERE deleted = 0 AND page_id = ${pageId}`,
  ]);

  return {
    inboundLinks,
    outboundLinks,
    originLinks,
    entityFacts,
    sourceFacts,
    entityTimeline,
    sourceTimeline,
    entitySignals,
    thesisSignals,
    sourceSignals,
    thesisRows,
    targetTheses,
    tags,
    rawData,
    contentChunks,
  };
}

function buildBlockers(opts: {
  type: string;
  confidence: string | null;
  contentChars: number;
  maxContentChars: number;
  counts: RetirePageReport["counts"];
  force: boolean;
}): string[] {
  const blockers: string[] = [];
  if (!RETIRABLE_TYPES.has(opts.type)) {
    blockers.push(
      `type='${opts.type}' 不支持 page:retire；source/brief 走 ingest:pass 或 ingest:skip，output 不应自动清理`
    );
  }
  if (!opts.force && opts.confidence !== "low") {
    blockers.push(`confidence='${opts.confidence ?? "null"}' 不是 low；高/中置信页面需人工确认或 --force`);
  }
  if (!opts.force && opts.contentChars > opts.maxContentChars) {
    blockers.push(
      `content ${opts.contentChars} chars > ${opts.maxContentChars}；已有实质 narrative，需人工确认或 --force`
    );
  }

  const referenceCounts: Array<[keyof RetirePageReport["counts"], number]> = [
    ["inboundLinks", opts.counts.inboundLinks],
    ["outboundLinks", opts.counts.outboundLinks],
    ["originLinks", opts.counts.originLinks],
    ["entityFacts", opts.counts.entityFacts],
    ["sourceFacts", opts.counts.sourceFacts],
    ["entityTimeline", opts.counts.entityTimeline],
    ["sourceTimeline", opts.counts.sourceTimeline],
    ["entitySignals", opts.counts.entitySignals],
    ["thesisSignals", opts.counts.thesisSignals],
    ["sourceSignals", opts.counts.sourceSignals],
    ["thesisRows", opts.counts.thesisRows],
    ["targetTheses", opts.counts.targetTheses],
  ];
  for (const [name, count] of referenceCounts) {
    if (count > 0) blockers.push(`${name}=${count}；先 merge/retype/修 link，不能直接 retire`);
  }

  return blockers;
}

async function softDeleteRows(
  table: typeof schema.tags | typeof schema.rawData | typeof schema.contentChunks,
  pageId: bigint,
  actor: string
): Promise<number> {
  const rows = await db
    .update(table)
    .set(withAudit({ deleted: 1 }, actor))
    .where(and(eq(table.pageId, pageId), eq(table.deleted, 0)))
    .returning({ id: table.id });
  return rows.length;
}

async function countSql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<number> {
  const rows = (await db.execute(sql(strings, ...values))) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

function visibleChars(content: string): number {
  return content
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, "$2")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim().length;
}
