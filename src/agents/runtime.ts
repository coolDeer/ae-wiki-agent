import { and, count, desc, eq, sql as drizzleSql } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

import { Actor, withAudit, withCreateAudit } from "~/core/audit.ts";
import { db, schema } from "~/core/db.ts";
import { getEnv } from "~/core/env.ts";
import { recordUsage } from "~/core/llm-usage.ts";
import { addJob, getJob, updateJobProgress } from "~/core/minions/queue.ts";
import type { AgentRunData } from "~/core/minions/types.ts";
import { fetchRawMarkdown } from "~/core/raw-loader.ts";
import {
  compareTableFacts,
  getPage,
  getTableArtifact,
  listEntities,
  queryFacts,
  recentActivity,
  search,
} from "~/mcp/queries.ts";
import {
  enrichList,
  enrichLoadContext,
  enrichPrepareNext,
  enrichSave,
} from "~/skills/enrich/index.ts";
import {
  ingestBrief,
  ingestCommit,
  ingestFinalize,
  ingestPass,
  ingestPeek,
  ingestWriteNarrative,
} from "~/skills/ingest/index.ts";
import {
  thesisClose,
  thesisList,
  thesisOpen,
  thesisShow,
  thesisUpdate,
  thesisWrite,
} from "~/skills/thesis/index.ts";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type AgentContentBlock = Record<string, any>;

// 单条 LLM 响应的 max_completion_tokens；env `WIKI_AGENT_MAX_OUTPUT_TOKENS` 控制（默认 20000）。
// ae-research-ingest 的 narrative 一次输出常达 5-8K tokens（中英混杂 + reasoning + tool args），
// 太小会撞 stop_reason='length' 中途截断，agent 没机会调 ingest_write 落 narrative。
const MAX_MODEL_OUTPUT_TOKENS = getEnv().WIKI_AGENT_MAX_OUTPUT_TOKENS;

export interface AgentRunOpts {
  skill: string;
  prompt?: string;
  model?: string;
  maxTurns?: number;
}

interface RuntimeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<unknown>;
}

