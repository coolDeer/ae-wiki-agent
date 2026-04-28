/**
 * thesis-track skill
 *
 * 投资论点状态机的 core 操作。Skill markdown 教 agent 何时调用。
 *
 * 操作：
 *   - thesisOpen        建一个新论点（pages + theses 双 row 事务）
 *   - thesisWrite       agent 写完 narrative 后落库（同 ingest:write）
 *   - thesisUpdate      仅状态字段变更（conviction / status / catalysts / validation_conditions）
 *   - thesisClose       归档（status=closed/invalidated + 退出价 + 写 retrospective 注解）
 *   - thesisList        列论点（按 status 过滤）
 *   - thesisShow        诊断：拿一个论点 + 关联 signals + target entity 当前 facts
 */

import { eq, and, desc, inArray, sql as drizzleSql } from "drizzle-orm";
import { db, schema } from "~/core/db.ts";
import { withAudit, withCreateAudit, Actor } from "~/core/audit.ts";

export type ThesisDirection = "long" | "short" | "pair" | "neutral";
export type ThesisConviction = "high" | "medium" | "low";
export type ThesisStatus = "active" | "monitoring" | "closed" | "invalidated";

export interface CatalystItem {
  date: string;            // YYYY-MM-DD
  event: string;           // "Q1 earnings" / "FDA decision" / ...
  expected_impact: string; // 自由文本
}

export interface ValidationCondition {
  condition: string;
  status: "pending" | "met" | "unmet" | "invalidated";
  last_checked: string;    // YYYY-MM-DD
  evidence_signal_id?: string;
}

// ============================================================================
// open
// ============================================================================

export interface ThesisOpenOpts {
  /** 标的 page slug，如 'companies/NVIDIA' */
  targetSlug: string;
  direction: ThesisDirection;
  conviction?: ThesisConviction;     // 默认 'medium'
  status?: ThesisStatus;             // 默认 'active'
  /** Thesis title, preferably English, used to generate the slug. */
  name: string;
  dateOpened?: string;               // YYYY-MM-DD，默认今天
  priceAtOpen?: string;
  pmOwner?: string;
  catalysts?: CatalystItem[];
  validationConditions?: ValidationCondition[];
}

export interface ThesisOpenResult {
  pageId: bigint;
  slug: string;
  targetPageId: bigint;
}

export async function thesisOpen(opts: ThesisOpenOpts): Promise<ThesisOpenResult> {
  // 解析 target
  const [target] = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.slug, opts.targetSlug),
        eq(schema.pages.deleted, 0)
      )
    )
    .limit(1);
  if (!target) {
    throw new Error(`target page 不存在：${opts.targetSlug}（先建 entity 或 enrich 它）`);
  }

  const today = opts.dateOpened ?? new Date().toISOString().slice(0, 10);
  const slug = `theses/${slugify(opts.name)}`;
  const actor = Actor.agentClaude;

  // 事务：pages + theses
  const result = await db.transaction(async (tx) => {
    // 1. 建 pages 行
    const [page] = await tx
      .insert(schema.pages)
      .values(
        withCreateAudit(
          {
            sourceId: "default",
            slug,
            type: "thesis" as const,
            title: opts.name,
            status: "active",
            confidence: "medium",
            frontmatter: {
              direction: opts.direction,
              conviction: opts.conviction ?? "medium",
              target: opts.targetSlug,
              date_opened: today,
            },
          },
          actor
        )
      )
      .returning({ id: schema.pages.id });
    if (!page) throw new Error("pages insert empty");

    // 2. 建 theses 行
    await tx.insert(schema.theses).values(
      withCreateAudit(
        {
          pageId: page.id,
          targetPageId: target.id,
          direction: opts.direction,
          conviction: opts.conviction ?? "medium",
          status: opts.status ?? "active",
          dateOpened: today,
          priceAtOpen: opts.priceAtOpen,
          catalysts: opts.catalysts ?? [],
          validationConditions: opts.validationConditions ?? [],
          pmOwner: opts.pmOwner,
        },
        actor
      )
    );

    // 3. 写一条 events
    await tx.insert(schema.events).values({
      actor,
      action: "thesis_open",
      entityType: "thesis",
      entityId: page.id,
      payload: {
        target: opts.targetSlug,
        direction: opts.direction,
        conviction: opts.conviction ?? "medium",
        name: opts.name,
      },
      createBy: actor,
      updateBy: actor,
    });

    // 4. 自动建 thesis → target 的 link（让 backlink 能通）
    await tx
      .insert(schema.links)
      .values(
        withCreateAudit(
          {
            fromPageId: page.id,
            toPageId: target.id,
            linkType: "mention",
            linkSource: "manual",
            originPageId: page.id,
          },
          actor
        )
      )
      .onConflictDoNothing();

    return { pageId: page.id, slug, targetPageId: target.id };
  });

  console.log(
    `[thesis:open] page #${result.pageId} (${slug}) → ${opts.targetSlug} ${opts.direction} ${opts.conviction ?? "medium"}`
  );
  return result;
}

