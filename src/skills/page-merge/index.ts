/**
 * page-merge
 *
 * 把重复实体页并到 canonical page：
 *   - 迁移结构化引用（links / facts / timeline / signals / theses / tags / raw_data）
 *   - canonical 合并 aliases / 部分元数据
 *   - duplicate 软删并写 merge 元信息
 *
 * 约束：
 *   - 默认只允许同 source_id、同 type 的 entity page 合并
 *   - 不处理 source / brief / output 页
 *   - 支持 dry-run，先看影响面再真执行
 */

import { and, eq, or, sql } from "drizzle-orm";

import { withAudit, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";
import { stage3AppendNarrative } from "../ingest/stage-3-narrative.ts";
import {
  persistPageReview,
  reviewStoredPage,
  type PageReviewReport,
} from "../review/index.ts";

interface PageRow {
  id: bigint;
  sourceId: string;
  slug: string;
  type: string;
  title: string;
  displayName: string | null;
  aliases: string[] | null;
  frontmatter: Record<string, unknown> | null;
  content: string;
  confidence: string | null;
  deleted: number;
}

export interface MergePagesOptions {
  reason?: string;
  actor?: string;
  dryRun?: boolean;
  skipNarrativeFusion?: boolean;
}

export interface MergePagesReport {
  canonical: { id: string; slug: string; type: string; title: string };
  duplicate: { id: string; slug: string; type: string; title: string };
  dryRun: boolean;
  reason: string;
  planned: {
    inboundLinks: number;
    outboundLinks: number;
    originLinks: number;
    entityFacts: number;
    timelineEntries: number;
    signals: number;
    theses: number;
    tags: number;
    rawData: number;
    narrativeChars: number;
  };
  mergedAliases: string[];
  narrativeFusion: {
    willAppend: boolean;
    appendedChars: number;
    mode: "append" | "write_initial" | "skip";
  };
  postMergeReview?: Pick<
    PageReviewReport,
    "status" | "generatedAt" | "metrics" | "issues"
  > | null;
}

const MERGEABLE_TYPES = new Set(["company", "industry", "concept", "thesis"]);

export async function mergePages(
  canonicalPageId: bigint,
  duplicatePageId: bigint,
  opts: MergePagesOptions = {}
): Promise<MergePagesReport> {
  if (canonicalPageId === duplicatePageId) {
    throw new Error("canonical page 和 duplicate page 不能是同一个 id");
  }

  const actor = opts.actor ?? "agent:claude";
  const reason = opts.reason?.trim() || "manual merge";
  const dryRun = opts.dryRun ?? false;
  const skipNarrativeFusion = opts.skipNarrativeFusion ?? false;

  const [canonical, duplicate] = await Promise.all([
    loadPage(canonicalPageId),
    loadPage(duplicatePageId),
  ]);
  if (!canonical) throw new Error(`canonical page #${canonicalPageId} 不存在`);
  if (!duplicate) throw new Error(`duplicate page #${duplicatePageId} 不存在`);
  validateMergeable(canonical, duplicate);

  const plan = await collectPlan(canonical.id, duplicate.id);
  const mergedAliases = buildMergedAliases(canonical, duplicate);

  const report: MergePagesReport = {
    canonical: {
      id: canonical.id.toString(),
      slug: canonical.slug,
      type: canonical.type,
      title: canonical.title,
    },
    duplicate: {
      id: duplicate.id.toString(),
      slug: duplicate.slug,
      type: duplicate.type,
      title: duplicate.title,
    },
    dryRun,
    reason,
    planned: plan,
    mergedAliases,
    narrativeFusion: {
      willAppend: !skipNarrativeFusion && plan.narrativeChars > 0,
      appendedChars: skipNarrativeFusion ? 0 : plan.narrativeChars,
      mode: skipNarrativeFusion
        ? "skip"
          : plan.narrativeChars > 0
          ? "append"
          : "skip",
    },
    postMergeReview: null,
  };

  if (dryRun) return report;

  await mergeTags(canonical.id, duplicate.id, actor);
  await mergeRawData(canonical.id, duplicate.id, actor);
  await mergeLinks(canonical.id, duplicate.id, actor);
  await mergeFacts(canonical.id, duplicate.id, actor);
  await mergeTimeline(canonical.id, duplicate.id, actor);
  await mergeSignals(canonical.id, duplicate.id, actor);
  await mergeTheses(canonical.id, duplicate.id, actor);
  const narrativeFusion = skipNarrativeFusion
    ? { willAppend: false, appendedChars: 0, mode: "skip" as const }
    : await mergeNarrative(canonical, duplicate, reason, actor);
  report.narrativeFusion = narrativeFusion;
  await updateCanonicalPage(canonical, duplicate, mergedAliases, reason, actor);
  await retireDuplicatePage(canonical, duplicate, reason, actor);
  const postMergeReview = await reviewStoredPage(canonical.id);
  await persistPageReview(postMergeReview, actor);
  report.postMergeReview = {
    status: postMergeReview.status,
    generatedAt: postMergeReview.generatedAt,
    metrics: postMergeReview.metrics,
    issues: postMergeReview.issues,
  };
  await writeMergeEvents(canonical.id, duplicate.id, reason, actor, report);

  return report;
}

async function loadPage(pageId: bigint): Promise<PageRow | null> {
  const [page] = await db
    .select({
      id: schema.pages.id,
      sourceId: schema.pages.sourceId,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      displayName: schema.pages.displayName,
      aliases: schema.pages.aliases,
      frontmatter: schema.pages.frontmatter,
      content: schema.pages.content,
      confidence: schema.pages.confidence,
      deleted: schema.pages.deleted,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);

  if (!page) return null;
  return {
    ...page,
    frontmatter: asRecord(page.frontmatter),
  };
}

function validateMergeable(canonical: PageRow, duplicate: PageRow): void {
  if (canonical.deleted !== 0 || duplicate.deleted !== 0) {
    throw new Error("不能合并已删除页面");
  }
  if (!MERGEABLE_TYPES.has(canonical.type) || !MERGEABLE_TYPES.has(duplicate.type)) {
    throw new Error(`当前只支持合并 entity page（${Array.from(MERGEABLE_TYPES).join(", ")}）`);
  }
  if (canonical.type !== duplicate.type) {
    throw new Error(
      `拒绝跨 type 合并：canonical=${canonical.type}, duplicate=${duplicate.type}`
    );
  }
  if (canonical.sourceId !== duplicate.sourceId) {
    throw new Error(
      `拒绝跨 source_id 合并：canonical=${canonical.sourceId}, duplicate=${duplicate.sourceId}`
    );
  }
}

async function collectPlan(canonicalId: bigint, duplicateId: bigint) {
  const [canonical, duplicate] = await Promise.all([
    loadPage(canonicalId),
    loadPage(duplicateId),
  ]);
  const narrativeDelta = canonical && duplicate
    ? buildNarrativeMergeDelta(canonical, duplicate)
    : "";
  const [
    inboundLinks,
    outboundLinks,
    originLinks,
    entityFacts,
    timelineEntries,
    signals,
    theses,
    tags,
    rawData,
  ] = await Promise.all([
    countRows(schema.links, and(eq(schema.links.toPageId, duplicateId), eq(schema.links.deleted, 0))),
    countRows(schema.links, and(eq(schema.links.fromPageId, duplicateId), eq(schema.links.deleted, 0))),
    countRows(schema.links, and(eq(schema.links.originPageId, duplicateId), eq(schema.links.deleted, 0))),
    countRows(schema.facts, and(eq(schema.facts.entityPageId, duplicateId), eq(schema.facts.deleted, 0))),
    countRows(schema.timelineEntries, and(eq(schema.timelineEntries.entityPageId, duplicateId), eq(schema.timelineEntries.deleted, 0))),
    countRows(schema.signals, and(eq(schema.signals.entityPageId, duplicateId), eq(schema.signals.deleted, 0))),
    countRows(schema.theses, and(eq(schema.theses.targetPageId, duplicateId), eq(schema.theses.deleted, 0))),
    countRows(schema.tags, and(eq(schema.tags.pageId, duplicateId), eq(schema.tags.deleted, 0))),
    countRows(schema.rawData, and(eq(schema.rawData.pageId, duplicateId), eq(schema.rawData.deleted, 0))),
  ]);

  return {
    inboundLinks,
    outboundLinks,
    originLinks,
    entityFacts,
    timelineEntries,
    signals,
    theses,
    tags,
    rawData,
    narrativeChars: narrativeDelta.length,
  };
}

async function countRows(table: typeof schema.links | typeof schema.facts | typeof schema.timelineEntries | typeof schema.signals | typeof schema.theses | typeof schema.tags | typeof schema.rawData, whereExpr: ReturnType<typeof and>) {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(whereExpr)
    .limit(1);
  return rows[0]?.n ?? 0;
}

function buildMergedAliases(canonical: PageRow, duplicate: PageRow): string[] {
  const parts = [
    ...(canonical.aliases ?? []),
    ...(duplicate.aliases ?? []),
    duplicate.title,
    duplicate.slug.split("/").slice(1).join("/"),
    canonical.title,
    canonical.slug.split("/").slice(1).join("/"),
  ];
  return dedupeCaseInsensitive(parts);
}

async function mergeTags(canonicalId: bigint, duplicateId: bigint, actor: string): Promise<void> {
  const rows = await db
    .select({
      id: schema.tags.id,
      tag: schema.tags.tag,
    })
    .from(schema.tags)
    .where(and(eq(schema.tags.pageId, duplicateId), eq(schema.tags.deleted, 0)));

  const existing = await db
    .select({ tag: schema.tags.tag })
    .from(schema.tags)
    .where(and(eq(schema.tags.pageId, canonicalId), eq(schema.tags.deleted, 0)));
  const existingSet = new Set(existing.map((row) => row.tag));

  for (const row of rows) {
    if (!existingSet.has(row.tag)) {
      await db.insert(schema.tags).values(
        withCreateAudit(
          {
            pageId: canonicalId,
            tag: row.tag,
          },
          actor
        )
      );
      existingSet.add(row.tag);
    }
    await db
      .update(schema.tags)
      .set(withAudit({ deleted: 1 }, actor))
      .where(eq(schema.tags.id, row.id));
  }
}

async function mergeRawData(canonicalId: bigint, duplicateId: bigint, actor: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.rawData)
    .where(and(eq(schema.rawData.pageId, duplicateId), eq(schema.rawData.deleted, 0)));

  const existing = await db
    .select({ source: schema.rawData.source })
    .from(schema.rawData)
    .where(and(eq(schema.rawData.pageId, canonicalId), eq(schema.rawData.deleted, 0)));
  const existingSources = new Set(existing.map((row) => row.source));

  for (const row of rows) {
    if (existingSources.has(row.source)) {
      await db
        .update(schema.rawData)
        .set(withAudit({ deleted: 1 }, actor))
        .where(eq(schema.rawData.id, row.id));
    } else {
      await db
        .update(schema.rawData)
        .set(withAudit({ pageId: canonicalId }, actor))
        .where(eq(schema.rawData.id, row.id));
      existingSources.add(row.source);
    }
  }
}

async function mergeLinks(canonicalId: bigint, duplicateId: bigint, actor: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.links)
    .where(
      and(
        eq(schema.links.deleted, 0),
        or(
          eq(schema.links.fromPageId, duplicateId),
          eq(schema.links.toPageId, duplicateId),
          eq(schema.links.originPageId, duplicateId)
        )
      )
    );

  for (const row of rows) {
    const nextFrom = row.fromPageId === duplicateId ? canonicalId : row.fromPageId;
    const nextTo = row.toPageId === duplicateId ? canonicalId : row.toPageId;
    const nextOrigin = row.originPageId === duplicateId ? canonicalId : row.originPageId;

    if (nextFrom === nextTo) {
      await db
        .update(schema.links)
        .set(withAudit({ deleted: 1 }, actor))
        .where(eq(schema.links.id, row.id));
      continue;
    }

    const existing = await db
      .select({ id: schema.links.id })
      .from(schema.links)
      .where(
        and(
          eq(schema.links.deleted, 0),
          eq(schema.links.fromPageId, nextFrom),
          eq(schema.links.toPageId, nextTo),
          eq(schema.links.linkType, row.linkType),
          sql`${schema.links.linkSource} IS NOT DISTINCT FROM ${row.linkSource}`,
          sql`${schema.links.originPageId} IS NOT DISTINCT FROM ${nextOrigin}`
        )
      )
      .limit(1);

    if (existing[0] && existing[0].id !== row.id) {
      await db
        .update(schema.links)
        .set(withAudit({ deleted: 1 }, actor))
        .where(eq(schema.links.id, row.id));
      continue;
    }

    await db
      .update(schema.links)
      .set(
        withAudit(
          {
            fromPageId: nextFrom,
            toPageId: nextTo,
            originPageId: nextOrigin,
          },
          actor
        )
      )
      .where(eq(schema.links.id, row.id));
  }
}

