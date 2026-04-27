import OpenAI from "openai";
import { getEnv } from "./env.ts";

let cached: OpenAI | null = null;

function getClient(): OpenAI {
  if (cached) return cached;
  const env = getEnv();
  cached = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return cached;
}

/**
 * 批量计算 embedding。
 *
 * dimensions：
 *   - text-embedding-3-large 原生 3072 维 → dimensions=1536 截断（与 vector(1536) schema 对齐）
 *   - text-embedding-3-small 原生 1536 维 → 默认即可
 *   - 1536-dim 3-large 在 MTEB 上仍优于 3-small，按 token 计费成本相同
 */
const TARGET_DIM = 1536;

export async function embedBatch(
  texts: string[],
  opts: { model?: string } = {}
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const env = getEnv();
  const client = getClient();
  const model = opts.model ?? env.OPENAI_EMBEDDING_MODEL;
  const needsDimsParam = model.includes("3-large");

  const BATCH = 100;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const response = await client.embeddings.create({
      model,
      input: slice,
      encoding_format: "float",
      ...(needsDimsParam ? { dimensions: TARGET_DIM } : {}),
    });
    for (const item of response.data) {
      results.push(item.embedding);
    }
  }
  return results;
}

/** 单条 embedding（小规模用）。 */
export async function embed(text: string, opts: { model?: string } = {}): Promise<number[]> {
  const [v] = await embedBatch([text], opts);
  if (!v) throw new Error("embedding returned empty");
  return v;
}
