-- =============================================================================
-- v2.7.6 — Deprecate `person` page type
-- =============================================================================
-- Why：
--   pages.type='person' 在实际投资研究中边际价值低 —— 现有 5 个 person 页全是
--   AI/科技公司高管（Sam Altman / Dario Amodei / Sarah Friar / Fidji Simo /
--   Elon Musk），均是 confidence='low' 红链状态，从未被 enrich 过。
--   这些人物的核心信息（"是 OpenAI 的 CEO"、引言）天然属于:
--     - 所属公司页（companies/X.frontmatter.management 或正文）
--     - source 页的 ## Notable Quotes 段
--   独立投资人（Buffett 类）真要做的话用 concepts/ 也够。
--
--   决定：完全去掉 person type，避免 agent 写 [[persons/X]] 红链时再产生
--   低密度 stub。
--
-- Affected：
--   - 5 个 person 页（slug 'persons/...'）软删
--   - 指向它们的 inbound links 软删
--   - pages.type 是 TEXT 不是 PG enum，不需要 ALTER TYPE
--   - 应用层（Drizzle PageType union / Stage 4 / Stage 5 / lint / web / MCP）
--     已同步移除 'person' / 'persons' 引用
--
-- Replayable：本迁移幂等。
-- =============================================================================

BEGIN;

-- 1) 软删所有 person 页（如果还有的话）
UPDATE pages
   SET deleted = 1,
       update_by = 'system:v2.7.6',
       update_time = NOW()
 WHERE deleted = 0
   AND type = 'person';

-- 2) 软删指向 person 页的所有 link（不论 link 是否已经 deleted）
UPDATE links
   SET deleted = 1,
       update_by = 'system:v2.7.6',
       update_time = NOW()
 WHERE deleted = 0
   AND to_page_id IN (
     SELECT id FROM pages WHERE type = 'person'
   );

-- 3) 软删 person 页的出站 link（content 通常是空，但稳妥）
UPDATE links
   SET deleted = 1,
       update_by = 'system:v2.7.6',
       update_time = NOW()
 WHERE deleted = 0
   AND from_page_id IN (
     SELECT id FROM pages WHERE type = 'person'
   );

-- 4) 写一条审计 event
INSERT INTO events (actor, action, entity_type, payload, create_by, update_by)
SELECT 'system:v2.7.6',
       'schema_migration',
       'pages',
       jsonb_build_object(
         'migration', 'v2.7.6-deprecate-person-type',
         'deleted_person_pages',
         (SELECT COUNT(*) FROM pages WHERE type = 'person' AND deleted = 1)
       ),
       'system:v2.7.6',
       'system:v2.7.6';

COMMIT;
