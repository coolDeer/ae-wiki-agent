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
  viewChat,
  viewEntities,
  viewHome,
  viewOutputFile,
  viewOutputs,
  viewPage,
  viewQueue,
  viewSearch,
  viewTheses,
} from "./views.ts";
import { parsePageRequest } from "./pagination.ts";
import { chatSend, clearSession } from "./chat.ts";

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

      // 提取 / 设置 chat session cookie（用于 /chat 多轮）
      const { sessionId, setCookieHeader } = ensureSession(req);

      try {
        // Home
        if (path === "/" && req.method === "GET") {
          return withCookie(html(await viewHome()), setCookieHeader);
        }

        // Chat — page
        if (path === "/chat" && req.method === "GET") {
          return withCookie(html(viewChat(sessionId)), setCookieHeader);
        }

        // Chat — send message
        if (path === "/chat/send" && req.method === "POST") {
          let body: { message?: string };
          try {
            body = (await req.json()) as { message?: string };
          } catch {
            return jsonErr(400, "invalid json");
          }
          const message = (body.message ?? "").trim();
          if (!message) return jsonErr(400, "empty message");
          const turn = await chatSend(sessionId, message);
          return withCookie(json(turn), setCookieHeader);
        }

        // Chat — clear session
        if (path === "/chat/clear" && req.method === "POST") {
          clearSession(sessionId);
          return withCookie(json({ ok: true }), setCookieHeader);
        }

        // Healthz
        if (path === "/healthz") {
          return new Response("ok", { headers: { "content-type": "text/plain" } });
        }

        // Search
        if (path === "/search" && req.method === "GET") {
          const q = url.searchParams.get("q") ?? "";
          const type = url.searchParams.get("type") ?? undefined;
          const pageReq = parsePageRequest(url.searchParams);
          return html(await viewSearch(q, type, pageReq));
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
          const pageReq = parsePageRequest(url.searchParams);
          return html(await viewTheses(status, pageReq));
        }

        // Entities
        if (path === "/entities" && req.method === "GET") {
          const pageReq = parsePageRequest(url.searchParams);
          return html(
            await viewEntities(
              {
                type: url.searchParams.get("type") ?? undefined,
                sector: url.searchParams.get("sector") ?? undefined,
                ticker: url.searchParams.get("ticker") ?? undefined,
                confidence: url.searchParams.get("confidence") ?? undefined,
              },
              pageReq
            )
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
          const pageReq = parsePageRequest(url.searchParams);
          return html(
            await viewQueue(
              {
                name: url.searchParams.get("name") ?? undefined,
                status: url.searchParams.get("status") ?? undefined,
              },
              pageReq
            )
          );
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

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErr(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const SESSION_COOKIE = "ae_chat_sid";

function ensureSession(req: Request): { sessionId: string; setCookieHeader: string | null } {
  const cookies = parseCookies(req.headers.get("cookie") ?? "");
  let sid = cookies[SESSION_COOKIE];
  if (sid && /^[a-zA-Z0-9]{16,64}$/.test(sid)) {
    return { sessionId: sid, setCookieHeader: null };
  }
  sid = generateSessionId();
  const cookie = `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}`;
  return { sessionId: sid, setCookieHeader: cookie };
}

function parseCookies(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(";")) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function generateSessionId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function withCookie(res: Response, setCookieHeader: string | null): Response {
  if (!setCookieHeader) return res;
  const headers = new Headers(res.headers);
  headers.append("set-cookie", setCookieHeader);
  return new Response(res.body, { status: res.status, headers });
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;"
  );
}
