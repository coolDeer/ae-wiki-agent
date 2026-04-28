import { sql as drizzleSql } from "drizzle-orm";

import { Actor } from "../src/core/audit.ts";
import { db, schema } from "../src/core/db.ts";
import { closeMongo, getResearchCollection, researchTypeName } from "../src/core/mongo.ts";

function parseDateArg() {
  const idx = process.argv.indexOf("--date");
  const raw = idx >= 0 ? process.argv[idx + 1] : undefined;
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw new Error(`invalid --date: ${raw}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function resolveDateRange(date) {
  const start = date ?? new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

const date = parseDateArg() ?? (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
})();

const range = resolveDateRange(date);
const selected = new Map();

console.log(
  `[fetch-one-per-type] createTime ∈ [${range.start.toISOString()}, ${range.end.toISOString()})`
);

try {
  const coll = await getResearchCollection();
  const cursor = coll.find({
    parseStatus: "completed",
    parsedMarkdownS3: { $ne: null },
    createTime: { $gte: range.start, $lt: range.end },
  }).sort({ createTime: -1 });

  for await (const doc of cursor) {
    const type = researchTypeName(doc.researchType);
    if (selected.has(type)) continue;
    selected.set(type, doc);
  }

  let inserted = 0;
  let skippedExisting = 0;

  for (const [type, doc] of selected.entries()) {
    const existing = await db
      .select({ id: schema.rawFiles.id })
      .from(schema.rawFiles)
      .where(drizzleSql`${schema.rawFiles.researchId} = ${doc.researchId}`)
      .limit(1);

    if (existing.length > 0) {
      skippedExisting++;
      console.log(`- skip existing ${type}: ${doc.title}`);
      continue;
    }

    await db
      .insert(schema.rawFiles)
      .values({
        sourceId: "default",
        markdownUrl: doc.parsedMarkdownS3,
        researchId: doc.researchId,
        researchType: type,
        orgCode: doc.orgCode ?? null,
        title: doc.title,
        tags: doc.tags ?? [],
        mongoDoc: doc,
        parseStatus: doc.parseStatus,
        triageDecision: "pending",
        createBy: Actor.systemFetch,
        updateBy: Actor.systemFetch,
        createTime: doc.createTime,
        updateTime: doc.updateTime,
      })
      .onConflictDoNothing({
        target: schema.rawFiles.researchId,
        where: drizzleSql`deleted = 0 AND research_id IS NOT NULL`,
      });

    inserted++;
    console.log(`+ ${type}: ${doc.title}`);
  }

  console.log(
    JSON.stringify(
      {
        date: range.start.toISOString().slice(0, 10),
        selectedTypes: selected.size,
        inserted,
        skippedExisting,
      },
      null,
      2
    )
  );
} finally {
  await closeMongo();
}
