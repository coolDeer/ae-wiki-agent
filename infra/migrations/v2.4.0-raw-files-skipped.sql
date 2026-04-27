-- =============================================================================
-- v2.4.0 — raw_files 显式 skip 标记
-- =============================================================================
-- Why：triage 流程需要区分"主动跳过的 raw（不入 wiki，但保留可见）"和
--      "软删的 raw（数据出错/误入库）"。之前用 deleted=1 标 skip 把两种
--      语义糅在一起，无法审计 / 复审被跳过的 raw。
-- How：加 skipped_at + skip_reason 两列；pickPending 改为同时过滤这两个；
--      ingest:skip 命令改为标 skipped_at（不再软删 raw_file）。
-- 影响：
--   - 旧行 skipped_at=NULL，行为不变
--   - backfill：已通过 events.ingest_skip 跳过的 raw_files
--     （deleted=1）反向修复成 deleted=0 + skipped_at=NOW + skip_reason
-- =============================================================================

BEGIN;

-- 1. 加列
ALTER TABLE raw_files ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ;
ALTER TABLE raw_files ADD COLUMN IF NOT EXISTS skip_reason TEXT;

-- 2. 加索引（审计查询：列出所有被跳过的 raw）
CREATE INDEX IF NOT EXISTS idx_raw_files_skipped
  ON raw_files (skipped_at DESC) WHERE skipped_at IS NOT NULL;

-- 3. backfill：把已通过 ingest:skip 命令"软删"的 raw_files 修复
--    条件：events 表存在 action='ingest_skip' 且 payload->>rawFileId 指向本行
UPDATE raw_files rf
SET
  deleted = 0,
  skipped_at = e.ts,
  skip_reason = e.payload->>'reason',
  update_by = 'system:migration-v2.4.0',
  update_time = NOW()
FROM events e
WHERE e.action = 'ingest_skip'
  AND (e.payload->>'rawFileId')::bigint = rf.id
  AND rf.deleted = 1
  AND rf.skipped_at IS NULL;

COMMIT;
