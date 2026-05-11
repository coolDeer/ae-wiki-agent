---
name: ae-company-metadata-cleanup
description: Audit and repair ae-wiki company identity metadata. Use when the user asks to fill or normalize company display names, improve aliases, add Chinese/local names, add or correct tickers, find missing/suspicious/duplicate tickers, fix ticker aliases, or clean company metadata after page merge/enrich runs.
---

# ae-company-metadata-cleanup

Use this skill to clean company identity fields without rewriting company narratives. It wraps `company:metadata-audit` for diagnosis and `enrich:save --append` for audited metadata updates.

Do not declare cleanup complete after filling `display_name` alone. For every touched public company, either set a verified primary ticker or explicitly report why ticker is still blank.

## Safety Rules

- Treat Postgres as the source of truth. Do not edit `wiki/*.md`.
- Do not guess tickers. Prefer evidence from existing source/backlink pages. If wiki evidence is insufficient for any touched public company, verify against official exchange/company IR pages and cite URLs in the final response.
- Treat `ticker` as the primary listed security code in the current research context. Put ADR/OTC/secondary listing tickers in `aliases` unless the page's primary research context clearly uses that listing.
- Do not put exchange prefixes such as `NYSE:XYZ` in `ticker`; normalize to `XYZ` and use `--exchange` when useful.
- For private companies, leave `ticker` empty and improve `display_name` / `aliases`.
- Use `enrich:save --append` for writes so page_versions, events, alias conflict checks, and review still run.
- If metadata issues reveal duplicate pages, switch to `$ae-page-cleanup` first and merge/retype before repairing metadata.
- After a page merge, immediately re-run metadata audit for the canonical page. Fill canonical `display_name`, `ticker`, `exchange`, and aliases before calling the merged entity done.
- Avoid metadata-only writes to near-empty low-confidence stubs unless the user explicitly wants that tradeoff. `enrich:save --append` falls back to initial write for pages with tiny content, which can create page-review failures; prefer full `$ae-enrich` or `$ae-page-cleanup` for those.

## Workflow

Run from the project root:

```bash
cd /Users/levin/project/agent/ae-wiki-agent
```

### 1. Audit

Start with a broad company metadata audit:

```bash
bun src/cli.ts company:metadata-audit --limit 100
```

Use JSON for batch planning:

```bash
bun src/cli.ts company:metadata-audit --limit 200 --json > /tmp/company-metadata-audit.json
```

For first-run / backfill coverage, include every active company page, not just problem rows:

```bash
bun src/cli.ts company:metadata-audit --include-ok --limit 100000 --json > /tmp/company-metadata-audit-all.json
```

Verify that `rows.length === totalCompanies`; if not, rerun with a higher limit before planning writes.

Focus by confidence when needed:

```bash
bun src/cli.ts company:metadata-audit --confidence medium --limit 100
bun src/cli.ts company:metadata-audit --confidence high --limit 100
```

Also check duplicate identity signals before writing ticker fixes:

```bash
bun src/cli.ts alias-conflicts --type company --limit 100
bun src/cli.ts page:merge-candidates --type company --limit 100
```

### 2. Prioritize

Fix in this order:

1. `duplicate_ticker` and `ticker_suspicious` errors.
2. Duplicate identity / alias conflicts that block safe metadata writes.
3. Medium/high-confidence pages with missing `display_name`.
4. Public company pages with missing or non-normalized ticker.
5. High-backlink pages with sparse aliases.
6. Low-confidence stubs only when their identity is clear and content is already substantive; otherwise leave for enrich or page cleanup.

For a user-specified company, do all applicable steps in one pass: resolve duplicate candidates, update canonical metadata, verify ticker if public, then re-run page review and audit.

## Field Standards

| Field | Standard |
|---|---|
| `display_name` | Human-readable canonical company name, not slug format: `Delta Electronics`, not `delta-electronics`. |
| `ticker` | Primary listed ticker normalized uppercase: `AAPL`, `0700.HK`, `600519.SH`, `2308.TW`. |
| `exchange` | Optional exchange code/name when known: `NASDAQ`, `HKEX`, `SSE`, `TWSE`. |
| `aliases` | All equivalent names: slug name, display name, official English name, Chinese/local name, ticker, ADR/OTC/secondary tickers, common abbreviations. |

Company alias checklist:

- Slug name part, unless it is known bad or ambiguous.
- Display name.
- Official English legal name.
- Chinese/local official or common name when applicable.
- Primary ticker.
- ADR/OTC/secondary listing tickers when applicable.
- Common short names and abbreviations.

## Ticker Rules

