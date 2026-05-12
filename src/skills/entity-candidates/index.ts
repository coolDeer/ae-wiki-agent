import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { Actor, withAudit, withCreateAudit } from "~/core/audit.ts";
import { slugToTitle } from "../ingest/_helpers.ts";
import type { EntityCandidateStatus } from "~/core/schema/entity-candidates.ts";
import type { PageType } from "~/core/schema/pages.ts";

export interface EntityCandidateSuggestion {
  slug: string;
  type: string;
  title: string;
  similarity: number;
}

export interface UpsertEntityCandidateOptions {
  sourceId?: string;
  proposedSlug: string;
  proposedType: PageType;
  displayName?: string | null;
  aliases?: string[];
  sourcePageId: bigint;
  suggestions?: EntityCandidateSuggestion[];
  actor: string;
  initialStatus?: Extract<EntityCandidateStatus, "pending" | "rejected">;
  rejectReason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EntityCandidateRow {
  id: string;
  sourceId: string;
  proposedSlug: string;
  proposedType: string;
  displayName: string | null;
  aliases: string[];
  status: EntityCandidateStatus;
  evidenceCount: number;
  sourcePageIds: string[];
  lastSourcePageId: string | null;
  suggestions: EntityCandidateSuggestion[];
  promotedPageId: string | null;
  mergedIntoPageId: string | null;
  rejectReason: string | null;
  resolvedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createTime: string;
  updateTime: string;
}

export interface EntityCandidatesReport {
  filters: {
    status?: EntityCandidateStatus;
    type?: string;
    limit: number;
  };
  totalMatching: number;
  rows: EntityCandidateRow[];
}

export interface CandidateActionResult {
  action: "promote" | "merge" | "reject";
  dryRun: boolean;
  candidate: EntityCandidateRow;
  pageId?: string;
  targetPageId?: string;
  linksWritten?: number;
}

const ENTITY_TYPES = new Set(["company", "industry", "concept"]);
const STATUSES = new Set(["pending", "promoted", "merged", "rejected"]);

export function normalizeCandidateAliases(
  proposedSlug: string,
  displayName: string | null | undefined,
  aliases: string[] | undefined
): string[] {
  const namePart = proposedSlug.split("/").slice(1).join("/").trim();
  const out: string[] = [];
  for (const raw of [namePart, displayName ?? "", ...(aliases ?? [])]) {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (out.some((x) => x.toLowerCase() === value.toLowerCase())) continue;
    out.push(value);
  }
  return out.slice(0, 20);
}

export function autoRejectReasonForCandidate(slug: string): string | null {
  const name = slug.split("/").slice(1).join("/").toLowerCase();
  const normalized = name.replace(/[_\s]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) return "empty-name";
  if (/^(unknown|unnamed|various|multiple|several|others?|misc)(-|$)/.test(normalized)) {
    return "generic-placeholder";
  }
  if (/^(domestic|overseas|leading|major|top|key|selected)-/.test(normalized)) {
    return "generic-descriptor";
  }
  if (/(^|-)unknown(-|$)/.test(normalized)) return "generic-placeholder";
  if (/^(company|supplier|vendor|customer|partner|competitor)s?(-|$)/.test(normalized)) {
    return "generic-role";
  }
  return null;
}

export async function upsertEntityCandidate(
  opts: UpsertEntityCandidateOptions
): Promise<EntityCandidateRow> {
  const sourceId = opts.sourceId ?? "default";
  const initialStatus = opts.initialStatus ?? "pending";
  const displayName = opts.displayName?.trim() || null;
  const aliases = normalizeCandidateAliases(opts.proposedSlug, displayName, opts.aliases);
  const aliasesJson = JSON.stringify(aliases);
  const suggestionsJson = JSON.stringify(opts.suggestions ?? []);
  const metadataJson = JSON.stringify(opts.metadata ?? {});
  const rejectReason = opts.rejectReason ?? null;

  const rows = await db.execute(drizzleSql`
    INSERT INTO entity_candidates (
      source_id,
      proposed_slug,
      proposed_type,
      display_name,
      aliases,
      status,
      evidence_count,
      source_page_ids,
      last_source_page_id,
      suggestions,
      reject_reason,
      resolved_at,
      metadata,
      create_by,
      update_by
    )
    VALUES (
      ${sourceId},
      ${opts.proposedSlug},
      ${opts.proposedType},
      ${displayName},
      ARRAY(SELECT jsonb_array_elements_text(${aliasesJson}::jsonb)),
      ${initialStatus},
      1,
      ARRAY[${opts.sourcePageId}]::bigint[],
      ${opts.sourcePageId},
      ${suggestionsJson}::jsonb,
      ${rejectReason},
      CASE WHEN ${initialStatus} = 'rejected' THEN NOW() ELSE NULL END,
      ${metadataJson}::jsonb,
      ${opts.actor},
      ${opts.actor}
    )
    ON CONFLICT (source_id, proposed_slug) WHERE deleted = 0 DO UPDATE SET
      proposed_type = EXCLUDED.proposed_type,
      display_name = COALESCE(entity_candidates.display_name, EXCLUDED.display_name),
      aliases = (
        SELECT ARRAY(
          SELECT DISTINCT a
          FROM unnest(COALESCE(entity_candidates.aliases, ARRAY[]::text[]) || COALESCE(EXCLUDED.aliases, ARRAY[]::text[])) AS a
          WHERE a <> ''
          ORDER BY a
        )
      ),
      status = CASE
        WHEN entity_candidates.status IN ('promoted', 'merged', 'rejected') THEN entity_candidates.status
        WHEN EXCLUDED.status = 'rejected' THEN 'rejected'
        ELSE entity_candidates.status
      END,
      source_page_ids = (
        SELECT ARRAY(
          SELECT DISTINCT p
          FROM unnest(entity_candidates.source_page_ids || EXCLUDED.source_page_ids) AS p
          ORDER BY p
        )
      ),
      evidence_count = cardinality((
        SELECT ARRAY(
          SELECT DISTINCT p
          FROM unnest(entity_candidates.source_page_ids || EXCLUDED.source_page_ids) AS p
        )
      )),
      last_source_page_id = EXCLUDED.last_source_page_id,
      suggestions = EXCLUDED.suggestions,
      reject_reason = COALESCE(entity_candidates.reject_reason, EXCLUDED.reject_reason),
      resolved_at = CASE
        WHEN entity_candidates.resolved_at IS NULL AND EXCLUDED.status = 'rejected' THEN NOW()
        ELSE entity_candidates.resolved_at
      END,
      metadata = entity_candidates.metadata || EXCLUDED.metadata,
      last_seen_at = NOW(),
      update_by = ${opts.actor},
      update_time = NOW()
    RETURNING
      id::text,
      source_id,
      proposed_slug,
      proposed_type,
      display_name,
      COALESCE(aliases, ARRAY[]::text[]) AS aliases,
      status,
      evidence_count,
      source_page_ids::text[] AS source_page_ids,
      last_source_page_id::text,
      suggestions,
      promoted_page_id::text,
      merged_into_page_id::text,
      reject_reason,
      resolved_at,
      first_seen_at,
      last_seen_at,
      create_time,
      update_time
  `);
  return mapCandidateRow((rows as unknown as RawCandidateRow[])[0]!);
}

export async function listEntityCandidates(opts: {
  status?: string;
  type?: string;
  limit?: number;
} = {}): Promise<EntityCandidatesReport> {
  const limit = clampLimit(opts.limit ?? 30);
  const status = normalizeStatus(opts.status);
  const type = opts.type && ENTITY_TYPES.has(opts.type) ? opts.type : undefined;
  const statusClause = status ? drizzleSql`AND status = ${status}` : drizzleSql``;
  const typeClause = type ? drizzleSql`AND proposed_type = ${type}` : drizzleSql``;

  const countRows = await db.execute(drizzleSql`
    SELECT COUNT(*)::int AS n
    FROM entity_candidates
    WHERE deleted = 0
      ${statusClause}
      ${typeClause}
  `);
  const totalMatching = Number((countRows as unknown as Array<{ n: number }>)[0]?.n ?? 0);

  const rows = await db.execute(drizzleSql`
    SELECT
      id::text,
      source_id,
      proposed_slug,
      proposed_type,
      display_name,
      COALESCE(aliases, ARRAY[]::text[]) AS aliases,
      status,
      evidence_count,
      source_page_ids::text[] AS source_page_ids,
      last_source_page_id::text,
      suggestions,
      promoted_page_id::text,
      merged_into_page_id::text,
      reject_reason,
      resolved_at,
      first_seen_at,
      last_seen_at,
      create_time,
      update_time
    FROM entity_candidates
    WHERE deleted = 0
      ${statusClause}
      ${typeClause}
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'rejected' THEN 1
        WHEN 'merged' THEN 2
        ELSE 3
      END,
      evidence_count DESC,
      last_seen_at DESC,
      id DESC
    LIMIT ${limit}
  `);

  return {
    filters: { status, type, limit },
    totalMatching,
    rows: (rows as unknown as RawCandidateRow[]).map(mapCandidateRow),
  };
}

export async function promoteEntityCandidate(
  ident: string,
  opts: { actor?: string; dryRun?: boolean } = {}
): Promise<CandidateActionResult> {
  const actor = opts.actor ?? Actor.agentClaude;
  const candidate = await loadCandidate(ident);
  if (!candidate) throw new Error(`entity candidate not found: ${ident}`);
  if (candidate.status !== "pending") {
    throw new Error(`candidate status is ${candidate.status}, expected pending`);
  }
  if (opts.dryRun) {
    return { action: "promote", dryRun: true, candidate };
  }

  const pageId = await ensureCandidatePage(candidate, actor);
  const linksWritten = await linkCandidateSources(candidate, pageId, actor);
  await db
    .update(schema.entityCandidates)
    .set(
      withAudit(
        {
          status: "promoted",
          promotedPageId: pageId,
          resolvedAt: new Date(),
        },
        actor
      )
    )
    .where(eq(schema.entityCandidates.id, BigInt(candidate.id)));
  await logCandidateEvent("entity_candidate_promoted", candidate, actor, {
    promotedPageId: pageId.toString(),
    linksWritten,
  });
  return {
    action: "promote",
    dryRun: false,
    candidate,
    pageId: pageId.toString(),
    linksWritten,
  };
}

export async function rejectEntityCandidate(
  ident: string,
  opts: { reason: string; actor?: string; dryRun?: boolean }
): Promise<CandidateActionResult> {
  const actor = opts.actor ?? Actor.agentClaude;
  const candidate = await loadCandidate(ident);
  if (!candidate) throw new Error(`entity candidate not found: ${ident}`);
  if (candidate.status !== "pending" && candidate.status !== "rejected") {
    throw new Error(`candidate status is ${candidate.status}, cannot reject`);
  }
  if (opts.dryRun) {
    return { action: "reject", dryRun: true, candidate };
  }
  await db
    .update(schema.entityCandidates)
    .set(
      withAudit(
        {
          status: "rejected",
          rejectReason: opts.reason,
          resolvedAt: new Date(),
        },
        actor
      )
    )
    .where(eq(schema.entityCandidates.id, BigInt(candidate.id)));
  await logCandidateEvent("entity_candidate_rejected", candidate, actor, {
    reason: opts.reason,
  });
  return { action: "reject", dryRun: false, candidate };
}

export async function mergeEntityCandidate(
  ident: string,
  targetIdent: string,
  opts: { actor?: string; dryRun?: boolean } = {}
): Promise<CandidateActionResult> {
  const actor = opts.actor ?? Actor.agentClaude;
  const candidate = await loadCandidate(ident);
  if (!candidate) throw new Error(`entity candidate not found: ${ident}`);
  if (candidate.status !== "pending") {
    throw new Error(`candidate status is ${candidate.status}, expected pending`);
  }
  const target = await loadPage(targetIdent);
  if (!target) throw new Error(`target page not found: ${targetIdent}`);
  if (target.type !== candidate.proposedType) {
    throw new Error(
      `target type ${target.type} does not match candidate type ${candidate.proposedType}`
    );
  }
  if (opts.dryRun) {
    return {
      action: "merge",
      dryRun: true,
      candidate,
      targetPageId: target.id.toString(),
    };
  }

  const mergedAliases = mergeAliases(target.aliases ?? [], [
    candidate.displayName ?? "",
    ...candidate.aliases,
  ]);
  await db
    .update(schema.pages)
    .set(withAudit({ aliases: mergedAliases }, actor))
    .where(eq(schema.pages.id, target.id));
  const linksWritten = await linkCandidateSources(candidate, target.id, actor);
  await db
    .update(schema.entityCandidates)
    .set(
      withAudit(
        {
          status: "merged",
          mergedIntoPageId: target.id,
          resolvedAt: new Date(),
        },
        actor
      )
    )
    .where(eq(schema.entityCandidates.id, BigInt(candidate.id)));
  await logCandidateEvent("entity_candidate_merged", candidate, actor, {
    mergedIntoPageId: target.id.toString(),
    linksWritten,
  });
  return {
    action: "merge",
    dryRun: false,
    candidate,
    targetPageId: target.id.toString(),
    linksWritten,
  };
}

export function formatEntityCandidates(report: EntityCandidatesReport): string {
  const lines: string[] = [];
  lines.push(
    `Entity candidates (${report.rows.length}/${report.totalMatching} shown; status=${report.filters.status ?? "all"}, type=${report.filters.type ?? "all"})`
  );
  if (report.rows.length === 0) {
    lines.push("No candidates found.");
    return lines.join("\n");
  }
  for (const row of report.rows) {
    const target =
      row.status === "promoted"
        ? ` -> page #${row.promotedPageId}`
        : row.status === "merged"
          ? ` -> merged #${row.mergedIntoPageId}`
          : row.status === "rejected"
            ? ` -> rejected: ${row.rejectReason ?? "no reason"}`
            : "";
    lines.push(
      `#${row.id} ${row.proposedSlug} (${row.proposedType}, ${row.status}, evidence=${row.evidenceCount})${target}`
    );
    if (row.suggestions[0]) {
      lines.push(
        `  closest=${row.suggestions[0].slug} sim=${row.suggestions[0].similarity.toFixed(2)}`
      );
    }
    lines.push(
      `  commands: entity:candidate:promote ${row.id} | entity:candidate:merge ${row.id} --target <slug|id> | entity:candidate:reject ${row.id} --reason "..."`
    );
  }
  return lines.join("\n");
}

interface RawCandidateRow {
  id: string;
  source_id: string;
  proposed_slug: string;
  proposed_type: string;
  display_name: string | null;
  aliases: string[] | null;
  status: EntityCandidateStatus;
  evidence_count: number;
  source_page_ids: string[] | null;
  last_source_page_id: string | null;
  suggestions: EntityCandidateSuggestion[] | null;
  promoted_page_id: string | null;
  merged_into_page_id: string | null;
  reject_reason: string | null;
  resolved_at: Date | string | null;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
  create_time: Date | string;
  update_time: Date | string;
}

function mapCandidateRow(row: RawCandidateRow): EntityCandidateRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    proposedSlug: row.proposed_slug,
    proposedType: row.proposed_type,
    displayName: row.display_name,
    aliases: row.aliases ?? [],
    status: row.status,
    evidenceCount: Number(row.evidence_count),
    sourcePageIds: row.source_page_ids ?? [],
    lastSourcePageId: row.last_source_page_id,
    suggestions: row.suggestions ?? [],
    promotedPageId: row.promoted_page_id,
    mergedIntoPageId: row.merged_into_page_id,
    rejectReason: row.reject_reason,
    resolvedAt: toIso(row.resolved_at),
    firstSeenAt: toIso(row.first_seen_at)!,
    lastSeenAt: toIso(row.last_seen_at)!,
    createTime: toIso(row.create_time)!,
    updateTime: toIso(row.update_time)!,
  };
}

