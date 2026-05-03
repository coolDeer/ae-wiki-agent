/**
 * MCP-agnostic query helpers — MCP 查询工具集合。
 *
 * 设计原则：
 *   - 每个函数返回 plain JSON-serializable 对象（bigint → string）
 *   - 默认带 `WHERE deleted = 0` 过滤
 *   - 不暴露 raw SQL，agent 只能走这 5 个口子
 */

import { eq, and, desc, isNull, sql as drizzleSql, gte } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { hybridSearch, type SearchOpts } from "~/core/search/hybrid.ts";
import {
  isTableBundle,
  type TableArtifact,
} from "~/core/v2-tables.ts";

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
    section_path: h.sectionPath,
    ...(h.debug ? { debug: h.debug } : {}),
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
    display_name: page.displayName,
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
  /** 仅查带 table provenance 的 facts */
  tableOnly?: boolean;
  /** 只查某个 table_id */
  tableId?: string;
  /** 返回 provenance 对应的原始表格 artifact */
  includeRawTable?: boolean;
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
    args.tableOnly ? drizzleSql`f.metadata->>'table_id' IS NOT NULL` : drizzleSql``,
    args.tableId ? drizzleSql`f.metadata->>'table_id' = ${args.tableId}` : drizzleSql``,
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

  const mapped = await Promise.all((rows as unknown as Array<Record<string, unknown>>).map(async (r) => {
    const metadata = (r.metadata ?? null) as Record<string, unknown> | null;
    const tableProvenance =
      metadata && typeof metadata === "object" && metadata.table_id
        ? {
            table_id: metadata.table_id,
            row_index: metadata.row_index ?? null,
            column_index: metadata.column_index ?? null,
            period_header: metadata.period_header ?? null,
            metric_header: metadata.metric_header ?? null,
            cell_ref: metadata.cell_ref ?? null,
            header_path: metadata.header_path ?? null,
          }
        : null;
    const rawTable =
      args.includeRawTable && tableProvenance && r.source_id
        ? await loadRawTableArtifact(BigInt(String(r.source_id)), String(tableProvenance.table_id))
        : null;

    return {
      id: String(r.id),
      entity: {
        id: String(r.entity_id),
        slug: r.entity_slug,
        title: r.entity_title,
        ticker: r.ticker,
      },
      metric: r.metric,
      period: r.period,
      value_numeric:
        r.value_numeric == null ? null : parseFloat(String(r.value_numeric)),
      value_text: r.value_text,
      unit: r.unit,
      confidence:
        r.confidence == null ? null : parseFloat(String(r.confidence)),
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      metadata,
      table_provenance: tableProvenance,
      raw_table: rawTable,
      source: r.source_id
        ? { id: String(r.source_id), slug: r.source_slug, title: r.source_title }
        : null,
    };
  }));

  return mapped;
}

export interface CompareTableFactsArgs {
  metric: string;
  entities?: string[];
  periods?: string[];
  sourceIdentifier?: string | number | bigint;
  currentOnly?: boolean;
  limit?: number;
}

