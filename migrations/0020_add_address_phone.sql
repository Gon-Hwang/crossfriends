-- Add address and phone fields to users table
ALTER TABLE users ADD COLUMN address TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL;
