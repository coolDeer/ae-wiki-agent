/**
 * minion-worker
 *
 * Postgres-native 异步任务 runner。轮询 minion_jobs 表 status='waiting' 的任务，
 * 用 SELECT ... FOR UPDATE SKIP LOCKED 抢占锁，然后按 job.name 分发执行。
 *
 * 任务类型（与 ingest stage 6 入队的对应）：
 *   - embed_chunks: 给 content_chunks 填 embedding
 *   - enrich_entity: 给红链 entity 补全元数据
 *   - detect_signals: 跨 source 比对发现 signals
 *
 * TODO Phase 1：完整实现
 */

import { db, schema } from "~/core/db.ts";
import { eq, sql, isNull, and, ne, desc } from "drizzle-orm";
import { embedBatch } from "~/core/embedding.ts";
import { withCreateAudit, Actor } from "~/core/audit.ts";
import { getEnv } from "~/core/env.ts";

const POLL_INTERVAL_MS = 2000;

async function pickOne(): Promise<typeof schema.minionJobs.$inferSelect | null> {
  // EMBEDDING_DISABLED 时跳过 embed_chunks，让它留在 waiting，等开关打开后回填
  const skipEmbed = getEnv().EMBEDDING_DISABLED;
  // 用 raw SQL 因为 Drizzle 还不直接支持 FOR UPDATE SKIP LOCKED 的链式 API
  const rows = await db.execute(sql`
    UPDATE minion_jobs
    SET status = 'active',
        started_at = NOW(),
        attempts = attempts + 1,
        update_time = NOW()
    WHERE id = (
      SELECT id FROM minion_jobs
      WHERE status = 'waiting' AND deleted = 0
        ${skipEmbed ? sql`AND name != 'embed_chunks'` : sql``}
      ORDER BY create_time
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  return (rows[0] as typeof schema.minionJobs.$inferSelect | undefined) ?? null;
}

async function runJob(job: typeof schema.minionJobs.$inferSelect): Promise<void> {
  console.log(`[worker] picked job ${job.id} (${job.name})`);
  switch (job.name) {
    case "embed_chunks":
      await runEmbedChunks(job);
      break;
    case "detect_signals":
      await runDetectSignals(job);
      break;
    case "enrich_entity":
      // TODO Phase 1.x：调外部 API 补全 entity 元数据
      console.log(`  [enrich_entity] (skipped — Phase 1.x 实现)`);
      break;
    default:
      throw new Error(`unknown job name: ${job.name}`);
  }
}

/**
 * embed_chunks: 给指定 page 的所有 content_chunks 填 embedding。
 * 已经有 embedding 的跳过（增量友好）。
 */
async function runEmbedChunks(
  job: typeof schema.minionJobs.$inferSelect
): Promise<void> {
  const data = job.data as { pageId?: string };
  const pageId = data.pageId ? BigInt(data.pageId) : null;
  if (!pageId) throw new Error("embed_chunks: data.pageId 缺失");

  // 取该 page 下还没 embedding 的 chunks
  const pending = await db
    .select({
      id: schema.contentChunks.id,
      text: schema.contentChunks.chunkText,
    })
    .from(schema.contentChunks)
    .where(
      and(
        eq(schema.contentChunks.pageId, pageId),
        isNull(schema.contentChunks.embedding),
        eq(schema.contentChunks.deleted, 0)
      )
    );

  if (pending.length === 0) {
    console.log(`  [embed_chunks] page #${pageId} 没有待 embed 的 chunk`);
    return;
  }

  console.log(`  [embed_chunks] page #${pageId}: ${pending.length} chunks → OpenAI`);
  const texts = pending.map((c) => c.text);
  const embeddings = await embedBatch(texts);

  // 写回（postgres.js custom vector 类型自动处理 number[] → '[...]'）
  for (let i = 0; i < pending.length; i++) {
    const c = pending[i];
    const emb = embeddings[i];
    if (!c || !emb) continue;
    await db
      .update(schema.contentChunks)
      .set({
        embedding: emb,
        embeddedAt: new Date(),
        updateBy: "system:worker",
        updateTime: new Date(),
      })
      .where(eq(schema.contentChunks.id, c.id));
  }
  console.log(`  [embed_chunks] ✓ ${pending.length} embeddings written`);
}

