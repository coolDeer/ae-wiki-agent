# Table Artifacts

## Purpose

`raw_data.source = 'tables'` stores a structured snapshot of markdown tables extracted during ingest Stage 2.

This sidecar exists so that important report tables do not get lost after the agent rewrites the source into narrative prose.

It gives the system three durable layers:

1. the original table markdown
2. normalized headers and rows
3. a stable artifact that later stages can reuse for fact extraction, provenance, comparison pages, and thesis validation

## When It Is Written

The artifact is written in `stage2Chunk()` for every committed source / brief page.

- input: raw markdown fetched from `raw_files.markdown_url`
- output table sidecar: `raw_data(page_id, source='tables')`
- write mode: upsert per page, so re-running ingest refreshes the artifact instead of duplicating it

## Stored Shape

Example:

```json
{
  "kind": "markdown_tables",
  "version": 1,
  "extractedAt": "2026-04-28T12:34:56.000Z",
  "tableCount": 2,
  "tables": [
    {
      "table_id": "t1",
      "headers": ["Metric", "FY2026E", "FY2027E"],
      "rows": [
        ["Revenue", "120", "145"],
        ["EBIT", "32", "41"]
      ],
      "row_count": 2,
      "column_count": 3,
      "raw_markdown": "| Metric | FY2026E | FY2027E |\\n|---|---:|---:|\\n| Revenue | 120 | 145 |",
      "row_markdowns": [
        "| Revenue | 120 | 145 |",
        "| EBIT | 32 | 41 |"
      ]
    }
  ]
}
```

## Why This Matters

Without this sidecar, the system only sees:

- raw markdown once during ingest
- agent-written narrative afterwards

That means important table structure can be lost if the agent summarizes it imperfectly.

With `raw_data.source='tables'`, the system can later:

- re-extract facts without re-fetching raw markdown
- trace a fact back to a concrete table and row
- detect period matrices like `Metric | FY26E | FY27E`
- build comparison views across sources
- support future table-aware search and validation

## Current Consumer

Stage 5 fact extraction now prefers `raw_data.source='tables'` over re-parsing markdown from `pages.content`.

That means:

- facts are extracted from the table artifact first when available
- only if the sidecar is missing does Stage 5 fall back to parsing markdown tables from narrative
- extracted facts now carry table provenance in `facts.metadata`

Example provenance:

```json
{
  "extracted_by": "tier_b",
  "source_quote": "| Revenue | 120 | 145 |",
  "table_id": "t1",
  "row_index": 0,
  "column_index": 2,
  "period_header": "FY2027E",
  "metric_header": "Metric",
  "cell_ref": "r0c2",
  "header_path": ["Metric", "FY2027E"]
}
```

`query_facts` also exposes this as a convenience field:

```json
{
  "table_provenance": {
    "table_id": "t1",
    "row_index": 0,
    "column_index": 2,
    "period_header": "FY2027E",
    "metric_header": "Metric",
    "cell_ref": "r0c2",
    "header_path": ["Metric", "FY2027E"]
  }
}
```

`query_facts` also supports `table_only=true`, which is useful when a caller only wants facts with cell-level table provenance.

There is also a dedicated `compare_table_facts` query surface that builds an entity-by-period comparison matrix directly from table-derived facts. This is intended for daily review, PM briefing, and future comparison-page generation.

## Daily Workflow Usage

`compare_table_facts` is now the default comparison surface for:

- `skills/ae-daily-review/SKILL.md`
- `skills/ae-daily-summarize/SKILL.md`

In practice, this means:

- expectation-gap analysis should prefer table-derived comparisons when a source contains a period matrix
- PM trade selection should prefer peer ranking from table facts when multiple names share the same metric
- callers should only fall back to prose summaries when there is no usable table provenance

## Current Scope

Current MVP supports markdown tables only.

It does **not** yet cover:

- image tables
- OCR-heavy malformed tables
- merged-cell spreadsheet semantics
- chart-to-table conversion

Those can be added later without changing the storage contract.
