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

import { eq } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import { resolveOrCreatePage, slugToType } from "./_helpers.ts";
import type { IngestContext } from "~/core/types.ts";

const ENTITY_DIRS = [
  "companies",
  "persons",
  "industries",
  "concepts",
  "sources",
  "theses",
  "outputs",
];
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

  for (const slug of refs) {
    if (slug === page.slug) continue; // 不给自己建链
    if (!slugToType(slug)) continue;

    // 自动 resolve / 创建
    const beforeCheck = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(eq(schema.pages.slug, slug))
      .limit(1);
    const wasExisting = beforeCheck.length > 0;

    const targetId = await resolveOrCreatePage(slug, {
      actor: ctx.actor,
      autoCreate: true,
    });
    if (!targetId) continue;
    if (!wasExisting) {
      createdEntities++;
      await db.insert(schema.minionJobs).values(
        withCreateAudit(
          {
            name: "enrich_entity",
            status: "waiting",
            data: {
              pageId: targetId.toString(),
              slug,
              sourcePageId: ctx.pageId.toString(),
            },
          },
          ctx.actor
        )
      );
    }

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
  }

  console.log(
    `  [stage4] entities created=${createdEntities}, links written=${linksWritten}`
  );
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
