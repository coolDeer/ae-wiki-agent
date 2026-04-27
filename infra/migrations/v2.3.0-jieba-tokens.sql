-- =============================================================================
-- v2.3.0 — 中文分词 via 应用层 jieba
-- =============================================================================
-- Why：PG 内置 'simple' 切词器不懂中文，把"半导体"按字切。中文 wiki 召回打折。
-- How：应用层用 @node-rs/jieba 切词后存到 pages.tokens_zh，trigger 用它替代
--      content 喂 tsvector。
-- 影响：
--   - 旧行 tokens_zh = NULL，trigger COALESCE 兜底回 content（向下兼容）
--   - 应用层后续 update 时填 tokens_zh，trigger 自动用新值重算 tsv
-- =============================================================================

BEGIN;

-- 1. 加列
ALTER TABLE pages ADD COLUMN IF NOT EXISTS tokens_zh TEXT;

-- 2. 替换 trigger：tokens_zh 不为空时优先用，否则兜底 content
CREATE OR REPLACE FUNCTION update_pages_tsv() RETURNS trigger AS $$
BEGIN
  NEW.tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.aliases, ' '), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.tokens_zh, NEW.content, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.timeline, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 注：这里不主动 UPDATE 全表重算 tsv，因为 tokens_zh 还是 NULL，
--      trigger 会兜底回 content，行为和此前一致。
--      backfill tokens_zh 由应用层另跑（避免在 SQL 里调 jieba）。

COMMIT;
