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
import { db, schema } from "~/core/db.ts";
import { withCreateAudit } from "~/core/audit.ts";
import { chunkText } from "~/core/chunkers/recursive.ts";

export async function stage2Chunk(ctx: IngestContext): Promise<void> {
  const chunks = chunkMarkdown(ctx.rawMarkdown, ctx.contentListJson);

  if (chunks.length === 0) return;

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

  console.log(`  [stage2] chunks=${chunks.length}`);
}

interface Chunk {
  text: string;
  type: "text" | "list" | "table" | "chart" | "compiled_truth";
  pageIdx?: number;
}

function chunkMarkdown(md: string, _contentListJson: unknown): Chunk[] {
  // TODO: 接入 mineru content_list.json 后，对 table/chart/list 保持结构边界。
  return chunkText(md).map((chunk) => ({
    text: chunk.text,
    type: "text" as const,
  }));
}
