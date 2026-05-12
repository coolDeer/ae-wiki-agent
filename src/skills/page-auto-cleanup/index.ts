/**
 * page:auto-cleanup
 *
 * Deterministic page hygiene runner for scheduled cleanup:
 *   1. scan executable merge candidates
 *   2. dry-run each candidate through page:merge
 *   3. apply only candidates that still pass the safety gate
 *   4. rescan until stable or maxPasses is reached
 *   5. optionally retire orphan entity stubs after merge convergence
 */

import {
  findMergeCandidates,
  type MergeCandidateRow,
} from "../merge-candidates/index.ts";
import { mergePages, type MergePagesReport } from "../page-merge/index.ts";
import { findOrphans } from "../orphans/index.ts";
import { retirePage, type RetirePageReport } from "../page-retire/index.ts";

const DEFAULT_ACTOR = "agent:page-auto-cleanup";
const MERGEABLE_TYPES = ["company", "industry", "concept", "thesis"] as const;
const RETIRABLE_TYPES = new Set(["company", "industry", "concept", "thesis"]);

export interface AutoCleanupOptions {
  apply?: boolean;
  type?: string;
  minSim?: number;
  limit?: number;
  maxPasses?: number;
  includeStructureOnly?: boolean;
  includeHumanReviewIdentity?: boolean;
  retireOrphans?: boolean;
  orphanLimit?: number;
  orphanMinAgeDays?: number;
  maxContentChars?: number;
  actor?: string;
}

export interface AutoCleanupReport {
  generatedAt: string;
  dryRun: boolean;
  options: {
    type: string | null;
    minSim: number;
    limit: number;
    maxPasses: number;
    includeStructureOnly: boolean;
    includeHumanReviewIdentity: boolean;
    retireOrphans: boolean;
    orphanLimit: number;
    orphanMinAgeDays: number;
  };
  summary: {
    passes: number;
    candidatesSeen: number;
    candidatesEligible: number;
    mergesPlanned: number;
    mergesApplied: number;
    retirementsPlanned: number;
    retirementsApplied: number;
    skipped: number;
    failures: number;
    remainingMergeCandidates: number;
    remainingAutoMerge: number;
    remainingStructureOnly: number;
    remainingHumanReview: number;
    remainingLowOrphans: number;
  };
  passes: Array<{
    pass: number;
    candidatesSeen: number;
    eligible: number;
    applied: number;
    planned: number;
    skipped: number;
    failed: number;
  }>;
  merges: MergeAction[];
  retirements: RetireAction[];
  skipped: SkipAction[];
  failures: FailureAction[];
}

export interface MergeAction {
  status: "planned" | "applied";
  mode: "auto_merge" | "structure_only" | "human_review_identity";
  skipNarrativeFusion: boolean;
  canonical: MergeActionPage;
  duplicate: MergeActionPage;
  reason: string;
  planned: MergePagesReport["planned"];
  narrativeFusion: MergePagesReport["narrativeFusion"];
}

export interface RetireAction {
  status: "planned" | "applied";
  page: RetirePageReport["page"];
  reason: string;
  counts: RetirePageReport["counts"];
  softDeleted: RetirePageReport["softDeleted"];
}

export interface SkipAction {
  kind: "merge" | "retire";
  page?: {
    id: string;
    slug: string;
    type: string;
  };
  canonical?: MergeActionPage;
  duplicate?: MergeActionPage;
  reason: string;
}

export interface FailureAction {
  kind: "merge" | "retire";
  page?: {
    id: string;
    slug: string;
    type: string;
  };
  canonical?: MergeActionPage;
  duplicate?: MergeActionPage;
  error: string;
}

interface MergeActionPage {
  id: string;
  slug: string;
  type: string;
  title: string;
}

