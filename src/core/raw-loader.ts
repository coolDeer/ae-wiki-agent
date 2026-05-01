/**
 * Raw payload loaders.
 *
 * raw_files 不再保存本地文件，按需从 markdown_url / parsed_content_list_v2_url
 * 拉取。同一 raw_file 在一次 ingest 流程里可能被读多次（peek + commit + finalize），
 * 用进程内 Map 做缓存，避免重复 fetch。
 *
 * **Cache key 必须用 URL 而非 raw_file.id**：因为 reset-database.mjs `RESTART IDENTITY`
 * 会让 raw_file id 重新从 1 开始，但 supervisor/worker 进程不会重启——如果用 id 当 key，
 * 老进程会把 id=N 的 cache 命中给重置后的新 raw_file（即便 markdown 完全不同），
 * 导致 agent 看到错内容生成错 narrative。事故案例：reset 后 rf#10 是 SOI 衬底报告，
 * 但 supervisor cache 还存着 reset 前 rf#10 的 hog farming markdown，agent 拿到 hog
 * 内容写成了 hog narrative 落到 SOI page 上。
 */

import type { schema } from "~/core/db.ts";
import type { V2ContentList } from "~/core/chunkers/v2-block.ts";

type RawFileRow = Pick<
  typeof schema.rawFiles.$inferSelect,
  "id" | "markdownUrl"
>;

type RawFileV2Row = Pick<
  typeof schema.rawFiles.$inferSelect,
  "id" | "parsedContentListV2Url"
>;

// URL → fetched body。S3 URL 含 mongo doc_id + parse timestamp，是真正的 content identity。
const markdownCache = new Map<string, string>();
const v2Cache = new Map<string, V2ContentList | null>();

export async function fetchRawMarkdown(rf: RawFileRow): Promise<string> {
  const key = rf.markdownUrl;
  const hit = markdownCache.get(key);
  if (hit !== undefined) return hit;

  const r = await fetch(rf.markdownUrl);
  if (!r.ok) {
    throw new Error(
      `fetch markdown_url 失败: raw_file #${rf.id} HTTP ${r.status} ${r.statusText}`
    );
  }
  const text = await r.text();
  markdownCache.set(key, text);
  return text;
}

/**
 * 拉 mineru V2 content_list。URL 缺失时返回 null（不算错误：老 raw_file 没有 V2）。
 * 解析失败也返回 null 并 console.warn——chunker 会自动回退 markdown。
 */
export async function fetchContentListV2(
  rf: RawFileV2Row
): Promise<V2ContentList | null> {
  // Cache key 同 markdown：用 URL，避免 RESTART IDENTITY 后老 cache 错配
  if (!rf.parsedContentListV2Url) return null;
  const key = rf.parsedContentListV2Url;
  if (v2Cache.has(key)) return v2Cache.get(key) ?? null;

  try {
    const r = await fetch(rf.parsedContentListV2Url);
    if (!r.ok) {
      console.warn(
        `[raw-loader] fetch content_list_v2 失败: raw_file #${rf.id} HTTP ${r.status} ${r.statusText}`
      );
      v2Cache.set(key, null);
      return null;
    }
    const json = (await r.json()) as unknown;
    if (!Array.isArray(json)) {
      console.warn(
        `[raw-loader] content_list_v2 顶层非数组: raw_file #${rf.id}（回退 markdown）`
      );
      v2Cache.set(key, null);
      return null;
    }
    v2Cache.set(key, json as V2ContentList);
    return json as V2ContentList;
  } catch (e) {
    console.warn(
      `[raw-loader] content_list_v2 解析异常: raw_file #${rf.id}: ${(e as Error).message}（回退 markdown）`
    );
    v2Cache.set(key, null);
    return null;
  }
}
