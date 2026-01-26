-- Add completed_videos column for tracking video completion
ALTER TABLE users ADD COLUMN completed_videos TEXT DEFAULT '[]';
