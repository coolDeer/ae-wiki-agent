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
  /**
   * 自动建 page 时给 aliases 列预填的字符串数组。stage-4 用它把 slug 的 name 部分
   * 写进去（如 `[[companies/Tencent]]` → aliases=['Tencent']），让后续 narrative
   * 写 `[[companies/Tencent Holdings]]` 时 stage-4 的 alias 反查能命中现有 page。
   */
  initialAliases?: string[];
}

/**
 * 找或建 page。建时 confidence='low'，create_by 标 auto-create actor。
 *
 * 自动建出的红链同时入队 `enrich_entity` minion job（除非 `enqueueEnrich:false`），
 * 让 worker 调度 `ae-enrich` skill 把空壳补全。这一行为之前只在 stage 4 显式做，
 * 导致 stage 5 / 7 等通过 fact / timeline entity slug 触发自动建的红链永远不会
 * 被 enrich —— 现在统一在 helper 里处理。
 *
 * **查找策略（case-insensitive + alias-aware）**：
 *   1. 精确 slug 匹配（最优先）
 *   2. 大小写不敏感 slug 匹配（处理 `industries/Hog-Farming` vs `industries/hog-farming`）
 *   3. aliases 数组内容匹配（处理 `[[companies/Coherent]]` 命中已有 II-VI Coherent 的 aliases）
 *
 * 这套查找住在 helper 里以确保 stage-4 / stage-5 (facts) / stage-7 (timeline) 三个
 * 调用点行为一致——之前只有 stage-4 自己实现了，stage-5/7 走老的精确匹配，
 * 导致 narrative 里 wikilink 用大写 `[[X/Foo]]` 而 fact YAML 用小写 `entity: X/foo`
 * 时，stage-4 建一个 page，stage-5 又建一个不同 case 的 page，最终图谱里两个 dup。
 */
export async function resolveOrCreatePage(
  slug: string,
  options: ResolveOptions
): Promise<bigint | null> {
  const sourceId = options.sourceId ?? "default";
  const autoCreate = options.autoCreate ?? true;
  const enqueueEnrich = options.enqueueEnrich ?? true;
  const inferredType = options.type ?? slugToType(slug);
  const namePart = slug.split("/").slice(1).join("/").trim();

  // 1. 智能查找（精确 slug → 大小写不敏感 → aliases 命中）
  //    type 已知就限定 type，避免跨 type 误命中
  const typeClause = inferredType
    ? drizzleSql`AND type = ${inferredType}`
    : drizzleSql``;

  const found = await db.execute(drizzleSql`
    SELECT id, slug
    FROM pages
    WHERE deleted = 0
      AND source_id = ${sourceId}
      ${typeClause}
      AND (
        slug = ${slug}
        OR LOWER(slug) = LOWER(${slug})
        OR (
          ${namePart === "" ? drizzleSql`FALSE` : drizzleSql`EXISTS (
            SELECT 1 FROM unnest(COALESCE(aliases, ARRAY[]::text[])) AS a
            WHERE LOWER(a) = LOWER(${namePart})
          )`}
        )
      )
    ORDER BY
      (slug = ${slug}) DESC,
      (LOWER(slug) = LOWER(${slug})) DESC,
      id ASC
    LIMIT 1
  `);

  const existing = (found as unknown as Array<{ id: string; slug: string }>)[0];
  if (existing) {
    if (existing.slug !== slug) {
      console.log(
        `  [resolve] 别名/大小写命中：${slug} → 已有 ${existing.slug} (#${existing.id})`
      );
    }
    return BigInt(existing.id);
  }

  if (!autoCreate) return null;

  // 2. 推断 type
  if (!inferredType) {
    console.warn(`  [resolve] 无法推断 type，跳过建 page: ${slug}`);
    return null;
  }

  // 3. 自动建
  //    aliases 默认带上 namePart（保证下次同名不同 case 的 wikilink 能 alias 命中）
  const initialAliases = options.initialAliases ?? (namePart ? [namePart] : []);
  const aliases = initialAliases
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const [created] = await db
    .insert(schema.pages)
    .values(
      withCreateAudit(
        {
          sourceId,
          slug,
          type: inferredType,
          title: slugToTitle(slug),
          status: "active",
          confidence: "low", // 自动建的实体标 low，待 enrich
          aliases: aliases.length > 0 ? aliases : undefined,
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
    console.log(`  [resolve] 自动建 page: ${slug} (#${created.id}, type=${inferredType})`);
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
