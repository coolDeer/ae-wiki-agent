-- =============================================================================
-- v2.2.0 — aliases 列加入 pages.tsv 全文索引
-- =============================================================================
-- Why：搜 "腾讯" 应当命中 aliases=['腾讯','Tencent','700.HK'] 的 pages/companies/Tencent。
--      之前 tsv 只覆盖 title/content/timeline，aliases 列形同虚设。
-- How：替换 update_pages_tsv() 函数 + 触发现有行重算 tsv。
-- 影响：现有行 tsv 会被重写一次。BEFORE INSERT/UPDATE trigger 同步执行，
--      不需要手动 REINDEX（GIN 索引会自动跟着 tsv 变化更新）。
-- =============================================================================

BEGIN;

-- 1. 替换 trigger 函数
CREATE OR REPLACE FUNCTION update_pages_tsv() RETURNS trigger AS $$
BEGIN
  NEW.tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.aliases, ' '), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.content, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.timeline, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. 触发现有行重算 tsv（不改任何业务字段；trigger 跑就重写 tsv）
--    注：update_time 由应用层维护，此 UPDATE 不会无意中改 update_time（只是 SET title=title 不会触发应用层）。
--    但 BEFORE UPDATE trigger 会跑，新值的 NEW 在 trigger 里被加工，最终 tsv 写入新值。
UPDATE pages SET title = title WHERE deleted = 0;

COMMIT;
