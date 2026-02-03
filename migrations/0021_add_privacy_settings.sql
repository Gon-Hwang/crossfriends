-- Add privacy settings column to users table
ALTER TABLE users ADD COLUMN privacy_settings TEXT DEFAULT '{}';