export async function compareTableFacts(
  args: CompareTableFactsArgs
): Promise<unknown> {
  const where = [
    drizzleSql`f.deleted = 0`,
    drizzleSql`f.metric = ${args.metric}`,
    drizzleSql`f.metadata->>'table_id' IS NOT NULL`,
    args.currentOnly ? drizzleSql`f.valid_to IS NULL` : drizzleSql``,
    buildEntityFilter(args.entities),
    buildPeriodFilter(args.periods),
    buildSourceFilter(args.sourceIdentifier),
  ].filter((s) => s.queryChunks.length > 0);

  const limit = args.limit ?? 200;

  const rows = await db.execute(drizzleSql`
    SELECT
      f.id, f.metric, f.period, f.value_numeric, f.value_text, f.unit,
      f.confidence, f.valid_from, f.valid_to, f.metadata,
      ep.id AS entity_id, ep.slug AS entity_slug, ep.title AS entity_title, ep.ticker,
      sp.id AS source_id, sp.slug AS source_slug, sp.title AS source_title
    FROM facts f
    JOIN pages ep ON ep.id = f.entity_page_id
    LEFT JOIN pages sp ON sp.id = f.source_page_id
    WHERE ${drizzleSql.join(where, drizzleSql` AND `)}
    ORDER BY ep.slug ASC, f.period ASC NULLS LAST, f.valid_from DESC NULLS LAST, f.id DESC
    LIMIT ${limit}
  `);

  const rawRows = rows as unknown as Array<Record<string, unknown>>;
  const matrixByEntity = new Map<string, {
    entity: { id: string; slug: unknown; title: unknown; ticker: unknown };
    values: Record<string, unknown>;
  }>();
  const periodOrder: string[] = [];
  const usedTableKeys = new Set<string>();
  const usedTables: Array<Record<string, unknown>> = [];
  const facts: Array<Record<string, unknown>> = [];

  for (const row of rawRows) {
    const metadata = (row.metadata ?? null) as Record<string, unknown> | null;
    const period = String(row.period ?? "current");
    if (!periodOrder.includes(period)) periodOrder.push(period);

    const tableProvenance =
      metadata && typeof metadata === "object" && metadata.table_id
        ? {
            table_id: metadata.table_id,
            row_index: metadata.row_index ?? null,
            column_index: metadata.column_index ?? null,
            period_header: metadata.period_header ?? null,
            metric_header: metadata.metric_header ?? null,
            cell_ref: metadata.cell_ref ?? null,
            header_path: metadata.header_path ?? null,
          }
        : null;

    const fact = {
      id: String(row.id),
      entity: {
        id: String(row.entity_id),
        slug: row.entity_slug,
        title: row.entity_title,
        ticker: row.ticker,
      },
      metric: row.metric,
      period: row.period,
      value_numeric:
        row.value_numeric == null ? null : parseFloat(String(row.value_numeric)),
      value_text: row.value_text,
      unit: row.unit,
      confidence:
        row.confidence == null ? null : parseFloat(String(row.confidence)),
      valid_from: row.valid_from,
      valid_to: row.valid_to,
      metadata,
      table_provenance: tableProvenance,
      source: row.source_id
        ? {
            id: String(row.source_id),
            slug: row.source_slug,
            title: row.source_title,
          }
        : null,
    };
    facts.push(fact);

    const entitySlug = String(row.entity_slug);
    const entityEntry =
      matrixByEntity.get(entitySlug) ??
      {
        entity: {
          id: String(row.entity_id),
          slug: row.entity_slug,
          title: row.entity_title,
          ticker: row.ticker,
        },
        values: {},
      };

    if (!(period in entityEntry.values)) {
      entityEntry.values[period] = {
        value_numeric: fact.value_numeric,
        value_text: fact.value_text,
        unit: fact.unit,
        confidence: fact.confidence,
        valid_from: fact.valid_from,
        valid_to: fact.valid_to,
        source: fact.source,
        table_provenance: fact.table_provenance,
      };
    }
    matrixByEntity.set(entitySlug, entityEntry);

    if (fact.source && tableProvenance) {
      const usedTableKey = `${fact.source.id}:${String(tableProvenance.table_id)}`;
      if (!usedTableKeys.has(usedTableKey)) {
        usedTableKeys.add(usedTableKey);
        usedTables.push({
          source: fact.source,
          table_id: tableProvenance.table_id,
          metric: fact.metric,
          period: fact.period,
          row_index: tableProvenance.row_index,
          column_index: tableProvenance.column_index,
          period_header: tableProvenance.period_header,
          metric_header: tableProvenance.metric_header,
          cell_ref: tableProvenance.cell_ref,
          header_path: tableProvenance.header_path,
        });
      }
    }
  }

  return {
    metric: args.metric,
    periods: args.periods?.length ? args.periods : periodOrder,
    entities: Array.from(matrixByEntity.values()).map((row) => row.entity),
    matrix: Array.from(matrixByEntity.values()),
    facts_count: facts.length,
    facts,
    used_tables: usedTables,
  };
}

