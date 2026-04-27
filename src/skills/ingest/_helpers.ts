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

/**
 * 找或建 page。建时 confidence='low'，create_by 标 auto-create actor。
 */
export async function resolveOrCreatePage(
  slug: string,
  options: {
    sourceId?: string;
    autoCreate?: boolean;
    actor: string;
    /** 强制类型；不填则从 slug 推断 */
    type?: PageType;
  }
): Promise<bigint | null> {
  const sourceId = options.sourceId ?? "default";
  const autoCreate = options.autoCreate ?? true;

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
    return created.id;
  }

  // onConflictDoNothing 命中（并发情况）→ 重新查
  const recheck = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(
      and(eq(schema.pages.sourceId, sourceId), eq(schema.pages.slug, slug))
    )
    .limit(1);
  return recheck[0]?.id ?? null;
}