export async function autoCleanupPages(
  opts: AutoCleanupOptions = {}
): Promise<AutoCleanupReport> {
  const apply = opts.apply ?? false;
  const minSim = opts.minSim ?? 0.7;
  const limit = opts.limit ?? 100;
  const maxPasses = boundedInt(opts.maxPasses ?? 5, 1, 20);
  const includeStructureOnly = opts.includeStructureOnly ?? false;
  const includeHumanReviewIdentity = opts.includeHumanReviewIdentity ?? false;
  const retireOrphans = opts.retireOrphans ?? true;
  const orphanLimit = opts.orphanLimit ?? 100;
  const orphanMinAgeDays = opts.orphanMinAgeDays ?? 3;
  const actor = opts.actor ?? DEFAULT_ACTOR;

  const report: AutoCleanupReport = {
    generatedAt: new Date().toISOString(),
    dryRun: !apply,
    options: {
      type: opts.type ?? null,
      minSim,
      limit,
      maxPasses,
      includeStructureOnly,
      includeHumanReviewIdentity,
      retireOrphans,
      orphanLimit,
      orphanMinAgeDays,
    },
    summary: {
      passes: 0,
      candidatesSeen: 0,
      candidatesEligible: 0,
      mergesPlanned: 0,
      mergesApplied: 0,
      retirementsPlanned: 0,
      retirementsApplied: 0,
      skipped: 0,
      failures: 0,
      remainingMergeCandidates: 0,
      remainingAutoMerge: 0,
      remainingStructureOnly: 0,
      remainingHumanReview: 0,
      remainingLowOrphans: 0,
    },
    passes: [],
    merges: [],
    retirements: [],
    skipped: [],
    failures: [],
  };

  for (let pass = 1; pass <= maxPasses; pass++) {
    const candidateReport = await scanMergeCandidates({
      type: opts.type,
      minSim,
      limit,
      includeHumanReview: includeHumanReviewIdentity,
    });
    const eligible = candidateReport.candidates.filter((candidate) =>
      isMergeEligible(candidate, includeStructureOnly, includeHumanReviewIdentity)
    );
    const passReport = {
      pass,
      candidatesSeen: candidateReport.candidates.length,
      eligible: eligible.length,
      applied: 0,
      planned: 0,
      skipped: 0,
      failed: 0,
    };

    report.summary.candidatesSeen += candidateReport.candidates.length;
    report.summary.candidatesEligible += eligible.length;

    if (eligible.length === 0) {
      report.passes.push(passReport);
      break;
    }

    for (const candidate of eligible) {
      const skipNarrativeFusion = shouldSkipNarrativeFusion(candidate);
      const mode = mergeActionMode(candidate);
      const reason = mergeReason(candidate, skipNarrativeFusion);
      try {
        const dryRunReport = await mergePages(
          BigInt(candidate.canonical.pageId),
          BigInt(candidate.duplicate.pageId),
          {
            reason,
            actor,
            dryRun: true,
            skipNarrativeFusion,
          }
        );
        const skipReason = validateMergeDryRun(
          candidate,
          dryRunReport,
          skipNarrativeFusion
        );
        if (skipReason) {
          report.skipped.push({
            kind: "merge",
            canonical: mergePage(candidate.canonical),
            duplicate: mergePage(candidate.duplicate),
            reason: skipReason,
          });
          passReport.skipped++;
          continue;
        }

        if (!apply) {
          report.merges.push({
            status: "planned",
            mode,
            skipNarrativeFusion,
            canonical: mergePage(candidate.canonical),
            duplicate: mergePage(candidate.duplicate),
            reason,
            planned: dryRunReport.planned,
            narrativeFusion: dryRunReport.narrativeFusion,
          });
          passReport.planned++;
          continue;
        }

        const applied = await mergePages(
          BigInt(candidate.canonical.pageId),
          BigInt(candidate.duplicate.pageId),
          {
            reason,
            actor,
            skipNarrativeFusion,
          }
        );
        report.merges.push({
          status: "applied",
          mode,
          skipNarrativeFusion,
          canonical: mergePage(candidate.canonical),
          duplicate: mergePage(candidate.duplicate),
          reason,
          planned: applied.planned,
          narrativeFusion: applied.narrativeFusion,
        });
        passReport.applied++;
      } catch (e) {
        report.failures.push({
          kind: "merge",
          canonical: mergePage(candidate.canonical),
          duplicate: mergePage(candidate.duplicate),
          error: (e as Error).message,
        });
        passReport.failed++;
      }
    }

    report.passes.push(passReport);
    if (!apply || passReport.applied === 0) break;
  }

  if (retireOrphans) {
    await runRetirements(report, {
      apply,
      actor,
      type: opts.type,
      orphanLimit,
      orphanMinAgeDays,
      maxContentChars: opts.maxContentChars,
    });
  }

  await fillRemainingDiagnostics(report, {
    type: opts.type,
    minSim,
    limit,
    orphanMinAgeDays,
    orphanLimit,
  });

  report.summary.passes = report.passes.length;
  report.summary.mergesPlanned = report.merges.filter(
    (item) => item.status === "planned"
  ).length;
  report.summary.mergesApplied = report.merges.filter(
    (item) => item.status === "applied"
  ).length;
  report.summary.retirementsPlanned = report.retirements.filter(
    (item) => item.status === "planned"
  ).length;
  report.summary.retirementsApplied = report.retirements.filter(
    (item) => item.status === "applied"
  ).length;
  report.summary.skipped = report.skipped.length;
  report.summary.failures = report.failures.length;

  return report;
}

