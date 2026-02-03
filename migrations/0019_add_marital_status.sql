-- Add marital_status column to users table
-- Values: 'single' (미혼), 'married' (기혼), 'other' (기타)
ALTER TABLE users ADD COLUMN marital_status TEXT CHECK(marital_status IN ('single', 'married', 'other'));
