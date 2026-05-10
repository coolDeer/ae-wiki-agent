import { describe, expect, test } from "bun:test";

describe("timeline extractor specs", () => {
  test("flags suspicious placeholder dates", async () => {
    const { isSuspiciousPlaceholderDate } = await import(
      "../src/core/extractors/timeline.ts"
    );
    expect(isSuspiciousPlaceholderDate("2026-07-01", "2H26 expected ramp")).toBeTrue();
    expect(isSuspiciousPlaceholderDate("2026-04-15", "earnings release")).toBeFalse();
  });
});
