/**
 * facts:backfill-links
 *
 * Keep the structured facts layer and typed-edge graph consistent. Every
 * active fact with source_page_id should have a source -> entity strong link
 * so orphan/enrich/refresh logic can see the provenance in the graph.
 */

import { sql as drizzleSql } from "drizzle-orm";

import { Actor, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

export interface BackfillFactProvenanceLinksOptions {
  dryRun?: boolean;
  limit?: number;
  actor?: string;
}

export interface MissingFactProvenanceLinkRow {
  sourcePageId: string;
  sourceSlug: string;
  entityPageId: string;
  entitySlug: string;
  entityType: string;
  factCount: number;
}

export interface BackfillFactProvenanceLinksReport {
  dryRun: boolean;
  filters: {
    limit: number;
  };
  totalMissingPairs: number;
  rows: MissingFactProvenanceLinkRow[];
  summary: {
    insertedLinks: number;
    pagesTouched: number;
    sourcePagesTouched: number;
    byType: Record<string, number>;
    eventId: string | null;
  };
}

interface CountRow {
  n: number;
}

interface RawMissingRow {
  source_page_id: string;
  source_slug: string;
  entity_page_id: string;
  entity_slug: string;
  entity_type: string;
  fact_count: number;
}

interface RawInsertSummary {
  inserted_links: number;
  pages_touched: number;
  source_pages_touched: number;
  by_type: Record<string, number> | null;
}

export async function backfillFactProvenanceLinks(
  opts: BackfillFactProvenanceLinksOptions = {}
): Promise<BackfillFactProvenanceLinksReport> {
  const dryRun = opts.dryRun ?? true;
  const actor = opts.actor ?? Actor.agentClaude;
  const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);

  const totalRows = await db.execute(drizzleSql`
    WITH missing AS (${missingFactLinkPairsQuery()})
    SELECT COUNT(*)::int AS n FROM missing
  `);
  const totalMissingPairs = Number((totalRows as unknown as CountRow[])[0]?.n ?? 0);

  const rows = (await db.execute(drizzleSql`
    WITH missing AS (${missingFactLinkPairsQuery()})
    SELECT *
    FROM missing
    ORDER BY entity_type, entity_page_id, source_page_id
    LIMIT ${limit}
  `)) as unknown as RawMissingRow[];

  const reportRows = rows.map(mapMissingRow);
  const summary = {
    insertedLinks: 0,
    pagesTouched: 0,
    sourcePagesTouched: 0,
    byType: {} as Record<string, number>,
    eventId: null as string | null,
  };

  if (!dryRun && rows.length > 0) {
    const inserted = (await db.execute(drizzleSql`
      WITH missing AS (${missingFactLinkPairsQuery()}),
      limited AS (
        SELECT *
        FROM missing
        ORDER BY entity_type, entity_page_id, source_page_id
        LIMIT ${limit}
      ),
      inserted AS (
        INSERT INTO links (
          from_page_id,
          to_page_id,
          link_type,
          context,
          link_source,
          origin_page_id,
          origin_field,
          weight,
          create_by,
          update_by
        )
        SELECT
          source_page_id::bigint,
          entity_page_id::bigint,
          'mention',
          'backfilled from active facts',
          'extracted',
          source_page_id::bigint,
          'facts_block',
          1.20,
          ${actor},
          ${actor}
        FROM limited
        ON CONFLICT DO NOTHING
        RETURNING id, from_page_id, to_page_id
      ),
      inserted_with_page AS (
        SELECT i.id, i.from_page_id, i.to_page_id, p.type
        FROM inserted i
        JOIN pages p ON p.id = i.to_page_id
      ),
      by_type AS (
        SELECT type, COUNT(*)::int AS n
        FROM inserted_with_page
        GROUP BY type
      )
      SELECT
        (SELECT COUNT(*)::int FROM inserted) AS inserted_links,
        (SELECT COUNT(DISTINCT to_page_id)::int FROM inserted) AS pages_touched,
        (SELECT COUNT(DISTINCT from_page_id)::int FROM inserted) AS source_pages_touched,
        COALESCE((SELECT jsonb_object_agg(type, n) FROM by_type), '{}'::jsonb) AS by_type
    `)) as unknown as RawInsertSummary[];

    const row = inserted[0];
    summary.insertedLinks = Number(row?.inserted_links ?? 0);
    summary.pagesTouched = Number(row?.pages_touched ?? 0);
    summary.sourcePagesTouched = Number(row?.source_pages_touched ?? 0);
    summary.byType = row?.by_type ?? {};

    if (summary.insertedLinks > 0) {
      const [event] = await db
        .insert(schema.events)
        .values(
          withCreateAudit(
            {
              actor,
              action: "facts_backfill_provenance_links",
              entityType: "links",
              payload: {
                insertedLinks: summary.insertedLinks,
                pagesTouched: summary.pagesTouched,
                sourcePagesTouched: summary.sourcePagesTouched,
                byType: summary.byType,
                reason:
                  "active facts had source_page_id/entity_page_id but missing source->entity facts_block links",
              },
            },
            actor
          )
        )
        .returning({ id: schema.events.id });
      summary.eventId = event?.id?.toString() ?? null;
    }
  }

  return {
    dryRun,
    filters: { limit },
    totalMissingPairs,
    rows: reportRows,
    summary,
  };
}

