-- =============================================================================
-- v2.1.0 — 把"硬"UNIQUE 约束改成 partial UNIQUE INDEX（软删除友好）
-- =============================================================================
-- Why：现有 UNIQUE 约束在 deleted=1 后仍占用 key，无法重建同 key 的新行。
-- How：DROP 旧约束 + CREATE partial unique index WHERE deleted=0。
--
-- 应用层影响：
--   - ON CONFLICT (column_list) DO NOTHING — 仍工作（partial 索引也算 conflict target）
--   - ON CONFLICT ON CONSTRAINT <name>     — 已确认未使用
--
-- 整个迁移在一个事务内；失败回滚。
-- =============================================================================

BEGIN;

-- 1. DROP 旧 UNIQUE 约束
ALTER TABLE sources         DROP CONSTRAINT IF EXISTS sources_name_key;
ALTER TABLE pages           DROP CONSTRAINT IF EXISTS pages_source_slug_key;
ALTER TABLE content_chunks  DROP CONSTRAINT IF EXISTS content_chunks_page_id_chunk_index_key;
ALTER TABLE links           DROP CONSTRAINT IF EXISTS links_unique;
ALTER TABLE tags            DROP CONSTRAINT IF EXISTS tags_page_id_tag_key;
ALTER TABLE raw_files       DROP CONSTRAINT IF EXISTS raw_files_raw_path_key;
ALTER TABLE raw_files       DROP CONSTRAINT IF EXISTS raw_files_research_id_key;
ALTER TABLE raw_data        DROP CONSTRAINT IF EXISTS raw_data_page_id_source_key;

-- 2. timeline_entries.idx_timeline_dedup：要从 NULLS DISTINCT 改成 NULLS NOT DISTINCT
DROP INDEX IF EXISTS idx_timeline_dedup;

-- 3. CREATE partial UNIQUE indexes（与 init-v2.sql 完全一致）
CREATE UNIQUE INDEX IF NOT EXISTS uq_sources_name
  ON sources (name) WHERE deleted = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pages_source_slug
  ON pages (source_id, slug) WHERE deleted = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chunks_page_index
  ON content_chunks (page_id, chunk_index) WHERE deleted = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_links
  ON links (from_page_id, to_page_id, link_type, link_source, origin_page_id)
  NULLS NOT DISTINCT
  WHERE deleted = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_page_tag
  ON tags (page_id, tag) WHERE deleted = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_files_path
  ON raw_files (raw_path) WHERE deleted = 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_files_research_id
  ON raw_files (research_id) WHERE deleted = 0 AND research_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_raw_data_page_source
  ON raw_data (page_id, source) WHERE deleted = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_dedup
  ON timeline_entries (entity_page_id, event_date, summary)
  NULLS NOT DISTINCT
  WHERE deleted = 0;

COMMIT;
