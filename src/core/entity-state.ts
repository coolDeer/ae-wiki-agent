export const PAGE_ENTITY_STATES = [
  "stub",
  "candidate_promoted",
  "compiled",
] as const;

export type PageEntityState = (typeof PAGE_ENTITY_STATES)[number];

export function isEntityStateAwaitingEnrich(
  state: string | null | undefined
): boolean {
  return state === "stub" || state === "candidate_promoted";
}

export function normalizeEntityState(
  state: string | null | undefined
): PageEntityState {
  if (state === "stub" || state === "candidate_promoted" || state === "compiled") {
    return state;
  }
  return "compiled";
}
