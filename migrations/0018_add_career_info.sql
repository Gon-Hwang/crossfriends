-- Add career/job information fields
ALTER TABLE users ADD COLUMN careers TEXT; -- JSON array of career entries: {company: string, position: string, period: string}
