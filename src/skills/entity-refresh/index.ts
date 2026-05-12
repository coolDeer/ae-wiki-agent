import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { Actor, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";
import { isEntityStateAwaitingEnrich } from "~/core/entity-state.ts";
import { getEnv } from "~/core/env.ts";
import { addJob } from "~/core/minions/queue.ts";

import { stage3AppendNarrative } from "../ingest/stage-3-narrative.ts";
import { persistPageReview, reviewStoredPage } from "../review/index.ts";

const ELIGIBLE_TYPES = ["company", "industry", "concept", "thesis"] as const;
type EligibleType = (typeof ELIGIBLE_TYPES)[number];

const HIGH_VALUE_LINK_TYPES = new Set([
  "cites",
  "confirms",
  "contradicts",
  "supersedes",
  "critiques",
  "derives_from",
  "tracks",
]);
const MIN_REFRESHABLE_CONTENT_CHARS = 200;

export function isHighValueSourceEvidence(input: {
  linkType: string | null;
  hasFacts?: boolean;
  hasTimeline?: boolean;
  hasSignals?: boolean;
}): boolean {
  return (
    HIGH_VALUE_LINK_TYPES.has(input.linkType ?? "") ||
    input.hasFacts === true ||
    input.hasTimeline === true ||
    input.hasSignals === true
  );
}

export interface EntityRow {
  pageId: string;
  slug: string;
  type: EligibleType;
  title: string;
  entityState: string;
  confidence: string | null;
  completenessScore: number;
  updatedAt: string;
  latestEvidenceAt: string | null;
  daysBehind: number;
  newSources: number;
  newFacts: number;
  newTimelineEntries: number;
  newSignals: number;
}

export interface EntityStaleRow extends EntityRow {
  recommendedAction: "refresh_now" | "monitor";
}

export interface EntityStaleReport {
  generatedAt: string;
  filters: {
    type?: string;
    staleDays: number;
    limit: number;
  };
  summary: {
    totalMatching: number;
    refreshNow: number;
    monitor: number;
  };
  rows: EntityStaleRow[];
}

export interface EntityUpdateCandidateRow extends EntityRow {
  priority: number;
  reasons: string[];
  suggestedSections: string[];
  recommendedAction: "append_update" | "llm_refresh";
}

export interface EntityUpdateCandidatesReport {
  generatedAt: string;
  filters: {
    type?: string;
    limit: number;
  };
  summary: {
    totalMatching: number;
    appendUpdate: number;
    llmRefresh: number;
    /** @deprecated kept for older wiki:maintain callers; equals llmRefresh. */
    manualRewrite: number;
  };
  rows: EntityUpdateCandidateRow[];
}

export interface EntityRefreshQueueRow {
  pageId: string;
  slug: string;
  type: EligibleType;
  title: string;
  recommendedAction: EntityUpdateCandidateRow["recommendedAction"];
  priority: number;
  queued: boolean;
  jobId: string | null;
  reason: string;
}

export interface EntityRefreshQueueReport {
  generatedAt: string;
  trigger: {
    sourcePageId: string | null;
  };
  filters: {
    type?: string;
    limit: number;
  };
  summary: {
    candidates: number;
    queued: number;
    skipped: number;
  };
  rows: EntityRefreshQueueRow[];
}

export interface EntityRefreshReport {
  pageId: string;
  slug: string;
  type: string;
  title: string;
  dryRun: boolean;
  applied: boolean;
  reasons: string[];
  evidence: {
    newSources: number;
    newFacts: number;
    newTimelineEntries: number;
    newSignals: number;
  };
  appendedChars: number;
  preview: string;
  review?: {
    status: string;
    warnings: number;
    errors: number;
  };
}

export async function getEntityStaleReport(opts: {
  type?: string;
  staleDays?: number;
  limit?: number;
} = {}): Promise<EntityStaleReport> {
  const staleDays = opts.staleDays ?? 1;
  const limit = opts.limit ?? 30;
  const rows = await loadEntityRows(opts.type, Math.max(limit, 200));
  const filtered = rows.filter((row) => row.daysBehind >= staleDays);
  const mapped = filtered.slice(0, limit).map((row) => ({
    ...row,
    recommendedAction: row.daysBehind >= 7 || row.newFacts + row.newSignals >= 2 ? "refresh_now" : "monitor",
  } satisfies EntityStaleRow));

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      type: opts.type,
      staleDays,
      limit,
    },
    summary: {
      totalMatching: filtered.length,
      refreshNow: mapped.filter((row) => row.recommendedAction === "refresh_now").length,
      monitor: mapped.filter((row) => row.recommendedAction === "monitor").length,
    },
    rows: mapped,
  };
}

