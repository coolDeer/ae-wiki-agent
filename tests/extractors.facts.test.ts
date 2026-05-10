import { describe, expect, test } from "bun:test";

function ensureTestEnv() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/ae_wiki_test";
  process.env.MONGODB_URI ??= "mongodb://localhost:27017";
  process.env.MONGODB_DB ??= "ae_wiki_test";
  process.env.OPENAI_API_KEY ??= "test-key";
}

describe("facts extractor specs", () => {
  test("loads default facts spec", async () => {
    ensureTestEnv();
    const { loadFactsSpec } = await import("../src/core/extractors/facts.ts");
    const spec = loadFactsSpec();
    expect(spec.kind).toBe("facts");
    expect(spec.header_aliases.metric).toContain("指标");
  });

  test("normalizes metric aliases, units, and compact periods", async () => {
    ensureTestEnv();
    const {
      loadFactsSpec,
      normalizeFactMetric,
      normalizeFactPeriod,
      normalizeFactUnit,
    } = await import("../src/core/extractors/facts.ts");
    const spec = loadFactsSpec();
    expect(normalizeFactMetric("GM", spec)).toBe("gross_margin");
    expect(normalizeFactUnit("USD bn", spec)).toBe("usd_bn");
    expect(normalizeFactUnit("usd_bn", spec)).toBe("usd_bn");
    expect(normalizeFactPeriod("FY26E", spec)).toBe("FY2026E");
  });
});