export async function getTableArtifact(
  identifier: string | number | bigint,
  tableId?: string
): Promise<unknown> {
  const page = await getPage(identifier) as Record<string, unknown> | null;
  if (!page) return null;

  const pageId = BigInt(String(page.id));
  const [raw] = await db
    .select({ data: schema.rawData.data })
    .from(schema.rawData)
    .where(
      and(
        eq(schema.rawData.pageId, pageId),
        eq(schema.rawData.source, "tables"),
        eq(schema.rawData.deleted, 0)
      )
    )
    .limit(1);

  if (!raw || !isTableBundle(raw.data)) {
    return {
      page: {
        id: page.id,
        slug: page.slug,
        title: page.title,
      },
      table_count: 0,
      tables: [],
    };
  }

  const tables = tableId
    ? raw.data.tables.filter((table) => table.table_id === tableId)
    : raw.data.tables;

  return {
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
    },
    extracted_at: raw.data.extractedAt,
    table_count: tables.length,
    tables,
  };
}

async function loadRawTableArtifact(
  pageId: bigint,
  tableId: string
): Promise<TableArtifact | null> {
  const [raw] = await db
    .select({ data: schema.rawData.data })
    .from(schema.rawData)
    .where(
      and(
        eq(schema.rawData.pageId, pageId),
        eq(schema.rawData.source, "tables"),
        eq(schema.rawData.deleted, 0)
      )
    )
    .limit(1);

  if (!raw || !isTableBundle(raw.data)) return null;
  return raw.data.tables.find((table) => table.table_id === tableId) ?? null;
}

function buildEntityFilter(entities?: string[]): ReturnType<typeof drizzleSql> {
  if (!entities || entities.length === 0) return drizzleSql``;
  const clauses = entities.map(
    (entity) => drizzleSql`(ep.slug = ${entity} OR ep.ticker = ${entity})`
  );
  return drizzleSql`(${drizzleSql.join(clauses, drizzleSql` OR `)})`;
}

function buildPeriodFilter(periods?: string[]): ReturnType<typeof drizzleSql> {
  if (!periods || periods.length === 0) return drizzleSql``;
  const values = periods.map((period) => drizzleSql`${period}`);
  return drizzleSql`f.period IN (${drizzleSql.join(values, drizzleSql`, `)})`;
}

