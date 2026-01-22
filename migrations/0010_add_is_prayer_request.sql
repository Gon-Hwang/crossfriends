-- Add is_prayer_request to posts table
ALTER TABLE posts ADD COLUMN is_prayer_request BOOLEAN DEFAULT 0;
