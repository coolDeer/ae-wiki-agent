/**
 * Web UI 视图层。
 *
 * 每个视图函数返回 HTML 字符串。共用 templates.ts 的 layout / 组件 / 转义。
 * 数据访问全部走已有模块（mcp/queries / skills/thesis / skills/lint / 直接 SQL），
 * 不重新写查询逻辑。
 */

import { eq, sql } from "drizzle-orm";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { db, schema } from "~/core/db.ts";
import { getEnv } from "~/core/env.ts";
import {
  search as mcpSearch,
  getPage,
  recentActivity,
  queryFacts,
  entityPulse,
  consensusView,
} from "~/mcp/queries.ts";
// thesis CLI is read directly via SQL in viewTheses to support pagination.

import { getSessionTurns, type ChatTurn } from "./chat.ts";
import { listPageComments, type PageCommentRow } from "./comments.ts";

import {
  confidenceTag,
  escape,
  fmtSh,
  highlightSnippet,
  layout,
  pageHref,
  pageTag,
  renderMarkdown,
  sortableHeader,
} from "./templates.ts";
import {
  buildPageResult,
  offsetOf,
  parsePageRequest,
  pickSortField,
  renderPagination,
  type PageRequest,
} from "./pagination.ts";

const env = getEnv();

// ============================================================================
// /chat
// ============================================================================

export function viewChat(sessionId: string): string {
  const turns = getSessionTurns(sessionId);
  const body = `
<div class="chat-shell">
  <h2 style="margin-bottom: 8px;">Ask the wiki</h2>
  <p class="muted" style="margin-top: 0;">Natural-language Q&amp;A over your ingested research. Powered by ${escape(env.OPENAI_AGENT_MODEL)} + 7 MCP tools (search / get_page / query_facts / compare_table_facts / get_table_artifact / list_entities / recent_activity).</p>

  <div id="chat-msgs" class="chat-msgs">
    ${turns.length === 0
      ? `<div class="chat-empty" id="chat-empty">
          <p>试着问：</p>
          <p style="margin: 4px 0;">"今天最有信息量的 source 是哪份？"</p>
          <p style="margin: 4px 0;">"DeepSeek 最近有什么动态？"</p>
          <p style="margin: 4px 0;">"列一下所有红链 company"</p>
        </div>`
      : turns.map(renderTurn).join("")}
  </div>

  <div class="chat-input-wrap">
    <form id="chat-form" class="chat-input-form">
      <textarea id="chat-input" name="message" placeholder="问个问题，回车发送，shift+回车换行" autofocus required></textarea>
      <button type="submit" id="chat-send">发送</button>
    </form>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
      <small class="muted">session: <code>${escape(sessionId.slice(0, 8))}</code></small>
      <small><a href="#" id="chat-clear">清空对话</a></small>
    </div>
  </div>
</div>

<script>
const msgs = document.getElementById('chat-msgs');
const empty = document.getElementById('chat-empty');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send');

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

document.getElementById('chat-clear').addEventListener('click', async (e) => {
  e.preventDefault();
  if (!confirm('清空当前 chat session?')) return;
  await fetch('/chat/clear', { method: 'POST' });
  location.reload();
});

function bubble(role, text) {
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + role;
  div.innerHTML = text;
  msgs.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return div;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderAssistantContent(text) {
  // 简易 markdown：保段落、粗体、斜体、code、wikilink → /pages/
  const pageHref = (slug) => '/pages/' + String(slug).split('/').map(encodeURIComponent).join('/');
  const safe = escapeHtml(text)
    .replace(/\\\\\\\[\\\\\\\[([^\\\]\\\|]+)(?:\\\\\\\|([^\\\]]+))?\\\\\\\]\\\\\\\]/g, (_m, slug, label) =>
      '<a class="wikilink" href="' + pageHref(slug) + '">' + (label||slug) + '</a>')
    .replace(/\\\*\\\*([^*]+)\\\*\\\*/g, '<strong>$1</strong>')
    .replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
  return '<div>' + safe.split(/\\n\\n+/).map(p => '<p>' + p.replace(/\\n/g, '<br>') + '</p>').join('') + '</div>';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  if (empty) empty.remove();

  bubble('user', '<div>' + escapeHtml(text).replace(/\\n/g, '<br>') + '</div>');
  input.value = '';
  sendBtn.disabled = true;

  const placeholder = bubble('assistant', '<div class="chat-typing">thinking</div>');

  try {
    const r = await fetch('/chat/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    placeholder.innerHTML = renderAssistantContent(data.content || '');
    if (data.tool_calls && data.tool_calls.length) {
      const tools = document.createElement('div');
      tools.className = 'chat-tools';
      tools.innerHTML = '<div style="font-weight:500;margin-bottom:4px;">tool calls (' + data.tool_calls.length + ')</div>' +
        data.tool_calls.map(tc =>
          '<div class="row"><code>' + escapeHtml(tc.name) + '</code> <span class="muted">' + escapeHtml(JSON.stringify(tc.args)) + '</span> → ' + escapeHtml(tc.result_summary) + '</div>'
        ).join('');
      placeholder.appendChild(tools);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    placeholder.appendChild(meta);
  } catch (err) {
    placeholder.innerHTML = '<div style="color:var(--negative);">出错了: ' + escapeHtml(err.message) + '</div>';
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
});
</script>
`;
  return layout({ title: "Chat", body });
}

function renderTurn(t: ChatTurn): string {
  if (t.role === "user") {
    return `<div class="chat-bubble user"><div>${escape(t.content).replace(/\n/g, "<br>")}</div></div>`;
  }
  const tools = t.tool_calls && t.tool_calls.length > 0
    ? `<div class="chat-tools">
        <div style="font-weight:500;margin-bottom:4px;">tool calls (${t.tool_calls.length})</div>
        ${t.tool_calls
          .map(
            (tc) =>
              `<div class="row"><code>${escape(tc.name)}</code> <span class="muted">${escape(JSON.stringify(tc.args))}</span> → ${escape(tc.result_summary)}</div>`
          )
          .join("")}
      </div>`
    : "";
  return `<div class="chat-bubble assistant">${renderMarkdown(t.content)}${tools}<div class="meta">${escape(fmtSh(t.ts, "time"))}</div></div>`;
}

// ============================================================================
// /  — Home
// ============================================================================

export async function viewHome(): Promise<string> {
  // 近 7 天 source/brief：直接 SQL 拉，不走 recent_activity（后者混了 events
  // + 自动建的红链 entity，会把 source/brief 挤出 limit 之外）。
  const sourceBriefRows = await db.execute(sql`
    SELECT id::text AS page_id, slug, title, type,
           create_time AS ts
    FROM pages
    WHERE deleted = 0
      AND type IN ('source', 'brief')
      AND create_time >= NOW() - INTERVAL '7 days'
    ORDER BY create_time DESC
    LIMIT 100
  `);
  const todaysSourceBriefs = sourceBriefRows as unknown as Array<{
    page_id: string;
    slug: string;
    title: string;
    type: string;
    ts: string;
  }>;

  // 近 7 天混合活动流（事件 / 信号 / 新页），仍走 recent_activity 给概览
  const recent = (await recentActivity({ days: 7, limit: 30 })) as Array<{
    kind: string;
    ts: string;
    title?: string;
    slug?: string;
    page_id?: string;
    action?: string;
    severity?: string;
    signal_type?: string;
    detail?: string;
  }>;

  const counts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM pages WHERE deleted=0 AND type IN ('source','brief')) AS source_brief,
      (SELECT COUNT(*)::int FROM pages WHERE deleted=0 AND confidence='low') AS red_links,
      (SELECT COUNT(*)::int FROM theses WHERE deleted=0 AND status='active') AS active_theses,
      (SELECT COUNT(*)::int FROM facts WHERE deleted=0 AND valid_to IS NULL) AS current_facts,
      (SELECT COUNT(*)::int FROM signals WHERE deleted=0) AS total_signals,
      (SELECT COUNT(*)::int FROM minion_jobs WHERE deleted=0 AND status='waiting') AS jobs_waiting
  `);
  const c = (counts[0] ?? {}) as Record<string, number>;

  const outputs = await listOutputFiles();

  const body = `
<div class="grid">
  <div class="card">
    <h3>Wiki at a glance</h3>
    <div class="kv">
      <div class="k">Source / Brief pages</div><div>${c.source_brief ?? 0}</div>
      <div class="k">Active theses</div><div><a href="/theses">${c.active_theses ?? 0}</a></div>
      <div class="k">Red links (confidence=low)</div><div><a href="/entities?confidence=low">${c.red_links ?? 0}</a></div>
      <div class="k">Current facts</div><div>${c.current_facts ?? 0}</div>
      <div class="k">Signals</div><div>${c.total_signals ?? 0}</div>
      <div class="k">Jobs waiting</div><div><a href="/queue">${c.jobs_waiting ?? 0}</a></div>
    </div>
  </div>
  <div class="card">
    <h3>Today's outputs</h3>
    ${outputs.length === 0
      ? `<div class="empty">no outputs in wiki/output/</div>`
      : `<ul class="plain">${outputs
          .slice(0, 8)
          .map(
            (f) =>
              `<li><a href="/outputs/${encodeURIComponent(f.name)}">${escape(f.name)}</a> <span class="muted score">${escape(f.mtime)}</span></li>`
          )
          .join("")}</ul>
        <p class="muted"><a href="/outputs">all outputs →</a></p>`
    }
  </div>
</div>

<h2>Today's source / brief (last 7d, ${todaysSourceBriefs.length})</h2>
${todaysSourceBriefs.length === 0
  ? `<div class="empty">no recent source/brief pages</div>`
  : `<ul class="plain">${todaysSourceBriefs
      .map(
        (p) => `<li>
          <div class="row">
            <div class="grow">${pageTag(p.type)} <a href="${pageHref(p.slug)}">${escape(p.title ?? p.slug)}</a></div>
            <span class="muted score">${escape(fmtSh(p.ts as string, "date"))}</span>
          </div>
          <span class="muted score">${escape(p.slug)}</span>
        </li>`
      )
      .join("")}</ul>`
}

<h2>Recent activity</h2>
<ul class="plain">
${recent
  .slice(0, 20)
  .map((r) => renderActivityRow(r))
  .join("")}
</ul>
`;
  return layout({ title: "Home", body });
}

function renderActivityRow(r: {
  kind: string;
  ts: string;
  title?: string;
  slug?: string;
  action?: string;
  severity?: string;
  detail?: string;
}): string {
  const ts = `<span class="muted score">${escape(fmtSh(r.ts as string))}</span>`;
  if (r.kind === "page") {
    return `<li>${ts} <span class="tag">page</span> <a href="${pageHref(r.slug ?? "")}">${escape(r.title ?? r.slug)}</a></li>`;
  }
  if (r.kind === "signal") {
    return `<li>${ts} <span class="tag severity-${escape(r.severity ?? "info")}">signal</span> ${escape(r.title ?? "")}</li>`;
  }
  return `<li>${ts} <span class="tag">event</span> ${escape(r.action ?? "")} ${escape(r.detail ?? "")}</li>`;
}

// ============================================================================
// /search?q=...
// ============================================================================

export interface ViewSearchOpts {
  /** "hybrid" (default) | "keyword" — keyword-only 跳过 vector 通道 */
  mode?: string;
  /** 显示 RRF / cosine / boost / final score 中间值（来自 ?debug=1） */
  debug?: boolean;
}

export async function viewSearch(
  query: string,
  type: string | undefined,
  pageReq: PageRequest,
  searchOpts: ViewSearchOpts = {}
): Promise<string> {
  if (!query.trim()) {
    return layout({
      title: "Search",
      body: `<h2>Search</h2><div class="empty">enter a query above</div>`,
    });
  }

  const keywordOnly =
    searchOpts.mode === "keyword" || env.EMBEDDING_DISABLED === true;

  // hybrid search 的 score 已经按 RRF 排过，分页就是对结果数组切片。
  // 取 top-200 作为 candidate pool（够大，避免后页空），之后客户端分页。
  const POOL = 200;
  const t0 = Date.now();
  const allHits = (await mcpSearch(query, {
    limit: POOL,
    type,
    keywordOnly,
    debug: searchOpts.debug,
  })) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    ticker: string | null;
    score: number;
    snippet: string | null;
    section_path: string[] | null;
    debug?: {
      rrfRaw: number;
      rrfNorm: number;
      rrfBoost: number;
      cosine: number | null;
      blendedScore: number;
      backlinkCount: number;
      backlinkBoost: number;
      finalScore: number;
    };
  }>;

  const tHybrid = Date.now() - t0;

  const start = offsetOf(pageReq);
  const slice = allHits.slice(start, start + pageReq.pageSize);
  const result = buildPageResult(slice, allHits.length, pageReq);

  // 批量查 visible slice 的 page metadata（confidence + create_time）
  // 与 suggestions 并发跑，避免串行多一个 RTT
  const t1 = Date.now();
  const [meta, suggestions] = await Promise.all([
    fetchHitMeta(slice.map((h) => h.slug)),
    allHits.length === 0 ? fetchSuggestions(query) : Promise.resolve([]),
  ]);
  const tMeta = Date.now() - t1;

  console.log(
    `[search] q="${query}" hits=${allHits.length} hybrid=${tHybrid}ms meta+sugg=${tMeta}ms ` +
      `mode=${keywordOnly ? "keyword" : "hybrid"}`
  );

  const keptParams: Record<string, string | undefined> = {
    q: query,
    type,
    mode: searchOpts.mode,
    debug: searchOpts.debug ? "1" : undefined,
  };

  const body = `
