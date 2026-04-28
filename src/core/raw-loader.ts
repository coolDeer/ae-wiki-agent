/**
 * Raw markdown loader.
 *
 * raw_files 不再保存本地文件，按需从 markdown_url HTTP 拉取。
 * 同一 raw_file 在一次 ingest 流程里可能被读多次（peek + commit + finalize），
 * 用进程内 Map 做缓存，避免重复 fetch。
 */

import type { schema } from "~/core/db.ts";

type RawFileRow = Pick<
  typeof schema.rawFiles.$inferSelect,
  "id" | "markdownUrl"
>;

const cache = new Map<string, string>();

export async function fetchRawMarkdown(rf: RawFileRow): Promise<string> {
  const key = rf.id.toString();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const r = await fetch(rf.markdownUrl);
  if (!r.ok) {
    throw new Error(
      `fetch markdown_url 失败: raw_file #${rf.id} HTTP ${r.status} ${r.statusText}`
    );
  }
  const text = await r.text();
  cache.set(key, text);
  return text;
}