async function loadCandidate(ident: string): Promise<EntityCandidateRow | null> {
  const isId = /^\d+$/.test(ident);
  const rows = await db.execute(drizzleSql`
    SELECT
      id::text,
      source_id,
      proposed_slug,
      proposed_type,
      display_name,
      COALESCE(aliases, ARRAY[]::text[]) AS aliases,
      status,
      evidence_count,
      source_page_ids::text[] AS source_page_ids,
      last_source_page_id::text,
      suggestions,
      promoted_page_id::text,
      merged_into_page_id::text,
      reject_reason,
      resolved_at,
      first_seen_at,
      last_seen_at,
      create_time,
      update_time
    FROM entity_candidates
    WHERE deleted = 0
      AND ${isId ? drizzleSql`id = ${BigInt(ident)}` : drizzleSql`proposed_slug = ${ident}`}
    LIMIT 1
  `);
  const row = (rows as unknown as RawCandidateRow[])[0];
  return row ? mapCandidateRow(row) : null;
}

async function loadPage(ident: string): Promise<{
  id: bigint;
  slug: string;
  type: string;
  entityState: string;
  aliases: string[] | null;
} | null> {
  const isId = /^\d+$/.test(ident);
  const rows = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      entityState: schema.pages.entityState,
      aliases: schema.pages.aliases,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.deleted, 0),
        isId ? eq(schema.pages.id, BigInt(ident)) : eq(schema.pages.slug, ident)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function ensureCandidatePage(candidate: EntityCandidateRow, actor: string): Promise<bigint> {
  const existing = await loadPage(candidate.proposedSlug);
  if (existing) {
    if (existing.entityState === "stub") {
      await db
        .update(schema.pages)
        .set(withAudit({ entityState: "candidate_promoted" }, actor))
        .where(eq(schema.pages.id, existing.id));
    }
    return existing.id;
  }
  const [created] = await db
    .insert(schema.pages)
    .values(
      withCreateAudit(
        {
          sourceId: candidate.sourceId,
          slug: candidate.proposedSlug,
          type: candidate.proposedType,
          title: candidate.displayName ?? slugToTitle(candidate.proposedSlug),
          displayName: candidate.displayName,
          status: "active",
          entityState: "candidate_promoted",
          aliases: candidate.aliases.length > 0 ? candidate.aliases : undefined,
        },
        actor
      )
    )
    .onConflictDoNothing({
      target: [schema.pages.sourceId, schema.pages.slug],
      where: drizzleSql`deleted = 0`,
    })
    .returning({ id: schema.pages.id });
  if (created) return created.id;
  const after = await loadPage(candidate.proposedSlug);
  if (!after) throw new Error(`failed to create page for ${candidate.proposedSlug}`);
  return after.id;
}

