/**
 * enrich skill
 *
 * 功能：把 Stage 4 自动创建的红链 entity（confidence='low'）补全成正式 wiki 页。
 *
 * 三段式（同 ingest 思想）：
 *   1. enrich:next   — 选下一个待补全 entity，附带所有 backlink source 的上下文
 *   2. agent 读 backlinks，按模板写 narrative + frontmatter
 *   3. enrich:save   — stdin 写 narrative，bump confidence，更新可选字段（ticker/sector/aliases）
 *
 * core 不调 LLM——所有 narrative 由 agent 在 skills/ae-enrich/SKILL.md 引导下生成。
 */

import { eq, and, count, desc, ne } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withAudit, withCreateAudit, Actor } from "~/core/audit.ts";
import type { PageType } from "~/core/schema/pages.ts";

export interface RedlinkContext {
  pageId: bigint;
  slug: string;
  type: string;
  title: string;
  ticker: string | null;
  /** 指向此 page 的 backlink 来源（source 页等）的简要信息 */
  backlinks: Array<{
    sourcePageId: bigint;
    sourceSlug: string;
    sourceTitle: string;
    sourceType: string;
    sourceDate: string | null;
  }>;
}

async function loadRedlinkContextByPageId(pageId: bigint): Promise<RedlinkContext | null> {
  const [target] = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      ticker: schema.pages.ticker,
      confidence: schema.pages.confidence,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, pageId), eq(schema.pages.deleted, 0)))
    .limit(1);

  if (!target) return null;
  if (target.type === "source") return null;
  if (target.confidence !== "low") return null;

  const backlinkSources = await db
    .select({
      pageId: schema.links.fromPageId,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      createTime: schema.pages.createTime,
    })
    .from(schema.links)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.links.fromPageId))
    .where(
      and(
        eq(schema.links.toPageId, target.id),
        eq(schema.links.deleted, 0),
        eq(schema.pages.deleted, 0)
      )
    )
    .orderBy(desc(schema.pages.createTime));

  return {
    pageId: target.id,
    slug: target.slug,
    type: target.type,
    title: target.title,
    ticker: target.ticker,
    backlinks: backlinkSources.map((b) => ({
      sourcePageId: b.pageId,
      sourceSlug: b.slug,
      sourceTitle: b.title,
      sourceType: b.type,
      sourceDate: b.createTime ? b.createTime.toISOString().slice(0, 10) : null,
    })),
  };
}

/**
 * 选下一个待 enrich 的红链 page，附带 backlink 上下文。
 *
 * 选择策略：
 *   1. confidence='low' 的 entity（Stage 4 自动建的就是 low）
 *   2. 优先 backlink 多的（被频繁提及说明值得补全）
 *   3. 排除 source 类型本身（source 不需要 enrich）
 */
export async function enrichPrepareNext(opts: {
  type?: PageType;
  /** 跳过 N 个，避免反复返回同一个（agent 跳过后想拿下一个） */
  skip?: number;
} = {}): Promise<RedlinkContext | null> {
  const skip = opts.skip ?? 0;

  // 找候选：confidence='low' 且非 source
  const candidates = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      ticker: schema.pages.ticker,
      backlinkCount: count(schema.links.id).as("backlink_count"),
    })
    .from(schema.pages)
    .leftJoin(
      schema.links,
      and(
        eq(schema.links.toPageId, schema.pages.id),
        eq(schema.links.deleted, 0)
      )
    )
    .where(
      and(
        eq(schema.pages.confidence, "low"),
        eq(schema.pages.deleted, 0),
        opts.type ? eq(schema.pages.type, opts.type) : undefined,
        opts.type ? undefined : ne(schema.pages.type, "source")
      )
    )
    .groupBy(schema.pages.id)
    .orderBy(desc(count(schema.links.id)), schema.pages.id)
    .limit(skip + 1)
    .offset(skip);

  const target = candidates[candidates.length - 1];
  if (!target || target.type === "source") return null;

  return loadRedlinkContextByPageId(target.id);
}

export async function enrichLoadContext(pageId: bigint): Promise<RedlinkContext | null> {
  return loadRedlinkContextByPageId(pageId);
}