export async function getEntityUpdateCandidates(opts: {
  type?: string;
  limit?: number;
} = {}): Promise<EntityUpdateCandidatesReport> {
  const limit = opts.limit ?? 30;
  const rows = await loadEntityRows(opts.type, Math.max(limit, 200));
  const filtered = rows.filter(
    (row) => row.newSources + row.newFacts + row.newTimelineEntries + row.newSignals > 0
  );
  const mapped = filtered
    .map((row) => {
      const reasons: string[] = [];
      if (row.newSources > 0) reasons.push(`${row.newSources} new high-value source backlinks`);
      if (row.newFacts > 0) reasons.push(`${row.newFacts} new facts`);
      if (row.newTimelineEntries > 0) reasons.push(`${row.newTimelineEntries} new timeline entries`);
      if (row.newSignals > 0) reasons.push(`${row.newSignals} new signals`);
      if (row.daysBehind > 0) reasons.push(`compiled page lags evidence by ${row.daysBehind}d`);

      const suggestedSections = inferSuggestedSections(row.type, row);
      const priority =
        row.daysBehind * 5 +
        row.newFacts * 6 +
        row.newSignals * 8 +
        row.newTimelineEntries * 4 +
        row.newSources * 3 +
        Math.round((1 - row.completenessScore) * 10);
      const recommendedAction =
        row.newSignals >= 2 || row.daysBehind >= 21 ? "llm_refresh" : "append_update";

      return {
        ...row,
        priority,
        reasons,
        suggestedSections,
        recommendedAction,
      } satisfies EntityUpdateCandidateRow;
    })
    .sort((a, b) => b.priority - a.priority || (a.slug < b.slug ? -1 : 1))
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      type: opts.type,
      limit,
    },
    summary: {
      totalMatching: filtered.length,
      appendUpdate: mapped.filter((row) => row.recommendedAction === "append_update").length,
      llmRefresh: mapped.filter((row) => row.recommendedAction === "llm_refresh").length,
      manualRewrite: mapped.filter((row) => row.recommendedAction === "llm_refresh").length,
    },
    rows: mapped,
  };
}