async function linkCandidateSources(
  candidate: EntityCandidateRow,
  targetPageId: bigint,
  actor: string
): Promise<number> {
  let linksWritten = 0;
  for (const sourcePageIdStr of candidate.sourcePageIds) {
    const sourcePageId = BigInt(sourcePageIdStr);
    if (sourcePageId === targetPageId) continue;
    const inserted = await db
      .insert(schema.links)
      .values(
        withCreateAudit(
          {
            fromPageId: sourcePageId,
            toPageId: targetPageId,
            linkType: "mention",
            linkSource: "extracted",
            originPageId: sourcePageId,
            originField: "entity_candidate",
            context: `Resolved candidate ${candidate.proposedSlug}`,
            weight: "0.7",
          },
          actor
        )
      )
      .onConflictDoNothing()
      .returning({ id: schema.links.id });
    linksWritten += inserted.length;
  }
  return linksWritten;
}

async function logCandidateEvent(
  action: string,
  candidate: EntityCandidateRow,
  actor: string,
  extra: Record<string, unknown>
): Promise<void> {
  await db.insert(schema.events).values(
    withCreateAudit(
      {
        actor,
        action,
        entityType: "entity_candidate",
        entityId: BigInt(candidate.id),
        payload: {
          proposedSlug: candidate.proposedSlug,
          proposedType: candidate.proposedType,
          ...extra,
        },
      },
      actor
    )
  );
}

function normalizeStatus(status: string | undefined): EntityCandidateStatus | undefined {
  if (!status) return undefined;
  if (!STATUSES.has(status)) {
    throw new Error(`invalid candidate status: ${status}`);
  }
  return status as EntityCandidateStatus;
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 30;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

function mergeAliases(existing: string[], incoming: string[]): string[] {
  const out: string[] = [];
  for (const raw of [...existing, ...incoming]) {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (out.some((x) => x.toLowerCase() === value.toLowerCase())) continue;
    out.push(value);
  }
  return out;
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : String(value);
}
