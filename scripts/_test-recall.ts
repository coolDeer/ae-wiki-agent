#!/usr/bin/env bun
/**
 * 向量召回测试：抽样 N 个 source，用三种方式构造 query，看原 source 是否出现在 top-K。
 *
 *   Test A: title 作为 query（基线，关键词高度匹配）
 *   Test B: 内容 snippet 作为 query（测语义召回）
 *   Test C: 关键 metric 短语（投资分析常见用法）
 *
 * 输出：recall@5 / recall@10 / 平均命中 rank。
 *
 * 用法: bun scripts/_test-recall.ts [sample_size]   (默认 30)
 */

import { sql, db, schema } from "~/core/db.ts";
import { and, eq } from "drizzle-orm";
import { hybridSearch } from "~/core/search/hybrid.ts";

const SAMPLE_SIZE = parseInt(process.argv[2] ?? "30", 10);
const TOP_K = 10;

interface RecallStat {
  total: number;
  top1: number;
  top5: number;
  top10: number;
  ranks: number[]; // 命中时的 rank（1-indexed），未命中存 -1
}

function emptyStat(): RecallStat {
  return { total: 0, top1: 0, top5: 0, top10: 0, ranks: [] };
}

function record(stat: RecallStat, rank: number) {
  stat.total += 1;
  stat.ranks.push(rank);
  if (rank === 1) stat.top1 += 1;
  if (rank > 0 && rank <= 5) stat.top5 += 1;
  if (rank > 0 && rank <= 10) stat.top10 += 1;
}

function summarize(name: string, stat: RecallStat) {
  const avgHitRank =
    stat.ranks.filter((r) => r > 0).reduce((s, r) => s + r, 0) /
      Math.max(stat.ranks.filter((r) => r > 0).length, 1);
  console.log(`\n--- ${name} (n=${stat.total}) ---`);
  console.log(
    `  recall@1:  ${stat.top1}/${stat.total} (${((stat.top1 / stat.total) * 100).toFixed(1)}%)`
  );
  console.log(
    `  recall@5:  ${stat.top5}/${stat.total} (${((stat.top5 / stat.total) * 100).toFixed(1)}%)`
  );
  console.log(
    `  recall@10: ${stat.top10}/${stat.total} (${((stat.top10 / stat.total) * 100).toFixed(1)}%)`
  );
  console.log(`  avg hit rank: ${avgHitRank.toFixed(2)}`);
  const misses = stat.ranks.filter((r) => r < 0).length;
  if (misses > 0) console.log(`  miss (>top10): ${misses}`);
}

async function findRank(
  query: string,
  expectedSlug: string
): Promise<number> {
  try {
    const hits = await hybridSearch(query, { limit: TOP_K });
    const idx = hits.findIndex((h) => h.slug === expectedSlug);
    return idx >= 0 ? idx + 1 : -1;
  } catch (e) {
    console.error(`  query failed: "${query.slice(0, 50)}..." → ${(e as Error).message}`);
    return -1;
  }
}

async function main() {
  console.log(`抽样 ${SAMPLE_SIZE} 个 source，每个跑 3 类 query 测召回`);
  console.log(`top-K = ${TOP_K}\n`);

  // 抽样：今天的 source（确保有完整 chunks + embedding）
  const samples = await sql<{
    id: bigint;
    slug: string;
    title: string;
    content: string;
  }[]>`
    SELECT p.id, p.slug, p.title, p.content
    FROM pages p
    WHERE p.deleted = 0
      AND p.type = 'source'
      AND p.content IS NOT NULL
      AND LENGTH(p.content) > 1000
      AND EXISTS (
        SELECT 1 FROM content_chunks c
        WHERE c.page_id = p.id
          AND c.deleted = 0
          AND c.embedding IS NOT NULL
      )
    ORDER BY RANDOM()
    LIMIT ${SAMPLE_SIZE}
  `;

  console.log(`实际样本: ${samples.length}\n`);

  const statTitle = emptyStat();
  const statSnippet = emptyStat();
  const statTopic = emptyStat();

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;

    // Test A: 用 title 当 query
    const qTitle = (s.title ?? "").slice(0, 100).trim();
    const rankA = qTitle ? await findRank(qTitle, s.slug) : -1;
    record(statTitle, rankA);

    // Test B: 取 page.content 中段一个 snippet（绕开标题原文）
    // 跳过前 1500 字符（一般是 frontmatter + Source Overview），取中段 100 字符
    const content = s.content ?? "";
    const start = Math.min(1500, Math.floor(content.length * 0.3));
    const snippetRaw = content.slice(start, start + 200);
    // 去 markdown 标记
    const qSnippet = snippetRaw
      .replace(/[#*`>\[\]]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 100)
      .trim();
    const rankB = qSnippet.length > 30 ? await findRank(qSnippet, s.slug) : -1;
    record(statSnippet, rankB);

    // Test C: 从 facts 里挑一个 metric 拼自然问题（如果有）
    const facts = await sql<{ metric: string; entity_slug: string }[]>`
      SELECT f.metric, p.slug AS entity_slug
      FROM facts f
      JOIN pages p ON p.id = f.entity_page_id
      WHERE f.source_page_id = ${s.id}
        AND f.deleted = 0
      LIMIT 1
    `;
    let rankC = -2; // -2 = 跳过（无 fact）
    if (facts.length > 0) {
      const f = facts[0]!;
      const entityName = f.entity_slug.split("/").pop() ?? "";
      const qTopic = `${entityName} ${f.metric}`.replace(/[-_]/g, " ");
      rankC = await findRank(qTopic, s.slug);
      record(statTopic, rankC);
    }

    if ((i + 1) % 5 === 0 || i === samples.length - 1) {
      console.log(
        `  ${i + 1}/${samples.length}: ${s.slug.slice(-35).padEnd(35)} A=${rankA === -1 ? "miss" : `#${rankA}`} B=${rankB === -1 ? "miss" : `#${rankB}`} C=${rankC === -2 ? "n/a" : rankC === -1 ? "miss" : `#${rankC}`}`
      );
    }
  }

  console.log("\n========== 汇总 ==========");
  summarize("Test A: title-as-query (基线)", statTitle);
  summarize("Test B: 内容 snippet (语义召回)", statSnippet);
  summarize("Test C: entity + metric (实战)", statTopic);

  // 看 worst 5 个 case
  console.log("\n--- Test B miss 样本（看哪些语义召回失败）---");
  const missCases = samples
    .map((s, idx) => ({ s, rank: statSnippet.ranks[idx] ?? -1 }))
    .filter((x) => x.rank < 0 || x.rank > 5)
    .slice(0, 5);
  for (const m of missCases) {
    console.log(`  rank=${m.rank === -1 ? "miss" : `#${m.rank}`}  ${m.s.slug}`);
    console.log(`    title: ${m.s.title?.slice(0, 80)}`);
  }

  await sql.end();
}

await main();
