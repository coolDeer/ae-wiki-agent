/**
 * 中文分词（jieba）
 *
 * 用途：把 markdown 内容切成空格分隔的 token 串，再喂给 PG `to_tsvector('simple', ...)`。
 * 这样 PG 端不用装 pg_jieba 扩展，所有切词在应用层完成、版本随 git push 走。
 *
 * 切词模式：
 *   - 索引（写 page）→ cutForSearch：更激进的子词拆分，提升召回
 *     例 "毛利率" → ["毛利","利率","毛利率"]
 *   - 查询（搜索）→ cut：精度模式，避免 query 过度拆分后 plainto_tsquery AND 太严
 *
 * 英文行为：jieba 看到连续 ASCII letter sequence 会保留整段，不切。
 *           中英混合句子里中文部分被分词，英文部分原样穿过。
 *
 * 词典扩展：默认用 jieba 内置词典。未来可以在初始化时调 `jieba.load(extraDict)`
 *           把 wiki 已有 company/industry slug+aliases 喂进去（见 TODO）。
 */

import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict.js";

let cached: Jieba | null = null;

function getJieba(): Jieba {
  if (cached) return cached;
  cached = Jieba.withDict(dict);
  // TODO: 从 DB pull 全部 companies/industries/persons 的 title+aliases，
  //       注册到 jieba 自定义词典，避免新公司名被切坏。
  //       触发时机：worker 启动 + 每次新建 entity page 后 hot-reload。
  return cached;
}

/**
 * 索引时切词：cutForSearch 模式（最大化召回）。
 * 输出空格分隔串，便于直接喂 to_tsvector。
 */
export function tokenizeForIndex(text: string): string {
  if (!text) return "";
  return getJieba()
    .cutForSearch(text)
    .filter((t) => t.trim().length > 0)
    .join(" ");
}

/**
 * 查询时切词：cut 模式（精度优先，避免 plainto_tsquery AND 太严）。
 */
export function tokenizeForQuery(text: string): string {
  if (!text) return "";
  return getJieba()
    .cut(text)
    .filter((t) => t.trim().length > 0)
    .join(" ");
}
