-- =============================================================================
-- v2.8.4 — pages.entity_state
-- =============================================================================
-- Why:
--   `confidence='low'` was doing two jobs:
--     - lifecycle: auto-created empty entity stub still needs first enrich
--     - writing confidence: agent wrote a page but remains uncertain
--
--   Add `entity_state` for lifecycle and leave `confidence` as writing confidence.
--   New flow:
--     - stub: auto-created from strong company wikilink / facts / timeline evidence
--     - candidate_promoted: promoted from entity_candidates, still awaiting enrich
--     - compiled: page has narrative; confidence may still be low / medium / high
-- =============================================================================

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS entity_state TEXT NOT NULL DEFAULT 'compiled';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_pages_entity_state'
  ) THEN
    ALTER TABLE pages
      ADD CONSTRAINT ck_pages_entity_state
      CHECK (entity_state IN ('stub', 'candidate_promoted', 'compiled'));
  END IF;
END $$;

UPDATE pages p
SET
  entity_state = 'stub',
  update_by = 'system:migration:entity-state-v2.8.4',
  update_time = NOW()
WHERE p.deleted = 0
  AND p.type IN ('company', 'industry', 'concept', 'thesis')
  AND p.confidence = 'low'
  AND LENGTH(COALESCE(p.content, '')) <= 300
  AND NOT EXISTS (
    SELECT 1
    FROM events e
    WHERE e.deleted = 0
      AND e.action = 'enrich'
      AND e.entity_type = 'page'
      AND e.entity_id = p.id
  );

UPDATE pages p
SET
  entity_state = 'candidate_promoted',
  update_by = 'system:migration:entity-state-v2.8.4',
  update_time = NOW()
FROM entity_candidates ec
WHERE p.deleted = 0
  AND ec.deleted = 0
  AND ec.status = 'promoted'
  AND ec.promoted_page_id = p.id
  AND p.entity_state = 'stub';

CREATE INDEX IF NOT EXISTS idx_pages_entity_state
  ON pages (entity_state, type, update_time DESC)
  WHERE deleted = 0;
