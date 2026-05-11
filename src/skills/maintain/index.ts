/**
 * wiki:maintain
 *
 * gbrain-style maintenance loop for ae-wiki:
 *   diagnose -> apply deterministic low-risk upkeep -> enqueue higher-touch agent work.
 *
 * Default mode is audit/report only. Page/fact writes and agent queueing require explicit flags.
 */

import { and, eq, sql } from "drizzle-orm";

import { Actor, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";
import { getEnv } from "~/core/env.ts";
import { addJob } from "~/core/minions/queue.ts";

import { getEnrichBacklog } from "../enrich/backlog.ts";
import { getEntityUpdateCandidates, refreshEntityPage } from "../entity-refresh/index.ts";
import { getFactsCoverageBacklog } from "../facts/coverage.ts";
import { expireFacts } from "../facts/expire.ts";
import { runLint } from "../lint/index.ts";
import { reviewOutputBacklog } from "../output-review/index.ts";
import { listReviewBacklog } from "../review/index.ts";
import { getThesisBacklog } from "../thesis/backlog.ts";

export interface WikiMaintainOptions {
  limit?: number;
  applySafe?: boolean;
  dryRun?: boolean;
  entityRefreshLimit?: number;
  enqueueEnrich?: boolean;
  enrichLimit?: number;
  enqueueThesisReview?: boolean;
  thesisLimit?: number;
  factAgeDays?: number;
}

export interface MaintainQueuedJob {
  kind: "enrich_entity" | "thesis_review";
  pageId: string;
  slug: string;
  action: string;
  queued: boolean;
  jobId: string | null;
  reason: string;
}

export interface MaintainEntityRefresh {
  pageId: string;
  slug: string;
  action: "auto_refresh" | "candidate_only" | "skipped" | "failed";
  applied: boolean;
  reason: string;
  appendedChars?: number;
  reviewStatus?: string;
}

export interface WikiMaintainReport {
  generatedAt: string;
  mode: {
    applySafe: boolean;
    dryRun: boolean;
    enqueueEnrich: boolean;
    enqueueThesisReview: boolean;
  };
  summary: {
    totalLintIssues: number;
    staleEntityCandidates: number;
    safeEntityRefreshCandidates: number;
    factsCoverageHighRisk: number;
    factsCoverageMediumRisk: number;
    enrichNow: number;
    enrichRetrigger: number;
    thesisReviewNow: number;
    pageReviewFailures: number;
    outputFailures: number;
    expiredFacts: number;
    entityRefreshApplied: number;
    enrichJobsQueued: number;
    thesisJobsQueued: number;
  };
  reports: {
    lint: Awaited<ReturnType<typeof runLint>>;
    entityCandidates: Awaited<ReturnType<typeof getEntityUpdateCandidates>>;
    factsCoverage: Awaited<ReturnType<typeof getFactsCoverageBacklog>>;
    enrichBacklog: Awaited<ReturnType<typeof getEnrichBacklog>>;
    thesisBacklog: Awaited<ReturnType<typeof getThesisBacklog>>;
    pageReviewBacklog: Awaited<ReturnType<typeof listReviewBacklog>>;
    outputBacklog: Awaited<ReturnType<typeof reviewOutputBacklog>>;
  };
  actions: {
    factsExpire: Awaited<ReturnType<typeof expireFacts>> | null;
    entityRefreshes: MaintainEntityRefresh[];
    queuedJobs: MaintainQueuedJob[];
  };
  nextSteps: string[];
}

export async function runWikiMaintain(
  opts: WikiMaintainOptions = {}
): Promise<WikiMaintainReport> {
  const limit = opts.limit ?? 10;
  const entityRefreshLimit = opts.entityRefreshLimit ?? 5;
  const enrichLimit = opts.enrichLimit ?? limit;
  const thesisLimit = opts.thesisLimit ?? limit;
  const applySafe = opts.applySafe === true;
  const dryRun = opts.dryRun === true;
  const enqueueEnrich = opts.enqueueEnrich === true;
  const enqueueThesisReview = opts.enqueueThesisReview === true;
  const factAgeDays = opts.factAgeDays ?? 90;

  const [
    lint,
    entityCandidates,
    factsCoverage,
    enrichBacklog,
    thesisBacklog,
    pageReviewBacklog,
    outputBacklog,
  ] = await Promise.all([
    runLint({
      factAgeDays,
      sampleSize: limit,
      writeEvent: !dryRun,
    }),
    getEntityUpdateCandidates({ limit: Math.max(limit, entityRefreshLimit) }),
    getFactsCoverageBacklog({ limit }),
    getEnrichBacklog({ limit: enrichLimit, includeInFlight: false }),
    getThesisBacklog({ limit: thesisLimit }),
    listReviewBacklog({ status: "fail", limit }),
    reviewOutputBacklog({ limit }),
  ]);

  const safeEntityRows = entityCandidates.rows
    .filter(isSafeAutoRefreshCandidate)
    .slice(0, entityRefreshLimit);

  const entityRefreshes: MaintainEntityRefresh[] = [];
  for (const row of safeEntityRows) {
    if (!applySafe || dryRun) {
      entityRefreshes.push({
        pageId: row.pageId,
        slug: row.slug,
        action: "candidate_only",
        applied: false,
        reason: applySafe && dryRun ? "dry-run" : "apply-safe-disabled",
      });
      continue;
    }
    try {
      const refreshed = await refreshEntityPage(row.pageId, { sourceLimit: 5 });
      entityRefreshes.push({
        pageId: row.pageId,
        slug: row.slug,
        action: "auto_refresh",
        applied: refreshed.applied,
        reason: refreshed.reasons.join("; ") || "no-new-evidence",
        appendedChars: refreshed.appendedChars,
        reviewStatus: refreshed.review?.status,
      });
    } catch (error) {
      entityRefreshes.push({
        pageId: row.pageId,
        slug: row.slug,
        action: "failed",
        applied: false,
        reason: (error as Error).message,
      });
    }
  }

  const factsExpire = applySafe && !dryRun
    ? await expireFacts({ ageDays: factAgeDays })
    : null;

  const queuedJobs: MaintainQueuedJob[] = [];
  if (enqueueEnrich) {
    const rows = enrichBacklog.rows.filter(
      (row) =>
        !row.inFlight &&
        (row.recommendedAction === "enrich_now" || row.recommendedAction === "retrigger")
    );
    for (const row of rows) {
      if (dryRun) {
        queuedJobs.push({
          kind: "enrich_entity",
          pageId: row.pageId,
          slug: row.slug,
          action: row.recommendedAction,
          queued: false,
          jobId: null,
          reason: "dry-run",
        });
        continue;
      }
      const job = await addJob(
        "enrich_entity",
        {
          pageId: row.pageId,
          slug: row.slug,
          sourcePageId: null,
          retrigger: row.recommendedAction === "retrigger",
          reason: `wiki:maintain ${row.recommendedAction}`,
        },
        Actor.systemJobs,
        {
          priority: row.recommendedAction === "enrich_now" ? 75 : 70,
        }
      );
      queuedJobs.push({
        kind: "enrich_entity",
        pageId: row.pageId,
        slug: row.slug,
        action: row.recommendedAction,
        queued: true,
        jobId: job.id.toString(),
        reason: "queued",
      });
    }
  }

  if (enqueueThesisReview) {
    const rows = thesisBacklog.rows.filter(
      (row) => row.recommendedAction === "review_now"
    );
    for (const row of rows) {
      const existing = await hasInFlightAgentRun("ae-thesis-track", row.pageId);
      if (existing) {
        queuedJobs.push({
          kind: "thesis_review",
          pageId: row.pageId,
          slug: row.slug,
          action: "review_now",
          queued: false,
          jobId: null,
          reason: "already-in-flight",
        });
        continue;
      }
      if (dryRun) {
        queuedJobs.push({
          kind: "thesis_review",
          pageId: row.pageId,
          slug: row.slug,
          action: "review_now",
          queued: false,
          jobId: null,
          reason: "dry-run",
        });
        continue;
      }
      const job = await addJob(
        "agent_run",
        {
          skill: "ae-thesis-track",
          prompt: buildThesisReviewPrompt(row),
          model: getEnv().OPENAI_AGENT_MODEL,
          maxTurns: 20,
          targetPageId: row.pageId,
        },
        Actor.agentRuntime,
        {
          priority: 45,
          progress: {
            stage: "queued",
            skill: "ae-thesis-track",
            target_page_id: row.pageId,
            message: `Queued thesis review for ${row.slug}`,
          },
        }
      );
      queuedJobs.push({
        kind: "thesis_review",
        pageId: row.pageId,
        slug: row.slug,
        action: "review_now",
        queued: true,
        jobId: job.id.toString(),
        reason: "queued",
      });
    }
  }

  const report: WikiMaintainReport = {
    generatedAt: new Date().toISOString(),
    mode: {
      applySafe,
      dryRun,
      enqueueEnrich,
      enqueueThesisReview,
    },
    summary: {
      totalLintIssues: lint.totalIssues,
      staleEntityCandidates: entityCandidates.summary.totalMatching,
      safeEntityRefreshCandidates: safeEntityRows.length,
      factsCoverageHighRisk: factsCoverage.summary.highRisk,
      factsCoverageMediumRisk: factsCoverage.summary.mediumRisk,
      enrichNow: enrichBacklog.summary.enrichNow,
      enrichRetrigger: enrichBacklog.summary.retrigger,
      thesisReviewNow: thesisBacklog.summary.reviewNow,
      pageReviewFailures: pageReviewBacklog.totalMatching,
      outputFailures: outputBacklog.summary.fail,
      expiredFacts: factsExpire?.expiredCount ?? 0,
      entityRefreshApplied: entityRefreshes.filter((row) => row.applied).length,
      enrichJobsQueued: queuedJobs.filter(
        (row) => row.kind === "enrich_entity" && row.queued
      ).length,
      thesisJobsQueued: queuedJobs.filter(
        (row) => row.kind === "thesis_review" && row.queued
      ).length,
    },
    reports: {
      lint,
      entityCandidates,
      factsCoverage,
      enrichBacklog,
      thesisBacklog,
      pageReviewBacklog,
      outputBacklog,
    },
    actions: {
      factsExpire,
      entityRefreshes,
      queuedJobs,
    },
    nextSteps: buildNextSteps({
      factsCoverageHighRisk: factsCoverage.summary.highRisk,
      thesisReviewNow: thesisBacklog.summary.reviewNow,
      pageReviewFailures: pageReviewBacklog.totalMatching,
      outputFailures: outputBacklog.summary.fail,
      manualEntityRewrites: entityCandidates.summary.manualRewrite,
      enrichNow: enrichBacklog.summary.enrichNow,
      enrichRetrigger: enrichBacklog.summary.retrigger,
    }),
  };

  if (!dryRun) {
    await db.insert(schema.events).values(
      withCreateAudit(
        {
          actor: Actor.systemJobs,
          action: "wiki_maintain_run",
          entityType: null,
          entityId: null,
          payload: {
            mode: report.mode,
            summary: report.summary,
            actions: report.actions,
            nextSteps: report.nextSteps,
          },
        },
        Actor.systemJobs
      )
    );
  }

  return report;
}

export function formatWikiMaintainReport(report: WikiMaintainReport): string {
  const lines = [
    `wiki:maintain ${report.mode.dryRun ? "(DRY-RUN)" : ""}`,
    `  mode: apply_safe=${report.mode.applySafe} enqueue_enrich=${report.mode.enqueueEnrich} enqueue_thesis_review=${report.mode.enqueueThesisReview}`,
    "",
    "Health",
    `  lint_issues=${report.summary.totalLintIssues}`,
    `  stale_entities=${report.summary.staleEntityCandidates} safe_refresh_candidates=${report.summary.safeEntityRefreshCandidates}`,
    `  facts_coverage=high:${report.summary.factsCoverageHighRisk} medium:${report.summary.factsCoverageMediumRisk}`,
    `  enrich=enrich_now:${report.summary.enrichNow} retrigger:${report.summary.enrichRetrigger}`,
    `  thesis_review_now=${report.summary.thesisReviewNow}`,
    `  page_review_failures=${report.summary.pageReviewFailures} output_failures=${report.summary.outputFailures}`,
    "",
    "Actions",
    `  expired_facts=${report.summary.expiredFacts}`,
    `  entity_refresh_applied=${report.summary.entityRefreshApplied}`,
    `  enrich_jobs_queued=${report.summary.enrichJobsQueued}`,
    `  thesis_jobs_queued=${report.summary.thesisJobsQueued}`,
  ];

  if (report.actions.entityRefreshes.length > 0) {
    lines.push("", "Entity Refresh Candidates");
    for (const row of report.actions.entityRefreshes) {
      lines.push(
        `  [${row.action}] #${row.pageId} ${row.slug} applied=${row.applied} ${row.reason}`
      );
    }
  }

  if (report.actions.queuedJobs.length > 0) {
    lines.push("", "Queued Work");
    for (const row of report.actions.queuedJobs) {
      lines.push(
        `  [${row.kind}] #${row.pageId} ${row.slug} queued=${row.queued} job=${row.jobId ?? "-"} ${row.reason}`
      );
    }
  }

  if (report.nextSteps.length > 0) {
    lines.push("", "Next Steps");
    for (const step of report.nextSteps) {
      lines.push(`  - ${step}`);
    }
  }

  return lines.join("\n");
}

function isSafeAutoRefreshCandidate(
  row: Awaited<ReturnType<typeof getEntityUpdateCandidates>>["rows"][number]
): boolean {
  if (row.recommendedAction !== "append_update") return false;
  if (row.type === "thesis") return false;
  if (row.newSignals > 0) return false;
  return row.newSources + row.newFacts + row.newTimelineEntries > 0;
}

async function hasInFlightAgentRun(
  skill: string,
  targetPageId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.minionJobs.id })
    .from(schema.minionJobs)
    .where(
      and(
        eq(schema.minionJobs.deleted, 0),
        eq(schema.minionJobs.name, "agent_run"),
        sql`${schema.minionJobs.status} IN ('waiting', 'active', 'paused')`,
        sql`${schema.minionJobs.data}->>'skill' = ${skill}`,
        sql`${schema.minionJobs.data}->>'targetPageId' = ${targetPageId}`
      )
    )
    .limit(1);
  return rows.length > 0;
}

