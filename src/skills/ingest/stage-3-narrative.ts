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

  // 特殊处理：narrative frontmatter 里的 title 同步到 pages.title 列（白名单字段）。
  // 见 skills/ae-research-ingest/SKILL.md 的 "Frontmatter 字段白名单" 段。
  // 只在 agent 显式写了非空字符串时覆盖，否则保留 stage-1 从 raw_files 拷的原值。
  const fmTitle = narrativeFrontmatter.title;
  const titleOverride =
    typeof fmTitle === "string" && fmTitle.trim().length > 0
      ? fmTitle.trim()
      : undefined;

  const updateSet: Record<string, unknown> = {
    content: compiledTruth,
    timeline,
    contentHash,
    frontmatter: mergedFrontmatter,
  };
  if (titleOverride !== undefined) updateSet.title = titleOverride;

  await db
    .update(schema.pages)
    .set(withAudit(updateSet, actor))
    .where(eq(schema.pages.id, pageId));

  console.log(
    `  [stage3] narrative ${narrative.length} chars saved` +
      (timeline.trim().length > 0 ? `, timeline ${timeline.length} chars` : "") +
      (titleOverride !== undefined
        ? `, title overridden to "${titleOverride.slice(0, 60)}${titleOverride.length > 60 ? "..." : ""}"`
        : "") +
      (Object.keys(narrativeFrontmatter).length > 0
        ? `, frontmatter keys: ${Object.keys(narrativeFrontmatter).join(",")}`
        : "") +
      `)`
  );
}
