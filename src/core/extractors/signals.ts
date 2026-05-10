import { readFileSync } from "node:fs";
import path from "node:path";
import * as YAML from "yaml";

export interface SignalSpec {
  kind: "signals";
  name: string;
  applies_to: { page_types: string[] };
  typed_link_semantics: Record<string, "thesis_validation" | "thesis_invalidation">;
  fact_rules: {
    min_delta_pct: number;
    consensus_drift_warning_pct: number;
    consensus_drift_critical_pct: number;
    single_prior_signal_type: string;
    multi_prior_signal_type: string;
  };
}

export interface ThesisConditionSpec {
  kind: "thesis_conditions";
  name: string;
  applies_to: { page_types: string[] };
  match_fields: string[];
  status_mapping: Record<string, "met" | "invalidated" | "pending" | "unmet">;
}

const signalCache = new Map<string, SignalSpec>();
const conditionCache = new Map<string, ThesisConditionSpec>();

export function loadSignalSpec(name = "source-default"): SignalSpec {
  const cached = signalCache.get(name);
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "extractors", "signals", `${name}.yaml`);
  const raw = readFileSync(filePath, "utf8");
  const spec = YAML.parse(raw) as SignalSpec;
  signalCache.set(name, spec);
  return spec;
}

export function loadThesisConditionSpec(name = "source-default"): ThesisConditionSpec {
  const cached = conditionCache.get(name);
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "extractors", "thesis-conditions", `${name}.yaml`);
  const raw = readFileSync(filePath, "utf8");
  const spec = YAML.parse(raw) as ThesisConditionSpec;
  conditionCache.set(name, spec);
  return spec;
}

export function inferSignalTypeFromLinkType(linkType: string, spec = loadSignalSpec()): string {
  return spec.typed_link_semantics[linkType] ?? "thesis_validation";
}

export function matchThesisConditions(
  conditions: Array<{ condition?: string; title?: string; summary?: string }>,
  content: string,
  spec = loadThesisConditionSpec()
): Array<{ condition: string }> {
  const lowered = content.toLowerCase();
  const matched: Array<{ condition: string }> = [];
  for (const cond of conditions) {
    const candidates = spec.match_fields
      .map((field) => cond[field as keyof typeof cond])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (candidates.some((text) => lowered.includes(text.toLowerCase()))) {
      matched.push({ condition: cond.condition ?? candidates[0]! });
    }
  }
  return matched;
}

export function deriveFactSignal(
  deltaPct: number,
  priorCount: number,
  spec = loadSignalSpec()
): { signalType: string; severity: string } | null {
  const absDelta = Math.abs(deltaPct);
  if (absDelta < spec.fact_rules.min_delta_pct) return null;
  const signalType =
    priorCount >= 2
      ? spec.fact_rules.multi_prior_signal_type
      : spec.fact_rules.single_prior_signal_type;
  const severity =
    absDelta >= spec.fact_rules.consensus_drift_critical_pct
      ? "critical"
      : absDelta >= spec.fact_rules.consensus_drift_warning_pct
        ? "warning"
        : "info";
  return { signalType, severity };
}
