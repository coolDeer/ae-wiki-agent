import { z } from "zod";

/**
 * 环境变量 schema 校验。任何 process.env 的访问都从这里走，
 * 启动时一次性 validate，缺字段直接抛错。
 */
const EnvSchema = z.object({
  // Postgres
  DATABASE_URL: z.string().url(),

  // MongoDB（上游 ResearchReportRecord）
  MONGODB_URI: z.string(),
  MONGODB_DB: z.string(),
  MONGODB_COLLECTION: z.string().default("ResearchReportRecord"),

  // OpenAI（embedding + durable agent runtime + 未来 fact 抽取）
  OPENAI_API_KEY: z.string(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-large"),
  OPENAI_AGENT_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_FACT_EXTRACT_MODEL: z.string().default("gpt-5-mini"),
  // 关掉 Stage 5 Tier C LLM 兜底（默认开启）
  STAGE5_TIER_C_DISABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // 关掉所有 embedding 调用：search 走纯 keyword，worker 跳过 embed_chunks
  EMBEDDING_DISABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // 本地路径：workspace 根目录（用于 wiki/output/ 等派生产物）
  // raw_files 已不再落本地文件，markdown 通过 raw_files.markdown_url 按需 HTTP 拉
  WORKSPACE_DIR: z.string().default("."),

  // 搜索排序：source-aware ranking（见 core/search/source-boost.ts）
  // 格式 "prefix1:1.5,prefix2:0.7"，会与 DEFAULT_SOURCE_BOOST 合并（env 覆盖默认）
  WIKI_SOURCE_BOOST: z.string().optional(),
  // 硬排除：搜索时直接不进入候选池。格式 "prefix1,prefix2"
  WIKI_SEARCH_EXCLUDE: z.string().optional(),
  // 分段策略：recursive (default) / semantic（句子 embedding + Sav-Gol）/ llm（OpenAI 找拐点）
  WIKI_CHUNKER_STRATEGY: z.enum(["recursive", "semantic", "llm"]).default("recursive"),
  // 多 query 扩展：开启后对 ≥3 词的 query 用 OPENAI_AGENT_MODEL 改写出 2 个备选并召回融合
  WIKI_QUERY_EXPANSION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // search debug：打印 RRF / cosine / boost 中间值到 stderr
  WIKI_SEARCH_DEBUG: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // 可选
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default("ap-southeast-1"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("✗ Environment validation failed:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
