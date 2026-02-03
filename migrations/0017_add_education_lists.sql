-- Add education list fields (stores JSON array of education entries)
-- Each entry: {school: string, major: string}
ALTER TABLE users ADD COLUMN universities TEXT; -- JSON array
ALTER TABLE users ADD COLUMN masters_degrees TEXT; -- JSON array
ALTER TABLE users ADD COLUMN phd_degrees TEXT; -- JSON array