- Public US common stock: `AAPL`, `NVDA`, `AMD`.
- Hong Kong: prefer four digits plus `.HK`, e.g. `0700.HK`.
- China A-share: `.SH` / `.SZ`, e.g. `600519.SH`, `300750.SZ`.
- Taiwan: use `.TW` or the repo's existing convention if already dominant; include alternatives such as `.TT` in aliases if used by sources.
- Japan: use `.T`, e.g. `6758.T`.
- Korea: use the six-digit KRX common-share code as `ticker` and set `--exchange KRX`, e.g. Samsung Electronics `005930`; put preferred shares such as `005935`, Yahoo-style forms such as `005930.KS`, and LSE GDRs such as `SMSN` / `SMSEL` in aliases unless the page is specifically about that traded line.
- ADR/OTC: usually aliases unless the research page is specifically about that traded line.
- Suspicious examples to fix or verify: `NYSE:ABC`, `ABC US`, `private`, `unknown`, Chinese text, comma-separated tickers, or multiple tickers in one field.

### Ticker Verification Workflow

Use this when a touched company is public, likely public, or has a ticker-looking alias:

1. Check existing aliases/backlinks for candidate tickers.
2. If not enough, verify with official company IR listing information or the primary exchange page. Use official sources before market-data aggregators.
3. Choose the common ordinary share on the primary listing as `ticker` unless the wiki page clearly tracks a different security line.
4. Set `--exchange` when known.
5. Add secondary listings, preferred shares, ADR/OTC, Bloomberg-style, Yahoo-style, and GDR tickers to `aliases`, not `ticker`.
6. Mention external verification URLs in the final response for every ticker set or corrected.

Do not leave `missing_ticker` unresolved for a high-backlink public company without saying why: private/unlisted, merged entity ambiguity, no official verification found, or needs PM decision on primary security.

### Post-Merge Canonical Cleanup

After applying or discovering a merge, inspect the canonical page:

```bash
bun src/cli.ts company:metadata-audit --limit 100
bun src/cli.ts page:review <canonical_page_id>
```

Then update the canonical metadata if still missing:

```bash
printf '%s\n' 'Metadata cleanup after entity merge: normalized canonical display name, aliases, and verified ticker.' | \
  bun src/cli.ts enrich:save <canonical_page_id> \
    --append \
    --display-name "Canonical Company Name" \
    --ticker TICKER \
    --exchange EXCHANGE \
    --aliases '["Canonical Company Name","TICKER","SECONDARY_TICKER"]'
```

If the canonical is public but ticker remains blank, the final report must list it under unresolved ticker cases with the reason.

## Fix Patterns

Metadata-only append:

```bash
printf '%s\n' 'Metadata cleanup: normalized display name, aliases, and ticker based on source evidence.' | \
  bun src/cli.ts enrich:save <page_id> \
    --append \
    --display-name "Canonical Company Name" \
    --ticker TICKER \
    --aliases '["Canonical Company Name","Official Legal Name","中文名","TICKER","ADR_OR_SECONDARY"]'
```

Private company, no ticker:

```bash
printf '%s\n' 'Metadata cleanup: normalized private-company identity fields; no public ticker found in source evidence.' | \
  bun src/cli.ts enrich:save <page_id> \
    --append \
    --display-name "Company Name" \
    --aliases '["Company Name","Official Legal Name","中文名"]'
```

Ticker correction while retaining an old valid secondary code:

```bash
printf '%s\n' 'Metadata cleanup: corrected primary ticker; previous listed code retained as alias.' | \
  bun src/cli.ts enrich:save <page_id> \
    --append \
    --ticker NEW_PRIMARY_TICKER \
    --exchange EXCHANGE \
    --aliases '["NEW_PRIMARY_TICKER","OLD_ADR_OR_SECONDARY_TICKER"]'
```

Remove an incorrect ticker alias:

```bash
printf '%s\n' 'Metadata cleanup: removed incorrect ticker alias and set verified ticker.' | \
  bun src/cli.ts enrich:save <page_id> \
    --append \
    --ticker VERIFIED_TICKER \
    --exchange EXCHANGE \
    --aliases-remove "BAD_TICKER" \
    --aliases "VERIFIED_TICKER"
```

If `enrich:save` rejects an alias conflict, do not force it by default. Investigate with:

```bash
bun src/cli.ts alias-conflicts --type company --limit 100
bun src/cli.ts page:merge-candidates --type company --limit 100
```

Only use `--allow-alias-conflict` for a documented legal dual-name or transition case.

## Verification

After changes:

```bash
bun src/cli.ts company:metadata-audit --limit 100
bun src/cli.ts alias-conflicts --type company --limit 100
bun src/cli.ts page:merge-candidates --type company --limit 100 --include-human-review
bun x tsc --noEmit
```

Report:

- Pages updated.
- Display names filled or normalized.
- Aliases added/removed.
- Tickers set/corrected.
- External verification URLs used for ticker changes.
- Remaining suspicious, duplicate, or missing ticker cases left for review, with a reason for each user-touched public company.
- Remaining duplicate candidates, especially any human-review merge candidates that were intentionally not applied.
