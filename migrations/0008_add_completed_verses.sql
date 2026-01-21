-- Add completed_verses column to users table
ALTER TABLE users ADD COLUMN completed_verses TEXT DEFAULT '[]';