function buildSourceFilter(
  sourceIdentifier?: string | number | bigint
): ReturnType<typeof drizzleSql> {
  if (sourceIdentifier == null) return drizzleSql``;

  const raw = String(sourceIdentifier);
  if (/^\d+$/.test(raw)) {
    return drizzleSql`sp.id = ${BigInt(raw)}`;
  }
  return drizzleSql`sp.slug = ${raw}`;
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
// 5. resolve_wikilink — pg_trgm 模糊找最接近的 slug（agent 写 narrative 前用）
// ============================================================================

export interface ResolveWikilinkArgs {
  /** 自由文本 hint，可以是英文 / 中文 / ticker / 部分 slug */
  hint: string;
  /**
   * 限定 type（推荐传，匹配更准）。Agent 写 `[[sources/X]]` 时传 'source'，
   * 写 `[[theses/X]]` 时传 'thesis' —— 这两个 type 是 stage-4 不会自动建红链的，
   * 必须先确认存在。
   */
  type?: string;
  /** 默认 5 */
  limit?: number;
  /** 相似度阈值（0-1），低于此值不返回；默认 0.15 */
  minSimilarity?: number;
}

export async function resolveWikilink(
  args: ResolveWikilinkArgs
): Promise<unknown> {
  const limit = args.limit ?? 5;
  const minSim = args.minSimilarity ?? 0.15;

  // 用 GREATEST(similarity, word_similarity) 双轨：
  //   - similarity() 适合 hint 与 slug/title 整体相似（拼写错误等）
  //   - word_similarity() 适合 hint 是 title 子串（H200 channel check ⊂ 长 title）
  // 不再依赖 % 操作符（默认阈值 0.3 会漏掉合理候选），手动按 minSim 过滤。
  const rows = await db.execute(drizzleSql`
    SELECT id, slug, type, title, ticker, confidence,
           similarity(slug, ${args.hint}) AS slug_sim,
           similarity(title, ${args.hint}) AS title_sim,
           word_similarity(${args.hint}, title) AS word_sim,
           GREATEST(
             similarity(slug, ${args.hint}),
             similarity(title, ${args.hint}),
             word_similarity(${args.hint}, title)
           ) AS sim
    FROM pages
    WHERE deleted = 0
      ${args.type ? drizzleSql`AND type = ${args.type}` : drizzleSql``}
      AND GREATEST(
        similarity(slug, ${args.hint}),
        similarity(title, ${args.hint}),
        word_similarity(${args.hint}, title)
      ) >= ${minSim}
    ORDER BY sim DESC
    LIMIT ${limit}
  `);

  const candidates = (rows as unknown as Array<Record<string, unknown>>)
    .map((r) => ({
      id: String(r.id),
      slug: r.slug as string,
      type: r.type as string,
      title: r.title as string,
      ticker: r.ticker as string | null,
      confidence: r.confidence as string | null,
      similarity:
        typeof r.sim === "string" ? parseFloat(r.sim) : (r.sim as number),
    }))
    .filter((c) => c.similarity >= minSim);

  return {
    hint: args.hint,
    filtered_type: args.type ?? null,
    candidates,
    best_match: candidates[0] ?? null,
    advice:
      candidates.length === 0
        ? "no match found — for source/thesis pages, write plain text instead of [[wikilink]]"
        : candidates[0]!.similarity >= 0.5
        ? `confident match — use slug "${candidates[0]!.slug}"`
        : "low-confidence matches — verify by calling get_page on the suggested slug before using as wikilink",
  };
}

// ============================================================================
// 6. recent_activity — 最近事件 / 信号 / 新页
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

// ============================================================================
// 8. entity_pulse — entity 级 PM dashboard：typed-edge 分布 + 最近来源 + facts 概览
// ============================================================================

export interface EntityPulseArgs {
  identifier: string | number | bigint;
  /** 最近 N 条 inbound source（默认 10）*/
  recentLimit?: number;
  /** 最近 N 条 facts（默认 10）*/
  factLimit?: number;
}

export async function entityPulse(args: EntityPulseArgs): Promise<unknown> {
  const recentLimit = args.recentLimit ?? 10;
  const factLimit = args.factLimit ?? 10;

  // 1. 解析 identifier → page
  const isNumeric =
    typeof args.identifier === "number" ||
    typeof args.identifier === "bigint" ||
    /^\d+$/.test(String(args.identifier));
  const [page] = isNumeric
    ? await db
        .select()
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, BigInt(args.identifier as string | number | bigint)),
            eq(schema.pages.deleted, 0)
          )
        )
        .limit(1)
    : await db
        .select()
        .from(schema.pages)
        .where(
          and(eq(schema.pages.slug, String(args.identifier)), eq(schema.pages.deleted, 0))
        )
        .limit(1);

  if (!page) return { error: `entity not found: ${args.identifier}` };

  // 2-5. 并行跑所有 SQL（serial 之前 ~6.7s，parallel ~1.3s）。
  // limit=0 的查询直接跳过，避免浪费 roundtrip。
  const [inboundDist, outboundDist, recentInbound, factSummary, latestFacts] =
    await Promise.all([
      db.execute(drizzleSql`
        SELECT link_type, COUNT(*)::int AS c
        FROM links
        WHERE deleted = 0 AND to_page_id = ${page.id}
        GROUP BY 1 ORDER BY c DESC
      `),
      db.execute(drizzleSql`
        SELECT link_type, COUNT(*)::int AS c
        FROM links
        WHERE deleted = 0 AND from_page_id = ${page.id}
        GROUP BY 1 ORDER BY c DESC
      `),
      recentLimit > 0
        ? db.execute(drizzleSql`
            SELECT l.link_type, l.context,
                   p.slug AS from_slug, p.title AS from_title, p.type AS from_type,
                   p.create_time::text AS source_date
            FROM links l
            JOIN pages p ON p.id = l.from_page_id
            WHERE l.deleted = 0 AND l.to_page_id = ${page.id}
              AND p.deleted = 0
            ORDER BY p.create_time DESC
            LIMIT ${recentLimit}
          `)
        : Promise.resolve([] as unknown as Awaited<ReturnType<typeof db.execute>>),
      db.execute(drizzleSql`
        SELECT COUNT(*)::int AS fact_count,
               COUNT(DISTINCT metric)::int AS distinct_metrics,
               COUNT(DISTINCT source_page_id)::int AS distinct_sources
        FROM facts
        WHERE deleted = 0 AND entity_page_id = ${page.id}
      `),
      factLimit > 0
        ? db.execute(drizzleSql`
            SELECT f.metric, f.value_numeric, f.value_text, f.unit, f.period,
                   f.valid_from::text AS valid_from,
                   p.slug AS source_slug
            FROM facts f
            LEFT JOIN pages p ON p.id = f.source_page_id
            WHERE f.deleted = 0 AND f.entity_page_id = ${page.id}
            ORDER BY f.valid_from DESC, f.id DESC
            LIMIT ${factLimit}
          `)
        : Promise.resolve([] as unknown as Awaited<ReturnType<typeof db.execute>>),
    ]);

  // 5. 共识强度：confirms - contradicts 比例
  const inboundDistTyped = inboundDist as unknown as Array<{ link_type: string; c: number }>;
  const outboundDistTyped = outboundDist as unknown as Array<{ link_type: string; c: number }>;
  const confirmCount = inboundDistTyped.find((r) => r.link_type === "confirms")?.c ?? 0;
  const contradictCount = inboundDistTyped.find((r) => r.link_type === "contradicts")?.c ?? 0;
  const consensusStrength =
    confirmCount + contradictCount === 0
      ? null
      : (confirmCount - contradictCount) / (confirmCount + contradictCount);

  return {
    page: {
      id: page.id.toString(),
      slug: page.slug,
      title: page.title,
      type: page.type,
      ticker: page.ticker,
      sector: page.sector,
      confidence: page.confidence,
    },
    link_breakdown: {
      inbound: Object.fromEntries(inboundDistTyped.map((r) => [r.link_type, r.c])),
      outbound: Object.fromEntries(outboundDistTyped.map((r) => [r.link_type, r.c])),
      consensus_strength: consensusStrength, // -1..1，越高越被确认；null=没 typed-edge
    },
    recent_inbound: recentInbound,
    fact_summary: {
      ...((factSummary as Array<Record<string, number>>)[0] ?? {}),
      latest_facts: (
        latestFacts as Array<Record<string, unknown>>
      ).map((f) => ({
        ...f,
        value:
          f.value_numeric !== null
            ? Number(f.value_numeric as string)
            : f.value_text ?? null,
      })),
    },
  };
}

