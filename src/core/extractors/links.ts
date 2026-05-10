import * as YAML from "yaml";
import type { LinkSpec } from "./types.ts";

const ENTITY_DIRS = [
  "companies",
  "industries",
  "concepts",
  "sources",
  "theses",
  "outputs",
  "briefs",
];
const DIR_PATTERN = ENTITY_DIRS.join("|");
const TYPE_PREFIX_RE = /^([a-z_]+)\s*:\s*/;

const WIKILINK_RE = new RegExp(
  `\\[\\[(${DIR_PATTERN})\\/([^\\]|#]+?)(?:#[^\\]|]*?)?(?:\\|([^\\]]+?))?\\]\\]`,
  "g"
);
const MD_LINK_RE = new RegExp(
  `\\[([^\\]]+)\\]\\(((?:\\.\\.\\/)*(${DIR_PATTERN})\\/[^)\\s]+?)(?:\\.md)?\\)`,
  "g"
);

export interface HarvestedLinkOccurrence {
  start: number;
  end: number;
  linkType: string;
  source: "markdown" | "frontmatter" | "extracted";
  originField: string | null;
}

export interface HarvestedLinkRef {
  slug: string;
  aliases: string[];
  occurrences: HarvestedLinkOccurrence[];
}

export function harvestLinkRefs(
  input: {
    content: string;
    frontmatter: Record<string, unknown>;
    timeline: string;
  },
  spec: LinkSpec
): Map<string, HarvestedLinkRef> {
  const refs = new Map<string, HarvestedLinkRef>();

  if (spec.entity_sources.includes("wikilink")) {
    harvestWikilinks(input.content, refs);
  }
  if (spec.entity_sources.includes("markdown_link")) {
    harvestMarkdownLinks(input.content, refs);
  }
  if (spec.entity_sources.includes("frontmatter.primary_entities")) {
    harvestPrimaryEntities(input.frontmatter, refs);
  }
  if (spec.entity_sources.includes("facts_block.entity")) {
    harvestFactsBlockEntities(input.content, refs);
  }
  if (spec.entity_sources.includes("timeline_block.entity")) {
    harvestTimelineEntities(input.timeline, refs);
  }

  return refs;
}

function harvestWikilinks(content: string, refs: Map<string, HarvestedLinkRef>): void {
  for (const match of content.matchAll(WIKILINK_RE)) {
    const dir = match[1];
    const name = match[2];
    const display = match[3];
    if (!dir || !name) continue;
    const slug = `${dir}/${decodeURIComponent(name.trim())}`;
    const alias = display ? display.replace(TYPE_PREFIX_RE, "").trim() : null;
    const linkType = parseLinkType(display);
    upsertRef(refs, slug, {
      alias,
      occurrence: {
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        linkType,
        source: "markdown",
        originField: null,
      },
    });
  }
}

function harvestMarkdownLinks(content: string, refs: Map<string, HarvestedLinkRef>): void {
  for (const match of content.matchAll(MD_LINK_RE)) {
    const text = match[1];
    const rawTarget = match[2];
    if (!rawTarget) continue;
    const normalized = rawTarget.replace(/^(\.\.\/)+/, "").replace(/\.md$/, "");
    if (!/^(companies|industries|concepts|sources|theses|outputs|briefs)\//.test(normalized)) {
      continue;
    }
    upsertRef(refs, normalized, {
      alias: text?.trim() || null,
      occurrence: {
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        linkType: "mention",
        source: "markdown",
        originField: null,
      },
    });
  }
}

function harvestPrimaryEntities(
  frontmatter: Record<string, unknown>,
  refs: Map<string, HarvestedLinkRef>
): void {
  const entities = Array.isArray(frontmatter.primary_entities)
    ? frontmatter.primary_entities
    : [];
  for (const entity of entities) {
    if (typeof entity !== "string" || !entity.includes("/")) continue;
    upsertRef(refs, entity.trim(), {
      alias: null,
      occurrence: {
        start: 0,
        end: 0,
        linkType: "mention",
        source: "frontmatter",
        originField: "primary_entities",
      },
    });
  }
}

function harvestFactsBlockEntities(content: string, refs: Map<string, HarvestedLinkRef>): void {
  const match = content.match(/<!--\s*facts\s*\n([\s\S]+?)\n\s*-->/i);
  if (!match?.[1]) return;
  try {
    const parsed = YAML.parse(match[1]);
    if (!Array.isArray(parsed)) return;
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const entity = typeof row.entity === "string" ? row.entity.trim() : "";
      if (!entity) continue;
      upsertRef(refs, entity, {
        alias: null,
        occurrence: {
          start: match.index ?? 0,
          end: (match.index ?? 0) + match[0].length,
          linkType: "mention",
          source: "extracted",
          originField: "facts_block",
        },
      });
    }
  } catch {
    return;
  }
}

function harvestTimelineEntities(timeline: string, refs: Map<string, HarvestedLinkRef>): void {
  if (!timeline.trim()) return;
  try {
    const parsed = YAML.parse(timeline);
    if (!Array.isArray(parsed)) return;
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const entity = typeof row.entity === "string" ? row.entity.trim() : "";
      if (!entity) continue;
      upsertRef(refs, entity, {
        alias: null,
        occurrence: {
          start: 0,
          end: 0,
          linkType: "mention",
          source: "extracted",
          originField: "timeline_block",
        },
      });
    }
  } catch {
    return;
  }
}

function parseLinkType(display: string | undefined): string {
  if (!display) return "mention";
  const m = display.match(TYPE_PREFIX_RE);
  return m?.[1] ?? "mention";
}

function upsertRef(
  refs: Map<string, HarvestedLinkRef>,
  slug: string,
  opts: { alias: string | null; occurrence: HarvestedLinkOccurrence }
): void {
  const existing = refs.get(slug) ?? { slug, aliases: [], occurrences: [] };
  if (opts.alias && !existing.aliases.includes(opts.alias)) {
    existing.aliases.push(opts.alias);
  }
  existing.occurrences.push(opts.occurrence);
  refs.set(slug, existing);
}