/**
 * detect_signals: 拿一个 page 新插入的 facts，与历史 facts（来自其他 source）比对，
 * 偏离均值超阈值就写 signals。
 *
 * 阈值（v1）：
 *   - |delta| < 10%        → 不写
 *   - 10% ≤ |delta| < 20%  → severity='info'
 *   - |delta| ≥ 20%        → severity='warning'
 * signal_type：
 *   - 历史只有 1 条          → 'fact_outlier'
 *   - 历史 ≥ 2 条            → 'consensus_drift'
 */
async function runDetectSignals(
  job: typeof schema.minionJobs.$inferSelect
): Promise<void> {
  const data = job.data as { pageId?: string };
  const pageId = data.pageId ? BigInt(data.pageId) : null;
  if (!pageId) throw new Error("detect_signals: data.pageId 缺失");

  const newFacts = await db
    .select()
    .from(schema.facts)
    .where(
      and(eq(schema.facts.sourcePageId, pageId), eq(schema.facts.deleted, 0))
    );

  if (newFacts.length === 0) {
    console.log(`  [detect_signals] page #${pageId}: 无 facts, skip`);
    return;
  }

  let signalsWritten = 0;
  for (const f of newFacts) {
    if (f.valueNumeric === null) continue;

    const priors = await db
      .select({
        valueNumeric: schema.facts.valueNumeric,
        sourcePageId: schema.facts.sourcePageId,
      })
      .from(schema.facts)
      .where(
        and(
          eq(schema.facts.entityPageId, f.entityPageId),
          eq(schema.facts.metric, f.metric),
          sql`${schema.facts.period} IS NOT DISTINCT FROM ${f.period}`,
          ne(schema.facts.sourcePageId, pageId),
          eq(schema.facts.deleted, 0)
        )
      )
      .orderBy(desc(schema.facts.validFrom))
      .limit(10);

    if (priors.length === 0) continue;

    const newVal = parseFloat(f.valueNumeric);
    if (!Number.isFinite(newVal)) continue;

    const priorVals = priors
      .map((p) => (p.valueNumeric ? parseFloat(p.valueNumeric) : NaN))
      .filter((v) => Number.isFinite(v));
    if (priorVals.length === 0) continue;

    const priorAvg =
      priorVals.reduce((a, b) => a + b, 0) / priorVals.length;
    if (priorAvg === 0) continue;

    const delta = (newVal - priorAvg) / Math.abs(priorAvg);
    const absDelta = Math.abs(delta);

    if (absDelta < 0.10) continue;

    const severity = absDelta >= 0.20 ? "warning" : "info";
    const signalType = priorVals.length >= 2 ? "consensus_drift" : "fact_outlier";

    await db.insert(schema.signals).values(
      withCreateAudit(
        {
          signalType,
          entityPageId: f.entityPageId,
          sourcePageId: pageId,
          severity,
          title: `${f.metric}${f.period ? ` ${f.period}` : ""} 偏离共识 ${(delta * 100).toFixed(1)}%`,
          detail: `新值 ${newVal} vs 前 ${priorVals.length} 条 source 均值 ${priorAvg.toFixed(4)}`,
          data: {
            metric: f.metric,
            period: f.period,
            unit: f.unit,
            new_value: newVal,
            prior_avg: priorAvg,
            prior_count: priorVals.length,
            delta_pct: delta,
          },
        },
        Actor.agentSignalDetector
      )
    );
    signalsWritten++;
  }

  console.log(
    `  [detect_signals] page #${pageId}: facts=${newFacts.length}, signals=${signalsWritten}`
  );
}

export async function runWorker(): Promise<void> {
  console.log(`[worker] minion-worker 启动 (interval=${POLL_INTERVAL_MS}ms)`);
  while (true) {
    try {
      const job = await pickOne();
      if (!job) {
        await Bun.sleep(POLL_INTERVAL_MS);
        continue;
      }
      try {
        await runJob(job);
        await db.execute(sql`
          UPDATE minion_jobs SET status='completed', finished_at=NOW(), update_time=NOW()
          WHERE id = ${job.id}
        `);
      } catch (e) {
        const err = (e as Error).message;
        const failNow = job.attempts + 1 >= job.maxAttempts;
        await db.execute(sql`
          UPDATE minion_jobs
          SET status = ${failNow ? "failed" : "waiting"},
              error = ${err},
              update_time = NOW()
          WHERE id = ${job.id}
        `);
        console.error(`[worker] job ${job.id} ${failNow ? "FAILED" : "RETRY"}: ${err}`);
      }
    } catch (e) {
      console.error(`[worker] loop error:`, e);
      await Bun.sleep(POLL_INTERVAL_MS);
    }
  }
}

if (import.meta.main) {
  await runWorker();
}
