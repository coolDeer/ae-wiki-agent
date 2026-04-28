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
.tag.type-company, .tag.type-industry, .tag.type-person, .tag.type-concept { color: var(--positive); border-color: var(--positive); }
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
      <a href="/theses">Theses</a>
      <a href="/entities?confidence=low">Red Links</a>
      <a href="/entities">Entities</a>
      <a href="/outputs">Outputs</a>
      <a href="/queue">Queue</a>
    </nav>
    <form class="search" action="/search" method="get">
      <input type="text" name="q" placeholder="search…" value="${escape(query)}">
      <button type="submit">go</button>
    </form>
  </div>
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

export function pageLink(p: { id: string | bigint; slug: string; title: string; type?: string }): string {
  const t = p.type ? ` ${pageTag(p.type)}` : "";
  return `<a href="/pages/${encodeURIComponent(p.slug)}">${escape(p.title)}</a>${t} <span class="muted score">${escape(p.slug)}</span>`;
}
