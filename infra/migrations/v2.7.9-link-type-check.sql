-- v2.7.9: links.link_type 加 CHECK 约束
--
-- 防止 agent 写错 link_type 污染 typed-edge graph。
-- 白名单与 src/skills/ingest/stage-4-links.ts 的 VALID_LINK_TYPES 保持同步。

BEGIN;

ALTER TABLE links
  ADD CONSTRAINT links_link_type_chk
  CHECK (link_type IN (
    'mention',
    'confirms',
    'contradicts',
    'supersedes',
    'cites',
    'critiques',
    'derives_from',
    'tracks'
  ));

COMMIT;
