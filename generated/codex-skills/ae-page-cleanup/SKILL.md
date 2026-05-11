---
name: ae-page-cleanup
description: Clean and govern ae-wiki generated pages. Use when the user asks to reduce useless pages, clean redlink/page explosion, find duplicate pages, merge duplicate company/industry/concept/thesis entities, retire noisy low-confidence entity pages, repair wrong page types, or audit page hygiene after ingest/enrich runs. For company display names, aliases, and ticker cleanup, use ae-company-metadata-cleanup instead.
---

# ae-page-cleanup

Use this skill to turn page hygiene into an explicit review loop: diagnose duplicates and noisy stubs, classify each candidate, dry-run destructive actions, then apply only safe merges or safe retirements.

For company `display_name`, `aliases`, and `ticker` cleanup, use `$ae-company-metadata-cleanup`.

## Safety Rules

- Treat Postgres as the source of truth. Do not edit `wiki/*.md` as a substitute for DB cleanup.
- Default to preview mode. Run `--dry-run` before every `page:merge` or `page:retire`.
- Never hard-delete. Cleanup means soft-delete/archive via CLI, with audit events.
- Do not retire pages with active references. `page:retire` blocks pages with active links, facts, timeline entries, signals, or theses.
- Do not merge across page type or `source_id`. If the type is wrong, use `enrich:retype` first.
- Do not use this skill to delete `source`, `brief`, or `output` pages. For raw noise before ingest, use `ingest:pass`; for bad committed source/brief pages, use `ingest:skip`.
- Human-review cases stay as recommendations unless the user explicitly asks to apply them after review.

## Workflow

Run from the project root:

```bash
cd /Users/levin/project/agent/ae-wiki-agent
```

### 1. Diagnose

Start broad, then narrow by type if one area is noisy:

```bash
bun src/cli.ts page:merge-candidates --limit 50
bun src/cli.ts alias-conflicts --limit 50
bun src/cli.ts orphans --confidence low --min-age-days 3 --limit 100
bun src/cli.ts duplicates --min-sim 0.72 --limit 50
```

Use `--json` when you need to programmatically compare candidates or produce a cleanup report.

### 2. Classify

Assign every candidate one action:

| Action | When to choose | Command family |
|---|---|---|
| `merge` | Same real-world entity split into multiple pages | `page:merge-candidates` → `page:merge` |
| `structure_only_merge` | Same entity, but duplicate narrative is medium-risk or already has updates | `page:merge --skip-narrative-fusion` |
| `retype` | Page is real but wrong namespace/type, e.g. `companies/Trainium` | `enrich:retype` |
| `alias_repair` | Shared alias is ambiguous or wrong, but pages are distinct entities | `enrich:save --aliases-remove ...` |
| `enrich` | Low-confidence page is real and has backlinks | `enrich:next` / `enrich:save` |
| `retire` | Low-confidence orphan stub has no useful content or active references | `page:retire` |
| `keep` | Ambiguous term, standalone concept, or insufficient evidence | no write |

Canonical page choice for merges:

- Prefer higher `confidence`.
- Then prefer more backlinks.
- Then prefer higher `completeness_score`.
- Then prefer richer aliases and cleaner slug.
- If still tied, prefer the older/lower id page.

### 3. Merge True Duplicates

For automated cleanup, prefer the deterministic runner. It rescans after each pass so merge-created secondary candidates do not linger:

```bash
bun src/cli.ts page:auto-cleanup --apply --include-structure-only --include-human-review-identity --limit 120 --max-passes 6 --json
```

Without `--apply`, the runner is audit-only:

```bash
bun src/cli.ts page:auto-cleanup --include-structure-only --include-human-review-identity --limit 120 --max-passes 6
```

The runner applies only:

- `auto_merge` candidates after internal `page:merge --dry-run` passes.
- `structure_only` candidates only when identity evidence is strong; it uses `--skip-narrative-fusion`.
- `human_review` candidates only when identity evidence is very strong (`duplicate_similarity` near exact plus repeated alias conflicts). For large long-form pages it uses `--skip-narrative-fusion` instead of appending two full compiled narratives.
- Low-confidence orphan retirements only when `page:retire --dry-run` returns no blockers.

