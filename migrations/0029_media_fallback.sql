-- R2 미바인딩·로컬 Vite 등에서 프로필/커버 이미지를 D1 BLOB으로 임시 저장
CREATE TABLE IF NOT EXISTS media_fallback (
  storage_key TEXT PRIMARY KEY NOT NULL,
  blob_data BLOB NOT NULL,
  content_type TEXT NOT NULL
);
