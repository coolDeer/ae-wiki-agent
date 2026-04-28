/**
 * Web /chat 后端 — 用 OpenAI function calling 把 7 个 MCP 工具暴露给模型，
 * 自动多轮 tool-call → 给用户回最终自然语言答案。
 *
 * 与 `src/agents/runtime.ts` durable runtime 的区别：
 * - 这里是**临时** chat session，不落 agent_messages / agent_tool_executions
 * - 内存里按 sessionId 维护历史，server 重启丢失
 * - 一次 POST /chat/send 内完成所有 tool 循环（最多 8 轮），返回最终答案 + 工具调用列表给前端展示
 *
 * 与 stage-5-tier-c 一样：用 stream=true 累积 delta + reasoning_effort='low'
 * 规避 Bun 长 unary fetch 掉 socket 的问题。
 */

import OpenAI from "openai";
import { getEnv } from "~/core/env.ts";
import {
  search as mcpSearch,
  getPage,
  queryFacts,
  compareTableFacts,
  getTableArtifact,
  listEntities,
  recentActivity,
} from "~/mcp/queries.ts";

// ============================================================================
// Tool 定义（OpenAI function calling 格式，参数 schema 与 src/mcp/server.ts 对齐）
// ============================================================================

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search",
      description:
        "Hybrid search (keyword + semantic) over the investment research wiki. Returns ranked pages.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (English / Chinese)" },
          limit: { type: "number", description: "Max results (default 10)" },
          type: {
            type: "string",
            description:
              "Filter: company / person / industry / source / brief / thesis / concept / output",
          },
          date_from: { type: "string", description: "ISO date" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_page",
      description: "Fetch a complete page by id or slug.",
      parameters: {
        type: "object",
        properties: {
          identifier: {
            type: "string",
            description: "Page id (numeric) or slug (e.g. 'companies/Verizon')",
          },
        },
        required: ["identifier"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "query_facts",
      description: "Query structured facts by entity / metric / period.",
      parameters: {
        type: "object",
        properties: {
          entity: { type: "string", description: "Entity slug or ticker" },
          metric: {
            type: "string",
            description: "e.g. revenue / eps_non_gaap / target_price",
          },
          period: { type: "string", description: "e.g. FY2027E / 1Q26A" },
          current_only: { type: "boolean" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_table_facts",
      description:
        "Build a comparison matrix from table-derived facts by metric across entities/periods.",
      parameters: {
        type: "object",
        properties: {
          metric: { type: "string" },
          entities: { type: "array", items: { type: "string" } },
          periods: { type: "array", items: { type: "string" } },
          current_only: { type: "boolean" },
          limit: { type: "number" },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_table_artifact",
      description: "Fetch raw table artifacts attached to a page.",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string" },
          table_id: { type: "string" },
        },
        required: ["identifier"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_entities",
      description: "List entities (company / person / industry / concept) with filters.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string" },
          sector: { type: "string" },
          ticker: { type: "string" },
          confidence: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "recent_activity",
      description: "Recent events / signals / new pages in the wiki.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number" },
          kinds: {
            type: "array",
            items: { type: "string", enum: ["event", "signal", "page"] },
          },
          limit: { type: "number" },
        },
      },
    },
  },
];

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search":
      return await mcpSearch((args.query as string) ?? "", {
        limit: typeof args.limit === "number" ? args.limit : 10,
        type: typeof args.type === "string" ? args.type : undefined,
        dateFrom: typeof args.date_from === "string" ? args.date_from : undefined,
        keywordOnly: getEnv().EMBEDDING_DISABLED,
      });
    case "get_page":
      return await getPage((args.identifier as string) ?? "");
    case "query_facts":
      return await queryFacts({
        entity: args.entity as string | undefined,
        metric: args.metric as string | undefined,
        period: args.period as string | undefined,
        currentOnly: args.current_only as boolean | undefined,
        limit: args.limit as number | undefined,
      });
    case "compare_table_facts":
      return await compareTableFacts({
        metric: (args.metric as string) ?? "",
        entities: args.entities as string[] | undefined,
        periods: args.periods as string[] | undefined,
        currentOnly: args.current_only as boolean | undefined,
        limit: args.limit as number | undefined,
      });
    case "get_table_artifact":
      return await getTableArtifact(
        (args.identifier as string) ?? "",
        args.table_id as string | undefined
      );
    case "list_entities":
      return await listEntities({
        type: args.type as string | undefined,
        sector: args.sector as string | undefined,
        ticker: args.ticker as string | undefined,
        confidence: args.confidence as string | undefined,
        limit: args.limit as number | undefined,
      });
    case "recent_activity":
      return await recentActivity({
        days: args.days as number | undefined,
        kinds: args.kinds as ("event" | "signal" | "page")[] | undefined,
        limit: args.limit as number | undefined,
      });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ============================================================================
// Session state
// ============================================================================

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  tool_calls?: Array<{ name: string; args: unknown; result_summary: string }>;
  ts: string;
}

interface InternalMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface ChatSession {
  id: string;
  /** 用户视角的轮次（前端渲染用） */
  turns: ChatTurn[];
  /** 给 OpenAI 的完整 messages（含 tool_calls / tool 结果） */
  messages: InternalMessage[];
  createdAt: string;
}

