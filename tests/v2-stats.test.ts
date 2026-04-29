/**
 * summarizeV2 测试 —— ingest:peek 的 V2 结构信号产出。
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { summarizeV2 } from "../src/core/v2-stats.ts";
import type { V2ContentList } from "../src/core/chunkers/v2-block.ts";

const txt = (s: string) => ({ type: "text", content: s });

describe("summarizeV2", () => {
  test("空输入：全 0", () => {
    expect(summarizeV2([])).toEqual({
      pageCount: 0,
      blockCount: 0,
      tableCount: 0,
      titleCount: 0,
      topLevelSections: [],
    });
  });

  test("非数组防御", () => {
    const stats = summarizeV2(null as unknown as V2ContentList);
    expect(stats.pageCount).toBe(0);
    expect(stats.blockCount).toBe(0);
  });

  test("单页 mix block：counts 准确", () => {
    const v2: V2ContentList = [
      [
        { type: "title", content: { title_content: [txt("S1")], level: 1 } },
        { type: "paragraph", content: { paragraph_content: [txt("hi")] } },
        { type: "table", content: { html: "<table></table>" } },
        { type: "title", content: { title_content: [txt("Sub")], level: 4 } },
      ],
    ];
    const stats = summarizeV2(v2);
    expect(stats.pageCount).toBe(1);
    expect(stats.blockCount).toBe(4);
    expect(stats.tableCount).toBe(1);
    expect(stats.titleCount).toBe(2);
    expect(stats.topLevelSections).toEqual(["S1"]);
  });

  test("topLevelSections 仅收 level=1，最多 10 条", () => {
    const titles = Array.from({ length: 12 }, (_, i) => ({
      type: "title" as const,
      content: { title_content: [txt(`Top${i + 1}`)], level: 1 },
    }));
    const v2: V2ContentList = [titles];
    const stats = summarizeV2(v2);
    expect(stats.topLevelSections).toHaveLength(10);
    expect(stats.topLevelSections[0]).toBe("Top1");
    expect(stats.topLevelSections[9]).toBe("Top10");
  });

  test("跨页 block 累加；topLevelSections 排除空 title_content", () => {
    const v2: V2ContentList = [
      [{ type: "title", content: { title_content: [txt("Page0")], level: 1 } }],
      [
        { type: "title", content: { title_content: [], level: 1 } }, // 空标题
        { type: "title", content: { title_content: [txt("Page1")], level: 1 } },
      ],
    ];
    const stats = summarizeV2(v2);
    expect(stats.pageCount).toBe(2);
    expect(stats.blockCount).toBe(3);
    expect(stats.titleCount).toBe(3);
    expect(stats.topLevelSections).toEqual(["Page0", "Page1"]);
  });

  test("真实样本 weekly：26 pages / 17 tables / 11 titles", () => {
    const data = JSON.parse(
      readFileSync(
        "/Users/levin/project/agent/ae-wiki-agent/raw/research/260413 久谦论坛-调研周报_content_list_v2.json",
        "utf-8"
      )
    ) as V2ContentList;
    const stats = summarizeV2(data);
    expect(stats.pageCount).toBe(26);
    expect(stats.tableCount).toBe(17);
    expect(stats.titleCount).toBe(11);
    expect(stats.topLevelSections.length).toBeGreaterThan(0);
    expect(stats.topLevelSections.length).toBeLessThanOrEqual(10);
    // 顶级章节中常见的应出现
    const hasIntro = stats.topLevelSections.some(
      (s) => s.includes("板块观点") || s.includes("前沿趋势") || s.includes("海外")
    );
    expect(hasIntro).toBe(true);
  });

  test("真实样本 interview：1 page / 0 tables / 26 titles", () => {
    const data = JSON.parse(
      readFileSync(
        "/Users/levin/project/agent/ae-wiki-agent/raw/research/69f0d5c9cc43306ddf882639_20260428172357_content_list_v2.json",
        "utf-8"
      )
    ) as V2ContentList;
    const stats = summarizeV2(data);
    expect(stats.pageCount).toBe(1);
    expect(stats.tableCount).toBe(0);
    expect(stats.titleCount).toBe(26);
    // 4 个 level=1 + 22 个 level=4，topLevelSections 应有 4 项
    expect(stats.topLevelSections.length).toBe(4);
  });
});
