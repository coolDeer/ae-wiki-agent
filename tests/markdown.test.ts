import { describe, expect, test } from "bun:test";

import { splitBody } from "../src/core/markdown.ts";

describe("markdown splitBody", () => {
  test("extracts sentinel timeline tail and removes it from compiled truth", () => {
    const body = [
      "## Source Overview",
      "Main narrative.",
      "",
      "<!-- timeline -->",
      "",
      "- entity: companies/A",
      "  date: 2026-05-09",
      "  event_type: news",
      "  summary: A material event.",
    ].join("\n");

    const result = splitBody(body);

    expect(result.compiledTruth).toContain("## Source Overview");
    expect(result.compiledTruth).not.toContain("event_type: news");
    expect(result.timeline).toContain("entity: companies/A");
    expect(result.timeline).toContain("summary: A material event.");
  });

  test("supports legacy wrapped timeline comments", () => {
    const body = [
      "## Source Overview",
      "Main narrative.",
      "",
      "<!-- timeline",
      "- entity: companies/A",
      "  date: 2026-05-09",
      "  event_type: news",
      "  summary: A material event.",
      "-->",
      "",
      "## After",
      "This should stay outside timeline.",
    ].join("\n");

    const result = splitBody(body);

    expect(result.compiledTruth).toContain("## After");
    expect(result.compiledTruth).not.toContain("entity: companies/A");
    expect(result.timeline).toContain("event_type: news");
  });

  test("returns unchanged body when no timeline marker exists", () => {
    const body = "## Source Overview\nNo dated timeline here.";
    expect(splitBody(body)).toEqual({ compiledTruth: body, timeline: "" });
  });
});