function buildThesisReviewPrompt(
  row: Awaited<ReturnType<typeof getThesisBacklog>>["rows"][number]
): string {
  return [
    `Run a focused thesis maintenance review for [[${row.slug}|${row.title}]] (#${row.pageId}).`,
    `Current status=${row.status}, conviction=${row.conviction ?? "unknown"}, target=${row.targetSlug ?? "unknown"}.`,
    `Reasons: stale=${row.daysSinceUpdate}d, unresolved_conditions=${row.unresolvedConditions}, recent_signals=${row.recentSignals}.`,
    "Use the ae-thesis-track workflow. Update conviction/status/catalysts/validation conditions only if the evidence supports it, and preserve provenance.",
  ].join("\n");
}

function buildNextSteps(input: {
  factsCoverageHighRisk: number;
  thesisReviewNow: number;
  pageReviewFailures: number;
  outputFailures: number;
  manualEntityRewrites: number;
  enrichNow: number;
  enrichRetrigger: number;
}): string[] {
  const steps: string[] = [];
  if (input.pageReviewFailures > 0) {
    steps.push("Repair failed page reviews before relying on downstream facts/signals.");
  }
  if (input.factsCoverageHighRisk > 0) {
    steps.push("Run facts:re-extract or inspect source narratives for high-risk facts coverage gaps.");
  }
  if (input.manualEntityRewrites > 0) {
    steps.push("Manually rewrite entity pages where new evidence is too stale or signal-heavy for append-only refresh.");
  }
  if (input.enrichNow + input.enrichRetrigger > 0) {
    steps.push("Use --enqueue-enrich to push high-priority entity enrich/retrigger work into the worker queue.");
  }
  if (input.thesisReviewNow > 0) {
    steps.push("Use --enqueue-thesis-review to queue ae-thesis-track reviews for stale or signal-hit theses.");
  }
  if (input.outputFailures > 0) {
    steps.push("Regenerate or repair failing daily outputs, then rerun output:backlog.");
  }
  return steps;
}
