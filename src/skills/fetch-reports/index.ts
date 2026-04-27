/**
 * fetch-reports skill
 *
 * 从上游 MongoDB ResearchReportRecord 集合拉取已解析完成的研究报告，
 * 下载 parsedMarkdownS3 内容到 raw/ 目录，并登记到 raw_files 表。
 *
 * 去重：靠 raw_files.research_id UNIQUE 约束（INSERT ... ON CONFLICT DO NOTHING）。
 *
 * 详细流程见 doc/architecture.md §4.1 Stage 0 / §6.2 fetch-reports。
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { getEnv } from "~/core/env.ts";
import { closeMongo, getResearchCollection, researchTypeName } from "~/core/mongo.ts";
import { Actor } from "~/core/audit.ts";

interface FetchReportsOptions {
  /** 限制本次最多拉取多少条（用于测试 / 限流）。 */
  limit?: number;
  /** 仅 dry-run，不下载、不写表。 */
  dryRun?: boolean;
}

interface FetchReportsResult {
  scanned: number;
  inserted: number;
  skippedExisting: number;
  skippedNoMd: number;
  failed: number;
}

export async function fetchReports(
  opts: FetchReportsOptions = {}
): Promise<FetchReportsResult> {
  const env = getEnv();
  const result: FetchReportsResult = {
    scanned: 0,
    inserted: 0,
    skippedExisting: 0,
    skippedNoMd: 0,
    failed: 0,
  };

  const coll = await getResearchCollection();
  const cursor = coll
    .find({
      parseStatus: "completed",
      parsedMarkdownS3: { $ne: null },
    })
    .sort({ createTime: -1 });
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
      // 1. 下载 markdown
      const md = await fetch(doc.parsedMarkdownS3).then((r) => r.text());

      // 2. 落 raw/ 文件
      const date = doc.createTime.toISOString().slice(0, 10);
      const type = researchTypeName(doc.researchType);
      const fileName = `${doc.researchId}_${getOidStr(doc._id)}.md`;
      const rawPathRel = path.join("raw", date, type, fileName);
      const rawPathAbs = path.resolve(env.WORKSPACE_DIR, rawPathRel);

      if (!opts.dryRun) {
        await mkdir(path.dirname(rawPathAbs), { recursive: true });
        await writeFile(rawPathAbs, md);
      }

      // 3. 登记 raw_files
      if (!opts.dryRun) {
        await db
          .insert(schema.rawFiles)
          .values({
            sourceId: "default",
            rawPath: rawPathRel,
            researchId: doc.researchId,
            researchType: type,
            orgCode: doc.orgCode ?? null,
            title: doc.title,
            tags: doc.tags ?? [],
            mongoDoc: doc as unknown as Record<string, unknown>,
            parseStatus: doc.parseStatus,
            createBy: Actor.systemFetch,
            updateBy: Actor.systemFetch,
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

function getOidStr(oid: { $oid?: string } | string | unknown): string {
  if (typeof oid === "string") return oid;
  if (oid && typeof oid === "object" && "$oid" in oid && typeof oid.$oid === "string") {
    return oid.$oid;
  }
  // ObjectId.toString() 兜底
  return String(oid);
}
