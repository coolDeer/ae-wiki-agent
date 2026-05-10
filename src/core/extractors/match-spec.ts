import { loadExtractorSpec } from "./load-spec.ts";
import type { LinkSpec, TimelineSpec } from "./types.ts";

const DEFAULT_LINK_SPEC = "source-default";
const DEFAULT_TIMELINE_SPEC = "source-default";

export function matchLinkSpec(pageType: string): LinkSpec {
  const spec = loadExtractorSpec<LinkSpec>("links", DEFAULT_LINK_SPEC);
  return spec.applies_to.page_types.includes(pageType) ? spec : spec;
}

export function matchTimelineSpec(pageType: string): TimelineSpec {
  const spec = loadExtractorSpec<TimelineSpec>("timeline", DEFAULT_TIMELINE_SPEC);
  return spec.applies_to.page_types.includes(pageType) ? spec : spec;
}