async function mergeFacts(canonicalId: bigint, duplicateId: bigint, actor: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.facts)
    .where(and(eq(schema.facts.entityPageId, duplicateId), eq(schema.facts.deleted, 0)));

  for (const row of rows) {
    const existing = await db
      .select({ id: schema.facts.id })
      .from(schema.facts)
      .where(
        and(
          eq(schema.facts.deleted, 0),
          eq(schema.facts.entityPageId, canonicalId),
          eq(schema.facts.metric, row.metric),
          sql`${schema.facts.period} IS NOT DISTINCT FROM ${row.period}`,
          sql`${schema.facts.valueNumeric} IS NOT DISTINCT FROM ${row.valueNumeric}`,
          sql`${schema.facts.valueText} IS NOT DISTINCT FROM ${row.valueText}`,
          sql`${schema.facts.unit} IS NOT DISTINCT FROM ${row.unit}`,
          sql`${schema.facts.sourcePageId} IS NOT DISTINCT FROM ${row.sourcePageId}`,
          sql`${schema.facts.validFrom} IS NOT DISTINCT FROM ${row.validFrom}`,
          sql`${schema.facts.validTo} IS NOT DISTINCT FROM ${row.validTo}`
        )
      )
      .limit(1);

    if (existing[0] && existing[0].id !== row.id) {
      await db
        .update(schema.facts)
        .set(withAudit({ deleted: 1 }, actor))
        .where(eq(schema.facts.id, row.id));
      continue;
    }

    await db
      .update(schema.facts)
      .set(withAudit({ entityPageId: canonicalId }, actor))
      .where(eq(schema.facts.id, row.id));
  }
}

