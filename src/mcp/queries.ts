/**
 * MCP-agnostic query helpers — 5 个核心查询。
 *
 * 设计原则：
 *   - 每个函数返回 plain JSON-serializable 对象（bigint → string）
 *   - 默认带 `WHERE deleted = 0` 过滤
 *   - 不暴露 raw SQL，agent 只能走这 5 个口子
 */

import { eq, and, desc, isNull, sql as drizzleSql, gte } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { hybridSearch, type SearchOpts } from "~/core/search/hybrid.ts";

// ============================================================================
// 1. search — hybrid 检索
// ============================================================================

export async function search(
  query: string,
  opts: SearchOpts = {}
): Promise<unknown> {
  const hits = await hybridSearch(query, opts);
  return hits.map((h) => ({
    page_id: h.pageId.toString(),
    slug: h.slug,
    type: h.type,
    title: h.title,
    ticker: h.ticker,
    score: h.score,
    keyword_rank: h.keywordRank,
    semantic_rank: h.semanticRank,
    snippet: h.bestChunk?.slice(0, 200) ?? null,
  }));
}

// ============================================================================
// 2. get_page — 拿完整 page（含 frontmatter 中 agent 提炼字段）
// ============================================================================

export async function getPage(
  identifier: string | number | bigint
): Promise<unknown> {
  const isNumeric = typeof identifier === "number" || typeof identifier === "bigint" || /^\d+$/.test(String(identifier));
  const idValue = isNumeric ? BigInt(identifier as string | number | bigint) : null;
  const slugValue = isNumeric ? null : String(identifier);

  const [page] = await db
    .select()
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.deleted, 0),
        idValue
          ? eq(schema.pages.id, idValue)
          : eq(schema.pages.slug, slugValue!)
      )
    )
    .limit(1);

  if (!page) return null;

  const tags = await db
    .select({ tag: schema.tags.tag })
    .from(schema.tags)
    .where(and(eq(schema.tags.pageId, page.id), eq(schema.tags.deleted, 0)));

  const inboundLinks = await db
    .select({
      fromPageId: schema.links.fromPageId,
      linkType: schema.links.linkType,
    })
    .from(schema.links)
    .where(
      and(
        eq(schema.links.toPageId, page.id),
        eq(schema.links.deleted, 0)
      )
    )
    .limit(50);

  const outboundLinks = await db
    .select({
      toPageId: schema.links.toPageId,
      linkType: schema.links.linkType,
    })
    .from(schema.links)
    .where(
      and(
        eq(schema.links.fromPageId, page.id),
        eq(schema.links.deleted, 0)
      )
    )
    .limit(50);

  return {
    id: page.id.toString(),
    slug: page.slug,
    type: page.type,
    title: page.title,
    content: page.content,
    timeline: page.timeline,
    frontmatter: page.frontmatter,
    ticker: page.ticker,
    exchange: page.exchange,
    aliases: page.aliases,
    sector: page.sector,
    sub_sector: page.subSector,
    country: page.country,
    org_code: page.orgCode,
    status: page.status,
    confidence: page.confidence,
    create_time: page.createTime,
    update_time: page.updateTime,
    tags: tags.map((t) => t.tag),
    inbound_links_count: inboundLinks.length,
    outbound_links_count: outboundLinks.length,
  };
}

// ============================================================================
// 3. query_facts — 结构化事实查询
// ============================================================================

export interface QueryFactsArgs {
  /** entity slug 或 ticker，二选一 */
  entity?: string;
  metric?: string;
  period?: string;
  /** 仅查 latest（valid_to IS NULL） */
  currentOnly?: boolean;
  limit?: number;
}

export async function queryFacts(args: QueryFactsArgs): Promise<unknown> {
  const where = [
    drizzleSql`f.deleted = 0`,
    args.entity
      ? drizzleSql`(ep.slug = ${args.entity} OR ep.ticker = ${args.entity})`
      : drizzleSql``,
    args.metric ? drizzleSql`f.metric = ${args.metric}` : drizzleSql``,
    args.period ? drizzleSql`f.period = ${args.period}` : drizzleSql``,
    args.currentOnly ? drizzleSql`f.valid_to IS NULL` : drizzleSql``,
  ].filter((s) => s.queryChunks.length > 0);

  const limit = args.limit ?? 50;

  const rows = await db.execute(drizzleSql`
    SELECT
      f.id, f.metric, f.period, f.value_numeric, f.value_text, f.unit,
      f.confidence, f.valid_from, f.valid_to,
      f.metadata,
      ep.id AS entity_id, ep.slug AS entity_slug, ep.title AS entity_title, ep.ticker,
      sp.id AS source_id, sp.slug AS source_slug, sp.title AS source_title
    FROM facts f
    JOIN pages ep ON ep.id = f.entity_page_id
    LEFT JOIN pages sp ON sp.id = f.source_page_id
    WHERE ${drizzleSql.join(where, drizzleSql` AND `)}
    ORDER BY f.valid_from DESC NULLS LAST, f.id DESC
    LIMIT ${limit}
  `);

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    entity: {
      id: String(r.entity_id),
      slug: r.entity_slug,
      title: r.entity_title,
      ticker: r.ticker,
    },
    metric: r.metric,
    period: r.period,
    value_numeric: r.value_numeric == null ? null : parseFloat(String(r.value_numeric)),
    value_text: r.value_text,
    unit: r.unit,
    confidence: r.confidence == null ? null : parseFloat(String(r.confidence)),
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    metadata: r.metadata,
    source: r.source_id
      ? { id: String(r.source_id), slug: r.source_slug, title: r.source_title }
      : null,
  }));
}