<h2>Search: "${escape(query)}"</h2>
<form class="filter" method="get" action="/search">
  <input type="hidden" name="q" value="${escape(query)}">
  <input type="hidden" name="pageSize" value="${pageReq.pageSize}">
  <select name="type" onchange="this.form.submit()">
    <option value="">all types</option>
    ${["company", "industry", "concept", "source", "brief", "thesis"]
      .map((t) => `<option value="${t}"${type === t ? " selected" : ""}>${t}</option>`)
      .join("")}
  </select>
  <select name="mode" onchange="this.form.submit()">
    <option value=""${!searchOpts.mode ? " selected" : ""}>hybrid</option>
    <option value="keyword"${searchOpts.mode === "keyword" ? " selected" : ""}>keyword-only</option>
  </select>
  <label style="margin-left: 8px; font-size: 12px; color: var(--muted);">
    <input type="checkbox" name="debug" value="1"${searchOpts.debug ? " checked" : ""} onchange="this.form.submit()">
    debug
  </label>
</form>

${slice.length === 0
  ? `<div class="empty">no hits</div>${
      suggestions.length > 0
        ? `<div class="did-you-mean">
            <span>did you mean</span>
            ${suggestions
              .map(
                (s) =>
                  `<a href="/search?q=${encodeURIComponent(s.suggest)}">${escape(s.title)}</a><span class="muted score">${escape(s.slug)}</span>`
              )
              .join('<span class="sep">·</span>')}
          </div>`
        : ""
    }`
  : `<table>
      <thead><tr><th>Title</th><th>Type</th><th>Slug</th><th>Score</th></tr></thead>
      <tbody>
      ${slice
        .map((h) => {
          const m = meta.get(h.slug);
          const confidenceBadge = m?.confidence ? confidenceTag(m.confidence) : "";
          const timeBadge = m?.createTime
            ? `<time datetime="${m.createTime.toISOString()}">${fmtSh(m.createTime, "date")}</time>`
            : "";
          const crumb =
            h.section_path && h.section_path.length > 0
              ? `<div class="crumb">${h.section_path
                  .map(escape)
                  .join('<span class="sep">›</span>')}</div>`
              : "";
          const snippetHtml = h.snippet
            ? `<div class="snippet">${highlightSnippet(h.snippet, query)}</div>`
            : "";
          const debugBlock =
            searchOpts.debug && h.debug
              ? `<details class="debug-block"><summary>debug</summary>
                  <table class="debug-kv">
                    <tr><td>rrf_raw</td><td>${h.debug.rrfRaw.toFixed(4)}</td></tr>
                    <tr><td>rrf_norm</td><td>${h.debug.rrfNorm.toFixed(4)}</td></tr>
                    <tr><td>rrf_boost</td><td>${h.debug.rrfBoost.toFixed(2)}</td></tr>
                    <tr><td>cosine</td><td>${h.debug.cosine == null ? "<em class='muted'>no embedding (fallback 0.5)</em>" : h.debug.cosine.toFixed(4)}</td></tr>
                    <tr><td>blended (0.7·rrf+0.3·cos)</td><td>${h.debug.blendedScore.toFixed(4)}</td></tr>
                    <tr><td>backlink_count</td><td>${h.debug.backlinkCount}</td></tr>
                    <tr><td>backlink_boost</td><td>${h.debug.backlinkBoost.toFixed(3)}</td></tr>
                    <tr><td>final_score</td><td>${h.debug.finalScore.toFixed(4)}</td></tr>
                  </table>
                </details>`
              : "";
          return `<tr>
            <td>
              <a href="${pageHref(h.slug)}">${escape(h.title)}</a>
              <span class="hit-meta">${confidenceBadge}${timeBadge}</span>
              ${crumb}
              ${snippetHtml}
              ${debugBlock}
            </td>
            <td>${pageTag(h.type)}</td>
            <td class="muted score">${escape(h.slug)}</td>
            <td class="score">${h.score.toFixed(4)}</td>
          </tr>`;
        })
        .join("")}
      </tbody>
    </table>`
}
${renderPagination(result, "/search", keptParams)}
${allHits.length === POOL ? `<p class="muted">候选池上限 ${POOL}，更深结果不展示。请细化查询或限定 type。</p>` : ""}
`;
  return layout({ title: `Search: ${query}`, body, query });
}

interface HitMeta {
  confidence: string | null;
  createTime: Date | null;
}

interface Suggestion {
  slug: string;
  title: string;
  /** 推荐用作下一次 query 的字符串（用 title 或 slug 末段，看哪个跟 query 更近） */
  suggest: string;
  similarity: number;
}

/**
 * 0 命中时用 pg_trgm 找 title / slug 上的近似项。
 * 阈值 0.3 是 pg_trgm 默认 set_limit；低于此基本不是同一个词。
 * 用 GREATEST(title_sim, slug_sim) 选最高分作为排序依据。
 */
async function fetchSuggestions(query: string): Promise<Suggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const rows = await db.execute(sql`
    SELECT slug, title,
           similarity(title, ${trimmed}) AS title_sim,
           similarity(slug, ${trimmed}) AS slug_sim,
           GREATEST(similarity(title, ${trimmed}), similarity(slug, ${trimmed})) AS sim
    FROM pages
    WHERE deleted = 0
      AND (title % ${trimmed} OR slug % ${trimmed})
    ORDER BY sim DESC
    LIMIT 5
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const title = String(r.title ?? "");
    const slug = String(r.slug ?? "");
    const titleSim = Number(r.title_sim ?? 0);
    const slugSim = Number(r.slug_sim ?? 0);
    return {
      slug,
      title,
      // 用相似度更高的字段作为下次搜索的 query
      suggest: titleSim >= slugSim ? title : slug.split("/").pop() ?? title,
      similarity: Number(r.sim ?? 0),
    };
  });
}

/** 一次 SQL 拉本页 slice 的 confidence + create_time。slice 通常 ≤ 25。 */
async function fetchHitMeta(slugs: string[]): Promise<Map<string, HitMeta>> {
  const out = new Map<string, HitMeta>();
  if (slugs.length === 0) return out;
  const rows = await db.execute(sql`
    SELECT slug, confidence, create_time
    FROM pages
    WHERE deleted = 0 AND slug IN (${sql.join(
      slugs.map((s) => sql`${s}`),
      sql`, `
    )})
  `);
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    out.set(String(r.slug), {
      confidence: (r.confidence as string | null) ?? null,
      createTime: r.create_time ? new Date(String(r.create_time)) : null,
    });
  }
  return out;
}

// ============================================================================
// /pages/:slug-or-id
// ============================================================================

