import { readFileSync } from "node:fs";
import path from "node:path";
import * as YAML from "yaml";

const CACHE = new Map<string, unknown>();

export function loadExtractorSpec<T>(kind: string, name: string): T {
  const key = `${kind}:${name}`;
  const cached = CACHE.get(key);
  if (cached) return cached as T;

  const filePath = path.join(process.cwd(), "extractors", kind, `${name}.yaml`);
  const raw = readFileSync(filePath, "utf8");
  const parsed = YAML.parse(raw) as T;
  CACHE.set(key, parsed);
  return parsed;
}

export function clearExtractorSpecCache(): void {
  CACHE.clear();
}
