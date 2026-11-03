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
// This project's Firestore DB id is literally "default" (no parens). The usual REST path uses
// "(default)". We try BOTH and keep whichever actually returns documents — NOT the first one
// that merely returns HTTP 200 with an empty page (an empty-but-OK response from the wrong DB
// path would otherwise make the whole report show 0 users). Only if BOTH are empty do we accept
// empty (genuinely no data yet); if both error, we surface the error.
async function readAllDocs(token) {
  const base = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/(default)/documents/" + COLLECTION;
  const paths = [base + "?pageSize=300", base.replace("/(default)/", "/default/") + "?pageSize=300"];
  let best = null, anyOk = false, lastErr = "";
  for (const start of paths) {
    let out = [], pageTok = "", ok = true;
    for (let i = 0; i < 500; i++) {
      const u = start + (pageTok ? "&pageToken=" + encodeURIComponent(pageTok) : "");
      const r = await fetch(u, { headers: { "Authorization": "Bearer " + token } });
      const j = await r.json();
      if (!r.ok) { lastErr = "HTTP " + r.status + " " + JSON.stringify(j).slice(0, 160); ok = false; break; }
      (j.documents || []).forEach(d => {
        const f = d.fields || {};
        const g = k => (f[k] && (f[k].stringValue != null ? f[k].stringValue : f[k].integerValue)) || "";
        out.push({ iid: g("iid"), v: g("v"), page: g("page"), day: g("day"), build: g("build") || "public", org: g("org"), ts: g("ts") });
      });
      pageTok = j.nextPageToken || "";
      if (!pageTok) break;
    }
    if (ok) {
      anyOk = true;
      if (out.length) return out.filter(keepRow);   // got real data from this DB path → use it
      if (!best) best = out;                         // remember an empty-but-OK result as fallback
    }
  }
  if (anyOk) return (best || []).filter(keepRow);    // both paths empty → genuinely no data yet
  throw new Error(lastErr || "read failed");
}

// ── Write ONE usage doc to Firestore (server-side, via the service account) ──
// Used by the /beacon route: a bookmarklet in a CSP/CASB-locked org can't write to Firestore directly
// (blocked), but it CAN navigate a tab to this worker; the worker (not subject to the page's CSP/CASB)
// then writes the doc. Fields mirror the direct in-page ping exactly so both sources aggregate together.
async function writeUsageDoc(token, fields) {
  const base = "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/";
  const body = JSON.stringify({ fields: {
    iid:   { stringValue: String(fields.iid || "") },
    v:     { stringValue: String(fields.v || "") },
    page:  { stringValue: String(fields.page || "other") },
    day:   { stringValue: String(fields.day || "") },
    build: { stringValue: String(fields.build || "public") },
    org:   { stringValue: String(fields.org || "") },
    ts:    { stringValue: String(fields.ts || "") }
  }});
  // this project's DB id is literally "default"; try that first, then "(default)".
  for (const db of ["default", "(default)"]) {
    const u = base + db + "/documents/" + COLLECTION;
    const r = await fetch(u, { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body });
    if (r.ok) return true;
  }
  return false;
}

