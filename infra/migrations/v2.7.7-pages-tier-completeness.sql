-- =============================================================================
-- v2.7.7 — pages.tier + pages.completeness_score
-- =============================================================================
-- Why：
--   `confidence` 一个字段被两个语义共享——"成本档"（先随便建个 stub）和"质量分"
--   （信息不足）。借鉴 gbrain（src/core/enrichment/completeness.ts）的设计，把这俩
--   解耦成两列：
--     - `tier` (smallint) = "投多少成本到这个 entity"。1=核心（用大模型 enrich），
--       3=tail（用 mini 模型）。默认 3。
--     - `completeness_score` (numeric 0.000-1.000) = "现在写得有多完整"。
--       enrich:save 后由 scorePage() 写入，给 retrigger / search boost / 排序用。
--
--   `confidence` 列保留，但语义收敛为"agent 自评的写作信心"（low / medium / high）。
--
-- Affected：
--   - 加 2 列，给现有行设默认值（tier=3, completeness_score=0）
--   - 加 idx_pages_completeness 索引（retrigger 扫"低分高 backlink 增长"用）
-- =============================================================================

BEGIN;

ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS tier SMALLINT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS completeness_score NUMERIC(4, 3) NOT NULL DEFAULT 0;

-- 给 retrigger 扫"完整度低且 backlink 多"的 page 用
CREATE INDEX IF NOT EXISTS idx_pages_completeness
  ON pages (completeness_score, type)
  WHERE deleted = 0;

COMMIT;