export async function queueEntityRefreshJobs(opts: {
  type?: string;
  limit?: number;
  sourcePageId?: string | number | bigint;
} = {}): Promise<EntityRefreshQueueReport> {
  const limit = opts.limit ?? 500;
  const report = await getEntityUpdateCandidates({ type: opts.type, limit });
  const env = getEnv();
  const sourcePageId = opts.sourcePageId == null ? null : String(opts.sourcePageId);
  const rows: EntityRefreshQueueRow[] = [];

  for (const candidate of report.rows) {
    if (await hasInFlightEntityRefreshJob(candidate.pageId)) {
      rows.push({
        pageId: candidate.pageId,
        slug: candidate.slug,
        type: candidate.type,
        title: candidate.title,
        recommendedAction: candidate.recommendedAction,
        priority: candidate.priority,
        queued: false,
        jobId: null,
        reason: "already-in-flight",
      });
      continue;
    }

    const skipReason = await getEntityRefreshSkipReason(candidate.pageId);
    if (skipReason) {
      rows.push({
        pageId: candidate.pageId,
        slug: candidate.slug,
        type: candidate.type,
        title: candidate.title,
        recommendedAction: candidate.recommendedAction,
        priority: candidate.priority,
        queued: false,
        jobId: null,
        reason: skipReason,
      });
      continue;
    }

    const job = await addJob(
      "entity-refresh",
      {
        skill: "ae-entity-refresh",
        prompt: buildEntityRefreshJobPrompt(candidate, { sourcePageId }),
        model: env.OPENAI_AGENT_MODEL,
        maxTurns: 20,
        targetPageId: candidate.pageId,
        entitySlug: candidate.slug,
        sourcePageId,
        recommendedAction: candidate.recommendedAction,
        reasons: candidate.reasons,
        suggestedSections: candidate.suggestedSections,
      },
      Actor.agentRuntime,
      {
        priority: Math.max(40, Math.min(95, 40 + candidate.priority)),
        progress: {
          stage: "queued",
          skill: "ae-entity-refresh",
          target_page_id: candidate.pageId,
          entity_slug: candidate.slug,
          trigger_source_page_id: sourcePageId,
          message: `Queued entity refresh for ${candidate.slug}`,
        },
      }
    );

    rows.push({
      pageId: candidate.pageId,
      slug: candidate.slug,
      type: candidate.type,
      title: candidate.title,
      recommendedAction: candidate.recommendedAction,
      priority: candidate.priority,
      queued: true,
      jobId: job.id.toString(),
      reason: "queued",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    trigger: { sourcePageId },
    filters: {
      type: opts.type,
      limit,
    },
    summary: {
      candidates: report.rows.length,
      queued: rows.filter((row) => row.queued).length,
      skipped: rows.filter((row) => !row.queued).length,
    },
    rows,
  };
}

export async function refreshEntityPage(
  identifier: string | number | bigint,
  opts: { dryRun?: boolean; sourceLimit?: number } = {}
): Promise<EntityRefreshReport> {
  const page = await resolveEntityPage(identifier);
  if (!page) {
    throw new Error(`entity not found: ${identifier}`);
  }
  if (!ELIGIBLE_TYPES.includes(page.type as EligibleType)) {
    throw new Error(`entity:refresh only supports entity pages (${ELIGIBLE_TYPES.join(", ")})`);
  }

  const evidence = await loadRefreshEvidence(page.id, opts.sourceLimit ?? 5);
  const reasons: string[] = [];
  if (evidence.sources.length > 0) reasons.push(`${evidence.sources.length} new source pages`);
  if (evidence.facts.length > 0) reasons.push(`${evidence.facts.length} new facts`);
  if (evidence.timeline.length > 0) reasons.push(`${evidence.timeline.length} new timeline entries`);
  if (evidence.signals.length > 0) reasons.push(`${evidence.signals.length} new signals`);

  const preview = buildRefreshAppendBlock(page, evidence);
  const report: EntityRefreshReport = {
    pageId: page.id.toString(),
    slug: page.slug,
    type: page.type,
    title: page.title,
    dryRun: opts.dryRun ?? false,
    applied: false,
    reasons,
    evidence: {
      newSources: evidence.sources.length,
      newFacts: evidence.facts.length,
      newTimelineEntries: evidence.timeline.length,
      newSignals: evidence.signals.length,
    },
    appendedChars: preview.length,
    preview,
  };

  if (reasons.length === 0) {
    return report;
  }
  if (opts.dryRun) {
    return report;
  }

  await stage3AppendNarrative(page.id, preview, Actor.systemJobs, {
    reason: "entity:refresh",
  });
  const review = await reviewStoredPage(page.id);
  await persistPageReview(review, Actor.systemJobs);
  await db.insert(schema.events).values(
    withCreateAudit(
      {
        actor: Actor.systemJobs,
        action: "entity_refresh",
        entityType: "page",
        entityId: page.id,
        payload: {
          reasons,
          evidence: report.evidence,
        },
      },
      Actor.systemJobs
    )
  );

  report.applied = true;
  report.review = {
    status: review.status,
    warnings: review.issues.filter((issue) => issue.severity === "warn").length,
    errors: review.issues.filter((issue) => issue.severity === "error").length,
  };
  return report;
}

export function formatEntityStaleReport(report: EntityStaleReport): string {
  const lines = [
    `Entity stale backlog (${report.rows.length}/${report.summary.totalMatching} shown)`,
    `  filter: type=${report.filters.type ?? "(all entities)"} stale_days=${report.filters.staleDays} limit=${report.filters.limit}`,
    `  summary: refresh_now=${report.summary.refreshNow} monitor=${report.summary.monitor}`,
    "",
  ];
  if (report.rows.length === 0) {
    lines.push("No stale entities.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(
      `  [${row.recommendedAction}] #${row.pageId} ${row.slug} lag=${row.daysBehind}d sources=${row.newSources} facts=${row.newFacts} timeline=${row.newTimelineEntries} signals=${row.newSignals} score=${row.completenessScore.toFixed(2)}`
    );
  }
  return lines.join("\n");
}

export function formatEntityUpdateCandidates(report: EntityUpdateCandidatesReport): string {
  const lines = [
    `Entity update candidates (${report.rows.length}/${report.summary.totalMatching} shown)`,
    `  filter: type=${report.filters.type ?? "(all entities)"} limit=${report.filters.limit}`,
    `  summary: append_update=${report.summary.appendUpdate} llm_refresh=${report.summary.llmRefresh}`,
    "",
  ];
  if (report.rows.length === 0) {
    lines.push("No entity update candidates.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(
      `  [${row.recommendedAction}] p=${row.priority} #${row.pageId} ${row.slug} lag=${row.daysBehind}d`
    );
    lines.push(`    reasons: ${row.reasons.join("; ")}`);
    lines.push(`    sections: ${row.suggestedSections.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatEntityRefreshQueueReport(report: EntityRefreshQueueReport): string {
  const lines = [
    `Entity refresh jobs (${report.rows.length}/${report.summary.candidates} candidates)`,
    `  trigger_source_page_id=${report.trigger.sourcePageId ?? "(none)"} type=${report.filters.type ?? "(all entities)"} limit=${report.filters.limit}`,
    `  summary: queued=${report.summary.queued} skipped=${report.summary.skipped}`,
    "",
  ];
  if (report.rows.length === 0) {
    lines.push("No entity refresh jobs queued.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    lines.push(
      `  [${row.queued ? "queued" : "skipped"}] job=${row.jobId ?? "-"} action=${row.recommendedAction} p=${row.priority} #${row.pageId} ${row.slug} (${row.reason})`
    );
  }
  return lines.join("\n");
}

async function loadEntityRows(type: string | undefined, limit: number): Promise<EntityRow[]> {
  const typeFilter = type && ELIGIBLE_TYPES.includes(type as EligibleType)
    ? sql`AND p.type = ${type}`
    : sql``;
  const rows = (await db.execute(sql`
    WITH entity_pages AS (
      SELECT
        p.id,
        p.slug,
        p.type,
        p.title,
        p.entity_state,
        p.confidence,
        p.completeness_score,
        p.update_time
      FROM pages p
      WHERE p.deleted = 0
        AND p.type IN (${sql.join(ELIGIBLE_TYPES.map((v) => sql`${v}`), sql`, `)})
        AND p.entity_state = 'compiled'
        ${typeFilter}
    ),
    source_evidence AS (
      SELECT
        l.to_page_id AS page_id,
        MAX(src.create_time) AS latest_source_at,
        COUNT(DISTINCT src.id) FILTER (WHERE src.create_time > ep.update_time) AS new_sources
      FROM links l
      JOIN pages src ON src.id = l.from_page_id
      JOIN entity_pages ep ON ep.id = l.to_page_id
      WHERE l.deleted = 0
        AND src.deleted = 0
        AND src.type IN ('source','brief')
        AND (
          l.link_type <> 'mention'
          OR EXISTS (
            SELECT 1 FROM facts f
            WHERE f.deleted = 0
              AND f.entity_page_id = ep.id
              AND f.source_page_id = src.id
          )
          OR EXISTS (
            SELECT 1 FROM timeline_entries te
            WHERE te.deleted = 0
              AND te.entity_page_id = ep.id
              AND te.source_page_id = src.id
          )
          OR EXISTS (
            SELECT 1 FROM signals sig
            WHERE sig.deleted = 0
              AND sig.entity_page_id = ep.id
              AND sig.source_page_id = src.id
          )
        )
      GROUP BY l.to_page_id
    ),
    fact_evidence AS (
      SELECT
        f.entity_page_id AS page_id,
        MAX(f.ingested_at) AS latest_fact_at,
        COUNT(*) FILTER (WHERE f.ingested_at > ep.update_time) AS new_facts
      FROM facts f
      JOIN entity_pages ep ON ep.id = f.entity_page_id
      WHERE f.deleted = 0
      GROUP BY f.entity_page_id
    ),
    timeline_evidence AS (
      SELECT
        te.entity_page_id AS page_id,
        MAX(te.create_time) AS latest_timeline_at,
        COUNT(*) FILTER (WHERE te.create_time > ep.update_time) AS new_timeline_entries
      FROM timeline_entries te
      JOIN entity_pages ep ON ep.id = te.entity_page_id
      WHERE te.deleted = 0
      GROUP BY te.entity_page_id
    ),
    signal_evidence AS (
      SELECT
        s.entity_page_id AS page_id,
        MAX(s.detected_at) AS latest_signal_at,
        COUNT(*) FILTER (WHERE s.detected_at > ep.update_time) AS new_signals
      FROM signals s
      JOIN entity_pages ep ON ep.id = s.entity_page_id
      WHERE s.deleted = 0
      GROUP BY s.entity_page_id
    )
    SELECT
      ep.id::text AS page_id,
      ep.slug,
      ep.type,
      ep.title,
      ep.entity_state,
      ep.confidence,
      COALESCE(ep.completeness_score::text, '0') AS completeness_score,
      ep.update_time,
      GREATEST(
        COALESCE(se.latest_source_at, '-infinity'::timestamptz),
        COALESCE(fe.latest_fact_at, '-infinity'::timestamptz),
        COALESCE(te.latest_timeline_at, '-infinity'::timestamptz),
        COALESCE(sie.latest_signal_at, '-infinity'::timestamptz)
      ) AS latest_evidence_at,
      COALESCE(se.new_sources, 0)::int AS new_sources,
      COALESCE(fe.new_facts, 0)::int AS new_facts,
      COALESCE(te.new_timeline_entries, 0)::int AS new_timeline_entries,
      COALESCE(sie.new_signals, 0)::int AS new_signals
    FROM entity_pages ep
    LEFT JOIN source_evidence se ON se.page_id = ep.id
    LEFT JOIN fact_evidence fe ON fe.page_id = ep.id
    LEFT JOIN timeline_evidence te ON te.page_id = ep.id
    LEFT JOIN signal_evidence sie ON sie.page_id = ep.id
    ORDER BY latest_evidence_at DESC NULLS LAST, ep.update_time ASC
    LIMIT ${limit}
  `)) as Array<{
    page_id: string;
    slug: string;
    type: EligibleType;
    title: string;
    entity_state: string;
    confidence: string | null;
    completeness_score: string;
    update_time: Date | string;
    latest_evidence_at: Date | string | null;
    new_sources: number;
    new_facts: number;
    new_timeline_entries: number;
    new_signals: number;
  }>;

  return rows
    .map((row) => {
      const updatedAtIso =
        row.update_time instanceof Date ? row.update_time.toISOString() : String(row.update_time);
      const latestIso =
        row.latest_evidence_at == null
          ? null
          : row.latest_evidence_at instanceof Date
            ? row.latest_evidence_at.toISOString()
            : String(row.latest_evidence_at);
      const daysBehind = latestIso
        ? Math.max(
            0,
            Math.floor(
              (new Date(latestIso).getTime() - new Date(updatedAtIso).getTime()) / (24 * 3600 * 1000)
            )
          )
        : 0;
      return {
        pageId: row.page_id,
        slug: row.slug,
        type: row.type,
        title: row.title,
        entityState: row.entity_state,
        confidence: row.confidence,
        completenessScore: parseFloat(row.completeness_score),
        updatedAt: updatedAtIso,
        latestEvidenceAt: latestIso,
        daysBehind,
        newSources: row.new_sources,
        newFacts: row.new_facts,
        newTimelineEntries: row.new_timeline_entries,
        newSignals: row.new_signals,
      } satisfies EntityRow;
    })
    .filter((row) => row.latestEvidenceAt !== null);
}

async function resolveEntityPage(identifier: string | number | bigint) {
  const isNumeric =
    typeof identifier === "number" ||
    typeof identifier === "bigint" ||
    /^\d+$/.test(String(identifier));
  const whereExpr = isNumeric
    ? and(eq(schema.pages.id, BigInt(identifier as string | number | bigint)), eq(schema.pages.deleted, 0))
    : and(eq(schema.pages.slug, String(identifier)), eq(schema.pages.deleted, 0));
  const [page] = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      updateTime: schema.pages.updateTime,
    })
    .from(schema.pages)
    .where(whereExpr)
    .limit(1);
  return page ?? null;
}