interface PersistedMessage {
  turnIndex: number;
  role: "user" | "assistant";
  content: AgentContentBlock[];
  model: string | null;
  stopReason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

interface PersistedToolExecution {
  turnIndex: number;
  toolUseId: string;
  toolName: string;
  status: string;
  input: Record<string, unknown>;
  output: unknown;
  error: string | null;
}

export class JobPausedError extends Error {
  constructor(public readonly jobId: bigint) {
    super(`job #${jobId} paused`);
    this.name = "JobPausedError";
  }
}

export class JobCancelledError extends Error {
  constructor(public readonly jobId: bigint) {
    super(`job #${jobId} cancelled`);
    this.name = "JobCancelledError";
  }
}

export async function submitAgentRun(opts: AgentRunOpts): Promise<{ jobId: bigint }> {
  const skillPath = resolveSkillPath(opts.skill);
  await Bun.file(skillPath).text();

  const env = getEnv();
  const job = await addJob(
    "agent_run",
    {
      skill: opts.skill,
      prompt: opts.prompt?.trim() || defaultPromptForSkill(opts.skill),
      model: opts.model ?? env.OPENAI_AGENT_MODEL,
      maxTurns: opts.maxTurns ?? 20,
    },
    Actor.agentRuntime,
    {
      progress: {
        stage: "queued",
        message: `Queued skill ${opts.skill}`,
      },
    }
  );

  return { jobId: job.id };
}

export async function replayAgentRun(jobId: bigint): Promise<{ jobId: bigint }> {
  const [job] = await db
    .select()
    .from(schema.minionJobs)
    .where(
      and(
        eq(schema.minionJobs.id, jobId),
        eq(schema.minionJobs.name, "agent_run"),
        eq(schema.minionJobs.deleted, 0)
      )
    )
    .limit(1);
  if (!job) throw new Error(`agent job #${jobId} 不存在`);

  const data = normalizeAgentRunData(job.data);
  return submitAgentRun({
    skill: data.skill,
    prompt: data.prompt,
    model: data.model,
    maxTurns: data.maxTurns,
  });
}

export async function listAgentRuns(opts: {
  status?: "waiting" | "active" | "paused" | "completed" | "failed" | "cancelled";
  skill?: string;
  limit?: number;
} = {}): Promise<Array<Record<string, unknown>>> {
  const conditions = [eq(schema.minionJobs.name, "agent_run"), eq(schema.minionJobs.deleted, 0)];
  if (opts.status) conditions.push(eq(schema.minionJobs.status, opts.status));
  if (opts.skill) conditions.push(drizzleSql`${schema.minionJobs.data}->>'skill' = ${opts.skill}`);

  const rows = await db
    .select({
      id: schema.minionJobs.id,
      status: schema.minionJobs.status,
      attempts: schema.minionJobs.attempts,
      maxAttempts: schema.minionJobs.maxAttempts,
      progress: schema.minionJobs.progress,
      data: schema.minionJobs.data,
      error: schema.minionJobs.error,
      createTime: schema.minionJobs.createTime,
      startedAt: schema.minionJobs.startedAt,
      finishedAt: schema.minionJobs.finishedAt,
    })
    .from(schema.minionJobs)
    .where(and(...conditions))
    .orderBy(desc(schema.minionJobs.createTime))
    .limit(opts.limit ?? 20);

  return rows.map((row) => {
    const data = row.data as Record<string, unknown>;
    return {
      job_id: row.id.toString(),
      skill: data.skill,
      prompt: data.prompt,
      model: data.model,
      max_turns: data.maxTurns,
      status: row.status,
      attempts: row.attempts,
      max_attempts: row.maxAttempts,
      progress: row.progress,
      error: row.error,
      created_at: row.createTime,
      started_at: row.startedAt,
      finished_at: row.finishedAt,
    };
  });
}

export async function getAgentRun(jobId: bigint): Promise<Record<string, unknown> | null> {
  const [job] = await db
    .select()
    .from(schema.minionJobs)
    .where(
      and(
        eq(schema.minionJobs.id, jobId),
        eq(schema.minionJobs.name, "agent_run"),
        eq(schema.minionJobs.deleted, 0)
      )
    )
    .limit(1);
  if (!job) return null;

  const [messageStats] = await db
    .select({ count: count(schema.agentMessages.id) })
    .from(schema.agentMessages)
    .where(and(eq(schema.agentMessages.jobId, jobId), eq(schema.agentMessages.deleted, 0)));

  const [toolStats] = await db
    .select({ count: count(schema.agentToolExecutions.id) })
    .from(schema.agentToolExecutions)
    .where(and(eq(schema.agentToolExecutions.jobId, jobId), eq(schema.agentToolExecutions.deleted, 0)));

  const data = job.data as Record<string, unknown>;
  return {
    job_id: job.id.toString(),
    skill: data.skill,
    prompt: data.prompt,
    model: data.model,
    max_turns: data.maxTurns,
    status: job.status,
    attempts: job.attempts,
    max_attempts: job.maxAttempts,
    progress: job.progress,
    result: job.result,
    error: job.error,
    started_at: job.startedAt,
    finished_at: job.finishedAt,
    created_at: job.createTime,
    message_count: messageStats?.count ?? 0,
    tool_execution_count: toolStats?.count ?? 0,
  };
}

export async function getAgentTranscript(jobId: bigint): Promise<{
  messages: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
}> {
  const messages = await db
    .select({
      turnIndex: schema.agentMessages.turnIndex,
      role: schema.agentMessages.role,
      model: schema.agentMessages.model,
      stopReason: schema.agentMessages.stopReason,
      content: schema.agentMessages.content,
      tokensIn: schema.agentMessages.tokensIn,
      tokensOut: schema.agentMessages.tokensOut,
      startedAt: schema.agentMessages.startedAt,
      finishedAt: schema.agentMessages.finishedAt,
    })
    .from(schema.agentMessages)
    .where(and(eq(schema.agentMessages.jobId, jobId), eq(schema.agentMessages.deleted, 0)))
    .orderBy(schema.agentMessages.turnIndex);

  const tools = await db
    .select({
      turnIndex: schema.agentToolExecutions.turnIndex,
      toolUseId: schema.agentToolExecutions.toolUseId,
      toolName: schema.agentToolExecutions.toolName,
      status: schema.agentToolExecutions.status,
      input: schema.agentToolExecutions.input,
      output: schema.agentToolExecutions.output,
      error: schema.agentToolExecutions.error,
      startedAt: schema.agentToolExecutions.startedAt,
      finishedAt: schema.agentToolExecutions.finishedAt,
    })
    .from(schema.agentToolExecutions)
    .where(and(eq(schema.agentToolExecutions.jobId, jobId), eq(schema.agentToolExecutions.deleted, 0)))
    .orderBy(schema.agentToolExecutions.turnIndex, schema.agentToolExecutions.createTime);

  return {
    messages: messages.map((row) => ({
      turn_index: row.turnIndex,
      role: row.role,
      model: row.model,
      stop_reason: row.stopReason,
      content: row.content,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      started_at: row.startedAt,
      finished_at: row.finishedAt,
      text: extractText((row.content as AgentContentBlock[]) ?? []),
    })),
    tools: tools.map((row) => ({
      turn_index: row.turnIndex,
      tool_use_id: row.toolUseId,
      tool_name: row.toolName,
      status: row.status,
      input: row.input,
      output: row.output,
      error: row.error,
      started_at: row.startedAt,
      finished_at: row.finishedAt,
    })),
  };
}

export async function runAgentJob(job: typeof schema.minionJobs.$inferSelect): Promise<unknown> {
  const env = getEnv();
  const data = normalizeAgentRunData(job.data);
  const skillText = await Bun.file(resolveSkillPath(data.skill)).text();
  const tools = buildRuntimeTools();
  const openAiTools = tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const priorMessages = await loadPersistedMessages(job.id);
  const toolExecs = await loadPersistedToolExecutions(job.id);
  const toolExecByUseId = new Map(toolExecs.map((row) => [row.toolUseId, row]));

  const systemPrompt = [
    "You are the ae-wiki durable agent runtime.",
    "Execute the requested skill using tools instead of inventing state.",
    "Follow the skill strictly. If the skill says to write a file or mutate wiki state, use the dedicated tools.",
    "Do not claim success until the corresponding write/finalize tool has completed.",
    `Current date: ${new Date().toISOString()}.`,
    "",
    `Skill: ${data.skill}`,
    "",
    skillText,
  ].join("\n");

  const messages: Array<{ role: "user" | "assistant"; content: AgentContentBlock[] }> = priorMessages.map((row) => ({
    role: row.role,
    content: row.content,
  }));

  let nextTurnIndex = priorMessages.length;
  if (messages.length === 0) {
    const userContent: AgentContentBlock[] = [{ type: "text", text: data.prompt }];
    await persistAgentMessage(job.id, {
      turnIndex: 0,
      role: "user",
      content: userContent,
      metadata: { seeded: true },
    });
    messages.push({ role: "user", content: userContent });
    nextTurnIndex = 1;
  }

  let assistantTurns = priorMessages.filter((row) => row.role === "assistant").length;
  const lastMessage = priorMessages[priorMessages.length - 1];
  if (lastMessage?.role === "assistant") {
    const pendingToolUses = extractToolUses(lastMessage.content);
    if (pendingToolUses.length === 0) {
      return {
        skill: data.skill,
        final_text: extractText(lastMessage.content),
        resumed: true,
        turns: assistantTurns,
      };
    }
    const replayBlocks = await executeToolUses(job.id, lastMessage.turnIndex, pendingToolUses, tools, toolExecByUseId);
    if (replayBlocks.length > 0) {
      await persistAgentMessage(job.id, {
        turnIndex: nextTurnIndex,
        role: "user",
        content: replayBlocks,
        metadata: { replay: true },
      });
      messages.push({ role: "user", content: replayBlocks });
      nextTurnIndex += 1;
    }
  }

  while (assistantTurns < data.maxTurns) {
    await assertJobRunnable(job.id);
    await updateJobProgress(job.id, {
      stage: "llm",
      step: assistantTurns + 1,
      total: data.maxTurns,
      skill: data.skill,
      message: `Running ${data.skill}, turn ${assistantTurns + 1}/${data.maxTurns}`,
    }, Actor.agentRuntime);

    const response = await client.chat.completions.create({
      model: data.model,
      messages: toOpenAiMessages(systemPrompt, messages),
      tools: openAiTools as any,
      tool_choice: "auto",
      max_completion_tokens: MAX_MODEL_OUTPUT_TOKENS,
    } as any);

    const choice = response.choices?.[0];
    const assistantMessage = choice?.message;
    const assistantContent = fromOpenAiMessage(assistantMessage);
    const stopReason = choice?.finish_reason ?? null;
    const tokensIn = response.usage?.prompt_tokens ?? null;
    const tokensOut = response.usage?.completion_tokens ?? null;
    const totalTokens = response.usage?.total_tokens ?? null;

    void recordUsage({
      source: "agent_runtime",
      model: data.model,
      tokensIn,
      tokensOut,
      totalTokens,
      jobId: job.id,
      metadata: { skill: data.skill, turn: assistantTurns + 1 },
    });

    await persistAgentMessage(job.id, {
      turnIndex: nextTurnIndex,
      role: "assistant",
      content: assistantContent,
      model: data.model,
      stopReason,
      tokensIn,
      tokensOut,
    });
    messages.push({ role: "assistant", content: assistantContent });
    nextTurnIndex += 1;
    assistantTurns += 1;

    const toolUses = extractToolUses(assistantContent);
    if (toolUses.length === 0) {
      const finalText = extractText(assistantContent);
      await updateJobProgress(job.id, {
        stage: "completed",
        step: assistantTurns,
        total: data.maxTurns,
        skill: data.skill,
        message: `Completed ${data.skill}`,
      }, Actor.agentRuntime);
      return {
        skill: data.skill,
        final_text: finalText,
        turns: assistantTurns,
      };
    }

    const toolResults = await executeToolUses(job.id, nextTurnIndex - 1, toolUses, tools, toolExecByUseId);
    await persistAgentMessage(job.id, {
      turnIndex: nextTurnIndex,
      role: "user",
      content: toolResults,
      metadata: { tool_results: toolUses.map((tool) => tool.name) },
    });
    messages.push({ role: "user", content: toolResults });
    nextTurnIndex += 1;
  }

    const finalAssistant = [...messages].reverse().find((msg) => msg.role === "assistant");
  return {
    skill: data.skill,
    final_text: finalAssistant ? extractText((finalAssistant.content as AgentContentBlock[]) ?? []) : "",
    turns: assistantTurns,
    truncated: true,
  };
}

function normalizeAgentRunData(raw: unknown): AgentRunData {
  const data = (raw ?? {}) as Record<string, unknown>;
  const env = getEnv();
  const skill = typeof data.skill === "string" ? data.skill : "";
  if (!skill) throw new Error("agent_run data.skill 缺失");
  return {
    skill,
    prompt:
      typeof data.prompt === "string" && data.prompt.trim()
        ? data.prompt.trim()
        : defaultPromptForSkill(skill),
    model:
      typeof data.model === "string" && data.model.trim()
        ? data.model
        : env.OPENAI_AGENT_MODEL,
    maxTurns:
      typeof data.maxTurns === "number" && Number.isFinite(data.maxTurns)
        ? data.maxTurns
        : 20,
  };
}

function defaultPromptForSkill(skill: string): string {
  switch (skill) {
    case "ae-research-ingest":
      return "Execute this skill once for the next pending raw file.";
    case "ae-enrich":
      return "Execute this skill once for the next enrich candidate.";
    case "ae-daily-review":
      return "Generate the daily review for today.";
    case "ae-daily-summarize":
      return "Generate the daily summarize report for today.";
    default:
      return "Execute this skill once.";
  }
}

function resolveSkillPath(skill: string): URL {
  return new URL(`../../skills/${skill}/SKILL.md`, import.meta.url);
}

async function loadPersistedMessages(jobId: bigint): Promise<PersistedMessage[]> {
  const rows = await db
    .select({
      turnIndex: schema.agentMessages.turnIndex,
      role: schema.agentMessages.role,
      content: schema.agentMessages.content,
      model: schema.agentMessages.model,
      stopReason: schema.agentMessages.stopReason,
      tokensIn: schema.agentMessages.tokensIn,
      tokensOut: schema.agentMessages.tokensOut,
    })
    .from(schema.agentMessages)
    .where(and(eq(schema.agentMessages.jobId, jobId), eq(schema.agentMessages.deleted, 0)))
    .orderBy(schema.agentMessages.turnIndex);

  return rows.map((row) => ({
    turnIndex: row.turnIndex,
    role: row.role as "user" | "assistant",
    content: (row.content as AgentContentBlock[]) ?? [],
    model: row.model,
    stopReason: row.stopReason,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
  }));
}

async function loadPersistedToolExecutions(jobId: bigint): Promise<PersistedToolExecution[]> {
  const rows = await db
    .select({
      turnIndex: schema.agentToolExecutions.turnIndex,
      toolUseId: schema.agentToolExecutions.toolUseId,
      toolName: schema.agentToolExecutions.toolName,
      status: schema.agentToolExecutions.status,
      input: schema.agentToolExecutions.input,
      output: schema.agentToolExecutions.output,
      error: schema.agentToolExecutions.error,
    })
    .from(schema.agentToolExecutions)
    .where(and(eq(schema.agentToolExecutions.jobId, jobId), eq(schema.agentToolExecutions.deleted, 0)))
    .orderBy(schema.agentToolExecutions.turnIndex, schema.agentToolExecutions.createTime);

  return rows.map((row) => ({
    turnIndex: row.turnIndex,
    toolUseId: row.toolUseId,
    toolName: row.toolName,
    status: row.status,
    input: (row.input as Record<string, unknown>) ?? {},
    output: row.output,
    error: row.error,
  }));
}

async function persistAgentMessage(
  jobId: bigint,
  opts: {
    turnIndex: number;
    role: "user" | "assistant";
    content: AgentContentBlock[];
    model?: string | null;
    stopReason?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db
    .insert(schema.agentMessages)
    .values(
      withCreateAudit(
        {
          jobId,
          turnIndex: opts.turnIndex,
          role: opts.role,
          content: opts.content,
          model: opts.model ?? null,
          stopReason: opts.stopReason ?? null,
          tokensIn: opts.tokensIn ?? null,
          tokensOut: opts.tokensOut ?? null,
          startedAt: new Date(),
          finishedAt: new Date(),
          metadata: opts.metadata ?? {},
        },
        Actor.agentRuntime
      )
    )
    .onConflictDoNothing();
}

async function executeToolUses(
  jobId: bigint,
  turnIndex: number,
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  tools: RuntimeTool[],
  toolExecByUseId: Map<string, PersistedToolExecution>
): Promise<AgentContentBlock[]> {
  const blocks: AgentContentBlock[] = [];
  for (const toolUse of toolUses) {
    await assertJobRunnable(jobId);
    const previous = toolExecByUseId.get(toolUse.id);
    if (previous?.status === "completed") {
      blocks.push(makeToolResultBlock(toolUse.id, previous.output, false));
      continue;
    }
    if (previous?.status === "failed") {
      blocks.push(makeToolResultBlock(toolUse.id, previous.error ?? "tool failed", true));
      continue;
    }

    const tool = tools.find((candidate) => candidate.name === toolUse.name);
    if (!tool) {
      const error = `unknown tool: ${toolUse.name}`;
      await markToolExecution(jobId, turnIndex, toolUse, "failed", null, error);
      toolExecByUseId.set(toolUse.id, {
        turnIndex,
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        status: "failed",
        input: toolUse.input,
        output: null,
        error,
      });
      blocks.push(makeToolResultBlock(toolUse.id, error, true));
      continue;
    }

    await markToolExecution(jobId, turnIndex, toolUse, "pending", null, null);
    await updateJobProgress(jobId, {
      stage: "tool",
      tool: toolUse.name,
      message: `Running tool ${toolUse.name}`,
    }, Actor.agentRuntime);

    try {
      const output = await tool.execute(toolUse.input);
      await markToolExecution(jobId, turnIndex, toolUse, "completed", output, null);
      toolExecByUseId.set(toolUse.id, {
        turnIndex,
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        status: "completed",
        input: toolUse.input,
        output,
        error: null,
      });
      blocks.push(makeToolResultBlock(toolUse.id, output, false));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await markToolExecution(jobId, turnIndex, toolUse, "failed", null, msg);
      toolExecByUseId.set(toolUse.id, {
        turnIndex,
        toolUseId: toolUse.id,
        toolName: toolUse.name,
        status: "failed",
        input: toolUse.input,
        output: null,
        error: msg,
      });
      blocks.push(makeToolResultBlock(toolUse.id, msg, true));
    }
  }
  return blocks;
}

async function assertJobRunnable(jobId: bigint): Promise<void> {
  const currentJob = await getJob(jobId);
  if (!currentJob) throw new Error(`job #${jobId} disappeared`);
  if (currentJob.status === "cancelled") throw new JobCancelledError(jobId);
  if (currentJob.status === "paused") throw new JobPausedError(jobId);
}

async function markToolExecution(
  jobId: bigint,
  turnIndex: number,
  toolUse: { id: string; name: string; input: Record<string, unknown> },
  status: "pending" | "completed" | "failed",
  output: unknown,
  error: string | null
): Promise<void> {
  await db
    .insert(schema.agentToolExecutions)
    .values(
      withCreateAudit(
        {
          jobId,
          turnIndex,
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          status,
          input: toolUse.input,
          output: output == null ? null : toJsonValue(output),
          error,
          startedAt: new Date(),
          finishedAt: status === "pending" ? null : new Date(),
        },
        Actor.agentRuntime
      )
    )
    .onConflictDoUpdate({
      target: [schema.agentToolExecutions.jobId, schema.agentToolExecutions.toolUseId],
      targetWhere: drizzleSql`${schema.agentToolExecutions.deleted} = 0`,
      set: withAudit(
        {
          status,
          output: output == null ? null : toJsonValue(output),
          error,
          finishedAt: status === "pending" ? null : new Date(),
        },
        Actor.agentRuntime
      ),
      setWhere: drizzleSql`${schema.agentToolExecutions.deleted} = 0`,
    });
}

function extractToolUses(content: AgentContentBlock[]): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  return content
    .filter((block) => block?.type === "tool_use")
    .map((block) => ({
      id: String(block.id),
      name: String(block.name),
      input: ((block.input as Record<string, unknown>) ?? {}),
    }));
}

function extractText(content: AgentContentBlock[]): string {
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();
}

function makeToolResultBlock(toolUseId: string, output: unknown, isError: boolean): AgentContentBlock {
  return {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: serializeToolOutput(output),
    ...(isError ? { is_error: true } : {}),
  };
}

function toOpenAiMessages(
  systemPrompt: string,
  messages: Array<{ role: "user" | "assistant"; content: AgentContentBlock[] }>
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }];

  for (const message of messages) {
    if (message.role === "user") {
      const toolResults = message.content.filter((block) => block?.type === "tool_result");
      if (toolResults.length > 0) {
        for (const block of toolResults) {
          out.push({
            role: "tool",
            tool_call_id: String(block.tool_use_id),
            content: typeof block.content === "string" ? block.content : serializeToolOutput(block.content),
          });
        }
        continue;
      }

      const text = extractText(message.content);
      out.push({
        role: "user",
        content: text,
      });
      continue;
    }

    const text = extractText(message.content);
    const toolCalls = extractToolUses(message.content).map((toolUse) => ({
      id: toolUse.id,
      type: "function",
      function: {
        name: toolUse.name,
        arguments: JSON.stringify(toolUse.input),
      },
    }));

    out.push({
      role: "assistant",
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }

  return out;
}

function fromOpenAiMessage(message: any): AgentContentBlock[] {
  if (!message) return [];

  const blocks: AgentContentBlock[] = [];
  if (typeof message.content === "string" && message.content.trim()) {
    blocks.push({ type: "text", text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const item of message.content) {
      if (item?.type === "text" && typeof item.text === "string" && item.text.trim()) {
        blocks.push({ type: "text", text: item.text });
      }
    }
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const toolCall of toolCalls) {
    if (toolCall?.type !== "function") continue;
    blocks.push({
      type: "tool_use",
      id: String(toolCall.id),
      name: String(toolCall.function?.name ?? ""),
      input: parseToolArguments(toolCall.function?.arguments),
    });
  }

  return blocks;
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  return JSON.stringify(toJsonValue(output), null, 2);
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonValue(item);
    }
    return out;
  }
  return String(value);
}

