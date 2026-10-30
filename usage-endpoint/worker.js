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

const VALID_PAGES = new Set(["DataStream", "DLO", "DMO", "DataGraph", "Segment", "IdentityResolution", "DataSpace", "DataModel", "other"]);
const TABLE = { public: "pings_public", dev: "pings_dev" };

function cors(h = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...h };
}
function clean(v, max) { return (typeof v === "string" ? v : "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, max); }

async function tallyFor(db, table) {
  const users = (await db.prepare(`SELECT COUNT(DISTINCT iid) n FROM ${table}`).first())?.n || 0;
  const total = (await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first())?.n || 0;
  const wau = (await db.prepare(`SELECT COUNT(DISTINCT iid) n FROM ${table} WHERE day >= date('now','-7 day')`).first())?.n || 0;
  const mau = (await db.prepare(`SELECT COUNT(DISTINCT iid) n FROM ${table} WHERE day >= date('now','-30 day')`).first())?.n || 0;
  const byPage = (await db.prepare(`SELECT page, COUNT(DISTINCT iid) users, COUNT(*) hits FROM ${table} GROUP BY page ORDER BY users DESC`).all())?.results || [];
  const byDay = (await db.prepare(`SELECT day, COUNT(DISTINCT iid) dau FROM ${table} GROUP BY day ORDER BY day DESC LIMIT 60`).all())?.results || [];
  return { users, total, wau, mau, byPage, byDay };
}

function sectionHtml(title, t) {
  const rows = t.byPage.map(r => `<tr><td>${r.page}</td><td>${r.users}</td><td>${r.hits}</td></tr>`).join("");
  const days = t.byDay.map(r => `<tr><td>${r.day}</td><td>${r.dau}</td></tr>`).join("");
  return `<section style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin:16px 0">
<h2 style="margin:0 0 6px;font-size:16px">${title}</h2>
<div class=big>
  <div><div class=stat>${t.users}</div><div class=muted>ACTIVE USERS (all time)</div></div>
  <div><div class=stat>${t.wau}</div><div class=muted>WEEKLY (7d)</div></div>
  <div><div class=stat>${t.mau}</div><div class=muted>MONTHLY (30d)</div></div>
  <div><div class=stat>${t.total}</div><div class=muted>total pings</div></div>
</div>
<table><tr><th>Page</th><th>Users</th><th>Hits</th></tr>${rows || "<tr><td colspan=3>no data yet</td></tr>"}</table>
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

    // ── INGEST ──────────────────────────────────────────────────────────────
    // Accepts BOTH transports, because Salesforce page CSP differs by request type:
    //   • POST + JSON body  → used by sendBeacon/fetch (governed by CSP connect-src)
    //   • GET + query params → used by an <img> beacon (governed by CSP img-src — a DIFFERENT
    //     directive that some SF pages allow even when connect-src blocks us). GET returns a
    //     transparent 1×1 GIF so the Image() onload fires cleanly (no false onerror).
    if (url.pathname === "/ping" && (request.method === "POST" || request.method === "GET")) {
      let p = {};
      if (request.method === "POST") { try { p = await request.json(); } catch (e) { p = {}; } }
      else { p = Object.fromEntries(url.searchParams.entries()); }   // GET: read from query string
      const iid = clean(p.iid, 40);
      const v = clean(p.v, 20);
      let page = clean(p.page, 24);
      if (!VALID_PAGES.has(page)) page = "other";
      const day = clean(p.day, 10);
      let build = clean(p.build, 10);
      const table = TABLE[build] || TABLE.public;          // unknown/missing build → public bucket
      if (iid && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        try {
          await env.DB.prepare(`INSERT INTO ${table} (iid, v, page, day, ts) VALUES (?, ?, ?, ?, ?)`)
            .bind(iid, v, page, day, new Date().toISOString()).run();
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
