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
  const range = findTimelineRange(lines);

  if (!range) {
    return {
      compiledTruth: body,
      timeline: "",
    };
  }

  return {
    compiledTruth: lines
      .slice(0, range.start)
      .concat(lines.slice(range.end + 1))
      .join("\n")
      .trimEnd(),
    timeline: lines.slice(range.contentStart, range.contentEnd + 1).join("\n").trim(),
  };
}

interface TimelineRange {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
}

function findTimelineRange(lines: string[]): TimelineRange | null {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? "";

    if (trimmed === "<!-- timeline -->" || trimmed === "<!--timeline-->") {
      return {
        start: i,
        end: lines.length - 1,
        contentStart: i + 1,
        contentEnd: lines.length - 1,
      };
    }

    if (/^<!--\s*timeline\s*$/i.test(trimmed) || /^<!--\s*timeline\b/i.test(trimmed)) {
      const closeIndex = findCommentCloseIndex(lines, i + 1);
      if (closeIndex === -1) {
        return {
          start: i,
          end: lines.length - 1,
          contentStart: i + 1,
          contentEnd: lines.length - 1,
        };
      }
      return {
        start: i,
        end: closeIndex,
        contentStart: i + 1,
        contentEnd: closeIndex - 1,
      };
    }

    if (
      trimmed === "--- timeline ---" ||
      /^---\s+timeline\s+---$/i.test(trimmed)
    ) {
      return {
        start: i,
        end: lines.length - 1,
        contentStart: i + 1,
        contentEnd: lines.length - 1,
      };
    }

    if (trimmed === "---") {
      const beforeContent = lines.slice(0, i).join("\n").trim();
      if (beforeContent.length === 0) continue;

      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]?.trim() ?? "";
        if (next.length === 0) continue;
        if (/^##\s+(timeline|history)\b/i.test(next)) {
          return {
            start: i,
            end: lines.length - 1,
            contentStart: i + 1,
            contentEnd: lines.length - 1,
          };
        }
        break;
      }
    }
  }

  return null;
}

function findCommentCloseIndex(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    if ((lines[i]?.trim() ?? "") === "-->") {
      return i;
    }
  }
  return -1;
}