function buildRuntimeTools(): RuntimeTool[] {
  return [
    {
      name: "search",
      description: "Hybrid search over the investment research wiki.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
          type: { type: "string" },
          date_from: { type: "string" },
          keyword_only: { type: "boolean" },
        },
        required: ["query"],
      },
      execute: async (input) =>
        search(String(input.query), {
          limit: asOptionalNumber(input.limit),
          type: asOptionalString(input.type),
          dateFrom: asOptionalString(input.date_from),
          keywordOnly: asOptionalBoolean(input.keyword_only),
        }),
    },
    {
      name: "get_page",
      description: "Fetch a full page by id or slug.",
      inputSchema: {
        type: "object",
        properties: {
          identifier: { type: "string" },
        },
        required: ["identifier"],
      },
      execute: async (input) => getPage(String(input.identifier)),
    },
    {
      name: "query_facts",
      description: "Query structured facts by entity / metric / period.",
      inputSchema: {
        type: "object",
        properties: {
          entity: { type: "string" },
          metric: { type: "string" },
          period: { type: "string" },
          current_only: { type: "boolean" },
          table_only: { type: "boolean" },
          table_id: { type: "string" },
          include_raw_table: { type: "boolean" },
          limit: { type: "integer" },
        },
      },
      execute: async (input) =>
        queryFacts({
          entity: asOptionalString(input.entity),
          metric: asOptionalString(input.metric),
          period: asOptionalString(input.period),
          currentOnly: asOptionalBoolean(input.current_only),
          tableOnly: asOptionalBoolean(input.table_only),
          tableId: asOptionalString(input.table_id),
          includeRawTable: asOptionalBoolean(input.include_raw_table),
          limit: asOptionalNumber(input.limit),
        }),
    },
    {
      name: "get_table_artifact",
      description: "Fetch structured table artifacts by page and optional table id.",
      inputSchema: {
        type: "object",
        properties: {
          identifier: { type: "string" },
          table_id: { type: "string" },
        },
        required: ["identifier"],
      },
      execute: async (input) =>
        getTableArtifact(
          String(input.identifier),
          asOptionalString(input.table_id)
        ),
    },
    {
      name: "compare_table_facts",
      description: "Build a comparison matrix from table-derived facts.",
      inputSchema: {
        type: "object",
        properties: {
          metric: { type: "string" },
          entities: {
            type: "array",
            items: { type: "string" },
          },
          periods: {
            type: "array",
            items: { type: "string" },
          },
          source_identifier: { type: "string" },
          current_only: { type: "boolean" },
          limit: { type: "integer" },
        },
        required: ["metric"],
      },
      execute: async (input) =>
        compareTableFacts({
          metric: String(input.metric),
          entities: Array.isArray(input.entities)
            ? input.entities.map((item) => String(item))
            : undefined,
          periods: Array.isArray(input.periods)
            ? input.periods.map((item) => String(item))
            : undefined,
          sourceIdentifier: asOptionalString(input.source_identifier),
          currentOnly: asOptionalBoolean(input.current_only),
          limit: asOptionalNumber(input.limit),
        }),
    },
    {
      name: "list_entities",
      description: "List entity pages with filters.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string" },
          sector: { type: "string" },
          ticker: { type: "string" },
          confidence: { type: "string" },
          limit: { type: "integer" },
        },
      },
      execute: async (input) =>
        listEntities({
          type: asOptionalString(input.type),
          sector: asOptionalString(input.sector),
          ticker: asOptionalString(input.ticker),
          confidence: asOptionalString(input.confidence),
          limit: asOptionalNumber(input.limit),
        }),
    },
    {
      name: "recent_activity",
      description: "Fetch recent events, signals, and new pages.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "integer" },
          kinds: {
            type: "array",
            items: { type: "string" },
          },
          limit: { type: "integer" },
        },
      },
      execute: async (input) =>
        recentActivity({
          days: asOptionalNumber(input.days),
          kinds: Array.isArray(input.kinds)
            ? input.kinds.map((item) => String(item)) as Array<"event" | "signal" | "page">
            : undefined,
          limit: asOptionalNumber(input.limit),
        }),
    },
    {
      name: "get_raw_file",
      description: "Fetch raw markdown by raw_file_id or page_id. Supports offset/max_chars paging.",
      inputSchema: {
        type: "object",
        properties: {
          raw_file_id: { type: "string" },
          page_id: { type: "string" },
          offset: { type: "integer" },
          max_chars: { type: "integer" },
        },
      },
      execute: async (input) => {
        const rawFile = await resolveRawFile(
          asOptionalBigInt(input.raw_file_id),
          asOptionalBigInt(input.page_id)
        );
        if (!rawFile) throw new Error("raw file not found");
        const text = await fetchRawMarkdown(rawFile);
        const offset = asOptionalNumber(input.offset) ?? 0;
        const maxChars = asOptionalNumber(input.max_chars) ?? 12000;
        const slice = text.slice(offset, offset + maxChars);
        return {
          raw_file_id: rawFile.id.toString(),
          title: rawFile.title,
          research_type: rawFile.researchType,
          markdown_url: rawFile.markdownUrl,
          offset,
          max_chars: maxChars,
          returned_chars: slice.length,
          total_chars: text.length,
          truncated: offset + maxChars < text.length,
          content: slice,
        };
      },
    },
    {
      name: "ingest_peek",
      description: "Peek the next pending raw_file without writing anything.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => ingestPeek(),
    },
    {
      name: "ingest_pass",
      description: "Mark a raw file as pass with reason.",
      inputSchema: {
        type: "object",
        properties: {
          raw_file_id: { type: "string" },
          reason: { type: "string" },
        },
        required: ["raw_file_id", "reason"],
      },
      execute: async (input) => {
        await ingestPass(parseRequiredBigInt(input.raw_file_id, "raw_file_id"), String(input.reason), Actor.agentRuntime);
        return { ok: true };
      },
    },
    {
      name: "ingest_commit",
      description: "Commit a raw file into a source page skeleton.",
      inputSchema: {
        type: "object",
        properties: { raw_file_id: { type: "string" } },
        required: ["raw_file_id"],
      },
      execute: async (input) => ingestCommit(parseRequiredBigInt(input.raw_file_id, "raw_file_id")),
    },
    {
      name: "ingest_brief",
      description: "Commit a raw file into a brief page skeleton.",
      inputSchema: {
        type: "object",
        properties: { raw_file_id: { type: "string" } },
        required: ["raw_file_id"],
      },
      execute: async (input) => ingestBrief(parseRequiredBigInt(input.raw_file_id, "raw_file_id")),
    },
    {
      name: "ingest_write",
      description: "Write source/brief narrative into a page.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          narrative: { type: "string" },
        },
        required: ["page_id", "narrative"],
      },
      execute: async (input) => {
        await ingestWriteNarrative(parseRequiredBigInt(input.page_id, "page_id"), String(input.narrative));
        return { ok: true };
      },
    },
    {
      name: "ingest_finalize",
      description: "Finalize a committed ingest page.",
      inputSchema: {
        type: "object",
        properties: { page_id: { type: "string" } },
        required: ["page_id"],
      },
      execute: async (input) => {
        await ingestFinalize(parseRequiredBigInt(input.page_id, "page_id"));
        return { ok: true };
      },
    },
    {
      name: "enrich_get",
      description: "Load one specific enrich candidate with backlinks by page id.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
        },
        required: ["page_id"],
      },
      execute: async (input) =>
        enrichLoadContext(parseRequiredBigInt(input.page_id, "page_id")),
    },
    {
      name: "enrich_next",
      description: "Get the next pending enrich candidate with backlinks.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string" },
          skip: { type: "integer" },
        },
      },
      execute: async (input) =>
        enrichPrepareNext({
          type: asOptionalString(input.type) as any,
          skip: asOptionalNumber(input.skip),
        }),
    },
    {
      name: "enrich_list",
      description: "List pending enrich candidates.",
      inputSchema: {
        type: "object",
        properties: {
          type: { type: "string" },
          limit: { type: "integer" },
        },
      },
      execute: async (input) =>
        enrichList({
          type: asOptionalString(input.type) as any,
          limit: asOptionalNumber(input.limit),
        }),
    },
    {
      name: "enrich_save",
      description: "Save an enrich narrative and bump confidence.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          narrative: { type: "string" },
          ticker: { type: "string" },
          sector: { type: "string" },
          sub_sector: { type: "string" },
          country: { type: "string" },
          exchange: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          confidence: { type: "string" },
        },
        required: ["page_id", "narrative"],
      },
      execute: async (input) => {
        await enrichSave(parseRequiredBigInt(input.page_id, "page_id"), String(input.narrative), {
          ticker: asOptionalString(input.ticker),
          sector: asOptionalString(input.sector),
          subSector: asOptionalString(input.sub_sector),
          country: asOptionalString(input.country),
          exchange: asOptionalString(input.exchange),
          aliases: Array.isArray(input.aliases) ? input.aliases.map((item) => String(item)) : undefined,
          confidence: asOptionalString(input.confidence) as any,
        });
        return { ok: true };
      },
    },
    {
      name: "thesis_list",
      description: "List theses.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          direction: { type: "string" },
          limit: { type: "integer" },
        },
      },
      execute: async (input) =>
        thesisList({
          status: asOptionalString(input.status) as any,
          direction: asOptionalString(input.direction) as any,
          limit: asOptionalNumber(input.limit),
        }),
    },
    {
      name: "thesis_show",
      description: "Show one thesis with signals and recent facts.",
      inputSchema: {
        type: "object",
        properties: { page_id: { type: "string" } },
        required: ["page_id"],
      },
      execute: async (input) => thesisShow(parseRequiredBigInt(input.page_id, "page_id")),
    },
    {
      name: "thesis_open",
      description: "Create a thesis page.",
      inputSchema: {
        type: "object",
        properties: {
          target_slug: { type: "string" },
          direction: { type: "string" },
          name: { type: "string" },
          conviction: { type: "string" },
          status: { type: "string" },
          date_opened: { type: "string" },
          price_at_open: { type: "string" },
          pm_owner: { type: "string" },
          catalysts: { type: "array", items: { type: "object" } },
          validation_conditions: { type: "array", items: { type: "object" } },
        },
        required: ["target_slug", "direction", "name"],
      },
      execute: async (input) =>
        thesisOpen({
          targetSlug: String(input.target_slug),
          direction: String(input.direction) as any,
          name: String(input.name),
          conviction: asOptionalString(input.conviction) as any,
          status: asOptionalString(input.status) as any,
          dateOpened: asOptionalString(input.date_opened),
          priceAtOpen: asOptionalString(input.price_at_open),
          pmOwner: asOptionalString(input.pm_owner),
          catalysts: Array.isArray(input.catalysts) ? (input.catalysts as any) : undefined,
          validationConditions: Array.isArray(input.validation_conditions)
            ? (input.validation_conditions as any)
            : undefined,
        }),
    },
    {
      name: "thesis_write",
      description: "Write a thesis narrative.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          narrative: { type: "string" },
        },
        required: ["page_id", "narrative"],
      },
      execute: async (input) => {
        await thesisWrite(parseRequiredBigInt(input.page_id, "page_id"), String(input.narrative));
        return { ok: true };
      },
    },
    {
      name: "thesis_update",
      description: "Update thesis state fields.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          conviction: { type: "string" },
          status: { type: "string" },
          add_catalyst: { type: "object" },
          mark_condition: { type: "object" },
          pm_owner: { type: "string" },
          reason: { type: "string" },
        },
        required: ["page_id"],
      },
      execute: async (input) => {
        await thesisUpdate(parseRequiredBigInt(input.page_id, "page_id"), {
          conviction: asOptionalString(input.conviction) as any,
          status: asOptionalString(input.status) as any,
          addCatalyst: (input.add_catalyst as any) ?? undefined,
          markCondition: (input.mark_condition as any) ?? undefined,
          pmOwner: asOptionalString(input.pm_owner),
          reason: asOptionalString(input.reason),
        });
        return { ok: true };
      },
    },
    {
      name: "thesis_close",
      description: "Close a thesis.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          reason: { type: "string" },
          price_close: { type: "string" },
          date_closed: { type: "string" },
          note: { type: "string" },
        },
        required: ["page_id", "reason"],
      },
      execute: async (input) => {
        await thesisClose(parseRequiredBigInt(input.page_id, "page_id"), {
          reason: String(input.reason) as any,
          priceAtClose: asOptionalString(input.price_close),
          dateClosed: asOptionalString(input.date_closed),
          note: asOptionalString(input.note),
        });
        return { ok: true };
      },
    },
    {
      name: "read_workspace_file",
      description: "Read a file under WORKSPACE_DIR.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: async (input) => {
        const filePath = resolveWorkspacePath(String(input.path), false);
        const content = await readFile(filePath, "utf-8");
        return { path: filePath, content };
      },
    },
    {
      name: "write_workspace_file",
      description: "Write a file under WORKSPACE_DIR.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async (input) => {
        const filePath = resolveWorkspacePath(String(input.path), true);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, String(input.content), "utf-8");
        return { ok: true, path: filePath };
      },
    },
  ];
}

