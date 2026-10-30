# Usage-Ping Sandbox (local test only)

Lets you **see the active-user tracking work** on your own machine, without touching
Salesforce and without enabling anything in the real build.

## What it proves
- The ping fires only when the gates are ON (the shipped build has them OFF → no-op).
- It counts **unique users** (returning users included) — the thing Cloudflare can't see.
- The packet is anonymous: only `{ iid, v, page, day }` — no org, host, record, URL, or PII.
- Once-per-day throttle per browser.

## How to run
1. In a terminal:
   ```
   node usage-ping-sandbox/receiver.js
   ```
   (a tiny local stand-in for the real endpoint, on http://localhost:8787)
2. Open `usage-ping-sandbox/test.html` in your browser.
3. Click the page buttons to simulate the tool running on DMO / Segment / IR pages.
   Watch **ACTIVE USERS (unique)** go up in section 4.
4. Try the behavior buttons:
   - **Ping again today** → throttled (once/day).
   - **Returning tomorrow** → same user, new daily-active day (unique count stays).
   - **New user** → fresh install id → unique active-user count goes up.

## This is NOT production
- `receiver.js` is an in-memory local tally — a real endpoint (Cloudflare Worker) would persist it.
- The real tool ships with the ping **disabled** (`PING_ENDPOINT=""`, `PING_ENABLED=false`) and
  dev-only. Going live still needs: a real endpoint, privacy/security sign-off (bank/CASB), and a
  Salesforce-CSP test. See the memory note `d360-inspector-impact-analytics`.