async function loadRefreshEvidence(pageId: bigint, sourceLimit: number) {
  const [page] = await db
    .select({ updateTime: schema.pages.updateTime, type: schema.pages.type })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);
  if (!page) throw new Error(`page #${pageId} not found`);
  const updateTimeIso = page.updateTime instanceof Date
    ? page.updateTime.toISOString()
    : new Date(String(page.updateTime)).toISOString();

  const sources = await db.execute(sql`
    SELECT DISTINCT ON (src.id)
      src.id::text AS id,
      src.slug,
      src.title,
      src.type,
      src.create_time
    FROM links l
    JOIN pages src ON src.id = l.from_page_id
    WHERE l.deleted = 0
      AND src.deleted = 0
      AND l.to_page_id = ${pageId}
      AND src.type IN ('source','brief')
      AND src.create_time > ${updateTimeIso}::timestamptz
      AND (
        l.link_type <> 'mention'
        OR EXISTS (
          SELECT 1 FROM facts f
          WHERE f.deleted = 0
            AND f.entity_page_id = ${pageId}
            AND f.source_page_id = src.id
        )
        OR EXISTS (
          SELECT 1 FROM timeline_entries te
          WHERE te.deleted = 0
            AND te.entity_page_id = ${pageId}
            AND te.source_page_id = src.id
        )
        OR EXISTS (
          SELECT 1 FROM signals sig
          WHERE sig.deleted = 0
            AND sig.entity_page_id = ${pageId}
            AND sig.source_page_id = src.id
        )
      )
    ORDER BY src.id, src.create_time DESC
    LIMIT ${sourceLimit}
  `) as Array<{ id: string; slug: string; title: string; type: string; create_time: Date | string }>;

  const facts = await db
    .select({
      metric: schema.facts.metric,
      period: schema.facts.period,
      valueNumeric: schema.facts.valueNumeric,
      valueText: schema.facts.valueText,
      unit: schema.facts.unit,
      ingestedAt: schema.facts.ingestedAt,
      sourcePageId: schema.facts.sourcePageId,
    })
    .from(schema.facts)
    .where(and(eq(schema.facts.entityPageId, pageId), eq(schema.facts.deleted, 0), gt(schema.facts.ingestedAt, new Date(updateTimeIso))))
    .limit(10);

  const timeline = await db
    .select({
      eventDate: schema.timelineEntries.eventDate,
      eventType: schema.timelineEntries.eventType,
      summary: schema.timelineEntries.summary,
      sourcePageId: schema.timelineEntries.sourcePageId,
      createTime: schema.timelineEntries.createTime,
    })
    .from(schema.timelineEntries)
    .where(and(eq(schema.timelineEntries.entityPageId, pageId), eq(schema.timelineEntries.deleted, 0), gt(schema.timelineEntries.createTime, new Date(updateTimeIso))))
    .limit(10);

  const signals = await db
    .select({
      signalType: schema.signals.signalType,
      severity: schema.signals.severity,
      title: schema.signals.title,
      detectedAt: schema.signals.detectedAt,
    })
    .from(schema.signals)
    .where(and(eq(schema.signals.entityPageId, pageId), eq(schema.signals.deleted, 0), gt(schema.signals.detectedAt, new Date(updateTimeIso))))
    .limit(10);

  const sourcePageIds = Array.from(
    new Set([
      ...facts.map((row) => row.sourcePageId).filter((v): v is bigint => v !== null),
      ...timeline.map((row) => row.sourcePageId).filter((v): v is bigint => v !== null),
    ])
  );
  const sourceMap = new Map<string, { slug: string; title: string }>();
  if (sourcePageIds.length > 0) {
    const sourcePages = await db
      .select({ id: schema.pages.id, slug: schema.pages.slug, title: schema.pages.title })
      .from(schema.pages)
      .where(inArray(schema.pages.id, sourcePageIds));
    for (const row of sourcePages) {
      sourceMap.set(row.id.toString(), { slug: row.slug, title: row.title });
    }
  }

  return {
    pageType: page.type,
    sources,
    facts: facts.map((row) => ({
      ...row,
      source: row.sourcePageId ? sourceMap.get(row.sourcePageId.toString()) ?? null : null,
    })),
    timeline: timeline.map((row) => ({
      ...row,
      source: row.sourcePageId ? sourceMap.get(row.sourcePageId.toString()) ?? null : null,
    })),
    signals,
  };
}

