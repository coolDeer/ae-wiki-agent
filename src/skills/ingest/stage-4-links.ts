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
  maybeEnqueueEnrichForBacklinkGrowth,
  resolveOrCreatePage,
  slugToType,
} from "./_helpers.ts";
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

const AUTO_CREATE_TYPES: ReadonlySet<PageType> = new Set([
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
    if (AUTO_CREATE_TYPES.has(inferredType)) {
      targetId = await resolveOrCreatePage(slug, {
        actor: ctx.actor,
        autoCreate: true,
        sourcePageId: ctx.pageId,
        initialAliases: ref.aliases,
      });
    } else {
      targetId = await resolveOrCreatePage(slug, {
        actor: ctx.actor,
        autoCreate: false,
      });
      if (!targetId) {
        const suggestions = await fetchSuggestions(slug, inferredType);
        await logUnresolvedWikilink({
          slug,
          inferredType,
          suggestions,
          fromPageId: ctx.pageId,
          actor: ctx.actor,
        });
        unresolved.push({ slug, inferredType, suggestions });
        continue;
      }
    }
    if (!targetId) continue;

    const occByKey = groupOccurrencesByLinkKey(ref.occurrences);
    let firstWrite = true;
    for (const [key, occs] of occByKey) {
      const [linkType, linkSource, originField] = splitLinkKey(key);
      const safeType = VALID_LINK_TYPES.has(linkType) ? linkType : "mention";
      const ctxText = buildContext(page.content, occs[0]);
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
              weight: "1.0",
            },
            ctx.actor
          )
        )
        .onConflictDoNothing()
        .returning({ id: schema.links.id });
      if (inserted.length > 0) {
        linksWritten++;
        if (firstWrite) {
          await maybeEnqueueEnrichForBacklinkGrowth({
            pageId: targetId,
            slug,
            sourcePageId: ctx.pageId,
            actor: ctx.actor,
          });
          firstWrite = false;
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
): Promise<UnresolvedWikilink["suggestions"]> {
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
        },
      },
      opts.actor
    )
  );
  const hint = opts.suggestions.length
    ? ` (closest: ${opts.suggestions[0]!.slug} sim=${opts.suggestions[0]!.similarity.toFixed(2)})`
    : "";
  console.log(`  [stage4] 跳过红链 ${opts.slug} —— ${opts.inferredType} 必须显式创建${hint}`);
}
