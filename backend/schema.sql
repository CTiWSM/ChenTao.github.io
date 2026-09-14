-- D1 initialization. Safe to run again: no existing likes are deleted or reset.
-- The sole initial total is zero. This file does not insert example likes.

CREATE TABLE IF NOT EXISTS like_totals (
  site TEXT PRIMARY KEY NOT NULL CHECK (site = 'chentao-homepage'),
  total INTEGER NOT NULL DEFAULT 0 CHECK (typeof(total) = 'integer' AND total >= 0)
);

INSERT INTO like_totals (site, total)
VALUES ('chentao-homepage', 0)
ON CONFLICT(site) DO NOTHING;

CREATE TABLE IF NOT EXISTS likes (
  site TEXT NOT NULL CHECK (site = 'chentao-homepage'),
  visitor_hash TEXT NOT NULL CHECK (
    length(visitor_hash) = 64 AND visitor_hash NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (site, visitor_hash),
  FOREIGN KEY (site) REFERENCES like_totals(site)
);

CREATE TRIGGER IF NOT EXISTS likes_increment_total
AFTER INSERT ON likes
BEGIN
  UPDATE like_totals SET total = total + 1 WHERE site = NEW.site;
END;

CREATE TRIGGER IF NOT EXISTS likes_decrement_total
AFTER DELETE ON likes
BEGIN
  UPDATE like_totals SET total = total - 1 WHERE site = OLD.site;
END;
