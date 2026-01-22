-- Create prayer_clicks table (similar to likes table)
CREATE TABLE IF NOT EXISTS prayer_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, user_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_prayer_clicks_post_id ON prayer_clicks(post_id);
CREATE INDEX IF NOT EXISTS idx_prayer_clicks_user_id ON prayer_clicks(user_id);
