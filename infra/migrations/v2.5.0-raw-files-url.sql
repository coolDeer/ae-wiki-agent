-- =============================================================================
-- v2.5.0 — raw_files 改为 URL 模式（不再落本地文件）
-- =============================================================================
-- Why：fetch-reports 之前要 HTTP 拉 markdown + 写本地 raw/，慢且占盘。
--      改为只登记元数据 + S3 URL，ingest 阶段按需 fetch。
-- How：
--   1) 加 markdown_url
--   2) 从 mongo_doc->>'parsedMarkdownS3' 回填老行
--   3) 干掉 raw_path（连同 uq_raw_files_path 索引）
-- 影响：
--   - 老行回填后 markdown_url 必有值（mongo_doc 一直保留 parsedMarkdownS3）
--   - 应用层（fetch-reports / ingest）必须配套切到 markdownUrl
-- =============================================================================

BEGIN;

-- 1. 加列
ALTER TABLE raw_files ADD COLUMN IF NOT EXISTS markdown_url TEXT;

-- 2. 回填老行
UPDATE raw_files
SET
  markdown_url = mongo_doc->>'parsedMarkdownS3',
  update_by = 'system:migration-v2.5.0',
  update_time = NOW()
WHERE markdown_url IS NULL
  AND mongo_doc IS NOT NULL
  AND mongo_doc->>'parsedMarkdownS3' IS NOT NULL;

-- 3. 删 partial unique 索引（raw_path 即将下线）
DROP INDEX IF EXISTS uq_raw_files_path;

-- 4. DROP COLUMN raw_path
ALTER TABLE raw_files DROP COLUMN IF EXISTS raw_path;

COMMIT;