const SYSTEM_PROMPT = [
  "You are an investment research assistant for the ae-wiki knowledge base.",
  "",
  "When the user asks a question:",
  "1. Decide which of the available tools (search / get_page / query_facts / compare_table_facts / get_table_artifact / list_entities / recent_activity) to call. You can call multiple in sequence.",
  "2. Quote each factual claim back to the source page slug, e.g. (Source: [[sources/...]]). Use [[wikilink]] form so the UI auto-links.",
  "3. If a tool returns nothing, say so honestly — do not invent facts.",
  "4. Keep answers concise (markdown, ≤ 300 words unless the user asks for more). Use tables for multi-row comparisons. Use bullet points for short enumerations.",
  "5. The user is a portfolio manager / research analyst — assume sophistication, no need to define basic finance terms.",
  "6. Reply in the same language the user wrote (English or Chinese).",
].join("\n");

const sessions = new Map<string, ChatSession>();
const MAX_TURNS_PER_REQUEST = 8;

function sessionFor(id: string): ChatSession {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      turns: [],
      messages: [{ role: "system", content: SYSTEM_PROMPT }],
      createdAt: new Date().toISOString(),
    };
    sessions.set(id, s);
  }
  return s;
}

export function getSessionTurns(id: string): ChatTurn[] {
  return sessions.get(id)?.turns ?? [];
}

export function clearSession(id: string): void {
  sessions.delete(id);
}

// ============================================================================
// 主循环：用户一次 POST → 多轮 tool call → 最终 assistant 文本
// ============================================================================

export async function chatSend(
  sessionId: string,
  userMessage: string
): Promise<ChatTurn> {
  const env = getEnv();
  const session = sessionFor(sessionId);
  const startedAt = new Date().toISOString();

  session.turns.push({
    role: "user",
    content: userMessage,
    ts: startedAt,
  });
  session.messages.push({ role: "user", content: userMessage });

  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: 180_000,
    maxRetries: 0,
  });

  const toolCallsForUser: Array<{
    name: string;
    args: unknown;
    result_summary: string;
  }> = [];

  let finalText = "";
  let lastErr: unknown = null;

  for (let turn = 0; turn < MAX_TURNS_PER_REQUEST; turn++) {
    let assistantText = "";
    const toolCallAccum = new Map<
      number,
      { id: string; name: string; argsStr: string }
    >();

    try {
      const stream = await client.chat.completions.create({
        model: env.OPENAI_AGENT_MODEL,
        messages: session.messages as Parameters<
          typeof client.chat.completions.create
        >[0]["messages"],
        tools: TOOLS,
        tool_choice: "auto",
        stream: true,
        max_completion_tokens: 8000,
        reasoning_effort: "low",
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string") assistantText += delta.content;
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallAccum.get(idx) ?? {
              id: "",
              name: "",
              argsStr: "",
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.argsStr += tc.function.arguments;
            toolCallAccum.set(idx, existing);
          }
        }
      }
    } catch (e) {
      lastErr = e;
      break;
    }

    if (toolCallAccum.size > 0) {
      // 把 assistant 的 tool_call turn append
      const tcArr = Array.from(toolCallAccum.values()).map((tc) => ({
        id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.argsStr || "{}" },
      }));
      session.messages.push({
        role: "assistant",
        content: assistantText || null,
        tool_calls: tcArr,
      });

      // 执行每个 tool，结果 push 回 messages
      for (const tc of tcArr) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || "{}");
        } catch {
          parsedArgs = {};
        }
        let resultJson: string;
        try {
          const result = await dispatchTool(tc.function.name, parsedArgs);
          resultJson = JSON.stringify(result, bigintReplacer).slice(0, 30000);
          toolCallsForUser.push({
            name: tc.function.name,
            args: parsedArgs,
            result_summary: summarizeToolResult(tc.function.name, result),
          });
        } catch (e) {
          const msg = (e as Error).message;
          resultJson = JSON.stringify({ error: msg });
          toolCallsForUser.push({
            name: tc.function.name,
            args: parsedArgs,
            result_summary: `error: ${msg}`,
          });
        }
        session.messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: resultJson,
        });
      }
      // 继续下一轮，让模型读 tool result 给最终答案
      continue;
    }

    // 没有 tool_call → 最终 assistant 答案
    finalText = assistantText;
    session.messages.push({ role: "assistant", content: finalText });
    break;
  }

  if (!finalText && lastErr) {
    finalText = `（chat 出错：${(lastErr as Error).message ?? lastErr}）`;
  }
  if (!finalText) {
    finalText = "（达到 tool-call 轮次上限，仍无最终答复，请简化问题或 /chat/clear 重新开始）";
  }

  const turn: ChatTurn = {
    role: "assistant",
    content: finalText,
    tool_calls: toolCallsForUser,
    ts: new Date().toISOString(),
  };
  session.turns.push(turn);
  return turn;
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

function summarizeToolResult(name: string, result: unknown): string {
  if (Array.isArray(result)) {
    return `${result.length} rows`;
  }
  if (result && typeof result === "object") {
    const keys = Object.keys(result as Record<string, unknown>);
    if (keys.includes("matrix") && Array.isArray((result as { matrix: unknown[] }).matrix)) {
      return `matrix ${(result as { matrix: unknown[] }).matrix.length} rows`;
    }
    if (keys.includes("slug")) {
      return `page ${(result as { slug?: string }).slug ?? ""}`;
    }
    return `obj{${keys.slice(0, 4).join(",")}}`;
  }
  if (result === null || result === undefined) return "null";
  const s = String(result);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}
