-- 채널 전체 영상 목록 캐시
CREATE TABLE IF NOT EXISTS sermon_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  published_at TEXT,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 날짜별 오늘의 설교 배정 (중복 방지)
CREATE TABLE IF NOT EXISTS sermon_daily (
  sermon_date TEXT PRIMARY KEY,
  video_id TEXT NOT NULL
);
