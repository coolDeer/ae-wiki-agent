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

export interface UnresolvedWikilink {
  slug: string;
  inferredType: PageType;
  /** pg_trgm 相似度建议；agent / lint 可用来纠错 */
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
  /** 因为 type 不在 AUTO_CREATE_TYPES（即 source/thesis/output/brief）被拒绝建页的红链。
   *  这些条目同时已写入 events.action='wikilink_unresolved'，不再次落库。 */
  unresolved: UnresolvedWikilink[];
}

export async function stage4Links(ctx: IngestContext): Promise<Stage4Result> {
  const [page] = await db
    .select({ content: schema.pages.content, slug: schema.pages.slug })
    .from(schema.pages)
    .where(eq(schema.pages.id, ctx.pageId))
    .limit(1);
  if (!page) {
    return { refsExtracted: 0, entitiesCreated: 0, linksWritten: 0, unresolved: [] };
  }

  const refsMap = extractRefs(page.content);
  console.log(`  [stage4] 抽到 ${refsMap.size} 个唯一引用`);

  let createdEntities = 0;
  let linksWritten = 0;
  const unresolved: UnresolvedWikilink[] = [];

  for (const [slug, occurrences] of refsMap) {
    if (slug === page.slug) continue; // 不给自己建链
    const inferredType = slugToType(slug);
    if (!inferredType) continue;

    const namePart = slug.split("/").slice(1).join("/").trim();

    // 1. 查是否已存在 —— alias-aware + case-insensitive
    //    匹配优先级：精确 slug > slug ILIKE > aliases ILIKE
    //    防止 [[companies/Coherent]] 在已有 [[companies/II-VI Coherent]]
    //    （aliases 含 "Coherent"）的情况下重建 stub。
    const existingRows = (await db.execute(drizzleSql`
      SELECT id, slug FROM pages
      WHERE deleted = 0
        AND type = ${inferredType}
        AND (
          slug = ${slug}
          OR LOWER(slug) = LOWER(${slug})
          OR EXISTS (
            SELECT 1 FROM unnest(COALESCE(aliases, ARRAY[]::text[])) AS a
            WHERE LOWER(a) = LOWER(${namePart})
          )
        )
      ORDER BY
        (slug = ${slug}) DESC,
        (LOWER(slug) = LOWER(${slug})) DESC,
        id ASC
      LIMIT 1
    `)) as Array<{ id: string; slug: string }>;

    let targetId: bigint | null = existingRows[0] ? BigInt(existingRows[0].id) : null;
    const matchedSlug = existingRows[0]?.slug;

    if (!targetId) {
      // 2. 红链。按 type 分流：
      //    - company/concept/industry → auto-create stub（aliases 预填 namePart），进 enrich 队列
      //    - source/thesis/output/brief → 不建，记 events 让人后续清理
      if (AUTO_CREATE_TYPES.has(inferredType)) {
        targetId = await resolveOrCreatePage(slug, {
          actor: ctx.actor,
          autoCreate: true,
          sourcePageId: ctx.pageId,
          initialAliases: namePart ? [namePart] : undefined,
        });
        if (targetId) createdEntities++;
      } else {
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
    } else if (matchedSlug && matchedSlug !== slug) {
      console.log(
        `  [stage4] 别名命中：${slug} → 已有 ${matchedSlug} (#${targetId})，连过去而非重建`
      );
    }

    if (!targetId) continue;

    // 3. 取第一个出现位置前后 ±50 字符做 context（链接表的查询上下文）
    const ctxText = buildContext(page.content, occurrences[0]);

    const inserted = await db
      .insert(schema.links)
      .values(
        withCreateAudit(
          {
            fromPageId: ctx.pageId,
            toPageId: targetId,
            linkType: "mention",
            context: ctxText,
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
  }

  console.log(
    `  [stage4] entities created=${createdEntities}, links written=${linksWritten}` +
      (unresolved.length > 0
        ? `, unresolved=${unresolved.length} (logged to events)`
        : "")
  );

  return {
    refsExtracted: refsMap.size,
    entitiesCreated: createdEntities,
    linksWritten,
    unresolved,
  };
}

/** 取一段以匹配位置为中心的上下文，前后各 50 字符（去 newline）。 */
function buildContext(
  content: string,
  occurrence: { start: number; end: number } | undefined
): string {
  if (!occurrence) return "";
  const radius = 50;
  const start = Math.max(0, occurrence.start - radius);
  const end = Math.min(content.length, occurrence.end + radius);
  return content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200); // 安全上限
}

/** pg_trgm fuzzy 找最像的 5 个候选（同 type 优先）。 */
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

/** 记一条 wikilink_unresolved event。建议列表已由调用方 fetch 好。 */
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

  const hint = opts.suggestions.length > 0
    ? ` (closest: ${opts.suggestions[0]!.slug} sim=${opts.suggestions[0]!.similarity.toFixed(2)})`
    : "";
  console.log(`  [stage4] 跳过红链 ${opts.slug} —— ${opts.inferredType} 必须显式创建${hint}`);
}

/**
 * 抽出所有 wikilink + markdown-style link，按 slug 分组返回每个 slug 的所有
 * 出现位置（用于后续切 context）。slug 做 whitespace 标准化（多空格→单空格、
 * 首尾去白）以避免 `Tencent  Holdings` 和 `Tencent Holdings` 被当成两个不同 slug。
 */
function extractRefs(
  content: string
): Map<string, Array<{ start: number; end: number }>> {
  const refs = new Map<string, Array<{ start: number; end: number }>>();

  const addRef = (slug: string, start: number, end: number): void => {
    const arr = refs.get(slug) ?? [];
    arr.push({ start, end });
    refs.set(slug, arr);
  };

  const normalize = (s: string): string => s.replace(/\s+/g, " ").trim();

  for (const m of content.matchAll(WIKILINK_RE)) {
    const dir = m[1];
    const tail = m[2];
    if (!dir || !tail) continue;
    const slug = `${dir}/${normalize(tail)}`;
    if (!slug.split("/")[1]) continue; // 空 name part 跳过
    const start = m.index ?? 0;
    const end = start + m[0].length;
    addRef(slug, start, end);
  }

  for (const m of content.matchAll(MD_LINK_RE)) {
    const full = m[2];
    if (!full) continue;
    const cleaned = full.replace(/^(?:\.\.\/)+/, "").replace(/\.md$/, "");
    const parts = cleaned.split("/");
    const dir = parts[0];
    const tail = parts.slice(1).join("/");
    if (!dir || !tail) continue;
    const slug = `${dir}/${normalize(tail)}`;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    addRef(slug, start, end);
  }

  return refs;
}