export interface EnrichSaveOpts {
  /** 可选：直接更新 ticker 列 */
  ticker?: string;
  /** 可选：sector */
  sector?: string;
  /** 可选：sub_sector */
  subSector?: string;
  /** 可选：country */
  country?: string;
  /** 可选：exchange */
  exchange?: string;
  /**
   * 别名 merge（默认模式）。新值跟现有 aliases 合并、case-insensitive 去重。
   * 想"完全覆盖"时用 `aliasesReplace`，想"删指定项"时用 `aliasesRemove`。
   *
   * 同时传 `aliases` 和 `aliasesRemove` 等同于"删某些 + 加某些"，会按
   * `remove → add` 顺序应用。
   */
  aliases?: string[];
  /**
   * 显式完全覆盖现有 aliases。仅当确定要丢弃所有已有别名时用（少见，corrective）。
   * 与 `aliases` / `aliasesRemove` 互斥。
   */
  aliasesReplace?: string[];
  /** 从现有 aliases 移除（case-insensitive 匹配）。可与 `aliases` 组合。*/
  aliasesRemove?: string[];
  /** 可选：confidence（默认 'medium'，agent 充分调研可设 'high'）*/
  confidence?: "high" | "medium" | "low";
  /** 可选：frontmatter 合并（不动现有字段，仅补充）*/
  frontmatterMerge?: Record<string, unknown>;
}

/** Case-insensitive trim dedupe，保留首次出现顺序。*/
function dedupeCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * 保存 enrich 后的 narrative。
 *   - 写 page_versions 快照（reason='enrich'）
 *   - 更新 pages.content / content_hash
 *   - 更新可选字段（ticker / sector / aliases ...）
 *   - 默认 bump confidence 到 'medium'
 */
