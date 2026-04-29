/**
 * Retrieval Evaluation Harness — 借鉴 gbrain eval.ts。
 *
 * Pure metric: Precision@k / Recall@k / MRR / nDCG@k。
 * runEval orchestrator 跑 hybrid search 比对 qrels（ground-truth slug 列表），
 * 返回 EvalReport。CLI 上层可包装出 ae-wiki search:eval 命令。
 */

import { hybridSearch } from "./hybrid.ts";
import type { SearchOpts } from "./types.ts";
import { embed } from "~/core/embedding.ts";
import { searchKeyword } from "./keyword.ts";
import { searchVector } from "./vector.ts";

export interface EvalQrel {
  id?: string;
  query: string;
  /** ground-truth：相关 page slug */
  relevant: string[];
  /** 可选 graded relevance（nDCG 用，1-3 通常） */
  grades?: Record<string, number>;
}

export interface EvalQrelFile {
  version: 1;
  queries: EvalQrel[];
}

export interface EvalConfig {
  name?: string;
  strategy?: "keyword" | "vector" | "hybrid";
  rrfK?: number;
  expansion?: boolean;
  dedupCosineThreshold?: number;
  dedupTypeRatio?: number;
  dedupMaxPerPage?: number;
  limit?: number;
}

export interface QueryResult {
  query: string;
  hits: string[];
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
}

export interface EvalReport {
  config: EvalConfig;
  k: number;
  queries: QueryResult[];
  meanPrecision: number;
  meanRecall: number;
  meanMrr: number;
  meanNdcg: number;
}

export function precisionAtK(hits: string[], relevant: Set<string>, k: number): number {
  if (k <= 0 || hits.length === 0 || relevant.size === 0) return 0;
  const top = hits.slice(0, k);
  const r = top.filter((h) => relevant.has(h)).length;
  return r / k;
}

export function recallAtK(hits: string[], relevant: Set<string>, k: number): number {
  if (k <= 0 || hits.length === 0 || relevant.size === 0) return 0;
  const top = hits.slice(0, k);
  const r = top.filter((h) => relevant.has(h)).length;
  return r / relevant.size;
}

export function mrr(hits: string[], relevant: Set<string>): number {
  if (hits.length === 0 || relevant.size === 0) return 0;
  for (let i = 0; i < hits.length; i++) {
    if (relevant.has(hits[i]!)) return 1 / (i + 1);
  }
  return 0;
}

export function ndcgAtK(hits: string[], grades: Map<string, number>, k: number): number {
  if (k <= 0 || hits.length === 0 || grades.size === 0) return 0;
  const top = hits.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < top.length; i++) {
    const g = grades.get(top[i]!) ?? 0;
    dcg += g / Math.log2(i + 2);
  }
  const ideal = Array.from(grades.values())
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k);
  let idcg = 0;
  for (let i = 0; i < ideal.length; i++) idcg += ideal[i]! / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

export interface RunEvalOptions {
  onProgress?: (done: number, total: number, query: string) => void;
}

export async function runEval(
  qrels: EvalQrel[],
  config: EvalConfig,
  k = 5,
  options: RunEvalOptions = {}
): Promise<EvalReport> {
  const strategy = config.strategy ?? "hybrid";
  const limit = config.limit ?? Math.max(k * 2, 10);
  const queries: QueryResult[] = [];

  let done = 0;
  for (const qrel of qrels) {
    const hits = await runQuery(qrel.query, strategy, config, limit);
    const relevantSet = new Set(qrel.relevant);
    const grades = buildGradesMap(qrel);
    queries.push({
      query: qrel.query,
      hits,
      precisionAtK: precisionAtK(hits, relevantSet, k),
      recallAtK: recallAtK(hits, relevantSet, k),
      mrr: mrr(hits, relevantSet),
      ndcgAtK: ndcgAtK(hits, grades, k),
    });
    done++;
    options.onProgress?.(done, qrels.length, qrel.query);
  }

  return {
    config,
    k,
    queries,
    meanPrecision: mean(queries.map((q) => q.precisionAtK)),
    meanRecall: mean(queries.map((q) => q.recallAtK)),
    meanMrr: mean(queries.map((q) => q.mrr)),
    meanNdcg: mean(queries.map((q) => q.ndcgAtK)),
  };
}

async function runQuery(
  query: string,
  strategy: "keyword" | "vector" | "hybrid",
  config: EvalConfig,
  limit: number
): Promise<string[]> {
  if (strategy === "keyword") {
    const r = await searchKeyword(query, { limit, poolSize: limit });
    return r.map((c) => c.slug);
  }
  if (strategy === "vector") {
    const emb = await embed(query);
    const r = await searchVector(emb, { limit, poolSize: limit });
    return r.map((c) => c.slug);
  }
  const opts: SearchOpts = {
    limit,
    expansion: config.expansion,
    rrfK: config.rrfK,
    dedupOpts: {
      cosineThreshold: config.dedupCosineThreshold,
      maxTypeRatio: config.dedupTypeRatio,
      maxPerPage: config.dedupMaxPerPage,
    },
  };
  const r = await hybridSearch(query, opts);
  return r.map((h) => h.slug);
}

function buildGradesMap(qrel: EvalQrel): Map<string, number> {
  if (qrel.grades && Object.keys(qrel.grades).length > 0) {
    return new Map(Object.entries(qrel.grades));
  }
  return new Map(qrel.relevant.map((s) => [s, 1]));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function parseQrels(input: string): EvalQrel[] {
  let raw: string;
  if (input.trimStart().startsWith("[") || input.trimStart().startsWith("{")) {
    raw = input;
  } else {
    const fs = require("fs") as typeof import("fs");
    raw = fs.readFileSync(input, "utf-8");
  }
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as EvalQrel[];
  if (parsed.queries && Array.isArray(parsed.queries)) {
    return parsed.queries as EvalQrel[];
  }
  throw new Error("Invalid qrels format. Expected array or { version, queries } object.");
}