export async function viewPage(identifier: string): Promise<string> {
  const page = (await getPage(identifier)) as
    | (Record<string, unknown> & {
        id: string;
        slug: string;
        type: string;
        title: string;
        content: string;
        timeline: string;
        frontmatter: Record<string, unknown>;
        ticker: string | null;
        sector: string | null;
        confidence: string | null;
        aliases: string[] | null;
        create_time: string;
        update_time: string;
        inbound_links_count: number;
        outbound_links_count: number;
        tags: string[];
      })
    | null;

  if (!page) {
    return layout({
      title: "Not found",
      body: `<div class="empty">page not found: ${escape(identifier)}</div>`,
    });
  }

  const facts = (await queryFacts({
    entity: page.slug,
    currentOnly: true,
    limit: 50,
  })) as Array<{
    id: string;
    metric: string;
    period: string | null;
    value_numeric: number | string | null;
    value_text: string | null;
    unit: string | null;
    confidence: string | null;
    source: { slug: string | null; title: string | null } | null;
    metadata: { extracted_by?: string; source_quote?: string; evidence_context?: string } | null;
  }>;

  // 该 source 引出的 fact（自己作为 source_page_id）
  const ownFacts = await db.execute(sql`
    SELECT f.id::text AS id,
           e.slug AS entity_slug,
           e.title AS entity_title,
           f.metric, f.period, f.value_numeric, f.value_text, f.unit,
           f.confidence,
           f.metadata
    FROM facts f
    JOIN pages e ON e.id = f.entity_page_id
    WHERE f.source_page_id = ${BigInt(page.id)}
      AND f.deleted = 0
      AND f.valid_to IS NULL
    ORDER BY e.title, f.metric, f.period NULLS LAST
    LIMIT 200
  `);

  const inLinks = await db.execute(sql`
    SELECT p.slug, p.title, p.display_name, p.type, l.link_type
    FROM links l JOIN pages p ON p.id = l.from_page_id
    WHERE l.to_page_id = ${BigInt(page.id)}
      AND l.deleted = 0 AND p.deleted = 0
    ORDER BY p.create_time DESC LIMIT 20
  `);

  const outLinks = await db.execute(sql`
    SELECT p.id, p.slug, p.title, p.display_name, p.type,
           l.link_type, l.context, l.link_source, l.origin_field
    FROM links l JOIN pages p ON p.id = l.to_page_id
    WHERE l.from_page_id = ${BigInt(page.id)}
      AND l.deleted = 0 AND p.deleted = 0
    ORDER BY l.id LIMIT 30
  `);

  const timelineRows = await db.execute(sql`
    SELECT te.event_date, te.event_type, te.summary,
           e.slug AS entity_slug, e.title AS entity_title, e.display_name AS entity_display_name
    FROM timeline_entries te
    LEFT JOIN pages e ON e.id = te.entity_page_id
    WHERE (te.source_page_id = ${BigInt(page.id)} OR te.entity_page_id = ${BigInt(page.id)})
      AND te.deleted = 0
    ORDER BY te.event_date DESC LIMIT 30
  `);

  const comments = await listPageComments(BigInt(page.id));
  const groupedOutLinks = aggregateOutboundLinks(
    outLinks as Array<Record<string, unknown>>
  );

  const meta = page.frontmatter ?? {};
  const isEntity = ["company", "industry", "concept"].includes(page.type);

  // entity 页才拉 PM dashboard 数据：typed-edge breakdown + top consensus metrics
  let entityDashboard: Record<string, unknown> | null = null;
  let topConsensusMetrics: Array<{
    metric: string;
    obs_count: number;
    drift_direction: string;
    range_pct: number | null;
    latest: number | null;
    unit: string | null;
    sources_count: number;
  }> = [];
  if (isEntity) {
    entityDashboard = (await entityPulse({
      identifier: page.slug,
      recentLimit: 0, // 不在 web 里展示 recent inbound（已有 backlinks 列表）
      factLimit: 0,
    })) as Record<string, unknown>;

    // 单 SQL 一次性算所有 metric 的 stats + drift（避免 N+1 串行 consensusView
    // 引发 web 请求 timeout）。latest 用 MAX(rn) 行的 v 取出。
    const stats = (await db.execute(sql`
      WITH ordered AS (
        SELECT metric,
               value_numeric::float AS v,
               source_page_id,
               ROW_NUMBER() OVER (PARTITION BY metric ORDER BY valid_from, id) AS rn,
               COUNT(*) OVER (PARTITION BY metric) AS n,
               LAST_VALUE(value_numeric::float) OVER (
                 PARTITION BY metric
                 ORDER BY valid_from, id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
               ) AS latest_v
        FROM facts
        WHERE deleted=0 AND entity_page_id=${BigInt(page.id)} AND value_numeric IS NOT NULL
      )
      SELECT metric,
             COUNT(*)::int AS obs,
             COUNT(DISTINCT source_page_id)::int AS sources_n,
             MAX(unit) AS unit,
             MIN(v) AS min_v,
             MAX(v) AS max_v,
             AVG(v) AS mean_v,
             AVG(v) FILTER (WHERE rn <= n/2) AS first_half_avg,
             AVG(v) FILTER (WHERE rn > n - n/2) AS second_half_avg,
             MAX(latest_v) AS latest
      FROM ordered
      GROUP BY metric
      HAVING COUNT(*) >= 3 AND COUNT(DISTINCT source_page_id) >= 2
      ORDER BY obs DESC, sources_n DESC
      LIMIT 6
    `)) as Array<{
      metric: string;
      obs: number;
      sources_n: number;
      unit: string | null;
      min_v: number | null;
      max_v: number | null;
      mean_v: number | null;
      first_half_avg: number | null;
      second_half_avg: number | null;
      latest: number | null;
    }>;

    for (const s of stats) {
      const mean = Number(s.mean_v ?? 0);
      const rangePct =
        mean !== 0 && s.min_v !== null && s.max_v !== null
          ? (Number(s.max_v) - Number(s.min_v)) / Math.abs(mean)
          : null;
      let direction = "stable";
      if (s.first_half_avg !== null && s.second_half_avg !== null) {
        const f = Number(s.first_half_avg);
        const sec = Number(s.second_half_avg);
        const driftPct = f !== 0 ? (sec - f) / Math.abs(f) : 0;
        if (Math.abs(driftPct) < 0.02) direction = "stable";
        else if (driftPct > 0) direction = "rising";
        else direction = "falling";
      }
      topConsensusMetrics.push({
        metric: s.metric,
        obs_count: s.obs,
        drift_direction: direction,
        range_pct: rangePct,
        latest: s.latest !== null ? Number(s.latest) : null,
        unit: s.unit ?? null,
        sources_count: s.sources_n,
      });
    }
  }

  // Source/brief 类型：在 slug · #id 行尾追加"查看原文"链接。
  // 新标签页打开 /source-view/:id，服务端渲染 markdown → HTML。
  const isSourceLike = page.type === "source" || page.type === "brief";
  const markdownUrl = typeof meta.markdown_url === "string" ? meta.markdown_url : null;
  const inlineSourceBtn =
    isSourceLike && markdownUrl
      ? ` · <a href="/source-view/${encodeURIComponent(page.id)}" target="_blank" rel="noopener" class="btn-inline">📄 查看原文</a>`
      : "";
  const evidenceContexts = buildEvidenceContextMap(ownFacts as unknown as SourceFactRow[]);
  const metadataCard = renderPageMetadataCard(page, meta);
  const factsCard =
    page.type === "source" || page.type === "brief"
      ? renderSourceFactsCard(ownFacts as unknown as SourceFactRow[])
      : renderEntityFactsCard(facts);

  const body = `
<h2>
  ${pageTag(page.type)}
  ${escape((page as Record<string, unknown>).display_name as string | undefined ?? page.title)}
  ${confidenceTag(page.confidence)}
</h2>
<div class="muted score">${escape(page.slug)} · #${escape(page.id)}${inlineSourceBtn}</div>

<div class="page-summary-stack" style="margin-top: 16px;">
  ${metadataCard}
  ${factsCard}
</div>

${isEntity && entityDashboard ? renderEntityDashboard(page.slug, entityDashboard, topConsensusMetrics) : ""}

${page.content
  ? `<h2>Content</h2><div class="content page-content">${renderMarkdown(page.content, { evidenceContexts })}</div>`
  : isEntity
    ? `<div class="empty">red link — no narrative yet. <a href="/queue">enqueue enrich →</a></div>`
    : ""
}

${timelineRows.length > 0
  ? `<h2>Timeline</h2>
    <table><thead><tr><th>Date</th><th>Type</th><th>Entity</th><th>Summary</th></tr></thead><tbody>
      ${timelineRows
        .map(
          (t) => `<tr>
            <td class="muted">${escape(String(t.event_date ?? ""))}</td>
            <td><span class="tag">${escape(String(t.event_type ?? ""))}</span></td>
            <td>${t.entity_slug ? `<a href="${pageHref(String(t.entity_slug))}">${escape(pageDisplayName({ slug: String(t.entity_slug), title: String(t.entity_title ?? ""), display_name: String(t.entity_display_name ?? "") }))}</a>` : ""}</td>
            <td>${escape(String(t.summary ?? ""))}</td>
          </tr>`
        )
        .join("")}
    </tbody></table>`
  : ""
}

${groupedOutLinks.length > 0
  ? `<h2>Outbound links (${groupedOutLinks.length})</h2>
    <ul class="plain">${groupedOutLinks
      .map(
        (l) =>
          `<li><a href="${pageHref(String(l.slug ?? ""))}">${escape(outboundLinkDisplayName(l))}</a> ${pageTag(String(l.type ?? ""))} ${linkTypeTag(String(l.link_type ?? "mention"))} ${renderProvenanceBadges(l.provenance)}</li>`
      )
      .join("")}</ul>`
  : ""
}

${inLinks.length > 0
  ? `<h2>Backlinks (${inLinks.length})</h2>
    <ul class="plain">${inLinks
      .map(
        (l) =>
          `<li><a href="${pageHref(String(l.slug ?? ""))}">${escape(pageDisplayName(l))}</a> ${pageTag(String(l.type ?? ""))} ${linkTypeTag(String(l.link_type ?? "mention"))}</li>`
      )
      .join("")}</ul>`
  : ""
}

${page.type === "thesis" ? await renderThesisAdmin(BigInt(page.id), page.content ?? "") : ""}

${renderCommentsSection(page.slug, comments)}
`;
  return layout({ title: page.title, body });
}

type PageForMetadata = {
  id: string;
  slug: string;
  type: string;
  ticker: string | null;
  sector: string | null;
  confidence: string | null;
  aliases: string[] | null;
  create_time: string;
  update_time: string;
  inbound_links_count: number;
  outbound_links_count: number;
  tags: string[];
};

type SourceFactRow = {
  id: string;
  entity_slug: string | null;
  entity_title: string | null;
  metric: string | null;
  period: string | null;
  value_numeric: string | null;
  value_text: string | null;
  unit: string | null;
  confidence: string | null;
  metadata: { extracted_by?: string; source_quote?: string; evidence_context?: string } | null;
};

type OutboundLinkRow = {
  id?: string | number | bigint | null;
  slug?: string | null;
  title?: string | null;
  display_name?: string | null;
  type?: string | null;
  link_type?: string | null;
  context?: string | null;
  link_source?: string | null;
  origin_field?: string | null;
};

type AggregatedOutboundLink = {
  slug: string;
  title: string | null;
  display_name: string | null;
  type: string | null;
  link_type: string | null;
  context: string | null;
  provenance: string[];
};

