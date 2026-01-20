-- Add shared_post_id column to posts table for quote/share functionality
ALTER TABLE posts ADD COLUMN shared_post_id INTEGER;

-- Add foreign key constraint (SQLite doesn't enforce this in ALTER, but we document it)
-- FOREIGN KEY (shared_post_id) REFERENCES posts(id) ON DELETE SET NULL

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_posts_shared_post_id ON posts(shared_post_id);
