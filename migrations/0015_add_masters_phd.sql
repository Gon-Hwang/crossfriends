-- Add masters and PhD fields to users table
ALTER TABLE users ADD COLUMN masters TEXT;
ALTER TABLE users ADD COLUMN phd TEXT;
