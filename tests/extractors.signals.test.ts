import { describe, expect, test } from "bun:test";

describe("signal extractor specs", () => {
  test("maps typed links to thesis signal types", async () => {
    const { inferSignalTypeFromLinkType, deriveFactSignal } = await import(
      "../src/core/extractors/signals.ts"
    );
    expect(inferSignalTypeFromLinkType("confirms")).toBe("thesis_validation");
    expect(inferSignalTypeFromLinkType("contradicts")).toBe("thesis_invalidation");
    expect(deriveFactSignal(0.05, 3)).toBeNull();
    expect(deriveFactSignal(0.25, 3)?.signalType).toBe("consensus_drift");
  });
});
