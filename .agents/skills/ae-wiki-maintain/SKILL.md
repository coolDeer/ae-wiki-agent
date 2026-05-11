---
name: ae-wiki-maintain
description: Run the ae-wiki maintenance loop for daily or scheduled upkeep. Use when the user asks to maintain the wiki, run nightly maintenance, check wiki health, auto-refresh stale entity pages, expire old facts, enqueue enrich work, enqueue thesis reviews, or set up Codex / Claude Code scheduled ae-wiki upkeep.
metadata:
  short-description: Run ae-wiki maintenance loop
---

# ae-wiki-maintain

Unified maintenance entrypoint for ae-wiki. This skill wraps `bun src/cli.ts wiki:maintain`, which composes existing health checks and backlog commands into a gbrain-style upkeep cycle while preserving ae-wiki's source-first investment research model.

## Trigger Examples

- `$ae-wiki-maintain` — inspect current health, default to dry-run in interactive use.
- `$ae-wiki-maintain nightly` — run the safe nightly queue recipe.
- `$ae-wiki-maintain --apply-safe` — expire stale facts and append low-risk entity updates.
- `$ae-wiki-maintain --enqueue-enrich --enqueue-thesis-review` — queue agent work for entity enrich and thesis review.
- Natural language: "run wiki maintenance", "nightly upkeep", "refresh stale entities", "check ae-wiki health".

## Safety Model

`wiki:maintain` has three separate side-effect levels:

| Mode | Command flags | Side effects |
|---|---|---|
| Preview | `--dry-run` | No page writes, no fact writes, no jobs, no audit event |
| Audit report | no write flags | Writes `events(action='lint_run')` and `events(action='wiki_maintain_run')`; no page/fact/job changes |
| Safe upkeep | `--apply-safe` | Expires old latest facts and append-only refreshes low-risk entity pages |
| Agent queue | `--enqueue-enrich` / `--enqueue-thesis-review` | Queues `enrich_entity` or `agent_run(ae-thesis-track)` jobs |
| Detached run | `--queue` | Inserts one `wiki_maintain` minion job; worker/supervisor must be running |

Never enable `--apply-safe`, `--enqueue-enrich`, or `--enqueue-thesis-review` unless the user asked for maintenance, nightly execution, or automated upkeep.

## Interactive Workflow

1. Change to the project root:

   ```bash
   cd /Users/levin/project/agent/ae-wiki-agent
   ```

2. Start with a preview:

   ```bash
   bun src/cli.ts wiki:maintain --dry-run --limit 10
   ```

3. Read the summary:

   - `stale_entities` / `safe_refresh_candidates` — compiled entity pages lag new evidence.
   - `facts_coverage=high:N` — source pages likely lost structured facts.
   - `enrich=enrich_now:N retrigger:M` — entity pages need initial enrich or re-enrich.
   - `thesis_review_now=N` — active/monitoring theses need PM review.
   - `page_review_failures` / `output_failures` — deterministic quality gates failing.

4. If the user asked for safe upkeep, run:

   ```bash
   bun src/cli.ts wiki:maintain --apply-safe --entity-refresh-limit 5 --fact-age-days 90 --limit 20
   ```

5. If the user asked to queue agent work, run only the requested queue flags:

   ```bash
   bun src/cli.ts wiki:maintain --enqueue-enrich --enrich-limit 10 --limit 20
   bun src/cli.ts wiki:maintain --enqueue-thesis-review --thesis-limit 10 --limit 20
   ```

6. Report the health summary, actions applied, jobs queued, and any next steps. Do not paste full JSON unless asked.

## Nightly / Scheduled Recipe

For a detached nightly run, enqueue one maintenance job and let the worker consume it:

```bash
cd /Users/levin/project/agent/ae-wiki-agent
bun src/cli.ts wiki:maintain \
  --apply-safe \
  --entity-refresh-limit 5 \
  --enqueue-enrich \
  --enrich-limit 10 \
  --enqueue-thesis-review \
  --thesis-limit 10 \
  --fact-age-days 90 \
  --limit 20 \
  --queue
```

Ensure a worker is running:

```bash
bun src/cli.ts jobs:supervisor status
bun src/cli.ts jobs:supervisor start --detach
```

If the environment does not use the supervisor, run the worker directly:

```bash
bun src/cli.ts jobs:worker
```

## Codex / Claude Code Scheduling

Use the scheduled task prompt:

```text
Use $ae-wiki-maintain nightly for ae-wiki-agent. Run the detached nightly recipe from the skill and report the queued job id plus the health/action summary if available.
```

For an external scheduler, use the detached command from "Nightly / Scheduled Recipe". This project intentionally does not vendor cron/launchd/systemd files; schedulers should call the CLI directly.

For Codex discovery, sync this repo skill into Codex after edits:

```bash
bun scripts/sync-codex-skills.ts --install --only ae-wiki-maintain
```

For Claude Code discovery, keep `.claude/skills/ae-wiki-maintain` pointing at `../../skills/ae-wiki-maintain`.

## When To Escalate

- `facts_coverage=high:N` — do not invent facts. Run `facts:coverage --json`, inspect sources, then rerun `facts:re-extract <page_id>` or fix the source narrative.
- `page_review_failures>0` — repair pages before relying on downstream facts/signals.
- `manual_rewrite` entity candidates — do not let append-only refresh replace analyst judgment; use the entity page and source evidence to rewrite the relevant sections manually.
- `output_failures>0` — regenerate or repair daily outputs, then rerun `output:backlog`.
- Queue stuck or growing — inspect `bun src/cli.ts jobs:list --status waiting --limit 20` and `bun src/cli.ts jobs:supervisor status`.

## Output Template

```text
ae-wiki maintenance complete

mode: dry-run | audit | apply-safe | queued-nightly
health: lint_issues=X, stale_entities=Y, facts_high=Z, enrich=A/B, thesis_review=C
actions: expired_facts=N, entity_refresh_applied=M, enrich_jobs=E, thesis_jobs=T
queued: wiki_maintain job #<id> (if --queue was used)
next: <highest priority follow-up>
```
