export type MinionJobStatus = "waiting" | "active" | "paused" | "completed" | "failed" | "cancelled";

export const MINION_JOB_NAMES = [
  "embed_chunks",
  "extract_facts",
  "enrich_entity",
  "entity-refresh",
  "entity_refresh_queue",
  "detect_signals",
  "agent_run",
  "lint_run",
  "facts_expire",
  "wiki_maintain",
] as const;

export type MinionJobName = (typeof MINION_JOB_NAMES)[number];

export interface AgentRunData {
  skill: string;
  prompt: string;
  model: string;
  maxTurns: number;
  targetPageId?: string;
  sourceJobId?: string;
}
