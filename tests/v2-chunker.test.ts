/**
 * V2 block chunker 测试。
 *
 * 用法：`bun test tests/v2-chunker.test.ts`
 *
 * 覆盖：
 *   - 噪声块（page_header / page_footer / page_number）丢弃
 *   - title 不单独成 chunk，section_path 正确（含层级 pop）
 *   - 跨页累积、首页 pageIdx 归属
 *   - paragraph token-budget 滚动
 *   - 单个超大 paragraph 不切，独立成块
 *   - table 独立成块，prefix 含 caption + section
 *   - list ≤ MAX_LIST_ATOMIC 整体保留
 *   - list 超大按 item 切，带 overlap
 *   - 末尾过滤掉极短碎片
 *   - chunk_text 头部带 section_path
 *   - 真实样本 raw/research/*.json 可消费、不抛异常
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  chunkContentListV2,
  estimateTokens,
  type V2Block,
  type V2ContentList,
} from "../src/core/chunkers/v2-block.ts";

// =============================================================================
// 工厂函数：构造测试用 V2 block
// =============================================================================

const text = (s: string) => ({ type: "text", content: s });

function title(level: number, content: string): V2Block {
  return { type: "title", content: { title_content: [text(content)], level } };
}

function paragraph(content: string): V2Block {
  return { type: "paragraph", content: { paragraph_content: [text(content)] } };
}

function list(items: string[]): V2Block {
  return {
    type: "list",
    content: {
      list_type: "text_list",
      list_items: items.map((c, i) => ({
        item_type: "text",
        ilevel: 0,
        prefix: "-",
        item_content: [text(c)],
      })),
    },
  };
}

function table(html: string, caption = "", footnote = ""): V2Block {
  return {
    type: "table",
    content: {
      html,
      table_caption: caption ? [text(caption)] : [],
      table_footnote: footnote ? [text(footnote)] : [],
      table_type: "simple_table",
      table_nest_level: 1,
    },
  };
}

const noise = (
  type: "page_header" | "page_footer" | "page_number",
  content: string
): V2Block => ({
  type,
  content: { [`${type}_content`]: [text(content)] },
});

// =============================================================================
// 噪声 / 边界
// =============================================================================

describe("V2 chunker — noise & edge cases", () => {
  test("空输入返回空数组", () => {
    expect(chunkContentListV2([])).toEqual([]);
  });

  test("非数组输入返回空数组（防御）", () => {
    expect(chunkContentListV2(null as unknown as V2ContentList)).toEqual([]);
    expect(chunkContentListV2({} as unknown as V2ContentList)).toEqual([]);
  });

  test("page_header / page_footer / page_number 整页噪声丢弃", () => {
    const data: V2ContentList = [
      [
        noise("page_header", "Confidential"),
        noise("page_footer", "abc123sig"),
        noise("page_number", "p.1"),
        paragraph("This is a long paragraph that should clearly survive the noise filter."),
      ],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("survive the noise filter");
    expect(chunks[0]!.text).not.toContain("Confidential");
    expect(chunks[0]!.text).not.toContain("abc123sig");
  });

  test("极短碎片（< minChunkChars）末尾被过滤", () => {
    const data: V2ContentList = [
      [paragraph("OK")], // 2 chars
      [paragraph("A long enough paragraph to definitely exceed the minimum threshold and stay.")],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("long enough paragraph");
  });
});

// =============================================================================
// title / section_path
// =============================================================================

describe("V2 chunker — section_path", () => {
  test("title 不单独成 chunk", () => {
    const data: V2ContentList = [
      [title(1, "Just A Title With No Body Below It"), paragraph("a".repeat(50))],
    ];
    const chunks = chunkContentListV2(data);
    // 1 chunk 出来，是 paragraph 的；title 作为 prefix
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.sectionPath).toEqual(["Just A Title With No Body Below It"]);
  });

  test("level 嵌套：H1 + H4 子题，section_path 是全路径", () => {
    const data: V2ContentList = [
      [
        title(1, "Expert Q&A"),
        title(4, "Q1: revenue outlook?"),
        paragraph("Answer to Q1 with sufficient text to pass min length threshold."),
        title(4, "Q2: margins?"),
        paragraph("Answer to Q2 with sufficient text to pass min length threshold."),
      ],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.sectionPath).toEqual(["Expert Q&A", "Q1: revenue outlook?"]);
    expect(chunks[1]!.sectionPath).toEqual(["Expert Q&A", "Q2: margins?"]);
  });

  test("level 同级 title 弹出兄弟，路径不累积", () => {
    const data: V2ContentList = [
      [
        title(1, "Section A"),
        paragraph("body of A — long enough to keep."),
        title(1, "Section B"), // pop A，push B
        paragraph("body of B — long enough to keep."),
      ],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.sectionPath).toEqual(["Section A"]);
    expect(chunks[1]!.sectionPath).toEqual(["Section B"]);
  });

  test("更高级 title 弹出更深节点", () => {
    const data: V2ContentList = [
      [
        title(1, "Top"),
        title(2, "Mid"),
        title(4, "Deep"),
        paragraph("body — long enough to keep this chunk alive."),
        title(1, "NewTop"), // 应弹出 Mid + Deep
        paragraph("new body — long enough to keep this chunk alive too."),
      ],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks[0]!.sectionPath).toEqual(["Top", "Mid", "Deep"]);
    expect(chunks[1]!.sectionPath).toEqual(["NewTop"]);
  });

  test("chunk.text 顶部带 section_path 行", () => {
    const data: V2ContentList = [
      [title(1, "Hello"), paragraph("Hello body. Long enough to keep alive.")],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks[0]!.text.startsWith("Hello\n\n")).toBe(true);
  });
});

// =============================================================================
// 跨页 / pageIdx
// =============================================================================

describe("V2 chunker — pageIdx & cross-page", () => {
  test("单页 chunk 取所在页 idx（用 title 强制 flush 分块）", () => {
    const data: V2ContentList = [
      [title(1, "S1"), paragraph("first page content — long enough to keep.")],
      [title(1, "S2"), paragraph("second page content — long enough to keep.")],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.pageIdx).toBe(0);
    expect(chunks[1]!.pageIdx).toBe(1);
  });

  test("跨页累积时 chunk.pageIdx 取首块页码", () => {
    // 两页内容都很短，能塞进同一个 buffer
    const data: V2ContentList = [
      [title(1, "S"), paragraph("short on page 0.")],
      [paragraph("short continuation on page 1.")],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pageIdx).toBe(0); // 首块（page 0）的 idx
  });
});

// =============================================================================
// paragraph token budget
// =============================================================================

describe("V2 chunker — paragraph budget rolling", () => {
  test("普通段落聚合到同一 chunk", () => {
    const data: V2ContentList = [
      [
        title(1, "S"),
        paragraph("first paragraph that is short."),
        paragraph("second paragraph also short."),
        paragraph("third paragraph still short."),
      ],
    ];
    const chunks = chunkContentListV2(data, { targetTokens: 800 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("first paragraph");
    expect(chunks[0]!.text).toContain("third paragraph still short");
  });

  test("超 budget 时在最近 paragraph 边界 flush", () => {
    // 用 small budget 触发切分
    const big = "a".repeat(400); // ~100 tokens
    const data: V2ContentList = [
      [
        title(1, "S"),
        paragraph(big),
        paragraph(big),
        paragraph(big),
        paragraph(big),
      ],
    ];
    const chunks = chunkContentListV2(data, { targetTokens: 150 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.sectionPath).toEqual(["S"]));
  });

  test("单个超大 paragraph 不被切，独立成 1 chunk", () => {
    const huge = "x".repeat(8000); // ~2000 tokens
    const data: V2ContentList = [
      [title(1, "Big"), paragraph(huge), paragraph("epilogue — long enough to keep separately.")],
    ];
    const chunks = chunkContentListV2(data, { targetTokens: 500 });
    // huge 单独 1 chunk + epilogue 1 chunk
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.text).toContain("xxxxxx");
    expect(chunks[1]!.text).toContain("epilogue");
  });

  test("CJK 超 maxHardTokensCjk 的 chunk 被强制切（防御 OpenAI 8192 上限）", () => {
    // 纯 CJK 6500 字符 ~= 4333 estimateTokens > 2500 默认上限
    const giant = "中".repeat(6500);
    const data: V2ContentList = [[title(1, "S"), paragraph(giant)]];
    const chunks = chunkContentListV2(data); // 默认 maxHardTokensCjk=2500

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(2500);
      expect(c.sectionPath).toEqual(["S"]);
      expect(c.text.startsWith("S\n\n")).toBe(true);
    }
  });

  test("纯 ASCII 默认 maxHardTokensAscii=3000 会保守切分", () => {
    // 纯 ASCII 22000 字符 ~= 5500 tokens（> 3000），默认应切分
    const big = "x".repeat(22000);
    const data: V2ContentList = [[title(1, "S"), paragraph(big)]];
    const chunks = chunkContentListV2(data);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(3000);
    }

    // 显式放宽 ASCII 上限时，CJK 阈值不影响纯 ASCII 内容。
    const wideChunks = chunkContentListV2(data, {
      maxHardTokensCjk: 200,
      maxHardTokensAscii: 6500,
    });
    expect(wideChunks).toHaveLength(1);
  });

  test("段落级切优先（保留段落边界）", () => {
    // 5 段中文，每段 1500 字 ≈ 1000 tokens；总 5000 > 2500 → 必切
    const para = "中".repeat(1500);
    const body = [para, para, para, para, para].join("\n\n");
    const data: V2ContentList = [[title(1, "S"), paragraph(body)]];
    const chunks = chunkContentListV2(data);
    expect(chunks.length).toBeGreaterThan(1);
    // 切完每片都 ≤ 2500
    for (const c of chunks) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(2500);
    }
  });

  test("单段落超限走句子边界（不一刀切字符）", () => {
    // 一段中文 8 句，每句 800 字（带句号），总 6400+ 字
    // 单段 ~4500 token > 2500 → 触发段落内 split
    const sent = "中".repeat(800) + "。";
    const para = sent.repeat(8); // ~6400 chars + 句号
    const data: V2ContentList = [[title(1, "S"), paragraph(para)]];
    const chunks = chunkContentListV2(data);
    expect(chunks.length).toBeGreaterThan(1);
    // 关键：切片应该以句号结尾（说明是按句子切的，不是字符切）
    const allEndOnSentence = chunks.every((c) => {
      const body = c.text.replace(/^S\n\n/, "");
      return /[.!?。！？]\s*$/.test(body);
    });
    expect(allEndOnSentence).toBe(true);
  });

  test("无标点的超长字符串走字符兜底", () => {
    // 没有任何句子边界，单"句"超限 → 字符切
    // 8000 中字 ~5333 tokens > 2500，且没有标点
    const noPunct = "中".repeat(8000);
    const data: V2ContentList = [[title(1, "S"), paragraph(noPunct)]];
    const chunks = chunkContentListV2(data);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(2500);
    }
  });

  test("自定义 maxHardTokensCjk 生效", () => {
    const giant = "中".repeat(2000);
    const data: V2ContentList = [[title(1, "S"), paragraph(giant)]];
    const chunks = chunkContentListV2(data, { maxHardTokensCjk: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(200);
    }
  });
});

// =============================================================================
// table
// =============================================================================

describe("V2 chunker — table", () => {
  test("table 始终独立成 chunk，prefix 含 caption + section_path", () => {
    const data: V2ContentList = [
      [
        title(1, "AI Hardware"),
        paragraph("intro paragraph long enough to keep separately."),
        table("<table><tr><td>x</td></tr></table>", "AI Hardware Master Table"),
        paragraph("trailing paragraph long enough to keep separately."),
      ],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks).toHaveLength(3); // intro / table / trailing
    const tableChunk = chunks.find((c) => c.type === "table");
    expect(tableChunk).toBeDefined();
    expect(tableChunk!.text).toContain("AI Hardware\n\n"); // section header
    expect(tableChunk!.text).toContain("Table: AI Hardware Master Table");
    expect(tableChunk!.text).toContain("<table>");
    expect(tableChunk!.sectionPath).toEqual(["AI Hardware"]);
  });

  test("table footnote 出现在末尾", () => {
    const data: V2ContentList = [
      [table("<table></table>", "Cap", "footnote text here")],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks[0]!.text).toContain("(footnote: footnote text here)");
  });
});

// =============================================================================
// list
// =============================================================================

describe("V2 chunker — list", () => {
  test("普通 list 当原子单元不拆 item", () => {
    const data: V2ContentList = [
      [title(1, "Section"), list(["item one", "item two", "item three"])],
    ];
    const chunks = chunkContentListV2(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("- item one");
    expect(chunks[0]!.text).toContain("- item two");
    expect(chunks[0]!.text).toContain("- item three");
    expect(chunks[0]!.type).toBe("list");
  });

  test("超大 list 按 item 切，带 overlap", () => {
    // 每个 item ~1000 chars (~250 tokens)，10 个共 ~2500 tokens > maxListAtomicTokens 2400
    const items = Array.from({ length: 10 }, (_, i) => "y".repeat(1000) + `_${i}`);
    const data: V2ContentList = [[list(items)]];
    const chunks = chunkContentListV2(data, {
      targetTokens: 600,
      maxListAtomicTokens: 2400,
      listSplitOverlap: 1,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // 每个 chunk 都是 list 类型
    chunks.forEach((c) => expect(c.type).toBe("list"));
    // 后续 chunks 应包含上一个 chunk 的 tail 作为 overlap
    if (chunks.length >= 2) {
      const first = chunks[0]!.text;
      const second = chunks[1]!.text;
      const allTokens = first.match(/_\d+/g) ?? [];
      const lastItemId = allTokens[allTokens.length - 1];
      expect(lastItemId).toBeDefined();
      expect(second).toContain(lastItemId!);
    }
  });
});

// =============================================================================
// estimateTokens 健康
// =============================================================================

describe("estimateTokens", () => {
  test("空字符串 0 tokens", () => {
    expect(estimateTokens("")).toBe(0);
  });

  test("纯英文 ~ length/4", () => {
    expect(estimateTokens("hello world")).toBe(Math.ceil(11 / 4));
  });

  test("纯中文 ~ length/1.5", () => {
    const t = estimateTokens("中文测试句子");
    expect(t).toBeGreaterThanOrEqual(Math.ceil(6 / 1.5));
    expect(t).toBeLessThanOrEqual(Math.ceil(6 / 1.5) + 1);
  });
});

// =============================================================================
// 真实样本 smoke test
// =============================================================================

describe("V2 chunker — real samples (smoke)", () => {
  const interview =
    "/Users/levin/project/agent/ae-wiki-agent/raw/research/69f0d5c9cc43306ddf882639_20260428172357_content_list_v2.json";
  const weekly =
    "/Users/levin/project/agent/ae-wiki-agent/raw/research/260413 久谦论坛-调研周报_content_list_v2.json";

  test("interview Q&A 样本：每个 Q&A 独立 chunk", () => {
    const data = JSON.parse(readFileSync(interview, "utf-8")) as V2ContentList;
    const chunks = chunkContentListV2(data);
    expect(chunks.length).toBeGreaterThan(15); // 22 个 Q&A，少数太短被合并算正常
    // 每个 chunk 都应至少在 "专家观点" 树下
    const qaChunks = chunks.filter((c) =>
      c.sectionPath.some((s) => s.includes("专家观点"))
    );
    expect(qaChunks.length).toBeGreaterThan(15);
  });

  test("weekly 报告样本：去除噪声、产出合理数量 chunk、含 table", () => {
    const data = JSON.parse(readFileSync(weekly, "utf-8")) as V2ContentList;
    const chunks = chunkContentListV2(data);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.length).toBeLessThan(200);
    // 应有 table 类型 chunk
    const tableChunks = chunks.filter((c) => c.type === "table");
    expect(tableChunks.length).toBeGreaterThan(0);
    // 不应包含已知噪声字符串
    chunks.forEach((c) => {
      // page_footer 是签名串，包含 "fixn8"
      expect(c.text.includes("fixn8NluP0Gxioh")).toBe(false);
    });
  });
});