export function formatAutoCleanupReport(report: AutoCleanupReport): string {
  const lines = [
    `Page auto-cleanup ${report.dryRun ? "(dry-run)" : "(applied)"}`,
    `  passes=${report.summary.passes} merges=${report.summary.mergesApplied}/${report.summary.mergesPlanned} retired=${report.summary.retirementsApplied}/${report.summary.retirementsPlanned} skipped=${report.summary.skipped} failures=${report.summary.failures}`,
    `  remaining: merge_candidates=${report.summary.remainingMergeCandidates} auto_merge=${report.summary.remainingAutoMerge} structure_only=${report.summary.remainingStructureOnly} human_review=${report.summary.remainingHumanReview} low_orphans=${report.summary.remainingLowOrphans}`,
    "",
  ];

  if (report.merges.length > 0) {
    lines.push("Merges:");
    for (const item of report.merges) {
      lines.push(
        `  ${item.status} [${item.mode}] ${item.canonical.slug} <= ${item.duplicate.slug}` +
          `${item.skipNarrativeFusion ? " (structure only)" : ""}`
      );
    }
    lines.push("");
  }

  if (report.retirements.length > 0) {
    lines.push("Retirements:");
    for (const item of report.retirements) {
      lines.push(`  ${item.status} ${item.page.slug}`);
    }
    lines.push("");
  }

  if (report.skipped.length > 0) {
    lines.push("Skipped:");
    for (const item of report.skipped.slice(0, 20)) {
      if (item.kind === "merge") {
        lines.push(
          `  merge ${item.canonical?.slug} <= ${item.duplicate?.slug}: ${item.reason}`
        );
      } else {
        lines.push(`  retire ${item.page?.slug}: ${item.reason}`);
      }
    }
    if (report.skipped.length > 20) {
      lines.push(`  ... ${report.skipped.length - 20} more`);
    }
    lines.push("");
  }

  if (report.failures.length > 0) {
    lines.push("Failures:");
    for (const item of report.failures.slice(0, 20)) {
      if (item.kind === "merge") {
        lines.push(
          `  merge ${item.canonical?.slug} <= ${item.duplicate?.slug}: ${item.error}`
        );
      } else {
        lines.push(`  retire ${item.page?.slug}: ${item.error}`);
      }
    }
    if (report.failures.length > 20) {
      lines.push(`  ... ${report.failures.length - 20} more`);
    }
  }

  return lines.join("\n").trimEnd();
}

function isMergeEligible(
  candidate: MergeCandidateRow,
  includeStructureOnly: boolean,
  includeHumanReviewIdentity: boolean
): boolean {
  if (candidate.mergeMode === "auto_merge" && candidate.narrativeRisk === "low") {
    return true;
  }
  if (
    includeStructureOnly &&
    candidate.mergeMode === "structure_only" &&
    candidate.narrativeRisk === "medium" &&
    hasStrongIdentityEvidence(candidate)
  ) {
    return true;
  }
  return (
    includeHumanReviewIdentity &&
    candidate.mergeMode === "human_review" &&
    hasVeryStrongIdentityEvidence(candidate)
  );
}

