/**
 * V2 block-aware chunker.
 *
 * 消费 mineru `parsedContentListV2S3` 的结构化 block JSON，按以下策略切块：
 *
 *   1. drop page_header / page_footer / page_number 三类整页噪声
 *   2. title 块用作 section 边界（不单独成 chunk），section_path 取全路径
 *   3. paragraph / list 累积到 token-budget（默认 ~800 tokens），到 budget 才 flush
 *      —— 单个超大 paragraph 不切，独立成块（用户决定，避免破坏语义）
 *   4. table 始终独立成块；prefix 加 section_path + caption
 *   5. list 整体当原子单元，≤ MAX_LIST_ATOMIC 不拆 item；超大才按 item 切
 *   6. chunk_text 顶部注入 `section_path` 行，让小块也带语境
 *   7. 末尾过滤掉 < MIN_CHUNK_CHARS 的碎片（"保密"之类的零信息块）
 *
 * Token 估算用粗略启发式：CJK 字符 / 1.5 + 非 CJK / 4，不引入 tokenizer 依赖。
 *
 * 输出 ChunkInput[]，由 stage-2-chunk.ts 做 DB 落库。
 */

// =============================================================================
// V2 block schema (duck-typed; 来源样本见 raw/research/*.json)
// =============================================================================

export interface V2Span {
  type: string; // "text" 是绝大多数；spec 上还有 inline_equation / image_ref 等
  content?: string;
}

export interface V2TitleBlock {
  type: "title";
  content: { title_content?: V2Span[]; level: number };
  bbox?: number[];
}

export interface V2ParagraphBlock {
  type: "paragraph";
  content: { paragraph_content?: V2Span[] };
  bbox?: number[];
}

export interface V2ListItem {
  item_type?: string;
  ilevel?: number;
  prefix?: string;
  item_content?: V2Span[];
}

export interface V2ListBlock {
  type: "list";
  content: {
    list_type?: string;
    attribute?: string;
    list_items?: V2ListItem[];
  };
  bbox?: number[];
}

export interface V2TableBlock {
  type: "table";
  content: {
    image_source?: { path?: string };
    table_caption?: V2Span[];
    table_footnote?: V2Span[];
    html?: string;
    table_type?: string;
    table_nest_level?: number;
  };
  bbox?: number[];
}

export interface V2NoiseBlock {
  type: "page_header" | "page_footer" | "page_number";
  content: Record<string, V2Span[]>;
  bbox?: number[];
}

export type V2Block =
  | V2TitleBlock
  | V2ParagraphBlock
  | V2ListBlock
  | V2TableBlock
  | V2NoiseBlock
  | { type: string; content?: unknown; bbox?: number[] };

/** 顶层：page[] of block[]。 */
export type V2ContentList = V2Block[][];

// =============================================================================
// Output
// =============================================================================

export type V2ChunkType = "text" | "list" | "table";

export interface V2Chunk {
  text: string;
  type: V2ChunkType;
  pageIdx: number; // 0-based，跨页 chunk 取首块所在页
  sectionPath: string[]; // 全路径，e.g. ["专家观点", "Q1 Title"]
}

// =============================================================================
// Tunables
// =============================================================================

export interface V2ChunkerOptions {
  /** 普通 paragraph 滚动预算（tokens），到此值后 flush。默认 800。 */
  targetTokens?: number;
  /** list 整体不拆的上限。超过此值才按 item 切。默认 2400。 */
  maxListAtomicTokens?: number;
  /** 末尾过滤：chunk_text 字符数 < 此阈值则丢弃。默认 30。 */
  minChunkChars?: number;
  /** list 拆 item 时 overlap 几个 item。默认 1。 */
  listSplitOverlap?: number;
}

const DEFAULTS = {
  targetTokens: 800,
  maxListAtomicTokens: 2400,
  minChunkChars: 30,
  listSplitOverlap: 1,
};

// =============================================================================
// Public API
// =============================================================================

