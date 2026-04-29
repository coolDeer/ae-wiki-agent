/**
 * Web UI 视图层。
 *
 * 每个视图函数返回 HTML 字符串。共用 templates.ts 的 layout / 组件 / 转义。
 * 数据访问全部走已有模块（mcp/queries / skills/thesis / skills/lint / 直接 SQL），
 * 不重新写查询逻辑。
 */

import { sql } from "drizzle-orm";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { db, schema } from "~/core/db.ts";
import { getEnv } from "~/core/env.ts";
import {
  search as mcpSearch,
  getPage,
  recentActivity,
  queryFacts,
} from "~/mcp/queries.ts";
// thesis CLI is read directly via SQL in viewTheses to support pagination.

import { getSessionTurns, type ChatTurn } from "./chat.ts";

import {
  confidenceTag,
  escape,
  highlightSnippet,
  layout,
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
  const safe = escapeHtml(text)
    .replace(/\\\\\\\[\\\\\\\[([^\\\]\\\|]+)(?:\\\\\\\|([^\\\]]+))?\\\\\\\]\\\\\\\]/g, (_m, slug, label) =>
      '<a class="wikilink" href="/pages/' + encodeURIComponent(slug) + '">' + (label||slug) + '</a>')
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
    meta.textContent = new Date().toLocaleTimeString();
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
  return `<div class="chat-bubble assistant">${renderMarkdown(t.content)}${tools}<div class="meta">${escape(t.ts.slice(11, 19))}</div></div>`;
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
            <div class="grow">${pageTag(p.type)} <a href="/pages/${encodeURIComponent(p.slug)}">${escape(p.title ?? p.slug)}</a></div>
            <span class="muted score">${escape(String(p.ts).slice(0, 10))}</span>
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
  const ts = `<span class="muted score">${escape(String(r.ts).slice(0, 19).replace("T", " "))}</span>`;
  if (r.kind === "page") {
    return `<li>${ts} <span class="tag">page</span> <a href="/pages/${encodeURIComponent(r.slug ?? "")}">${escape(r.title ?? r.slug)}</a></li>`;
  }
  if (r.kind === "signal") {
    return `<li>${ts} <span class="tag severity-${escape(r.severity ?? "info")}">signal</span> ${escape(r.title ?? "")}</li>`;
  }
  return `<li>${ts} <span class="tag">event</span> ${escape(r.action ?? "")} ${escape(r.detail ?? "")}</li>`;
}

// ============================================================================
// /search?q=...
// ============================================================================

