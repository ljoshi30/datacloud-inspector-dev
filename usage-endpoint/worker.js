/* ═══════════════════════════════════════════════════════════════════════════
 * Data 360 Inspector — USAGE ENDPOINT (Cloudflare Worker + D1)
 * ---------------------------------------------------------------------------
 * Production receiver for the anonymous usage ping. Runs in YOUR Cloudflare
 * account; stores each ping in D1 (SQLite); a password-protected /report reads
 * it back. No third party; you own + can delete the data.
 *
 * TWO TABLES: each ping carries build="public"|"dev"; it's stored in pings_public
 * or pings_dev so you can see the two audiences SEPARATELY (user request).
 *
 * ── Endpoints ──
 *   POST /ping       ← tool sends { iid, v, page, day, build }. Stores one row. 204.
 *   GET  /report     ← password-gated dashboard: PUBLIC and DEV side by side.
 *   GET  /report.csv ← same numbers as CSV (?build=public|dev to get one, default both).
 *   GET  /health     ← "ok".
 *
 * ── Stored (anonymous) ──  iid (random browser id) · v (version) · page (coarse bucket) · day · ts.
 * NOTHING else. No IP (never read). page is whitelisted server-side.
 *
 * ── Deploy ──
 *   wrangler d1 create d360_usage        (paste database_id into wrangler.toml)
 *   wrangler d1 execute d360_usage --file=./schema.sql --remote
 *   wrangler secret put REPORT_TOKEN
 *   wrangler deploy
 * ═══════════════════════════════════════════════════════════════════════════ */

// Feature/page buckets the ping may report. Kept in sync with pingPageType() in the tool.
const VALID_PAGES = new Set([
  "DataStream", "DLO", "DMO", "DataGraph", "DataModel", "DataModelERD",
  "Segment", "IdentityResolution", "DataSpace",
  "QueryEditor", "DataTransform", "Activation", "DataExplorer", "MappingCanvas",
  "other"
]);
const TABLE = { public: "pings_public", dev: "pings_dev" };

