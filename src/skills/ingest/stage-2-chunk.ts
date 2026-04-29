/**
 * Stage 2: 内容分段
 *
 * 必须有 V2 content_list（mineru `parsedContentListV2S3`）。chunker 走 v2-block：
 * 结构化丢噪声 + section_path 全路径 + table 独立块。
 *
 * 历史包袱（markdown-only chunker）已下线——`raw_files` 全量保证有 V2 URL。
 *
 * `raw_data` 表的表格 artifact 也从 V2 派生（buildTableBundleFromV2），
 * 即 V2 是 chunker + sidecar 的统一事实源。下游 stage-5-facts / MCP 接口不变。
 */

import type { IngestContext } from "~/core/types.ts";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withAudit, withCreateAudit } from "~/core/audit.ts";
import { buildTableBundleFromV2 } from "~/core/v2-tables.ts";
import {
  chunkContentListV2,
  type V2ContentList,
} from "~/core/chunkers/v2-block.ts";

export async function stage2Chunk(ctx: IngestContext): Promise<void> {
  const v2 = asV2ContentList(ctx.contentListJson);
  if (!v2) {
    throw new Error(
      `[stage2] raw_file #${ctx.rawFileId} 缺少 V2 content_list (parsed_content_list_v2_url)；` +
        `所有 raw_files 必须有 V2，老数据已清空。检查上游 mongo doc 与 fetch-reports。`
    );
  }

  const chunks = chunkContentListV2(v2);
  const tableArtifacts = buildTableBundleFromV2(v2);

  if (chunks.length > 0) {
    await db.insert(schema.contentChunks).values(
      chunks.map((c, idx) =>
        withCreateAudit(
          {
            pageId: ctx.pageId,
            chunkIndex: idx,
            chunkText: c.text,
            chunkType: c.type,
            pageIdx: c.pageIdx,
            sectionPath: c.sectionPath,
          },
          ctx.actor
        )
      )
    );
  }

  // 0 表的 source（多数 acecamp / twitter / brief）不写空 sidecar，避免污染 raw_data。
  // 当前没有"重新切 chunks 但表减少"的流程；将来若有，需要在这里加覆盖语义。
  if (tableArtifacts.tables.length > 0) {
    await upsertTableArtifacts(ctx.pageId, tableArtifacts, ctx.actor);
  }

  console.log(`  [stage2] chunks=${chunks.length}`);
  console.log(`  [stage2] tables=${tableArtifacts.tables.length}`);
}

function asV2ContentList(json: unknown): V2ContentList | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  if (!Array.isArray(json[0])) return null;
  return json as V2ContentList;
}

async function upsertTableArtifacts(
  pageId: bigint,
  data: ReturnType<typeof buildTableBundleFromV2>,
  actor: string
): Promise<void> {
  const existing = await db
    .select({ id: schema.rawData.id })
    .from(schema.rawData)
    .where(
      and(
        eq(schema.rawData.pageId, pageId),
        eq(schema.rawData.source, "tables"),
        eq(schema.rawData.deleted, 0)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.rawData)
      .set(
        withAudit(
          {
            data,
            fetchedAt: new Date(),
          },
          actor
        )
      )
      .where(eq(schema.rawData.id, existing[0].id));
    return;
  }

  await db
    .insert(schema.rawData)
    .values(
      withCreateAudit(
        {
          pageId,
          source: "tables",
          data,
          fetchedAt: new Date(),
        },
        actor
      )
    )
    .onConflictDoUpdate({
      target: [schema.rawData.pageId, schema.rawData.source],
      targetWhere: drizzleSql`deleted = 0`,
      set: withAudit(
        {
          data,
          fetchedAt: new Date(),
        },
        actor
      ),
      setWhere: drizzleSql`${schema.rawData.deleted} = 0`,
    });
}
