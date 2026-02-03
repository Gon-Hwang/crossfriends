-- Add school information fields to users table
ALTER TABLE users ADD COLUMN elementary_school TEXT;
ALTER TABLE users ADD COLUMN middle_school TEXT;
ALTER TABLE users ADD COLUMN high_school TEXT;
ALTER TABLE users ADD COLUMN university TEXT;
