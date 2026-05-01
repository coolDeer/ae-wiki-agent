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
import {
  maybeEnqueueEnrichForBacklinkGrowth,
  resolveOrCreatePage,
  slugToType,
} from "./_helpers.ts";
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

  // 用前后 page 总数差算 entitiesCreated（helper 不再返回 wasCreated 标志，这是
  // 最简的统计方式，且不会因 helper 内部并发 / onConflict 行为有偏差）。
  const beforeCount = await countActivePages();
  let linksWritten = 0;
  const unresolved: UnresolvedWikilink[] = [];

  for (const [slug, occurrences] of refsMap) {
    if (slug === page.slug) continue; // 不给自己建链
    const inferredType = slugToType(slug);
    if (!inferredType) continue;

    // 红链按 type 分流：
    //   - company/concept/industry → 调 helper 找或建（带 alias dedupe + case-insensitive）
    //   - source/thesis/output/brief → 拒绝建，记 events 让人后续清理
    let targetId: bigint | null = null;
    if (AUTO_CREATE_TYPES.has(inferredType)) {
      // helper 内部做智能查找：精确 slug → 大小写不敏感 → aliases 命中
      // 没找到才建新（建时 alias 默认带 namePart）。建/命中由 helper 自己 log。
      targetId = await resolveOrCreatePage(slug, {
        actor: ctx.actor,
        autoCreate: true,
        sourcePageId: ctx.pageId,
      });
    } else {
      // 不允许 auto-create —— 但存在就连
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
    if (inserted.length > 0) {
      linksWritten++;
      // 链接刚写入；现在用更新后的 backlink 数判定是否够格 enqueue enrich
      await maybeEnqueueEnrichForBacklinkGrowth({
        pageId: targetId,
        slug,
        sourcePageId: ctx.pageId,
        actor: ctx.actor,
      });
    }
  }

  const afterCount = await countActivePages();
  const createdEntities = Math.max(0, afterCount - beforeCount);

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

async function countActivePages(): Promise<number> {
  const [r] = (await db.execute(
    drizzleSql`SELECT COUNT(*)::int AS n FROM pages WHERE deleted = 0`
  )) as Array<{ n: number }>;
  return r?.n ?? 0;
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
 *
 * 拒绝包含 CLAUDE.md 声明的禁止字符（`* ? < > | : \\ "`）的 slug ——
 * 这些通常是 agent 写的占位符 / 通配符（如 `[[companies/*]]` 表示"这一类公司"），
 * 不是真实 entity 引用。事故案例：narrative 写 `create/confirm [[companies/*]]
 * stubs before relying on company-level signals`，stage-4 把 `companies/*` 当真
 * slug 建了空 stub。
 */
const FORBIDDEN_SLUG_CHARS_RE = /[*?<>|:\\"]/;

function extractRefs(
  content: string
): Map<string, Array<{ start: number; end: number }>> {
  const refs = new Map<string, Array<{ start: number; end: number }>>();

  const addRef = (slug: string, start: number, end: number): void => {
    // 静默丢弃含禁止字符的 slug（占位符 / 通配符），不入 refs map
    const namePart = slug.split("/").slice(1).join("/");
    if (FORBIDDEN_SLUG_CHARS_RE.test(namePart)) {
      console.log(`  [stage4] 丢弃非法 slug: ${slug}（含 * ? < > | : \\ " 等占位字符）`);
      return;
    }
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