export function chunkContentListV2(
  data: V2ContentList,
  opts: V2ChunkerOptions = {}
): V2Chunk[] {
  const cfg = { ...DEFAULTS, ...opts };
  const out: V2Chunk[] = [];

  // section stack: 维护 active title 路径
  const sectionStack: { level: number; title: string }[] = [];

  // text-rolling buffer：跨 paragraph/list 聚合，直到 budget 满或 section 边界 / 表格
  let buffer: {
    parts: string[];
    tokens: number;
    pageIdx: number; // 首块的页
    sectionPath: string[]; // 首块入 buffer 时的 section
    type: V2ChunkType; // 首块类型决定整 chunk type；混合 paragraph+list 走 'text'
  } | null = null;

  const flush = () => {
    if (!buffer) return;
    const body = buffer.parts.join("\n\n").trim();
    if (body.length === 0) {
      buffer = null;
      return;
    }
    out.push(makeChunk(buffer.sectionPath, body, buffer.type, buffer.pageIdx));
    buffer = null;
  };

  if (!Array.isArray(data)) return [];

  for (let pageIdx = 0; pageIdx < data.length; pageIdx++) {
    const page = data[pageIdx];
    if (!Array.isArray(page)) continue;

    for (const block of page) {
      if (!block || typeof block !== "object" || typeof block.type !== "string") continue;

      // 1. 噪声块直接跳过
      if (
        block.type === "page_header" ||
        block.type === "page_footer" ||
        block.type === "page_number"
      ) {
        continue;
      }

      // 2. title：更新 section stack，flush buffer
      if (block.type === "title") {
        const t = block as V2TitleBlock;
        const titleText = renderSpans(t.content?.title_content).trim();
        const level = typeof t.content?.level === "number" ? t.content.level : 1;
        if (titleText.length === 0) continue;

        flush();
        // pop 同级或更深
        while (
          sectionStack.length > 0 &&
          sectionStack[sectionStack.length - 1]!.level >= level
        ) {
          sectionStack.pop();
        }
        sectionStack.push({ level, title: titleText });
        continue;
      }

      // 3. table：独立 chunk
      if (block.type === "table") {
        flush();
        const tb = block as V2TableBlock;
        const caption = renderSpans(tb.content?.table_caption).trim();
        const footnote = renderSpans(tb.content?.table_footnote).trim();
        const html = (tb.content?.html ?? "").trim();
        if (html.length === 0 && caption.length === 0) continue;

        const parts: string[] = [];
        if (caption) parts.push(`Table: ${caption}`);
        if (html) parts.push(html);
        if (footnote) parts.push(`(footnote: ${footnote})`);
        out.push(
          makeChunk(
            currentSectionPath(sectionStack),
            parts.join("\n\n"),
            "table",
            pageIdx
          )
        );
        continue;
      }

      // 4. list
      if (block.type === "list") {
        const lb = block as V2ListBlock;
        const listText = renderList(lb).trim();
        if (listText.length === 0) continue;
        const tokens = estimateTokens(listText);

        // 巨型 list：拆 item 输出
        if (tokens > cfg.maxListAtomicTokens) {
          flush();
          for (const itemChunk of splitLargeList(
            lb,
            cfg.targetTokens,
            cfg.listSplitOverlap
          )) {
            out.push(
              makeChunk(
                currentSectionPath(sectionStack),
                itemChunk,
                "list",
                pageIdx
              )
            );
          }
          continue;
        }

        // 普通 list：尝试塞进 buffer，超 budget 先 flush
        if (
          buffer &&
          buffer.tokens + tokens > cfg.targetTokens &&
          buffer.parts.length > 0
        ) {
          flush();
        }
        if (!buffer) {
          buffer = {
            parts: [listText],
            tokens,
            pageIdx,
            sectionPath: currentSectionPath(sectionStack),
            type: "list",
          };
        } else {
          buffer.parts.push(listText);
          buffer.tokens += tokens;
          // buffer 起头是 list 时保留 list 类型；混合后退化成 text
          if (buffer.type === "list") buffer.type = "list";
        }
        continue;
      }

      // 5. paragraph
      if (block.type === "paragraph") {
        const pb = block as V2ParagraphBlock;
        const paraText = renderSpans(pb.content?.paragraph_content).trim();
        if (paraText.length === 0) continue;
        const tokens = estimateTokens(paraText);

        // 超 budget 且 buffer 非空 → flush 后开新块（giant paragraph 自然单独成块）
        if (
          buffer &&
          buffer.tokens + tokens > cfg.targetTokens &&
          buffer.parts.length > 0
        ) {
          flush();
        }
        if (!buffer) {
          buffer = {
            parts: [paraText],
            tokens,
            pageIdx,
            sectionPath: currentSectionPath(sectionStack),
            type: "text",
          };
        } else {
          buffer.parts.push(paraText);
          buffer.tokens += tokens;
          if (buffer.type === "list") buffer.type = "text"; // 混合 → text
        }
        continue;
      }

      // 6. 未知 block：保守按 paragraph 处理（防御性）
      const fallbackText = extractAnyText(block).trim();
      if (fallbackText.length === 0) continue;
      const tokens = estimateTokens(fallbackText);
      if (
        buffer &&
        buffer.tokens + tokens > cfg.targetTokens &&
        buffer.parts.length > 0
      ) {
        flush();
      }
      if (!buffer) {
        buffer = {
          parts: [fallbackText],
          tokens,
          pageIdx,
          sectionPath: currentSectionPath(sectionStack),
          type: "text",
        };
      } else {
        buffer.parts.push(fallbackText);
        buffer.tokens += tokens;
      }
    }
  }

  flush();

  // 末尾过滤：极短碎片丢弃（"保密" / 残留页码等）
  return out.filter((c) => stripSectionHeader(c.text).length >= cfg.minChunkChars);
}