export function buildRefreshAppendBlock(
  page: { slug: string; type: string; title: string },
  evidence: Awaited<ReturnType<typeof loadRefreshEvidence>>
): string {
  const lines: string[] = [];
  lines.push(`Entity refresh for [[${page.slug}|${page.title}]].`);
  lines.push("");
  lines.push("#### Why this refresh");
  if (evidence.sources.length === 0 && evidence.facts.length === 0 && evidence.timeline.length === 0 && evidence.signals.length === 0) {
    lines.push("- No new structured evidence found since the last page update.");
  } else {
    if (evidence.sources.length > 0) lines.push(`- New high-value source coverage: ${evidence.sources.length} linked source pages`);
    if (evidence.facts.length > 0) lines.push(`- New structured facts: ${evidence.facts.length}`);
    if (evidence.timeline.length > 0) lines.push(`- New timeline events: ${evidence.timeline.length}`);
    if (evidence.signals.length > 0) lines.push(`- New signals: ${evidence.signals.length}`);
  }

  if (evidence.sources.length > 0) {
    lines.push("");
    lines.push("#### New Sources");
    for (const src of evidence.sources) {
      lines.push(`- [[${src.slug}|${src.title}]] (${src.type}, ${formatDate(src.create_time)})`);
    }
  }

  if (evidence.facts.length > 0) {
    lines.push("");
    lines.push("#### New Facts");
    for (const fact of evidence.facts) {
      const value =
        fact.valueNumeric != null
          ? `${String(fact.valueNumeric)}${fact.unit ? ` ${fact.unit}` : ""}`
          : `${fact.valueText ?? "(text)"}${fact.unit ? ` ${fact.unit}` : ""}`;
      const suffix = fact.source ? ` via [[${fact.source.slug}|${fact.source.title}]]` : "";
      lines.push(`- ${fact.metric}${fact.period ? ` (${fact.period})` : ""}: ${value}${suffix}`);
    }
  }

  if (evidence.timeline.length > 0) {
    lines.push("");
    lines.push("#### New Timeline Signals");
    for (const item of evidence.timeline) {
      const suffix = item.source ? ` ([[${item.source.slug}|${item.source.title}]])` : "";
      lines.push(`- ${item.eventDate} [${item.eventType}] ${item.summary}${suffix}`);
    }
  }

  if (evidence.signals.length > 0) {
    lines.push("");
    lines.push("#### New System Signals");
    for (const signal of evidence.signals) {
      lines.push(`- ${formatDate(signal.detectedAt)} [${signal.severity}] ${signal.signalType}: ${signal.title}`);
    }
  }

  lines.push("");
  lines.push("#### Recommended page follow-up");
  lines.push(`- Revisit the core sections of [[${page.slug}|${page.title}]] if the new evidence materially changes the current assessment.`);
  return lines.join("\n");
}

