/**
 * V2 → TableBundle 转换器 + sidecar 类型定义。
 *
 * 从 mineru `parsedContentListV2S3` 的 V2 block 列表中抽取 table block，
 * 解析其 HTML（含 rowspan / colspan）成结构化 headers + rows，
 * 包成 `TableBundle` 写入 `raw_data.source='tables'`。
 *
 * 下游消费：
 *   - stage-5-facts Tier B：headers + rows 抽 fact
 *   - MCP get_table_artifact / compare_table_facts：直接返回 JSON
 *
 * 历史包袱（markdown table parser）已下线 —— V2 是单一事实源。
 */

import type { V2Block, V2ContentList, V2Span } from "~/core/chunkers/v2-block.ts";

// =============================================================================
// 类型（替代旧 MarkdownTableBundle / MarkdownTableArtifact）
// =============================================================================

export interface TableArtifact {
  table_id: string;
  headers: string[];
  rows: string[][];
  row_count: number;
  column_count: number;
  /** 整张表渲染成 markdown 表格字符串（display + provenance 用） */
  raw_markdown: string;
  /** 每行渲染成 `| c1 | c2 |` 风格字符串（fact source_quote 用） */
  row_markdowns: string[];
}

export interface TableBundle {
  kind: "tables";
  version: 1;
  extractedAt: string;
  tableCount: number;
  tables: TableArtifact[];
}

export function isTableBundle(value: unknown): value is TableBundle {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return b.kind === "tables" && b.version === 1 && Array.isArray(b.tables);
}

interface V2TableBlock {
  type: "table";
  content?: {
    image_source?: { path?: string };
    table_caption?: V2Span[];
    table_footnote?: V2Span[];
    html?: string;
    table_type?: string;
    table_nest_level?: number;
  };
}

export function buildTableBundleFromV2(v2: V2ContentList): TableBundle {
  const tableBlocks = collectTableBlocks(v2);
  const tables: TableArtifact[] = [];

  tableBlocks.forEach((block, index) => {
    const html = block.content?.html;
    if (!html) return;
    const grid = parseHtmlTable(html);
    if (grid.length === 0) return;

    const headers = grid[0]!.map((cell) => cell.trim());
    const rows = grid.slice(1).map((row) => row.map((cell) => cell.trim()));
    if (headers.length === 0) return;

    const rowMarkdowns = rows.map(renderRowMarkdown);
    const rawMarkdown = renderTableMarkdown(headers, rows);

    tables.push({
      table_id: `t${index + 1}`,
      headers,
      rows,
      row_count: rows.length,
      column_count: headers.length,
      raw_markdown: rawMarkdown,
      row_markdowns: rowMarkdowns,
    });
  });

  return {
    kind: "tables",
    version: 1,
    extractedAt: new Date().toISOString(),
    tableCount: tables.length,
    tables,
  };
}

// =============================================================================
// V2 block 收集
// =============================================================================

function collectTableBlocks(v2: V2ContentList): V2TableBlock[] {
  const out: V2TableBlock[] = [];
  if (!Array.isArray(v2)) return out;
  for (const page of v2) {
    if (!Array.isArray(page)) continue;
    for (const block of page) {
      if (isTableBlock(block)) out.push(block);
    }
  }
  return out;
}

function isTableBlock(block: V2Block | unknown): block is V2TableBlock {
  return (
    !!block &&
    typeof block === "object" &&
    (block as { type?: unknown }).type === "table"
  );
}

// =============================================================================
// HTML 表解析（rowspan / colspan）
// =============================================================================

/**
 * 解析 mineru 输出的 `<table>` HTML 成 string[][]。
 *
 * - 支持 rowspan / colspan（按 grid 排列规则填充）
 * - colspan 多列时，每个被占的格子都填同一份内容
 * - 没有 <th>，第 0 行就是表头
 */
export function parseHtmlTable(html: string): string[][] {
  const trMatches = matchAll(html, /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
  const grid: string[][] = [];
  let totalCols = 0;

  trMatches.forEach((trBody, rowIdx) => {
    if (!grid[rowIdx]) grid[rowIdx] = [];
    let colIdx = 0;
    const tdMatches = matchAllWithGroups(trBody, /<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi);

    for (const [attrs, inner] of tdMatches) {
      const rowspan = parseSpan(attrs, "rowspan");
      const colspan = parseSpan(attrs, "colspan");
      const text = decodeHtmlText(inner);

      // 跳过被前面 rowspan 占住的列
      while (grid[rowIdx]![colIdx] !== undefined) colIdx++;

      // 落入 grid[rowIdx..rowIdx+rowspan-1][colIdx..colIdx+colspan-1]
      for (let rr = rowIdx; rr < rowIdx + rowspan; rr++) {
        if (!grid[rr]) grid[rr] = [];
        for (let cc = colIdx; cc < colIdx + colspan; cc++) {
          grid[rr]![cc] = text;
        }
      }
      colIdx += colspan;
    }
    totalCols = Math.max(totalCols, grid[rowIdx]!.length);
  });

  // 标准化：补齐短行 / 把 hole（undefined）填空字符串
  for (const row of grid) {
    for (let i = 0; i < totalCols; i++) {
      if (row[i] === undefined) row[i] = "";
    }
  }
  return grid;
}

function parseSpan(attrs: string, name: "rowspan" | "colspan"): number {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*"?(\\d+)"?`, "i"));
  if (!m) return 1;
  const n = parseInt(m[1] ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function matchAll(text: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (typeof m[1] === "string") out.push(m[1]);
  }
  return out;
}

function matchAllWithGroups(text: string, re: RegExp): [string, string][] {
  const out: [string, string][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push([m[1] ?? "", m[2] ?? ""]);
  }
  return out;
}

/** 剥掉所有 HTML 标签 + 解码常见 HTML 实体。 */
function decodeHtmlText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================================================
// 渲染：grid → markdown 字符串（保持下游接口语义）
// =============================================================================

function renderRowMarkdown(row: string[]): string {
  return `| ${row.map(escapeMdCell).join(" | ")} |`;
}

function renderTableMarkdown(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.map(escapeMdCell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(renderRowMarkdown).join("\n");
  return [headerLine, sep, body].filter((l) => l.length > 0).join("\n");
}

function escapeMdCell(cell: string): string {
  return cell.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}