// Drop test/synthetic docs and malformed rows so the report shows REAL usage only. iids used for
// manual end-to-end testing (and any obviously-synthetic prefix) must never count as real users.
const TEST_IIDS = new Set(["ifs_test", "idiag_act", "itest1", "iwindowtest", "idirect1", "icsptest", "itest", "i_anon", "i_nostore"]);
function keepRow(r) {
  if (!r || !r.iid) return false;                    // must have a user id
  if (TEST_IIDS.has(r.iid)) return false;            // known manual-test ids
  if (/^(test|demo|sample|dummy)/i.test(r.iid)) return false;
  if (!r.day || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return false; // must have a valid day stamp
  return true;
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

// ── Inline SVG charts (no external libs; palette from the dataviz skill, light+dark via CSS vars) ──
// Horizontal bars = magnitude by identity (users per feature). Thin marks, 4px rounded data-end,
// value direct-labeled, recessive axis. Returns an <svg>.
function barChart(items, opts) {
  opts = opts || {};
  const rows = (items || []).slice(0, 10);
  if (!rows.length) return `<div class="muted" style="padding:10px 0">no data yet</div>`;
  const max = Math.max(1, ...rows.map(r => r.value));
  const rowH = 30, gap = 10, padL = 150, padR = 48, w = 560, h = rows.length * (rowH + gap) + 8;
  const barW = w - padL - padR;
  let bars = "";
  rows.forEach((r, i) => {
    const y = i * (rowH + gap) + 4;
    const bw = Math.max(2, Math.round((r.value / max) * barW));
    bars += `<text x="${padL - 10}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="middle" class="c-lbl">${esc(r.label)}</text>`;
    bars += `<rect x="${padL}" y="${y}" width="${bw}" height="${rowH}" rx="4" fill="var(--series-1)"/>`;
    bars += `<text x="${padL + bw + 8}" y="${y + rowH / 2}" dominant-baseline="middle" class="c-val">${r.value}${opts.suffix || ""}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="bar chart">${bars}</svg>`;
}
// Area+line trend = change over time (DAU). Baseline-anchored fill, 2px line, dots, recessive grid.
function trendChart(points) {
  const pts = (points || []).slice().sort((a, b) => (a.day < b.day ? -1 : 1));
  if (pts.length < 1) return `<div class="muted" style="padding:10px 0">no data yet</div>`;
  const w = 720, h = 170, padL = 34, padR = 12, padT = 12, padB = 26;
  const max = Math.max(1, ...pts.map(p => p.dau));
  const n = pts.length;
  const x = i => padL + (n === 1 ? (w - padL - padR) / 2 : (i / (n - 1)) * (w - padL - padR));
  const y = v => padT + (1 - v / max) * (h - padT - padB);
  let line = "", area = "", dots = "", xlabs = "";
  pts.forEach((p, i) => { const px = x(i), py = y(p.dau); line += (i ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1) + " "; dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="var(--series-1)"/>`; });
  area = `M${x(0).toFixed(1)} ${y(0).toFixed(1)} ` + pts.map((p, i) => "L" + x(i).toFixed(1) + " " + y(p.dau).toFixed(1)).join(" ") + ` L${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} Z`;
  // y gridlines (0, max/2, max)
  let grid = "";
  [0, Math.round(max / 2), max].forEach(v => { const gy = y(v); grid += `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" class="c-grid"/><text x="${padL - 6}" y="${gy}" text-anchor="end" dominant-baseline="middle" class="c-ax">${v}</text>`; });
  // x labels: first, middle, last (dates shortened)
  const showIdx = n <= 6 ? pts.map((_, i) => i) : [0, Math.floor(n / 2), n - 1];
  showIdx.forEach(i => { xlabs += `<text x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" class="c-ax">${esc((pts[i].day || "").slice(5))}</text>`; });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="daily active users trend">
    ${grid}
    <path d="${area}" fill="var(--series-1)" opacity="0.12"/>
    <path d="${line}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${xlabs}
  </svg>`;
}

function sectionHtml(title, t) {
  const og = t.byOrg.map(r => `<tr><td>${esc(r.org)}</td><td>${r.users}</td><td>${r.hits}</td><td>${esc(r.lastDay)}</td></tr>`).join("");
  const vr = t.byVersion.map(r => `<tr><td>${esc(r.v)}</td><td>${r.users}</td></tr>`).join("");
  const ur = t.perUser.map(r => `<tr><td style="font-family:monospace;font-size:11px">${esc(r.iid)}</td><td>${esc(r.org)}</td><td>${esc(r.firstSeen)}</td><td>${esc(r.lastSeen)}</td><td>${r.daysActive}</td><td>${r.features}</td><td>${r.pings}</td><td>${esc(r.version)}</td><td><span class="pill ${r.recency.indexOf('active')===0?'ok':r.recency.indexOf('recent')===0?'warn':'dim'}">${esc(r.recency)}</span></td></tr>`).join("");
  const featBars = barChart(t.byPage.map(p => ({ label: p.page, value: p.users })));
  const trend = trendChart(t.byDay);
  // tile(value, label, tooltip, highlight) — every metric carries an INSTANT tooltip (data-tip) + a small ⓘ.
  const tile = (n, lbl, tip, hl) => `<div class="tile" data-tip="${esc(tip)}" tabindex="0"><div class="tile-n"${hl ? ' style="color:var(--series-1)"' : ""}>${n}</div><div class="tile-l">${lbl} <span class="info">ⓘ</span></div></div>`;
  return `<section class="card">
<h2 class="sec-h">${title}</h2>
<div class="tiles">
  ${tile(t.users, "Active users (all time)", "Distinct people (unique anonymous browser ids) that have EVER used the tool. Counts each person once, no matter how often they use it.", true)}
  ${tile(t.wau, "Weekly active", "Distinct people who used the tool in the last 7 days.")}
  ${tile(t.mau, "Monthly active", "Distinct people who used the tool in the last 30 days.")}
  ${tile(t.returning, "Returning (&gt;1 day)", "People who came back on MORE THAN ONE separate day — a retention/stickiness signal (not one-time triers).")}
  ${tile(t.orgs, "Orgs", "Number of distinct Salesforce orgs (by my-domain host) the tool has been used in.")}
  ${tile(t.total, "Total pings", "Raw count of all usage events recorded. One person using several features over several days contributes several pings.")}
</div>
<div class="charts">
  <div class="chart-box"><h3 data-tip="How many distinct people opened each feature's panel. Shows WHICH features get used, not just overall reach." tabindex="0">Users by feature <span class="info">ⓘ</span></h3>${featBars}</div>
  <div class="chart-box"><h3 data-tip="Distinct active people per day over time. Rising = growing adoption." tabindex="0">Daily active users <span class="info">ⓘ</span></h3>${trend}</div>
</div>
<details><summary>Per-user roster (${t.perUser.length}) — per anonymous user: when first/last seen, how many days active, how many features, total uses, version, recency</summary>
  <table class="dt"><tr>
    <th data-tip="Random per-browser id. Not a person's name — anonymous.">User (anon)</th>
    <th data-tip="Salesforce org my-domain host where this user works.">Org</th>
    <th data-tip="First day this user was ever seen.">First seen</th>
    <th data-tip="Most recent day this user was active.">Last seen</th>
    <th data-tip="Number of distinct days this user was active (higher = stickier).">Days</th>
    <th data-tip="How many distinct features this user has touched (breadth of adoption).">Features</th>
    <th data-tip="Total usage events from this user.">Pings</th>
    <th data-tip="Tool version this user is on.">Version</th>
    <th data-tip="active = used in last 7d · recent = 8–30d · dormant = &gt;30d.">Recency</th>
  </tr>${ur || "<tr><td colspan=9>no data yet</td></tr>"}</table></details>
<details><summary>By org (${t.byOrg.length}) — usage grouped by Salesforce org</summary><table class="dt"><tr><th data-tip="Org my-domain host.">Org</th><th data-tip="Distinct users in this org.">Users</th><th data-tip="Total events from this org.">Hits</th><th data-tip="Most recent active day in this org.">Last day</th></tr>${og || "<tr><td colspan=4>—</td></tr>"}</table></details>
<details><summary>By version — which tool build users are on</summary><table class="dt"><tr><th data-tip="Tool version.">Version</th><th data-tip="Distinct users on this version.">Users</th></tr>${vr || "<tr><td colspan=2>—</td></tr>"}</table></details>
</section>`;
}

function csvFor(label, t) {
  let s = `# ${label}\nmetric,value\nactive_users,${t.users}\nweekly,${t.wau}\nmonthly,${t.mau}\nreturning,${t.returning}\norgs,${t.orgs}\ntotal_pings,${t.total}\n\npage,users,hits\n`;
  t.byPage.forEach(r => { s += `${r.page},${r.users},${r.hits}\n`; });
  s += "\niid,org,first_seen,last_seen,days_active,features,pings,version,recency\n";
  t.perUser.forEach(r => { s += `${r.iid},${r.org},${r.firstSeen},${r.lastSeen},${r.daysActive},${r.features},${r.pings},${r.version},${r.recency}\n`; });
  return s;
}

// ── Full page shell: dataviz palette (light + dark via CSS vars), cards, tiles, charts, tooltips ──
// view: "admin" → both Public + Dev sections; "mgr" → ONLY the Public (shared-to-users) section.
// Auth rides in an HttpOnly cookie now, so NO token appears in the URL or in any link here.
function pageHtml(agg, opts) {
  opts = opts || {};
  const view = (opts.view === "mgr" || opts.view === "dev") ? opts.view : "admin";
  const nowIso = opts.nowIso || "";
  const csvHref = opts.csvHref || "/report.csv";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Data 360 Inspector — usage</title>
<style>
:root{
  --page:#f9f9f7; --surface-1:#fcfcfb; --text-primary:#0b0b0b; --text-secondary:#52514e;
  --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,0.10);
  --series-1:#2a78d6; --ok:#0ca30c; --warn:#b4790a; --dim:#898781;
  --c-grid:#e1e0d9; --c-ax:#898781; --tip-bg:#1a1a19; --tip-fg:#fcfcfb;
}
@media (prefers-color-scheme: dark){
  :root{
    --page:#0d0d0d; --surface-1:#1a1a19; --text-primary:#ffffff; --text-secondary:#c3c2b7;
    --muted:#898781; --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
    --series-1:#3987e5; --ok:#0ca30c; --warn:#fab219; --dim:#898781;
    --c-grid:#2c2c2a; --c-ax:#898781; --tip-bg:#343433; --tip-fg:#ffffff;
  }
}
*{box-sizing:border-box}
body{font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--page);color:var(--text-primary);margin:0;padding:28px 18px 60px}
.wrap{max-width:1000px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
.lede{color:var(--text-secondary);font-size:13px;margin:0 0 22px;max-width:760px}
.lede a{color:var(--series-1);text-decoration:none;font-weight:600}
.lede a:hover{text-decoration:underline}
.card{background:var(--surface-1);border:1px solid var(--border);border-radius:14px;padding:20px 22px;margin:0 0 22px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.sec-h{font-size:16px;margin:0 0 16px;display:flex;align-items:center;gap:8px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.tile{background:var(--page);border:1px solid var(--border);border-radius:10px;padding:12px 14px;cursor:help;transition:border-color .15s}
.tile:hover{border-color:var(--series-1)}
.tile-n{font-size:30px;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--text-primary)}
.tile-l{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-secondary);margin-top:3px}
.info{color:var(--muted);font-weight:400;cursor:help;font-size:10px;vertical-align:super}
/* INSTANT tooltips (no ~1s native title= delay). Any element with data-tip shows on hover/focus. */
[data-tip]{position:relative}
[data-tip]:hover::after,[data-tip]:focus::after{
  content:attr(data-tip);position:absolute;left:0;top:calc(100% + 6px);z-index:50;
  width:max-content;max-width:280px;white-space:normal;text-align:left;
  background:var(--tip-bg);color:var(--tip-fg);font:400 11.5px/1.45 system-ui,sans-serif;
  text-transform:none;letter-spacing:normal;padding:7px 10px;border-radius:7px;
  box-shadow:0 6px 20px rgba(0,0,0,.28);pointer-events:none;opacity:0;animation:tipin .01s linear forwards}
[data-tip]:hover::before,[data-tip]:focus::before{
  content:"";position:absolute;left:14px;top:calc(100% + 1px);z-index:51;border:5px solid transparent;
  border-bottom-color:var(--tip-bg);pointer-events:none}
/* flip to the right edge for the last cells so the box doesn't clip off-screen */
.dt th:nth-last-child(-n+2)[data-tip]:hover::after,.dt th:nth-last-child(-n+2)[data-tip]:focus::after{left:auto;right:0}
@keyframes tipin{to{opacity:1}}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media (max-width:760px){.charts{grid-template-columns:1fr}}
.chart-box{background:var(--page);border:1px solid var(--border);border-radius:10px;padding:14px 16px;min-width:0}
.chart-box h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-secondary);margin:0 0 10px}
.chart-box svg{display:block}
.c-lbl{fill:var(--text-secondary);font:12px system-ui,sans-serif}
.c-val{fill:var(--text-primary);font:600 12px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
.c-grid{stroke:var(--c-grid);stroke-width:1}
.c-ax{fill:var(--c-ax);font:11px system-ui,sans-serif}
details{margin-top:16px;border-top:1px solid var(--border);padding-top:12px}
summary{cursor:pointer;font-size:12.5px;color:var(--text-secondary);font-weight:600}
summary:hover{color:var(--text-primary)}
.dt{border-collapse:collapse;width:100%;margin:10px 0 2px;font-size:12.5px}
.dt td,.dt th{border-bottom:1px solid var(--border);padding:6px 10px;text-align:left}
.dt th{font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);font-weight:700;cursor:help;white-space:nowrap}
.dt td{font-variant-numeric:tabular-nums;color:var(--text-primary)}
.dt tr:hover td{background:var(--surface-1)}
.pill{display:inline-block;padding:1px 9px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.pill.ok{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
.pill.warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:var(--warn)}
.pill.dim{background:color-mix(in srgb,var(--dim) 16%,transparent);color:var(--dim)}
.muted{color:var(--muted);font-size:12px}
.legend{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);margin-top:8px}
.legend .sw{width:10px;height:10px;border-radius:3px;background:var(--series-1);display:inline-block}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.live{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);font-weight:600}
.live .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 70%,transparent);animation:pulse 1.8s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ok) 55%,transparent)}70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
.actions a{font-size:12px;color:var(--series-1);text-decoration:none;font-weight:600;margin-left:14px}
.actions a:hover{text-decoration:underline}
</style></head><body><div class="wrap">
<div class="topbar">
  <h1>Data&nbsp;360 Inspector — adoption</h1>
  <span class="live" data-tip="This dashboard reads Firestore live on every page load — refresh any time for the latest. Generated just now."><span class="dot"></span>LIVE · generated ${esc(nowIso.replace("T"," ").slice(0,16))} UTC</span>