// ============================================================================
// write — agent 写完 narrative 后落库（同 enrich:save 的简化版）
// ============================================================================

export async function thesisWrite(pageId: bigint, narrative: string): Promise<void> {
  const actor = Actor.agentClaude;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(narrative);
  const contentHash = hasher.digest("hex");

  await db.insert(schema.pageVersions).values(
    withCreateAudit(
      {
        pageId,
        content: narrative,
        timeline: "",
        frontmatter: {},
        editedBy: actor,
        reason: "thesis_open",
      },
      actor
    )
  );

  await db
    .update(schema.pages)
    .set(withAudit({ content: narrative, contentHash }, actor))
    .where(eq(schema.pages.id, pageId));

  console.log(`[thesis:write] page #${pageId} narrative ${narrative.length} chars`);
}

// ============================================================================
// update — 状态字段变更（不动 narrative）
// ============================================================================

export interface ThesisUpdateOpts {
  conviction?: ThesisConviction;
  status?: ThesisStatus;
  /** append 一个新催化剂（不覆盖现有） */
  addCatalyst?: CatalystItem;
  /** 更新某个 validation condition 的状态 */
  markCondition?: { condition: string; status: ValidationCondition["status"]; evidence_signal_id?: string };
  pmOwner?: string;
  reason?: string;  // 写到 events.payload，便于审计
}

export async function thesisUpdate(
  pageId: bigint,
  opts: ThesisUpdateOpts
): Promise<void> {
  const actor = Actor.agentClaude;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.theses)
      .where(eq(schema.theses.pageId, pageId))
      .limit(1);
    if (!existing) throw new Error(`thesis #${pageId} 不存在`);

    const updates: Record<string, unknown> = {};
    if (opts.conviction !== undefined) updates.conviction = opts.conviction;
    if (opts.status !== undefined) updates.status = opts.status;
    if (opts.pmOwner !== undefined) updates.pmOwner = opts.pmOwner;

    // 处理 catalysts append
    if (opts.addCatalyst) {
      const current = (existing.catalysts as CatalystItem[]) ?? [];
      updates.catalysts = [...current, opts.addCatalyst];
    }

    // 处理 validation condition 状态更新
    if (opts.markCondition) {
      const conds = (existing.validationConditions as ValidationCondition[]) ?? [];
      const today = new Date().toISOString().slice(0, 10);
      const updated = conds.map((c) =>
        c.condition === opts.markCondition!.condition
          ? {
              ...c,
              status: opts.markCondition!.status,
              last_checked: today,
              ...(opts.markCondition!.evidence_signal_id
                ? { evidence_signal_id: opts.markCondition!.evidence_signal_id }
                : {}),
            }
          : c
      );
      // 如果 condition 不存在则 append
      if (!conds.some((c) => c.condition === opts.markCondition!.condition)) {
        updated.push({
          condition: opts.markCondition.condition,
          status: opts.markCondition.status,
          last_checked: today,
          ...(opts.markCondition.evidence_signal_id
            ? { evidence_signal_id: opts.markCondition.evidence_signal_id }
            : {}),
        });
      }
      updates.validationConditions = updated;
    }

    if (Object.keys(updates).length === 0) {
      console.log(`[thesis:update] #${pageId} 无字段变更`);
      return;
    }

    await tx
      .update(schema.theses)
      .set(withAudit(updates, actor))
      .where(eq(schema.theses.pageId, pageId));

    await tx.insert(schema.events).values({
      actor,
      action: "thesis_update",
      entityType: "thesis",
      entityId: pageId,
      payload: { ...opts, reason: opts.reason },
      createBy: actor,
      updateBy: actor,
    });
  });

  console.log(`[thesis:update] #${pageId} updated`);
}

