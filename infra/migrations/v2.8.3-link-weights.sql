UPDATE links
SET
  weight = CASE
    WHEN origin_field IN ('facts_block', 'timeline_block') THEN 1.2
    WHEN link_source = 'frontmatter' AND origin_field = 'primary_entities' THEN 1.0
    WHEN link_type <> 'mention' THEN 1.0
    WHEN link_source = 'manual' THEN 1.0
    WHEN origin_field = 'entity_candidate' THEN 0.7
    WHEN link_source = 'extracted' THEN 0.7
    WHEN link_source = 'frontmatter' THEN 0.6
    WHEN link_source = 'markdown' THEN 0.3
    ELSE 0.5
  END,
  update_by = 'system:migration:link-weights-v2.8.3',
  update_time = NOW()
WHERE deleted = 0;

CREATE INDEX IF NOT EXISTS idx_links_effective_to
  ON links (to_page_id)
  WHERE deleted = 0
    AND (
      weight >= 0.9
      OR link_type <> 'mention'
      OR (link_source = 'frontmatter' AND origin_field = 'primary_entities')
      OR origin_field IN ('facts_block', 'timeline_block')
    );
