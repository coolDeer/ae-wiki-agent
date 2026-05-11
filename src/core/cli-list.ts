/**
 * Parse CLI list arguments.
 *
 * Most ae-wiki flags use comma-separated values for convenience, but company
 * legal names frequently contain commas ("Foo, Inc."). For those cases the
 * same flags accept a JSON string array.
 */
export function parseCliListArg(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`invalid JSON array: ${(error as Error).message}`);
    }
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("expected JSON array of strings");
    }
    return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
  }

  return trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
