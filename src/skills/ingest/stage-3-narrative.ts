/**
 * Stage 3: 落地 narrative
 *
 * 职责：把外部（agent / skill）传入的 narrative 写到 page.content + page_versions。
 *
 * 不调任何 LLM——"理解原文"是 agent 层（research-ingest skill）的职责。
 * core 只做确定性落库 + content_hash 摘要 + 快照版本 + frontmatter 合并。
 *
 * 调用入口：`ingestWriteNarrative(pageId, narrative)`（见 src/skills/ingest/index.ts）
 */

import { eq } from "drizzle-orm";
import matter from "gray-matter";
import { db, schema } from "~/core/db.ts";
import { withAudit, withCreateAudit } from "~/core/audit.ts";
import { splitBody } from "~/core/markdown.ts";

export async function stage3WriteNarrative(
  pageId: bigint,
  narrative: string,
  actor: string
): Promise<void> {
  // 解析 narrative 顶部的 YAML frontmatter（如有），merge 到 pages.frontmatter
  // gray-matter 容错：没有 frontmatter 时 data={} content=原文
  const parsed = matter(narrative);
  const narrativeFrontmatter = parsed.data ?? {};
  const { compiledTruth, timeline } = splitBody(parsed.content);

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(narrative);
  const contentHash = hasher.digest("hex");

  await db.insert(schema.pageVersions).values(
    withCreateAudit(
      {
        pageId,
        content: compiledTruth,
        timeline,
        frontmatter: narrativeFrontmatter,
        editedBy: actor,
        reason: "ingest",
      },
      actor
    )
  );

  // pages.frontmatter 已有 stage1 写入的字段（research_id / markdown_url 等），
  // narrative frontmatter 用 jsonb || 合并（narrative 优先覆盖同名 key）
  const [existing] = await db
    .select({ frontmatter: schema.pages.frontmatter })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);
  const mergedFrontmatter = {
    ...((existing?.frontmatter as Record<string, unknown>) ?? {}),
    ...narrativeFrontmatter,
  };

  const updateSet: Record<string, unknown> = {
    content: compiledTruth,
    timeline,
    contentHash,
    frontmatter: mergedFrontmatter,
  };

  await db
    .update(schema.pages)
    .set(withAudit(updateSet, actor))
    .where(eq(schema.pages.id, pageId));

  console.log(
    `  [stage3] narrative ${narrative.length} chars saved` +
      (timeline.trim().length > 0 ? `, timeline ${timeline.length} chars` : "") +
      (Object.keys(narrativeFrontmatter).length > 0
        ? `, frontmatter keys: ${Object.keys(narrativeFrontmatter).join(",")}`
        : "") +
      `)`
  );
}

/**
 * Stage 3 增量模式：追加 dated update block，不覆盖已有 narrative。
 *
 * 用例：enrich 一个已 enriched 过的 entity 页，新信息进来要保留旧观点轨迹
 * （投资 thesis 演化是核心知识资产，「3 月看好 → 4 月质疑 → 5 月 unwind」
 * 比单一最新观点有价值得多）。
 *
 * 行为：
 *   1. 读现有 content
 *   2. 若空（< minBodyChars）→ 退化为 stage3WriteNarrative（首次写）
 *   3. 否则把 newContent 包成 `### YYYY-MM-DD\n\n{newContent}` 块，
 *      追加到 `## Updates` 段下（不存在则一并创建该段）
 *   4. snapshot 到 page_versions reason='enrich:append'
 *
 * 注意：append 模式 **不解析 frontmatter**——agent 传进来的是 delta body，
 * 不应再写 YAML frontmatter（首次 enrich 才写）。
 */
const APPEND_MIN_BODY_CHARS = 200;
const UPDATES_HEADING = "## Updates";

export interface AppendOptions {
  /** 关联 source slug（如 sources/aletheia-xxx）。会作为 update 块标题的 (per [[X]]) 标注。 */
  sourceSlug?: string;
  /** 自定义日期；默认 today（YYYY-MM-DD）。便于测试。 */
  date?: string;
  /** 触发原因（events.payload.reason）。默认 'enrich:append'。 */
  reason?: string;
}

export async function stage3AppendNarrative(
  pageId: bigint,
  newContent: string,
  actor: string,
  opts: AppendOptions = {}
): Promise<{ mode: "append" | "write_initial" }> {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const reason = opts.reason ?? "enrich:append";

  const [existing] = await db
    .select({ content: schema.pages.content, frontmatter: schema.pages.frontmatter })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);
  if (!existing) throw new Error(`page #${pageId} not found`);

  const trimmedExisting = (existing.content ?? "").trim();

  // 内容空 / 非常短 → 退化为首次完整写入。snapshot reason 用 opts.reason
  // （append 调用方的语义），不写死 'ingest'。
  if (trimmedExisting.length < APPEND_MIN_BODY_CHARS) {
    console.log(
      `  [stage3:append] page #${pageId} body < ${APPEND_MIN_BODY_CHARS} chars, falling through to write_initial (reason=${reason})`
    );
    const initialHasher = new Bun.CryptoHasher("sha256");
    initialHasher.update(newContent);
    const initialHash = initialHasher.digest("hex");

    await db.insert(schema.pageVersions).values(
      withCreateAudit(
        {
          pageId,
          content: newContent,
          timeline: "",
          frontmatter: {},
          editedBy: actor,
          reason,
        },
        actor
      )
    );
    await db
      .update(schema.pages)
      .set(withAudit({ content: newContent, contentHash: initialHash }, actor))
      .where(eq(schema.pages.id, pageId));
    return { mode: "write_initial" };
  }

  const sourceTag = opts.sourceSlug ? ` (per [[${opts.sourceSlug}]])` : "";
  const updateBlock = `### ${date}${sourceTag}\n\n${newContent.trim()}`;

  // Updates 段已存在 → 块直接追加；否则建段
  const merged = trimmedExisting.includes(`\n${UPDATES_HEADING}`)
    ? `${trimmedExisting}\n\n${updateBlock}\n`
    : `${trimmedExisting}\n\n${UPDATES_HEADING}\n\n${updateBlock}\n`;

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(merged);
  const contentHash = hasher.digest("hex");

  await db.insert(schema.pageVersions).values(
    withCreateAudit(
      {
        pageId,
        content: merged,
        timeline: "", // append 不动 timeline；agent 想加结构化 event 走 timeline_entries 表
        frontmatter: {},
        editedBy: actor,
        reason,
      },
      actor
    )
  );

  await db
    .update(schema.pages)
    .set(
      withAudit(
        {
          content: merged,
          contentHash,
        },
        actor
      )
    )
    .where(eq(schema.pages.id, pageId));

  console.log(
    `  [stage3:append] page #${pageId} appended ${newContent.length} chars (date=${date}${opts.sourceSlug ? `, source=${opts.sourceSlug}` : ""})`
  );
  return { mode: "append" };
}
