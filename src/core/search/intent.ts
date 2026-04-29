/**
 * Query Intent Classifier — 启发式（零延迟，无 LLM 调用）。
 * 借鉴 gbrain v0.20+ intent.ts。
 *
 * 把 query 模式映射到 detail level，driver chunk-per-page 上限：
 *   - entity   → low    （问主体/概览，1 chunk per page 即可）
 *   - temporal → high   （问时间线/最近变化，多 chunk per page）
 *   - event    → high   （问具体事件/公告/融资）
 *   - general  → medium （默认）
 */

export type QueryIntent = "entity" | "temporal" | "event" | "general";

const TEMPORAL_PATTERNS = [
  /\bwhen\b/i,
  /\blast\s+(met|meeting|call|conversation|chat|talked|spoke|seen|heard|time)\b/i,
  /\brecent(ly)?\b/i,
  /\bhistory\b/i,
  /\btimeline\b/i,
  /\bmeeting\s+notes?\b/i,
  /\bwhat('s| is| was)\s+new\b/i,
  /\blatest\b/i,
  /\bupdate(s)?\s+(on|from|about)\b/i,
  /\bhow\s+long\s+(ago|since)\b/i,
  /\b\d{4}[-/]\d{2}\b/i,
  /\blast\s+(week|month|quarter|year)\b/i,
  /最近|近期|最新|时间线|历史/,
];

const EVENT_PATTERNS = [
  /\bannounce[ds]?(ment)?\b/i,
  /\blaunch(ed|es|ing)?\b/i,
  /\braised?\s+\$?\d/i,
  /\bfund(ing|raise)\b/i,
  /\bIPO\b/i,
  /\bacquisition\b/i,
  /\bmerge[drs]?\b/i,
  /\bnews\b/i,
  /\bhappened?\b/i,
  /\bguidance\b/i,
  /\bearnings\b/i,
  /发布|公告|融资|并购|上市|财报|指引/,
];

const ENTITY_PATTERNS = [
  /\bwho\s+is\b/i,
  /\bwhat\s+(is|does|are)\b/i,
  /\btell\s+me\s+about\b/i,
  /\bdescribe\b/i,
  /\bsummar(y|ize)\b/i,
  /\boverview\b/i,
  /\bbackground\b/i,
  /\bprofile\b/i,
  /\bwhat\s+do\s+(you|we)\s+know\b/i,
  /是谁|是什么|介绍|概览|简介/,
];

const FULL_CONTEXT_PATTERNS = [
  /\beverything\b/i,
  /\ball\s+(about|info|information|details)\b/i,
  /\bfull\s+(history|context|picture|story|details)\b/i,
  /\bcomprehensive\b/i,
  /\bdeep\s+dive\b/i,
  /\bgive\s+me\s+everything\b/i,
  /全部|所有|完整/,
];

export function classifyQueryIntent(query: string): QueryIntent {
  if (FULL_CONTEXT_PATTERNS.some((p) => p.test(query))) return "temporal";
  if (TEMPORAL_PATTERNS.some((p) => p.test(query))) return "temporal";
  if (EVENT_PATTERNS.some((p) => p.test(query))) return "event";
  if (ENTITY_PATTERNS.some((p) => p.test(query))) return "entity";
  return "general";
}

export function intentToDetail(intent: QueryIntent): "low" | "medium" | "high" | undefined {
  switch (intent) {
    case "entity":
      return "low";
    case "temporal":
      return "high";
    case "event":
      return "high";
    case "general":
      return undefined;
  }
}

export function autoDetectDetail(query: string): "low" | "medium" | "high" | undefined {
  return intentToDetail(classifyQueryIntent(query));
}

/** detail → max chunks per page（dedup 用）。 */
export function detailToMaxPerPage(detail: "low" | "medium" | "high" | undefined): number {
  switch (detail) {
    case "low":
      return 1;
    case "high":
      return 3;
    case "medium":
    default:
      return 2;
  }
}
