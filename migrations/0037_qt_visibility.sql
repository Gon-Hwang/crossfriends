-- QT 로그 공개 범위 설정: public(전체 공개) / friends(친구에게만) / private(비공개)
ALTER TABLE qt_logs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
