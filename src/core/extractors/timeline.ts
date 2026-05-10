import { readFileSync } from "node:fs";
import path from "node:path";
import * as YAML from "yaml";
import { matchTimelineSpec } from "./match-spec.ts";
import type { TimelineSpec } from "./types.ts";

export interface YamlTimelineEntry {
  entity?: string;
  date: string;
  event_type: string;
  summary: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

const CACHE = new Map<string, TimelineSpec>();
const DEFAULT_TIMELINE_SPEC = "source-default";

export function loadTimelineSpec(name: string = DEFAULT_TIMELINE_SPEC): TimelineSpec {
  const cached = CACHE.get(name);
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "extractors", "timeline", `${name}.yaml`);
  const raw = readFileSync(filePath, "utf8");
  const spec = YAML.parse(raw) as TimelineSpec;
  CACHE.set(name, spec);
  return spec;
}

export function clearTimelineSpecCache(): void {
  CACHE.clear();
}

export function parseTimelineYaml(text: string, label: string): YamlTimelineEntry[] {
  try {
    const parsed = YAML.parse(text);
    if (!Array.isArray(parsed)) {
      console.warn(`  [stage7] ${label} 不是数组`);
      return [];
    }
    return parsed.filter(
      (e: unknown): e is YamlTimelineEntry =>
        typeof e === "object" &&
        e !== null &&
        "date" in e &&
        "event_type" in e &&
        "summary" in e
    );
  } catch (e) {
    console.warn(`  [stage7] ${label} YAML 解析失败:`, (e as Error).message);
    return [];
  }
}

export function normalizeTimelineEventType(
  eventType: string,
  spec: TimelineSpec = loadTimelineSpec()
): string {
  return spec.event_types.includes(eventType) ? eventType : "other";
}

export function isSuspiciousPlaceholderDate(
  date: string,
  summary: string,
  spec: TimelineSpec = loadTimelineSpec()
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const lowered = summary.toLowerCase();
  const isJan1 = /-\d{2}-01$/.test(date) && date.endsWith("-01-01");
  const isJul1 = date.endsWith("-07-01");
  const hasSuspiciousTerm = spec.suspicious_summary_terms.some((term) =>
    lowered.includes(term.toLowerCase())
  );
  return hasSuspiciousTerm && (isJan1 || isJul1);
}

export function isValidTimelineEntry(
  entry: YamlTimelineEntry,
  spec: TimelineSpec = loadTimelineSpec()
): boolean {
  if (typeof entry.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
  if (typeof entry.summary !== "string" || entry.summary.trim() === "") return false;
  if (typeof entry.event_type !== "string" || entry.event_type.trim() === "") return false;
  if (isSuspiciousPlaceholderDate(entry.date, entry.summary, spec)) return false;
  return true;
}

export { matchTimelineSpec };
