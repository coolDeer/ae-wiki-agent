import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { auditFields } from "./_audit.ts";

export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: bigint("entity_id", { mode: "bigint" }),
    payload: jsonb("payload"),
    ...auditFields,
  },
  (t) => ({
    tsIdx: index("idx_events_ts").on(t.ts),
    actorTsIdx: index("idx_events_actor_ts").on(t.actor, t.ts),
    actionIdx: index("idx_events_action").on(t.action, t.ts),
  })
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
