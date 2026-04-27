/**
 * enrich skill
 *
 * 功能：把 Stage 4 自动创建的红链 entity（confidence='low'）补全成正式 wiki 页。
 *
 * 三段式（同 ingest 思想）：
 *   1. enrich:next   — 选下一个待补全 entity，附带所有 backlink source 的上下文
 *   2. agent 读 backlinks，按模板写 narrative + frontmatter
 *   3. enrich:save   — stdin 写 narrative，bump confidence，更新可选字段（ticker/sector/aliases）
 *
 * core 不调 LLM——所有 narrative 由 agent 在 skills/enrich/SKILL.md 引导下生成。
 */

import { eq, and, count, desc, inArray } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withAudit, withCreateAudit, Actor } from "~/core/audit.ts";
import { tokenizeForIndex } from "~/core/tokenize.ts";
import type { PageType } from "~/core/schema/pages.ts";

export interface RedlinkContext {
  pageId: bigint;
  slug: string;
  type: string;
  title: string;
  ticker: string | null;
  /** 指向此 page 的 backlink 来源（source 页等）的简要信息 */
  backlinks: Array<{
    sourcePageId: bigint;
    sourceSlug: string;
    sourceTitle: string;
    sourceType: string;
    sourceDate: string | null;
  }>;
}

/**
 * 选下一个待 enrich 的红链 page，附带 backlink 上下文。
 *
 * 选择策略：
 *   1. confidence='low' 的 entity（Stage 4 自动建的就是 low）
 *   2. 优先 backlink 多的（被频繁提及说明值得补全）
 *   3. 排除 source 类型本身（source 不需要 enrich）
 */
export async function enrichPrepareNext(opts: {
  type?: PageType;
  /** 跳过 N 个，避免反复返回同一个（agent 跳过后想拿下一个） */
  skip?: number;
} = {}): Promise<RedlinkContext | null> {
  const skip = opts.skip ?? 0;

  // 找候选：confidence='low' 且非 source
  const candidates = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      ticker: schema.pages.ticker,
      backlinkCount: count(schema.links.id).as("backlink_count"),
    })
    .from(schema.pages)
    .leftJoin(
      schema.links,
      and(
        eq(schema.links.toPageId, schema.pages.id),
        eq(schema.links.deleted, 0)
      )
    )
    .where(
      and(
        eq(schema.pages.confidence, "low"),
        eq(schema.pages.deleted, 0),
        opts.type ? eq(schema.pages.type, opts.type) : undefined,
        // 排除 source 自身
        opts.type ? undefined : eq(schema.pages.deleted, 0)
      )
    )
    .groupBy(schema.pages.id)
    .orderBy(desc(count(schema.links.id)), schema.pages.id)
    .limit(skip + 1)
    .offset(skip);

  const target = candidates[candidates.length - 1];
  if (!target || target.type === "source") return null;

  // 拿 backlink 来源的 page 元信息
  const backlinkSources = await db
    .select({
      pageId: schema.links.fromPageId,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      createTime: schema.pages.createTime,
    })
    .from(schema.links)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.links.fromPageId))
    .where(
      and(
        eq(schema.links.toPageId, target.id),
        eq(schema.links.deleted, 0),
        eq(schema.pages.deleted, 0)
      )
    )
    .orderBy(desc(schema.pages.createTime));

  return {
    pageId: target.id,
    slug: target.slug,
    type: target.type,
    title: target.title,
    ticker: target.ticker,
    backlinks: backlinkSources.map((b) => ({
      sourcePageId: b.pageId,
      sourceSlug: b.slug,
      sourceTitle: b.title,
      sourceType: b.type,
      sourceDate: b.createTime ? b.createTime.toISOString().slice(0, 10) : null,
    })),
  };
}

export interface EnrichSaveOpts {
  /** 可选：直接更新 ticker 列 */
  ticker?: string;
  /** 可选：sector */
  sector?: string;
  /** 可选：sub_sector */
  subSector?: string;
  /** 可选：country */
  country?: string;
  /** 可选：exchange */
  exchange?: string;
  /** 可选：aliases 列表（覆盖式更新）*/
  aliases?: string[];
  /** 可选：confidence（默认 'medium'，agent 充分调研可设 'high'）*/
  confidence?: "high" | "medium" | "low";
  /** 可选：frontmatter 合并（不动现有字段，仅补充）*/
  frontmatterMerge?: Record<string, unknown>;
}