async function mergeTimeline(canonicalId: bigint, duplicateId: bigint, actor: string): Promise<void> {
  const rows = await db
    .select()
    .from(schema.timelineEntries)
    .where(and(eq(schema.timelineEntries.entityPageId, duplicateId), eq(schema.timelineEntries.deleted, 0)));

  for (const row of rows) {
    const existing = await db
      .select({ id: schema.timelineEntries.id })
      .from(schema.timelineEntries)
      .where(
        and(
          eq(schema.timelineEntries.deleted, 0),
          eq(schema.timelineEntries.entityPageId, canonicalId),
          eq(schema.timelineEntries.eventDate, row.eventDate),
          eq(schema.timelineEntries.summary, row.summary)
        )
      )
      .limit(1);

    if (existing[0] && existing[0].id !== row.id) {
      await db
        .update(schema.timelineEntries)
        .set(withAudit({ deleted: 1 }, actor))
        .where(eq(schema.timelineEntries.id, row.id));
      continue;
    }

    await db
      .update(schema.timelineEntries)
      .set(withAudit({ entityPageId: canonicalId }, actor))
      .where(eq(schema.timelineEntries.id, row.id));
  }
}

async function mergeSignals(canonicalId: bigint, duplicateId: bigint, actor: string): Promise<void> {
  await db
    .update(schema.signals)
    .set(withAudit({ entityPageId: canonicalId }, actor))
    .where(and(eq(schema.signals.entityPageId, duplicateId), eq(schema.signals.deleted, 0)));
}

