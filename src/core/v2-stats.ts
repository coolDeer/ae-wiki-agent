/**
 * V2 content_list 结构信号 —— 给 ingest:peek 用作 0 阅读量 triage 决策依据。
 *
 * 输入是 mineru `parsedContentListV2S3` 反序列化后的二维 block 数组。
 * 提取廉价统计：物理页数、blocks 数、tables 数、titles 数、顶级 sections。
 */

import type { V2ContentList } from "~/core/chunkers/v2-block.ts";

export interface V2Stats {
  pageCount: number;
  blockCount: number;
  tableCount: number;
  titleCount: number;
  /** 顶级 (level=1) section 标题列表，最多 10 条。 */
  topLevelSections: string[];
}

const TOP_LEVEL_SECTION_CAP = 10;

export function summarizeV2(v2: V2ContentList): V2Stats {
  let blockCount = 0;
  let tableCount = 0;
  let titleCount = 0;
  const topLevelSections: string[] = [];

  if (!Array.isArray(v2)) {
    return { pageCount: 0, blockCount, tableCount, titleCount, topLevelSections };
  }

  for (const page of v2) {
    if (!Array.isArray(page)) continue;
    for (const block of page) {
      if (!block || typeof block !== "object") continue;
      blockCount++;
      const t = (block as { type?: unknown }).type;
      if (t === "table") {
        tableCount++;
      } else if (t === "title") {
        titleCount++;
        const c = (
          block as {
            content?: { level?: number; title_content?: { content?: string }[] };
          }
        ).content;
        if (c?.level === 1 && topLevelSections.length < TOP_LEVEL_SECTION_CAP) {
          const text = (c.title_content ?? [])
            .map((s) => s?.content ?? "")
            .join("")
            .trim();
          if (text) topLevelSections.push(text);
        }
      }
    }
  }

  return {
    pageCount: v2.length,
    blockCount,
    tableCount,
    titleCount,
    topLevelSections,
  };
}
