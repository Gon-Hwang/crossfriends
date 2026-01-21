-- Add typing_score, video_score, and completed_videos to users table
ALTER TABLE users ADD COLUMN typing_score INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN video_score INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN completed_videos TEXT DEFAULT '[]';