function mergeActionMode(
  candidate: MergeCandidateRow
): "auto_merge" | "structure_only" | "human_review_identity" {
  if (candidate.mergeMode === "human_review") return "human_review_identity";
  return candidate.mergeMode === "structure_only" ? "structure_only" : "auto_merge";
}

function validateMergeDryRun(
  candidate: MergeCandidateRow,
  dryRunReport: MergePagesReport,
  skipNarrativeFusion: boolean
): string | null {
  if (!dryRunReport.dryRun) return "internal dry-run did not return dryRun=true";
  if (dryRunReport.canonical.id !== candidate.canonical.pageId) {
    return "canonical page changed between candidate scan and dry-run";
  }
  if (dryRunReport.duplicate.id !== candidate.duplicate.pageId) {
    return "duplicate page changed between candidate scan and dry-run";
  }
  if (skipNarrativeFusion && dryRunReport.narrativeFusion.mode !== "skip") {
    return "structure-only merge would still modify narrative";
  }
  if (candidate.mergeMode === "auto_merge" && candidate.narrativeRisk !== "low") {
    return `auto_merge candidate has unexpected risk=${candidate.narrativeRisk}`;
  }
  if (candidate.mergeMode === "structure_only" && !hasStrongIdentityEvidence(candidate)) {
    return "structure_only candidate lacks strong identity evidence";
  }
  if (
    candidate.mergeMode === "human_review" &&
    !hasVeryStrongIdentityEvidence(candidate)
  ) {
    return "human_review candidate lacks very strong identity evidence";
  }
  return null;
}

async function runRetirements(
  report: AutoCleanupReport,
  opts: {
    apply: boolean;
    actor: string;
    type?: string;
    orphanLimit: number;
    orphanMinAgeDays: number;
    maxContentChars?: number;
  }
): Promise<void> {
  const orphanType =
    opts.type && RETIRABLE_TYPES.has(opts.type) ? opts.type : undefined;
  const orphanReport = await findOrphans({
    type: orphanType,
    entityState: "stub",
    minAgeDays: opts.orphanMinAgeDays,
    limit: opts.orphanLimit,
  });

  for (const orphan of orphanReport.orphans) {
    const reason = `page auto-cleanup: orphan entity stub (${orphan.daysOld}d old)`;
    try {
      const dryRunReport = await retirePage(BigInt(orphan.pageId), {
        reason,
        actor: opts.actor,
        dryRun: true,
        maxContentChars: opts.maxContentChars,
      });
      if (dryRunReport.blockers.length > 0) {
        report.skipped.push({
          kind: "retire",
          page: {
            id: orphan.pageId,
            slug: orphan.slug,
            type: orphan.type,
          },
          reason: dryRunReport.blockers.join("; "),
        });
        continue;
      }

      if (!opts.apply) {
        report.retirements.push({
          status: "planned",
          page: dryRunReport.page,
          reason,
          counts: dryRunReport.counts,
          softDeleted: dryRunReport.softDeleted,
        });
        continue;
      }

      const applied = await retirePage(BigInt(orphan.pageId), {
        reason,
        actor: opts.actor,
        maxContentChars: opts.maxContentChars,
      });
      report.retirements.push({
        status: "applied",
        page: applied.page,
        reason,
        counts: applied.counts,
        softDeleted: applied.softDeleted,
      });
    } catch (e) {
      report.failures.push({
        kind: "retire",
        page: {
          id: orphan.pageId,
          slug: orphan.slug,
          type: orphan.type,
        },
        error: (e as Error).message,
      });
    }
  }
}

async function fillRemainingDiagnostics(
  report: AutoCleanupReport,
  opts: {
    type?: string;
    minSim: number;
    limit: number;
    orphanMinAgeDays: number;
    orphanLimit: number;
  }
): Promise<void> {
  const [mergeReport, orphanReport] = await Promise.all([
    scanMergeCandidates({
      type: opts.type,
      minSim: opts.minSim,
      limit: opts.limit,
      includeHumanReview: true,
    }),
    findOrphans({
      type: opts.type && RETIRABLE_TYPES.has(opts.type) ? opts.type : undefined,
      entityState: "stub",
      minAgeDays: opts.orphanMinAgeDays,
      limit: opts.orphanLimit,
    }),
  ]);

  report.summary.remainingMergeCandidates = mergeReport.totalCandidates;
  report.summary.remainingAutoMerge = mergeReport.summary.autoMerge;
  report.summary.remainingStructureOnly = mergeReport.summary.structureOnly;
  report.summary.remainingHumanReview = mergeReport.summary.humanReview;
  report.summary.remainingLowOrphans = orphanReport.totalOrphans;
}

