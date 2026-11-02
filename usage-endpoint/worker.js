/* ═══════════════════════════════════════════════════════════════════════════
 * Data 360 Inspector — USAGE REPORT (Cloudflare Worker → reads Firestore)
 * ---------------------------------------------------------------------------
 * The tool writes anonymous usage pings DIRECTLY to Firestore (firestore.googleapis.com
 * is allowed by Salesforce page CSP; our own domain is NOT — that's why writes go to
 * Firestore, not here). This Worker is READ-ONLY: it authenticates to Firestore with a
 * Firebase SERVICE-ACCOUNT key (JWT→access token), queries the `usage` collection, computes
 * adoption metrics, and serves a PASSWORD-GATED report. Firestore stays read-locked to the
 * public (rule: public create-only, NO public read) — only this Worker (holding the service
 * account) can read. No third party; you own + can delete the data in the Firebase console.
 *
 * ── Endpoints ──
 *   GET /report?token=…          password-gated HTML dashboard (PUBLIC vs DEV)
 *   GET /report.csv?token=…      CSV (optional &build=public|dev)
 *   GET /health                  "ok"
 *
 * ── Metrics (all non-PII) ── active users (all-time / WAU / MAU), returning (>1 day), ORGS,
 *   per-feature, per-org, per-version, per-user roster (first/last seen, days-active, feature
 *   breadth, recency bucket), daily-active trend. iid=random browser id; org=my-domain host
 *   (an org, not a person). No username / record / field data.
 *
 * ── Deploy (one time) ──
 *   1. Firebase console → Project settings → Service accounts → "Generate new private key"
 *      → download the JSON.
 *   2. wrangler secret put FIREBASE_SA        → paste the ENTIRE service-account JSON
 *   3. wrangler secret put REPORT_TOKEN       → any strong password
 *   4. wrangler deploy
 *   (No D1 anymore. wrangler.toml needs no d1 binding — only the two secrets.)
 * ═══════════════════════════════════════════════════════════════════════════ */

const PROJECT = "d360-usage";                 // Firebase project id
const COLLECTION = "usage";
const VALID_PAGES = new Set([
  "DataStream", "DLO", "DMO", "DataGraph", "DataModel", "DataModelERD",
  "Segment", "IdentityResolution", "DataSpace",
  "QueryEditor", "DataTransform", "Activation", "DataExplorer", "MappingCanvas", "other"
]);

