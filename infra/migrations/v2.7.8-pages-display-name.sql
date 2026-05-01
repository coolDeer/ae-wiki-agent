-- =============================================================================
-- v2.7.8 — pages.display_name (UI 显示名，跟 slug / title 解耦)
-- =============================================================================
-- Why：
--   slug 已经按 kebab-case lowercase 规范（v2.7.6+），但人类阅读时还是想看
--   品牌原写法（"CATL" 不是 "catl"，"宁德时代" 不是 "ningde-shidai"）。
--   `title` 列对 source / brief 类是上游原始标题（含日期前缀 / 中英混杂），
--   不适合做 UI 显示名。
--
--   引入 `display_name`：
--     - entity 类（company/industry/concept/thesis）：enrich:save 时设置成
--       品牌原写法。Web UI 的 pageLink 渲染优先用 display_name。
--     - source / brief：通常等于 title，但 agent 也可以清洗成 short form。
--     - null = 回退到 title。
--
-- Affected：仅加一列 + 索引，老行 display_name=NULL（前端自动 fallback）
-- =============================================================================

BEGIN;

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- 模糊搜索 + 显示用，建 trgm 索引（pg_trgm 已在 v2.7.5 启用）
CREATE INDEX IF NOT EXISTS idx_pages_display_name_trgm
  ON pages USING GIN (display_name gin_trgm_ops)
  WHERE deleted = 0 AND display_name IS NOT NULL;

COMMIT;
