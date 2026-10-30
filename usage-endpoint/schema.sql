-- Data 360 Inspector — usage ping storage (Cloudflare D1 / SQLite)
-- Apply:  wrangler d1 execute d360_usage --file=./schema.sql --remote
--
-- ONE table. Stores ONLY the anonymous packet the tool sends (+ server receive time).
-- No IP, no names, no org, no URL, no record ids — see worker.js ingest sanitization.
CREATE TABLE IF NOT EXISTS pings (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  iid   TEXT NOT NULL,   -- random per-browser install id (anonymous)
  v     TEXT,            -- tool version (coarse)
  page  TEXT,            -- coarse page bucket: DMO / Segment / IdentityResolution / … / other
  day   TEXT NOT NULL,   -- YYYY-MM-DD (the usage day, from the client)
  ts    TEXT             -- server receive timestamp (ISO)
);

-- indexes for the report queries (distinct-user counts, by day, by page)
CREATE INDEX IF NOT EXISTS idx_pings_day  ON pings (day);
CREATE INDEX IF NOT EXISTS idx_pings_page ON pings (page);
CREATE INDEX IF NOT EXISTS idx_pings_iid  ON pings (iid);

-- OPTIONAL data-retention housekeeping (run manually or via a scheduled Worker):
--   DELETE FROM pings WHERE day < date('now','-365 day');