function cors(h = {}) { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", ...h }; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function todayMinus(days) { const d = new Date(Date.now() - days * 86400000); return d.toISOString().slice(0, 10); }

// ── Firebase service-account → OAuth access token (JWT bearer grant, signed with RS256) ──
function b64url(buf) {
  let s = typeof buf === "string" ? btoa(buf) : btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getAccessToken(saJson) {
  const sa = typeof saJson === "string" ? JSON.parse(saJson) : saJson;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email, sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore",
    iat: now, exp: now + 3600
  };
  const unsigned = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(claims));
  // import the PEM private key for RS256 signing
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + "." + b64url(sig);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + jwt
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token exchange failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

// ── Read ALL usage docs (paged) via Firestore REST ──
async function readAllDocs(token) {
  const base = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents/" + COLLECTION;
  // NOTE: the Firestore DB id for reads here is the default; if your project's db is named
  // "default" (no parens) the REST path differs — see the tool's FS_DB. Try both.
  const paths = [base + "?pageSize=300", base.replace("/(default)/", "/default/") + "?pageSize=300"];
  let out = [], usedBase = null, lastErr = "";
  for (const start of paths) {
    out = []; usedBase = start.split("?")[0]; let pageTok = ""; let ok = false;
    for (let i = 0; i < 200; i++) {
      const u = start + (pageTok ? "&pageToken=" + encodeURIComponent(pageTok) : "");
      const r = await fetch(u, { headers: { "Authorization": "Bearer " + token } });
      const j = await r.json();
      if (!r.ok) { lastErr = "HTTP " + r.status + " " + JSON.stringify(j).slice(0, 160); ok = false; break; }
      ok = true;
      (j.documents || []).forEach(d => {
        const f = d.fields || {};
        const g = k => (f[k] && (f[k].stringValue != null ? f[k].stringValue : f[k].integerValue)) || "";
        out.push({ iid: g("iid"), v: g("v"), page: g("page"), day: g("day"), build: g("build") || "public", org: g("org"), ts: g("ts") });
      });
      pageTok = j.nextPageToken || "";
      if (!pageTok) break;
    }
    if (ok) return out;
  }
  throw new Error(lastErr || "read failed");
}

// ── Aggregate rows → the rich metrics, split by build ──
function aggregate(rows) {
  const d7 = todayMinus(7), d30 = todayMinus(30);
  function tally(list) {
    const byUser = {}, byPage = {}, byOrg = {}, byVer = {}, byDay = {};
    const orgs = new Set();
    list.forEach(r => {
      const u = byUser[r.iid] || (byUser[r.iid] = { iid: r.iid, days: new Set(), features: new Set(), pings: 0, first: r.day, last: r.day, v: r.v, org: r.org });
      u.days.add(r.day); u.features.add(r.page); u.pings++;
      if (r.day < u.first) u.first = r.day; if (r.day > u.last) u.last = r.day;
      if (r.v) u.v = r.v; if (r.org) u.org = r.org;
      const p = byPage[r.page] || (byPage[r.page] = { page: r.page, users: new Set(), hits: 0 }); p.users.add(r.iid); p.hits++;
      if (r.org) { orgs.add(r.org); const o = byOrg[r.org] || (byOrg[r.org] = { org: r.org, users: new Set(), hits: 0, lastDay: r.day }); o.users.add(r.iid); o.hits++; if (r.day > o.lastDay) o.lastDay = r.day; }
      if (r.v) { const vv = byVer[r.v] || (byVer[r.v] = { v: r.v, users: new Set() }); vv.users.add(r.iid); }
      (byDay[r.day] = byDay[r.day] || new Set()).add(r.iid);
    });
    const users = Object.keys(byUser).length;
    const perUser = Object.values(byUser).map(u => ({
      iid: u.iid, org: u.org, firstSeen: u.first, lastSeen: u.last,
      daysActive: u.days.size, features: u.features.size, pings: u.pings, version: u.v,
      recency: u.last >= d7 ? "active (≤7d)" : (u.last >= d30 ? "recent (8–30d)" : "dormant (>30d)")
    })).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
    return {
      users, total: list.length,
      wau: new Set(list.filter(r => r.day >= d7).map(r => r.iid)).size,
      mau: new Set(list.filter(r => r.day >= d30).map(r => r.iid)).size,
      returning: perUser.filter(u => u.daysActive > 1).length,
      orgs: orgs.size,
      byPage: Object.values(byPage).map(p => ({ page: p.page, users: p.users.size, hits: p.hits })).sort((a, b) => b.users - a.users),
      byOrg: Object.values(byOrg).map(o => ({ org: o.org, users: o.users.size, hits: o.hits, lastDay: o.lastDay })).sort((a, b) => b.users - a.users).slice(0, 100),
      byVersion: Object.values(byVer).map(v => ({ v: v.v, users: v.users.size })).sort((a, b) => b.users - a.users),
      byDay: Object.entries(byDay).map(([day, s]) => ({ day, dau: s.size })).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 60),
      perUser: perUser.slice(0, 500)
    };
  }
  return { public: tally(rows.filter(r => r.build !== "dev")), dev: tally(rows.filter(r => r.build === "dev")) };
}

