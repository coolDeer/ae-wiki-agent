/**
 * Stage 5 Tier A: 直读 narrative 末尾的 `<!-- facts ... -->` YAML 块。
 *
 * agent 在 Stage 3 把抽取好的 fact 列表写在 narrative 最后；这一层零成本、
 * 高确定性，应优先信任。block 缺失或解析失败时返回空数组（fail-soft）。
 */

import * as YAML from "yaml";
import type { YamlFact } from "./stage-5-types.ts";

const FACTS_BLOCK_RE = /<!--\s*facts\s*\n([\s\S]+?)\n\s*-->/;

export function extractTierA(content: string): YamlFact[] {
  const m = content.match(FACTS_BLOCK_RE);
  if (!m || !m[1]) return [];

  try {
    const parsed = YAML.parse(m[1]);
    if (!Array.isArray(parsed)) {
      console.warn("  [stage5:tierA] facts block 不是数组");
      return [];
    }
    return parsed.filter(
      (f: unknown): f is YamlFact =>
        typeof f === "object" &&
        f !== null &&
        "entity" in f &&
        "metric" in f &&
        "value" in f
    );
  } catch (e) {
    console.warn(`  [stage5:tierA] YAML 解析失败:`, (e as Error).message);
    return [];
  }
}
