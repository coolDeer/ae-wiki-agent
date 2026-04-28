BEGIN;

ALTER TABLE raw_files
  ADD COLUMN IF NOT EXISTS triage_decision TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE raw_files
  ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ;

ALTER TABLE raw_files
  ADD COLUMN IF NOT EXISTS skip_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_files_triage_decision
  ON raw_files (triage_decision);

CREATE INDEX IF NOT EXISTS idx_raw_files_skipped
  ON raw_files (skipped_at) WHERE skipped_at IS NOT NULL;

COMMIT;
