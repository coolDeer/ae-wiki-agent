/**
 * Stage 4: 实体识别 + 链接抽取
 *
 * 从 page.content 提取：
 *   1. [[dir/slug]] / [[dir/slug|display]] — Obsidian wikilink
 *   2. [text](dir/slug) — markdown 内联链接（仅当 dir 在白名单时算 entity link）
 *
 * 对每个引用：
 *   - resolveOrCreatePage(slug)（不存在则自动建，confidence='low'）
 *   - INSERT INTO links (link_source='extracted', origin_page_id=ctx.pageId)
 *
 * v1 暂不做：
 *   - ticker 字符串反查（'NVDA' → companies/NVIDIA），需要 alias 索引
 *   - 链接周围 context 提取（前后 N 字符）— 现在留空
 */

import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import { resolveOrCreatePage, slugToType } from "./_helpers.ts";
import type { IngestContext } from "~/core/types.ts";
import type { PageType } from "~/core/schema/pages.ts";

const ENTITY_DIRS = [
  "companies",
  "industries",
  "concepts",
  "sources",
  "theses",
  "outputs",
  "briefs",
];

/**
 * 这些 type 的红链允许 stage-4 auto-create 空 stub（confidence='low'，等 enrich）。
 *
 * 反过来 sources/theses/outputs/briefs 必须由 ingest:commit/brief / thesis:open /
 * daily-* 这些显式入口创建——agent narrative 里写 `[[sources/foo]]` 通常是
 * 凭直觉猜 slug，slug 错了会污染图。这种红链改成只记 events，不建 page。
 */
const AUTO_CREATE_TYPES: ReadonlySet<PageType> = new Set([
  "company",
  "industry",
  "concept",
]);
const DIR_PATTERN = ENTITY_DIRS.join("|");

// [[dir/slug]] / [[dir/slug|display]]
const WIKILINK_RE = new RegExp(
  `\\[\\[(${DIR_PATTERN})\\/([^\\]|#]+?)(?:#[^\\]|]*?)?(?:\\|([^\\]]+?))?\\]\\]`,
  "g"
);

// [text](dir/slug) 或 [text](../dir/slug.md)
const MD_LINK_RE = new RegExp(
  `\\[([^\\]]+)\\]\\(((?:\\.\\.\\/)*(${DIR_PATTERN})\\/[^)\\s]+?)(?:\\.md)?\\)`,
  "g"
);

export async function stage4Links(ctx: IngestContext): Promise<void> {
  const [page] = await db
    .select({ content: schema.pages.content, slug: schema.pages.slug })
    .from(schema.pages)
    .where(eq(schema.pages.id, ctx.pageId))
    .limit(1);
  if (!page) return;

  const refs = extractRefs(page.content);
  console.log(`  [stage4] 抽到 ${refs.size} 个唯一引用`);

  let createdEntities = 0;
  let linksWritten = 0;
  let unresolved = 0;

  for (const slug of refs) {
    if (slug === page.slug) continue; // 不给自己建链
    const inferredType = slugToType(slug);
    if (!inferredType) continue;

    // 1. 先查是否已存在（不论是否允许 auto-create，命中就连）
    const existing = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(and(eq(schema.pages.slug, slug), eq(schema.pages.deleted, 0)))
      .limit(1);

    let targetId: bigint | null = existing[0]?.id ?? null;
    const wasExisting = targetId !== null;

    if (!targetId) {
      // 2. 红链。按 type 分流：
      //    - company/concept/industry → auto-create stub，进 enrich 队列
      //    - source/thesis/output/brief → 不建，记 events 让人后续清理
      if (AUTO_CREATE_TYPES.has(inferredType)) {
        targetId = await resolveOrCreatePage(slug, {
          actor: ctx.actor,
          autoCreate: true,
          sourcePageId: ctx.pageId,
        });
        if (targetId) createdEntities++;
      } else {
        await logUnresolvedWikilink({
          slug,
          inferredType,
          fromPageId: ctx.pageId,
          actor: ctx.actor,
        });
        unresolved++;
        continue;
      }
    }

    if (!targetId) continue;

    const inserted = await db
      .insert(schema.links)
      .values(
        withCreateAudit(
          {
            fromPageId: ctx.pageId,
            toPageId: targetId,
            linkType: "mention",
            context: "",
            linkSource: "extracted",
            originPageId: ctx.pageId,
            weight: "1.0",
          },
          ctx.actor
        )
      )
      .onConflictDoNothing()
      .returning({ id: schema.links.id });
    if (inserted.length > 0) linksWritten++;
    void wasExisting;
  }

  console.log(
    `  [stage4] entities created=${createdEntities}, links written=${linksWritten}` +
      (unresolved > 0 ? `, unresolved=${unresolved} (logged to events)` : "")
  );
}

/**
 * 记一条 wikilink_unresolved event，附 trgm 相似度建议（agent / lint 可拿来纠错）。
 */
async function logUnresolvedWikilink(opts: {
  slug: string;
  inferredType: PageType;
  fromPageId: bigint;
  actor: string;
}): Promise<void> {
  // pg_trgm fuzzy 找最像的 5 个候选（同 type 优先）。慢路径 OK，红链本来就少见。
  const suggestionRows = await db.execute(drizzleSql`
    SELECT slug, type, title,
           GREATEST(similarity(slug, ${opts.slug}),
                    similarity(title, ${opts.slug})) AS sim
    FROM pages
    WHERE deleted = 0
      AND type = ${opts.inferredType}
      AND (slug % ${opts.slug} OR title % ${opts.slug})
    ORDER BY sim DESC
    LIMIT 5
  `);
  const suggestions = (suggestionRows as unknown as Array<{
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
          suggestions,
        },
      },
      opts.actor
    )
  );

  const hint = suggestions.length > 0
    ? ` (closest: ${suggestions[0]!.slug} sim=${suggestions[0]!.similarity.toFixed(2)})`
    : "";
  console.log(`  [stage4] 跳过红链 ${opts.slug} —— ${opts.inferredType} 必须显式创建${hint}`);
}

function extractRefs(content: string): Set<string> {
  const refs = new Set<string>();

  for (const m of content.matchAll(WIKILINK_RE)) {
    const dir = m[1];
    const tail = m[2];
    if (!dir || !tail) continue;
    refs.add(`${dir}/${tail.trim()}`);
  }

  for (const m of content.matchAll(MD_LINK_RE)) {
    const full = m[2];
    if (!full) continue;
    const cleaned = full.replace(/^(?:\.\.\/)+/, "").replace(/\.md$/, "");
    refs.add(cleaned);
  }

  return refs;
}
