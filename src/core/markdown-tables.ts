/**
 * Markdown table helpers.
 *
 * Goal:
 *   - keep markdown tables intact during chunking
 *   - provide a deterministic parser for stage-5 fact fallback
 */

export interface MarkdownTable {
  tableId: string;
  headers: string[];
  rows: string[][];
  raw: string;
  rowRaws: string[];
}

export interface MarkdownTableArtifact {
  table_id: string;
  headers: string[];
  rows: string[][];
  row_count: number;
  column_count: number;
  raw_markdown: string;
  row_markdowns: string[];
}

export interface MarkdownTableBundle {
  kind: "markdown_tables";
  version: 1;
  extractedAt: string;
  tableCount: number;
  tables: MarkdownTableArtifact[];
}

export interface MarkdownSegment {
  type: "text" | "table";
  text: string;
}

export function splitMarkdownByTables(md: string): MarkdownSegment[] {
  const lines = md.split("\n");
  const segments: MarkdownSegment[] = [];
  let textBuffer: string[] = [];

  const flushText = () => {
    const text = textBuffer.join("\n").trim();
    if (text.length > 0) {
      segments.push({ type: "text", text });
    }
    textBuffer = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";

    if (looksLikeTableHeader(line, next)) {
      flushText();
      const tableLines = [line, next];
      i += 2;

      while (i < lines.length) {
        const current = lines[i] ?? "";
        if (!looksLikeTableBodyLine(current)) break;
        tableLines.push(current);
        i += 1;
      }

      segments.push({
        type: "table",
        text: tableLines.join("\n").trim(),
      });
      continue;
    }

    textBuffer.push(line);
    i += 1;
  }

  flushText();
  return segments;
}

export function parseMarkdownTables(md: string): MarkdownTable[] {
  return splitMarkdownByTables(md)
    .filter((segment) => segment.type === "table")
    .map((segment, index) => parseSingleTable(segment.text, index))
    .filter((table): table is MarkdownTable => table !== null);
}

export function buildMarkdownTableBundle(md: string): MarkdownTableBundle {
  const tables = parseMarkdownTables(md);
  const extractedAt = new Date().toISOString();

  return {
    kind: "markdown_tables",
    version: 1,
    extractedAt,
    tableCount: tables.length,
    tables: tables.map((table) => ({
      table_id: table.tableId,
      headers: table.headers,
      rows: table.rows,
      row_count: table.rows.length,
      column_count: table.headers.length,
      raw_markdown: table.raw,
      row_markdowns: table.rowRaws,
    })),
  };
}

export function isMarkdownTableBundle(value: unknown): value is MarkdownTableBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Record<string, unknown>;
  return (
    bundle.kind === "markdown_tables" &&
    bundle.version === 1 &&
    Array.isArray(bundle.tables)
  );
}

function parseSingleTable(raw: string, index: number): MarkdownTable | null {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) return null;
  if (!looksLikeTableHeader(lines[0] ?? "", lines[1] ?? "")) return null;

  const headers = splitTableRow(lines[0] ?? "");
  if (headers.length === 0) return null;

  const rows: string[][] = [];
  const rowRaws: string[] = [];

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!looksLikeTableBodyLine(line) || isSeparatorLine(line)) continue;

    const cells = splitTableRow(line);
    if (cells.length === 0) continue;

    rows.push(normalizeCellCount(cells, headers.length));
    rowRaws.push(line);
  }

  if (rows.length === 0) return null;

  return {
    tableId: `t${index + 1}`,
    headers,
    rows,
    raw,
    rowRaws,
  };
}

function splitTableRow(line: string): string[] {
  let normalized = line.trim();
  if (normalized.startsWith("|")) normalized = normalized.slice(1);
  if (normalized.endsWith("|")) normalized = normalized.slice(0, -1);

  return normalized
    .split(/(?<!\\)\|/g)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function normalizeCellCount(cells: string[], width: number): string[] {
  if (cells.length === width) return cells;
  if (cells.length > width) return cells.slice(0, width);
  return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
}

function looksLikeTableHeader(line: string, next: string): boolean {
  if (!looksLikeTableBodyLine(line)) return false;
  return isSeparatorLine(next);
}

function looksLikeTableBodyLine(line: string): boolean {
  if (line.trim().length === 0) return false;
  if (line.trim().startsWith("```")) return false;
  return (line.match(/\|/g) ?? []).length >= 2;
}

function isSeparatorLine(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}
