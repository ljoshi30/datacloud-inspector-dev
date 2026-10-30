-- Data 360 Inspector — usage ping storage (Cloudflare D1 / SQLite)
-- Apply:  wrangler d1 execute d360_usage --file=./schema.sql --remote
--
-- TWO tables so PUBLIC and DEV usage are seen separately (user request). The worker routes each
-- ping by its `build` tag → pings_public or pings_dev. Each stores ONLY the anonymous packet
-- (+ server receive time): no IP, no names, no org, no URL, no record ids (see worker.js).
CREATE TABLE IF NOT EXISTS pings_public (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  iid   TEXT NOT NULL,   -- random per-browser install id (anonymous)
  v     TEXT,            -- tool version (coarse)
  page  TEXT,            -- coarse page bucket: DMO / Segment / IdentityResolution / … / other
  day   TEXT NOT NULL,   -- YYYY-MM-DD (the usage day, from the client)
  ts    TEXT             -- server receive timestamp (ISO)
);
CREATE TABLE IF NOT EXISTS pings_dev (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  iid   TEXT NOT NULL,
  v     TEXT,
  page  TEXT,
  day   TEXT NOT NULL,
  ts    TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_day  ON pings_public (day);
CREATE INDEX IF NOT EXISTS idx_public_page ON pings_public (page);
CREATE INDEX IF NOT EXISTS idx_public_iid  ON pings_public (iid);
CREATE INDEX IF NOT EXISTS idx_dev_day  ON pings_dev (day);
CREATE INDEX IF NOT EXISTS idx_dev_page ON pings_dev (page);
CREATE INDEX IF NOT EXISTS idx_dev_iid  ON pings_dev (iid);

-- OPTIONAL retention housekeeping (run manually or via a scheduled Worker):
--   DELETE FROM pings_public WHERE day < date('now','-365 day');
--   DELETE FROM pings_dev    WHERE day < date('now','-365 day');