async function scanMergeCandidates(opts: {
  type?: string;
  minSim: number;
  limit: number;
  includeHumanReview?: boolean;
}): Promise<{
  totalCandidates: number;
  summary: {
    autoMerge: number;
    structureOnly: number;
    humanReview: number;
  };
  candidates: MergeCandidateRow[];
}> {
  const types = opts.type ? [opts.type] : Array.from(MERGEABLE_TYPES);
  const reports = [];
  for (const type of types) {
    reports.push(
      await findMergeCandidates({
        type,
        minSim: opts.minSim,
        limit: opts.limit,
        includeHumanReview: opts.includeHumanReview,
      })
    );
  }

  const candidates = reports
    .flatMap((item) => item.candidates)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, opts.limit);

  return {
    totalCandidates: reports.reduce(
      (total, item) => total + item.totalCandidates,
      0
    ),
    summary: {
      autoMerge: reports.reduce(
        (total, item) => total + item.summary.autoMerge,
        0
      ),
      structureOnly: reports.reduce(
        (total, item) => total + item.summary.structureOnly,
        0
      ),
      humanReview: reports.reduce(
        (total, item) => total + item.summary.humanReview,
        0
      ),
    },
    candidates,
  };
}

function hasStrongIdentityEvidence(candidate: MergeCandidateRow): boolean {
  if (candidate.overlapScore >= 0.6) return true;
  for (const evidence of candidate.evidence) {
    if (evidence.type === "alias_conflict" && evidence.score >= 0.3) return true;
    if (evidence.type === "duplicate_similarity" && evidence.score >= 0.9) {
      return true;
    }
  }
  return false;
}

function hasVeryStrongIdentityEvidence(candidate: MergeCandidateRow): boolean {
  const aliasEvidence = candidate.evidence.filter(
    (item) => item.type === "alias_conflict"
  );
  const duplicateScore = Math.max(
    0,
    ...candidate.evidence
      .filter((item) => item.type === "duplicate_similarity")
      .map((item) => item.score)
  );
  const aliasScore = Math.max(0, ...aliasEvidence.map((item) => item.score));
  if (duplicateScore >= 0.98 && aliasEvidence.length >= 2) return true;
  if (duplicateScore >= 0.92 && aliasScore >= 0.7) return true;
  return false;
}

function shouldSkipNarrativeFusion(candidate: MergeCandidateRow): boolean {
  if (candidate.mergeMode === "structure_only") return true;
  if (candidate.mergeMode !== "human_review") return false;

  // For exact-identity high-narrative cases, avoid appending one long compiled
  // page onto another. If the canonical side is only a stub, let mergePages
  // promote the duplicate body through stage3AppendNarrative's write_initial path.
  return candidate.narrative.canonicalChars >= 200;
}

function mergeReason(
  candidate: MergeCandidateRow,
  skipNarrativeFusion: boolean
): string {
  const evidence = candidate.evidence
    .slice(0, 3)
    .map((item) => `${item.type}:${item.score.toFixed(2)}`)
    .join(", ");
  return [
    "page auto-cleanup",
    `${candidate.canonical.slug} <= ${candidate.duplicate.slug}`,
    `mode=${candidate.mergeMode}`,
    `risk=${candidate.narrativeRisk}`,
    skipNarrativeFusion ? "skip_narrative_fusion=true" : null,
    evidence ? `evidence=${evidence}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function mergePage(page: MergeCandidateRow["canonical"]): MergeActionPage {
  return {
    id: page.pageId,
    slug: page.slug,
    type: page.type,
    title: page.title,
  };
}

function boundedInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