function sectionHtml(title, t) {
  const pg = t.byPage.map(r => `<tr><td>${esc(r.page)}</td><td>${r.users}</td><td>${r.hits}</td></tr>`).join("");
  const og = t.byOrg.map(r => `<tr><td>${esc(r.org)}</td><td>${r.users}</td><td>${r.hits}</td><td>${esc(r.lastDay)}</td></tr>`).join("");
  const vr = t.byVersion.map(r => `<tr><td>${esc(r.v)}</td><td>${r.users}</td></tr>`).join("");
  const dd = t.byDay.map(r => `<tr><td>${esc(r.day)}</td><td>${r.dau}</td></tr>`).join("");
  const ur = t.perUser.map(r => `<tr><td style="font-family:monospace;font-size:11px">${esc(r.iid)}</td><td>${esc(r.org)}</td><td>${esc(r.firstSeen)}</td><td>${esc(r.lastSeen)}</td><td>${r.daysActive}</td><td>${r.features}</td><td>${r.pings}</td><td>${esc(r.version)}</td><td>${esc(r.recency)}</td></tr>`).join("");
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
<h3>By feature</h3><table><tr><th>Page</th><th>Users</th><th>Hits</th></tr>${pg || "<tr><td colspan=3>no data yet</td></tr>"}</table>
<details><summary class=muted>By org (${t.byOrg.length})</summary><table><tr><th>Org</th><th>Users</th><th>Hits</th><th>Last day</th></tr>${og || "<tr><td colspan=4>—</td></tr>"}</table></details>
<details><summary class=muted>By version</summary><table><tr><th>Version</th><th>Users</th></tr>${vr || "<tr><td colspan=2>—</td></tr>"}</table></details>
<details><summary class=muted>Per-user roster (${t.perUser.length})</summary><table><tr><th>User (anon id)</th><th>Org</th><th>First seen</th><th>Last seen</th><th>Days active</th><th>Features</th><th>Pings</th><th>Version</th><th>Recency</th></tr>${ur || "<tr><td colspan=9>no data yet</td></tr>"}</table></details>
<details><summary class=muted>Daily active users (last 60 days)</summary><table><tr><th>Day</th><th>DAU</th></tr>${dd || "<tr><td colspan=2>—</td></tr>"}</table></details>
</section>`;
}

function csvFor(label, t) {
  let s = `# ${label}\nmetric,value\nactive_users,${t.users}\nweekly,${t.wau}\nmonthly,${t.mau}\nreturning,${t.returning}\norgs,${t.orgs}\ntotal_pings,${t.total}\n\npage,users,hits\n`;
  t.byPage.forEach(r => { s += `${r.page},${r.users},${r.hits}\n`; });
  s += "\niid,org,first_seen,last_seen,days_active,features,pings,version,recency\n";
  t.perUser.forEach(r => { s += `${r.iid},${r.org},${r.firstSeen},${r.lastSeen},${r.daysActive},${r.features},${r.pings},${r.version},${r.recency}\n`; });
  return s;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (url.pathname === "/health") return new Response("ok", { headers: cors() });

    if (url.pathname === "/report" || url.pathname === "/report.csv") {
      const token = url.searchParams.get("token") || "";
      if (!env.REPORT_TOKEN || token !== env.REPORT_TOKEN) return new Response("Unauthorized. Append ?token=YOUR_REPORT_TOKEN", { status: 401, headers: cors() });
      if (!env.FIREBASE_SA) return new Response("Not configured: set the FIREBASE_SA secret (service-account JSON).", { status: 500, headers: cors() });
      let agg;
      try {
        const at = await getAccessToken(env.FIREBASE_SA);
        const rows = await readAllDocs(at);
        agg = aggregate(rows);
      } catch (e) { return new Response("Read failed: " + String(e && e.message || e).slice(0, 300), { status: 502, headers: cors() }); }

      if (url.pathname === "/report.csv") {
        const which = (url.searchParams.get("build") || "").toLowerCase();
        let csv = which === "public" ? csvFor("PUBLIC", agg.public) : which === "dev" ? csvFor("DEV", agg.dev) : (csvFor("PUBLIC", agg.public) + "\n\n" + csvFor("DEV", agg.dev));
        return new Response(csv, { headers: cors({ "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=d360-usage.csv" }) });
      }
      const html = `<!doctype html><meta charset=utf-8><title>D360 Inspector — usage</title>
<style>body{font:14px/1.6 -apple-system,sans-serif;max-width:900px;margin:30px auto;padding:0 20px;color:#1e293b}
h1{font-size:20px}h3{font-size:13px;margin:12px 0 4px;color:#475569}.big{display:flex;gap:22px;flex-wrap:wrap;margin:10px 0}
.stat{font-size:28px;font-weight:800;color:#0d9488}.muted{color:#64748b;font-size:12px;cursor:pointer}
table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #e2e8f0;padding:5px 9px;text-align:left}
th{background:#f1f5f9;font-size:11px;text-transform:uppercase}a{color:#0d9488}summary{margin:8px 0}</style>
<h1>Data 360 Inspector — usage</h1>
<p class=muted>Anonymous adoption metrics from Firestore. No personal data (iid=random browser id, org=my-domain host). Download:
<a href="/report.csv?token=${encodeURIComponent(token)}">both</a> · <a href="/report.csv?token=${encodeURIComponent(token)}&build=public">public</a> · <a href="/report.csv?token=${encodeURIComponent(token)}&build=dev">dev</a></p>
${sectionHtml("🌐 PUBLIC users", agg.public)}
${sectionHtml("🧪 DEV users", agg.dev)}`;
      return new Response(html, { headers: cors({ "Content-Type": "text/html" }) });
    }
    return new Response("Data 360 Inspector usage report. GET /report?token=…", { headers: cors() });
  }
};
