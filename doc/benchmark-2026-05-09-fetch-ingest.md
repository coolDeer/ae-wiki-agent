# Fetch / Ingest Benchmark — 2026-05-09

## Scope

Debug sample run using:

```bash
bun src/cli.ts fetch-reports --all --types meeting_minutes,acecamp_article --per-type 1
```

Sample set:

- raw_file `496` -> page `1820` -> `sources/meeting_minutes-a3e1aa-260508`
- raw_file `497` -> page `1819` -> `sources/acecamp_article-a3e1a8-260508`

## Wall Time

| Step | Sample | Wall time |
| --- | --- | ---: |
| fetch-reports | 2 reports inserted | 8.34s |
| ingest:commit | meeting_minutes / `1820` | 4.40s |
| ingest:commit | acecamp_article / `1819` | 3.19s |
| ingest:write | meeting_minutes / `1820` | 1.33s |
| ingest:write | acecamp_article / `1819` | 1.33s |
| ingest:finalize | meeting_minutes / `1820` | 28.89s |
| ingest:finalize | acecamp_article / `1819` | 17.57s |

Approximate end-to-end machine time with per-stage parallelism:

- fetch: `8.34s`
- commit: `max(4.40, 3.19) = 4.40s`
- write: `max(1.33, 1.33) = 1.33s`
- finalize: `max(28.89, 17.57) = 28.89s`
- total: `42.96s`

Notes:

- This excludes manual / agent thinking time used to write the narrative.
- `ingest:write` timing includes DB write + deterministic review, not research synthesis latency.

## Pipeline Result

| Page | Facts | Links | Timeline entries | Review |
| --- | ---: | ---: | ---: | --- |
| `sources/acecamp_article-a3e1a8-260508` | 3 | 2 | 1 | pass |
| `sources/meeting_minutes-a3e1aa-260508` | 6 | 2 | 1 | pass |

Additional entities auto-created during finalize:

- `concepts/hdi`
- `industries/chemicals`

## Bug Found And Fixed

Initial run exposed a real bug:

- Stage 3 did not split `<!-- timeline ... -->` comment blocks into `pages.timeline`
- Stage 7 therefore reported `no timeline content, skipped`
- `page:review` also warned about a missing timeline marker

Fix applied:

- `src/core/markdown.ts`
  - `splitBody()` now supports multiline `<!-- timeline ... -->` blocks
  - closing `-->` is excluded from persisted timeline YAML
- `src/skills/review/index.ts`
  - timeline marker detection now accepts block-open syntax

Verification after fix:

```bash
bun src/cli.ts ingest:finalize 1819 --from 7
bun src/cli.ts ingest:finalize 1820 --from 7
```

Both pages inserted one timeline entry successfully.

## Observations

- `meeting_minutes` is materially heavier than `acecamp_article` in finalize time, mostly because the raw transcript is much longer and triggers more extraction work.
- The deterministic review gate adds very little latency relative to finalize.
- Stage 7 bugs are easy to miss if only `facts` and `links` are checked; benchmark runs should always include a `timeline_entries` verification query.
