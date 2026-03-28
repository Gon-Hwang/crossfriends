-- 피드백 알림 클릭 시 해당 friend_messages 행으로 스크롤
ALTER TABLE notifications ADD COLUMN friend_message_id INTEGER;
