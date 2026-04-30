/**
 * Web UI HTML 模板 + CSS。
 *
 * 服务端渲染纯字符串，无前端 build 步骤。CSS 内联，单一文件输出。
 */

import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function escape(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 渲染 page.content（含 [[wikilink]] / <!-- facts/timeline -->） */
export function renderMarkdown(content: string): string {
  // 删 <!-- facts --> / <!-- timeline --> block，给视图单独显示
  const stripped = content
    .replace(/<!--\s*facts[\s\S]*?-->/g, "")
    .replace(/<!--\s*timeline\s*-->[\s\S]*$/g, "");
  // [[wikilinks]] → 带链接的 <a>
  const linked = stripped.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_m, slug, text) =>
      `<a href="/pages/${encodeURIComponent(slug)}" class="wikilink">${escape(text || slug)}</a>`
  );
  return marked.parse(linked) as string;
}

const CSS = `
:root {
  --bg: #fafaf9;
  --fg: #1c1917;
  --muted: #78716c;
  --border: #e7e5e4;
  --accent: #1d4ed8;
  --accent-hover: #1e40af;
  --bg-soft: #f5f5f4;
  --positive: #15803d;
  --warning: #c2410c;
  --negative: #b91c1c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0a09;
    --fg: #f5f5f4;
    --muted: #a8a29e;
    --border: #292524;
    --accent: #93c5fd;
    --accent-hover: #bfdbfe;
    --bg-soft: #1c1917;
    --positive: #4ade80;
    --warning: #fb923c;
    --negative: #fca5a5;
  }
}
* { box-sizing: border-box; }
body {
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Source Han Sans", sans-serif;
  margin: 0;
  background: var(--bg);
  color: var(--fg);
}
.shell { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
header {
  border-bottom: 1px solid var(--border);
  padding: 12px 0;
  margin-bottom: 24px;
}
header .shell { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
header h1 { margin: 0; font-size: 18px; font-weight: 600; }
header h1 a { color: inherit; text-decoration: none; }
nav a { color: var(--muted); text-decoration: none; margin-right: 16px; }
nav a:hover { color: var(--fg); }
/* Top progress bar — 表单提交后立即显示，反馈 search 在跑 */
.topbar {
  position: fixed; top: 0; left: 0; right: 0;
  height: 2px; background: transparent; pointer-events: none; z-index: 1000;
}
html.loading .topbar {
  background: linear-gradient(90deg,
    transparent 0%, var(--accent) 30%, var(--accent) 70%, transparent 100%);
  background-size: 50% 100%;
  background-repeat: no-repeat;
  animation: topbar-slide 1.2s linear infinite;
}
@keyframes topbar-slide {
  0%   { background-position: -50% 0; }
  100% { background-position: 150% 0; }
}
html.loading body { cursor: progress; }
form.search button:disabled {
  opacity: 0.6; cursor: progress;
}
form.search { margin-left: auto; display: flex; gap: 8px; }
form.search input[type=text] {
  padding: 6px 12px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg);
  color: var(--fg); width: 240px;
}
form.search button {
  padding: 6px 14px; border: 1px solid var(--accent);
  background: var(--accent); color: #fff;
  border-radius: 6px; cursor: pointer;
}
main { padding-bottom: 80px; }
h2 { font-size: 18px; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
h3 { font-size: 15px; margin: 20px 0 8px; color: var(--fg); }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }
.wikilink { font-weight: 500; }
.muted { color: var(--muted); }
.tag {
  display: inline-block; padding: 1px 8px; border-radius: 12px;
  background: var(--bg-soft); border: 1px solid var(--border);
  font-size: 11px; color: var(--muted); margin-right: 6px;
}
.tag.type-source { color: var(--accent); border-color: var(--accent); }
.tag.type-brief { color: var(--warning); border-color: var(--warning); }
.tag.type-company, .tag.type-industry, .tag.type-concept { color: var(--positive); border-color: var(--positive); }
.tag.type-thesis { color: var(--negative); border-color: var(--negative); }
.tag.confidence-low { color: var(--negative); border-color: var(--negative); }
.tag.confidence-medium { color: var(--warning); border-color: var(--warning); }
.tag.confidence-high { color: var(--positive); border-color: var(--positive); }
.tag.severity-info { color: var(--accent); border-color: var(--accent); }
.tag.severity-warning { color: var(--warning); border-color: var(--warning); }
.tag.severity-critical { color: var(--negative); border-color: var(--negative); }
table {
  width: 100%; border-collapse: collapse;
  border: 1px solid var(--border); margin: 12px 0;
  font-size: 13px;
}
th, td {
  text-align: left; padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th {
  font-weight: 600; background: var(--bg-soft);
  color: var(--muted); text-transform: uppercase; font-size: 11px;
  letter-spacing: 0.04em;
}
tr:last-child td { border-bottom: none; }
.card {
  border: 1px solid var(--border); border-radius: 8px;
  padding: 16px 20px; margin-bottom: 16px;
  background: var(--bg);
}
.card h3 { margin-top: 0; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 6px 14px; font-size: 13px; }
.kv .k { color: var(--muted); }
.empty { color: var(--muted); padding: 24px; text-align: center; font-style: italic; }
.content {
  max-width: 760px; line-height: 1.7;
}
.content code { background: var(--bg-soft); padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
.content pre { background: var(--bg-soft); padding: 14px; border-radius: 6px; overflow-x: auto; }
.content blockquote {
  border-left: 3px solid var(--border); padding-left: 14px;
  margin: 14px 0; color: var(--muted);
}
.content table { font-size: 12px; }
.score {
  font-family: ui-monospace, monospace; font-size: 12px;
  color: var(--muted); white-space: nowrap;
}
.snippet { color: var(--muted); font-size: 13px; }
.snippet mark { background: rgba(255, 200, 0, 0.35); color: inherit; padding: 0 1px; border-radius: 2px; }
.crumb {
  display: inline-block; font-size: 11px; color: var(--muted);
  margin: 2px 0; font-family: ui-monospace, monospace;
}
.crumb .sep { opacity: 0.6; padding: 0 4px; }
.hit-meta {
  display: inline-flex; gap: 6px; align-items: center;
  margin-left: 6px; font-size: 11px; color: var(--muted);
}
.hit-meta time { font-family: ui-monospace, monospace; }
.debug-block {
  margin-top: 6px;
  font-size: 11px;
  border: 1px dashed var(--border);
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--muted);
}
.debug-block summary { cursor: pointer; user-select: none; }
.debug-block table.debug-kv {
  margin-top: 6px; border-collapse: collapse; font-family: ui-monospace, monospace;
}
.debug-block table.debug-kv td {
  padding: 1px 8px; border: none;
}
.debug-block table.debug-kv td:first-child { color: var(--muted); }
.did-you-mean {
  text-align: center;
  padding: 16px;
  color: var(--muted);
  font-size: 14px;
}
.did-you-mean > span:first-child {
  color: var(--muted);
  margin-right: 8px;
}
.did-you-mean a {
  margin: 0 4px;
}
.did-you-mean .sep {
  margin: 0 6px; opacity: 0.5;
}

/* === Form styling for thesis admin & similar PM-edit views === */
.thesis-form {
  border: 1px solid var(--border); border-radius: 8px;
  padding: 16px 20px; margin: 16px 0;
  background: var(--bg);
  max-width: 640px;
}
.thesis-form.inline-form { max-width: 100%; }
.thesis-form.danger { border-color: var(--negative); }
.thesis-form h4 { margin: 0 0 12px; font-size: 14px; }
.thesis-form .form-row { display: grid; grid-template-columns: 140px 1fr; gap: 6px 14px; align-items: center; margin-bottom: 12px; }
.thesis-form .form-row > label { font-size: 13px; color: var(--muted); }
.thesis-form .form-row > input,
.thesis-form .form-row > select,
.thesis-form .form-row > textarea {
  padding: 6px 10px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--bg); color: var(--fg);
  font-size: 13px; font-family: inherit;
}
.thesis-form .form-row > textarea { resize: vertical; }
.thesis-form .form-row > .form-hint {
  grid-column: 2; font-size: 11px; color: var(--muted); margin-top: -4px;
}
.thesis-form .form-row.form-actions { grid-template-columns: 140px 1fr; align-items: center; }
.thesis-form button {
  padding: 6px 16px; border: 1px solid var(--accent);
  background: var(--accent); color: #fff;
  border-radius: 4px; font-size: 13px; cursor: pointer;
}
.thesis-form button:hover { background: var(--accent-hover); }
.thesis-form button.btn-danger { border-color: var(--negative); background: var(--negative); }
a.btn-primary {
  display: inline-block; padding: 6px 14px; border: 1px solid var(--accent);
  background: var(--accent); color: #fff !important; border-radius: 4px;
  font-size: 13px; text-decoration: none;
}
a.btn-primary:hover { background: var(--accent-hover); }
details.narrative-edit { margin: 16px 0; }
details.narrative-edit summary { cursor: pointer; user-select: none; padding: 6px 0; color: var(--accent); }
ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li { padding: 6px 0; border-bottom: 1px solid var(--border); }
ul.plain li:last-child { border-bottom: none; }
.row { display: flex; align-items: baseline; gap: 12px; }
.row .grow { flex: 1; }
form.filter { margin-bottom: 16px; }
form.filter select, form.filter input {
  padding: 4px 8px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--bg); color: var(--fg);
  font-size: 13px; margin-right: 8px;
}
.btn {
  padding: 6px 14px; border: 1px solid var(--border);
  background: var(--bg); color: var(--fg);
  border-radius: 6px; cursor: pointer; font-size: 13px;
}
.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn-primary { border-color: var(--accent); background: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); color: #fff; }
.flash {
  padding: 10px 14px; margin: 12px 0;
  border-radius: 6px; border: 1px solid var(--accent);
  background: var(--bg-soft); color: var(--fg); font-size: 13px;
}
.pagination {
  display: flex; align-items: center; gap: 16px;
  flex-wrap: wrap; margin: 16px 0; font-size: 13px;
}
.pagination .page-info { color: var(--muted); }
.pagination .page-controls { display: inline-flex; gap: 4px; align-items: center; }
.pagination .page-num {
  display: inline-block; min-width: 28px; padding: 4px 8px;
  text-align: center; border: 1px solid var(--border); border-radius: 4px;
  color: var(--fg); text-decoration: none; font-size: 12px;
}
.pagination .page-num:hover { border-color: var(--accent); color: var(--accent); }
.pagination .page-current {
  background: var(--accent); color: #fff; border-color: var(--accent);
  cursor: default;
}
.pagination .page-disabled { color: var(--muted); opacity: 0.5; cursor: not-allowed; }
.pagination .page-disabled:hover { border-color: var(--border); color: var(--muted); }
.pagination .page-ellipsis { color: var(--muted); padding: 0 4px; }
.pagination .page-size select {
  padding: 4px 8px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--bg); color: var(--fg);
  font-size: 12px;
}
th.sortable a { color: inherit; text-decoration: none; display: inline-block; }
th.sortable a:hover { color: var(--accent); }
th.sortable .arrow { font-size: 10px; margin-left: 2px; }

/* Chat */
.chat-shell { max-width: 820px; margin: 0 auto; padding-bottom: 100px; }
.chat-msgs { display: flex; flex-direction: column; gap: 14px; min-height: 280px; }
.chat-bubble {
  border: 1px solid var(--border); border-radius: 10px;
  padding: 12px 16px; line-height: 1.6;
  max-width: 100%;
}
.chat-bubble.user {
  background: var(--bg-soft); align-self: flex-end;
  max-width: 80%; white-space: pre-wrap;
}
.chat-bubble.assistant { background: var(--bg); }
.chat-bubble .meta { font-size: 11px; color: var(--muted); margin-top: 6px; }
.chat-tools {
  margin-top: 10px; padding: 8px 10px;
  background: var(--bg-soft); border-radius: 6px;
  font-size: 12px; color: var(--muted);
}
.chat-tools .row { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
.chat-tools .row:last-child { margin-bottom: 0; }
.chat-tools code {
  font-size: 11px; background: var(--bg);
  padding: 1px 4px; border-radius: 3px; color: var(--fg);
}
.chat-input-wrap {
  position: sticky; bottom: 0; background: var(--bg);
  padding: 14px 0 4px; border-top: 1px solid var(--border);
}
.chat-input-form { display: flex; gap: 8px; }
.chat-input-form textarea {
  flex: 1; padding: 10px 14px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--fg);
  font: inherit; resize: vertical; min-height: 60px;
}
.chat-input-form button {
  padding: 0 22px; border: 1px solid var(--accent);
  background: var(--accent); color: #fff;
  border-radius: 8px; cursor: pointer; font: inherit; font-weight: 500;
}
.chat-input-form button:disabled { opacity: 0.5; cursor: wait; }
.chat-empty {
  color: var(--muted); padding: 40px 24px; text-align: center;
  border: 1px dashed var(--border); border-radius: 10px;
}
.chat-typing {
  display: inline-block; color: var(--muted); font-style: italic;
}
.chat-typing::after {
  content: "▍"; animation: blink 1s steps(2) infinite;
  margin-left: 2px;
}
@keyframes blink { 50% { opacity: 0; } }
`;

