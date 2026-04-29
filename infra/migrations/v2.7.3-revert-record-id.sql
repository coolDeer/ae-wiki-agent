-- =============================================================================
-- v2.7.3 — 回退 v2.7.2：上游已修复 researchId 重复问题（重复的会加 -n 后缀），
-- 重新把 raw_files.research_id 作为唯一去重键，drop record_id 列。
-- =============================================================================
-- Why：上游 ResearchReportRecord 现在保证 researchId 唯一（重复研究项加 -n 区分），
--      不再需要走 mongo._id 这条迂回路线。
-- How：
--   1) drop record_id 唯一索引
--   2) drop research_id 普通索引（之前作为分组列）
--   3) drop record_id 列
--   4) 恢复 uq_raw_files_research_id partial unique
-- 影响：
--   DB 已清空（没有真实数据），DDL 反向变化无副作用
-- =============================================================================

BEGIN;

-- 1. drop 新 unique（record_id）
DROP INDEX IF EXISTS uq_raw_files_record_id;

-- 2. drop research_id 普通分组索引（恢复成 unique 之前清掉同名/同列的散索引）
DROP INDEX IF EXISTS idx_raw_files_research_id;

-- 3. drop record_id 列
ALTER TABLE raw_files DROP COLUMN IF EXISTS record_id;

-- 4. 恢复 research_id partial unique
CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_files_research_id
  ON raw_files (research_id)
  WHERE deleted = 0 AND research_id IS NOT NULL;

COMMIT;