export function inferSuggestedSections(type: EligibleType, row: EntityRow): string[] {
  if (type === "company") {
    const sections = new Set<string>(["Sources"]);
    if (row.newFacts > 0) sections.add("Financial Summary");
    if (row.newTimelineEntries > 0) sections.add("Key Timeline");
    if (row.newSignals > 0) {
      sections.add("Risk Factors");
      sections.add("Catalysts");
    }
    if (row.newSources > 0 && row.newFacts === 0 && row.newSignals === 0) {
      sections.add("Company Overview");
    }
    return [...sections];
  }
  if (type === "industry") {
    const sections = new Set<string>(["Sources"]);
    if (row.newFacts > 0) sections.add("Market Size And Growth");
    if (row.newTimelineEntries > 0 || row.newSignals > 0) sections.add("Key Trends");
    if (row.newSources > 0) sections.add("Competitive Landscape");
    return [...sections];
  }
  if (type === "concept") {
    const sections = new Set<string>(["Sources"]);
    if (row.newFacts > 0 || row.newTimelineEntries > 0) sections.add("Use In Investment Research");
    if (row.newSources > 0) sections.add("Definition");
    return [...sections];
  }
  const sections = new Set<string>(["Sources", "Thesis Evolution"]);
  if (row.newSignals > 0) sections.add("Validation / Falsification Conditions");
  if (row.newTimelineEntries > 0) sections.add("Catalyst Timeline");
  return [...sections];
}

