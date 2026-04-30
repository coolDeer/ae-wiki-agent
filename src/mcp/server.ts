#!/usr/bin/env bun
/**
 * ae-wiki MCP server
 *
 * 通过 stdio transport 暴露 5 个 wiki 查询工具给 Claude Code / 其他 MCP client。
 *
 * 启动方式（Claude Code 通过 .mcp.json 自动 spawn）：
 *   bun run src/mcp/server.ts
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  search,
  getPage,
  queryFacts,
  compareTableFacts,
  getTableArtifact,
  listEntities,
  recentActivity,
  resolveWikilink,
} from "./queries.ts";

const server = new Server(
  {
    name: "ae-wiki",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================================================
// Tool 定义
// ============================================================================

const TOOLS = [
  {
    name: "search",
    description:
      "Hybrid search (keyword + semantic) over the investment research wiki. Returns ranked pages.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (English / Chinese)" },
        limit: { type: "number", description: "Max results (default 10)" },
        type: {
          type: "string",
          description:
            "Filter by page type: company / industry / source / thesis / concept / output",
        },
        date_from: {
          type: "string",
          description: "Only pages created on or after (ISO date)",
        },
        keyword_only: {
          type: "boolean",
          description: "Skip vector search, use only tsvector keyword (faster, no embedding cost)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_page",
    description:
      "Fetch a complete page by id or slug. Returns content + frontmatter + tags + link counts.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description: "Page id (numeric) or slug (e.g. 'companies/NVIDIA')",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "query_facts",
    description:
      "Query structured facts (financial metrics) by entity / metric / period. Supports table_only, table_id, and include_raw_table.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Entity slug or ticker" },
        metric: {
          type: "string",
          description: "e.g. 'revenue' / 'eps_non_gaap' / 'target_price' / 'gross_margin'",
        },
        period: { type: "string", description: "e.g. 'FY2027E' / '1Q26A' / 'current'" },
        current_only: {
          type: "boolean",
          description: "Only return facts with valid_to IS NULL (latest)",
        },
        table_only: {
          type: "boolean",
          description: "Only return facts extracted from table artifacts",
        },
        table_id: {
          type: "string",
          description: "Filter facts to a specific table_id (e.g. 't1')",
        },
        include_raw_table: {
          type: "boolean",
          description: "Attach the matching raw table artifact to each fact",
        },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_table_artifact",
    description:
      "Fetch structured markdown table artifacts for a page. Optionally filter to one table_id.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description: "Page id (numeric) or slug (e.g. 'sources/foo-260428')",
        },
        table_id: {
          type: "string",
          description: "Optional table id such as 't1'",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "compare_table_facts",
    description:
      "Build a comparison matrix from table-derived facts by metric across entities / periods.",
    inputSchema: {
      type: "object",
      properties: {
        metric: {
          type: "string",
          description: "Metric to compare, e.g. 'revenue' or 'gross_margin'",
        },
        entities: {
          type: "array",
          items: { type: "string" },
          description: "Optional entity slugs or tickers",
        },
        periods: {
          type: "array",
          items: { type: "string" },
          description: "Optional period list, e.g. ['FY2026E','FY2027E']",
        },
        source_identifier: {
          type: "string",
          description: "Optional source page id or slug to restrict comparison",
        },
        current_only: {
          type: "boolean",
          description: "Only compare facts with valid_to IS NULL",
        },
        limit: { type: "number" },
      },
      required: ["metric"],
    },
  },
  {
    name: "list_entities",
    description:
      "List entity pages (companies / industries / concepts / etc.) with filters.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Filter by type: company / industry / concept",
        },
        sector: { type: "string" },
        ticker: { type: "string" },
        confidence: {
          type: "string",
          description: "high / medium / low (low = auto-created stubs)",
        },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "resolve_wikilink",
    description:
      "Fuzzy-resolve a free-text hint to the closest existing page slug via pg_trgm similarity. " +
      "**Use this BEFORE writing `[[sources/X]]` or `[[theses/X]]` wikilinks** — those types are not auto-created by ingest, so a wrong slug would just be dropped (logged as wikilink_unresolved). " +
      "Returns ranked candidates + an `advice` field telling you whether the best match is confident enough to link.",
    inputSchema: {
      type: "object",
      properties: {
        hint: {
          type: "string",
          description:
            "Free-text hint: title fragment, ticker, partial slug, or Chinese name. e.g. 'h200 csp channel check' or 'AWS Q1 preview'",
        },
        type: {
          type: "string",
          description:
            "Restrict to a page type (recommended): source / thesis / company / concept / industry / output",
        },
        limit: { type: "number", description: "Default 5" },
        min_similarity: {
          type: "number",
          description: "0-1 trigram similarity floor. Default 0.15.",
        },
      },
      required: ["hint"],
    },
  },
  {
    name: "recent_activity",
    description:
      "Recent events / signals / new pages in the wiki. Default last 7 days.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Lookback window (default 7)" },
        kinds: {
          type: "array",
          items: { type: "string", enum: ["event", "signal", "page"] },
          description: "Default ['event', 'signal', 'page']",
        },
        limit: { type: "number" },
      },
    },
  },
];

// ============================================================================
// 路由
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    let result: unknown;
    switch (name) {
      case "search":
        result = await search((args as { query: string }).query, {
          limit: (args as { limit?: number }).limit,
          type: (args as { type?: string }).type,
          dateFrom: (args as { date_from?: string }).date_from,
          keywordOnly: (args as { keyword_only?: boolean }).keyword_only,
        });
        break;
      case "get_page":
        result = await getPage((args as { identifier: string }).identifier);
        break;
      case "query_facts":
        result = await queryFacts({
          entity: (args as { entity?: string }).entity,
          metric: (args as { metric?: string }).metric,
          period: (args as { period?: string }).period,
          currentOnly: (args as { current_only?: boolean }).current_only,
          tableOnly: (args as { table_only?: boolean }).table_only,
          tableId: (args as { table_id?: string }).table_id,
          includeRawTable: (args as { include_raw_table?: boolean }).include_raw_table,
          limit: (args as { limit?: number }).limit,
        });
        break;
      case "get_table_artifact":
        result = await getTableArtifact(
          (args as { identifier: string }).identifier,
          (args as { table_id?: string }).table_id
        );
        break;
      case "compare_table_facts":
        result = await compareTableFacts({
          metric: (args as { metric: string }).metric,
          entities: (args as { entities?: string[] }).entities,
          periods: (args as { periods?: string[] }).periods,
          sourceIdentifier: (args as { source_identifier?: string }).source_identifier,
          currentOnly: (args as { current_only?: boolean }).current_only,
          limit: (args as { limit?: number }).limit,
        });
        break;
      case "list_entities":
        result = await listEntities(args as Parameters<typeof listEntities>[0]);
        break;
      case "resolve_wikilink":
        result = await resolveWikilink({
          hint: (args as { hint: string }).hint,
          type: (args as { type?: string }).type,
          limit: (args as { limit?: number }).limit,
          minSimilarity: (args as { min_similarity?: number }).min_similarity,
        });
        break;
      case "recent_activity":
        result = await recentActivity({
          days: (args as { days?: number }).days,
          kinds: (args as { kinds?: ("event" | "signal" | "page")[] }).kinds,
          limit: (args as { limit?: number }).limit,
        });
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, bigintReplacer, 2),
        },
      ],
    };
  } catch (e) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${(e as Error).message}\n${(e as Error).stack ?? ""}`,
        },
      ],
    };
  }
});

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

// ============================================================================
// 启动
// ============================================================================

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 注意：不要 console.log（污染 stdio JSON-RPC）。用 console.error 走 stderr。
  console.error("[ae-wiki MCP] server started on stdio");
}

main().catch((e) => {
  console.error("[ae-wiki MCP] fatal:", e);
  process.exit(1);
});
