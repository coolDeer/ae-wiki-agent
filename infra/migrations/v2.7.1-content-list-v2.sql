-- =============================================================================
-- v2.7.1 — content_list_v2 接入：V2 block-aware chunker
-- =============================================================================
-- Why：mineru 现在产出结构化 V2 block JSON（外层数组 = 物理 page；内层 block 含
--      title/paragraph/list/table/page_header/page_footer/page_number 等类型），
--      比 markdown 多出 section 边界、表格 caption、page_idx 与噪声标注，
--      给 chunker 用能显著提升召回质量。
-- How：
--   1) raw_files 加 parsed_content_list_v2_url（镜像 mongo doc.parsedContentListV2S3）
--      回填老行：从 mongo_doc->>'parsedContentListV2S3' 取
--   2) content_chunks 加 section_path TEXT[]（V2 chunker 输出；markdown 路径留 NULL）
-- 影响：
--   - 老 raw_files 行：parsed_content_list_v2_url 大概率仍是 NULL（V2 字段是后加的）；
--     fetch-reports 后续抓的新行才会有值
--   - 老 content_chunks 行：section_path 全 NULL，chunker 走 markdown 回退路径不受影响
-- =============================================================================

BEGIN;

-- 1. raw_files: V2 content list URL
ALTER TABLE raw_files
  ADD COLUMN IF NOT EXISTS parsed_content_list_v2_url TEXT;

-- 回填：mongo_doc 里若已含 parsedContentListV2S3 则同步过来
UPDATE raw_files
SET
  parsed_content_list_v2_url = mongo_doc->>'parsedContentListV2S3',
  update_by = 'system:migration-v2.7.1',
  update_time = NOW()
WHERE parsed_content_list_v2_url IS NULL
  AND mongo_doc IS NOT NULL
  AND mongo_doc->>'parsedContentListV2S3' IS NOT NULL;

-- 2. content_chunks: section_path
ALTER TABLE content_chunks
  ADD COLUMN IF NOT EXISTS section_path TEXT[];

COMMIT;
