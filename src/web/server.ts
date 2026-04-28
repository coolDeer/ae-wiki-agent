/**
 * Web UI 入口 — Bun.serve.
 *
 * 启动：bun src/cli.ts web [--port 3000]
 *
 * 路由：
 *   GET /                        home
 *   GET /search?q=...&type=...   hybrid search
 *   GET /pages/:slug-or-id       page detail
 *   GET /theses?status=...       theses list
 *   GET /entities?...            entity filter
 *   GET /outputs                 list wiki/output/*.md
 *   GET /outputs/:filename       render one .md
 *   GET /queue                   minion_jobs status
 *   GET /healthz                 plain "ok" for liveness
 */

import {
  viewEntities,
  viewHome,
  viewOutputFile,
  viewOutputs,
  viewPage,
  viewQueue,
  viewSearch,
  viewTheses,
} from "./views.ts";

interface ServeOpts {
  port?: number;
}

export async function startWebServer(opts: ServeOpts = {}): Promise<void> {
  const port = opts.port ?? 3000;

  Bun.serve({
    port,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      try {
        // Home
        if (path === "/" && req.method === "GET") {
          return html(await viewHome());
        }

        // Healthz
        if (path === "/healthz") {
          return new Response("ok", { headers: { "content-type": "text/plain" } });
        }

        // Search
        if (path === "/search" && req.method === "GET") {
          const q = url.searchParams.get("q") ?? "";
          const type = url.searchParams.get("type") ?? undefined;
          return html(await viewSearch(q, type));
        }

        // Pages
        const pageMatch = path.match(/^\/pages\/(.+)$/);
        if (pageMatch && req.method === "GET") {
          const identifier = decodeURIComponent(pageMatch[1] ?? "");
          return html(await viewPage(identifier));
        }

        // Theses
        if (path === "/theses" && req.method === "GET") {
          const status = url.searchParams.get("status") ?? undefined;
          return html(await viewTheses(status));
        }

        // Entities
        if (path === "/entities" && req.method === "GET") {
          return html(
            await viewEntities({
              type: url.searchParams.get("type") ?? undefined,
              sector: url.searchParams.get("sector") ?? undefined,
              ticker: url.searchParams.get("ticker") ?? undefined,
              confidence: url.searchParams.get("confidence") ?? undefined,
            })
          );
        }

        // Outputs list
        if (path === "/outputs" && req.method === "GET") {
          return html(await viewOutputs());
        }

        // Single output
        const outputMatch = path.match(/^\/outputs\/(.+)$/);
        if (outputMatch && req.method === "GET") {
          const filename = decodeURIComponent(outputMatch[1] ?? "");
          return html(await viewOutputFile(filename));
        }

        // Queue
        if (path === "/queue" && req.method === "GET") {
          return html(await viewQueue());
        }

        return new Response("not found", { status: 404 });
      } catch (e) {
        const err = e as Error;
        console.error("[web]", err.stack ?? err.message);
        return new Response(
          `<!doctype html><pre style="padding:24px;color:#b91c1c;">500 Internal Error\n\n${escapeHtml(err.message)}\n\n${escapeHtml(err.stack ?? "")}</pre>`,
          { status: 500, headers: { "content-type": "text/html" } }
        );
      }
    },
  });

  console.log(`[web] ae-wiki UI listening on http://localhost:${port}`);
}

function html(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;"
  );
}
