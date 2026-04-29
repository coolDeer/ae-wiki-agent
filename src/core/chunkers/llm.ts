/**
 * LLM-Guided 分段器 — 滑窗 + LLM 找首个主题切换点。
 * 借鉴 gbrain llm_text_chunker（167 LOC），保持 askLlm hook 可注入；不注入则回退 recursive。
 */

import { chunkText as recursiveChunk, type TextChunk } from "./recursive.ts";

const CANDIDATE_SIZE = 128;
const MAX_RETRIES = 3;
const WINDOW_SIZE = 5;

export interface LlmChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  /** 注入的 LLM 调用；不提供时回退 recursive。 */
  askLlm?: (prompt: string) => Promise<string>;
}

export async function chunkTextLlm(
  text: string,
  opts: LlmChunkOptions
): Promise<TextChunk[]> {
  const chunkSize = opts.chunkSize ?? 300;
  const chunkOverlap = opts.chunkOverlap ?? 50;
  const askLlm = opts.askLlm;

  if (!askLlm) return recursiveChunk(text, { chunkSize, chunkOverlap });

  try {
    const candidates = recursiveChunk(text, {
      chunkSize: CANDIDATE_SIZE,
      chunkOverlap: 0,
    });
    if (candidates.length <= 2) {
      return recursiveChunk(text, { chunkSize, chunkOverlap });
    }
    const splitPoints = await findSplitPoints(candidates, askLlm);
    const merged = mergeAtSplits(candidates, splitPoints);
    return merged.map((t, i) => ({ text: t.trim(), index: i }));
  } catch {
    return recursiveChunk(text, { chunkSize, chunkOverlap });
  }
}

async function findSplitPoints(
  candidates: TextChunk[],
  askLlm: (prompt: string) => Promise<string>
): Promise<number[]> {
  const splitPoints: number[] = [];
  let pos = 0;
  while (pos < candidates.length - 1) {
    const windowEnd = Math.min(pos + WINDOW_SIZE, candidates.length);
    const window = candidates.slice(pos, windowEnd);
    if (window.length < 2) break;

    const splitAt = await askForSplit(window, pos, askLlm);
    if (splitAt !== null && splitAt > pos) {
      splitPoints.push(splitAt);
      pos = splitAt;
    } else {
      pos++;
    }
  }
  return splitPoints;
}

async function askForSplit(
  window: TextChunk[],
  offset: number,
  askLlm: (prompt: string) => Promise<string>
): Promise<number | null> {
  const numbered = window
    .map(
      (c, i) =>
        `[${offset + i}] ${c.text.slice(0, 200)}${c.text.length > 200 ? "..." : ""}`
    )
    .join("\n\n");

  const prompt = `You are analyzing a document that has been split into numbered segments. Your job is to find where the FIRST major topic shift occurs.

Here are the segments:

${numbered}

If there is a clear topic shift between any two adjacent segments, respond with ONLY the number of the segment where the NEW topic begins. For example, if the topic shifts between [${offset + 1}] and [${offset + 2}], respond with: ${offset + 2}

If there is no clear topic shift, respond with: NONE

Respond with only a number or NONE. Nothing else.`;

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      const response = await askLlm(prompt);
      return parseSplitResponse(response, offset, offset + window.length - 1);
    } catch {
      continue;
    }
  }
  return null;
}

function parseSplitResponse(response: string, minId: number, maxId: number): number | null {
  const trimmed = response.trim().toUpperCase();
  if (trimmed === "NONE") return null;
  const num = parseInt(trimmed, 10);
  if (isNaN(num)) return null;
  const clamped = Math.max(num, minId + 1);
  if (clamped > maxId) return null;
  return clamped;
}

function mergeAtSplits(candidates: TextChunk[], splitPoints: number[]): string[] {
  if (splitPoints.length === 0) {
    return [candidates.map((c) => c.text).join(" ")];
  }
  const result: string[] = [];
  let start = 0;
  for (const split of splitPoints) {
    const group = candidates.slice(start, split);
    if (group.length > 0) result.push(group.map((c) => c.text).join(" "));
    start = split;
  }
  const remaining = candidates.slice(start);
  if (remaining.length > 0) result.push(remaining.map((c) => c.text).join(" "));
  return result.filter((t) => t.trim().length > 0);
}
