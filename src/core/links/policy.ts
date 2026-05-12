import { sql, type SQL } from "drizzle-orm";

export const EFFECTIVE_LINK_WEIGHT_THRESHOLD = 0.9;

export interface LinkOccurrenceForWeight {
  linkType: string;
  source: "markdown" | "frontmatter" | "extracted" | "manual";
  originField: string | null;
}

export function scoreLinkOccurrence(occ: LinkOccurrenceForWeight): number {
  if (occ.originField === "facts_block" || occ.originField === "timeline_block") {
    return 1.2;
  }
  if (occ.source === "frontmatter" && occ.originField === "primary_entities") {
    return 1.0;
  }
  if (occ.linkType !== "mention") {
    return 1.0;
  }
  if (occ.source === "manual") {
    return 1.0;
  }
  if (occ.source === "extracted") {
    return 0.7;
  }
  if (occ.source === "frontmatter") {
    return 0.6;
  }
  return 0.3;
}

export function linkWeightForOccurrences(
  occurrences: LinkOccurrenceForWeight[]
): number {
  if (occurrences.length === 0) return 0.3;
  return Math.max(...occurrences.map(scoreLinkOccurrence));
}

export function isStrongLinkOccurrenceSet(
  occurrences: LinkOccurrenceForWeight[]
): boolean {
  return linkWeightForOccurrences(occurrences) >= EFFECTIVE_LINK_WEIGHT_THRESHOLD;
}

export function effectiveBacklinkPredicate(alias = "links"): SQL {
  const col = (name: string) => sql.raw(`${alias}.${name}`);
  return sql`(
    ${col("weight")}::numeric >= ${EFFECTIVE_LINK_WEIGHT_THRESHOLD}
    OR ${col("link_type")} <> 'mention'
    OR (${col("link_source")} = 'frontmatter' AND ${col("origin_field")} = 'primary_entities')
    OR ${col("origin_field")} IN ('facts_block', 'timeline_block')
  )`;
}
