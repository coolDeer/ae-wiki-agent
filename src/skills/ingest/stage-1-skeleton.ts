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

export function buildRawFilePageSlug(opts: {
  slugDir: string;
  researchType: string | null;
  researchId: string | null;
  rawFileId: bigint;
}): string {
  const typePart = normalizeSlugPart(opts.researchType ?? "unknown");
  const idPart = normalizeSlugPart(opts.researchId ?? opts.rawFileId.toString());
  return `${opts.slugDir}/${typePart}-${idPart}`;
}

function normalizeSlugPart(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\/\\:*?"<>|#%]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

export async function stage1CreateSkeleton(
  ctx: IngestContext,
  rawFile: typeof schema.rawFiles.$inferSelect,
  options: SkeletonOptions = {}
): Promise<bigint> {
  const type: PageType = options.type ?? "source";
  const slugDir = options.slugDir ?? TYPE_TO_SLUG_DIR[type] ?? `${type}s`;

  // 生成 slug：<slugDir>/<research_type>-<full_research_id>
  // research_id 已由 raw_files partial unique 保证唯一；不再追加日期，避免 URL 随日期噪声变长。
  const slug = buildRawFilePageSlug({
    slugDir,
    researchType: rawFile.researchType,
    researchId: rawFile.researchId,
    rawFileId: rawFile.id,
  });

  // 从 mongo_doc 多拉几个 frontmatter 字段（白名单字段，agent 不要重写）：
  //   - publish_date ← createTime（上游入库时间，approximate publish date）
  //   - original_url ← reportUrl（原始 PDF/docx，区别于 parsed markdown_url）
  //   - file_type    ← detectedFileType / finalType（pdf / docx / etc.）
  const mongoDoc = (rawFile.mongoDoc ?? {}) as Record<string, unknown>;
  const publishDate =
    typeof mongoDoc.createTime === "string"
      ? mongoDoc.createTime.slice(0, 10)
      : null;
  const originalUrl =
    typeof mongoDoc.reportUrl === "string" ? mongoDoc.reportUrl : null;
  const fileType =
    typeof mongoDoc.detectedFileType === "string"
      ? mongoDoc.detectedFileType
      : typeof mongoDoc.finalType === "string"
        ? mongoDoc.finalType
        : null;

  const frontmatter: Record<string, unknown> = {
    research_id: rawFile.researchId,
    research_type: rawFile.researchType,
    markdown_url: rawFile.markdownUrl,
    tags: rawFile.tags ?? [],
  };
  if (publishDate) frontmatter.publish_date = publishDate;
  if (originalUrl) frontmatter.original_url = originalUrl;
  if (fileType) frontmatter.file_type = fileType;

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
          frontmatter,
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
