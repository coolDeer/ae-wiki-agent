/**
 * Stage 2: 内容分段
 *
 * 切分 raw markdown 为 chunks，写入 content_chunks（embedding 留空，等 Stage 6 异步算）。
 *
 * 当前优先级：
 *   1. fallback 到 gbrain 风格 recursive chunker
 *   2. 后续再接 mineru content_list.json 的结构边界
 */

import type { IngestContext } from "~/core/types.ts";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withAudit, withCreateAudit } from "~/core/audit.ts";
import { chunkText } from "~/core/chunkers/recursive.ts";
import { buildMarkdownTableBundle, splitMarkdownByTables } from "~/core/markdown-tables.ts";

export async function stage2Chunk(ctx: IngestContext): Promise<void> {
  const chunks = chunkMarkdown(ctx.rawMarkdown, ctx.contentListJson);
  const tableArtifacts = buildMarkdownTableBundle(ctx.rawMarkdown);

  if (chunks.length > 0) {
    await db.insert(schema.contentChunks).values(
      chunks.map((c, idx) =>
        withCreateAudit(
          {
            pageId: ctx.pageId,
            chunkIndex: idx,
            chunkText: c.text,
            chunkType: c.type,
            pageIdx: c.pageIdx ?? null,
          },
          ctx.actor
        )
      )
    );
  }

  await upsertTableArtifacts(ctx.pageId, tableArtifacts, ctx.actor);

  console.log(`  [stage2] chunks=${chunks.length}`);
  console.log(`  [stage2] tables=${tableArtifacts.tables.length}`);
}

interface Chunk {
  text: string;
  type: "text" | "list" | "table" | "chart" | "compiled_truth";
  pageIdx?: number;
}

function chunkMarkdown(md: string, _contentListJson: unknown): Chunk[] {
  // TODO: 接入 mineru content_list.json 后，对 table/chart/list 保持更完整的结构边界。
  const chunks: Chunk[] = [];

  for (const segment of splitMarkdownByTables(md)) {
    if (segment.type === "table") {
      chunks.push({
        text: segment.text,
        type: "table",
      });
      continue;
    }

    for (const chunk of chunkText(segment.text)) {
      chunks.push({
        text: chunk.text,
        type: "text",
      });
    }
  }

  return chunks;
}

async function upsertTableArtifacts(
  pageId: bigint,
  data: ReturnType<typeof buildMarkdownTableBundle>,
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
