-- Per-user QT diary: 적용 / 마침기도 영구 저장 (날짜별 1행)
CREATE TABLE IF NOT EXISTS qt_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  qt_date TEXT NOT NULL,
  apply_text TEXT,
  closing_prayer_text TEXT,
  verse_reference_raw TEXT,
  apply_post_id INTEGER,
  closing_post_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, qt_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qt_logs_user_qt_date ON qt_logs(user_id, qt_date DESC);