async function hasInFlightEntityRefreshJob(pageId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.minionJobs.id })
    .from(schema.minionJobs)
    .where(
      and(
        eq(schema.minionJobs.deleted, 0),
        sql`${schema.minionJobs.status} IN ('waiting', 'active', 'paused')`,
        sql`(
          (
            ${schema.minionJobs.name} = 'entity-refresh'
            AND ${schema.minionJobs.data}->>'targetPageId' = ${pageId}
          )
          OR
          (
            ${schema.minionJobs.name} = 'agent_run'
            AND ${schema.minionJobs.data}->>'skill' = 'ae-entity-refresh'
            AND ${schema.minionJobs.data}->>'targetPageId' = ${pageId}
          )
        )`
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function getEntityRefreshSkipReason(pageId: string): Promise<string | null> {
  const [page] = await db
    .select({
      type: schema.pages.type,
      entityState: schema.pages.entityState,
      confidence: schema.pages.confidence,
      displayName: schema.pages.displayName,
      content: schema.pages.content,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, BigInt(pageId)), eq(schema.pages.deleted, 0)))
    .limit(1);
  if (!page) return "page-not-found";

  if (await hasInFlightEnrichJob(pageId)) return "enrich-in-flight";
  if (isEntityStateAwaitingEnrich(page.entityState)) {
    return `needs-enrich-entity-state-${page.entityState}`;
  }
  if ((page.content ?? "").trim().length < MIN_REFRESHABLE_CONTENT_CHARS) {
    return "needs-enrich-short-content";
  }
  if (requiresDisplayName(page.type) && !page.displayName) {
    return "needs-enrich-display-name";
  }
  return null;
}

async function hasInFlightEnrichJob(pageId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.minionJobs.id })
    .from(schema.minionJobs)
    .where(
      and(
        eq(schema.minionJobs.deleted, 0),
        sql`${schema.minionJobs.status} IN ('waiting', 'active', 'paused')`,
        sql`(
          (
            ${schema.minionJobs.name} = 'enrich_entity'
            AND ${schema.minionJobs.data}->>'pageId' = ${pageId}
          )
          OR
          (
            ${schema.minionJobs.name} = 'agent_run'
            AND ${schema.minionJobs.data}->>'skill' = 'ae-enrich'
            AND ${schema.minionJobs.data}->>'targetPageId' = ${pageId}
          )
        )`
      )
    )
    .limit(1);
  return rows.length > 0;
}