// ============================================================================
// 9. consensus_view — metric 时序 + drift 检测
// ============================================================================

export interface ConsensusViewArgs {
  /** entity slug 或 page id */
  entity: string | number | bigint;
  /** 必填：要分析的 metric（如 'revenue', 'gross_margin'）*/
  metric: string;
  /** 可选：限定 period（如 '1Q26A', 'FY2026E'）；不填则跨 period 都看 */
  period?: string;
  /** 数值化阈值：低于此 source 数（默认 2）就跳过 drift 分析，只返回 observations */
  minObservations?: number;
}

export async function consensusView(args: ConsensusViewArgs): Promise<unknown> {
  const minObs = args.minObservations ?? 2;

  // 1. 解析 entity
  const isNumeric =
    typeof args.entity === "number" ||
    typeof args.entity === "bigint" ||
    /^\d+$/.test(String(args.entity));
  const [entity] = isNumeric
    ? await db
        .select({ id: schema.pages.id, slug: schema.pages.slug, title: schema.pages.title })
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.id, BigInt(args.entity as string | number | bigint)),
            eq(schema.pages.deleted, 0)
          )
        )
        .limit(1)
    : await db
        .select({ id: schema.pages.id, slug: schema.pages.slug, title: schema.pages.title })
        .from(schema.pages)
        .where(and(eq(schema.pages.slug, String(args.entity)), eq(schema.pages.deleted, 0)))
        .limit(1);

  if (!entity) return { error: `entity not found: ${args.entity}` };

  // 2. 拉所有相关 fact 观测
  const periodFilter = args.period
    ? drizzleSql`AND f.period = ${args.period}`
    : drizzleSql``;

  const observations = await db.execute(drizzleSql`
    SELECT f.id, f.metric, f.period, f.value_numeric, f.value_text, f.unit,
           f.valid_from::text AS valid_from,
           f.confidence,
           p.slug AS source_slug, p.title AS source_title,
           p.create_time::text AS source_created_at
    FROM facts f
    LEFT JOIN pages p ON p.id = f.source_page_id
    WHERE f.deleted = 0
      AND f.entity_page_id = ${entity.id}
      AND f.metric = ${args.metric}
      ${periodFilter}
    ORDER BY f.valid_from ASC, f.id ASC
  `);

  const obsTyped = observations as Array<Record<string, unknown>>;
  const numericValues = obsTyped
    .map((o) => (o.value_numeric === null ? null : Number(o.value_numeric)))
    .filter((v): v is number => v !== null && Number.isFinite(v));

  // 3. 统计 + drift
  let stats: Record<string, unknown> | null = null;
  let drift: Record<string, unknown> | null = null;

  if (numericValues.length >= 1) {
    const sum = numericValues.reduce((a, b) => a + b, 0);
    const mean = sum / numericValues.length;
    const variance =
      numericValues.length > 1
        ? numericValues.reduce((a, b) => a + (b - mean) ** 2, 0) / (numericValues.length - 1)
        : 0;
    const std = Math.sqrt(variance);
    const min = Math.min(...numericValues);
    const max = Math.max(...numericValues);
    const latest = numericValues[numericValues.length - 1]!;
    const earliest = numericValues[0]!;
    const rangePct = mean !== 0 ? (max - min) / Math.abs(mean) : 0;

    stats = {
      count: numericValues.length,
      mean,
      std,
      min,
      max,
      range_pct: rangePct,
      latest,
      earliest,
    };

    if (numericValues.length >= minObs) {
      // 方向判定：first-half avg vs second-half avg
      const half = Math.floor(numericValues.length / 2);
      const firstAvg = numericValues.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(half, 1);
      const secondAvg =
        numericValues.slice(-half).reduce((a, b) => a + b, 0) / Math.max(half, 1);
      const driftPct = firstAvg !== 0 ? (secondAvg - firstAvg) / Math.abs(firstAvg) : 0;
      let direction: string;
      if (Math.abs(driftPct) < 0.02) direction = "stable";
      else if (driftPct > 0) direction = "rising";
      else direction = "falling";

      // outliers: |val - mean| > 1.5 * std
      const outliers = obsTyped
        .map((o, idx) => ({
          source_slug: o.source_slug,
          period: o.period,
          value: o.value_numeric === null ? null : Number(o.value_numeric),
          deviation_pct:
            std === 0 || o.value_numeric === null
              ? 0
              : (Number(o.value_numeric) - mean) / std,
        }))
        .filter((x) => Math.abs(x.deviation_pct) > 1.5 && x.value !== null);

      drift = {
        direction,
        drift_pct: driftPct,
        first_half_avg: firstAvg,
        second_half_avg: secondAvg,
        outliers,
      };
    } else {
      drift = { direction: "insufficient_data", note: `need ≥${minObs} observations` };
    }
  }

  return {
    entity: { id: entity.id.toString(), slug: entity.slug, title: entity.title },
    metric: args.metric,
    period: args.period ?? null,
    observations: obsTyped.map((o) => ({
      ...o,
      value:
        o.value_numeric !== null
          ? Number(o.value_numeric as string)
          : o.value_text ?? null,
    })),
    stats,
    drift,
  };
}
