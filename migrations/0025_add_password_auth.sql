-- Add password auth fields to users
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_updated_at DATETIME;