function requiresDisplayName(type: string): boolean {
  return type === "company" || type === "industry" || type === "concept";
}

function buildEntityRefreshJobPrompt(
  row: EntityUpdateCandidateRow,
  opts: { sourcePageId: string | null }
): string {
  return [
    `Run an entity refresh for [[${row.slug}|${row.title}]] (#${row.pageId}).`,
    `Entity type=${row.type}, state=${row.entityState}, confidence=${row.confidence ?? "unknown"}, completeness=${row.completenessScore.toFixed(2)}.`,
    `Trigger source page id=${opts.sourcePageId ?? "unknown"}; recommended_action=${row.recommendedAction}.`,
    `Evidence counts since the compiled page update: sources=${row.newSources}, facts=${row.newFacts}, timeline=${row.newTimelineEntries}, signals=${row.newSignals}, lag_days=${row.daysBehind}.`,
    `Reasons: ${row.reasons.join("; ") || "new structured evidence"}.`,
    `Suggested sections to inspect/update: ${row.suggestedSections.join(", ") || "Sources"}.`,
    "",
    "Use the ae-entity-refresh workflow for exactly this page.",
    "Do not move to another entity. Do not overwrite the existing page.",
    "Read the existing page, inspect the refresh preview/new evidence, read the relevant source pages, then append a concise source-backed delta with enrich_save(append=true).",
    "If the evidence changes conviction, risk, catalysts, financial summary, market structure, or thesis conditions, still handle it automatically with the LLM workflow; do not defer to a manual rewrite.",
  ].join("\n");
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}