</div>
<p class="lede">${
  view === "mgr" ? "Live adoption of the <strong>Data&nbsp;360 Inspector</strong> — the bookmarklet shared with users. Each user is an <strong>anonymous</strong> random browser id (no names, no record/field data); <em>org</em> is the Salesforce my-domain host. Hover any metric or column header for what it means."
  : view === "dev" ? "Live usage of the <strong>internal / dev build</strong> of the Data&nbsp;360 Inspector (team testing). Each user is an <strong>anonymous</strong> random browser id; <em>org</em> is the Salesforce my-domain host. Hover any metric or column header for what it means."
  : "Anonymous usage metrics from Firestore — <strong>no personal data</strong> (each user is a random browser id; <em>org</em> is the Salesforce my-domain host, not a person). Hover any metric or column header for what it means."}
  <span class="actions"><a href="${esc(csvHref)}">Download CSV</a><a href="/logout">Sign out</a></span></p>
${
  view === "mgr" ? sectionHtml("🌐 Users (public bookmarklet)", agg.public)
  : view === "dev" ? sectionHtml("🧪 Dev / internal users", agg.dev)
  : sectionHtml("🌐 Public users", agg.public) + "\n" + sectionHtml("🧪 Dev / internal users", agg.dev)}
<p class="muted" style="margin-top:26px">Anonymous adoption telemetry · one record per user per feature per day · unique users counted by distinct browser id. ${
  view === "mgr" ? "Shows the public bookmarklet shared with users."
  : view === "dev" ? "Shows the internal/dev build only."
  : "Admin view — public + internal/dev builds."}</p>
