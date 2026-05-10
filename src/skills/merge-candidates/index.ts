/**
 * merge-candidates
 *
 * 把 duplicates + alias-conflicts 两路诊断收敛成一个可执行队列：
 *   - 仅保留“当前 merge 逻辑允许执行”的候选（同 source_id、同 type）
 *   - 自动推荐 canonical / duplicate 方向
 *   - 给出 priority 分和原因，便于先清最值钱的一批裂化
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "~/core/db.ts";
import {
  type DuplicateFilters,
  findDuplicates,
} from "../duplicates/index.ts";
import { findAliasConflicts } from "../alias-conflicts/index.ts";

export interface MergeCandidatePageMeta {
  id: string;
  sourceId: string;
  slug: string;
  type: string;
  title: string;
  confidence: string;
  completenessScore: number;
  backlinks: number;
  aliases: string[];
  content: string;
  contentChars: number;
  updateBlocks: number;
  sectionCount: number;
  createTime: string;
  updateTime: string;
}

type EvidenceType = "duplicate_similarity" | "alias_conflict";

interface PairEvidence {
  type: EvidenceType;
  score: number;
  detail: string;
}

type MergeMode = "auto_merge" | "structure_only" | "human_review";
type NarrativeRisk = "low" | "medium" | "high";

export interface MergeCandidateRow {
  canonical: {
    pageId: string;
    slug: string;
    title: string;
    type: string;
    confidence: string;
    completenessScore: number;
    backlinks: number;
  };
  duplicate: {
    pageId: string;
    slug: string;
    title: string;
    type: string;
    confidence: string;
    completenessScore: number;
    backlinks: number;
  };
  priority: number;
  mergeMode: MergeMode;
  narrativeRisk: NarrativeRisk;
  overlapScore: number;
  narrative: {
    canonicalChars: number;
    duplicateChars: number;
    duplicateToCanonicalRatio: number;
    duplicateSectionCount: number;
    duplicateUpdateBlocks: number;
  };
  evidence: PairEvidence[];
  reasons: string[];
  suggestedCommand: string;
}

export interface MergeCandidatesReport {
  generatedAt: string;
  filters: {
    type: string | null;
    minSim: number;
    limit: number;
    includeHumanReview: boolean;
  };
  totalCandidates: number;
  summary: {
    autoMerge: number;
    structureOnly: number;
    humanReview: number;
  };
  candidates: MergeCandidateRow[];
}

export async function findMergeCandidates(
  opts: DuplicateFilters & { includeHumanReview?: boolean } = {}
): Promise<MergeCandidatesReport> {
  const minSim = opts.minSim ?? 0.7;
  const limit = opts.limit ?? 30;
  const includeHumanReview = opts.includeHumanReview ?? false;

  const duplicateReport = await findDuplicates({
    type: opts.type,
    minSim,
    limit: Math.max(limit * 3, 50),
  });
  const aliasReport = await findAliasConflicts({
    type: opts.type,
    limit: Math.max(limit * 3, 50),
  });

  const pageIdSet = new Set<string>();
  for (const pair of duplicateReport.pairs) {
    pageIdSet.add(pair.aId);
    pageIdSet.add(pair.bId);
  }
  for (const row of aliasReport.rows) {
    for (const page of row.pages) {
      pageIdSet.add(page.pageId);
    }
  }

  const pageMap = await loadPageMeta(Array.from(pageIdSet));
  const pairMap = new Map<string, { aId: string; bId: string; evidence: PairEvidence[] }>();

  for (const pair of duplicateReport.pairs) {
    const key = pairKey(pair.aId, pair.bId);
    const existing = pairMap.get(key) ?? {
      aId: smaller(pair.aId, pair.bId),
      bId: larger(pair.aId, pair.bId),
      evidence: [],
    };
    existing.evidence.push({
      type: "duplicate_similarity",
      score: pair.score,
      detail: `title=${pair.titleSim.toFixed(2)} word=${pair.wordSim.toFixed(2)}`,
    });
    pairMap.set(key, existing);
  }

  for (const conflict of aliasReport.rows) {
    for (let i = 0; i < conflict.pages.length; i++) {
      for (let j = i + 1; j < conflict.pages.length; j++) {
        const left = conflict.pages[i]!;
        const right = conflict.pages[j]!;
        const leftMeta = pageMap.get(left.pageId);
        const rightMeta = pageMap.get(right.pageId);
        if (!leftMeta || !rightMeta) continue;
        if (leftMeta.type !== rightMeta.type) continue;
        if (leftMeta.sourceId !== rightMeta.sourceId) continue;

        const key = pairKey(left.pageId, right.pageId);
        const existing = pairMap.get(key) ?? {
          aId: smaller(left.pageId, right.pageId),
          bId: larger(left.pageId, right.pageId),
          evidence: [],
        };
        existing.evidence.push({
          type: "alias_conflict",
          score: aliasOverlapScore(leftMeta, rightMeta),
          detail: `shared alias "${conflict.alias}"`,
        });
        pairMap.set(key, existing);
      }
    }
  }

  const candidates: MergeCandidateRow[] = [];
  for (const pair of pairMap.values()) {
    const left = pageMap.get(pair.aId);
    const right = pageMap.get(pair.bId);
    if (!left || !right) continue;
    if (left.type !== right.type) continue;
    if (left.sourceId !== right.sourceId) continue;

    const overlap = aliasOverlapScore(left, right);
    const hasAliasEvidence = pair.evidence.some((item) => item.type === "alias_conflict");
    if (!hasAliasEvidence && !isLikelyDuplicateByNames(left, right, overlap)) {
      continue;
    }

    const [canonical, duplicate] = chooseCanonical(left, right);
    const evidence = dedupeEvidence(pair.evidence);
    const overlapScore = narrativeOverlapScore(canonical, duplicate);
    const narrativeAssessment = classifyNarrativeRisk(canonical, duplicate, overlapScore);
    if (!includeHumanReview && narrativeAssessment.mergeMode === "human_review") {
      continue;
    }
    const reasons = buildReasons(canonical, duplicate, evidence);
    const priority = computePriority(canonical, duplicate, evidence, narrativeAssessment);
    candidates.push({
      canonical: summarizePage(canonical),
      duplicate: summarizePage(duplicate),
      priority,
      mergeMode: narrativeAssessment.mergeMode,
      narrativeRisk: narrativeAssessment.narrativeRisk,
      overlapScore,
      narrative: {
        canonicalChars: canonical.contentChars,
        duplicateChars: duplicate.contentChars,
        duplicateToCanonicalRatio: narrativeAssessment.duplicateToCanonicalRatio,
        duplicateSectionCount: duplicate.sectionCount,
        duplicateUpdateBlocks: duplicate.updateBlocks,
      },
      evidence,
      reasons: [...reasons, ...narrativeAssessment.reasons],
      suggestedCommand:
        `bun src/cli.ts page:merge ${canonical.id} ${duplicate.id} ` +
        `${narrativeAssessment.mergeMode === "structure_only" ? "--skip-narrative-fusion " : ""}` +
        `--reason "merge candidate: ${reasons[0] ?? "entity dedupe"}" --dry-run`,
    });
  }

  candidates.sort((a, b) => b.priority - a.priority);

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      type: opts.type ?? null,
      minSim,
      limit,
      includeHumanReview,
    },
    totalCandidates: candidates.length,
    summary: {
      autoMerge: candidates.filter((c) => c.mergeMode === "auto_merge").length,
      structureOnly: candidates.filter((c) => c.mergeMode === "structure_only").length,
      humanReview: candidates.filter((c) => c.mergeMode === "human_review").length,
    },
    candidates: candidates.slice(0, limit),
  };
}

export function formatMergeCandidates(report: MergeCandidatesReport): string {
  const lines = [
    `Merge candidates (${report.candidates.length}/${report.totalCandidates} shown)`,
    `  filter: type=${report.filters.type ?? "(all eligible)"} min_sim=${report.filters.minSim} limit=${report.filters.limit} include_human_review=${report.filters.includeHumanReview}`,
    `  summary: auto_merge=${report.summary.autoMerge} structure_only=${report.summary.structureOnly} human_review=${report.summary.humanReview}`,
    "",
  ];

  if (report.candidates.length === 0) {
    lines.push("No executable merge candidates found.");
    return lines.join("\n");
  }

  const groups: Array<{ mode: MergeMode; title: string }> = [
    { mode: "auto_merge", title: "Auto Merge" },
    { mode: "structure_only", title: "Structure Only" },
    { mode: "human_review", title: "Human Review" },
  ];

  for (const group of groups) {
    const rows = report.candidates.filter((row) => row.mergeMode === group.mode);
    if (rows.length === 0) continue;

    lines.push(`## ${group.title} (${rows.length})`);
    for (const row of rows) {
      lines.push(
        `  priority=${row.priority.toFixed(2)} risk=${row.narrativeRisk} [${row.canonical.type}] ${row.canonical.slug} <= ${row.duplicate.slug}`
      );
      lines.push(
        `    canonical: #${row.canonical.pageId} conf=${row.canonical.confidence} score=${row.canonical.completenessScore.toFixed(2)} bl=${row.canonical.backlinks}`
      );
      lines.push(
        `    duplicate: #${row.duplicate.pageId} conf=${row.duplicate.confidence} score=${row.duplicate.completenessScore.toFixed(2)} bl=${row.duplicate.backlinks}`
      );
      lines.push(
        `    narrative: overlap=${row.overlapScore.toFixed(2)} dup_chars=${row.narrative.duplicateChars} ratio=${row.narrative.duplicateToCanonicalRatio.toFixed(2)} sections=${row.narrative.duplicateSectionCount} updates=${row.narrative.duplicateUpdateBlocks}`
      );
      lines.push(
        `    evidence: ${row.evidence.map((e) => `${e.type}:${e.score.toFixed(2)} (${e.detail})`).join(" | ")}`
      );
      lines.push(`    reason: ${row.reasons.join("; ")}`);
      lines.push(`    cmd: ${row.suggestedCommand}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function loadPageMeta(pageIds: string[]): Promise<Map<string, MergeCandidatePageMeta>> {
  if (pageIds.length === 0) return new Map();
  const ids = pageIds.map((id) => BigInt(id));
  const rows = await db
    .select({
      id: schema.pages.id,
      sourceId: schema.pages.sourceId,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      confidence: schema.pages.confidence,
      completenessScore: schema.pages.completenessScore,
      aliases: schema.pages.aliases,
      content: schema.pages.content,
      createTime: schema.pages.createTime,
      updateTime: schema.pages.updateTime,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.deleted, 0), inArray(schema.pages.id, ids)));

  const backlinkRows = (await db.execute(sql`
    SELECT to_page_id::text AS page_id, COUNT(*)::int AS n
    FROM links
    WHERE deleted = 0
      AND to_page_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    GROUP BY to_page_id
  `)) as Array<{ page_id: string; n: number }>;
  const backlinkMap = new Map(backlinkRows.map((row) => [row.page_id, row.n]));

  const map = new Map<string, MergeCandidatePageMeta>();
  for (const row of rows) {
    map.set(row.id.toString(), {
      id: row.id.toString(),
      sourceId: row.sourceId,
      slug: row.slug,
      type: row.type,
      title: row.title,
      confidence: row.confidence ?? "unknown",
      completenessScore: parseFloat(String(row.completenessScore ?? "0")),
      backlinks: backlinkMap.get(row.id.toString()) ?? 0,
      aliases: row.aliases ?? [],
      content: row.content,
      contentChars: visibleChars(row.content),
      updateBlocks: countUpdateBlocks(row.content),
      sectionCount: countSections(row.content),
      createTime: row.createTime.toISOString(),
      updateTime: row.updateTime.toISOString(),
    });
  }
  return map;
}

export function chooseCanonical(
  a: MergeCandidatePageMeta,
  b: MergeCandidatePageMeta
): [MergeCandidatePageMeta, MergeCandidatePageMeta] {
  const rankA = canonicalRank(a);
  const rankB = canonicalRank(b);
  if (rankA > rankB) return [a, b];
  if (rankB > rankA) return [b, a];
  return Number(a.id) < Number(b.id) ? [a, b] : [b, a];
}

function canonicalRank(page: MergeCandidatePageMeta): number {
  return (
    confidenceRank(page.confidence) * 100 +
    page.backlinks * 10 +
    page.completenessScore * 10 +
    page.aliases.length
  );
}

function confidenceRank(confidence: string): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function computePriority(
  canonical: MergeCandidatePageMeta,
  duplicate: MergeCandidatePageMeta,
  evidence: PairEvidence[],
  narrativeAssessment: {
    mergeMode: MergeMode;
    narrativeRisk: NarrativeRisk;
  }
): number {
  const evidenceScore = evidence.reduce((max, item) => Math.max(max, item.score), 0);
  const linkageScore = Math.min(canonical.backlinks + duplicate.backlinks, 20) / 4;
  const canonicalGap = Math.max(
    canonical.completenessScore - duplicate.completenessScore,
    0
  );
  const modePenalty =
    narrativeAssessment.mergeMode === "auto_merge"
      ? 0
      : narrativeAssessment.mergeMode === "structure_only"
        ? 1
        : 3;
  return Math.round((evidenceScore * 5 + linkageScore + canonicalGap - modePenalty) * 100) / 100;
}

function buildReasons(
  canonical: MergeCandidatePageMeta,
  duplicate: MergeCandidatePageMeta,
  evidence: PairEvidence[]
): string[] {
  const reasons: string[] = [];
  if (confidenceRank(canonical.confidence) > confidenceRank(duplicate.confidence)) {
    reasons.push(`canonical has higher confidence (${canonical.confidence} > ${duplicate.confidence})`);
  }
  if (canonical.backlinks !== duplicate.backlinks) {
    reasons.push(`canonical has more backlinks (${canonical.backlinks} vs ${duplicate.backlinks})`);
  }
  if (canonical.completenessScore > duplicate.completenessScore) {
    reasons.push(
      `canonical is more complete (${canonical.completenessScore.toFixed(2)} vs ${duplicate.completenessScore.toFixed(2)})`
    );
  }
  for (const item of evidence) {
    if (item.type === "duplicate_similarity") {
      reasons.push(`high title similarity (${item.score.toFixed(2)})`);
    } else if (item.type === "alias_conflict") {
      reasons.push(item.detail);
    }
  }
  return Array.from(new Set(reasons));
}

export function aliasOverlapScore(
  a: MergeCandidatePageMeta,
  b: MergeCandidatePageMeta
): number {
  const left = aliasSet(a);
  const right = aliasSet(b);
  let overlap = 0;
  for (const value of left) {
    if (right.has(value)) overlap++;
  }
  const denom = Math.max(left.size, right.size, 1);
  return overlap / denom;
}

export function narrativeOverlapScore(
  a: MergeCandidatePageMeta,
  b: MergeCandidatePageMeta
): number {
  const left = tokenSet(stripUpdatesSection(a.content));
  const right = tokenSet(stripUpdatesSection(b.content));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }
  return overlap / Math.max(Math.min(left.size, right.size), 1);
}

export function classifyNarrativeRisk(
  canonical: MergeCandidatePageMeta,
  duplicate: MergeCandidatePageMeta,
  overlapScore: number
): {
  mergeMode: MergeMode;
  narrativeRisk: NarrativeRisk;
  duplicateToCanonicalRatio: number;
  reasons: string[];
} {
  const duplicateChars = duplicate.contentChars;
  const canonicalChars = Math.max(canonical.contentChars, 1);
  const ratio = duplicateChars / canonicalChars;
  const reasons: string[] = [];

  if (duplicateChars === 0) {
    return {
      mergeMode: "auto_merge",
      narrativeRisk: "low",
      duplicateToCanonicalRatio: 0,
      reasons: ["duplicate has no meaningful narrative body"],
    };
  }

  if (
    duplicateChars > 8000 ||
    ratio > 1.1 ||
    (duplicate.sectionCount >= 8 && overlapScore < 0.45)
  ) {
    if (duplicateChars > 8000) reasons.push(`duplicate narrative is large (${duplicateChars} chars)`);
    if (ratio > 1.1) reasons.push(`duplicate is larger than canonical (ratio=${ratio.toFixed(2)})`);
    if (duplicate.sectionCount >= 8 && overlapScore < 0.45) reasons.push("duplicate looks like a standalone long-form page");
    return {
      mergeMode: "human_review",
      narrativeRisk: "high",
      duplicateToCanonicalRatio: Math.round(ratio * 100) / 100,
      reasons,
    };
  }

  if (
    duplicateChars > 2000 ||
    ratio > 0.6 ||
    duplicate.updateBlocks > 0 ||
    overlapScore < 0.35
  ) {
    if (duplicateChars > 2000) reasons.push(`duplicate narrative is medium/large (${duplicateChars} chars)`);
    if (ratio > 0.6) reasons.push(`duplicate is a large fraction of canonical (ratio=${ratio.toFixed(2)})`);
    if (duplicate.updateBlocks > 0) reasons.push(`duplicate already has ${duplicate.updateBlocks} update blocks`);
    if (overlapScore < 0.35) reasons.push(`narrative overlap is low (${overlapScore.toFixed(2)})`);
    return {
      mergeMode: "structure_only",
      narrativeRisk: "medium",
      duplicateToCanonicalRatio: Math.round(ratio * 100) / 100,
      reasons,
    };
  }

  reasons.push(`duplicate narrative is compact (${duplicateChars} chars)`);
  reasons.push(`narrative overlap is acceptable (${overlapScore.toFixed(2)})`);
  return {
    mergeMode: "auto_merge",
    narrativeRisk: "low",
    duplicateToCanonicalRatio: Math.round(ratio * 100) / 100,
    reasons,
  };
}

export function isLikelyDuplicateByNames(
  a: MergeCandidatePageMeta,
  b: MergeCandidatePageMeta,
  overlap: number
): boolean {
  if (overlap >= 0.3) return true;
  return normalizeEntityName(a.title) === normalizeEntityName(b.title);
}

function stripUpdatesSection(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  const idx = trimmed.indexOf("\n## Updates");
  return idx >= 0 ? trimmed.slice(0, idx).trim() : trimmed;
}

function visibleChars(content: string): number {
  return stripUpdatesSection(content)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, "$2")
    .replace(/\[\[([^[\]]+)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim().length;
}

function countUpdateBlocks(content: string): number {
  const matches = content.match(/^###\s+\d{4}-\d{2}-\d{2}/gm);
  return matches?.length ?? 0;
}

function countSections(content: string): number {
  const matches = stripUpdatesSection(content).match(/^##\s+/gm);
  return matches?.length ?? 0;
}

function tokenSet(content: string): Set<string> {
  return new Set(
    stripUpdatesSection(content)
      .toLowerCase()
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, "$2")
      .replace(/\[\[([^[\]]+)\]\]/g, "$1")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function normalizeEntityName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s._-]+/g, "")
    .replace(/holdings?|group|inc|corp|corporation|company|co|ltd|limited/g, "")
    .trim();
}

function aliasSet(page: MergeCandidatePageMeta): Set<string> {
  const values = [
    page.title,
    page.slug.split("/").slice(1).join("/"),
    ...page.aliases,
  ];
  return new Set(
    values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
}

function summarizePage(page: MergeCandidatePageMeta): MergeCandidateRow["canonical"] {
  return {
    pageId: page.id,
    slug: page.slug,
    title: page.title,
    type: page.type,
    confidence: page.confidence,
    completenessScore: page.completenessScore,
    backlinks: page.backlinks,
  };
}

function pairKey(aId: string, bId: string): string {
  return `${smaller(aId, bId)}::${larger(aId, bId)}`;
}

function smaller(a: string, b: string): string {
  return BigInt(a) < BigInt(b) ? a : b;
}

function larger(a: string, b: string): string {
  return BigInt(a) > BigInt(b) ? a : b;
}

function dedupeEvidence(items: PairEvidence[]): PairEvidence[] {
  const seen = new Set<string>();
  const out: PairEvidence[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => b.score - a.score);
}
