/**
 * 分段策略统一入口。
 *
 * env `WIKI_CHUNKER_STRATEGY`：
 *   - `recursive` (default) - 纯字符 / 段落分隔，确定性，无外部依赖
 *   - `semantic`            - 句子级 embedding + Savitzky-Golay 找拐点（用 OPENAI_API_KEY）
 *   - `llm`                 - 滑窗 + OpenAI 判断主题切换（用 OPENAI_AGENT_MODEL）
 *
 * 任何外部调用失败均回退 recursive。
 */

import { chunkText as recursiveChunk, type TextChunk } from "./recursive.ts";
import { chunkTextSemantic } from "./semantic.ts";
import { chunkTextLlm } from "./llm.ts";
import { embedBatch } from "../embedding.ts";
import { getEnv } from "../env.ts";

export type ChunkerStrategy = "recursive" | "semantic" | "llm";

export interface ChunkPipelineOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  /** 强制策略（不读 env） */
  strategy?: ChunkerStrategy;
}

export async function chunkPipeline(
  text: string,
  opts: ChunkPipelineOptions = {}
): Promise<TextChunk[]> {
  const env = getEnv();
  const strategy = opts.strategy ?? env.WIKI_CHUNKER_STRATEGY;

  switch (strategy) {
    case "semantic":
      if (env.EMBEDDING_DISABLED) {
        return recursiveChunk(text, opts);
      }
      return chunkTextSemantic(text, {
        chunkSize: opts.chunkSize,
        chunkOverlap: opts.chunkOverlap,
        embedFn: (texts) => embedBatch(texts),
      });
    case "llm":
      return chunkTextLlm(text, {
        chunkSize: opts.chunkSize,
        chunkOverlap: opts.chunkOverlap,
        askLlm: makeOpenAIAskLlm(env.OPENAI_API_KEY, env.OPENAI_AGENT_MODEL),
      });
    case "recursive":
    default:
      return recursiveChunk(text, opts);
  }
}

function makeOpenAIAskLlm(
  apiKey: string,
  model: string
): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    // 动态 import：仅在 llm 策略激活时才加载 SDK。
    const { default: OpenAI } = await import("openai");
    const { recordUsage } = await import("../llm-usage.ts");
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: prompt }],
    });
    void recordUsage({
      source: "chunker_llm",
      model,
      tokensIn: resp.usage?.prompt_tokens ?? null,
      tokensOut: resp.usage?.completion_tokens ?? null,
      totalTokens: resp.usage?.total_tokens ?? null,
    });
    return resp.choices[0]?.message?.content?.trim() ?? "";
  };
}

export { recursiveChunk as chunkText };
export type { TextChunk } from "./recursive.ts";
