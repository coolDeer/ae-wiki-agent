import { and, eq } from "drizzle-orm";
import matter from "gray-matter";

import { Actor, withAudit, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";

export type OutputSubtype = "daily-review" | "daily-summarize";

export interface SaveOutputPageOpts {
  subtype?: OutputSubtype;
  date?: string;
  actor?: string;
}

export interface SaveOutputPageResult {
  pageId: string;
  slug: string;
  subtype: OutputSubtype;
  date: string;
  title: string;
  created: boolean;
  contentChars: number;
  contentHash: string;
}

const OUTPUT_SLUG_RE = /^outputs\/(daily-review|daily-summarize)-(\d{4}-\d{2}-\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveOutputPage(
  markdown: string,
  opts: SaveOutputPageOpts = {}
): Promise<SaveOutputPageResult> {
  const actor = opts.actor ?? Actor.agentClaude;
  const parsed = matter(markdown);
  const rawFrontmatter = asRecord(parsed.data);
  const subtype = normalizeSubtype(opts.subtype ?? rawFrontmatter.subtype);
  const date = normalizeDate(opts.date ?? rawFrontmatter.date);
  const slug = outputSlug(subtype, date);
  const body = parsed.content.trimEnd() + "\n";
  const title = normalizeTitle(rawFrontmatter.title, subtype, date);
  const frontmatter = normalizeFrontmatter(rawFrontmatter, {
    subtype,
    date,
    title,
  });

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(markdown);
  const contentHash = hasher.digest("hex");

  const [existing] = await db
    .select({
      id: schema.pages.id,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.slug, slug), eq(schema.pages.deleted, 0)))
    .limit(1);

  let pageId: bigint;
  let created = false;
  if (existing) {
    pageId = existing.id;
    await db
      .update(schema.pages)
      .set(
        withAudit(
          {
            title,
            displayName: title,
            type: "output",
            content: body,
            timeline: "",
            frontmatter,
            contentHash,
            status: "active",
            confidence: "high",
          },
          actor
        )
      )
      .where(eq(schema.pages.id, pageId));
  } else {
    created = true;
    const [inserted] = await db
      .insert(schema.pages)
      .values(
        withCreateAudit(
          {
            sourceId: "default",
            slug,
            type: "output",
            title,
            displayName: title,
            content: body,
            timeline: "",
            frontmatter,
            contentHash,
            status: "active",
            confidence: "high",
          },
          actor
        )
      )
      .returning({ id: schema.pages.id });
    if (!inserted) throw new Error(`failed to create output page ${slug}`);
    pageId = inserted.id;
  }

  await db.insert(schema.pageVersions).values(
    withCreateAudit(
      {
        pageId,
        content: body,
        timeline: "",
        frontmatter,
        editedBy: actor,
        reason: "output:write",
      },
      actor
    )
  );

  await syncOutputTags(pageId, frontmatter.tags, actor);

  await db.insert(schema.events).values(
    withCreateAudit(
      {
        actor,
        action: "output_write",
        entityType: "page",
        entityId: pageId,
        payload: {
          slug,
          subtype,
          date,
          title,
          created,
          contentHash,
        },
      },
      actor
    )
  );

  return {
    pageId: pageId.toString(),
    slug,
    subtype,
    date,
    title,
    created,
    contentChars: body.replace(/\s+/g, " ").trim().length,
    contentHash,
  };
}

export function outputSlug(subtype: OutputSubtype, date: string): string {
  return `outputs/${subtype}-${date}`;
}

export function normalizeOutputIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  const slugMatch = trimmed.match(OUTPUT_SLUG_RE);
  if (slugMatch) return trimmed;

  const basename = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const withoutExt = basename.endsWith(".md") ? basename.slice(0, -3) : basename;
  if (withoutExt.startsWith("daily-review-") || withoutExt.startsWith("daily-summarize-")) {
    return `outputs/${withoutExt}`;
  }
  if (withoutExt.startsWith("outputs/")) return withoutExt;
  return withoutExt;
}

function normalizeSubtype(value: unknown): OutputSubtype {
  if (value === "daily-review" || value === "daily-summarize") return value;
  throw new Error("output subtype must be daily-review or daily-summarize");
}

function normalizeDate(value: unknown): string {
  if (typeof value === "string" && DATE_RE.test(value)) return value;
  throw new Error("output date must be YYYY-MM-DD");
}

function normalizeTitle(value: unknown, subtype: OutputSubtype, date: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return subtype === "daily-review"
    ? `Daily Research Review - ${date}`
    : `Daily PM Brief - ${date}`;
}

function normalizeFrontmatter(
  raw: Record<string, unknown>,
  required: { subtype: OutputSubtype; date: string; title: string }
): Record<string, unknown> {
  return {
    ...raw,
    type: "output",
    subtype: required.subtype,
    title: required.title,
    date: required.date,
    tags: normalizeTags(raw.tags, required.subtype),
    last_updated:
      typeof raw.last_updated === "string" && raw.last_updated.trim()
        ? raw.last_updated
        : new Date().toISOString(),
  };
}

async function syncOutputTags(
  pageId: bigint,
  value: unknown,
  actor: string
): Promise<void> {
  const desired = normalizeTags(value, null);
  const activeRows = await db
    .select({
      id: schema.tags.id,
      tag: schema.tags.tag,
    })
    .from(schema.tags)
    .where(and(eq(schema.tags.pageId, pageId), eq(schema.tags.deleted, 0)));

  const active = new Map(activeRows.map((row) => [row.tag, row.id]));
  const desiredSet = new Set(desired);

  for (const row of activeRows) {
    if (!desiredSet.has(row.tag)) {
      await db
        .update(schema.tags)
        .set(withAudit({ deleted: 1 }, actor))
        .where(eq(schema.tags.id, row.id));
    }
  }

  for (const tag of desired) {
    if (active.has(tag)) continue;
    await db.insert(schema.tags).values(
      withCreateAudit(
        {
          pageId,
          tag,
        },
        actor
      )
    );
  }
}

function normalizeTags(value: unknown, subtype: OutputSubtype | null): string[] {
  const raw = Array.isArray(value) ? value : [];
  const defaults =
    subtype === "daily-review"
      ? ["daily-review", "qa"]
      : subtype === "daily-summarize"
        ? ["daily-summarize", "pm-brief", "ic-briefing"]
        : [];
  const tags = [...raw.map((item) => String(item)), ...defaults]
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
