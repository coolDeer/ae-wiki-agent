/**
 * ingest skill — gbrain 风格的"thin harness"
 *
 * core 不做 LLM 推理，只做确定性落库。"理解原文 → 写 narrative" 由 agent 层
 * （`skills/ae-research-ingest/SKILL.md`）执行，调多段式 CLI 串联：
 *
 *   Triage 流程：
 *     1. ingest:peek                 — 列下一份候选 raw（不写库），返回 V2 信号 + preview
 *     2a. ingest:pass <rf> --reason  — agent 判定无关，标 raw_file 跳过
 *     2b. ingest:commit <rf>         — agent 判定值得（深度 source），建 page 骨架 + chunks（Stage 1+2）
 *     2c. ingest:brief  <rf>         — agent 判定为前沿动态（轻量 brief），建 page 骨架 + chunks
 *     3. ingest:write <pg> [--file] — agent 通过 --file 或 stdin 写 narrative
 *     4. ingest:finalize <pg> [--from N] — 跑 Stage 4-8 收尾（断点可续）
 *
 *   兜底：ingest:skip <pg> --reason  — 已 commit/brief 后才发现不对（清理 page + 标 raw_file）
 *
 * 详细见 doc/architecture.md §4.1 与 skills/ae-research-ingest/SKILL.md。
 */