// ============================================================================
// close
// ============================================================================

export async function thesisClose(
  pageId: bigint,
  opts: {
    reason: "validated" | "invalidated" | "stop_loss" | "manual";
    priceAtClose?: string;
    dateClosed?: string;
    note?: string;  // 可选：附 retrospective 段加到 narrative 末尾
  }
): Promise<void> {
  const actor = Actor.agentClaude;
  const today = opts.dateClosed ?? new Date().toISOString().slice(0, 10);
  const status: ThesisStatus =
    opts.reason === "invalidated" ? "invalidated" : "closed";

  await db.transaction(async (tx) => {
    await tx
      .update(schema.theses)
      .set(
        withAudit(
          {
            status,
            dateClosed: today,
            priceAtClose: opts.priceAtClose,
          },
          actor
        )
      )
      .where(eq(schema.theses.pageId, pageId));

    if (opts.note) {
      // 把 retrospective 注解 append 到 page.content
      const [page] = await tx
        .select({ content: schema.pages.content })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId))
        .limit(1);
      const newContent =
        (page?.content ?? "") +
        `\n\n## Retrospective（${today}，原因：${opts.reason}）\n\n${opts.note}\n`;
      await tx
        .update(schema.pages)
        .set(withAudit({ content: newContent }, actor))
        .where(eq(schema.pages.id, pageId));
    }

    await tx.insert(schema.events).values({
      actor,
      action: "thesis_close",
      entityType: "thesis",
      entityId: pageId,
      payload: { reason: opts.reason, priceAtClose: opts.priceAtClose, dateClosed: today },
      createBy: actor,
      updateBy: actor,
    });
  });

  console.log(`[thesis:close] #${pageId} → ${status} (${opts.reason})`);
}

// ============================================================================
// list / show
// ============================================================================

export async function thesisList(opts: {
  status?: ThesisStatus;
  direction?: ThesisDirection;
  limit?: number;
} = {}): Promise<Array<{
  pageId: bigint;
  slug: string;
  title: string;
  targetSlug: string;
  direction: string;
  conviction: string | null;
  status: string;
  dateOpened: string | null;
}>> {
  const targetAlias = drizzleSql`tgt`;
  const rows = await db
    .select({
      pageId: schema.theses.pageId,
      slug: schema.pages.slug,
      title: schema.pages.title,
      direction: schema.theses.direction,
      conviction: schema.theses.conviction,
      status: schema.theses.status,
      dateOpened: schema.theses.dateOpened,
      targetPageId: schema.theses.targetPageId,
    })
    .from(schema.theses)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.theses.pageId))
    .where(
      and(
        eq(schema.theses.deleted, 0),
        opts.status ? eq(schema.theses.status, opts.status) : undefined,
        opts.direction ? eq(schema.theses.direction, opts.direction) : undefined
      )
    )
    .orderBy(desc(schema.theses.dateOpened))
    .limit(opts.limit ?? 50);

  // 拿 target slug
  const targetIds = [...new Set(rows.map((r) => r.targetPageId))];
  const targets = targetIds.length
    ? await db
        .select({ id: schema.pages.id, slug: schema.pages.slug })
        .from(schema.pages)
        .where(inArray(schema.pages.id, targetIds))
    : [];
  const targetMap = new Map(targets.map((t) => [t.id.toString(), t.slug]));

  return rows.map((r) => ({
    pageId: r.pageId,
    slug: r.slug,
    title: r.title,
    targetSlug: targetMap.get(r.targetPageId.toString()) ?? "(unknown)",
    direction: r.direction,
    conviction: r.conviction,
    status: r.status,
    dateOpened: r.dateOpened,
  }));
}

