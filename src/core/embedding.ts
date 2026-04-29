/**
 * Embedding 客户端 — 5 次指数退避 + Retry-After 头部。
 * 借鉴 gbrain v0.20+ 的 production 重试策略。
 *
 * - text-embedding-3-large 原生 3072 维 → dimensions=1536 截断（与 vector(1536) schema 对齐）
 * - text-embedding-3-small 原生 1536 维 → 默认即可
 * - 输入超 8000 字符自动截断
 * - 429 时优先用 Retry-After 头部秒数；否则指数退避（4s → 120s 封顶）
 */

import OpenAI from "openai";
import { getEnv } from "./env.ts";
import { recordUsage } from "./llm-usage.ts";

const TARGET_DIM = 1536;
const MAX_CHARS = 8000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 4000;
const MAX_DELAY_MS = 120000;
const BATCH_SIZE = 100;

let cached: OpenAI | null = null;

function getClient(): OpenAI {
  if (cached) return cached;
  const env = getEnv();
  cached = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return cached;
}

export interface EmbedBatchOptions {
  model?: string;
  /** 每完成一个 100-条子 batch 触发一次（worker 报 progress 用）。 */
  onBatchComplete?: (done: number, total: number) => void;
}

export async function embedBatch(
  texts: string[],
  options: EmbedBatchOptions = {}
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const env = getEnv();
  const model = options.model ?? env.OPENAI_EMBEDDING_MODEL;
  const needsDimsParam = model.includes("3-large");

  const truncated = texts.map((t) => t.slice(0, MAX_CHARS));
  const results: number[][] = [];

  for (let i = 0; i < truncated.length; i += BATCH_SIZE) {
    const slice = truncated.slice(i, i + BATCH_SIZE);
    const batch = await embedBatchWithRetry(slice, model, needsDimsParam);
    results.push(...batch);
    options.onBatchComplete?.(results.length, truncated.length);
  }

  return results;
}

async function embedBatchWithRetry(
  texts: string[],
  model: string,
  withDims: boolean
): Promise<number[][]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await getClient().embeddings.create({
        model,
        input: texts,
        encoding_format: "float",
        ...(withDims ? { dimensions: TARGET_DIM } : {}),
      });
      // index 顺序对齐 — OpenAI 偶尔返回乱序
      const sorted = response.data.slice().sort((a, b) => a.index - b.index);
      // fire-and-forget 记 usage
      const tin = response.usage?.prompt_tokens ?? null;
      const total = response.usage?.total_tokens ?? null;
      void recordUsage({
        source: "embedding",
        model,
        tokensIn: tin,
        tokensOut: 0,
        totalTokens: total,
        requestCount: 1,
        metadata: { batch_size: texts.length },
      });
      return sorted.map((d) => d.embedding);
    } catch (e: unknown) {
      if (attempt === MAX_RETRIES - 1) throw e;
      let delay = exponentialDelay(attempt);

      if (e instanceof OpenAI.APIError && e.status === 429) {
        const retryAfter = e.headers?.["retry-after"];
        if (retryAfter) {
          const parsed = parseInt(String(retryAfter), 10);
          if (!isNaN(parsed) && parsed > 0) {
            delay = parsed * 1000;
          }
        }
      }

      await sleep(delay);
    }
  }
  throw new Error("embedding failed after all retries");
}

function exponentialDelay(attempt: number): number {
  const delay = BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 单条 embedding（小规模用）。 */
export async function embed(
  text: string,
  options: { model?: string } = {}
): Promise<number[]> {
  const truncated = text.slice(0, MAX_CHARS);
  const [v] = await embedBatch([truncated], options);
  if (!v) throw new Error("embedding returned empty");
  return v;
}

export { TARGET_DIM as EMBEDDING_DIMENSIONS };