export function formatBackfillFactProvenanceLinksReport(
  report: BackfillFactProvenanceLinksReport
): string {
  const lines: string[] = [];
  lines.push(
    `Fact provenance links ${report.dryRun ? "(dry-run)" : "(applied)"}: ${report.rows.length}/${report.totalMissingPairs} shown`
  );
  lines.push(
    `summary: inserted=${report.summary.insertedLinks} pages=${report.summary.pagesTouched} sources=${report.summary.sourcePagesTouched}`
  );
  if (report.summary.eventId) lines.push(`event: #${report.summary.eventId}`);
  for (const row of report.rows.slice(0, 80)) {
    lines.push(
      `${row.sourceSlug} -> ${row.entitySlug} (${row.entityType}, facts=${row.factCount})`
    );
  }
  if (report.rows.length > 80) {
    lines.push(`... ${report.rows.length - 80} more rows omitted`);
  }
  return lines.join("\n");
}

function missingFactLinkPairsQuery() {
  return drizzleSql`
    SELECT
      f.source_page_id::text AS source_page_id,
      sp.slug AS source_slug,
      f.entity_page_id::text AS entity_page_id,
      ep.slug AS entity_slug,
      ep.type AS entity_type,
      COUNT(f.id)::int AS fact_count
    FROM facts f
    JOIN pages sp ON sp.id = f.source_page_id AND sp.deleted = 0
    JOIN pages ep ON ep.id = f.entity_page_id AND ep.deleted = 0
    WHERE f.deleted = 0
      AND f.source_page_id IS NOT NULL
      AND f.source_page_id <> f.entity_page_id
      AND ep.type IN ('company', 'concept', 'industry')
      AND NOT EXISTS (
        SELECT 1
        FROM links l
        WHERE l.deleted = 0
          AND l.from_page_id = f.source_page_id
          AND l.to_page_id = f.entity_page_id
          AND l.link_source = 'extracted'
          AND l.origin_field = 'facts_block'
      )
    GROUP BY f.source_page_id, sp.slug, f.entity_page_id, ep.slug, ep.type
  `;
}

function mapMissingRow(row: RawMissingRow): MissingFactProvenanceLinkRow {
  return {
    sourcePageId: row.source_page_id,
    sourceSlug: row.source_slug,
    entityPageId: row.entity_page_id,
    entitySlug: row.entity_slug,
    entityType: row.entity_type,
    factCount: Number(row.fact_count),
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
