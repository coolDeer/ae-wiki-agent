/**
 * page_comments DB helper（web 层用）。
 *
 * 没有 auth 系统：author 是 form 里的 free-text；create_by 用 actor 'web:human'
 * 表示来自 web UI 的人工写入，与 'agent:*' / 'system:*' 分清。
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withAudit, withCreateAudit } from "~/core/audit.ts";

const WEB_HUMAN_ACTOR = "web:human";

export async function resolvePageId(identifier: string): Promise<bigint | null> {
  // 数字 → 直接当 id；非数字 → 当 slug 查
  if (/^\d+$/.test(identifier)) {
    const id = BigInt(identifier);
    const [row] = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(and(eq(schema.pages.id, id), eq(schema.pages.deleted, 0)))
      .limit(1);
    return row?.id ?? null;
  }
  const [row] = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, identifier), eq(schema.pages.deleted, 0)))
    .limit(1);
  return row?.id ?? null;
}

export async function addPageComment(opts: {
  pageId: bigint;
  author: string;
  content: string;
  parentId?: bigint;
  metadata?: Record<string, unknown>;
}): Promise<{ id: bigint }> {
  const [row] = await db
    .insert(schema.pageComments)
    .values(
      withCreateAudit(
        {
          pageId: opts.pageId,
          author: opts.author,
          content: opts.content,
          parentId: opts.parentId ?? null,
          metadata: opts.metadata ?? {},
        },
        WEB_HUMAN_ACTOR
      )
    )
    .returning({ id: schema.pageComments.id });
  if (!row) throw new Error("failed to insert page_comment");
  return { id: row.id };
}

export async function deletePageComment(commentId: bigint): Promise<void> {
  await db
    .update(schema.pageComments)
    .set(withAudit({ deleted: 1 }, WEB_HUMAN_ACTOR))
    .where(
      and(
        eq(schema.pageComments.id, commentId),
        eq(schema.pageComments.deleted, 0)
      )
    );
}

export interface PageCommentRow {
  id: string;
  author: string;
  content: string;
  parent_id: string | null;
  metadata: Record<string, unknown>;
  create_time: string;
}

export async function listPageComments(pageId: bigint): Promise<PageCommentRow[]> {
  const rows = await db.execute(sql`
    SELECT id::text AS id,
           author,
           content,
           parent_id::text AS parent_id,
           metadata,
           create_time::text AS create_time
    FROM page_comments
    WHERE page_id = ${pageId}
      AND deleted = 0
    ORDER BY create_time ASC
  `);
  return rows.map((r) => {
    const row = r as unknown as PageCommentRow & { parent_id: string | null };
    return {
      id: String(row.id),
      author: String(row.author),
      content: String(row.content),
      parent_id: row.parent_id ? String(row.parent_id) : null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      create_time: String(row.create_time),
    };
  });
}
