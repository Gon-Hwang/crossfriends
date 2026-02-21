-- Fix FOREIGN KEY constraints for notifications table
-- SQLite doesn't support ALTER TABLE ... MODIFY FOREIGN KEY, so we need to recreate the table

-- 1. Create new table with CASCADE
CREATE TABLE IF NOT EXISTS notifications_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  from_user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  post_id INTEGER,
  comment_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- 2. Copy data from old table
INSERT INTO notifications_new SELECT * FROM notifications;

-- 3. Drop old table
DROP TABLE notifications;

-- 4. Rename new table
ALTER TABLE notifications_new RENAME TO notifications;

-- 5. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
