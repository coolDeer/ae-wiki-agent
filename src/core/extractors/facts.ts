import { readFileSync } from "node:fs";
import path from "node:path";
import * as YAML from "yaml";

export interface FactsExtractorSpec {
  kind: "facts";
  name: string;
  applies_to: { page_types: string[] };
  header_aliases: Record<string, string[]>;
  metric_aliases: Record<string, string>;
  unit_aliases: Record<string, string[]>;
  period_aliases: Record<string, string>;
}

const CACHE = new Map<string, FactsExtractorSpec>();
const DEFAULT_FACTS_SPEC = "source-finance-default";

export function loadFactsSpec(name: string = DEFAULT_FACTS_SPEC): FactsExtractorSpec {
  const cached = CACHE.get(name);
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "extractors", "facts", `${name}.yaml`);
  const raw = readFileSync(filePath, "utf8");
  const spec = YAML.parse(raw) as FactsExtractorSpec;
  CACHE.set(name, spec);
  return spec;
}

export function clearFactsSpecCache(): void {
  CACHE.clear();
}

export function matchFactsSpec(pageType: string): FactsExtractorSpec {
  const spec = loadFactsSpec();
  return spec.applies_to.page_types.includes(pageType) ? spec : spec;
}

export function normalizeFactHeader(header: string): string {
  return stripMarkdown(header)
    .toLowerCase()
    .replace(/[%/()]+/g, " ")
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function findFactHeaderIndex(
  headers: string[],
  kind: keyof FactsExtractorSpec["header_aliases"],
  spec: FactsExtractorSpec
): number {
  return headers.findIndex((header) => spec.header_aliases[kind]?.includes(header));
}

export function normalizeFactMetric(metric: string, spec: FactsExtractorSpec): string | null {
  const stripped = stripMarkdown(metric).trim();
  if (!stripped) return null;
  const metricText = stripped.replace(/\(([^)]+)\)\s*$/, "").trim();
  const rawKey = metricText
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!rawKey) return null;
  return spec.metric_aliases[rawKey] ?? rawKey;
}

export function normalizeFactUnit(
  text: string | null | undefined,
  spec: FactsExtractorSpec
): string | null {
  if (!text) return null;
  const normalized = stripMarkdown(text).toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  for (const canonical of Object.keys(spec.unit_aliases)) {
    if (normalized === canonical.toLowerCase()) return canonical;
  }

  for (const [canonical, aliases] of Object.entries(spec.unit_aliases)) {
    if (aliases.some((alias) => alias.toLowerCase() === normalized)) return canonical;
    if (aliases.some((alias) => normalized.includes(alias.toLowerCase()))) return canonical;
  }
  return normalized.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || null;
}

export function parseMetricCellWithSpec(
  cell: string,
  spec: FactsExtractorSpec
): { metric: string | null; unit: string | null } {
  const stripped = stripMarkdown(cell).trim();
  if (!stripped) return { metric: null, unit: null };
  const unitMatch = stripped.match(/\(([^)]+)\)\s*$/);
  const unit = unitMatch ? normalizeFactUnit(unitMatch[1] ?? "", spec) : null;
  return { metric: normalizeFactMetric(stripped, spec), unit };
}

export function inferUnitFromCurrencyAndScale(
  currencyPrefix: string | null,
  scale: string | null,
  spec: FactsExtractorSpec
): string | null {
  const currency = currencyPrefix?.toLowerCase() ?? "";
  const normalizedScale = scale?.toLowerCase() ?? "";

  if (normalizedScale === "x") return "x";
  if (currency === "$" || currency === "usd" || currency === "us$") {
    if (["m", "mm", "million"].includes(normalizedScale)) return "usd_m";
    if (["bn", "b", "billion"].includes(normalizedScale)) return "usd_bn";
    return normalizeFactUnit(currencyPrefix, spec);
  }
  if (currency === "¥" || currency === "jpy") {
    if (["m", "mm", "million"].includes(normalizedScale)) return "jpy_m";
    return normalizeFactUnit(currencyPrefix, spec);
  }
  if (currency === "cny" || currency === "rmb" || currency === "cn¥") {
    if (["bn", "b", "billion"].includes(normalizedScale)) return "cny_bn";
    if (["m", "mm", "million"].includes(normalizedScale)) return "cny_m";
    return normalizeFactUnit(currencyPrefix, spec);
  }
  if (currency === "€" || currency === "eur") return "eur";
  if (currency === "£" || currency === "gbp") return "gbp";
  return null;
}

export function normalizeFactPeriod(
  value: string | null | undefined,
  spec: FactsExtractorSpec
): string | undefined {
  if (!value) return undefined;
  const stripped = stripMarkdown(value).trim();
  if (!stripped) return undefined;
  const lowered = stripped.toLowerCase();
  if (spec.period_aliases[lowered]) return spec.period_aliases[lowered];

  if (/^(fy)?\d{2}e$/i.test(stripped)) {
    const num = stripped.replace(/^fy/i, "").replace(/e$/i, "");
    return `FY20${num}E`;
  }
  if (/^(fy)?\d{2}a$/i.test(stripped)) {
    const num = stripped.replace(/^fy/i, "").replace(/a$/i, "");
    return `FY20${num}A`;
  }
  if (/^[1-4]q\d{2}e$/i.test(stripped)) {
    return `${stripped.slice(0, 2).toUpperCase()}20${stripped.slice(2, 4)}E`;
  }
  if (/^[1-4]q\d{2}a$/i.test(stripped)) {
    return `${stripped.slice(0, 2).toUpperCase()}20${stripped.slice(2, 4)}A`;
  }
  if (/^h[12]\d{2}e$/i.test(stripped)) {
    return `${stripped.slice(0, 2).toUpperCase()}20${stripped.slice(2, 4)}E`;
  }
  if (/^h[12]\d{2}a$/i.test(stripped)) {
    return `${stripped.slice(0, 2).toUpperCase()}20${stripped.slice(2, 4)}A`;
  }
  return stripped;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}
