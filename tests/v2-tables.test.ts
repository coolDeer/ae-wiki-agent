/**
 * V2 → TableBundle 转换器测试。
 *
 * 用法：`bun test tests/v2-tables.test.ts`
 *
 * 覆盖：
 *   - HTML 表解析（基础 / rowspan / colspan）
 *   - 实体解码（&amp; / &nbsp; / 数字实体）
 *   - 嵌套标签清理
 *   - V2 ContentList → TableBundle 端到端
 *   - 不规则 HTML 不抛异常
 *   - 真实样本 smoke test（17 张表）
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildTableBundleFromV2,
  isTableBundle,
  parseHtmlTable,
} from "../src/core/v2-tables.ts";
import type { V2ContentList } from "../src/core/chunkers/v2-block.ts";

const text = (s: string) => ({ type: "text", content: s });

function tableBlock(html: string, caption = "", footnote = "") {
  return {
    type: "table" as const,
    content: {
      html,
      table_caption: caption ? [text(caption)] : [],
      table_footnote: footnote ? [text(footnote)] : [],
    },
  };
}

// =============================================================================
// HTML → grid
// =============================================================================

describe("parseHtmlTable", () => {
  test("基础表：3 行 2 列", () => {
    const html = `<table>
      <tr><td>name</td><td>value</td></tr>
      <tr><td>a</td><td>1</td></tr>
      <tr><td>b</td><td>2</td></tr>
    </table>`;
    const grid = parseHtmlTable(html);
    expect(grid).toEqual([
      ["name", "value"],
      ["a", "1"],
      ["b", "2"],
    ]);
  });

  test("rowspan：单元格垂直合并", () => {
    const html = `<table>
      <tr><td rowspan="2">A</td><td>x</td></tr>
      <tr><td>y</td></tr>
      <tr><td>B</td><td>z</td></tr>
    </table>`;
    const grid = parseHtmlTable(html);
    expect(grid).toEqual([
      ["A", "x"],
      ["A", "y"], // rowspan carry-over
      ["B", "z"],
    ]);
  });

  test("colspan：单元格水平合并", () => {
    const html = `<table>
      <tr><td colspan="2">merged header</td></tr>
      <tr><td>a</td><td>b</td></tr>
    </table>`;
    const grid = parseHtmlTable(html);
    expect(grid).toEqual([
      ["merged header", "merged header"],
      ["a", "b"],
    ]);
  });

  test("rowspan + colspan 同时", () => {
    const html = `<table>
      <tr><td rowspan="2" colspan="2">RC</td><td>x</td></tr>
      <tr><td>y</td></tr>
    </table>`;
    const grid = parseHtmlTable(html);
    expect(grid).toEqual([
      ["RC", "RC", "x"],
      ["RC", "RC", "y"],
    ]);
  });

  test("HTML 实体解码", () => {
    const html =
      "<table><tr><td>A &amp; B</td><td>&lt;tag&gt;</td><td>&#36;100</td></tr></table>";
    const grid = parseHtmlTable(html);
    expect(grid[0]).toEqual(["A & B", "<tag>", "$100"]);
  });

  test("&nbsp; 折叠为空格", () => {
    const html = "<table><tr><td>foo&nbsp;&nbsp;bar</td></tr></table>";
    const grid = parseHtmlTable(html);
    expect(grid[0]![0]).toBe("foo bar");
  });

  test("嵌套标签被剥离", () => {
    const html =
      "<table><tr><td><b>bold</b> text</td><td><span>span text</span></td></tr></table>";
    const grid = parseHtmlTable(html);
    expect(grid[0]).toEqual(["bold text", "span text"]);
  });

  test("缺省 rowspan / colspan 视为 1", () => {
    const html = `<table>
      <tr><td>a</td><td rowspan>b</td></tr>
      <tr><td>c</td><td>d</td></tr>
    </table>`;
    const grid = parseHtmlTable(html);
    expect(grid).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("空表格返回 []", () => {
    expect(parseHtmlTable("<table></table>")).toEqual([]);
  });

  test("不规则但含 <th>", () => {
    const html =
      "<table><tr><th>h1</th><th>h2</th></tr><tr><td>a</td><td>b</td></tr></table>";
    const grid = parseHtmlTable(html);
    expect(grid).toEqual([
      ["h1", "h2"],
      ["a", "b"],
    ]);
  });
});

// =============================================================================
// V2 → TableBundle
// =============================================================================

describe("buildTableBundleFromV2", () => {
  test("空 V2 → 空 bundle", () => {
    const bundle = buildTableBundleFromV2([]);
    expect(bundle.kind).toBe("tables");
    expect(bundle.version).toBe(1);
    expect(bundle.tableCount).toBe(0);
    expect(bundle.tables).toEqual([]);
    expect(isTableBundle(bundle)).toBe(true);
  });

  test("单表：headers + rows + 渲染 markdown", () => {
    const v2: V2ContentList = [
      [
        tableBlock(
          "<table><tr><td>name</td><td>value</td></tr><tr><td>a</td><td>1</td></tr></table>",
          "demo"
        ),
      ],
    ];
    const bundle = buildTableBundleFromV2(v2);
    expect(bundle.tableCount).toBe(1);
    const t = bundle.tables[0]!;
    expect(t.table_id).toBe("t1");
    expect(t.headers).toEqual(["name", "value"]);
    expect(t.rows).toEqual([["a", "1"]]);
    expect(t.row_count).toBe(1);
    expect(t.column_count).toBe(2);
    expect(t.row_markdowns).toEqual(["| a | 1 |"]);
    expect(t.raw_markdown).toContain("| name | value |");
    expect(t.raw_markdown).toContain("| --- | --- |");
    expect(t.raw_markdown).toContain("| a | 1 |");
  });

  test("多表：table_id 递增稳定", () => {
    const v2: V2ContentList = [
      [tableBlock("<table><tr><td>h</td></tr><tr><td>x</td></tr></table>")],
      [tableBlock("<table><tr><td>h2</td></tr><tr><td>y</td></tr></table>")],
      [tableBlock("<table><tr><td>h3</td></tr><tr><td>z</td></tr></table>")],
    ];
    const bundle = buildTableBundleFromV2(v2);
    expect(bundle.tableCount).toBe(3);
    expect(bundle.tables.map((t) => t.table_id)).toEqual(["t1", "t2", "t3"]);
  });

  test("无 html 字段的 table block 被忽略", () => {
    const v2: V2ContentList = [
      [{ type: "table", content: { html: "" } } as never],
      [tableBlock("<table><tr><td>h</td></tr><tr><td>x</td></tr></table>")],
    ];
    const bundle = buildTableBundleFromV2(v2);
    expect(bundle.tableCount).toBe(1);
  });

  test("管道 | 字符在 cell 里被转义", () => {
    const v2: V2ContentList = [
      [tableBlock("<table><tr><td>a|b</td><td>c</td></tr><tr><td>x</td><td>y</td></tr></table>")],
    ];
    const bundle = buildTableBundleFromV2(v2);
    expect(bundle.tables[0]!.headers).toEqual(["a|b", "c"]);
    expect(bundle.tables[0]!.raw_markdown).toContain("a\\|b");
  });

  test("非 table block 不被错误纳入", () => {
    const v2: V2ContentList = [
      [
        { type: "paragraph", content: { paragraph_content: [text("hi")] } },
        tableBlock("<table><tr><td>h</td></tr><tr><td>x</td></tr></table>"),
        { type: "title", content: { title_content: [text("T")], level: 1 } },
      ],
    ];
    const bundle = buildTableBundleFromV2(v2);
    expect(bundle.tableCount).toBe(1);
  });
});

// =============================================================================
// isTableBundle 健康
// =============================================================================

describe("isTableBundle", () => {
  test("正常 bundle 返回 true", () => {
    const valid = {
      kind: "tables",
      version: 1,
      extractedAt: new Date().toISOString(),
      tableCount: 0,
      tables: [],
    };
    expect(isTableBundle(valid)).toBe(true);
  });

  test("旧 bundle (kind=markdown_tables) 返回 false（语义已切换）", () => {
    const old = { kind: "markdown_tables", version: 1, tables: [] };
    expect(isTableBundle(old)).toBe(false);
  });

  test("非对象 / null / 缺字段返回 false", () => {
    expect(isTableBundle(null)).toBe(false);
    expect(isTableBundle("tables")).toBe(false);
    expect(isTableBundle({ kind: "tables" })).toBe(false);
    expect(isTableBundle({ kind: "tables", version: 2, tables: [] })).toBe(false);
  });
});

// =============================================================================
// 真实样本 smoke
// =============================================================================

describe("buildTableBundleFromV2 — real sample", () => {
  const weekly =
    "/Users/levin/project/agent/ae-wiki-agent/raw/research/260413 久谦论坛-调研周报_content_list_v2.json";

  test("提取 17 张表，rowspan 解析正确", () => {
    const v2 = JSON.parse(readFileSync(weekly, "utf-8")) as V2ContentList;
    const bundle = buildTableBundleFromV2(v2);
    expect(bundle.tableCount).toBe(17);
    bundle.tables.forEach((t, i) => {
      expect(t.table_id).toBe(`t${i + 1}`);
      expect(t.column_count).toBeGreaterThan(0);
      expect(t.row_count).toBeGreaterThanOrEqual(0);
    });

    // 第一张是 "AI 硬件总表"，含 rowspan 大类列（AI 芯片 / 内存 / 互联网络 ...）
    const first = bundle.tables[0]!;
    // 第 0 列是大类，靠 rowspan 重复展开
    const firstColUnique = new Set(first.rows.map((r) => r[0]));
    expect(firstColUnique.size).toBeGreaterThan(1);
    expect(firstColUnique.size).toBeLessThan(first.row_count); // 必有重复（说明 rowspan 被展开）
    // 应有 NVDA 行
    const nvdaRow = first.rows.find((r) => r.includes("NVDA.O"));
    expect(nvdaRow).toBeDefined();
    // NVDA 应在 AI 芯片大类下
    expect(nvdaRow![0]).toContain("AI芯片");
  });
});
