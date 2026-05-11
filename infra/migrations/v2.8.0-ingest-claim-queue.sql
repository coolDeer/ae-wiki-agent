BEGIN;

-- v2.8.0 - make raw_files ingest pickup concurrency-safe.
--
-- Code now treats raw_files.triage_decision='processing' as a short lease
-- written by ingest:peek. The pickup query uses UPDATE ... FOR UPDATE SKIP
-- LOCKED, then commit / brief / pass writes the final decision.

DROP INDEX IF EXISTS idx_raw_files_pending;
CREATE INDEX IF NOT EXISTS idx_raw_files_pending
  ON raw_files (create_time ASC, id ASC)
  WHERE deleted = 0
    AND ingested_at IS NULL
    AND skipped_at IS NULL
    AND triage_decision IN ('pending', 'processing');

COMMENT ON COLUMN raw_files.triage_decision IS
  'pending | processing | pass | commit | brief. processing is an ingest:peek lease and may be reclaimed after TTL.';

COMMIT;
