# Data 360 Inspector — Usage Endpoint (Cloudflare Worker + D1)

The production receiver that answers your questions:
- **Where is the data stored?** → Cloudflare **D1** (a small SQLite database) in *your* Cloudflare account.
- **How is it pulled off?** → a password-protected **`/report`** page + **`/report.csv`** download.
- **How do I share impact?** → open `/report?token=…` for live numbers, or hand out the CSV.

Nothing here touches Salesforce. It only receives the anonymous `{ iid, v, page, day }` packet.

## Files
- `worker.js`      — the Worker (POST /ping, GET /report, GET /report.csv, GET /health)
- `schema.sql`     — the one D1 table + indexes
- `wrangler.toml`  — Cloudflare config (paste your database_id)

## Deploy (one time, ~10 min)
```bash
npm i -g wrangler
wrangler login

# 1. create the database, copy the printed database_id into wrangler.toml
wrangler d1 create d360_usage

# 2. create the table
wrangler d1 execute d360_usage --file=./schema.sql --remote

# 3. set the report password (any strong string)
wrangler secret put REPORT_TOKEN

# 4. ship it
wrangler deploy
```
Wrangler prints a URL like `https://d360-usage.<you>.workers.dev`.

## Wire the tool to it (still gated — see below)
In `console-decorate.extension.js`, module `dcUsagePingModule`:
- set `PING_ENDPOINT = "https://d360-usage.<you>.workers.dev/ping"`
- set `PING_ENABLED = true`
- set `PING_VERSION` to the build version
Then rebuild. **Do this only after** privacy/security sign-off + a Salesforce-CSP test (the ping is
inside a corporate SF session). Until then leave the gates as shipped (empty + false) → it sends nothing.

## See the numbers
- Dashboard: `https://d360-usage.<you>.workers.dev/report?token=YOUR_REPORT_TOKEN`
  → Active users (unique), Weekly/Monthly active, total pings, by-page, daily-active trend.
- CSV: `.../report.csv?token=YOUR_REPORT_TOKEN` → drop into Excel / a slide.

## What's stored (and what is NOT)
Stored: `iid` (random browser id), `v` (version), `page` (coarse bucket like `DMO`/`Segment`), `day`,
server timestamp. **Not stored:** IP (the Worker never reads it), names, org, hostname, URLs, record ids,
field values — anything identifying. `page` is whitelisted to a fixed vocabulary server-side, so even a
malformed ping can't store free-form content.

## Users are told
The install page discloses anonymous usage counting, and when the ping is live the tool shows a one-time
notice with a **Turn off** (opt-out) link. Opt-out is honored as a hard gate (`__dcUsageOptOut()`), so an
opted-out browser never pings even when fully enabled.

## Housekeeping
Retention is yours to set — e.g. periodically run
`DELETE FROM pings WHERE day < date('now','-365 day');` (see the note in `schema.sql`).
