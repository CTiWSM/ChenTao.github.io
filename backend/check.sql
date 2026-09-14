-- Read-only verification. A fresh database must return total = 0.
SELECT site, total FROM like_totals WHERE site = 'chentao-homepage';

-- Run manually when checking integrity; this is not run for each website visit.
SELECT
  site,
  total,
  (SELECT COUNT(*) FROM likes WHERE site = 'chentao-homepage') AS stored_likes,
  total = (SELECT COUNT(*) FROM likes WHERE site = 'chentao-homepage') AS totals_match
FROM like_totals
WHERE site = 'chentao-homepage';

SELECT name, type
FROM sqlite_schema
WHERE name IN ('likes', 'like_totals', 'likes_increment_total', 'likes_decrement_total')
ORDER BY type, name;
