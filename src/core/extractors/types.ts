export type LinkEntitySource =
  | "wikilink"
  | "markdown_link"
  | "frontmatter.primary_entities"
  | "facts_block.entity"
  | "timeline_block.entity";

export interface LinkSpec {
  kind: "links";
  name: string;
  applies_to: { page_types: string[] };
  entity_sources: LinkEntitySource[];
  relation_rules: Array<{ type: string; when: string }>;
}

export interface TimelineSpec {
  kind: "timeline";
  name: string;
  applies_to: { page_types: string[] };
  event_types: string[];
  placeholder_dates: string[];
  suspicious_summary_terms: string[];
}