/**
 * 保存 enrich 后的 narrative。
 *   - 写 page_versions 快照（reason='enrich'）
 *   - 更新 pages.content / tokens_zh / content_hash
 *   - 更新可选字段（ticker / sector / aliases ...）
 *   - 默认 bump confidence 到 'medium'
 */
export async function enrichSave(
  pageId: bigint,
  narrative: string,
  opts: EnrichSaveOpts = {}
): Promise<void> {
  const actor = Actor.agentClaude;

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(narrative);
  const contentHash = hasher.digest("hex");
  const tokensZh = tokenizeForIndex(narrative);

  // 拿现有 frontmatter 做 merge
  const [existing] = await db
    .select({ frontmatter: schema.pages.frontmatter })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);

  const mergedFrontmatter = {
    ...(existing?.frontmatter as Record<string, unknown> ?? {}),
    ...(opts.frontmatterMerge ?? {}),
  };

  await db.insert(schema.pageVersions).values(
    withCreateAudit(
      {
        pageId,
        content: narrative,
        timeline: "",
        frontmatter: mergedFrontmatter,
        editedBy: actor,
        reason: "enrich",
      },
      actor
    )
  );

  // 构造 update set —— 只更新提供的字段
  const updateSet: Record<string, unknown> = {
    content: narrative,
    tokensZh,
    contentHash,
    confidence: opts.confidence ?? "medium",
    frontmatter: mergedFrontmatter,
  };
  if (opts.ticker !== undefined) updateSet.ticker = opts.ticker;
  if (opts.sector !== undefined) updateSet.sector = opts.sector;
  if (opts.subSector !== undefined) updateSet.subSector = opts.subSector;
  if (opts.country !== undefined) updateSet.country = opts.country;
  if (opts.exchange !== undefined) updateSet.exchange = opts.exchange;
  if (opts.aliases !== undefined) updateSet.aliases = opts.aliases;

  await db
    .update(schema.pages)
    .set(withAudit(updateSet, actor))
    .where(eq(schema.pages.id, pageId));

  // 写 event
  await db.insert(schema.events).values({
    actor,
    action: "enrich",
    entityType: "page",
    entityId: pageId,
    payload: {
      narrativeLen: narrative.length,
      confidence: opts.confidence ?? "medium",
      fieldsSet: Object.keys(opts).filter((k) => opts[k as keyof EnrichSaveOpts] !== undefined),
    },
    createBy: actor,
    updateBy: actor,
  });

  console.log(`[enrich:save] page #${pageId} narrative ${narrative.length} chars, confidence=${opts.confidence ?? "medium"}`);
}

/** 列举待 enrich 的 page（dashboard 用）*/
export async function enrichList(opts: {
  type?: PageType;
  limit?: number;
} = {}): Promise<Array<{
  pageId: bigint;
  slug: string;
  type: string;
  title: string;
  backlinkCount: number;
}>> {
  const rows = await db
    .select({
      pageId: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      backlinkCount: count(schema.links.id).as("backlink_count"),
    })
    .from(schema.pages)
    .leftJoin(
      schema.links,
      and(
        eq(schema.links.toPageId, schema.pages.id),
        eq(schema.links.deleted, 0)
      )
    )
    .where(
      and(
        eq(schema.pages.confidence, "low"),
        eq(schema.pages.deleted, 0),
        opts.type ? eq(schema.pages.type, opts.type) : undefined
      )
    )
    .groupBy(schema.pages.id)
    .orderBy(desc(count(schema.links.id)), schema.pages.id)
    .limit(opts.limit ?? 20);

  return rows.map((r) => ({
    pageId: r.pageId,
    slug: r.slug,
    type: r.type,
    title: r.title,
    backlinkCount: Number(r.backlinkCount),
  }));
}