// =============================================================================
// 内部工具
// =============================================================================

function makeChunk(
  sectionPath: string[],
  body: string,
  type: V2ChunkType,
  pageIdx: number
): V2Chunk {
  const header =
    sectionPath.length > 0 ? `${sectionPath.join(" > ")}\n\n` : "";
  return {
    text: `${header}${body}`,
    type,
    pageIdx,
    sectionPath: [...sectionPath],
  };
}

function currentSectionPath(stack: { level: number; title: string }[]): string[] {
  return stack.map((s) => s.title);
}

/** 仅供 minChunkChars 过滤用；剥掉 "section > section\n\n" 头部后看 body 长度。 */
function stripSectionHeader(text: string): string {
  const idx = text.indexOf("\n\n");
  if (idx === -1) return text;
  return text.slice(idx + 2);
}

function renderSpans(spans: V2Span[] | undefined): string {
  if (!spans || !Array.isArray(spans)) return "";
  return spans
    .map((s) => (typeof s?.content === "string" ? s.content : ""))
    .join("");
}

function renderList(lb: V2ListBlock): string {
  const items = lb.content?.list_items ?? [];
  return items
    .map((it) => {
      const prefix = it.prefix && it.prefix.length > 0 ? `${it.prefix} ` : "- ";
      const indent = " ".repeat(Math.max(0, (it.ilevel ?? 0) * 2));
      return `${indent}${prefix}${renderSpans(it.item_content).trim()}`;
    })
    .filter((line) => line.replace(/^[\s\-*•]+/, "").length > 0)
    .join("\n");
}

/**
 * 巨型 list：按 token-budget 切 item，每段保留前 N 个 item 作 overlap。
 * 输出已 render 好的字符串数组（不含 section header，由调用方加）。
 */
function splitLargeList(
  lb: V2ListBlock,
  targetTokens: number,
  overlap: number
): string[] {
  const items = lb.content?.list_items ?? [];
  const rendered = items.map((it) => {
    const prefix = it.prefix && it.prefix.length > 0 ? `${it.prefix} ` : "- ";
    const indent = " ".repeat(Math.max(0, (it.ilevel ?? 0) * 2));
    return `${indent}${prefix}${renderSpans(it.item_content).trim()}`;
  });

  const out: string[] = [];
  let cur: string[] = [];
  let curTokens = 0;

  for (let i = 0; i < rendered.length; i++) {
    const line = rendered[i]!;
    const t = estimateTokens(line);
    if (curTokens + t > targetTokens && cur.length > 0) {
      out.push(cur.join("\n"));
      // overlap 前 N 个
      const tail = cur.slice(-overlap);
      cur = [...tail, line];
      curTokens = cur.reduce((s, l) => s + estimateTokens(l), 0);
    } else {
      cur.push(line);
      curTokens += t;
    }
  }
  if (cur.length > 0) out.push(cur.join("\n"));
  return out;
}

/**
 * 粗略 token 估算：CJK / 1.5 + 非 CJK / 4。
 * 用 cl100k 风格做近似，不依赖外部 tokenizer。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // 主要 CJK 区段：U+4E00-9FFF（中日韩统一表意）+ U+3000-30FF（日文假名标点）+ U+FF00-FFEF（全角）
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

/** 万一遇到 schema 外块，用尽量保守的方式找 text。 */
function extractAnyText(block: { content?: unknown }): string {
  const collected: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === "string") {
      collected.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === "object") {
      for (const v of Object.values(n as Record<string, unknown>)) walk(v);
    }
  };
  walk(block.content);
  return collected.join(" ");
}
