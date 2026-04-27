/**
 * Stage 1: 创建 pages 骨架
 *
 * 输入：raw_files 行
 * 输出：新 pages 行（type 由调用方决定：'source' 或 'brief'，content 暂留空）
 *
 * 副作用：写 events (action='ingest_start')
 */

import { db, schema } from "~/core/db.ts";
import { Actor, withCreateAudit } from "~/core/audit.ts";
import type { IngestContext } from "~/core/types.ts";
import type { PageType } from "~/core/schema/pages.ts";

export interface SkeletonOptions {
  /** page.type，默认 'source'。'brief' 走轻量路径。 */
  type?: PageType;
  /** slug 目录前缀，默认按 type 推断（source→sources/, brief→briefs/）。 */
  slugDir?: string;
}

const TYPE_TO_SLUG_DIR: Partial<Record<PageType, string>> = {
  source: "sources",
  brief: "briefs",
};

export async function stage1CreateSkeleton(
  ctx: IngestContext,
  rawFile: typeof schema.rawFiles.$inferSelect,
  options: SkeletonOptions = {}
): Promise<bigint> {
  const type: PageType = options.type ?? "source";
  const slugDir = options.slugDir ?? TYPE_TO_SLUG_DIR[type] ?? `${type}s`;

  // 生成 slug：<slugDir>/<研究类型缩写>-<研究 ID 短>-<日期短>
  const datePart = rawFile.createTime.toISOString().slice(2, 10).replace(/-/g, "");
  const idPart = rawFile.researchId?.slice(-6) ?? rawFile.id.toString();
  const slug = `${slugDir}/${rawFile.researchType ?? "unknown"}-${idPart}-${datePart}`;

  const [page] = await db
    .insert(schema.pages)
    .values(
      withCreateAudit(
        {
          sourceId: rawFile.sourceId,
          slug,
          type,
          title: rawFile.title ?? "(untitled)",
          orgCode: rawFile.orgCode,
          status: "active",
          confidence: "medium",
          frontmatter: {
            research_id: rawFile.researchId,
            research_type: rawFile.researchType,
            raw_path: rawFile.rawPath,
            tags: rawFile.tags ?? [],
          },
        },
        ctx.actor
      )
    )
    .returning({ id: schema.pages.id });

  if (!page) throw new Error("stage1: pages insert returned empty");

  // 写 event
  await db.insert(schema.events).values({
    actor: ctx.actor,
    action: "ingest_start",
    entityType: "page",
    entityId: page.id,
    payload: { rawFileId: ctx.rawFileId.toString() },
    createBy: ctx.actor,
    updateBy: ctx.actor,
  });

  return page.id;
}
