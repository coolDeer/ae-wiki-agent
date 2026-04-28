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
  listEntities,
  recentActivity,
  queryFacts,
} from "~/mcp/queries.ts";
import { thesisList, thesisShow } from "~/skills/thesis/index.ts";

import {
  confidenceTag,
  escape,
  layout,
  pageTag,
  renderMarkdown,
} from "./templates.ts";

const env = getEnv();

// ============================================================================
// /  — Home
// ============================================================================

export async function viewHome(): Promise<string> {
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

  const newPages = recent.filter((r) => r.kind === "page");
  const todaysSourceBriefs = newPages.filter(
    (r) => r.slug?.startsWith("sources/") || r.slug?.startsWith("briefs/")
  );

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

<h2>Today's source / brief (last 7d)</h2>
${todaysSourceBriefs.length === 0
  ? `<div class="empty">no recent source/brief pages</div>`
  : `<ul class="plain">${todaysSourceBriefs
      .map(
        (p) => `<li>
          <div class="row">
            <div class="grow"><a href="/pages/${encodeURIComponent(p.slug ?? "")}">${escape(p.title ?? p.slug)}</a></div>
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

export async function viewSearch(query: string, type?: string): Promise<string> {
  if (!query.trim()) {
    return layout({
      title: "Search",
      body: `<h2>Search</h2><div class="empty">enter a query above</div>`,
    });
  }

  const hits = (await mcpSearch(query, {
    limit: 30,
    type,
    keywordOnly: env.EMBEDDING_DISABLED,
  })) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    ticker: string | null;
    score: number;
    keyword_rank: number | null;
    semantic_rank: number | null;
    snippet: string | null;
  }>;

  const body = `
<h2>Search: "${escape(query)}"</h2>
<form class="filter" method="get" action="/search">
  <input type="hidden" name="q" value="${escape(query)}">
  <select name="type" onchange="this.form.submit()">
    <option value="">all types</option>
    ${["company", "industry", "person", "concept", "source", "brief", "thesis"]
      .map((t) => `<option value="${t}"${type === t ? " selected" : ""}>${t}</option>`)
      .join("")}
  </select>
</form>

${hits.length === 0
  ? `<div class="empty">no hits</div>`
  : `<table>
      <thead><tr><th>Title</th><th>Type</th><th>Slug</th><th>Score</th></tr></thead>
      <tbody>
      ${hits
        .map(
          (h) => `<tr>
            <td><a href="/pages/${encodeURIComponent(h.slug)}">${escape(h.title)}</a>
              ${h.snippet ? `<div class="snippet">${escape(h.snippet)}</div>` : ""}
            </td>
            <td>${pageTag(h.type)}</td>
            <td class="muted score">${escape(h.slug)}</td>
            <td class="score">${h.score.toFixed(4)}</td>
          </tr>`
        )
        .join("")}
      </tbody>
    </table>`
}
`;
  return layout({ title: `Search: ${query}`, body, query });
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

export async function viewTheses(status?: string): Promise<string> {
  const rows = await thesisList({
    status: status as "active" | "monitoring" | "closed" | "invalidated" | undefined,
    limit: 100,
  });

  const body = `
<h2>Theses (${rows.length})</h2>
<form class="filter" method="get" action="/theses">
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
      <thead><tr><th>Name</th><th>Target</th><th>Direction</th><th>Conviction</th><th>Status</th><th>Opened</th></tr></thead>
      <tbody>
      ${rows
        .map(
          (r) => `<tr>
            <td><a href="/pages/${escape(r.pageId.toString())}">${escape(r.title)}</a></td>
            <td>${escape(r.targetSlug ?? "")}</td>
            <td>${escape(r.direction ?? "")}</td>
            <td>${escape(r.conviction ?? "")}</td>
            <td>${escape(r.status ?? "")}</td>
            <td class="muted">${escape(r.dateOpened ?? "")}</td>
          </tr>`
        )
        .join("")}
      </tbody>
    </table>`
}
`;
  return layout({ title: "Theses", body });
}

// ============================================================================
// /entities
// ============================================================================

export async function viewEntities(opts: {
  type?: string;
  sector?: string;
  ticker?: string;
  confidence?: string;
}): Promise<string> {
  const rows = (await listEntities({
    type: opts.type,
    sector: opts.sector,
    ticker: opts.ticker,
    confidence: opts.confidence,
    limit: 200,
  })) as Array<{
    page_id: string;
    slug: string;
    type: string;
    title: string;
    ticker: string | null;
    sector: string | null;
    confidence: string;
  }>;

  const body = `
<h2>Entities (${rows.length})</h2>
<form class="filter" method="get" action="/entities">
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
      <thead><tr><th>Title</th><th>Type</th><th>Ticker</th><th>Sector</th><th>Confidence</th></tr></thead>
      <tbody>
      ${rows
        .map(
          (r) => `<tr>
            <td><a href="/pages/${encodeURIComponent(r.slug)}">${escape(r.title)}</a> <span class="muted score">${escape(r.slug)}</span></td>
            <td>${pageTag(r.type)}</td>
            <td>${escape(r.ticker ?? "")}</td>
            <td>${escape(r.sector ?? "")}</td>
            <td>${confidenceTag(r.confidence)}</td>
          </tr>`
        )
        .join("")}
      </tbody>
    </table>`
}
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

export async function viewQueue(): Promise<string> {
  const byStatus = await db.execute(sql`
    SELECT name, status, COUNT(*)::int AS n
    FROM minion_jobs
    WHERE deleted = 0
    GROUP BY name, status
    ORDER BY name, status
  `);

  const recentJobs = await db.execute(sql`
    SELECT id::text AS id, name, status, attempts, max_attempts,
           started_at, finished_at, create_time, error
    FROM minion_jobs
    WHERE deleted = 0
    ORDER BY create_time DESC
    LIMIT 30
  `);

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

<h3>Most recent jobs (30)</h3>
<table>
  <thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Attempts</th><th>Created</th><th>Error</th></tr></thead>
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
</table>
`;
  return layout({ title: "Queue", body });
}
