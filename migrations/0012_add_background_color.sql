-- Add background_color column to posts table
ALTER TABLE posts ADD COLUMN background_color TEXT DEFAULT NULL;

-- Index for better performance
CREATE INDEX IF NOT EXISTS idx_posts_background_color ON posts(background_color);