export async function enrichSave(
  pageId: bigint,
  narrative: string,
  opts: EnrichSaveOpts = {}
): Promise<void> {
  const actor = Actor.agentClaude;

  // Aliases 互斥校验：aliasesReplace 与 aliases / aliasesRemove 不能同时传
  if (
    opts.aliasesReplace !== undefined &&
    (opts.aliases !== undefined || opts.aliasesRemove !== undefined)
  ) {
    throw new Error(
      "enrich:save 参数冲突：--aliases-replace 与 --aliases / --aliases-remove 互斥。" +
        "Replace 是覆盖语义；merge / remove 是增量语义，不能混用。"
    );
  }

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(narrative);
  const contentHash = hasher.digest("hex");

  // 拿现有 frontmatter + aliases 做 merge
  const [existing] = await db
    .select({
      frontmatter: schema.pages.frontmatter,
      aliases: schema.pages.aliases,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);

  const mergedFrontmatter = {
    ...(existing?.frontmatter as Record<string, unknown> ?? {}),
    ...(opts.frontmatterMerge ?? {}),
  };

  // 计算最终 aliases（仅在 agent 显式传了任何 aliases-* 选项时才更新；否则不动）
  let nextAliases: string[] | undefined;
  let aliasesAction: string | null = null;
  if (opts.aliasesReplace !== undefined) {
    nextAliases = dedupeCaseInsensitive(opts.aliasesReplace);
    aliasesAction = "replace";
  } else if (opts.aliases !== undefined || opts.aliasesRemove !== undefined) {
    const existingArr = (existing?.aliases ?? []) as string[];
    const removeKeys = new Set(
      (opts.aliasesRemove ?? []).map((s) => s.trim().toLowerCase())
    );
    const filtered = existingArr.filter(
      (a) => !removeKeys.has(a.trim().toLowerCase())
    );
    const merged = [...filtered, ...(opts.aliases ?? [])];
    nextAliases = dedupeCaseInsensitive(merged);
    aliasesAction =
      opts.aliasesRemove && opts.aliases
        ? "remove+merge"
        : opts.aliasesRemove
          ? "remove"
          : "merge";
  }

  await db.insert(schema.pageVersions).values(
    withCreateAudit(
      {
        pageId,
        content: narrative,
        timeline: "",
        frontmatter: mergedFrontmatter,
        editedBy: actor,
        reason: "enrich",
      },
      actor
    )
  );

  // 构造 update set —— 只更新提供的字段
  const updateSet: Record<string, unknown> = {
    content: narrative,
    contentHash,
    confidence: opts.confidence ?? "medium",
    frontmatter: mergedFrontmatter,
  };
  if (opts.ticker !== undefined) updateSet.ticker = opts.ticker;
  if (opts.sector !== undefined) updateSet.sector = opts.sector;
  if (opts.subSector !== undefined) updateSet.subSector = opts.subSector;
  if (opts.country !== undefined) updateSet.country = opts.country;
  if (opts.exchange !== undefined) updateSet.exchange = opts.exchange;
  if (nextAliases !== undefined) updateSet.aliases = nextAliases;

  await db
    .update(schema.pages)
    .set(withAudit(updateSet, actor))
    .where(eq(schema.pages.id, pageId));

  // 写 event
  await db.insert(schema.events).values({
    actor,
    action: "enrich",
    entityType: "page",
    entityId: pageId,
    payload: {
      narrativeLen: narrative.length,
      confidence: opts.confidence ?? "medium",
      fieldsSet: Object.keys(opts).filter((k) => opts[k as keyof EnrichSaveOpts] !== undefined),
      aliasesAction,
      aliasesAfter: nextAliases ?? null,
    },
    createBy: actor,
    updateBy: actor,
  });

  const aliasLog =
    aliasesAction !== null && nextAliases !== undefined
      ? `, aliases ${aliasesAction} → [${nextAliases.slice(0, 5).join(", ")}${nextAliases.length > 5 ? `, +${nextAliases.length - 5}` : ""}]`
      : "";
  console.log(
    `[enrich:save] page #${pageId} narrative ${narrative.length} chars, confidence=${opts.confidence ?? "medium"}${aliasLog}`
  );
}

/**
 * Retype：把当前 page 的 type / slug 改成正确的 dir 前缀。
 *
 * 用例：Stage 4 红链按 wikilink dir 前缀建 page，agent 拼错 dir 时（如把
 * 芯片名 Trainium 写成 `[[companies/Trainium]]`）就会出现"错 type 的低质量
 * stub"。本函数让 enrich 流程的第一步可以把它纠正过来：
 *
 *   companies/Trainium  →  concepts/Trainium
 *   companies/SaaS Unit Economics  →  concepts/SaaS Unit Economics
 *   companies/北美零售业  →  industries/北美零售业
 *
 * 关键洞察：links / facts / signals / page_versions / raw_data 全部按
 * page_id 引用，slug 改名只需一行 UPDATE pages，没有 FK 级联问题。
 *
 * 限制：
 *   - 仅允许 retype 到 company / industry / concept / thesis 这 4 类
 *     可控实体；source / brief / output 不能通过 retype 创建（必须走
 *     ingest:commit / ingest:brief / daily-* 等显式入口）
 *   - 当前 page.type='source' / 'brief' 也不能 retype（强制走 promote）
 *   - 新 slug 不能与现有 active page 冲突
 */
const RETYPE_DIRS: Partial<Record<PageType, string>> = {
  company: "companies",
  industry: "industries",
  concept: "concepts",
  thesis: "theses",
};

const NON_RETYPABLE_TYPES: ReadonlySet<string> = new Set([
  "source",
  "brief",
  "output",
]);

export interface EnrichRetypeOpts {
  /** 目标 type（仅 company / industry / concept / thesis）*/
  newType: PageType;
  /** 完整新 slug 覆盖；不传则按规则只换 dir 前缀 */
  newSlug?: string;
  /** 写入 events.payload.reason，便于日后审计 */
  reason?: string;
}

export interface EnrichRetypeResult {
  pageId: bigint;
  oldSlug: string;
  oldType: string;
  newSlug: string;
  newType: PageType;
}

export async function enrichRetype(
  pageId: bigint,
  opts: EnrichRetypeOpts
): Promise<EnrichRetypeResult> {
  const actor = Actor.agentClaude;

  // 1) 校验新 type
  if (!(opts.newType in RETYPE_DIRS)) {
    throw new Error(
      `enrich:retype 不支持目标 type='${opts.newType}'。允许的 type: ` +
        Object.keys(RETYPE_DIRS).join(" / ") +
        "。source/brief/output 不能通过 retype 创建（必须走 ingest:commit / ingest:brief / daily-* 等显式入口）。"
    );
  }

  // 2) 取当前 page
  const [page] = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      sourceId: schema.pages.sourceId,
    })
    .from(schema.pages)
    .where(and(eq(schema.pages.id, pageId), eq(schema.pages.deleted, 0)))
    .limit(1);

  if (!page) {
    throw new Error(`page #${pageId} not found or already deleted`);
  }

  // 3) 不允许从 source/brief/output retype 走（这些要走 promote 或 skip）
  if (NON_RETYPABLE_TYPES.has(page.type)) {
    throw new Error(
      `page #${pageId} (type='${page.type}') 不能通过 retype 转换。` +
        `source ↔ brief 走 ingest:promote；output 不应被 retype。`
    );
  }

  // 4) 计算新 slug
  const oldSlug = page.slug;
  const oldType = page.type;
  const namePart = oldSlug.split("/").slice(1).join("/");
  if (!namePart) {
    throw new Error(`page #${pageId} slug='${oldSlug}' 无法解析 name 部分`);
  }
  const targetDir = RETYPE_DIRS[opts.newType]!;
  const computedNewSlug = opts.newSlug ?? `${targetDir}/${namePart}`;

  // 5) Noop 检查
  if (oldType === opts.newType && oldSlug === computedNewSlug) {
    throw new Error(
      `page #${pageId} 已经是 type='${opts.newType}' slug='${oldSlug}'，无需 retype`
    );
  }

  // 6) 校验新 slug 不与现有 active page 冲突（同 sourceId 内）
  const [conflict] = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.sourceId, page.sourceId),
        eq(schema.pages.slug, computedNewSlug),
        eq(schema.pages.deleted, 0)
      )
    )
    .limit(1);
  if (conflict && conflict.id !== pageId) {
    throw new Error(
      `slug 冲突：'${computedNewSlug}' 已存在 page #${conflict.id}（active）。` +
        `如果两条目应当合并，先 enrich:save 把当前 page 的内容并到目标 page，再 ingest:skip 当前。` +
        `或显式传 --new-slug 指定一个不冲突的名字。`
    );
  }

  // 7) UPDATE pages SET type, slug
  await db
    .update(schema.pages)
    .set(
      withAudit(
        { type: opts.newType, slug: computedNewSlug },
        actor
      )
    )
    .where(eq(schema.pages.id, pageId));

  // 8) Audit event
  await db.insert(schema.events).values(
    withCreateAudit(
      {
        actor,
        action: "retype",
        entityType: "page",
        entityId: pageId,
        payload: {
          from: { type: oldType, slug: oldSlug },
          to: { type: opts.newType, slug: computedNewSlug },
          reason: opts.reason ?? null,
        },
      },
      actor
    )
  );

  console.log(
    `[enrich:retype] page #${pageId}: ${oldType}/${oldSlug} → ${opts.newType}/${computedNewSlug}`
  );

  return {
    pageId,
    oldSlug,
    oldType,
    newSlug: computedNewSlug,
    newType: opts.newType,
  };
}

/** 列举待 enrich 的 page（dashboard 用）*/
export async function enrichList(opts: {
  type?: PageType;
  limit?: number;
} = {}): Promise<Array<{
  pageId: bigint;
  slug: string;
  type: string;
  title: string;
  backlinkCount: number;
}>> {
  const rows = await db
    .select({
      pageId: schema.pages.id,
      slug: schema.pages.slug,
      type: schema.pages.type,
      title: schema.pages.title,
      backlinkCount: count(schema.links.id).as("backlink_count"),
    })
    .from(schema.pages)
    .leftJoin(
      schema.links,
      and(
        eq(schema.links.toPageId, schema.pages.id),
        eq(schema.links.deleted, 0)
      )
    )
    .where(
      and(
        eq(schema.pages.confidence, "low"),
        eq(schema.pages.deleted, 0),
        opts.type ? eq(schema.pages.type, opts.type) : undefined
      )
    )
    .groupBy(schema.pages.id)
    .orderBy(desc(count(schema.links.id)), schema.pages.id)
    .limit(opts.limit ?? 20);

  return rows.map((r) => ({
    pageId: r.pageId,
    slug: r.slug,
    type: r.type,
    title: r.title,
    backlinkCount: Number(r.backlinkCount),
  }));
}
