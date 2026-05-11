export type MinionJobStatus = "waiting" | "active" | "paused" | "completed" | "failed" | "cancelled";

export type MinionJobName =
  | "embed_chunks"
  | "extract_facts"
  | "enrich_entity"
  | "entity-refresh"
  | "detect_signals"
  | "agent_run"
  | "lint_run"
  | "facts_expire"
  | "wiki_maintain";

export interface AgentRunData {
  skill: string;
  prompt: string;
  model: string;
  maxTurns: number;
  targetPageId?: string;
  sourceJobId?: string;
}