import { asc, eq, isNull, and, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { Actor } from "~/core/audit.ts";
import { fetchContentListV2, fetchRawMarkdown } from "~/core/raw-loader.ts";
import type { IngestContext } from "~/core/types.ts";
import { summarizeV2, type V2Stats } from "~/core/v2-stats.ts";

import { stage1CreateSkeleton } from "./stage-1-skeleton.ts";
import { stage2Chunk } from "./stage-2-chunk.ts";
import { stage3WriteNarrative } from "./stage-3-narrative.ts";
import { stage4Links } from "./stage-4-links.ts";
import { stage5Facts } from "./stage-5-facts.ts";
import { stage6Jobs } from "./stage-6-jobs.ts";
import { stage7Timeline } from "./stage-7-timeline.ts";
import { stage8Thesis } from "./stage-8-thesis.ts";

interface IngestOptions {
  limit?: number;
  force?: boolean;
}

// ============================================================================
// Triage 三件套（peek / commit / pass）—— B 方案：先看再做
// ============================================================================

const PEEK_PREVIEW_CHARS = 1500;

export interface PeekResult {
  rawFileId: bigint;
  markdownUrl: string;
  title: string;
  researchType: string | null;
  rawCharCount: number;
  preview: string;
  /** V2 content_list 是否可用（缺则 commit 后 stage-2 会 throw） */
  hasContentListV2: boolean;
  /** V2 结构信号（hasContentListV2=false 时为 null）— 帮助 0 阅读量做 triage */
  v2Stats: V2Stats | null;
  /** V2 不可用时的告警，agent 应直接 pass（reason 引用此告警） */
  warning?: string;
}

/**
 * Peek：列下一份候选 raw_file，返回 preview + V2 结构信号（不写库）。
 * agent 看完后调 ingest:commit（继续）/ ingest:brief（轻量）/ ingest:pass（跳过）。
 */
export async function ingestPeek(): Promise<PeekResult | null> {
  const [rf] = await pickPending({ limit: 1 });
  if (!rf) return null;

  const [rawMarkdown, v2] = await Promise.all([
    fetchRawMarkdown(rf),
    fetchContentListV2(rf),
  ]);
  const preview =
    rawMarkdown.length > PEEK_PREVIEW_CHARS
      ? rawMarkdown.slice(0, PEEK_PREVIEW_CHARS) + "\n... [truncated]"
      : rawMarkdown;

  const hasV2 = Array.isArray(v2) && v2.length > 0 && Array.isArray(v2[0]);
  const v2Stats = hasV2 ? summarizeV2(v2!) : null;
  const warning = hasV2
    ? undefined
    : `V2 content_list 缺失（parsed_content_list_v2_url=${
        rf.parsedContentListV2Url ?? "null"
      }）。commit 会在 stage-2 失败；建议 ingest:pass 跳过此 raw。`;

  return {
    rawFileId: rf.id,
    markdownUrl: rf.markdownUrl,
    title: rf.title ?? "(untitled)",
    researchType: rf.researchType,
    rawCharCount: rawMarkdown.length,
    preview,
    hasContentListV2: hasV2,
    v2Stats,
    ...(warning ? { warning } : {}),
  };
}

/**
 * Pass：raw 不值得 ingest（噪声 / 无关），直接标 skip，不建 page。
 * 比 ingest:skip 干净 —— 没有 page id 浪费、没有半成品 chunks。
 */
export async function ingestPass(
  rawFileId: bigint,
  reason: string,
  actor: string
): Promise<void> {
  const [rf] = await db
    .select({
      id: schema.rawFiles.id,
      ingestedAt: schema.rawFiles.ingestedAt,
      skippedAt: schema.rawFiles.skippedAt,
    })
    .from(schema.rawFiles)
    .where(and(eq(schema.rawFiles.id, rawFileId), eq(schema.rawFiles.deleted, 0)))
    .limit(1);
  if (!rf) throw new Error(`raw_file #${rawFileId} 不存在或已删除`);
  if (rf.ingestedAt) throw new Error(`raw_file #${rawFileId} 已被 ingest，无法 pass；如要清理用 ingest:skip <pageId>`);
  if (rf.skippedAt) {
    console.warn(`raw_file #${rawFileId} 已被跳过过，更新 reason`);
  }

  await db
    .update(schema.rawFiles)
    .set({
      triageDecision: "pass",
      skippedAt: new Date(),
      skipReason: reason,
      updateBy: actor,
      updateTime: new Date(),
    })
    .where(eq(schema.rawFiles.id, rawFileId));

  await db.insert(schema.events).values({
    actor,
    action: "ingest_pass",
    entityType: "raw_file",
    entityId: rawFileId,
    payload: { reason },
    createBy: actor,
    updateBy: actor,
  });

  console.log(`✓ raw_file #${rawFileId} passed: ${reason}`);
}

/**
 * Commit：peek 后判定值得 ingest，跑 Stage 1+2 建 page 骨架 + chunks。
 * 返回 pageId / markdownUrl，供 agent 接下来读 raw 写 narrative。
 */
export async function ingestCommit(rawFileId: bigint): Promise<{
  rawFileId: bigint;
  pageId: bigint;
  markdownUrl: string;
  title: string;
  researchType: string | null;
}> {
  return commitInternal(rawFileId, "source");
}

/**
 * Brief：peek 后判定为"轻量前沿动态"（值得留痕但跟投资弱相关），
 * 走 type='brief' 路径。slug 用 briefs/ 前缀，narrative 模板极简
 * （title + 1-2 句摘要 + URL + tags），不要求 7 段。
 *
 * 复用 stage1+2 流程，差异仅在 page.type 和 slug 前缀。
 */
export async function ingestBrief(rawFileId: bigint): Promise<{
  rawFileId: bigint;
  pageId: bigint;
  markdownUrl: string;
  title: string;
  researchType: string | null;
}> {
  return commitInternal(rawFileId, "brief");
}

async function commitInternal(
  rawFileId: bigint,
  type: "source" | "brief"
): Promise<{
  rawFileId: bigint;
  pageId: bigint;
  markdownUrl: string;
  title: string;
  researchType: string | null;
}> {
  const [rf] = await db
    .select()
    .from(schema.rawFiles)
    .where(and(eq(schema.rawFiles.id, rawFileId), eq(schema.rawFiles.deleted, 0)))
    .limit(1);
  if (!rf) throw new Error(`raw_file #${rawFileId} 不存在或已删除`);
  if (rf.ingestedAt) throw new Error(`raw_file #${rawFileId} 已 ingest（page=${rf.ingestedPageId}）`);
  if (rf.skippedAt) throw new Error(`raw_file #${rawFileId} 已被跳过 (${rf.skipReason})；如要重新启用先撤销 skip`);

  console.log(`[ingest:${type === "brief" ? "brief" : "commit"}] raw_file #${rf.id}: ${rf.title}`);
  const ctx = await buildContext(rf);
  ctx.pageId = await stage1CreateSkeleton(ctx, rf, { type });
  await stage2Chunk(ctx);

  await db
    .update(schema.rawFiles)
    .set({
      triageDecision: type === "source" ? "commit" : "brief",
      updateBy: ctx.actor,
      updateTime: new Date(),
    })
    .where(eq(schema.rawFiles.id, rawFileId));

  return {
    rawFileId: rf.id,
    pageId: ctx.pageId,
    markdownUrl: rf.markdownUrl,
    title: rf.title ?? "(untitled)",
    researchType: rf.researchType,
  };
}

// ============================================================================
// 三段式 ingest（agent 在中间充当 LLM）
// ============================================================================

/**
 * Step 2/4: agent 写完 narrative 后落库（pages.content + page_versions snapshot）。
 */
export async function ingestWriteNarrative(
  pageId: bigint,
  narrative: string
): Promise<void> {
  await stage3WriteNarrative(pageId, narrative, Actor.agentClaude);
  console.log(`[ingest:write] page #${pageId} narrative ${narrative.length} chars`);
}

/**
 * Triage 跳过：raw 不值得 ingest（噪声 / 与投资研究无关）。
 *
 * 软删 page + 软删 raw_file（防止重新被 pickPending 拿到），写 events 留痕。
 * agent 在 ingest:next 之后、ingest:write 之前判断后调用。
 */
export async function ingestSkip(
  pageId: bigint,
  reason: string,
  actor: string
): Promise<{ rawFileId: bigint | null }> {
  // 反查 raw_file（同 finalize 的逻辑：靠 ingest_start event 关联）
  const linked = await db
    .select({ id: schema.rawFiles.id })
    .from(schema.rawFiles)
    .where(
      drizzleSql`EXISTS (
        SELECT 1 FROM events e
        WHERE e.action = 'ingest_start'
          AND e.entity_type = 'page'
          AND e.entity_id = ${pageId}
          AND (e.payload->>'rawFileId')::bigint = ${schema.rawFiles.id}
      )`
    )
    .limit(1);
  const rawFileId = linked[0]?.id ?? null;

  await db
    .update(schema.pages)
    .set({
      deleted: 1,
      status: "archived",
      updateBy: actor,
      updateTime: new Date(),
    })
    .where(eq(schema.pages.id, pageId));

  if (rawFileId !== null) {
    await db
      .update(schema.rawFiles)
      .set({
        triageDecision: "pass",
        skippedAt: new Date(),
        skipReason: reason,
        updateBy: actor,
        updateTime: new Date(),
      })
      .where(eq(schema.rawFiles.id, rawFileId));
  }

  await db.insert(schema.events).values({
    actor,
    action: "ingest_skip",
    entityType: "page",
    entityId: pageId,
    payload: { reason, rawFileId: rawFileId?.toString() ?? null },
    createBy: actor,
    updateBy: actor,
  });

  console.log(
    `✓ page #${pageId} skipped${rawFileId ? ` (raw_file #${rawFileId})` : ""}: ${reason}`
  );
  return { rawFileId };
}

/**
 * Step 3/3: 跑 Stage 4-8 收尾，标记 raw_files 已 ingest。
 */
export async function ingestFinalize(pageId: bigint): Promise<void> {
  // 反查 raw_file（通过 ingested_page_id 还没被设置时不能用，所以从 events 找回 rawFileId）
  const linked = await db
    .select({ id: schema.rawFiles.id, markdownUrl: schema.rawFiles.markdownUrl })
    .from(schema.rawFiles)
    .where(
      and(
        drizzleSql`${schema.rawFiles.deleted} = 0`,
        // raw_files 还没标记 ingested_page_id（finalize 之前的状态）
        // 我们靠 events 表里 ingest_start 的关联
        drizzleSql`EXISTS (
          SELECT 1 FROM events e
          WHERE e.action = 'ingest_start'
            AND e.entity_type = 'page'
            AND e.entity_id = ${pageId}
            AND (e.payload->>'rawFileId')::bigint = ${schema.rawFiles.id}
        )`
      )
    )
    .limit(1);

  const rf = linked[0];
  if (!rf) {
    throw new Error(`无法定位 page #${pageId} 对应的 raw_file（events 中无 ingest_start 记录）`);
  }

  const rawMarkdown = await fetchRawMarkdown(rf);

  const ctx: IngestContext = {
    rawFileId: rf.id,
    pageId,
    rawMarkdown,
    contentListJson: undefined,
    actor: Actor.systemIngest,
  };

  await stage4Links(ctx);
  await stage5Facts(ctx);
  await stage6Jobs(ctx);
  await stage7Timeline(ctx);
  await stage8Thesis(ctx);
  await markIngested(rf.id, ctx.pageId, ctx.actor);
  console.log(`✓ page #${pageId} finalized`);
}

// ============================================================================
// 共享工具
// ============================================================================

async function pickPending(opts: IngestOptions): Promise<(typeof schema.rawFiles.$inferSelect)[]> {
  return db
    .select()
    .from(schema.rawFiles)
    .where(
      and(
        eq(schema.rawFiles.deleted, 0),
        eq(schema.rawFiles.triageDecision, "pending"),
        isNull(schema.rawFiles.skippedAt),
        opts.force ? undefined : isNull(schema.rawFiles.ingestedAt)
      )
    )
    .orderBy(asc(schema.rawFiles.createTime), asc(schema.rawFiles.id))
    .limit(opts.limit ?? 100);
}

async function buildContext(
  rf: typeof schema.rawFiles.$inferSelect
): Promise<IngestContext> {
  const [rawMarkdown, contentListV2] = await Promise.all([
    fetchRawMarkdown(rf),
    fetchContentListV2(rf),
  ]);
  return {
    rawFileId: rf.id,
    pageId: 0n,
    rawMarkdown,
    contentListJson: contentListV2 ?? undefined,
    actor: Actor.systemIngest,
  };
}

async function markIngested(
  rawFileId: bigint,
  pageId: bigint,
  actor: string
): Promise<void> {
  await db
    .update(schema.rawFiles)
    .set({
      ingestedPageId: pageId,
      ingestedAt: new Date(),
      updateBy: actor,
      updateTime: new Date(),
    })
    .where(eq(schema.rawFiles.id, rawFileId));
}