// ============================================================================
// 4. list_entities — 按 type / sector / 等过滤列实体
// ============================================================================

export interface ListEntitiesArgs {
  type?: string;
  sector?: string;
  ticker?: string;
  confidence?: string;
  limit?: number;
}

export async function listEntities(args: ListEntitiesArgs = {}): Promise<unknown> {
  const conditions = [
    eq(schema.pages.deleted, 0),
    drizzleSql`${schema.pages.status} != 'archived'`,
  ];
  if (args.type) conditions.push(eq(schema.pages.type, args.type));
  if (args.sector) conditions.push(eq(schema.pages.sector, args.sector));
  if (args.ticker) conditions.push(eq(schema.pages.ticker, args.ticker));
  if (args.confidence) conditions.push(eq(schema.pages.confidence, args.confidence));

  const rows = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      ticker: schema.pages.ticker,
      sector: schema.pages.sector,
      confidence: schema.pages.confidence,
      updateTime: schema.pages.updateTime,
    })
    .from(schema.pages)
    .where(and(...conditions))
    .orderBy(desc(schema.pages.updateTime))
    .limit(args.limit ?? 50);

  return rows.map((r) => ({
    id: r.id.toString(),
    slug: r.slug,
    type: r.type,
    title: r.title,
    ticker: r.ticker,
    sector: r.sector,
    confidence: r.confidence,
    update_time: r.updateTime,
  }));
}

// ============================================================================
// 5. recent_activity — 最近事件 / 信号 / 新页
// ============================================================================

export interface RecentActivityArgs {
  /** 默认查最近 7 天 */
  days?: number;
  /** 'event' | 'signal' | 'page' | 'all' */
  kinds?: ("event" | "signal" | "page")[];
  limit?: number;
}

export async function recentActivity(
  args: RecentActivityArgs = {}
): Promise<unknown> {
  const days = args.days ?? 7;
  const cutoff = drizzleSql`NOW() - (${days}::int * INTERVAL '1 day')`;
  const kinds = args.kinds ?? ["event", "signal", "page"];
  const limit = args.limit ?? 30;
  const out: Array<Record<string, unknown>> = [];

  if (kinds.includes("event")) {
    const events = await db
      .select({
        id: schema.events.id,
        ts: schema.events.ts,
        actor: schema.events.actor,
        action: schema.events.action,
        entityId: schema.events.entityId,
      })
      .from(schema.events)
      .where(and(eq(schema.events.deleted, 0), gte(schema.events.ts, drizzleSql`${cutoff}`)))
      .orderBy(desc(schema.events.ts))
      .limit(limit);
    for (const e of events) {
      out.push({
        kind: "event",
        ts: e.ts,
        title: `${e.action} (${e.actor})`,
        actor: e.actor,
        action: e.action,
        entity_id: e.entityId?.toString() ?? null,
      });
    }
  }

  if (kinds.includes("signal")) {
    const signals = await db
      .select()
      .from(schema.signals)
      .where(and(eq(schema.signals.deleted, 0), gte(schema.signals.detectedAt, drizzleSql`${cutoff}`)))
      .orderBy(desc(schema.signals.detectedAt))
      .limit(limit);
    for (const s of signals) {
      out.push({
        kind: "signal",
        ts: s.detectedAt,
        title: s.title,
        signal_type: s.signalType,
        severity: s.severity,
        entity_id: s.entityPageId?.toString() ?? null,
      });
    }
  }

  if (kinds.includes("page")) {
    const pages = await db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        type: schema.pages.type,
        title: schema.pages.title,
        createTime: schema.pages.createTime,
      })
      .from(schema.pages)
      .where(and(eq(schema.pages.deleted, 0), gte(schema.pages.createTime, drizzleSql`${cutoff}`)))
      .orderBy(desc(schema.pages.createTime))
      .limit(limit);
    for (const p of pages) {
      out.push({
        kind: "page",
        ts: p.createTime,
        title: `[${p.type}] ${p.title}`,
        slug: p.slug,
        page_id: p.id.toString(),
      });
    }
  }

  // 全部按 ts 降序合并
  out.sort((a, b) => {
    const ta = new Date(a.ts as string).getTime();
    const tb = new Date(b.ts as string).getTime();
    return tb - ta;
  });
  return out.slice(0, limit);
}
