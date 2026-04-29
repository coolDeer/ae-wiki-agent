/**
 * fetch-reports skill
 *
 * 从上游 MongoDB ResearchReportRecord 集合同步元数据 + S3 markdown URL 到
 * raw_files 表。**不下载正文**——ingest 阶段按需 HTTP fetch。
 *
 * 去重：靠 raw_files.research_id partial unique index（INSERT ... ON CONFLICT DO NOTHING）。
 *
 * 详细流程见 doc/architecture.md §4.1 Stage 0 / §6.2 fetch-reports。
 */

import { sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { closeMongo, getResearchCollection, researchTypeName } from "~/core/mongo.ts";
import { Actor } from "~/core/audit.ts";

interface FetchReportsOptions {
  /** 限制本次最多拉取多少条（用于测试 / 限流）。 */
  limit?: number;
  /** 仅 dry-run，不写表。 */
  dryRun?: boolean;
  /** 指定日期 YYYY-MM-DD（按本地时区解释）；不传 + 不带 all 时默认昨天。 */
  date?: string;
  /** 显式跳过日期过滤，回到旧的"全量未同步"行为（补抓 / 历史 backfill 用）。 */
  all?: boolean;
}

interface FetchReportsResult {
  scanned: number;
  inserted: number;
  skippedExisting: number;
  skippedNoMd: number;
  failed: number;
  dateRange: { start: string; end: string } | null;
}

/** YYYY-MM-DD（本地时区）→ [start, nextDayStart) 的 [start, end) 区间。 */
function resolveDateRange(opts: FetchReportsOptions): { start: Date; end: Date } | null {
  if (opts.all) return null;
  let start: Date;
  if (opts.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(opts.date);
    if (!m) throw new Error(`无效日期: ${opts.date}（期望 YYYY-MM-DD）`);
    start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    // 默认昨天（本地时区）
    start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export async function fetchReports(
  opts: FetchReportsOptions = {}
): Promise<FetchReportsResult> {
  const range = resolveDateRange(opts);
  const result: FetchReportsResult = {
    scanned: 0,
    inserted: 0,
    skippedExisting: 0,
    skippedNoMd: 0,
    failed: 0,
    dateRange: range
      ? { start: range.start.toISOString(), end: range.end.toISOString() }
      : null,
  };

  if (range) {
    console.log(
      `[fetch-reports] 过滤 createTime ∈ [${range.start.toISOString()}, ${range.end.toISOString()})`
    );
  } else {
    console.log("[fetch-reports] 全量模式（--all），跳过日期过滤");
  }

  const coll = await getResearchCollection();
  const filter: Record<string, unknown> = {
    parseStatus: "completed",
    parsedMarkdownS3: { $ne: null },
  };
  if (range) {
    filter.createTime = { $gte: range.start, $lt: range.end };
  }
  const cursor = coll.find(filter).sort({ createTime: -1 });
  if (opts.limit) cursor.limit(opts.limit);

  for await (const doc of cursor) {
    result.scanned++;

    if (!doc.parsedMarkdownS3) {
      result.skippedNoMd++;
      continue;
    }

    // 去重：靠 research_id UNIQUE
    const existing = await db
      .select({ id: schema.rawFiles.id })
      .from(schema.rawFiles)
      .where(drizzleSql`${schema.rawFiles.researchId} = ${doc.researchId}`)
      .limit(1);
    if (existing.length > 0) {
      result.skippedExisting++;
      continue;
    }

    try {
      const type = researchTypeName(doc.researchType);

      if (!opts.dryRun) {
        await db
          .insert(schema.rawFiles)
          .values({
            sourceId: "default",
            markdownUrl: doc.parsedMarkdownS3,
            parsedContentListV2Url: doc.parsedContentListV2S3 ?? null,
            researchId: doc.researchId,
            researchType: type,
            orgCode: doc.orgCode ?? null,
            title: doc.title,
            tags: doc.tags ?? [],
            mongoDoc: doc as unknown as Record<string, unknown>,
            parseStatus: doc.parseStatus,
            createBy: Actor.systemFetch,
            updateBy: Actor.systemFetch,
            // 镜像上游 mongo 时间戳，而不是用 DB defaultNow()——
            // create_time 表示"上游报告原始创建时间"，update_time 表示"上游最后修改时间"。
            createTime: doc.createTime,
            updateTime: doc.updateTime,
          })
          .onConflictDoNothing({
            target: schema.rawFiles.researchId,
            // partial unique index: uq_raw_files_research_id
            where: drizzleSql`deleted = 0 AND research_id IS NOT NULL`,
          });
      }

      result.inserted++;
      console.log(`✓ ${type}/${doc.title}`);
    } catch (e) {
      result.failed++;
      console.error(`✗ ${doc.researchId}: ${(e as Error).message}`);
    }
  }

  await closeMongo();
  return result;
}