function renderPageMetadataCard(
  page: PageForMetadata,
  meta: Record<string, unknown>
): string {
  const sourceRows = [
    meta.research_id ? metaRow("Research ID", String(meta.research_id), { mono: true }) : "",
    meta.research_type ? metaRow("Research type", String(meta.research_type)) : "",
    meta.source_type ? metaRow("Source type", String(meta.source_type)) : "",
    meta.publish_date ? metaRow("Publish date", String(meta.publish_date)) : "",
    meta.file_type ? metaRow("File type", String(meta.file_type)) : "",
    meta.markdown_url ? metaRow("Markdown", String(meta.markdown_url), { href: String(meta.markdown_url) }) : "",
    meta.url ? metaRow("URL", String(meta.url), { href: String(meta.url) }) : "",
  ].filter(Boolean).join("");

  const identityRows = [
    page.ticker ? metaRow("Ticker", page.ticker, { mono: true }) : "",
    page.sector ? metaRow("Sector", page.sector) : "",
    page.aliases?.length
      ? metaRow(
          "Aliases",
          page.aliases.map((a) => `<span class="meta-chip">${escape(a)}</span>`).join(" "),
          { html: true }
        )
      : "",
    page.tags?.length
      ? metaRow(
          "Tags",
          page.tags.map((t) => `<span class="meta-chip">${escape(t)}</span>`).join(" "),
          { html: true }
        )
      : "",
  ].filter(Boolean).join("");

  return `<details class="card metadata-card collapsible-card">
    <summary>
      <span class="summary-title">Metadata</span>
      <span class="summary-right">
        <span class="tag">${escape(page.type)}</span>
        <span class="tag">${escape(page.slug)}</span>
      </span>
    </summary>
    <div class="meta-stats">
      <div><strong>${escape(String(page.inbound_links_count))}</strong><span>Inbound</span></div>
      <div><strong>${escape(String(page.outbound_links_count))}</strong><span>Outbound</span></div>
      <div><strong>${escape(page.confidence ?? "n/a")}</strong><span>Confidence</span></div>
    </div>
    ${identityRows ? `<h4>Identity</h4><div class="kv kv-compact">${identityRows}</div>` : ""}
    ${sourceRows ? `<h4>Source Provenance</h4><div class="kv kv-compact">${sourceRows}</div>` : ""}
    <h4>System</h4>
    <div class="kv kv-compact">
      ${metaRow("Created", fmtSh(page.create_time))}
      ${metaRow("Updated", fmtSh(page.update_time))}
      ${metaRow("Page ID", `#${page.id}`, { mono: true })}
    </div>
  </details>`;
}

function aggregateOutboundLinks(rows: OutboundLinkRow[]): AggregatedOutboundLink[] {
  const grouped = new Map<string, AggregatedOutboundLink>();
  for (const row of rows) {
    const slug = String(row.slug ?? "");
    const linkType = String(row.link_type ?? "mention");
    if (!slug) continue;
    const key = `${slug}|${linkType}`;
    const existing = grouped.get(key) ?? {
      slug,
      title: row.title == null ? null : String(row.title),
      display_name: row.display_name == null ? null : String(row.display_name),
      type: row.type == null ? null : String(row.type),
      link_type: row.link_type == null ? null : String(row.link_type),
      context: row.context == null ? null : String(row.context),
      provenance: [],
    };
    const provenance = provenanceLabel(row.link_source, row.origin_field);
    if (provenance && !existing.provenance.includes(provenance)) {
      existing.provenance.push(provenance);
    }
    grouped.set(key, existing);
  }
  return Array.from(grouped.values());
}

function provenanceLabel(
  linkSource: string | null | undefined,
  originField: string | null | undefined
): string | null {
  if (linkSource === "markdown") return "wikilink";
  if (linkSource === "frontmatter" && originField === "primary_entities") {
    return "primary_entities";
  }
  if (originField === "facts_block") return "facts";
  if (originField === "timeline_block") return "timeline";
  return null;
}

function renderProvenanceBadges(provenance: string[]): string {
  if (provenance.length === 0) return "";
  return provenance
    .map((p) => `<span class="tag">${escape(p)}</span>`)
    .join(" ");
}

function renderSourceFactsCard(facts: SourceFactRow[]): string {
  const entityCount = new Set(facts.map((f) => f.entity_slug).filter(Boolean)).size;
  const tierCounts = facts.reduce<Record<string, number>>((acc, f) => {
    const tier = f.metadata?.extracted_by ?? "unknown";
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});
  const summary = facts.length > 0
    ? `<div class="fact-summary">
        <span><strong>${facts.length}</strong> facts</span>
        <span><strong>${entityCount}</strong> entities</span>
        ${Object.entries(tierCounts).map(([tier, n]) => `<span>${escape(tier)}: <strong>${n}</strong></span>`).join("")}
      </div>`
    : "";

  if (facts.length === 0) {
    return `<details class="card facts-card collapsible-card">
      <summary>
        <span class="summary-title">Facts written by this source</span>
        <span class="summary-right"><span class="tag">0 facts</span></span>
      </summary>
      <p class="muted card-note">Stage 5 did not land structured facts for this source.</p>
      <div class="empty">no facts</div>
    </details>`;
  }

  const thead = `<thead><tr><th>Entity</th><th>Fact</th><th>Value</th><th>Evidence</th></tr></thead>`;
  const rows = facts.slice(0, 10).map(sourceFactRow).join("");
  return `<details class="card facts-card collapsible-card">
    <summary>
      <span class="summary-title">Facts written by this source</span>
      <span class="summary-right">
        <span class="tag evidence-tag">high-value evidence</span>
        <span class="tag">${facts.length} facts</span>
        ${facts.length > 10 ? `<button type="button" class="btn-inline" onclick="event.preventDefault();event.stopPropagation();document.getElementById('dlg-own-facts').showModal()">Show all →</button>` : ""}
      </span>
    </summary>
    <p class="muted card-note">Structured facts with this page as <code>source_page_id</code>. These now count as high-value evidence for entity refresh; plain mention links do not.</p>
    ${summary}
    <table class="facts-table">${thead}<tbody>${rows}</tbody></table>
    ${facts.length > 10 ? `
      <dialog class="facts-modal" id="dlg-own-facts">
        <div class="facts-modal-header">
          <h3>All facts written by this source (${facts.length})</h3>
          <button class="btn-inline" onclick="document.getElementById('dlg-own-facts').close()">close</button>
        </div>
        <div class="facts-modal-body">
          <table class="facts-table">${thead}<tbody>${facts.map(sourceFactRow).join("")}</tbody></table>
        </div>
      </dialog>` : ""}
  </details>`;
}

function renderEntityFactsCard(
  facts: Array<{
    metric: string;
    period: string | null;
    value_numeric?: number | string | null;
    value_text?: string | null;
    unit: string | null;
    source?: { slug: string | null; title: string | null } | null;
  }>
): string {
  if (facts.length === 0) {
    return `<details class="card facts-card collapsible-card">
      <summary>
        <span class="summary-title">Latest facts about this entity</span>
        <span class="summary-right"><span class="tag">0 facts</span></span>
      </summary>
      <div class="empty">no facts</div>
    </details>`;
  }
  const factRow = (f: typeof facts[number]) => `<tr>
    <td><strong>${escape(f.metric)}</strong><div class="muted">${escape(f.period ?? "")}</div></td>
    <td>${formatFactDisplayValue({ value: f.value_numeric ?? f.value_text ?? "", unit: f.unit })}</td>
    <td>${f.source?.slug ? `<a href="${pageHref(f.source.slug)}">${escape(f.source.title ?? f.source.slug.split("/").pop() ?? "")}</a>` : ""}</td>
  </tr>`;
  const thead = `<thead><tr><th>Metric</th><th>Value</th><th>Source</th></tr></thead>`;
  return `<details class="card facts-card collapsible-card">
    <summary>
      <span class="summary-title">Latest facts about this entity</span>
      <span class="summary-right">
        <span class="tag">${facts.length} facts</span>
        ${facts.length > 15 ? `<button type="button" class="btn-inline" onclick="event.preventDefault();event.stopPropagation();document.getElementById('dlg-facts').showModal()">Show all →</button>` : ""}
      </span>
    </summary>
    <table class="facts-table">${thead}<tbody>${facts.slice(0, 15).map(factRow).join("")}</tbody></table>
    ${facts.length > 15 ? `
      <dialog class="facts-modal" id="dlg-facts">
        <div class="facts-modal-header">
          <h3>All facts (${facts.length})</h3>
          <button class="btn-inline" onclick="document.getElementById('dlg-facts').close()">close</button>
        </div>
        <div class="facts-modal-body">
          <table class="facts-table">${thead}<tbody>${facts.map(factRow).join("")}</tbody></table>
        </div>
      </dialog>` : ""}
  </details>`;
}

function sourceFactRow(f: SourceFactRow): string {
  const quote = f.metadata?.source_quote ? String(f.metadata.source_quote) : "";
  const extractedBy = f.metadata?.extracted_by ?? "unknown";
  return `<tr>
    <td>
      <a href="${pageHref(String(f.entity_slug ?? ""))}">${escape(String(f.entity_title ?? f.entity_slug ?? ""))}</a>
      <div class="muted mono">${escape(String(f.entity_slug ?? ""))}</div>
    </td>
    <td>
      <strong>${escape(String(f.metric ?? ""))}</strong>
      <div class="muted">${escape(String(f.period ?? ""))}</div>
    </td>
    <td>${formatFactValue(f)}${f.confidence ? `<div><span class="tag">conf ${escape(String(f.confidence))}</span></div>` : ""}</td>
    <td>
      <span class="tag">${escape(extractedBy)}</span>
      ${quote ? `<div class="muted mono" style="margin-top:4px;">quote: ${escape(truncateMiddle(quote, 90))}</div>` : ""}
    </td>
  </tr>`;
}

function buildEvidenceContextMap(facts: SourceFactRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fact of facts) {
    const quote = fact.metadata?.source_quote;
    const context = fact.metadata?.evidence_context;
    if (typeof quote !== "string" || typeof context !== "string") continue;
    if (!quote.trim() || !context.trim()) continue;
    for (const variant of sourceQuoteDisplayVariants(quote)) {
      out[variant] = context.trim();
    }
  }
  return out;
}

function sourceQuoteDisplayVariants(quote: string): string[] {
  const stripped = quote.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  const variants = [
    quote.trim(),
    stripped,
    stripped.replace(/（[^）]*）/g, "").trim(),
    stripped.replace(/\([^)]*\)/g, "").trim(),
  ].filter(Boolean);
  return Array.from(new Set(variants));
}

function metaRow(
  label: string,
  value: string,
  opts: { href?: string; mono?: boolean; html?: boolean } = {}
): string {
  const display = opts.html
    ? value
    : opts.href
      ? `<a href="${escape(opts.href)}" target="_blank" rel="noopener">${escape(truncateMiddle(value, 72))}</a>`
      : `<span class="${opts.mono ? "mono" : ""}">${escape(value)}</span>`;
  return `<div class="k">${escape(label)}</div><div>${display}</div>`;
}

function linkTypeTag(linkType: string): string {
  const highValue = isHighValueLinkType(linkType);
  return `<span class="tag link-type ${highValue ? "link-type-high" : "link-type-mention"}">${escape(linkType)}</span>`;
}

function isHighValueLinkType(linkType: string): boolean {
  return linkType !== "mention";
}

function outboundLinkDisplayName(row: Record<string, unknown>): string {
  const slug = String(row.slug ?? "");
  const contextDisplay = displayFromLinkContext(slug, String(row.context ?? ""));
  return contextDisplay || pageDisplayName(row);
}

function pageDisplayName(row: Record<string, unknown>): string {
  const displayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
  if (displayName) return displayName;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const slug = String(row.slug ?? "");
  const slugName = slug.split("/").pop() || slug;
  if (title && title !== slug) return humanizeSlugName(title);
  return humanizeSlugName(slugName);
}

function displayFromLinkContext(slug: string, context: string): string | null {
  if (!slug || !context) return null;
  const escapedSlug = escapeRegExp(slug);
  const wikilinkRe = new RegExp(`\\[\\[${escapedSlug}(?:#[^\\]|]*)?(?:\\|([^\\]]+))?\\]\\]`);
  const wikiMatch = context.match(wikilinkRe);
  if (wikiMatch?.[1]) return stripTypedDisplayPrefix(wikiMatch[1]).trim() || null;

  const mdLinkRe = new RegExp(`\\[([^\\]]+)\\]\\((?:\\.\\.\\/)*${escapedSlug}(?:\\.md)?\\)`);
  const mdMatch = context.match(mdLinkRe);
  if (mdMatch?.[1]) return mdMatch[1].trim() || null;
  return null;
}

function stripTypedDisplayPrefix(display: string): string {
  return display.replace(/^[a-z_]+\s*:\s*/, "");
}

function humanizeSlugName(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized === normalized.toUpperCase() && /[A-Z]/.test(normalized)) return normalized;
  return normalized
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 4 && part === part.toLowerCase()) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateMiddle(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  const keep = Math.max(12, Math.floor((maxLen - 1) / 2));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

/**
 * 评论区：列出已有评论 + 新增表单。
 *
 * 用 page.slug 作为 form action 的 path 段——server.ts 那边的 resolvePageId 也支持
 * id / slug 两种 identifier，保持页面层路由一致（/pages/:identifier 上下文）。
 */
function renderCommentsSection(pageSlug: string, comments: PageCommentRow[]): string {
  const slugUrl = pageHref(pageSlug);
  const list =
    comments.length === 0
      ? `<div class="muted" style="margin: 8px 0;">No comments yet.</div>`
      : `<ul class="plain comments-list" style="margin: 0; padding: 0;">
          ${comments
            .map((c) => {
              const meta = c.metadata ?? {};
              const section = typeof meta.section === "string" ? meta.section : "";
              const intent = typeof meta.intent === "string" ? meta.intent : "";
              const tags = [
                section ? `<span class="tag">section: ${escape(section)}</span>` : "",
                intent ? `<span class="tag">intent: ${escape(intent)}</span>` : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `<li class="comment" style="margin: 12px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-soft, #fafaf9);">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px;">
                  <div>
                    <strong>${escape(c.author)}</strong>
                    <span class="muted" style="margin-left: 8px; font-size: 12px;">${escape(c.create_time.slice(0, 19).replace("T", " "))}</span>
                    ${tags ? `<span style="margin-left: 8px;">${tags}</span>` : ""}
                  </div>
                  <form method="post" action="/comments/${escape(c.id)}/delete" style="margin: 0;" onsubmit="return confirm('删除这条评论？');">
                    <input type="hidden" name="redirect" value="${slugUrl}#comments" />
                    <button type="submit" class="btn-inline danger" style="font-size: 12px; padding: 2px 8px;">delete</button>
                  </form>
                </div>
                <div class="comment-body" style="white-space: pre-wrap; font-size: 14px; line-height: 1.6;">${escape(c.content)}</div>
              </li>`;
            })
            .join("")}
        </ul>`;

  return `
<h2 id="comments">Comments (${comments.length})</h2>
<p class="muted" style="font-size: 12px; margin-top: -4px;">
  人工反馈通道。后续 skill / agent 会读这里的评论调整 fact 抽取 / narrative 写法。
</p>
${list}
<form method="post" action="${slugUrl}/comments" class="comment-form" style="margin-top: 16px; padding: 12px; border: 1px solid var(--border); border-radius: 4px;">
  <div class="form-row" style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
    <input type="text" name="author" placeholder="Your name (optional)" maxlength="64" style="flex: 1; min-width: 200px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg);" />
    <input type="text" name="section" placeholder="Section (optional, e.g. Bull Case)" maxlength="200" style="flex: 1; min-width: 200px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg);" />
    <select name="intent" style="padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg);">
      <option value="">Intent (optional)</option>
      <option value="skill_feedback">skill_feedback</option>
      <option value="fact_correction">fact_correction</option>
      <option value="narrative_gap">narrative_gap</option>
      <option value="triage_wrong">triage_wrong</option>
      <option value="general">general</option>
    </select>
  </div>
  <textarea name="content" rows="4" required maxlength="8000" placeholder="Leave a comment (up to 8000 chars)" style="width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--border); border-radius: 4px; font-family: inherit; font-size: 14px; background: var(--bg); color: var(--fg);"></textarea>
  <div class="form-row form-actions" style="margin-top: 8px;">
    <button type="submit">Post comment</button>
    <span class="muted form-hint" style="margin-left: 12px; font-size: 12px;">Saved to page_comments, readable by agents / skills</span>
  </div>
</form>
`;
}

/**
 * Entity 页 PM dashboard 卡片：
 *   - typed-edge breakdown（mention/confirms/contradicts/...）
 *   - consensus strength score
 *   - top metrics 的 drift 概览
 */
function renderEntityDashboard(
  slug: string,
  dashboard: Record<string, unknown>,
  consensusMetrics: Array<{
    metric: string;
    obs_count: number;
    drift_direction: string;
    range_pct: number | null;
    latest: number | null;
    unit: string | null;
    sources_count: number;
  }>
): string {
  const lb = dashboard.link_breakdown as
    | {
        inbound: Record<string, number>;
        outbound: Record<string, number>;
        consensus_strength: number | null;
      }
    | undefined;
  if (!lb) return "";

  const inboundTotal = Object.values(lb.inbound).reduce((a, b) => a + b, 0);
  const outboundTotal = Object.values(lb.outbound).reduce((a, b) => a + b, 0);

  // typed-edge 颜色
  const typeColor = (t: string): string => {
    if (t === "confirms") return "var(--positive, #15803d)";
    if (t === "contradicts") return "var(--negative, #b91c1c)";
    if (t === "supersedes") return "var(--warning, #c2410c)";
    if (t === "critiques") return "var(--warning, #c2410c)";
    if (t === "cites") return "var(--accent, #1d4ed8)";
    return "var(--muted, #78716c)";
  };

  const directionEmoji = (d: string): string => {
    if (d === "rising") return "↗";
    if (d === "falling") return "↘";
    if (d === "stable") return "→";
    return "·";
  };

  const renderTypeBar = (
    dist: Record<string, number>,
    total: number,
    label: string
  ): string => {
    if (total === 0) return `<div class="muted">${label}: (0 links)</div>`;
    const order = [
      "mention",
      "confirms",
      "contradicts",
      "supersedes",
      "cites",
      "critiques",
      "derives_from",
      "tracks",
    ];
    const segments = order
      .filter((t) => (dist[t] ?? 0) > 0)
      .map((t) => {
        const n = dist[t]!;
        const pct = (n / total) * 100;
        return `<span class="edge-seg" style="background:${typeColor(t)};width:${pct.toFixed(1)}%" title="${escape(t)}: ${n}"></span>`;
      })
      .join("");
    const legend = order
      .filter((t) => (dist[t] ?? 0) > 0)
      .map(
        (t) =>
          `<span class="edge-legend"><span class="edge-dot" style="background:${typeColor(t)}"></span>${escape(t)} <strong>${dist[t]}</strong></span>`
      )
      .join(" ");
    return `
      <div class="edge-bar-wrap">
        <div class="muted edge-bar-label">${escape(label)} (${total})</div>
        <div class="edge-bar">${segments}</div>
        <div class="edge-legends">${legend}</div>
      </div>`;
  };

  const cs = lb.consensus_strength;
  const csBadge =
    cs === null
      ? `<span class="muted">no typed-edge yet</span>`
      : `<span class="tag" style="background:${cs > 0.3 ? "var(--positive,#15803d)" : cs < -0.3 ? "var(--negative,#b91c1c)" : "var(--muted,#78716c)"};color:#fff">consensus = ${cs.toFixed(2)}</span>`;

  const consensusTable =
    consensusMetrics.length === 0
      ? `<div class="muted">no metric has ≥3 observations across ≥2 sources yet</div>`
      : `<table><thead><tr><th>Metric</th><th>Drift</th><th>Range</th><th>Latest</th><th>Obs / Sources</th><th></th></tr></thead><tbody>
          ${consensusMetrics
            .map(
              (m) => `<tr>
                <td>${escape(m.metric)}</td>
                <td>${directionEmoji(m.drift_direction)} <span class="muted">${escape(m.drift_direction)}</span></td>
                <td class="muted">${m.range_pct !== null ? `${(m.range_pct * 100).toFixed(0)}%` : "-"}</td>
                <td>${m.latest !== null ? formatFactDisplayValue({ value: m.latest, unit: m.unit }) : "-"}</td>
                <td class="muted">${m.obs_count} / ${m.sources_count}</td>
                <td><a class="btn-inline" href="/consensus?slug=${encodeURIComponent(slug)}&metric=${encodeURIComponent(m.metric)}">view →</a></td>
              </tr>`
            )
            .join("")}
        </tbody></table>`;

  return `
<h2>PM Dashboard ${csBadge}</h2>
<style>
.edge-bar-wrap { margin: 8px 0 16px; }
.edge-bar-label { font-size: 12px; margin-bottom: 4px; }
.edge-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--bg-soft, #f5f5f4); }
.edge-seg { display: block; min-width: 1px; }
.edge-legends { margin-top: 6px; font-size: 12px; line-height: 1.6; }
.edge-legend { margin-right: 12px; white-space: nowrap; }
.edge-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
</style>
<div class="grid">
  <div class="card">
    <h3>Typed-edge breakdown</h3>
    ${renderTypeBar(lb.inbound, inboundTotal, "Inbound")}
    ${renderTypeBar(lb.outbound, outboundTotal, "Outbound")}
    <p class="muted" style="margin-top:8px;font-size:12px">
      consensus_strength = (confirms − contradicts) / (confirms + contradicts).
      区间 [-1, 1]：≥ 0.3 强共识；≤ -0.3 强争议；中间灰色。
    </p>
  </div>
  <div class="card">
    <h3>Consensus drift across sources</h3>
    ${consensusTable}
  </div>
</div>
`;
}

/** /consensus/:slug/:metric —— consensus drift 详情页（observations 时序 + 统计）。 */
export async function viewConsensus(
  slug: string,
  metric: string,
  period?: string
): Promise<string | null> {
  const result = (await consensusView({
    entity: slug,
    metric,
    period,
  })) as
    | {
        error?: string;
        entity: { slug: string; title: string };
        metric: string;
        period: string | null;
        observations: Array<{
          source_slug: string | null;
          source_title: string | null;
          period: string | null;
          value: number | string | null;
          unit: string | null;
          valid_from: string | null;
        }>;
        stats: {
          count: number;
          mean: number;
          std: number;
          min: number;
          max: number;
          range_pct: number;
          latest: number;
          earliest: number;
        } | null;
        drift: {
          direction: string;
          drift_pct?: number;
          first_half_avg?: number;
          second_half_avg?: number;
          outliers?: Array<{
            source_slug: string;
            period: string;
            value: number;
            deviation_pct: number;
          }>;
          note?: string;
        } | null;
      }
    | null;

  if (!result || result.error) {
    return layout({
      title: "Consensus not found",
      body: `<div class="empty">${escape(result?.error ?? "not found")}</div>`,
    });
  }

  const { entity, observations, stats, drift } = result;

  const obsTable =
    observations.length === 0
      ? `<div class="empty">no observations</div>`
      : `<table><thead><tr><th>Date</th><th>Period</th><th>Source</th><th>Value</th><th>Unit</th></tr></thead><tbody>
          ${observations
            .map(
              (o) => `<tr>
                <td class="muted">${escape(o.valid_from ?? "")}</td>
                <td>${escape(o.period ?? "")}</td>
                <td>${o.source_slug ? `<a href="${pageHref(o.source_slug)}">${escape(o.source_title ?? o.source_slug)}</a>` : "-"}</td>
                <td><strong>${formatFactDisplayValue({ value: o.value, unit: o.unit })}</strong></td>
                <td class="muted">${escape(formatFactUnit(o.unit))}</td>
              </tr>`
            )
            .join("")}
        </tbody></table>`;

  const statsBlock = stats
    ? `<div class="kv">
        <div class="k">count</div><div>${stats.count}</div>
        <div class="k">mean</div><div>${formatFactDisplayValue({ value: stats.mean, unit: observations[0]?.unit ?? null })}</div>
        <div class="k">std</div><div>${formatFactDisplayValue({ value: stats.std, unit: observations[0]?.unit ?? null })}</div>
        <div class="k">range</div><div>${formatFactDisplayValue({ value: stats.min, unit: observations[0]?.unit ?? null })} → ${formatFactDisplayValue({ value: stats.max, unit: observations[0]?.unit ?? null })} (${(stats.range_pct * 100).toFixed(0)}% of mean)</div>
        <div class="k">earliest → latest</div><div>${formatFactDisplayValue({ value: stats.earliest, unit: observations[0]?.unit ?? null })} → ${formatFactDisplayValue({ value: stats.latest, unit: observations[0]?.unit ?? null })}</div>
      </div>`
    : `<div class="muted">no numeric observations</div>`;

  const driftBlock =
    drift && drift.direction !== "insufficient_data"
      ? `<div class="kv">
          <div class="k">direction</div><div><span class="tag">${escape(drift.direction)}</span> ${drift.drift_pct !== undefined ? `(${(drift.drift_pct * 100).toFixed(1)}%)` : ""}</div>
          ${drift.first_half_avg !== undefined ? `<div class="k">first half avg</div><div>${formatFactDisplayValue({ value: drift.first_half_avg, unit: observations[0]?.unit ?? null })}</div>` : ""}
          ${drift.second_half_avg !== undefined ? `<div class="k">second half avg</div><div>${formatFactDisplayValue({ value: drift.second_half_avg, unit: observations[0]?.unit ?? null })}</div>` : ""}
        </div>
        ${(drift.outliers ?? []).length > 0
          ? `<h4 style="margin-top:12px">Outliers (|σ| > 1.5)</h4>
             <ul class="plain">
              ${(drift.outliers ?? [])
                .map(
                  (o) =>
                    `<li><a href="${pageHref(o.source_slug)}">${escape(o.source_slug)}</a> · ${escape(o.period)} · <strong>${formatFactDisplayValue({ value: o.value, unit: observations[0]?.unit ?? null })}</strong> · σ=${o.deviation_pct.toFixed(2)}</li>`
                )
                .join("")}
             </ul>`
          : `<p class="muted">no outliers (>1.5σ)</p>`}`
      : `<div class="muted">${escape(drift?.note ?? "insufficient data for drift analysis")}</div>`;

  const body = `
<div class="muted score" style="margin-bottom:8px;">
  <a href="${pageHref(entity.slug)}">← ${escape(entity.title ?? entity.slug)}</a>
</div>
<h2>Consensus drift: ${escape(entity.title ?? entity.slug)} / <code>${escape(metric)}</code></h2>
${period ? `<p class="muted">filter: period = ${escape(period)}</p>` : ""}

<div class="grid">
  <div class="card">
    <h3>Stats</h3>
    ${statsBlock}
  </div>
  <div class="card">
    <h3>Drift signal</h3>
    ${driftBlock}
  </div>
</div>

<h3>Observations (${observations.length})</h3>
${obsTable}
`;
  return layout({ title: `consensus / ${entity.slug} / ${metric}`, body });
}

/** /source-view/:id —— 整页渲染 raw markdown 为 HTML，新标签页打开用。 */
export async function viewSourceRaw(pageId: bigint): Promise<string | null> {
  const [p] = await db
    .select({
      title: schema.pages.title,
      slug: schema.pages.slug,
      type: schema.pages.type,
      frontmatter: schema.pages.frontmatter,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .limit(1);
  if (!p) return null;
  if (p.type !== "source" && p.type !== "brief") return null;

  const fm = (p.frontmatter ?? {}) as Record<string, unknown>;
  const url = typeof fm.markdown_url === "string" ? fm.markdown_url : null;
  if (!url) return null;

  let markdown: string;
  try {
    const resp = await fetch(url);
    markdown = resp.ok
      ? await resp.text()
      : `> ⚠️ failed to fetch markdown_url: HTTP ${resp.status}`;
  } catch (e) {
    markdown = `> ⚠️ fetch error: ${(e as Error).message}`;
  }

  const body = `
<div class="muted score" style="margin-bottom:8px;">
  <a href="${pageHref(p.slug)}">← 回到 ${escape(p.slug)}</a>
</div>
<h2>${escape(p.title ?? "原文")}</h2>
<div class="content">${renderMarkdown(markdown)}</div>
`;
  return layout({ title: `原文 · ${p.title ?? p.slug}`, body });
}

/**
 * 当 page.type === 'thesis' 时渲染管理 UI：
 * - 状态机字段（direction / conviction / status / 价格 / 日期）
 * - catalysts 列表 + 加催化剂表单
 * - validation conditions 列表 + 标 condition 状态表单
 * - 关仓表单
 * - narrative 编辑（textarea）
 */
async function renderThesisAdmin(pageId: bigint, currentContent: string): Promise<string> {
  const [t] = await db.execute(sql`
    SELECT direction, conviction, status, date_opened, date_closed,
           price_at_open, price_at_close, pm_owner,
           catalysts, validation_conditions
    FROM theses WHERE page_id = ${pageId} AND deleted = 0
  `) as unknown as Array<Record<string, unknown>>;
  if (!t) return "";

  const catalysts = (t.catalysts as Array<{ date: string; event: string; expected_impact: string }> | null) ?? [];
  const conditions = (t.validation_conditions as Array<{ condition: string; status: string; last_checked: string; evidence_signal_id?: string }> | null) ?? [];
  const status = String(t.status ?? "active");
  const isClosed = status === "closed" || status === "invalidated";

  return `
<h2>Thesis state</h2>
<div class="kv card">
  <div class="k">Direction</div><div>${escape(String(t.direction ?? ""))}</div>
  <div class="k">Conviction</div><div>${escape(String(t.conviction ?? ""))}</div>
  <div class="k">Status</div><div><span class="tag">${escape(status)}</span></div>
  <div class="k">PM owner</div><div>${escape(String(t.pm_owner ?? "-"))}</div>
  <div class="k">Date opened</div><div class="muted">${escape(String(t.date_opened ?? ""))}</div>
  <div class="k">Date closed</div><div class="muted">${escape(String(t.date_closed ?? "-"))}</div>
  <div class="k">Price at open</div><div>${escape(String(t.price_at_open ?? "-"))}</div>
  <div class="k">Price at close</div><div>${escape(String(t.price_at_close ?? "-"))}</div>
</div>

<h2>Catalysts (${catalysts.length})</h2>
${catalysts.length === 0
  ? `<div class="empty">no catalysts yet</div>`
  : `<table><thead><tr><th>Date</th><th>Event</th><th>Expected impact</th></tr></thead><tbody>
      ${catalysts
        .map(
          (c) =>
            `<tr>
              <td class="muted">${escape(c.date ?? "")}</td>
              <td>${escape(c.event ?? "")}</td>
              <td>${escape(c.expected_impact ?? "")}</td>
            </tr>`
        )
        .join("")}
    </tbody></table>`
}
${!isClosed ? `
<form method="post" action="/theses/${pageId}/catalyst" class="thesis-form inline-form">
  <h4>Add catalyst</h4>
  <div class="form-row">
    <label>Date</label>
    <input type="date" name="date" required>
  </div>
  <div class="form-row">
    <label>Event</label>
    <input type="text" name="event" required maxlength="200" placeholder="e.g. 2026 H1 results">
  </div>
  <div class="form-row">
    <label>Expected impact</label>
    <input type="text" name="expected_impact" maxlength="500" placeholder="why this matters for the thesis">
  </div>
  <div class="form-row form-actions">
    <button type="submit">Add catalyst</button>
  </div>
</form>` : ""}

<h2>Validation conditions (${conditions.length})</h2>
${conditions.length === 0
  ? `<div class="empty">no conditions yet</div>`
  : `<table><thead><tr><th>Condition</th><th>Status</th><th>Last checked</th><th>Signal</th></tr></thead><tbody>
      ${conditions
        .map(
          (c) =>
            `<tr>
              <td>${escape(c.condition ?? "")}</td>
              <td><span class="tag confidence-${c.status === "met" ? "high" : c.status === "unmet" || c.status === "invalidated" ? "low" : "medium"}">${escape(c.status ?? "")}</span></td>
              <td class="muted">${escape(c.last_checked ?? "")}</td>
              <td class="muted">${escape(c.evidence_signal_id ?? "")}</td>
            </tr>`
        )
        .join("")}
    </tbody></table>`
}
${!isClosed ? `
<form method="post" action="/theses/${pageId}/condition" class="thesis-form inline-form">
  <h4>Mark / add condition</h4>
  <div class="form-row">
    <label>Condition</label>
    <input type="text" name="condition" required maxlength="300" list="condition-options"
           placeholder="e.g. 2026 H1 corp insurance revenue ≥CNY 60m">
    <datalist id="condition-options">
      ${conditions.map((c) => `<option value="${escape(c.condition)}"></option>`).join("")}
    </datalist>
    <span class="form-hint">existing condition → updates its status; new text → appends</span>
  </div>
  <div class="form-row">
    <label>Status</label>
    <select name="status" required>
      <option value="pending">pending</option>
      <option value="met">met</option>
      <option value="unmet">unmet</option>
      <option value="invalidated">invalidated</option>
    </select>
  </div>
  <div class="form-row">
    <label>Evidence signal id (optional)</label>
    <input type="text" name="evidence_signal_id" placeholder="signals.id">
  </div>
  <div class="form-row form-actions">
    <button type="submit">Update condition</button>
  </div>
</form>` : ""}

<h2>Narrative</h2>
<details class="narrative-edit">
  <summary>Edit narrative</summary>
  <form method="post" action="/theses/${pageId}/narrative" class="thesis-form" style="margin-top: 12px;">
    <textarea name="narrative" rows="20" style="width: 100%; font-family: ui-monospace, monospace; font-size: 13px; padding: 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg);">${escape(currentContent)}</textarea>
    <div class="form-row form-actions">
      <button type="submit">Save narrative</button>
      <span class="muted form-hint" style="margin-left: 12px;">overwrites pages.content; writes a page_versions snapshot</span>
    </div>
  </form>
</details>

${!isClosed ? `
<h2>Close thesis</h2>
<form method="post" action="/theses/${pageId}/close" class="thesis-form inline-form danger">
  <div class="form-row">
    <label>Reason</label>
    <select name="reason" required>
      <option value="validated">validated</option>
      <option value="invalidated">invalidated</option>
      <option value="stop_loss">stop_loss</option>
      <option value="manual">manual</option>
    </select>
  </div>
  <div class="form-row">
    <label>Price at close (optional)</label>
    <input type="text" name="price_at_close" placeholder="e.g. 850">
  </div>
  <div class="form-row">
    <label>Note (optional)</label>
    <textarea name="note" rows="4" placeholder="retrospective lesson; gets appended to narrative"></textarea>
  </div>
  <div class="form-row form-actions">
    <button type="submit" class="btn-danger" onclick="return confirm('Close this thesis?')">Close</button>
  </div>
</form>
` : ""}
`;
}

function formatFactValue(f: {
  value_numeric?: string | null;
  value_text?: string | null;
  unit?: string | null;
}): string {
  return formatFactDisplayValue({
    value: f.value_numeric ?? f.value_text ?? "",
    unit: f.unit ?? null,
  });
}

function formatFactDisplayValue(f: {
  value?: number | string | null;
  unit?: string | null;
}): string {
  const unit = f.unit ?? null;
  const value = f.value ?? "";
  if (unit === "pct") {
    return `${escape(formatPctValue(value))}<span class="muted">%</span>`;
  }
  return `${escape(String(value))}${unit ? ` <span class="muted">${escape(unit)}</span>` : ""}`;
}

function formatFactUnit(unit: string | null | undefined): string {
  return unit === "pct" ? "%" : String(unit ?? "");
}

function formatPctValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" && /[<>≤≥~≈+]|(?:\d)\s*[-–—]\s*(?:\d)/.test(value)) {
    return value.replace(/\s*%$/, "");
  }
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return String(value).replace(/\s*%$/, "");
  const pct = Math.abs(numeric) <= 1.5 ? numeric * 100 : numeric;
  if (Number.isInteger(pct)) return String(pct);
  return pct.toFixed(2).replace(/\.?0+$/, "");
}

// ============================================================================
// /theses
// ============================================================================

/** /theses/new — open form for PMs */
export async function viewThesisNew(
  prefill: { error?: string } = {}
): Promise<string> {
  // 候选 target：active 的 entity 类页（company / industry / concept），confidence != 'low' 优先
  const candidates = await db.execute(sql`
    SELECT slug, title, type, confidence
    FROM pages
    WHERE deleted = 0
      AND type IN ('company', 'industry', 'concept')
      AND (status = 'active' OR status IS NULL)
    ORDER BY (confidence = 'high') DESC, (confidence = 'medium') DESC, title
    LIMIT 500
  `);

  const today = fmtSh(new Date(), "date");

  const datalist = (candidates as unknown as Array<Record<string, unknown>>)
    .map(
      (c) =>
        `<option value="${escape(String(c.slug))}">${escape(String(c.title ?? ""))} · ${escape(String(c.type ?? ""))} · ${escape(String(c.confidence ?? "low"))}</option>`
    )
    .join("");

  const body = `
<h2>Open new thesis</h2>
${prefill.error ? `<div class="flash" style="color: var(--negative); border-left: 3px solid var(--negative); padding-left: 12px;">${escape(prefill.error)}</div>` : ""}

<form class="thesis-form" method="post" action="/theses">
  <div class="form-row">
    <label>Target</label>
    <input type="text" name="target" list="target-options" required
           placeholder="companies/NVIDIA" autocomplete="off">
    <datalist id="target-options">${datalist}</datalist>
    <span class="form-hint">slug of an existing company / industry / concept page</span>
  </div>

  <div class="form-row">
    <label>Direction</label>
    <select name="direction" required>
      <option value="long" selected>long</option>
      <option value="short">short</option>
      <option value="pair">pair</option>
      <option value="neutral">neutral</option>
    </select>
  </div>

  <div class="form-row">
    <label>Conviction</label>
    <select name="conviction">
      <option value="medium" selected>medium</option>
      <option value="high">high</option>
      <option value="low">low</option>
    </select>
  </div>

  <div class="form-row">
    <label>Name</label>
    <input type="text" name="name" required
           placeholder="e.g. Sipai brokerage replacement + 2026 profitability"
           maxlength="200">
    <span class="form-hint">used as title + slug; English preferred</span>
  </div>

  <div class="form-row">
    <label>Owner (optional)</label>
    <input type="text" name="owner" placeholder="PM:levin">
  </div>

  <div class="form-row">
    <label>Date opened</label>
    <input type="date" name="date_opened" value="${today}" required>
  </div>

  <div class="form-row">
    <label>Open price (optional)</label>
    <input type="text" name="price_at_open" placeholder="e.g. 1100">
  </div>

  <div class="form-row form-actions">
    <button type="submit">Open thesis</button>
    <a href="/theses" class="muted" style="margin-left: 12px;">cancel</a>
  </div>
</form>
`;
  return layout({ title: "Open thesis", body });
}

export async function viewTheses(
  status: string | undefined,
  pageReq: PageRequest
): Promise<string> {
  const SORT = pickSortField(
    pageReq,
    ["date_opened", "status", "direction", "conviction", "create_time"] as const,
    "date_opened"
  );

  const statusClause = status ? sql`AND t.status = ${status}` : sql``;

  const totalRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM theses t
    JOIN pages p ON p.id = t.page_id
    WHERE t.deleted = 0 AND p.deleted = 0
      ${statusClause}
  `);
  const totalCount = (totalRows[0] as { n: number } | undefined)?.n ?? 0;

  const orderByExpr =
    SORT.field === "date_opened" ? sql`t.date_opened` :
    SORT.field === "status" ? sql`t.status` :
    SORT.field === "direction" ? sql`t.direction` :
    SORT.field === "conviction" ? sql`t.conviction` :
    sql`t.create_time`;
  const dir = SORT.order === "ASC" ? sql`ASC` : sql`DESC`;

  const rows = await db.execute(sql`
    SELECT t.page_id::text AS page_id,
           p.slug, p.title,
           t.direction, t.conviction, t.status, t.date_opened,
           tgt.slug AS target_slug
    FROM theses t
    JOIN pages p ON p.id = t.page_id
    LEFT JOIN pages tgt ON tgt.id = t.target_page_id
    WHERE t.deleted = 0 AND p.deleted = 0
      ${statusClause}
    ORDER BY ${orderByExpr} ${dir} NULLS LAST, t.page_id
    LIMIT ${pageReq.pageSize} OFFSET ${offsetOf(pageReq)}
  `);

  const result = buildPageResult(rows, totalCount, pageReq);
  const keptParams = {
    status,
    sortField: pageReq.sortField,
    sortOrder: pageReq.sortOrder,
  };
  const sortHeader = (label: string, field: string) =>
    sortableHeader({
      label,
      field,
      basePath: "/theses",
      keptParams: { status, pageSize: String(pageReq.pageSize) },
      currentField: SORT.field,
      currentOrder: SORT.order,
    });

  const body = `
<div class="row">
  <h2 class="grow">Theses (${totalCount})</h2>
  <a href="/theses/new" class="btn-primary">+ New thesis</a>
</div>
<form class="filter" method="get" action="/theses">
  <input type="hidden" name="pageSize" value="${pageReq.pageSize}">
  <select name="status" onchange="this.form.submit()">
    <option value="">all</option>
    ${["active", "monitoring", "closed", "invalidated"]
      .map((s) => `<option value="${s}"${status === s ? " selected" : ""}>${s}</option>`)
      .join("")}
  </select>
</form>
${rows.length === 0
  ? `<div class="empty">no theses</div>`
  : `<table>
      <thead><tr>
        <th>Name</th>
        <th>Target</th>
        ${sortHeader("Direction", "direction")}
        ${sortHeader("Conviction", "conviction")}
        ${sortHeader("Status", "status")}
        ${sortHeader("Opened", "date_opened")}
      </tr></thead>
      <tbody>
      ${rows
        .map(
          (r) => `<tr>
            <td><a href="/pages/${escape(String(r.page_id))}">${escape(String(r.title ?? ""))}</a></td>
            <td>${r.target_slug ? `<a href="${pageHref(String(r.target_slug))}">${escape(String(r.target_slug))}</a>` : ""}</td>
            <td>${escape(String(r.direction ?? ""))}</td>
            <td>${escape(String(r.conviction ?? ""))}</td>
            <td><span class="tag">${escape(String(r.status ?? ""))}</span></td>
            <td class="muted">${escape(String(r.date_opened ?? ""))}</td>
          </tr>`
        )
        .join("")}
      </tbody>
    </table>`
}
${renderPagination(result, "/theses", keptParams)}
`;
  return layout({ title: "Theses", body });
}

// ============================================================================
// /entities
// ============================================================================

export async function viewEntities(
  opts: {
    type?: string;
    sector?: string;
    ticker?: string;
    confidence?: string;
  },
  pageReq: PageRequest
): Promise<string> {
  const SORT = pickSortField(
    pageReq,
    ["title", "update_time", "create_time", "ticker", "sector", "confidence", "type"] as const,
    "update_time"
  );

  const conds = [sql`p.deleted = 0`, sql`p.status != 'archived'`, sql`p.type IN ('company','industry','concept')`];
  if (opts.type) conds.push(sql`p.type = ${opts.type}`);
  if (opts.sector) conds.push(sql`p.sector = ${opts.sector}`);
  if (opts.ticker) conds.push(sql`p.ticker = ${opts.ticker}`);
  if (opts.confidence) conds.push(sql`p.confidence = ${opts.confidence}`);

  // 用 join 拼 WHERE 子句
  const whereClause = conds.reduce<ReturnType<typeof sql>>(
    (acc, c, i) => (i === 0 ? c : sql`${acc} AND ${c}`),
    sql``
  );

  const totalRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM pages p WHERE ${whereClause}
  `);
  const totalCount = (totalRows[0] as { n: number } | undefined)?.n ?? 0;

  const orderByExpr =
    SORT.field === "title" ? sql`p.title` :
    SORT.field === "create_time" ? sql`p.create_time` :
    SORT.field === "ticker" ? sql`p.ticker` :
    SORT.field === "sector" ? sql`p.sector` :
    SORT.field === "confidence" ? sql`p.confidence` :
    SORT.field === "type" ? sql`p.type` :
    sql`p.update_time`;
  const dir = SORT.order === "ASC" ? sql`ASC` : sql`DESC`;

  const rows = await db.execute(sql`
    SELECT p.id::text AS id, p.slug, p.type, p.title,
           p.ticker, p.sector, p.confidence
    FROM pages p
    WHERE ${whereClause}
    ORDER BY ${orderByExpr} ${dir} NULLS LAST, p.id
    LIMIT ${pageReq.pageSize} OFFSET ${offsetOf(pageReq)}
  `);

  const result = buildPageResult(rows, totalCount, pageReq);
  const keptParams = {
    type: opts.type,
    sector: opts.sector,
    ticker: opts.ticker,
    confidence: opts.confidence,
    sortField: pageReq.sortField,
    sortOrder: pageReq.sortOrder,
  };
  const headerKept = {
    type: opts.type,
    sector: opts.sector,
    ticker: opts.ticker,
    confidence: opts.confidence,
    pageSize: String(pageReq.pageSize),
  };
  const sortHeader = (label: string, field: string) =>
    sortableHeader({
      label,
      field,
      basePath: "/entities",
      keptParams: headerKept,
      currentField: SORT.field,
      currentOrder: SORT.order,
    });

  const body = `
<h2>Entities (${totalCount})</h2>
<form class="filter" method="get" action="/entities">
  <input type="hidden" name="pageSize" value="${pageReq.pageSize}">
  <select name="type">
    <option value="">all types</option>
    ${["company", "industry", "concept"]
      .map((t) => `<option value="${t}"${opts.type === t ? " selected" : ""}>${t}</option>`)
      .join("")}
  </select>
  <select name="confidence">
    <option value="">all confidence</option>
    ${["low", "medium", "high"]
      .map((c) => `<option value="${c}"${opts.confidence === c ? " selected" : ""}>${c}</option>`)
      .join("")}
  </select>
  <input type="text" name="ticker" placeholder="ticker" value="${escape(opts.ticker ?? "")}">
  <input type="text" name="sector" placeholder="sector" value="${escape(opts.sector ?? "")}">
  <button class="btn" type="submit">filter</button>
</form>
${rows.length === 0
  ? `<div class="empty">no entities</div>`
  : `<table>
      <thead><tr>
        ${sortHeader("Title", "title")}
        ${sortHeader("Type", "type")}
        ${sortHeader("Ticker", "ticker")}
        ${sortHeader("Sector", "sector")}
        ${sortHeader("Confidence", "confidence")}
      </tr></thead>
      <tbody>
      ${rows
        .map(
          (r) => `<tr>
            <td><a href="${pageHref(String(r.slug ?? ""))}">${escape(String(r.title ?? ""))}</a> <span class="muted score">${escape(String(r.slug ?? ""))}</span></td>
            <td>${pageTag(String(r.type ?? ""))}</td>
            <td>${escape(String(r.ticker ?? ""))}</td>
            <td>${escape(String(r.sector ?? ""))}</td>
            <td>${confidenceTag(r.confidence as string | null)}</td>
          </tr>`
        )
        .join("")}
      </tbody>
    </table>`
}
${renderPagination(result, "/entities", keptParams)}
`;
  return layout({ title: "Entities", body });
}

// ============================================================================
// /outputs[/:filename]
// ============================================================================

interface OutputFile { name: string; mtime: string; size: number; }

async function listOutputFiles(): Promise<OutputFile[]> {
  const dir = path.resolve(env.WORKSPACE_DIR, "wiki/output");
  try {
    const files = await fs.readdir(dir);
    const md = files.filter((f) => f.endsWith(".md")).sort().reverse();
    const stats = await Promise.all(
      md.map(async (name) => {
        const s = await fs.stat(path.join(dir, name));
        return {
          name,
          mtime: fmtSh(s.mtime),
          size: s.size,
        };
      })
    );
    return stats;
  } catch {
    return [];
  }
}

export async function viewOutputs(): Promise<string> {
  const files = await listOutputFiles();
  const body = `
<h2>Outputs (${files.length})</h2>
<p class="muted">Generated by <code>$ae-daily-review</code> / <code>$ae-daily-summarize</code> into <code>wiki/output/</code>.</p>
${files.length === 0
  ? `<div class="empty">no outputs</div>`
  : `<ul class="plain">${files
      .map(
        (f) =>
          `<li><div class="row"><div class="grow"><a href="/outputs/${encodeURIComponent(f.name)}">${escape(f.name)}</a></div><span class="muted score">${escape(f.mtime)} · ${f.size} bytes</span></div></li>`
      )
      .join("")}</ul>`
}
`;
  return layout({ title: "Outputs", body });
}

export async function viewOutputFile(filename: string): Promise<string> {
  if (filename.includes("/") || filename.includes("..")) {
    return layout({ title: "Bad request", body: `<div class="empty">bad filename</div>` });
  }
  const dir = path.resolve(env.WORKSPACE_DIR, "wiki/output");
  const fp = path.join(dir, filename);
  let content: string;
  try {
    content = await fs.readFile(fp, "utf8");
  } catch {
    return layout({
      title: "Not found",
      body: `<div class="empty">file not found: ${escape(filename)}</div>`,
    });
  }
  const body = `
<div class="row">
  <div class="grow"><h2 style="border:none;margin-bottom:0;">${escape(filename)}</h2></div>
  <a class="btn" href="/outputs">← all outputs</a>
</div>
<div class="content">${renderMarkdown(content)}</div>
`;
  return layout({ title: filename, body });
}

// ============================================================================
// /queue
// ============================================================================

export async function viewQueue(
  opts: { name?: string; status?: string },
  pageReq: PageRequest
): Promise<string> {
  const byStatus = await db.execute(sql`
    SELECT name, status, COUNT(*)::int AS n
    FROM minion_jobs
    WHERE deleted = 0
    GROUP BY name, status
    ORDER BY name, status
  `);

  const SORT = pickSortField(
    pageReq,
    ["create_time", "started_at", "finished_at", "status", "name", "attempts"] as const,
    "create_time"
  );

  const conds = [sql`deleted = 0`];
  if (opts.name) conds.push(sql`name = ${opts.name}`);
  if (opts.status) conds.push(sql`status = ${opts.status}`);
  const where = conds.reduce<ReturnType<typeof sql>>(
    (acc, c, i) => (i === 0 ? c : sql`${acc} AND ${c}`),
    sql``
  );

  const totalRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM minion_jobs WHERE ${where}
  `);
  const totalCount = (totalRows[0] as { n: number } | undefined)?.n ?? 0;

  const orderByExpr =
    SORT.field === "started_at" ? sql`started_at` :
    SORT.field === "finished_at" ? sql`finished_at` :
    SORT.field === "status" ? sql`status` :
    SORT.field === "name" ? sql`name` :
    SORT.field === "attempts" ? sql`attempts` :
    sql`create_time`;
  const dir = SORT.order === "ASC" ? sql`ASC` : sql`DESC`;

  const recentJobs = await db.execute(sql`
    SELECT id::text AS id, name, status, attempts, max_attempts,
           started_at, finished_at, create_time, error
    FROM minion_jobs
    WHERE ${where}
    ORDER BY ${orderByExpr} ${dir} NULLS LAST, id DESC
    LIMIT ${pageReq.pageSize} OFFSET ${offsetOf(pageReq)}
  `);

  const result = buildPageResult(recentJobs, totalCount, pageReq);
  const keptParams = {
    name: opts.name,
    status: opts.status,
    sortField: pageReq.sortField,
    sortOrder: pageReq.sortOrder,
  };
  const headerKept = {
    name: opts.name,
    status: opts.status,
    pageSize: String(pageReq.pageSize),
  };
  const sortHeader = (label: string, field: string) =>
    sortableHeader({
      label,
      field,
      basePath: "/queue",
      keptParams: headerKept,
      currentField: SORT.field,
      currentOrder: SORT.order,
    });

  const distinctNames = Array.from(new Set(byStatus.map((r) => String(r.name))));

  const body = `
<h2>Job queue</h2>
<div class="card">
  <h3>By name × status</h3>
  ${byStatus.length === 0
    ? `<div class="empty">no jobs</div>`
    : `<table><thead><tr><th>Name</th><th>Status</th><th>Count</th></tr></thead><tbody>
        ${byStatus
          .map(
            (r) =>
              `<tr><td>${escape(String(r.name))}</td><td><span class="tag severity-${r.status === "failed" ? "warning" : "info"}">${escape(String(r.status))}</span></td><td>${r.n}</td></tr>`
          )
          .join("")}
      </tbody></table>`
  }
</div>

<h3>Jobs (${totalCount})</h3>
<form class="filter" method="get" action="/queue">
  <input type="hidden" name="pageSize" value="${pageReq.pageSize}">
  <select name="name" onchange="this.form.submit()">
    <option value="">all names</option>
    ${distinctNames
      .map((n) => `<option value="${escape(n)}"${opts.name === n ? " selected" : ""}>${escape(n)}</option>`)
      .join("")}
  </select>
  <select name="status" onchange="this.form.submit()">
    <option value="">all status</option>
    ${["waiting", "active", "paused", "completed", "failed", "cancelled"]
      .map((s) => `<option value="${s}"${opts.status === s ? " selected" : ""}>${s}</option>`)
      .join("")}
  </select>
</form>
${recentJobs.length === 0
  ? `<div class="empty">no jobs match</div>`
  : `<table>
    <thead><tr>
      <th>ID</th>
      ${sortHeader("Name", "name")}
      ${sortHeader("Status", "status")}
      ${sortHeader("Attempts", "attempts")}
      ${sortHeader("Created", "create_time")}
      <th>Error</th>
    </tr></thead>
    <tbody>
    ${recentJobs
      .map(
        (j) => `<tr>
          <td class="muted score">${j.id}</td>
          <td>${escape(String(j.name))}</td>
          <td><span class="tag severity-${j.status === "failed" ? "warning" : "info"}">${escape(String(j.status))}</span></td>
          <td>${j.attempts}/${j.max_attempts}</td>
          <td class="muted score">${escape(fmtSh(j.create_time as string))}</td>
          <td class="muted">${j.error ? escape(String(j.error).slice(0, 80)) : ""}</td>
        </tr>`
      )
      .join("")}
    </tbody>
  </table>`
}
${renderPagination(result, "/queue", keptParams)}
`;
  return layout({ title: "Queue", body });
}

// ============================================================================
// /usage  —— LLM token 用量
// ============================================================================

/**
 * 单价（USD per 1M tokens）。OpenAI 价格随时间变动，env 可覆盖：
 *   PRICE_INPUT_USD_PER_1M     默认 0.30
 *   PRICE_OUTPUT_USD_PER_1M    默认 2.50
 *   PRICE_EMBEDDING_USD_PER_1M 默认 0.13
 * 仅供粗估，权威账单以 OpenAI 后台为准。
 */
function pricesUsd(): { input: number; output: number; embedding: number } {
  return {
    input: parseFloat(process.env.PRICE_INPUT_USD_PER_1M ?? "0.30"),
    output: parseFloat(process.env.PRICE_OUTPUT_USD_PER_1M ?? "2.50"),
    embedding: parseFloat(process.env.PRICE_EMBEDDING_USD_PER_1M ?? "0.13"),
  };
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US");
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(4)}`;
}

export async function viewUsage(): Promise<string> {
  const prices = pricesUsd();

  const totalsRows = (await db.execute(sql`
    WITH t AS (
      SELECT 'today' AS bucket, (NOW() AT TIME ZONE 'Asia/Shanghai')::date AS since UNION ALL
      SELECT 'last_7d', ((NOW() - INTERVAL '7 days') AT TIME ZONE 'Asia/Shanghai')::date UNION ALL
      SELECT 'last_30d', ((NOW() - INTERVAL '30 days') AT TIME ZONE 'Asia/Shanghai')::date
    )
    SELECT
      t.bucket,
      COALESCE(SUM(u.tokens_in), 0)::bigint AS tokens_in,
      COALESCE(SUM(u.tokens_out), 0)::bigint AS tokens_out,
      COUNT(u.id)::bigint AS calls,
      COALESCE(SUM(CASE WHEN u.source = 'embedding' THEN u.total_tokens ELSE 0 END), 0)::bigint AS embed_tokens,
      COALESCE(SUM(CASE WHEN u.source != 'embedding' THEN u.tokens_in ELSE 0 END), 0)::bigint AS chat_in,
      COALESCE(SUM(CASE WHEN u.source != 'embedding' THEN u.tokens_out ELSE 0 END), 0)::bigint AS chat_out
    FROM t
    LEFT JOIN llm_usage u
      ON u.deleted = 0 AND u.create_time >= t.since
    GROUP BY t.bucket
  `)) as unknown as Array<{
    bucket: string;
    tokens_in: string | number;
    tokens_out: string | number;
    calls: string | number;
    embed_tokens: string | number;
    chat_in: string | number;
    chat_out: string | number;
  }>;

  const buckets = new Map(totalsRows.map((r) => [r.bucket, r]));
  const card = (label: string, key: string) => {
    const row = buckets.get(key);
    const tin = row ? Number(row.tokens_in) : 0;
    const tout = row ? Number(row.tokens_out) : 0;
    const calls = row ? Number(row.calls) : 0;
    const embedTok = row ? Number(row.embed_tokens) : 0;
    const chatIn = row ? Number(row.chat_in) : 0;
    const chatOut = row ? Number(row.chat_out) : 0;
    const cost =
      (chatIn / 1e6) * prices.input +
      (chatOut / 1e6) * prices.output +
      (embedTok / 1e6) * prices.embedding;
    return `
<div class="card">
  <h3 style="margin:0 0 6px;">${escape(label)}</h3>
  <div class="kv" style="grid-template-columns: 110px 1fr;">
    <div class="k">Calls</div><div>${fmtNum(calls)}</div>
    <div class="k">Tokens in</div><div>${fmtNum(tin)}</div>
    <div class="k">Tokens out</div><div>${fmtNum(tout)}</div>
    <div class="k">Embed tokens</div><div>${fmtNum(embedTok)}</div>
    <div class="k">Est. cost</div><div>${fmtUsd(cost)}</div>
  </div>
</div>`;
  };

  const sourceRows = (await db.execute(sql`
    SELECT
      source,
      COALESCE(model, 'unknown') AS model,
      SUM(COALESCE(tokens_in, 0))::bigint   AS tokens_in,
      SUM(COALESCE(tokens_out, 0))::bigint  AS tokens_out,
      SUM(COALESCE(total_tokens, 0))::bigint AS total_tokens,
      COUNT(*)::bigint AS calls
    FROM llm_usage
    WHERE deleted = 0
      AND create_time >= NOW() - INTERVAL '30 days'
    GROUP BY source, model
    ORDER BY SUM(COALESCE(total_tokens, COALESCE(tokens_in,0) + COALESCE(tokens_out,0))) DESC NULLS LAST
  `)) as unknown as Array<{
    source: string;
    model: string;
    tokens_in: string | number;
    tokens_out: string | number;
    total_tokens: string | number;
    calls: string | number;
  }>;

  const skillRows = (await db.execute(sql`
    SELECT
      COALESCE(j.data->>'skill', '(no skill)') AS skill,
      COALESCE(u.model, 'unknown') AS model,
      SUM(COALESCE(u.tokens_in, 0))::bigint  AS tokens_in,
      SUM(COALESCE(u.tokens_out, 0))::bigint AS tokens_out,
      COUNT(*)::bigint AS calls,
      COUNT(DISTINCT u.job_id)::bigint AS jobs
    FROM llm_usage u
    LEFT JOIN minion_jobs j ON j.id = u.job_id
    WHERE u.deleted = 0
      AND u.source = 'agent_runtime'
      AND u.create_time >= NOW() - INTERVAL '30 days'
    GROUP BY skill, u.model
    ORDER BY SUM(COALESCE(u.tokens_in, 0)) DESC NULLS LAST
    LIMIT 50
  `)) as unknown as Array<{
    skill: string;
    model: string;
    tokens_in: string | number;
    tokens_out: string | number;
    calls: string | number;
    jobs: string | number;
  }>;

  const dailyRows = (await db.execute(sql`
    SELECT
      DATE_TRUNC('day', create_time AT TIME ZONE 'Asia/Shanghai')::date AS day,
      source,
      SUM(COALESCE(tokens_in, 0))::bigint   AS tokens_in,
      SUM(COALESCE(tokens_out, 0))::bigint  AS tokens_out,
      SUM(COALESCE(total_tokens, 0))::bigint AS total_tokens,
      COUNT(*)::bigint AS calls
    FROM llm_usage
    WHERE deleted = 0
      AND create_time >= NOW() - INTERVAL '30 days'
    GROUP BY 1, 2
    ORDER BY 1 DESC, source
  `)) as unknown as Array<{
    day: string;
    source: string;
    tokens_in: string | number;
    tokens_out: string | number;
    total_tokens: string | number;
    calls: string | number;
  }>;

  const recentRows = (await db.execute(sql`
    SELECT
      u.id, u.source, u.model, u.tokens_in, u.tokens_out, u.total_tokens,
      u.job_id, u.metadata, u.create_time,
      j.name AS job_name, j.data->>'skill' AS skill
    FROM llm_usage u
    LEFT JOIN minion_jobs j ON j.id = u.job_id
    WHERE u.deleted = 0
    ORDER BY u.create_time DESC
    LIMIT 50
  `)) as unknown as Array<{
    id: string | number;
    source: string;
    model: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
    total_tokens: number | null;
    job_id: string | number | null;
    metadata: Record<string, unknown> | null;
    create_time: string;
    job_name: string | null;
    skill: string | null;
  }>;

  const costForRow = (source: string, tin: number, tout: number, total: number) => {
    if (source === "embedding") return (total / 1e6) * prices.embedding;
    return (tin / 1e6) * prices.input + (tout / 1e6) * prices.output;
  };

  const body = `
<h2>LLM Token Usage</h2>
<p class="muted" style="margin-top:0;">
  数据源 = <code>llm_usage</code> 表，覆盖 6 个调用点：
  embedding / agent_runtime / web_chat / fact_extract / chunker_llm / query_expansion。
</p>

<h3>概览（最近窗口）</h3>
<div class="grid" style="grid-template-columns: 1fr 1fr 1fr;">
  ${card("Today", "today")}
  ${card("Last 7 days", "last_7d")}
  ${card("Last 30 days", "last_30d")}
</div>

<h3>按 source × model 聚合（30d）</h3>
${sourceRows.length === 0
  ? `<div class="empty">no usage in last 30 days</div>`
  : `<table>
    <thead><tr>
      <th>Source</th><th>Model</th>
      <th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Total</th>
      <th>Est. cost</th>
    </tr></thead>
    <tbody>
    ${sourceRows
      .map((r) => {
        const tin = Number(r.tokens_in);
        const tout = Number(r.tokens_out);
        const total = Number(r.total_tokens);
        const cost = costForRow(r.source, tin, tout, total);
        return `<tr>
          <td><span class="tag">${escape(r.source)}</span></td>
          <td class="muted score">${escape(r.model)}</td>
          <td>${fmtNum(Number(r.calls))}</td>
          <td>${fmtNum(tin)}</td>
          <td>${fmtNum(tout)}</td>
          <td>${fmtNum(total)}</td>
          <td class="score">${fmtUsd(cost)}</td>
        </tr>`;
      })
      .join("")}
    </tbody>
  </table>`
}

<h3>按 skill × model 聚合（agent_runtime, 30d）</h3>
${skillRows.length === 0
  ? `<div class="empty">no agent_runtime usage in last 30 days</div>`
  : `<table>
    <thead><tr>
      <th>Skill</th><th>Model</th>
      <th>Jobs</th><th>Calls</th>
      <th>Tokens in</th><th>Tokens out</th><th>Est. cost</th>
    </tr></thead>
    <tbody>
    ${skillRows
      .map((r) => {
        const tin = Number(r.tokens_in);
        const tout = Number(r.tokens_out);
        const cost = (tin / 1e6) * prices.input + (tout / 1e6) * prices.output;
        return `<tr>
          <td>${escape(r.skill)}</td>
          <td class="muted score">${escape(r.model)}</td>
          <td>${fmtNum(Number(r.jobs))}</td>
          <td>${fmtNum(Number(r.calls))}</td>
          <td>${fmtNum(tin)}</td>
          <td>${fmtNum(tout)}</td>
          <td class="score">${fmtUsd(cost)}</td>
        </tr>`;
      })
      .join("")}
    </tbody>
  </table>`
}

<h3>每日趋势（30d，按 source）</h3>
${dailyRows.length === 0
  ? `<div class="empty">no usage</div>`
  : `<table>
    <thead><tr>
      <th>Day</th><th>Source</th>
      <th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Total</th><th>Est. cost</th>
    </tr></thead>
    <tbody>
    ${dailyRows
      .map((r) => {
        const tin = Number(r.tokens_in);
        const tout = Number(r.tokens_out);
        const total = Number(r.total_tokens);
        const cost = costForRow(r.source, tin, tout, total);
        return `<tr>
          <td class="score">${escape(String(r.day).slice(0, 10))}</td>
          <td><span class="tag">${escape(r.source)}</span></td>
          <td>${fmtNum(Number(r.calls))}</td>
          <td>${fmtNum(tin)}</td>
          <td>${fmtNum(tout)}</td>
          <td>${fmtNum(total)}</td>
          <td class="score">${fmtUsd(cost)}</td>
        </tr>`;
      })
      .join("")}
    </tbody>
  </table>`
}

<h3>最近 50 条记录</h3>
${recentRows.length === 0
  ? `<div class="empty">no records yet — 跑一次 ingest / search / chat 后回看</div>`
  : `<table>
    <thead><tr>
      <th>Time</th><th>Source</th><th>Model</th>
      <th>Skill / Job</th>
      <th>In</th><th>Out</th><th>Total</th>
    </tr></thead>
    <tbody>
    ${recentRows
      .map((r) => {
        const tin = r.tokens_in == null ? 0 : Number(r.tokens_in);
        const tout = r.tokens_out == null ? 0 : Number(r.tokens_out);
        const total = r.total_tokens == null ? 0 : Number(r.total_tokens);
        const skillOrJob = r.skill
          ? escape(r.skill)
          : r.job_id
          ? `#${r.job_id}${r.job_name ? ` <span class="tag">${escape(r.job_name)}</span>` : ""}`
          : "";
        return `<tr>
          <td class="muted score">${escape(fmtSh(r.create_time as string))}</td>
          <td><span class="tag">${escape(r.source)}</span></td>
          <td class="muted score">${escape(r.model ?? "")}</td>
          <td>${skillOrJob}</td>
          <td>${fmtNum(tin)}</td>
          <td>${fmtNum(tout)}</td>
          <td>${fmtNum(total)}</td>
        </tr>`;
      })
      .join("")}
    </tbody>
  </table>`
}

<p class="muted" style="margin-top: 32px;">
  价格估算单价：chat input <code>$${prices.input}</code> / 1M，chat output <code>$${prices.output}</code> / 1M，
  embedding <code>$${prices.embedding}</code> / 1M。env
  <code>PRICE_INPUT_USD_PER_1M</code> / <code>PRICE_OUTPUT_USD_PER_1M</code> /
  <code>PRICE_EMBEDDING_USD_PER_1M</code> 可覆盖。仅供粗估，权威账单以 OpenAI 后台为准。
</p>
`;
  return layout({ title: "Token Usage", body });
}
