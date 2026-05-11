---
name: ae-entity-refresh
description: >
  Refresh one existing entity page after ingest finds new structured evidence.
  The durable worker uses this for entity-refresh jobs: read the target entity,
  inspect new source/fact/timeline/signal evidence, and append a source-backed
  delta with enrich_save append mode.
metadata:
  short-description: LLM refresh for stale entity pages
---

# ae-entity-refresh

Refresh exactly one entity page from an `entity-refresh` job. This skill is for already-created pages whose source/fact/timeline/signal evidence is newer than the compiled entity narrative.

## Contract

- Handle only the page named in the user prompt.
- Do not overwrite existing content.
- Do not defer to manual rewrite. If evidence is high-risk, signals-heavy, or long-stale, still perform an LLM refresh and append the delta.
- Preserve provenance: every material statement must cite a `[[sources/...]]`, `[[briefs/...]]`, fact, timeline entry, or signal.
- Prefer concise section-specific updates over full-page restatement.

## Workflow

1. Load the target entity:

   ```text
   enrich_get(page_id="<target>", allow_non_low=true)
   get_page(identifier="<target>")
   list_recent_comments(page="<target>", days=60)
   ```

2. Preview the stale evidence:

   ```text
   entity_refresh_preview(page_id="<target>", source_limit=8)
   ```

   Use the preview to identify new sources, facts, timeline entries, and system signals since the entity page was last updated.

3. Read the relevant source pages from the preview/backlinks:

   ```text
   get_page(identifier="sources/...")
   get_page(identifier="briefs/...")
   ```

   If the evidence is numeric, also call `query_facts(entity="<entity slug>", limit=30)` and compare with the existing page.

4. Write a delta only. Do not repeat the old page.

   Use headings that point to the affected area:

   ```markdown
   #### Financial Summary
   <new source-backed fact or estimate change>

   #### Catalysts / Risks
   <new catalyst, risk, or invalidation evidence>

   #### Source Coverage
   <new source view and how it confirms/contradicts prior page content>
   ```

   Omit headings with no new information. For thesis pages, include `#### Thesis Implication` and update thesis state with thesis tools only when the evidence supports it.

5. Save with append mode:

   ```text
   enrich_save(
     page_id="<target>",
     narrative="<delta markdown>",
     append=true,
     append_source="<primary source slug if one clear source drove the update>"
   )
   ```

   If the entity lacks `display_name`, provide `display_name` in the same call. If aliases/ticker/sector need a source-backed correction, update those fields too.

## Quality Rules

- A plain mention is not enough for a substantive update unless it changes source coverage materially.
- Do not invent missing financials, dates, tickers, aliases, or valuation fields.
- Do not write `facts` or `timeline` YAML blocks here; those belong to source ingest.
- If evidence contradicts the existing page, state the contradiction directly and cite both sides when available.
- If the preview returns no evidence, finish with a short final note and do not call `enrich_save`.
