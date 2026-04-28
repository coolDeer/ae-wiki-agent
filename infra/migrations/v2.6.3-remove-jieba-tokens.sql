BEGIN;

ALTER TABLE pages DROP COLUMN IF EXISTS tokens_zh;

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

UPDATE pages
SET tsv =
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(array_to_string(aliases, ' '), '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(content, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(timeline, '')), 'C')
WHERE deleted = 0;

COMMIT;