/**
 * 一个论点的完整诊断快照：
 *   - thesis 状态机字段
 *   - target 当前 facts（最新 valid_to=NULL 的）
 *   - 关联的 signals（type IN (thesis_validation, thesis_invalidation, ...)）
 */
export async function thesisShow(pageId: bigint): Promise<{
  thesis: typeof schema.theses.$inferSelect;
  page: typeof schema.pages.$inferSelect;
  targetSlug: string;
  recentFacts: Array<{ metric: string; period: string | null; value: string | null; unit: string | null; sourceSlug: string | null }>;
  signals: Array<{ id: bigint; signalType: string; severity: string; title: string; detectedAt: Date }>;
} | null> {
  const [thesis] = await db
    .select()
    .from(schema.theses)
    .where(eq(schema.theses.pageId, pageId))
    .limit(1);
  if (!thesis) return null;

  const [page] = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);
  if (!page) return null;

  const [target] = await db
    .select({ slug: schema.pages.slug })
    .from(schema.pages)
    .where(eq(schema.pages.id, thesis.targetPageId))
    .limit(1);

  const facts = await db
    .select({
      metric: schema.facts.metric,
      period: schema.facts.period,
      value_numeric: schema.facts.valueNumeric,
      value_text: schema.facts.valueText,
      unit: schema.facts.unit,
      sourcePageId: schema.facts.sourcePageId,
    })
    .from(schema.facts)
    .where(
      and(
        eq(schema.facts.entityPageId, thesis.targetPageId),
        drizzleSql`${schema.facts.validTo} IS NULL`,
        eq(schema.facts.deleted, 0)
      )
    )
    .orderBy(desc(schema.facts.ingestedAt))
    .limit(20);

  const sourceIds = [...new Set(facts.map((f) => f.sourcePageId).filter((x): x is bigint => x !== null))];
  const sources = sourceIds.length
    ? await db
        .select({ id: schema.pages.id, slug: schema.pages.slug })
        .from(schema.pages)
        .where(inArray(schema.pages.id, sourceIds))
    : [];
  const sourceMap = new Map(sources.map((s) => [s.id.toString(), s.slug]));

  const signals = await db
    .select({
      id: schema.signals.id,
      signalType: schema.signals.signalType,
      severity: schema.signals.severity,
      title: schema.signals.title,
      detectedAt: schema.signals.detectedAt,
    })
    .from(schema.signals)
    .where(
      and(
        eq(schema.signals.deleted, 0),
        drizzleSql`(${schema.signals.thesisPageId} = ${pageId} OR ${schema.signals.entityPageId} = ${thesis.targetPageId})`
      )
    )
    .orderBy(desc(schema.signals.detectedAt))
    .limit(20);

  return {
    thesis,
    page,
    targetSlug: target?.slug ?? "(unknown)",
    recentFacts: facts.map((f) => ({
      metric: f.metric,
      period: f.period,
      value: f.value_numeric ?? f.value_text,
      unit: f.unit,
      sourceSlug: f.sourcePageId ? (sourceMap.get(f.sourcePageId.toString()) ?? null) : null,
    })),
    signals,
  };
}

// ============================================================================
// utils
// ============================================================================

/** 把"NVDA FY27 EPS upside"转成"nvda-fy27-eps-upside" */
function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}\-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}
