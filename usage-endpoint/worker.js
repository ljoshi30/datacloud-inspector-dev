/* ═══════════════════════════════════════════════════════════════════════════
 * Data 360 Inspector — USAGE ENDPOINT (Cloudflare Worker + D1)
 * ---------------------------------------------------------------------------
 * The PRODUCTION receiver for the anonymous usage ping. Runs in YOUR Cloudflare
 * account; stores each ping in a D1 (SQLite) table; a password-protected /report
 * reads it back as a dashboard + CSV. No third party; you own + can delete the data.
 *
 * ── Endpoints ──
 *   POST /ping     ← the tool sends { iid, v, page, day }. Stores one row. Returns 204.
 *   GET  /report   ← password-gated HTML dashboard (active users, DAU/WAU/MAU, by page, trend).
 *   GET  /report.csv ← same numbers as CSV (for Excel / a slide).
 *   GET  /health   ← "ok".
 *
 * ── What is stored (anonymous by construction — matches the tool's packet) ──
 *   iid  = random per-browser id (NOT a person, org, or hostname)
 *   v    = tool version        page = coarse bucket ("DMO"/"Segment"/…)   day = YYYY-MM-DD
 *   ts   = server receive time.  NOTHING else. No IP is stored (see below).
 *
 * ── Deploy (one time) ──
 *   1. npm i -g wrangler ; wrangler login
 *   2. wrangler d1 create d360_usage        → copy the database_id into wrangler.toml
 *   3. wrangler d1 execute d360_usage --file=./schema.sql --remote
 *   4. put a REPORT_TOKEN secret:  wrangler secret put REPORT_TOKEN
 *   5. wrangler deploy
 *   6. the deployed URL + "/ping" is what goes into PING_ENDPOINT in the tool.
 * ═══════════════════════════════════════════════════════════════════════════ */

const VALID_PAGES = new Set(["DataStream", "DLO", "DMO", "DataGraph", "Segment", "IdentityResolution", "DataSpace", "DataModel", "other"]);

function cors(h = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...h };
}
function clean(v, max) { return (typeof v === "string" ? v : "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, max); }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (url.pathname === "/health") return new Response("ok", { headers: cors() });

    // ── INGEST ──────────────────────────────────────────────────────────────
    if (request.method === "POST" && url.pathname === "/ping") {
      let p = {};
      try { p = await request.json(); } catch (e) { p = {}; }
      // sanitize hard — we only ever keep the four anonymous fields, bounded + whitelisted.
      const iid = clean(p.iid, 40);
      const v = clean(p.v, 20);
      let page = clean(p.page, 24);
      if (!VALID_PAGES.has(page)) page = "other";            // never store free-form page content
      const day = clean(p.day, 10);                           // YYYY-MM-DD
      if (!iid || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Response(null, { status: 204, headers: cors() }); // ignore junk, don't error
      // NOTE: we deliberately do NOT read or store request IP / headers → stays anonymous.
      try {
        await env.DB.prepare("INSERT INTO pings (iid, v, page, day, ts) VALUES (?, ?, ?, ?, ?)")
          .bind(iid, v, page, day, new Date().toISOString()).run();
      } catch (e) { /* fire-and-forget: never surface an error to the page */ }
      return new Response(null, { status: 204, headers: cors() });  // matches sendBeacon/no-cors
    }

    // ── REPORT (password-gated) ───────────────────────────────────────────────
    if (url.pathname === "/report" || url.pathname === "/report.csv") {
      const token = url.searchParams.get("token") || "";
      if (!env.REPORT_TOKEN || token !== env.REPORT_TOKEN) {
        return new Response("Unauthorized. Append ?token=YOUR_REPORT_TOKEN", { status: 401, headers: cors() });
      }
      const db = env.DB;
      const uniqUsers = (await db.prepare("SELECT COUNT(DISTINCT iid) n FROM pings").first())?.n || 0;
      const totalPings = (await db.prepare("SELECT COUNT(*) n FROM pings").first())?.n || 0;
      const byPage = (await db.prepare("SELECT page, COUNT(DISTINCT iid) users, COUNT(*) hits FROM pings GROUP BY page ORDER BY users DESC").all())?.results || [];
      const byDay = (await db.prepare("SELECT day, COUNT(DISTINCT iid) dau FROM pings GROUP BY day ORDER BY day DESC LIMIT 60").all())?.results || [];
      // WAU / MAU = distinct users in the last 7 / 30 days (by stored day string)
      const wau = (await db.prepare("SELECT COUNT(DISTINCT iid) n FROM pings WHERE day >= date('now','-7 day')").first())?.n || 0;
      const mau = (await db.prepare("SELECT COUNT(DISTINCT iid) n FROM pings WHERE day >= date('now','-30 day')").first())?.n || 0;

      if (url.pathname === "/report.csv") {
        let csv = "metric,value\nactive_users_all_time," + uniqUsers + "\nweekly_active_users," + wau + "\nmonthly_active_users," + mau + "\ntotal_pings," + totalPings + "\n\npage,users,hits\n";
        byPage.forEach(r => { csv += `${r.page},${r.users},${r.hits}\n`; });
        csv += "\nday,daily_active_users\n";
        byDay.forEach(r => { csv += `${r.day},${r.dau}\n`; });
        return new Response(csv, { headers: cors({ "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=d360-usage.csv" }) });
      }

      const rows = byPage.map(r => `<tr><td>${r.page}</td><td>${r.users}</td><td>${r.hits}</td></tr>`).join("");
      const days = byDay.map(r => `<tr><td>${r.day}</td><td>${r.dau}</td></tr>`).join("");
      const html = `<!doctype html><meta charset=utf-8><title>D360 Inspector — usage</title>
<style>body{font:14px/1.6 -apple-system,sans-serif;max-width:720px;margin:30px auto;padding:0 20px;color:#1e293b}
h1{font-size:20px}.big{display:flex;gap:30px;flex-wrap:wrap;margin:18px 0}
.stat{font-size:34px;font-weight:800;color:#0d9488}.muted{color:#64748b;font-size:12px}
table{border-collapse:collapse;width:100%;margin:10px 0}td,th{border:1px solid #e2e8f0;padding:6px 10px;text-align:left}
th{background:#f1f5f9;font-size:12px;text-transform:uppercase}a{color:#0d9488}</style>
<h1>Data 360 Inspector — usage</h1>
<p class=muted>Anonymous adoption metrics. No personal or org data is collected. <a href="/report.csv?token=${encodeURIComponent(token)}">Download CSV</a></p>
<div class=big>
  <div><div class=stat>${uniqUsers}</div><div class=muted>ACTIVE USERS (all time, unique)</div></div>
  <div><div class=stat>${wau}</div><div class=muted>WEEKLY active (7d)</div></div>
  <div><div class=stat>${mau}</div><div class=muted>MONTHLY active (30d)</div></div>
  <div><div class=stat>${totalPings}</div><div class=muted>total pings</div></div>
</div>
<h3>By feature / page</h3><table><tr><th>Page</th><th>Users</th><th>Hits</th></tr>${rows || "<tr><td colspan=3>no data yet</td></tr>"}</table>
<h3>Daily active users (last 60 days)</h3><table><tr><th>Day</th><th>DAU</th></tr>${days || "<tr><td colspan=2>no data yet</td></tr>"}</table>`;
      return new Response(html, { headers: cors({ "Content-Type": "text/html" }) });
    }

    return new Response("Data 360 Inspector usage endpoint. POST /ping · GET /report?token=…", { headers: cors() });
  }
};
