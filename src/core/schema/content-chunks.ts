import {
  bigint,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { auditFields } from "./_audit.ts";

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

export const contentChunks = pgTable(
  "content_chunks",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    pageId: bigint("page_id", { mode: "bigint" }).notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    chunkType: text("chunk_type").notNull().default("text"),
    pageIdx: integer("page_idx"),
    embedding: vector("embedding", { dimensions: 1536 }),
    model: text("model").notNull().default("text-embedding-3-large"),
    tokenCount: integer("token_count"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    ...auditFields,
  },
  (t) => ({
    pageChunkUnique: uniqueIndex("uq_chunks_page_index")
      .on(t.pageId, t.chunkIndex)
      .where(sql`deleted = 0`),
    pageIdx: index("idx_chunks_page").on(t.pageId),
    typeIdx: index("idx_chunks_type").on(t.chunkType),
  })
);

export type ContentChunk = typeof contentChunks.$inferSelect;
export type NewContentChunk = typeof contentChunks.$inferInsert;

export type ChunkType = "text" | "list" | "table" | "chart" | "compiled_truth";
