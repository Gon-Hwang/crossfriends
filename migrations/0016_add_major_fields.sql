-- Add major fields for university, masters, and PhD
ALTER TABLE users ADD COLUMN university_major TEXT;
ALTER TABLE users ADD COLUMN masters_major TEXT;
ALTER TABLE users ADD COLUMN phd_major TEXT;