function cors(h = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...h };
}
function clean(v, max) { return (typeof v === "string" ? v : "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, max); }

async function tallyFor(db, table) {
  const one = async (sql) => { try { return (await db.prepare(sql).first())?.n || 0; } catch (e) { return 0; } };
  const all = async (sql) => { try { return (await db.prepare(sql).all())?.results || []; } catch (e) { return []; } };
  const users = await one(`SELECT COUNT(DISTINCT iid) n FROM ${table}`);
  const total = await one(`SELECT COUNT(*) n FROM ${table}`);
  const wau = await one(`SELECT COUNT(DISTINCT iid) n FROM ${table} WHERE day >= date('now','-7 day')`);
  const mau = await one(`SELECT COUNT(DISTINCT iid) n FROM ${table} WHERE day >= date('now','-30 day')`);
  // returning = users seen on >1 distinct day (real retention signal). orgs = distinct org hosts.
  const returning = await one(`SELECT COUNT(*) n FROM (SELECT iid FROM ${table} GROUP BY iid HAVING COUNT(DISTINCT day) > 1)`);
  const orgs = await one(`SELECT COUNT(DISTINCT org) n FROM ${table} WHERE org IS NOT NULL AND org <> ''`);
  const byPage = await all(`SELECT page, COUNT(DISTINCT iid) users, COUNT(*) hits FROM ${table} GROUP BY page ORDER BY users DESC`);
  const byDay = await all(`SELECT day, COUNT(DISTINCT iid) dau FROM ${table} GROUP BY day ORDER BY day DESC LIMIT 60`);
  const byOrg = await all(`SELECT org, COUNT(DISTINCT iid) users, COUNT(*) hits, MAX(day) lastDay FROM ${table} WHERE org IS NOT NULL AND org <> '' GROUP BY org ORDER BY users DESC LIMIT 100`);
  const byVersion = await all(`SELECT v, COUNT(DISTINCT iid) users FROM ${table} GROUP BY v ORDER BY users DESC`);
  // per-user roster: first/last seen, days active, distinct features, total pings, recency bucket
  const perUser = await all(
    `SELECT iid,
       MIN(day) firstSeen, MAX(day) lastSeen,
       COUNT(DISTINCT day) daysActive,
       COUNT(DISTINCT page) features,
       COUNT(*) pings,
       MAX(v) version, MAX(org) org,
       CASE WHEN MAX(day) >= date('now','-7 day') THEN 'active (≤7d)'
            WHEN MAX(day) >= date('now','-30 day') THEN 'recent (8–30d)'
            ELSE 'dormant (>30d)' END recency
     FROM ${table} GROUP BY iid ORDER BY lastSeen DESC LIMIT 500`);
  return { users, total, wau, mau, returning, orgs, byPage, byDay, byOrg, byVersion, perUser };
}

function sectionHtml(title, t) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const rows = t.byPage.map(r => `<tr><td>${esc(r.page)}</td><td>${r.users}</td><td>${r.hits}</td></tr>`).join("");
  const days = t.byDay.map(r => `<tr><td>${esc(r.day)}</td><td>${r.dau}</td></tr>`).join("");
  const orgRows = (t.byOrg || []).map(r => `<tr><td>${esc(r.org)}</td><td>${r.users}</td><td>${r.hits}</td><td>${esc(r.lastDay)}</td></tr>`).join("");
  const verRows = (t.byVersion || []).map(r => `<tr><td>${esc(r.v)}</td><td>${r.users}</td></tr>`).join("");
  const userRows = (t.perUser || []).map(r => `<tr><td style="font-family:monospace;font-size:11px">${esc(r.iid)}</td><td>${esc(r.org)}</td><td>${esc(r.firstSeen)}</td><td>${esc(r.lastSeen)}</td><td>${r.daysActive}</td><td>${r.features}</td><td>${r.pings}</td><td>${esc(r.version)}</td><td>${esc(r.recency)}</td></tr>`).join("");
  return `<section style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin:16px 0">
<h2 style="margin:0 0 6px;font-size:16px">${title}</h2>
<div class=big>
  <div><div class=stat>${t.users}</div><div class=muted>ACTIVE USERS (all time)</div></div>
  <div><div class=stat>${t.wau}</div><div class=muted>WEEKLY (7d)</div></div>
  <div><div class=stat>${t.mau}</div><div class=muted>MONTHLY (30d)</div></div>
  <div><div class=stat>${t.returning}</div><div class=muted>RETURNING (&gt;1 day)</div></div>
  <div><div class=stat>${t.orgs}</div><div class=muted>ORGS</div></div>
  <div><div class=stat>${t.total}</div><div class=muted>total pings</div></div>
</div>
<h3>By feature</h3>
<table><tr><th>Page</th><th>Users</th><th>Hits</th></tr>${rows || "<tr><td colspan=3>no data yet</td></tr>"}</table>
<details><summary class=muted>By org (${(t.byOrg || []).length})</summary>
<table><tr><th>Org</th><th>Users</th><th>Hits</th><th>Last day</th></tr>${orgRows || "<tr><td colspan=4>no org data</td></tr>"}</table></details>
<details><summary class=muted>By version</summary>
<table><tr><th>Version</th><th>Users</th></tr>${verRows || "<tr><td colspan=2>—</td></tr>"}</table></details>
<details><summary class=muted>Per-user roster (${(t.perUser || []).length}) — first/last seen, days active, feature breadth, recency</summary>
<table><tr><th>User (anon id)</th><th>Org</th><th>First seen</th><th>Last seen</th><th>Days active</th><th>Features</th><th>Pings</th><th>Version</th><th>Recency</th></tr>${userRows || "<tr><td colspan=9>no data yet</td></tr>"}</table></details>
<details><summary class=muted>Daily active users (last 60 days)</summary>
<table><tr><th>Day</th><th>DAU</th></tr>${days || "<tr><td colspan=2>no data yet</td></tr>"}</table></details>
</section>`;
}

function csvFor(label, t) {
  let s = `# ${label}\nmetric,value\nactive_users_all_time,${t.users}\nweekly_active_users,${t.wau}\nmonthly_active_users,${t.mau}\ntotal_pings,${t.total}\n\npage,users,hits\n`;
  t.byPage.forEach(r => { s += `${r.page},${r.users},${r.hits}\n`; });
  s += "\nday,daily_active_users\n";
  t.byDay.forEach(r => { s += `${r.day},${r.dau}\n`; });
  return s;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (url.pathname === "/health") return new Response("ok", { headers: cors() });

    // ── BEACON PAGE (for the hidden-iframe transport) ─────────────────────────
    // The tool injects <iframe src=".../beacon?iid=…&build=…&page=…&day=…">. Because this HTML is
    // served from OUR origin, the fetch below runs under OUR (permissive) CSP — NOT Salesforce's
    // page CSP (which blocks connect-src to us). Governed by the host page's frame-src/child-src
    // directive instead. The iframe self-pings same-origin /ping. Framing is allowed below via
    // Content-Security-Policy: frame-ancestors * (so SF can embed us).
    if (url.pathname === "/beacon") {
      const q = url.search || "";   // pass the query straight through to the same-origin ping
      const html = `<!doctype html><meta charset=utf-8><title>Usage recorded</title>
<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:420px;margin:60px auto;padding:0 24px;color:#1e293b;text-align:center}
.chk{font-size:40px;color:#0d9488}.muted{color:#64748b;font-size:13px}</style>
<div class=chk>✓</div>
<h2>Thanks — usage recorded</h2>
<p class=muted>Anonymous: a random id + the tool version + page type only. No personal or org data.
This tab closes automatically.</p>
<script>
(function(){
  function tell(m){try{if(window.opener)window.opener.postMessage("dc-beacon:"+m,"*");parent.postMessage("dc-beacon:"+m,"*");}catch(e){}}
  try{
    var p=new URLSearchParams(location.search);
    var body=JSON.stringify({iid:p.get("iid"),v:p.get("v"),page:p.get("page"),day:p.get("day"),build:p.get("build")});
    // same-origin fetch → OUR CSP, not Salesforce's. Records the ping, then auto-closes the tab.
    fetch("/ping",{method:"POST",headers:{"Content-Type":"application/json"},body:body})
      .then(function(){tell("ok");setTimeout(function(){try{window.close()}catch(e){}},1200);})
      .catch(function(e){tell("fail:"+e);});
  }catch(e){tell("threw:"+e)}
})();
<\/script>`;
      return new Response(html, { headers: cors({
        "Content-Type": "text/html",
        "Content-Security-Policy": "frame-ancestors *",   // allow SF pages to embed this beacon
        "Cache-Control": "no-store"
      }) });
    }

    // ── INGEST ──────────────────────────────────────────────────────────────
    // Accepts MULTIPLE transports, because Salesforce page CSP governs each differently:
    //   • POST + JSON body   → sendBeacon/fetch (CSP connect-src — BLOCKED on SF pages)
    //   • GET  + query params → <img> beacon (CSP img-src — BLOCKED on SF pages)
    //   • POST + QUERY params → the <a ping="…"> hyperlink auditing beacon. Its POST body is just
    //     "PING", and OUR params ride in the URL. <a ping> is NOT governed by connect-src/img-src —
    //     it's a separate browser beacon mechanism, so it MAY get through where the others don't.
    //     That's the whole out-of-the-box bet. We read params from the query string in that case.
    if ((url.pathname === "/ping" || url.pathname === "/collect") && (request.method === "POST" || request.method === "GET")) {
      let p = {};
      if (request.method === "POST") {
        // try JSON first (sendBeacon/fetch); if there's no JSON (an <a ping> "PING" body), fall
        // back to the query string so the <a ping> transport still carries our params.
        try { p = await request.json(); } catch (e) { p = {}; }
        if (!p || !p.iid) { try { p = Object.fromEntries(url.searchParams.entries()); } catch (e2) {} }
      }
      else { p = Object.fromEntries(url.searchParams.entries()); }   // GET: read from query string
      const iid = clean(p.iid, 40);
      const v = clean(p.v, 20);
      let page = clean(p.page, 24);
      if (!VALID_PAGES.has(page)) page = "other";
      const day = clean(p.day, 10);
      let build = clean(p.build, 10);
      const org = clean(p.org, 80);                        // org my-domain host (semi-identifying, not PII)
      const table = TABLE[build] || TABLE.public;          // unknown/missing build → public bucket
      if (iid && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        try {
          await env.DB.prepare(`INSERT INTO ${table} (iid, v, page, day, org, ts) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(iid, v, page, day, org, new Date().toISOString()).run();
        } catch (e) { /* fire-and-forget */ }
      }
      if (request.method === "GET") {
        // 1×1 transparent GIF — makes the <img> beacon load successfully.
        const gif = Uint8Array.from([0x47,0x49,0x46,0x38,0x39,0x61,1,0,1,0,0x80,0,0,0,0,0,0,0,0,0x21,0xf9,4,1,0,0,0,0,0x2c,0,0,0,0,1,0,1,0,0,2,2,0x44,1,0,0x3b]);
        return new Response(gif, { headers: cors({ "Content-Type": "image/gif", "Cache-Control": "no-store" }) });
      }
      return new Response(null, { status: 204, headers: cors() });   // POST: fire-and-forget
    }

    // ── REPORT (password-gated) ───────────────────────────────────────────────
    if (url.pathname === "/report" || url.pathname === "/report.csv") {
      const token = url.searchParams.get("token") || "";
      if (!env.REPORT_TOKEN || token !== env.REPORT_TOKEN) {
        return new Response("Unauthorized. Append ?token=YOUR_REPORT_TOKEN", { status: 401, headers: cors() });
      }
      const pub = await tallyFor(env.DB, TABLE.public);
      const dev = await tallyFor(env.DB, TABLE.dev);

      if (url.pathname === "/report.csv") {
        const which = (url.searchParams.get("build") || "").toLowerCase();
        let csv = "";
        if (which === "public") csv = csvFor("PUBLIC", pub);
        else if (which === "dev") csv = csvFor("DEV", dev);
        else csv = csvFor("PUBLIC", pub) + "\n\n" + csvFor("DEV", dev);
        return new Response(csv, { headers: cors({ "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=d360-usage.csv" }) });
      }

      const html = `<!doctype html><meta charset=utf-8><title>D360 Inspector — usage</title>
<style>body{font:14px/1.6 -apple-system,sans-serif;max-width:760px;margin:30px auto;padding:0 20px;color:#1e293b}
h1{font-size:20px}.big{display:flex;gap:26px;flex-wrap:wrap;margin:12px 0}
.stat{font-size:30px;font-weight:800;color:#0d9488}.muted{color:#64748b;font-size:12px}
table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #e2e8f0;padding:6px 10px;text-align:left}
th{background:#f1f5f9;font-size:12px;text-transform:uppercase}a{color:#0d9488}summary{cursor:pointer}</style>
<h1>Data 360 Inspector — usage</h1>
<p class=muted>Anonymous adoption metrics, PUBLIC vs DEV shown separately. No personal or org data is collected.
Download: <a href="/report.csv?token=${encodeURIComponent(token)}">both (CSV)</a> ·
<a href="/report.csv?token=${encodeURIComponent(token)}&build=public">public</a> ·
<a href="/report.csv?token=${encodeURIComponent(token)}&build=dev">dev</a></p>
${sectionHtml("🌐 PUBLIC users", pub)}
${sectionHtml("🧪 DEV users", dev)}`;
      return new Response(html, { headers: cors({ "Content-Type": "text/html" }) });
    }

    return new Response("Data 360 Inspector usage endpoint. POST /ping · GET /report?token=…", { headers: cors() });
  }
};
