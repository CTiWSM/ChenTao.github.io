-- Adds a citation cache only. Existing likes tables and rows are untouched.
CREATE TABLE IF NOT EXISTS scholar_citation_snapshots (
  profile_id TEXT PRIMARY KEY NOT NULL CHECK (profile_id = 'krmeL-4AAAAJ'),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  updated_at TEXT NOT NULL
);
