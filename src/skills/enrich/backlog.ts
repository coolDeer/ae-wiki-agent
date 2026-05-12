/**
 * enrich backlog
 *
 * 把 enrich pipeline 的待处理页收敛成一个运营视图：
 *   - entity stubs awaiting first enrich
 *   - completeness 低
 *   - backlink 多
 *   - 最近有新增 backlinks
 *   - 是否已有 in-flight enrich job
 */

import { sql } from "drizzle-orm";

import { isEntityStateAwaitingEnrich } from "~/core/entity-state.ts";
import { db } from "~/core/db.ts";
import { effectiveBacklinkPredicate } from "~/core/links/policy.ts";

const ELIGIBLE_TYPES = ["company", "industry", "concept", "thesis"];

export interface EnrichBacklogRow {
  pageId: string;
  slug: string;
  type: string;
  title: string;
  entityState: string;
  confidence: string;
  completenessScore: number;
  backlinks: number;
  newBacklinksSinceEnrich: number;
  lastEnrichAt: string | null;
  inFlight: boolean;
  priority: number;
  recommendedAction: "enrich_now" | "retrigger" | "monitor";
}

export interface EnrichBacklogReport {
  generatedAt: string;
  filters: {
    type: string | null;
    limit: number;
    includeInFlight: boolean;
  };
  summary: {
    enrichNow: number;
    retrigger: number;
    monitor: number;
  };
  rows: EnrichBacklogRow[];
}

export interface RawEnrichBacklogRow {
  page_id: string;
  slug: string;
  type: string;
  title: string;
  entity_state: string;
  confidence: string;
  completeness_score: string;
  backlinks: number;
  last_enrich_at: string | Date | null;
  new_backlinks_since_enrich: number;
  in_flight: boolean;
}

export async function getEnrichBacklog(opts: {
  type?: string;
  limit?: number;
  includeInFlight?: boolean;
} = {}): Promise<EnrichBacklogReport> {
  const limit = opts.limit ?? 30;
  const includeInFlight = opts.includeInFlight ?? false;
  if (opts.type && !ELIGIBLE_TYPES.includes(opts.type)) {
    throw new Error(`type='${opts.type}' 不支持。允许: ${ELIGIBLE_TYPES.join(" / ")}`);
  }

  const typeFilter = opts.type
    ? sql`AND p.type = ${opts.type}`
    : sql`AND p.type IN (${sql.join(ELIGIBLE_TYPES.map((t) => sql`${t}`), sql`, `)})`;
  const inFlightFilter = includeInFlight
    ? sql``
    : sql`AND NOT EXISTS (
        SELECT 1 FROM minion_jobs mj
        WHERE mj.deleted = 0
          AND mj.status IN ('waiting', 'active')
          AND (
            (mj.name = 'enrich_entity' AND mj.data->>'pageId' = p.id::text)
            OR
            (mj.name = 'agent_run' AND mj.data->>'skill' = 'ae-enrich' AND mj.data->>'targetPageId' = p.id::text)
          )
      )`;

  const rows = (await db.execute(sql`
    WITH last_enrich AS (
      SELECT entity_id::bigint AS page_id, MAX(ts) AS last_at
      FROM events
      WHERE deleted = 0 AND action = 'enrich' AND entity_type = 'page'
      GROUP BY entity_id
    ),
    backlink_counts AS (
      SELECT to_page_id,
             (COUNT(*) FILTER (WHERE ${effectiveBacklinkPredicate("links")}))::int AS n
      FROM links
      WHERE deleted = 0
      GROUP BY to_page_id
    ),
    inflight AS (
      SELECT DISTINCT
        CASE
          WHEN mj.name = 'enrich_entity' THEN mj.data->>'pageId'
          ELSE mj.data->>'targetPageId'
        END AS page_id
      FROM minion_jobs mj
      WHERE mj.deleted = 0
        AND mj.status IN ('waiting', 'active')
        AND (
          mj.name = 'enrich_entity'
          OR (mj.name = 'agent_run' AND mj.data->>'skill' = 'ae-enrich')
        )
    )
    SELECT
      p.id::text AS page_id,
      p.slug,
      p.type,
      p.title,
      p.entity_state,
      COALESCE(p.confidence, 'unknown') AS confidence,
      p.completeness_score::text AS completeness_score,
      COALESCE(bc.n, 0) AS backlinks,
      le.last_at AS last_enrich_at,
      COALESCE(
        (SELECT (COUNT(*) FILTER (WHERE ${effectiveBacklinkPredicate("l")}))::int FROM links l
          WHERE l.deleted = 0 AND l.to_page_id = p.id
            AND (le.last_at IS NULL OR l.create_time > le.last_at)),
        0
      ) AS new_backlinks_since_enrich,
      EXISTS (SELECT 1 FROM inflight i WHERE i.page_id = p.id::text) AS in_flight
    FROM pages p
    LEFT JOIN last_enrich le ON le.page_id = p.id
    LEFT JOIN backlink_counts bc ON bc.to_page_id = p.id
    WHERE p.deleted = 0
      ${typeFilter}
      ${inFlightFilter}
      AND (
        p.entity_state IN ('stub', 'candidate_promoted')
        OR p.completeness_score::numeric < 0.6
        OR COALESCE(bc.n, 0) >= 3
      )
    ORDER BY
      COALESCE(bc.n, 0) DESC,
      p.completeness_score::numeric ASC,
      p.id ASC
    LIMIT ${limit}
  `)) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    entity_state: string;
    confidence: string;
    completeness_score: string;
    backlinks: number;
    last_enrich_at: string | Date | null;
    new_backlinks_since_enrich: number;
    in_flight: boolean;
  }>;

  const mapped = rows.map(mapEnrichBacklogRow);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      type: opts.type ?? null,
      limit,
      includeInFlight,
    },
    summary: {
      enrichNow: mapped.filter((row) => row.recommendedAction === "enrich_now").length,
      retrigger: mapped.filter((row) => row.recommendedAction === "retrigger").length,
      monitor: mapped.filter((row) => row.recommendedAction === "monitor").length,
    },
    rows: mapped,
  };
}