export interface LayoutOpts {
  title: string;
  body: string;
  query?: string;
  flash?: string;
}

export function layout({ title, body, query = "", flash }: LayoutOpts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — ae-wiki</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <div class="shell">
    <h1><a href="/">ae-wiki</a></h1>
    <nav>
      <a href="/chat">Chat</a>
      <a href="/theses">Theses</a>
      <a href="/entities?confidence=low">Red Links</a>
      <a href="/entities">Entities</a>
      <a href="/outputs">Outputs</a>
      <a href="/queue">Queue</a>
      <a href="/usage">Usage</a>
    </nav>
    <form class="search" action="/search" method="get"
          onsubmit="document.documentElement.classList.add('loading');this.querySelector('button').disabled=true;this.querySelector('button').textContent='…';">
      <input type="text" name="q" placeholder="search…" value="${escape(query)}">
      <button type="submit">go</button>
    </form>
  </div>
  <div class="topbar"></div>
</header>
<main class="shell">
${flash ? `<div class="flash">${flash}</div>` : ""}
${body}
</main>
</body>
</html>`;
}

export function pageTag(type: string): string {
  return `<span class="tag type-${escape(type)}">${escape(type)}</span>`;
}

export function confidenceTag(c: string | null): string {
  if (!c) return "";
  return `<span class="tag confidence-${escape(c)}">${escape(c)}</span>`;
}

/**
 * Query-aware snippet：从 chunk_text 里找命中 token 的 ±N 字符窗口，
 * 把命中 token 用 <mark> 包起来。比 chunk_text.slice(0, 200) 实用得多。
 *
 * - 中文：拆 1+ 字 token 直接 includes 匹配
 * - 英文：>=2 字 word-boundary 匹配
 * - 没命中时：fallback 到 head 切片
 *
 * 返回已 escape + 加 <mark> 的 HTML 片段（不再过 escape）。
 */
export function highlightSnippet(
  chunkText: string,
  query: string,
  windowChars = 200
): string {
  if (!chunkText) return "";
  const tokens = extractQueryTokens(query);
  if (tokens.length === 0) {
    // fallback: head 切片
    const head = chunkText.slice(0, windowChars).trim();
    return escape(head) + (chunkText.length > windowChars ? "…" : "");
  }

  // 找最早 token 命中位置
  const lowerText = chunkText.toLowerCase();
  let firstHit = -1;
  for (const t of tokens) {
    const idx = lowerText.indexOf(t);
    if (idx >= 0 && (firstHit === -1 || idx < firstHit)) firstHit = idx;
  }

  // 没命中：从头切（同 fallback）
  if (firstHit === -1) {
    const head = chunkText.slice(0, windowChars).trim();
    return escape(head) + (chunkText.length > windowChars ? "…" : "");
  }

  // 取 ±N/2 窗口
  const half = Math.floor(windowChars / 2);
  const start = Math.max(0, firstHit - half);
  const end = Math.min(chunkText.length, firstHit + windowChars - half);
  const slice = chunkText.slice(start, end);

  // 高亮：先 escape 原文，再用 token 正则替换为 <mark>
  let html = escape(slice);
  for (const t of tokens) {
    // 已 escape 后，t 字符串本身可能含 escape 后的字符，但 token 都是字母/数字/CJK
    const re = new RegExp(escapeRegex(t), "gi");
    html = html.replace(re, (m) => `<mark>${m}</mark>`);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < chunkText.length ? "…" : "";
  return prefix + html + suffix;
}

function extractQueryTokens(query: string): string[] {
  const out = new Set<string>();
  // ASCII tokens >= 2 chars
  for (const m of query.toLowerCase().matchAll(/[a-z0-9_-]{2,}/g)) {
    out.add(m[0]);
  }
  // CJK tokens：每段连续 CJK 当一个 token（>= 1 字）
  for (const m of query.matchAll(/[\u3400-\u9fff]+/g)) {
    out.add(m[0]);
  }
  return Array.from(out);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function pageLink(p: { id: string | bigint; slug: string; title: string; type?: string }): string {
  const t = p.type ? ` ${pageTag(p.type)}` : "";
  return `<a href="/pages/${encodeURIComponent(p.slug)}">${escape(p.title)}</a>${t} <span class="muted score">${escape(p.slug)}</span>`;
}

/** 渲染可排序表头 — 点击切 ASC/DESC，URL 注入 sortField/sortOrder。 */
export function sortableHeader(opts: {
  label: string;
  field: string;
  basePath: string;
  keptParams: Record<string, string | undefined>;
  currentField?: string;
  currentOrder?: "ASC" | "DESC";
}): string {
  const isCurrent = opts.currentField === opts.field;
  const nextOrder: "ASC" | "DESC" =
    isCurrent && opts.currentOrder === "DESC" ? "ASC" : "DESC";
  const arrow = isCurrent ? (opts.currentOrder === "DESC" ? "▼" : "▲") : "";

  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.keptParams)) {
    if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  }
  p.set("sortField", opts.field);
  p.set("sortOrder", nextOrder);
  p.set("currPage", "1"); // 切排序回首页

  const href = `${opts.basePath}?${p.toString()}`;
  return `<th class="sortable"><a href="${href}">${escape(opts.label)}<span class="arrow">${arrow}</span></a></th>`;
}
