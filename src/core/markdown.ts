/**
 * Markdown body helpers.
 *
 * Borrowed and adapted from `demo/gbrain/src/core/markdown.ts`.
 * We only port the body split semantics so ae-wiki can keep `content`
 * and `timeline` as separate persisted fields.
 */

export function splitBody(body: string): {
  compiledTruth: string;
  timeline: string;
} {
  const lines = body.split("\n");
  const splitIndex = findTimelineSplitIndex(lines);

  if (splitIndex === -1) {
    return {
      compiledTruth: body,
      timeline: "",
    };
  }

  return {
    compiledTruth: lines.slice(0, splitIndex).join("\n"),
    timeline: lines.slice(splitIndex + 1).join("\n"),
  };
}

function findTimelineSplitIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? "";

    if (trimmed === "<!-- timeline -->" || trimmed === "<!--timeline-->") {
      return i;
    }

    if (
      trimmed === "--- timeline ---" ||
      /^---\s+timeline\s+---$/i.test(trimmed)
    ) {
      return i;
    }

    if (trimmed === "---") {
      const beforeContent = lines.slice(0, i).join("\n").trim();
      if (beforeContent.length === 0) continue;

      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]?.trim() ?? "";
        if (next.length === 0) continue;
        if (/^##\s+(timeline|history)\b/i.test(next)) {
          return i;
        }
        break;
      }
    }
  }

  return -1;
}