export function mapEnrichBacklogRow(row: RawEnrichBacklogRow): EnrichBacklogRow {
  const completenessScore = parseFloat(row.completeness_score);
  const awaitingFirstEnrich = isEntityStateAwaitingEnrich(row.entity_state);
  const recommendedAction =
    awaitingFirstEnrich && row.backlinks >= 2
      ? "enrich_now"
      : row.new_backlinks_since_enrich >= 2 || (row.backlinks >= 3 && completenessScore < 0.5)
        ? "retrigger"
        : "monitor";
  const priority =
    (awaitingFirstEnrich ? 3 : 1) +
    Math.min(row.backlinks, 10) +
    Math.max(0, Math.round((0.8 - completenessScore) * 10));

  return {
    pageId: row.page_id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    entityState: row.entity_state,
    confidence: row.confidence,
    completenessScore,
    backlinks: row.backlinks,
    newBacklinksSinceEnrich: row.new_backlinks_since_enrich,
    lastEnrichAt:
      row.last_enrich_at instanceof Date
        ? row.last_enrich_at.toISOString()
        : row.last_enrich_at,
    inFlight: row.in_flight,
    priority,
    recommendedAction,
  };
}

export function formatEnrichBacklog(report: EnrichBacklogReport): string {
  const lines = [
    `Enrich backlog (${report.rows.length} shown)`,
    `  filter: type=${report.filters.type ?? "(all eligible)"} limit=${report.filters.limit} include_in_flight=${report.filters.includeInFlight}`,
    `  summary: enrich_now=${report.summary.enrichNow} retrigger=${report.summary.retrigger} monitor=${report.summary.monitor}`,
    "",
  ];
  if (report.rows.length === 0) {
    lines.push("No enrich backlog rows.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(
      `  priority=${row.priority} action=${row.recommendedAction} [${row.type}] #${row.pageId} ${row.slug}`
    );
    lines.push(
      `    state=${row.entityState} conf=${row.confidence} score=${row.completenessScore.toFixed(2)} backlinks=${row.backlinks} new=${row.newBacklinksSinceEnrich} inflight=${row.inFlight}`
    );
  }
  return lines.join("\n");
}
