-- Rename typing_score to scripture_score and video_score to activity_score
-- Add scripture_score and activity_score columns

-- First, add new columns
ALTER TABLE users ADD COLUMN scripture_score INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN activity_score INTEGER DEFAULT 0;

-- Copy data from old columns if they exist
UPDATE users SET scripture_score = COALESCE(typing_score, 0);
UPDATE users SET activity_score = COALESCE(video_score, 0);
