/**
 * core/minions/worker
 *
 * 运行时语义保持不变，只是把 worker 逻辑从顶层 `src/workers/`
 * 收到更接近 gbrain 的 `src/core/minions/` 目录下，方便后续继续对齐
 * queue / supervisor / handlers 的结构。
 */

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { JobCancelledError, JobPausedError, runAgentJob } from "~/agents/runtime.ts";
import { Actor, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";
import { embedBatch } from "~/core/embedding.ts";
import { getEnv } from "~/core/env.ts";
import { addJob, completeJob, failJob } from "~/core/minions/queue.ts";
import { enrichLoadContext } from "~/skills/enrich/index.ts";

const POLL_INTERVAL_MS = 2000;

async function pickOne(): Promise<typeof schema.minionJobs.$inferSelect | null> {
  const skipEmbed = getEnv().EMBEDDING_DISABLED;
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

async function runJob(job: typeof schema.minionJobs.$inferSelect): Promise<unknown> {
  console.log(`[worker] picked job ${job.id} (${job.name})`);
  switch (job.name) {
    case "embed_chunks":
      await runEmbedChunks(job);
      return null;
    case "detect_signals":
      await runDetectSignals(job);
      return null;
    case "enrich_entity":
      return await runEnrichEntity(job);
    case "agent_run":
      return await runAgentJob(job);
    case "lint_run":
      return await runLintJob(job);
    case "facts_expire":
      return await runFactsExpireJob(job);
    default:
      throw new Error(`unknown job name: ${job.name}`);
  }
}

async function runLintJob(
  job: typeof schema.minionJobs.$inferSelect
): Promise<Record<string, unknown>> {
  const data = (job.data ?? {}) as {
    staleDays?: number;
    rawAgeDays?: number;
    factAgeDays?: number;
    sampleSize?: number;
  };
  const { runLint } = await import("~/skills/lint/index.ts");
  const report = await runLint(data);
  console.log(
    `  [lint_run] checks=${report.checks.length} totalIssues=${report.totalIssues}`
  );
  return report as unknown as Record<string, unknown>;
}

async function runFactsExpireJob(
  job: typeof schema.minionJobs.$inferSelect
): Promise<Record<string, unknown>> {
  const data = (job.data ?? {}) as { ageDays?: number };
  const { expireFacts } = await import("~/skills/facts/expire.ts");
  const result = await expireFacts({ ageDays: data.ageDays });
  console.log(
    `  [facts_expire] ageDays=${result.ageDays} expired=${result.expiredCount}`
  );
  return result as unknown as Record<string, unknown>;
}

async function runEmbedChunks(
  job: typeof schema.minionJobs.$inferSelect
): Promise<void> {
  const data = job.data as { pageId?: string };
  const pageId = data.pageId ? BigInt(data.pageId) : null;
  if (!pageId) throw new Error("embed_chunks: data.pageId 缺失");

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

  for (let i = 0; i < pending.length; i++) {
    const chunk = pending[i];
    const embedding = embeddings[i];
    if (!chunk || !embedding) continue;
    await db
      .update(schema.contentChunks)
      .set({
        embedding,
        embeddedAt: new Date(),
        updateBy: "system:worker",
        updateTime: new Date(),
      })
      .where(eq(schema.contentChunks.id, chunk.id));
  }
  console.log(`  [embed_chunks] ✓ ${pending.length} embeddings written`);
}

async function runDetectSignals(
  job: typeof schema.minionJobs.$inferSelect
): Promise<void> {
  const data = job.data as { pageId?: string };
  const pageId = data.pageId ? BigInt(data.pageId) : null;
  if (!pageId) throw new Error("detect_signals: data.pageId 缺失");

  const newFacts = await db
    .select()
    .from(schema.facts)
    .where(and(eq(schema.facts.sourcePageId, pageId), eq(schema.facts.deleted, 0)));

  if (newFacts.length === 0) {
    console.log(`  [detect_signals] page #${pageId}: 无 facts, skip`);
    return;
  }

  let signalsWritten = 0;
  for (const fact of newFacts) {
    if (fact.valueNumeric === null) continue;

    const priors = await db
      .select({
        valueNumeric: schema.facts.valueNumeric,
        sourcePageId: schema.facts.sourcePageId,
      })
      .from(schema.facts)
      .where(
        and(
          eq(schema.facts.entityPageId, fact.entityPageId),
          eq(schema.facts.metric, fact.metric),
          sql`${schema.facts.period} IS NOT DISTINCT FROM ${fact.period}`,
          ne(schema.facts.sourcePageId, pageId),
          eq(schema.facts.deleted, 0)
        )
      )
      .orderBy(desc(schema.facts.validFrom))
      .limit(10);

    if (priors.length === 0) continue;

    const newVal = parseFloat(fact.valueNumeric);
    if (!Number.isFinite(newVal)) continue;

    const priorVals = priors
      .map((prior) => (prior.valueNumeric ? parseFloat(prior.valueNumeric) : NaN))
      .filter((value) => Number.isFinite(value));
    if (priorVals.length === 0) continue;

    const priorAvg = priorVals.reduce((a, b) => a + b, 0) / priorVals.length;
    if (priorAvg === 0) continue;

    const delta = (newVal - priorAvg) / Math.abs(priorAvg);
    const absDelta = Math.abs(delta);
    if (absDelta < 0.1) continue;

    const severity = absDelta >= 0.2 ? "warning" : "info";
    const signalType = priorVals.length >= 2 ? "consensus_drift" : "fact_outlier";

    await db.insert(schema.signals).values(
      withCreateAudit(
        {
          signalType,
          entityPageId: fact.entityPageId,
          sourcePageId: pageId,
          severity,
          title: `${fact.metric}${fact.period ? ` ${fact.period}` : ""} 偏离共识 ${(delta * 100).toFixed(1)}%`,
          detail: `新值 ${newVal} vs 前 ${priorVals.length} 条 source 均值 ${priorAvg.toFixed(4)}`,
          data: {
            metric: fact.metric,
            period: fact.period,
            unit: fact.unit,
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

async function runEnrichEntity(
  job: typeof schema.minionJobs.$inferSelect
): Promise<Record<string, unknown>> {
  const data = (job.data ?? {}) as {
    pageId?: string;
    slug?: string;
    sourcePageId?: string;
  };
  const pageId = data.pageId ? BigInt(data.pageId) : null;
  if (!pageId) throw new Error("enrich_entity: data.pageId 缺失");

  const ctx = await enrichLoadContext(pageId);
  if (!ctx) {
    console.log(`  [enrich_entity] page #${pageId}: already enriched or unavailable, skip`);
    return {
      pageId: pageId.toString(),
      status: "noop",
      reason: "page is missing, non-low confidence, or unsupported type",
    };
  }

  const prompt = [
    `Execute this skill once for page #${ctx.pageId.toString()} (${ctx.slug}).`,
    `Start with enrich_get(page_id=${ctx.pageId.toString()}) and enrich only this target.`,
    "Do not move to another candidate unless enrich_get returns null for this page.",
    `Target title: ${ctx.title}`,
    `Target type: ${ctx.type}`,
    ctx.backlinks.length > 0
      ? `Known backlinks: ${ctx.backlinks
          .map((backlink) => `${backlink.sourceSlug} (${backlink.sourceDate ?? "unknown date"})`)
          .join(", ")}`
      : "Known backlinks: none.",
  ].join("\n");

  const agentJob = await addJob(
    "agent_run",
    {
      skill: "ae-enrich",
      prompt,
      model: getEnv().OPENAI_AGENT_MODEL,
      maxTurns: 20,
    },
    Actor.agentRuntime,
    {
      progress: {
        stage: "queued",
        skill: "ae-enrich",
        source_job_id: job.id.toString(),
        target_page_id: ctx.pageId.toString(),
        message: `Queued ae-enrich for ${ctx.slug}`,
      },
    }
  );

  console.log(
    `  [enrich_entity] page #${pageId}: queued agent_run #${agentJob.id} for ${ctx.slug}`
  );
  return {
    pageId: pageId.toString(),
    slug: ctx.slug,
    status: "queued",
    agentJobId: agentJob.id.toString(),
  };
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
        const result = await runJob(job);
        if (result && typeof result === "object") {
          const state = result as Record<string, unknown>;
          if (state.paused === true || state.cancelled === true) {
            continue;
          }
        }
        await completeJob(job.id, Actor.systemJobs, result);
      } catch (e) {
        if (e instanceof JobPausedError || e instanceof JobCancelledError) {
          continue;
        }
        const err = (e as Error).message;
        const failNow = job.attempts + 1 >= job.maxAttempts;
        await failJob(job.id, Actor.systemJobs, err, !failNow);
        console.error(`[worker] job ${job.id} ${failNow ? "FAILED" : "RETRY"}: ${err}`);
      }
    } catch (e) {
      console.error(`[worker] loop error:`, e);
      await Bun.sleep(POLL_INTERVAL_MS);
    }
  }
}
