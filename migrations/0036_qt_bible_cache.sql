CREATE TABLE IF NOT EXISTS qt_bible_cache (
  qt_date      TEXT PRIMARY KEY,  -- YYYY-MM-DD
  passage_ref  TEXT NOT NULL DEFAULT '',
  passage_title TEXT NOT NULL DEFAULT '',
  reference    TEXT NOT NULL DEFAULT '',
  scripture    TEXT NOT NULL DEFAULT '',
  cached_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
