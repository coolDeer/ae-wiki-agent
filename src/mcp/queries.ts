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
