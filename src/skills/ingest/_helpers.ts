/**
 * ingest stage 之间共用的小工具：
 *   - resolveOrCreatePage：按 slug 找 page，没有就自动建（type 由 slug 推断）
 *   - slugToType：从 slug 前缀（companies/X → company）推断 type
 */

import { eq, and, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import type { PageType } from "~/core/schema/pages.ts";

const SLUG_TO_TYPE: Record<string, PageType> = {
  companies: "company",
  persons: "person",
  industries: "industry",
  concepts: "concept",
  sources: "source",
  briefs: "brief",
  theses: "thesis",
  outputs: "output",
};

export function slugToType(slug: string): PageType | null {
  const dir = slug.split("/")[0];
  return dir ? (SLUG_TO_TYPE[dir] ?? null) : null;
}

export function slugToTitle(slug: string): string {
  // 'companies/Western Digital' → 'Western Digital'
  const last = slug.split("/").pop();
  return last ?? slug;
}

export interface ResolveOptions {
  sourceId?: string;
  autoCreate?: boolean;
  actor: string;
  /** 强制类型；不填则从 slug 推断 */
  type?: PageType;
  /**
   * 自动建红链时是否入队 enrich_entity job（默认 true）。
   * 调用方有 sourcePageId 时会写进 job.data，给 ae-enrich 当 backlink 提示。
   */
  enqueueEnrich?: boolean;
  /** 关联 source page id（写进 enrich_entity job.data.sourcePageId） */
  sourcePageId?: bigint;
}

/**
 * 找或建 page。建时 confidence='low'，create_by 标 auto-create actor。
 *
 * 自动建出的红链同时入队 `enrich_entity` minion job（除非 `enqueueEnrich:false`），
 * 让 worker 调度 `ae-enrich` skill 把空壳补全。这一行为之前只在 stage 4 显式做，
 * 导致 stage 5 / 7 等通过 fact / timeline entity slug 触发自动建的红链永远不会
 * 被 enrich —— 现在统一在 helper 里处理。
 */
export async function resolveOrCreatePage(
  slug: string,
  options: ResolveOptions
): Promise<bigint | null> {
  const sourceId = options.sourceId ?? "default";
  const autoCreate = options.autoCreate ?? true;
  const enqueueEnrich = options.enqueueEnrich ?? true;

  // 1. 找已存在的（不查 deleted=1 的）
  const existing = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.sourceId, sourceId),
        eq(schema.pages.slug, slug),
        eq(schema.pages.deleted, 0)
      )
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  if (!autoCreate) return null;

  // 2. 推断 type
  const type = options.type ?? slugToType(slug);
  if (!type) {
    console.warn(`  [resolve] 无法推断 type，跳过建 page: ${slug}`);
    return null;
  }

  // 3. 自动建
  const [created] = await db
    .insert(schema.pages)
    .values(
      withCreateAudit(
        {
          sourceId,
          slug,
          type,
          title: slugToTitle(slug),
          status: "active",
          confidence: "low", // 自动建的实体标 low，待 enrich
        },
        options.actor
      )
    )
    .onConflictDoNothing({
      target: [schema.pages.sourceId, schema.pages.slug],
      // partial unique index: uq_pages_source_slug
      where: drizzleSql`deleted = 0`,
    })
    .returning({ id: schema.pages.id });

  if (created) {
    console.log(`  [resolve] 自动建 page: ${slug} (#${created.id}, type=${type})`);
    if (enqueueEnrich) {
      await enqueueEnrichEntity(created.id, slug, options.sourcePageId, options.actor);
    }
    return created.id;
  }

  // onConflictDoNothing 命中（并发情况）→ 重新查；不重复入队
  const recheck = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(
      and(eq(schema.pages.sourceId, sourceId), eq(schema.pages.slug, slug))
    )
    .limit(1);
  return recheck[0]?.id ?? null;
}

async function enqueueEnrichEntity(
  pageId: bigint,
  slug: string,
  sourcePageId: bigint | undefined,
  actor: string
): Promise<void> {
  await db.insert(schema.minionJobs).values(
    withCreateAudit(
      {
        name: "enrich_entity",
        status: "waiting",
        data: {
          pageId: pageId.toString(),
          slug,
          sourcePageId: sourcePageId?.toString() ?? null,
        },
      },
      actor
    )
  );
}