</div></body></html>`;
}

// ── Login page (no token in the URL) — posts the password; the Worker sets an HttpOnly cookie ──
// `next` is the dashboard path to return to after sign-in (e.g. /manager). `label` names the area.
function loginHtml(msg, next, label) {
  const subtitle = label ? label + " — enter the access password." : "Adoption dashboard — enter the access password.";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Data 360 Inspector — sign in</title><style>
:root{color-scheme:light dark}
body{font:14px/1.6 system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f9f9f7;color:#0b0b0b}
@media(prefers-color-scheme:dark){body{background:#0d0d0d;color:#fff}}
.box{background:Canvas;border:1px solid rgba(128,128,128,.25);border-radius:14px;padding:28px 26px;width:320px;box-shadow:0 10px 40px rgba(0,0,0,.12)}
h1{font-size:17px;margin:0 0 4px}p{font-size:12.5px;color:#6b7280;margin:0 0 18px}
input{width:100%;padding:10px 12px;font-size:14px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:transparent;color:inherit;margin-bottom:12px;box-sizing:border-box}
button{width:100%;padding:10px;font-size:14px;font-weight:700;color:#fff;background:#2a78d6;border:0;border-radius:8px;cursor:pointer}
button:hover{background:#256abf}.err{color:#d03b3b;font-size:12.5px;margin:-4px 0 10px}
</style></head><body><form class="box" method="POST" action="/login">
<h1>Data 360 Inspector</h1><p>${esc(subtitle)}</p>
${msg ? `<div class="err">${esc(msg)}</div>` : ""}
<input type="hidden" name="next" value="${esc(next || "/report")}">
<input type="password" name="token" placeholder="Password" autofocus autocomplete="current-password" required>
<button type="submit">View dashboard</button>
</form></body></html>`;
}

