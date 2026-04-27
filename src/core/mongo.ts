import { MongoClient, type Collection, type Db } from "mongodb";
import { getEnv } from "./env.ts";

/** 上游 ResearchReportRecord 文档的 TS 类型（与示例 JSON 对齐）。 */
export interface ResearchReportRecord {
  _id: { $oid?: string } | string; // MongoDB ObjectId
  reportUrl: string;
  researchId: string;
  researchType: number;            // 见 architecture.md ResearchType 枚举
  createTime: Date;
  parseRetryCount: number;
  parseStatus: "pending" | "processing" | "completed" | "failed";
  title: string;
  updateTime: Date;
  parseLockedBy?: string | null;
  parseLockedUntil?: Date | null;
  parseStartedAt?: Date;
  parseSubStatus?: string | null;
  parseUpdatedAt?: Date;
  detectedFileType?: string;
  finalType?: string;
  convertedPdfS3?: string | null;
  parseCompletedAt?: Date;
  parseErrorMessage?: string | null;
  parsedContentListS3?: string | null;
  parsedImagesS3Prefix?: string | null;
  parsedLayoutPdfS3?: string | null;
  parsedMarkdownS3?: string | null;
  parsedS3Bucket?: string;
  orgCode?: string;
  tags?: string[];
}

let cachedClient: MongoClient | null = null;

export async function getMongoClient(): Promise<MongoClient> {
  if (cachedClient) return cachedClient;
  const env = getEnv();
  cachedClient = new MongoClient(env.MONGODB_URI);
  await cachedClient.connect();
  return cachedClient;
}

export async function getResearchCollection(): Promise<
  Collection<ResearchReportRecord>
> {
  const env = getEnv();
  const client = await getMongoClient();
  const db: Db = client.db(env.MONGODB_DB);
  return db.collection<ResearchReportRecord>(env.MONGODB_COLLECTION);
}

export async function closeMongo(): Promise<void> {
  if (cachedClient) {
    await cachedClient.close();
    cachedClient = null;
  }
}

/**
 * researchType 数字 → researchTypeName 映射。
 * 与上游 ResearchTypeEnum 对齐（见 architecture.md / fetch-reports skill 文档）。
 */
const RESEARCH_TYPE_NAMES: Record<number, string> = {
  1: "acecamp_article",
  2: "acecamp_opinion",
  3: "merit",
  4: "thirdbridge",
  5: "youtube",
  6: "trendforce",
  7: "r&research",
  8: "meeting_minutes",
  9: "research_report_file",
  10: "thirteen_d_report",
  11: "substack",
  12: "vital_knowledge",
  13: "transcript_task",
  14: "semi_analysis",
  15: "trytrata",
  16: "scuttleblurb",
  17: "bernstein_research",
  18: "aletheia",
  19: "chat_brilliant",
  20: "arete",
  21: "twitter",
};

export function researchTypeName(t: number): string {
  return RESEARCH_TYPE_NAMES[t] ?? `unknown_${t}`;
}