async function mergeTheses(canonicalId: bigint, duplicateId: bigint, actor: string): Promise<void> {
  await db
    .update(schema.theses)
    .set(withAudit({ targetPageId: canonicalId }, actor))
    .where(and(eq(schema.theses.targetPageId, duplicateId), eq(schema.theses.deleted, 0)));
}

async function mergeNarrative(
  canonical: PageRow,
  duplicate: PageRow,
  reason: string,
  actor: string
): Promise<MergePagesReport["narrativeFusion"]> {
  const delta = buildNarrativeMergeDelta(canonical, duplicate);
  if (!delta) {
    return {
      willAppend: false,
      appendedChars: 0,
      mode: "skip",
    };
  }

  const result = await stage3AppendNarrative(canonical.id, delta, actor, {
    sourceSlug: duplicate.slug,
    reason: `merge:${reason}`,
  });
  return {
    willAppend: true,
    appendedChars: delta.length,
    mode: result.mode,
  };
}

async function updateCanonicalPage(
  canonical: PageRow,
  duplicate: PageRow,
  mergedAliases: string[],
  reason: string,
  actor: string
): Promise<void> {
  const existingFrontmatter = asRecord(canonical.frontmatter);
  const mergedFrom = Array.isArray(existingFrontmatter.merged_from)
    ? [...(existingFrontmatter.merged_from as unknown[])]
    : [];
  mergedFrom.push({
    page_id: duplicate.id.toString(),
    slug: duplicate.slug,
    title: duplicate.title,
    reason,
    merged_at: new Date().toISOString(),
  });

  await db
    .update(schema.pages)
    .set(
      withAudit(
        {
          aliases: mergedAliases,
          displayName: canonical.displayName ?? duplicate.displayName,
          frontmatter: {
            ...existingFrontmatter,
            merged_from: mergedFrom,
          },
        },
        actor
      )
    )
    .where(eq(schema.pages.id, canonical.id));
}

