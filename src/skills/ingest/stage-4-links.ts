/**
 * Stage 4: 实体识别 + 链接抽取
 *
 * 从 narrative / frontmatter / facts_block / timeline 收集实体，再把 link 写入图。
 * 解析规则由 `extractors/links/source-default.yaml` 驱动。
 */

import { eq, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import { matchLinkSpec } from "~/core/extractors/match-spec.ts";
import {
  harvestLinkRefs,
  type HarvestedLinkOccurrence,
} from "~/core/extractors/links.ts";
import {
  isStrongLinkOccurrenceSet,
  linkWeightForOccurrences,
} from "~/core/links/policy.ts";
import {
  maybeEnqueueEnrichForBacklinkGrowth,
  resolveOrCreatePage,
  slugToType,
} from "./_helpers.ts";
import {
  autoRejectReasonForCandidate,
  upsertEntityCandidate,
  type EntityCandidateSuggestion,
} from "../entity-candidates/index.ts";
import type { IngestContext } from "~/core/types.ts";
import type { PageType } from "~/core/schema/pages.ts";

export const VALID_LINK_TYPES = new Set([
  "mention",
  "confirms",
  "contradicts",
  "supersedes",
  "cites",
  "critiques",
  "derives_from",
  "tracks",
]);

const CANDIDATE_ENTITY_TYPES: ReadonlySet<PageType> = new Set([
  "company",
  "industry",
  "concept",
]);

export interface UnresolvedWikilink {
  slug: string;
  inferredType: PageType;
  suggestions: Array<{
    slug: string;
    type: string;
    title: string;
    similarity: number;
  }>;
}

export interface Stage4Result {
  refsExtracted: number;
  entitiesCreated: number;
  linksWritten: number;
  unresolved: UnresolvedWikilink[];
}

export function candidateAliasFromLinkLabel(label: string | undefined): string | null {
  if (!label) return null;
  const stripped = label.replace(/^([a-z_]+)\s*:\s*/, "").replace(/\s+/g, " ").trim();
  if (!stripped) return null;
  if (!/[\u3400-\u9fff]/.test(stripped)) return null;
  if (stripped.length > 40) return null;
  if (/[\[\]]/.test(stripped)) return null;
  if (/[\/／、,，;&；]|(?:\s+and\s+)|(?:\s+or\s+)/i.test(stripped)) return null;
  return stripped;
}

export async function stage4Links(ctx: IngestContext): Promise<Stage4Result> {
  const [page] = await db
    .select({
      content: schema.pages.content,
      sourceId: schema.pages.sourceId,
      slug: schema.pages.slug,
      type: schema.pages.type,
      frontmatter: schema.pages.frontmatter,
      timeline: schema.pages.timeline,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, ctx.pageId))
    .limit(1);
  if (!page) {
    return { refsExtracted: 0, entitiesCreated: 0, linksWritten: 0, unresolved: [] };
  }

  const linkSpec = matchLinkSpec(page.type);
  const refsMap = harvestLinkRefs(
    {
      content: page.content,
      frontmatter: (page.frontmatter as Record<string, unknown>) ?? {},
      timeline: page.timeline,
    },
    linkSpec
  );
  console.log(`  [stage4] 抽到 ${refsMap.size} 个唯一引用`);

  const beforeCount = await countActivePages();
  let linksWritten = 0;
  const unresolved: UnresolvedWikilink[] = [];

  for (const [slug, ref] of refsMap) {
    if (slug === page.slug) continue;
    const inferredType = slugToType(slug);
    if (!inferredType) continue;

    let targetId: bigint | null = null;
    targetId = await resolveOrCreatePage(slug, {
      actor: ctx.actor,
      autoCreate: false,
      initialAliases: ref.aliases,
    });

    const autoRejectReason = targetId ? null : autoRejectReasonForCandidate(slug);
    const canAutoCreate =
      !targetId &&
      canAutoCreateMissingRef(inferredType, ref, autoRejectReason);

    if (!targetId && canAutoCreate) {
      targetId = await resolveOrCreatePage(slug, {
        actor: ctx.actor,
        autoCreate: true,
        sourcePageId: ctx.pageId,
        initialAliases: ref.aliases,
      });
    }

    if (!targetId) {
      const suggestions = await fetchSuggestions(slug, inferredType);
      const candidate =
        CANDIDATE_ENTITY_TYPES.has(inferredType)
          ? await upsertEntityCandidate({
              sourceId: page.sourceId,
              proposedSlug: slug,
              proposedType: inferredType,
              displayName: candidateDisplayName(slug, ref),
              aliases: ref.aliases,
              sourcePageId: ctx.pageId,
              suggestions,
              actor: ctx.actor,
              initialStatus: autoRejectReason ? "rejected" : "pending",
              rejectReason: autoRejectReason,
              metadata: {
                stage: "ingest.stage4",
                pageSlug: page.slug,
                occurrenceSources: summarizeOccurrences(ref.occurrences),
                autoCreatePolicy: autoCreatePolicyForMissingRef(
                  inferredType,
                  ref,
                  autoRejectReason
                ),
              },
            })
          : null;
      await logUnresolvedWikilink({
        slug,
        inferredType,
        suggestions,
        fromPageId: ctx.pageId,
        actor: ctx.actor,
        candidateId: candidate?.id,
        candidateStatus: candidate?.status,
        rejectReason: autoRejectReason,
      });
      unresolved.push({ slug, inferredType, suggestions });
      continue;
    }
    if (!targetId) continue;

    const occByKey = groupOccurrencesByLinkKey(ref.occurrences);
    let firstStrongWrite = true;
    for (const [key, occs] of occByKey) {
      const [linkType, linkSource, originField] = splitLinkKey(key);
      const safeType = VALID_LINK_TYPES.has(linkType) ? linkType : "mention";
      const ctxText = buildContext(page.content, occs[0]);
      const linkWeight = linkWeightForOccurrences(occs);
      const isStrongLink = isStrongLinkOccurrenceSet(occs);
      const inserted = await db
        .insert(schema.links)
        .values(
          withCreateAudit(
            {
              fromPageId: ctx.pageId,
              toPageId: targetId,
              linkType: safeType,
              context: ctxText,
              linkSource,
              originPageId: ctx.pageId,
              originField: originField ?? null,
              weight: linkWeight.toFixed(2),
            },
            ctx.actor
          )
        )
        .onConflictDoNothing()
        .returning({ id: schema.links.id });
      if (inserted.length > 0) {
        linksWritten++;
        if (isStrongLink && firstStrongWrite) {
          await maybeEnqueueEnrichForBacklinkGrowth({
            pageId: targetId,
            slug,
            sourcePageId: ctx.pageId,
            actor: ctx.actor,
          });
          firstStrongWrite = false;
        }
      }
    }
  }

  const afterCount = await countActivePages();
  const createdEntities = Math.max(0, afterCount - beforeCount);
  console.log(
    `  [stage4] entities created=${createdEntities}, links written=${linksWritten}` +
      (unresolved.length > 0 ? `, unresolved=${unresolved.length} (logged to events)` : "")
  );

  return {
    refsExtracted: refsMap.size,
    entitiesCreated: createdEntities,
    linksWritten,
    unresolved,
  };
}

function groupOccurrencesByLinkKey(
  occurrences: HarvestedLinkOccurrence[]
): Map<string, HarvestedLinkOccurrence[]> {
  const grouped = new Map<string, HarvestedLinkOccurrence[]>();
  for (const occ of occurrences) {
    const key = buildLinkKey(occ.linkType, occ.source, occ.originField);
    const arr = grouped.get(key) ?? [];
    arr.push(occ);
    grouped.set(key, arr);
  }
  return grouped;
}

function buildLinkKey(
  linkType: string,
  source: HarvestedLinkOccurrence["source"],
  originField: string | null
): string {
  return `${linkType}|${source}|${originField ?? ""}`;
}

function splitLinkKey(
  key: string
): [string, "markdown" | "frontmatter" | "extracted", string | null] {
  const [linkType, source, originField] = key.split("|");
  return [
    linkType || "mention",
    (source as "markdown" | "frontmatter" | "extracted") || "extracted",
    originField || null,
  ];
}

export function canAutoCreateMissingRef(
  inferredType: PageType,
  ref: { occurrences: HarvestedLinkOccurrence[] },
  autoRejectReason: string | null = null
): boolean {
  return (
    inferredType === "company" &&
    !autoRejectReason &&
    shouldAutoCreateMissingRef(ref)
  );
}

function autoCreatePolicyForMissingRef(
  inferredType: PageType,
  ref: { occurrences: HarvestedLinkOccurrence[] },
  autoRejectReason: string | null
): string {
  if (autoRejectReason) return "auto-rejected";
  if (inferredType === "company") {
    return shouldAutoCreateMissingRef(ref)
      ? "company-strong-evidence-auto-create"
      : "company-strong-evidence-required";
  }
  if (inferredType === "industry" || inferredType === "concept") {
    return "candidate-gated-non-company";
  }
  return "no-auto-create-for-page-type";
}

function shouldAutoCreateMissingRef(ref: {
  occurrences: HarvestedLinkOccurrence[];
}): boolean {
  return ref.occurrences.some((occ) =>
    (occ.source === "frontmatter" && occ.originField === "primary_entities") ||
    (occ.source === "extracted" &&
      (occ.originField === "facts_block" || occ.originField === "timeline_block"))
  );
}

function candidateDisplayName(
  slug: string,
  ref: { aliases: string[] }
): string | null {
  const cleanAlias = ref.aliases
    .map((a) => a.replace(/\s+/g, " ").trim())
    .find((a) => a.length > 0 && a.length <= 80);
  if (cleanAlias) return cleanAlias;
  const namePart = slug.split("/").slice(1).join("/").trim();
  return namePart || null;
}

function summarizeOccurrences(occurrences: HarvestedLinkOccurrence[]): Array<{
  source: HarvestedLinkOccurrence["source"];
  originField: string | null;
  linkType: string;
  count: number;
}> {
  const map = new Map<string, {
    source: HarvestedLinkOccurrence["source"];
    originField: string | null;
    linkType: string;
    count: number;
  }>();
  for (const occ of occurrences) {
    const key = `${occ.source}|${occ.originField ?? ""}|${occ.linkType}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, {
        source: occ.source,
        originField: occ.originField,
        linkType: occ.linkType,
        count: 1,
      });
    }
  }
  return [...map.values()];
}

async function countActivePages(): Promise<number> {
  const [r] = (await db.execute(
    drizzleSql`SELECT COUNT(*)::int AS n FROM pages WHERE deleted = 0`
  )) as Array<{ n: number }>;
  return r?.n ?? 0;
}

function buildContext(
  content: string,
  occurrence: { start: number; end: number } | undefined
): string {
  if (!occurrence) return "";
  const radius = 50;
  const start = Math.max(0, occurrence.start - radius);
  const end = Math.min(content.length, occurrence.end + radius);
  return content.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 200);
}

async function fetchSuggestions(
  slug: string,
  inferredType: PageType
): Promise<EntityCandidateSuggestion[]> {
  const rows = await db.execute(drizzleSql`
    SELECT slug, type, title,
           GREATEST(similarity(slug, ${slug}),
                    similarity(title, ${slug})) AS sim
    FROM pages
    WHERE deleted = 0
      AND type = ${inferredType}
      AND (slug % ${slug} OR title % ${slug})
    ORDER BY sim DESC
    LIMIT 5
  `);
  return (rows as unknown as Array<{
    slug: string;
    type: string;
    title: string;
    sim: string | number;
  }>).map((r) => ({
    slug: r.slug,
    type: r.type,
    title: r.title,
    similarity: typeof r.sim === "string" ? parseFloat(r.sim) : r.sim,
  }));
}

async function logUnresolvedWikilink(opts: {
  slug: string;
  inferredType: PageType;
  suggestions: UnresolvedWikilink["suggestions"];
  fromPageId: bigint;
  actor: string;
  candidateId?: string;
  candidateStatus?: string;
  rejectReason?: string | null;
}): Promise<void> {
  await db.insert(schema.events).values(
    withCreateAudit(
      {
        actor: opts.actor,
        action: "wikilink_unresolved",
        entityType: "page",
        entityId: opts.fromPageId,
        payload: {
          slug: opts.slug,
          inferredType: opts.inferredType,
          fromPageId: opts.fromPageId.toString(),
          suggestions: opts.suggestions,
          candidateId: opts.candidateId,
          candidateStatus: opts.candidateStatus,
          rejectReason: opts.rejectReason,
        },
      },
      opts.actor
    )
  );
  const hint = opts.suggestions.length
    ? ` (closest: ${opts.suggestions[0]!.slug} sim=${opts.suggestions[0]!.similarity.toFixed(2)})`
    : "";
  const candidateHint = opts.candidateStatus
    ? `, candidate=${opts.candidateStatus}${opts.candidateId ? `#${opts.candidateId}` : ""}`
    : "";
  const mode = opts.candidateStatus ? "候选化" : "未解析";
  console.log(
    `  [stage4] 跳过红链 ${opts.slug} —— ${opts.inferredType} ${mode}${candidateHint}${hint}`
  );
}
