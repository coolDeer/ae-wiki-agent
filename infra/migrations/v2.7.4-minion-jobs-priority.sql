-- =============================================================================
-- v2.7.4 — minion_jobs.priority + worker pick order
-- =============================================================================
-- Why：worker 当前只 ORDER BY create_time，导致 embed_chunks 跟 enrich_entity /
--      agent_run 排同一队列；ingest 完一份 source 后通常先涌入 11+ enrich agent_run
--      job，让 embed_chunks 等很久。后果：enrich agent 调 search 时 source 的
--      chunks 还没 embedding，cosine re-score 拿不到向量召回打折严重。
--      （hybrid.ts 已配套加 cos=0.5 中性兜底；priority 是吞吐侧的另一半。）
-- How：
--   1) 加 priority INTEGER NOT NULL DEFAULT 50（数字越大越优先）
--   2) 老行回填 50（默认）；embed_chunks 类型回填 80
--   3) 加复合索引支持 ORDER BY priority DESC, create_time ASC
--   4) worker query 改用 priority + create_time（在代码里改）
-- 约定：
--    100 — 系统级关键路径（暂未用）
--    80  — embed_chunks（agent 搜索依赖）
--    50  — 默认（enrich_entity / detect_signals / agent_run / lint_run / facts_expire）
--    20  — 后台 backfill / 大批量任务（暂未用）
-- =============================================================================

BEGIN;

ALTER TABLE minion_jobs
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 50;

-- 已有的 embed_chunks job 也调到 80（这次 ingest 还有 1 个 waiting）
UPDATE minion_jobs
SET priority = 80,
    update_by = 'system:migration-v2.7.4',
    update_time = NOW()
WHERE name = 'embed_chunks' AND priority = 50;

-- worker pick 索引：status='waiting' 的子集，按 priority DESC, create_time ASC
CREATE INDEX IF NOT EXISTS idx_jobs_pick
  ON minion_jobs (priority DESC, create_time ASC)
  WHERE deleted = 0 AND status = 'waiting';

COMMIT;