// cookie helpers — the session cookie holds the password value, HttpOnly (JS can't read it) + SameSite.
function parseCookies(req) {
  const h = req.headers.get("Cookie") || ""; const out = {};
  h.split(/;\s*/).forEach(p => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
  return out;
}
function setCookie(name, val, maxAge) {
  return `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
// A password's ROLE = the maximum it can ever see.
function authRole(token, env) {
  if (env.REPORT_TOKEN && token === env.REPORT_TOKEN) return "admin";   // Public + Dev
  if (env.MANAGER_TOKEN && token === env.MANAGER_TOKEN) return "mgr";   // Public only
  if (env.DEV_TOKEN && token === env.DEV_TOKEN) return "dev";           // Dev only
  return null;
}

// Each friendly dashboard path maps to the view it renders. The PATH caps the view, and the signed-in
// ROLE caps it again — the effective view is the most restrictive of the two, so e.g. visiting /manager
// can never show dev data even with an admin password, and an admin visiting /dev is scoped to dev.
const PATHS = {
  "/report":  { view: "admin", label: "Adoption dashboard" },   // generic alias — shows whatever the role allows
  "/admin":   { view: "admin", label: "Admin dashboard" },
  "/manager": { view: "mgr",   label: "Manager dashboard (public bookmarklet)" },
  "/dev":     { view: "dev",   label: "Dev / internal dashboard" }
};
const CSV_PATHS = { "/report.csv": "admin", "/admin.csv": "admin", "/manager.csv": "mgr", "/dev.csv": "dev" };

// Combine the path's intended view with what the role is allowed to see. Returns the effective view, or
// null if the role can't satisfy the path (e.g. a manager password trying to reach /dev).
function effectiveView(pathView, role) {
  if (role === "admin") return pathView;               // admin can see any view the path asks for
  if (role === "mgr")   return pathView === "dev" ? null : "mgr";   // manager → only public, never dev
  if (role === "dev")   return pathView === "mgr" ? null : "dev";   // dev → only dev, never public
  return null;
}

const SESSION = "d360s";   // session cookie name (holds the password value, HttpOnly)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (p === "/health") return new Response("ok", { headers: cors() });

    // ── /beacon — usage capture for CSP/CASB-LOCKED orgs where the in-page Firestore write is blocked ──
    // The bookmarklet can't write to Firestore directly in a locked org, but it CAN navigate a tab here
    // (top-level navigation, not background egress). This worker — which is NOT subject to the page's CSP
    // or the client CASB — writes the doc server-side via the service account, shows a 1-line "recorded"
    // page, and auto-closes. Anonymous only (iid/version/feature/day/build/org). No token (public write,
    // same trust model as the direct Firestore create-only rule). Fields are validated + bounded.
    if (p === "/beacon") {
      const g = (k, max) => (url.searchParams.get(k) || "").slice(0, max || 80);
      const iid = g("iid", 60), page = g("page", 40), day = g("day", 10), build = (g("build", 6) === "dev" ? "dev" : "public"), org = g("org", 80), v = g("v", 20);
      const okShape = /^[A-Za-z0-9_]+$/.test(iid) && iid.length < 60 && /^\d{4}-\d{2}-\d{2}$/.test(day) && VALID_PAGES.has(page);
      let stored = false;
      if (okShape && env.FIREBASE_SA && iid && !(new Set(["ifs_test","idiag_act","itest1"]).has(iid))) {
        try {
          const at = await getAccessToken(env.FIREBASE_SA);
          stored = await writeUsageDoc(at, { iid, v, page, day, build, org, ts: new Date().toISOString() });
        } catch (e) { stored = false; }
      }
      // tiny auto-closing page (self-origin → no CSP issue here); closes fast so the flash is minimal.
      // It posts a confirmation back to the opener so the tool KNOWS the beacon actually reached us
      // (vs. a corporate web-filter block page, which is a different origin and can't send this). If the
      // opener never gets this message, it marks the beacon "dead" for that org and stops opening tabs.
      const html = "<!doctype html><meta charset=utf-8><title>recorded</title>" +
        "<body style=\"font:13px -apple-system,sans-serif;color:#334;display:grid;place-items:center;height:100vh;margin:0\">" +
        "<div>" + (stored ? "✓ usage recorded" : "· noted") + "</div>" +
        "<script>try{if(window.opener)window.opener.postMessage({__dcBeacon:'ok',stored:" + (stored ? "true" : "false") + "},'*')}catch(e){}" +
        "try{window.close()}catch(e){};setTimeout(function(){try{window.close()}catch(e){}},400)</script>";
      return new Response(html, { headers: cors({ "Content-Type": "text/html", "Cache-Control": "no-store" }) });
    }

    // ── auth routes ──────────────────────────────────────────────────────────
    if (p === "/login" && request.method === "POST") {
      const form = await request.formData();
      const token = String(form.get("token") || "");
      let next = String(form.get("next") || "/report");
      if (!PATHS[next]) next = "/report";                 // only allow known dashboard paths as the return target
      const role = authRole(token, env);
      if (!role) return new Response(loginHtml("Incorrect password.", next, PATHS[next] && PATHS[next].label), { status: 401, headers: { "Content-Type": "text/html" } });
      // set the HttpOnly session cookie and redirect to the clean dashboard URL (no token in URL)
      return new Response(null, { status: 303, headers: { "Location": next, "Set-Cookie": setCookie(SESSION, token, 60 * 60 * 12) } });
    }
    if (p === "/logout") {
      return new Response(null, { status: 303, headers: { "Location": "/login", "Set-Cookie": setCookie(SESSION, "", 0) } });
    }
    if (p === "/login") return new Response(loginHtml("", url.searchParams.get("next") || "/report"), { headers: { "Content-Type": "text/html" } });

    // ── CSV endpoints (scoped by path + role) ──
    if (CSV_PATHS[p]) {
      const cookies = parseCookies(request);
      const role = authRole(cookies[SESSION] || "", env);
      const view = role ? effectiveView(CSV_PATHS[p], role) : null;
      if (!view) return new Response("Unauthorized", { status: 401, headers: cors() });
      if (!env.FIREBASE_SA) return new Response("Not configured: set FIREBASE_SA.", { status: 500, headers: cors() });
      let agg;
      try { agg = aggregate(await readAllDocs(await getAccessToken(env.FIREBASE_SA))); }
      catch (e) { return new Response("Read failed: " + String(e && e.message || e).slice(0, 300), { status: 502, headers: cors() }); }
      let which = (url.searchParams.get("build") || "").toLowerCase();
      if (view === "mgr") which = "public"; else if (view === "dev") which = "dev";
      const csv = which === "public" ? csvFor("PUBLIC", agg.public) : which === "dev" ? csvFor("DEV", agg.dev) : (csvFor("PUBLIC", agg.public) + "\n\n" + csvFor("DEV", agg.dev));
      return new Response(csv, { headers: cors({ "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=d360-usage.csv" }) });
    }

    // ── dashboard pages (/report, /admin, /manager, /dev) ──
    if (PATHS[p]) {
      const cookies = parseCookies(request);
      // one-time ?token= link → move into cookie, strip from URL via redirect (password never lingers)
      const urlToken = url.searchParams.get("token");
      if (urlToken && authRole(urlToken, env)) {
        return new Response(null, { status: 303, headers: { "Location": p, "Set-Cookie": setCookie(SESSION, urlToken, 60 * 60 * 12) } });
      }
      const role = authRole(cookies[SESSION] || "", env);
      if (!role) return new Response(loginHtml("", p, PATHS[p].label), { status: 401, headers: { "Content-Type": "text/html" } });
      const view = effectiveView(PATHS[p].view, role);
      if (!view) return new Response(loginHtml("This account can't access that dashboard.", p, PATHS[p].label), { status: 403, headers: { "Content-Type": "text/html" } });
      if (!env.FIREBASE_SA) return new Response("Not configured: set the FIREBASE_SA secret (service-account JSON).", { status: 500, headers: cors() });

      let agg;
      try {
        const at = await getAccessToken(env.FIREBASE_SA);
        const rows = await readAllDocs(at);
        agg = aggregate(rows);
      } catch (e) { return new Response("Read failed: " + String(e && e.message || e).slice(0, 300), { status: 502, headers: cors() }); }

      const nowIso = new Date().toISOString();
      const csvHref = p === "/report" ? "/report.csv" : p + ".csv";
      const html = pageHtml(agg, { view, nowIso, csvHref });
      // no-store so the browser always re-fetches live numbers (and never caches a signed-in page)
      return new Response(html, { headers: cors({ "Content-Type": "text/html", "Cache-Control": "no-store" }) });
    }

    // anything else → the generic dashboard (login if not signed in)
    return new Response(null, { status: 303, headers: { "Location": "/report" } });
  }
};
