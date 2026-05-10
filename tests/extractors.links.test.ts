import { describe, expect, test } from "bun:test";

function ensureTestEnv() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/ae_wiki_test";
  process.env.MONGODB_URI ??= "mongodb://localhost:27017";
  process.env.MONGODB_DB ??= "ae_wiki_test";
  process.env.OPENAI_API_KEY ??= "test-key";
}

describe("link extractor specs", () => {
  test("loads link spec and harvests structured entity sources", async () => {
    ensureTestEnv();
    const { matchLinkSpec } = await import("../src/core/extractors/match-spec.ts");
    const { harvestLinkRefs } = await import("../src/core/extractors/links.ts");

    const spec = matchLinkSpec("source");
    const refs = harvestLinkRefs(
      {
        content:
          "See [[companies/nokia|Nokia]]\n\n<!-- facts\n- entity: companies/ciena\n  metric: revenue\n  value: 1\n-->\n",
        frontmatter: { primary_entities: ["companies/cisco"] },
        timeline:
          "- entity: companies/corning\n  date: 2026-04-15\n  event_type: news\n  summary: test",
      },
      spec
    );

    expect(refs.has("companies/nokia")).toBeTrue();
    expect(refs.has("companies/ciena")).toBeTrue();
    expect(refs.has("companies/cisco")).toBeTrue();
    expect(refs.has("companies/corning")).toBeTrue();
  });
});