For each `auto_merge` candidate, inspect the suggested command and dry-run it:

```bash
bun src/cli.ts page:merge <canonical_page_id> <duplicate_page_id> \
  --reason "entity dedupe: <why these are the same entity>" \
  --dry-run
```

Check the dry-run JSON:

- `planned.inboundLinks/outboundLinks/originLinks`
- `planned.entityFacts/timelineEntries/signals/theses`
- `mergedAliases`
- `narrativeFusion.mode`

Apply only when the direction is correct:

```bash
bun src/cli.ts page:merge <canonical_page_id> <duplicate_page_id> \
  --reason "entity dedupe: <why these are the same entity>"
```

For `structure_only` candidates, preserve structure but do not auto-append narrative:

```bash
bun src/cli.ts page:merge <canonical_page_id> <duplicate_page_id> \
  --skip-narrative-fusion \
  --reason "entity dedupe: structure only after review"
```

Do not apply `human_review` candidates automatically. Report them with the evidence and ask for review.

### 4. Retype Real Pages

If a page is real but has the wrong prefix/type, retype instead of retiring:

```bash
bun src/cli.ts enrich:retype <page_id> --new-type concept --reason "page cleanup: wrong namespace"
```

After retype, run `enrich:save` if the page still needs display name, aliases, ticker, sector, or narrative.

### 5. Repair Bad Aliases

If `alias-conflicts` shows distinct entities sharing an alias, remove the alias from the weaker/wrong page. Use append mode so the audit trail shows why the alias changed:

```bash
printf '%s\n' 'Alias cleanup: removed ambiguous alias that belongs to a distinct entity.' | \
  bun src/cli.ts enrich:save <page_id> \
    --append \
    --aliases-remove "<bad alias>"
```

If the target entity page lacks `display_name`, include `--display-name "<canonical name>"` because `enrich:save` requires display names for entity pages.

### 6. Retire Noisy Orphans

Only retire pages that satisfy all of these:

- `type` is `company`, `industry`, `concept`, or `thesis`.
- `confidence='low'`.
- Orphan report shows no inbound backlinks.
- The page is an obvious stub/noise page, not a real investable entity.
- Dry-run `page:retire` shows no blockers.

Dry-run first:

```bash
bun src/cli.ts page:retire <page_id> \
  --reason "page cleanup: low-confidence orphan noise page" \
  --dry-run
```

Apply only if `blockers` is empty:

```bash
bun src/cli.ts page:retire <page_id> \
  --reason "page cleanup: low-confidence orphan noise page"
```

Use `--force` only after manual review. It can bypass confidence/content-length blockers, but it still must not bypass active reference blockers.

### 7. Verify

After applying changes, rerun the same diagnostics:

```bash
bun src/cli.ts page:merge-candidates --limit 50
bun src/cli.ts alias-conflicts --limit 50
bun src/cli.ts orphans --confidence low --min-age-days 3 --limit 100
bun x tsc --noEmit
```

Report:

- Merges applied, with canonical <= duplicate slugs.
- Retired pages, with reason.
- Alias repairs and retypes.
- Remaining human-review candidates.
- Any command that failed or was intentionally left unapplied.

## Operating Modes

For an audit-only request, stop after diagnosis and classification.

For “clean it up” requests, apply only:

- `auto_merge` candidates after dry-run confirms direction.
- `structure_only_merge` candidates when narrative risk is medium but entity identity is certain.
- `retire` candidates with empty `blockers`.
- `retype` and `alias_repair` when the target identity is clear.

For scheduled/nightly cleanup, use `page:auto-cleanup --apply --include-structure-only --include-human-review-identity`. It is safer than hand-written agent loops because every write goes through the same dry-run gate and the command keeps rescanning until no eligible merge candidates remain or `--max-passes` is reached.