async function resolveRawFile(rawFileId?: bigint | null, pageId?: bigint | null) {
  if (rawFileId) {
    const [row] = await db
      .select({
        id: schema.rawFiles.id,
        markdownUrl: schema.rawFiles.markdownUrl,
        title: schema.rawFiles.title,
        researchType: schema.rawFiles.researchType,
      })
      .from(schema.rawFiles)
      .where(and(eq(schema.rawFiles.id, rawFileId), eq(schema.rawFiles.deleted, 0)))
      .limit(1);
    return row ?? null;
  }

  if (pageId) {
    const [row] = await db
      .select({
        id: schema.rawFiles.id,
        markdownUrl: schema.rawFiles.markdownUrl,
        title: schema.rawFiles.title,
        researchType: schema.rawFiles.researchType,
      })
      .from(schema.rawFiles)
      .where(and(eq(schema.rawFiles.ingestedPageId, pageId), eq(schema.rawFiles.deleted, 0)))
      .limit(1);
    return row ?? null;
  }

  return null;
}

function resolveWorkspacePath(inputPath: string, allowWrite: boolean): string {
  const root = path.resolve(getEnv().WORKSPACE_DIR);
  const resolved = path.resolve(root, inputPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`path escapes workspace: ${inputPath}`);
  }
  if (!allowWrite) return resolved;
  return resolved;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function parseRequiredBigInt(value: unknown, field: string): bigint {
  const parsed = asOptionalBigInt(value);
  if (!parsed) throw new Error(`${field} must be a bigint-like string`);
  return parsed;
}
