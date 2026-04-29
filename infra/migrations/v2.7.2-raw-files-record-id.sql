-- =============================================================================
-- v2.7.2 — raw_files 去重键改用 record_id（ResearchReportRecord._id；research_id 不再唯一）
-- =============================================================================
-- Why：ResearchReportRecord._id 才是真唯一；同一 researchId 可对应多份不同文件
--      （上游业务约定）。原先把 research_id 当 partial unique 会导致同 researchId
--      的第 2..N 份文件被 ON CONFLICT DO NOTHING 静默丢弃。
-- How：
--   1) 加 record_id TEXT 列（mongo doc._id 的 hex string）
--   2) drop 旧 uq_raw_files_research_id partial unique
--   3) 建 uq_raw_files_record_id partial unique
--   4) research_id 转为普通索引（仍用于分组查询：某 researchId 下所有文件）
-- 影响：
--   DB 已清空（reset-database.mjs 跑过），无需回填 record_id
--   fetch-reports 必须配套改用 doc._id 去重 + 写入 record_id
-- =============================================================================

BEGIN;

-- 1. 加列
ALTER TABLE raw_files
  ADD COLUMN IF NOT EXISTS record_id TEXT;

-- 2. drop 旧的 research_id partial unique
DROP INDEX IF EXISTS uq_raw_files_research_id;

-- 3. 新的 record_id partial unique
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_files_record_id
  ON raw_files (record_id)
  WHERE deleted = 0 AND record_id IS NOT NULL;

-- 4. research_id 留作分组列，加普通 idx（同 researchId 下查所有文件）
CREATE INDEX IF NOT EXISTS idx_raw_files_research_id
  ON raw_files (research_id)
  WHERE deleted = 0 AND research_id IS NOT NULL;

COMMIT;
