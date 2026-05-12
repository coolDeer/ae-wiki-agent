import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

export const entityCandidates = pgTable(
  "entity_candidates",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    sourceId: text("source_id").notNull().default("default"),
    proposedSlug: text("proposed_slug").notNull(),
    proposedType: text("proposed_type").notNull(),
    displayName: text("display_name"),
    aliases: text("aliases").array(),
    status: text("status").notNull().default("pending"),
    evidenceCount: integer("evidence_count").notNull().default(0),
    sourcePageIds: bigint("source_page_ids", { mode: "bigint" })
      .array()
      .notNull()
      .default(sql`ARRAY[]::bigint[]`),
    lastSourcePageId: bigint("last_source_page_id", { mode: "bigint" }),
    suggestions: jsonb("suggestions").notNull().default([]),
    promotedPageId: bigint("promoted_page_id", { mode: "bigint" }),
    mergedIntoPageId: bigint("merged_into_page_id", { mode: "bigint" }),
    rejectReason: text("reject_reason"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
    ...auditFields,
  },
  (t) => ({
    sourceSlugUnique: uniqueIndex("uq_entity_candidates_source_slug")
      .on(t.sourceId, t.proposedSlug)
      .where(sql`deleted = 0`),
    statusIdx: index("idx_entity_candidates_status").on(t.status, t.lastSeenAt),
    typeIdx: index("idx_entity_candidates_type").on(t.proposedType, t.status),
    sourcePageIdsIdx: index("idx_entity_candidates_source_page_ids")
      .using("gin", t.sourcePageIds),
  })
);

export type EntityCandidate = typeof entityCandidates.$inferSelect;
export type NewEntityCandidate = typeof entityCandidates.$inferInsert;

export type EntityCandidateStatus =
  | "pending"
  | "promoted"
  | "merged"
  | "rejected";
