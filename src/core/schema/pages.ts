import { sql } from "drizzle-orm";
import {
  bigint,
  customType,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

/** pgvector 类型 — Drizzle 没原生支持，用 customType。 */
const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver: (v) => `[${v.join(",")}]`,
  fromDriver: (s) => JSON.parse(s) as number[],
});

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const pages = pgTable(
  "pages",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    sourceId: text("source_id").notNull().default("default"),
    slug: text("slug").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),

    // 内容
    content: text("content").notNull().default(""),
    timeline: text("timeline").notNull().default(""),
    frontmatter: jsonb("frontmatter").notNull().default({}),
    contentHash: text("content_hash"),

    // 投资强查询字段
    ticker: text("ticker"),
    exchange: text("exchange"),
    aliases: text("aliases").array(),
    sector: text("sector"),
    subSector: text("sub_sector"),
    country: text("country"),

    // 检索
    embedding: vector("embedding", { dimensions: 1536 }),
    tsv: tsvector("tsv"),

    // 组织 / 权限
    orgCode: text("org_code"),

    // 状态
    status: text("status").notNull().default("active"),
    confidence: text("confidence"),

    ...auditFields,
  },
  (t) => ({
    sourceSlugUnique: uniqueIndex("uq_pages_source_slug")
      .on(t.sourceId, t.slug)
      .where(sql`deleted = 0`),
    typeIdx: index("idx_pages_type").on(t.type),
    tickerIdx: index("idx_pages_ticker").on(t.ticker),
    sectorIdx: index("idx_pages_sector").on(t.sector),
    updatedIdx: index("idx_pages_updated").on(sql`${t.updateTime} DESC`),
    orgIdx: index("idx_pages_org").on(t.orgCode),
  })
);

export type Page = typeof pages.$inferSelect;
export type NewPage = typeof pages.$inferInsert;

export type PageType =
  | "company"
  | "industry"
  | "concept"
  | "source"
  | "brief"
  | "thesis"
  | "output";

export type PageStatus = "active" | "draft" | "archived";

export type PageConfidence = "high" | "medium" | "low";
