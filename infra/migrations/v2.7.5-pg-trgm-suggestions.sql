-- =============================================================================
-- v2.7.5 — pg_trgm + GIN index for "did-you-mean" search suggestions
-- =============================================================================
-- Why：当前 search 命中 0 时直接返回 "no hits"，user 拼错 ticker / slug 不知道是
--      没数据还是写错了。pg_trgm 是 PostgreSQL 内置 extension，能用 trigram 相似度
--      给出接近的候选（如搜 "Lumetum" 提示 "Lumentum"）。
-- How：
--   1) CREATE EXTENSION IF NOT EXISTS pg_trgm
--   2) GIN trigram 索引 on pages.title — 给 viewSearch 兜底找近似 title
--   3) GIN trigram 索引 on pages.slug — 兜底找近似 slug（user 直接搜 ticker/slug）
-- 影响：
--   - 索引体积适中（pages 表数据量小）；查询用 `column % 'query'` 走索引
--   - 不影响主搜索通路（hybrid keyword + vector），只在 0 命中时启用
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_pages_title_trgm
  ON pages USING GIN (title gin_trgm_ops)
  WHERE deleted = 0;

CREATE INDEX IF NOT EXISTS idx_pages_slug_trgm
  ON pages USING GIN (slug gin_trgm_ops)
  WHERE deleted = 0;

COMMIT;
