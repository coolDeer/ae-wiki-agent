/**
 * Stage 2: 内容分段
 *
 * 切分 raw markdown 为 chunks，写入 content_chunks（embedding 留空，等 Stage 6 异步算）。
 *
 * 优先用 mineru content_list.json 的 type 边界；fallback 用段级切分。
 *
 * TODO Phase 1：实现实际切分逻辑
 */

import type { IngestContext } from "~/core/types.ts";
import { db, schema } from "~/core/db.ts";
import { Actor, withCreateAudit } from "~/core/audit.ts";

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

/**
 * MVP 版：纯段级切分，每个非空段一个 chunk，type 一律 'text'。
 * Phase 1 实现：
 *  - 优先解析 content_list.json，按 type=text/list/table/chart 切
 *  - fallback 段级 + 标题边界
 */
function chunkMarkdown(md: string, _contentListJson: unknown): Chunk[] {
  return md
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => ({ text, type: "text" as const }));
}
