BEGIN;

-- 1. links provenance uniqueness: allow separate rows for facts_block vs timeline_block
DROP INDEX IF EXISTS uq_links;
CREATE UNIQUE INDEX IF NOT EXISTS uq_links
  ON links (from_page_id, to_page_id, link_type, link_source, origin_page_id, origin_field)
  NULLS NOT DISTINCT
  WHERE deleted = 0;

-- 2. signals idempotency for thesis-source derived signals
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY signal_type, entity_page_id, thesis_page_id, source_page_id
      ORDER BY detected_at DESC, id DESC
    ) AS rn
  FROM signals
  WHERE deleted = 0
    AND entity_page_id IS NOT NULL
    AND thesis_page_id IS NOT NULL
    AND source_page_id IS NOT NULL
)
UPDATE signals s
SET deleted = 1,
    update_time = NOW(),
    update_by = 'system:migration-v2.7.11'
FROM ranked r
WHERE s.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_thesis_source_type
  ON signals (signal_type, entity_page_id, thesis_page_id, source_page_id)
  WHERE deleted = 0
    AND entity_page_id IS NOT NULL
    AND thesis_page_id IS NOT NULL
    AND source_page_id IS NOT NULL;

COMMIT;