async function retireDuplicatePage(
  canonical: PageRow,
  duplicate: PageRow,
  reason: string,
  actor: string
): Promise<void> {
  const frontmatter = asRecord(duplicate.frontmatter);
  await db
    .update(schema.pages)
    .set(
      withAudit(
        {
          status: "archived",
          deleted: 1,
          frontmatter: {
            ...frontmatter,
            merged_into: {
              page_id: canonical.id.toString(),
              slug: canonical.slug,
              title: canonical.title,
              reason,
              merged_at: new Date().toISOString(),
            },
          },
        },
        actor
      )
    )
    .where(eq(schema.pages.id, duplicate.id));
}

async function writeMergeEvents(
  canonicalId: bigint,
  duplicateId: bigint,
  reason: string,
  actor: string,
  report: MergePagesReport
): Promise<void> {
  await db.insert(schema.events).values([
    {
      actor,
      action: "page_merge_canonical",
      entityType: "page",
      entityId: canonicalId,
      payload: report as unknown as Record<string, unknown>,
      createBy: actor,
      updateBy: actor,
    },
    {
      actor,
      action: "page_merge_duplicate",
      entityType: "page",
      entityId: duplicateId,
      payload: {
        canonicalPageId: canonicalId.toString(),
        reason,
      },
      createBy: actor,
      updateBy: actor,
    },
  ]);
}

function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function buildNarrativeMergeDelta(canonical: PageRow, duplicate: PageRow): string {
  const canonicalText = normalizeComparableText(canonical.content);
  const duplicateBody = stripUpdatesSection(duplicate.content).trim();
  if (!duplicateBody) return "";

  const duplicateComparable = normalizeComparableText(duplicateBody);
  if (!duplicateComparable) return "";
  if (canonicalText.includes(duplicateComparable)) return "";

  const sourceLabel = duplicate.displayName ?? duplicate.title;
  return [
    `Merged context from [[${duplicate.slug}|${sourceLabel}]] during entity dedupe.`,
    "",
    duplicateBody,
  ].join("\n");
}

function stripUpdatesSection(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const idx = trimmed.indexOf("\n## Updates");
  return idx >= 0 ? trimmed.slice(0, idx).trim() : trimmed;
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, "$2")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