export async function viewSearch(
  query: string,
  type: string | undefined,
  pageReq: PageRequest
): Promise<string> {
  if (!query.trim()) {
    return layout({
      title: "Search",
      body: `<h2>Search</h2><div class="empty">enter a query above</div>`,
    });
  }

  // hybrid search 的 score 已经按 RRF 排过，分页就是对结果数组切片。
  // 取 top-200 作为 candidate pool（够大，避免后页空），之后客户端分页。
  const POOL = 200;
  const allHits = (await mcpSearch(query, {
    limit: POOL,
    type,
    keywordOnly: env.EMBEDDING_DISABLED,
  })) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    ticker: string | null;
    score: number;
    snippet: string | null;
    section_path: string[] | null;
  }>;

  const start = offsetOf(pageReq);
  const slice = allHits.slice(start, start + pageReq.pageSize);
  const result = buildPageResult(slice, allHits.length, pageReq);

  // 批量查 visible slice 的 page metadata（confidence + create_time）
  // hybrid search 当前不返回这俩，但展示给用户能快速判断结果可信度 / 时效。
  const meta = await fetchHitMeta(slice.map((h) => h.slug));

  const keptParams = { q: query, type };

  const body = `
<h2>Search: "${escape(query)}"</h2>
<form class="filter" method="get" action="/search">
  <input type="hidden" name="q" value="${escape(query)}">
  <input type="hidden" name="pageSize" value="${pageReq.pageSize}">
  <select name="type" onchange="this.form.submit()">
    <option value="">all types</option>
    ${["company", "industry", "person", "concept", "source", "brief", "thesis"]
      .map((t) => `<option value="${t}"${type === t ? " selected" : ""}>${t}</option>`)
      .join("")}
  </select>
</form>

${slice.length === 0
  ? `<div class="empty">no hits</div>`
  : `<table>
      <thead><tr><th>Title</th><th>Type</th><th>Slug</th><th>Score</th></tr></thead>
      <tbody>
      ${slice
        .map((h) => {
          const m = meta.get(h.slug);
          const confidenceBadge = m?.confidence ? confidenceTag(m.confidence) : "";
          const timeBadge = m?.createTime
            ? `<time datetime="${m.createTime.toISOString()}">${m.createTime
                .toISOString()
                .slice(0, 10)}</time>`
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
          return `<tr>
            <td>
              <a href="/pages/${encodeURIComponent(h.slug)}">${escape(h.title)}</a>
              <span class="hit-meta">${confidenceBadge}${timeBadge}</span>
              ${crumb}
              ${snippetHtml}
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
    value: number | string | null;
    unit: string | null;
    confidence: string | null;
    source_slug: string | null;
    metadata: { extracted_by?: string; source_quote?: string } | null;
  }>;

  // 该 source 引出的 fact（自己作为 source_page_id）
  const ownFacts = await db.execute(sql`
    SELECT f.id::text AS id,
           e.slug AS entity_slug,
           e.title AS entity_title,
           f.metric, f.period, f.value_numeric, f.value_text, f.unit,
           f.metadata
    FROM facts f
    JOIN pages e ON e.id = f.entity_page_id
    WHERE f.source_page_id = ${BigInt(page.id)}
      AND f.deleted = 0
      AND f.valid_to IS NULL
    ORDER BY f.metric, f.period NULLS LAST
    LIMIT 50
  `);

  const inLinks = await db.execute(sql`
    SELECT p.slug, p.title, p.type, l.link_type
    FROM links l JOIN pages p ON p.id = l.from_page_id
    WHERE l.to_page_id = ${BigInt(page.id)}
      AND l.deleted = 0 AND p.deleted = 0
    ORDER BY p.create_time DESC LIMIT 20
  `);

  const outLinks = await db.execute(sql`
    SELECT p.slug, p.title, p.type, l.link_type
    FROM links l JOIN pages p ON p.id = l.to_page_id
    WHERE l.from_page_id = ${BigInt(page.id)}
      AND l.deleted = 0 AND p.deleted = 0
    ORDER BY l.id LIMIT 30
  `);

  const timelineRows = await db.execute(sql`
    SELECT te.event_date, te.event_type, te.summary, e.slug AS entity_slug, e.title AS entity_title
    FROM timeline_entries te
    LEFT JOIN pages e ON e.id = te.entity_page_id
    WHERE (te.source_page_id = ${BigInt(page.id)} OR te.entity_page_id = ${BigInt(page.id)})
      AND te.deleted = 0
    ORDER BY te.event_date DESC LIMIT 30
  `);

  const meta = page.frontmatter ?? {};
  const isEntity = ["company", "industry", "person", "concept"].includes(page.type);

  const body = `
<h2>
  ${pageTag(page.type)}
  ${escape(page.title)}
  ${confidenceTag(page.confidence)}
</h2>
<div class="muted score">${escape(page.slug)} · #${escape(page.id)}</div>

<div class="grid" style="margin-top: 16px;">
  <div class="card">
    <h3>Metadata</h3>
    <div class="kv">
      ${page.ticker ? `<div class="k">Ticker</div><div>${escape(page.ticker)}</div>` : ""}
      ${page.sector ? `<div class="k">Sector</div><div>${escape(page.sector)}</div>` : ""}
      ${page.aliases?.length ? `<div class="k">Aliases</div><div>${escape(page.aliases.join(", "))}</div>` : ""}
      ${meta.research_type ? `<div class="k">Research type</div><div>${escape(String(meta.research_type))}</div>` : ""}
      ${meta.url ? `<div class="k">URL</div><div><a href="${escape(String(meta.url))}" target="_blank" rel="noopener">${escape(String(meta.url).slice(0, 80))}</a></div>` : ""}
      <div class="k">Created</div><div>${escape(String(page.create_time ?? "").slice(0, 19).replace("T", " "))}</div>
      <div class="k">Updated</div><div>${escape(String(page.update_time ?? "").slice(0, 19).replace("T", " "))}</div>
      <div class="k">Inbound links</div><div>${page.inbound_links_count}</div>
      <div class="k">Outbound links</div><div>${page.outbound_links_count}</div>
    </div>
  </div>

  ${
    page.type === "source" || page.type === "brief"
      ? `<div class="card">
          <h3>Facts written by this source (${ownFacts.length})</h3>
          ${ownFacts.length === 0
            ? `<div class="empty">no facts</div>`
            : `<table><thead><tr><th>Entity</th><th>Metric</th><th>Period</th><th>Value</th></tr></thead><tbody>
                ${ownFacts
                  .slice(0, 12)
                  .map(
                    (f) => `<tr>
                      <td><a href="/pages/${encodeURIComponent(String(f.entity_slug ?? ""))}">${escape(f.entity_title ?? f.entity_slug ?? "")}</a></td>
                      <td>${escape(f.metric ?? "")}</td>
                      <td class="muted">${escape(f.period ?? "")}</td>
                      <td>${formatFactValue(f)}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody></table>${ownFacts.length > 12 ? `<p class="muted">… +${ownFacts.length - 12} more</p>` : ""}`}
        </div>`
      : `<div class="card">
          <h3>Latest facts about this entity (${facts.length})</h3>
          ${facts.length === 0
            ? `<div class="empty">no facts</div>`
            : `<table><thead><tr><th>Metric</th><th>Period</th><th>Value</th><th>Source</th></tr></thead><tbody>
                ${facts
                  .slice(0, 15)
                  .map(
                    (f) => `<tr>
                      <td>${escape(f.metric)}</td>
                      <td class="muted">${escape(f.period ?? "")}</td>
                      <td>${escape(String(f.value ?? ""))}${f.unit ? ` <span class="muted">${escape(f.unit)}</span>` : ""}</td>
                      <td>${f.source_slug ? `<a href="/pages/${encodeURIComponent(f.source_slug)}">${escape(f.source_slug.split("/").pop() ?? "")}</a>` : ""}</td>
                    </tr>`
                  )
                  .join("")}
              </tbody></table>${facts.length > 15 ? `<p class="muted">… +${facts.length - 15} more</p>` : ""}`}
        </div>`
  }
</div>

${page.content
  ? `<h2>Content</h2><div class="content">${renderMarkdown(page.content)}</div>`
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
            <td>${t.entity_slug ? `<a href="/pages/${encodeURIComponent(String(t.entity_slug))}">${escape(String(t.entity_title ?? t.entity_slug))}</a>` : ""}</td>
            <td>${escape(String(t.summary ?? ""))}</td>
          </tr>`
        )
        .join("")}
    </tbody></table>`
  : ""
}

${outLinks.length > 0
  ? `<h2>Outbound links (${outLinks.length})</h2>
    <ul class="plain">${outLinks
      .map(
        (l) =>
          `<li><a href="/pages/${encodeURIComponent(String(l.slug ?? ""))}">${escape(String(l.title ?? l.slug ?? ""))}</a> ${pageTag(String(l.type ?? ""))} ${l.link_type ? `<span class="muted">(${escape(String(l.link_type))})</span>` : ""}</li>`
      )
      .join("")}</ul>`
  : ""
}

${inLinks.length > 0
  ? `<h2>Backlinks (${inLinks.length})</h2>
    <ul class="plain">${inLinks
      .map(
        (l) =>
          `<li><a href="/pages/${encodeURIComponent(String(l.slug ?? ""))}">${escape(String(l.title ?? l.slug ?? ""))}</a> ${pageTag(String(l.type ?? ""))}</li>`
      )
      .join("")}</ul>`
  : ""
}
`;
  return layout({ title: page.title, body });
}

function formatFactValue(f: {
  value_numeric?: string | null;
  value_text?: string | null;
  unit?: string | null;
}): string {
  const v = f.value_numeric ?? f.value_text ?? "";
  return `${escape(String(v))}${f.unit ? ` <span class="muted">${escape(String(f.unit))}</span>` : ""}`;
}

// ============================================================================
// /theses
// ============================================================================

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
<h2>Theses (${totalCount})</h2>
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
            <td>${r.target_slug ? `<a href="/pages/${encodeURIComponent(String(r.target_slug))}">${escape(String(r.target_slug))}</a>` : ""}</td>
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

  const conds = [sql`p.deleted = 0`, sql`p.status != 'archived'`, sql`p.type IN ('company','industry','person','concept')`];
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
    ${["company", "industry", "person", "concept"]
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
            <td><a href="/pages/${encodeURIComponent(String(r.slug ?? ""))}">${escape(String(r.title ?? ""))}</a> <span class="muted score">${escape(String(r.slug ?? ""))}</span></td>
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
          mtime: s.mtime.toISOString().slice(0, 19).replace("T", " "),
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
          <td class="muted score">${escape(String(j.create_time).slice(0, 19).replace("T", " "))}</td>
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
      SELECT 'today' AS bucket, NOW()::date AS since UNION ALL
      SELECT 'last_7d', (NOW() - INTERVAL '7 days')::date UNION ALL
      SELECT 'last_30d', (NOW() - INTERVAL '30 days')::date
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
      DATE_TRUNC('day', create_time)::date AS day,
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
          <td class="muted score">${escape(String(r.create_time).slice(0, 19).replace("T", " "))}</td>
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
