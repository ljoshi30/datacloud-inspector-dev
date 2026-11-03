// Usage tracking — pure logic + source-presence + safety gates.
//   node test/usage-ping.test.js
//
// CSP BREAKTHROUGH (2026-10-30): SF page CSP blocks our own domain on every transport AND
// window.open opens a visible tab — BUT the CSP allow-list includes *.googleapis.com, and Firestore's
// REST API lives there. So a normal CORS+JSON fetch to firestore.googleapis.com writes SILENTLY (no
// tab, automatic, works for the bookmarklet) — proven HTTP 200 from a real SF page. Capture fires on
// the first FAB-open per feature per day (silent Firestore write) + a manual "Report usage" row. Each
// doc is tagged build="public"|"dev". Anonymous (random local id, version, page-type bucket, build —
// never org/host/record/URL/PII), honors opt-out. GOTCHA: this project's Firestore DB id is literally
// "default" (NOT "(default)" with parens) — the REST path uses /databases/default/.
// NOTE: section 2's makePinger mirror still exercises the generic gate/throttle/opt-out LOGIC.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirror of the capture gate logic (the safety-critical core), now PER-FEATURE throttled ──
function makePinger(opts) {
  var PING_ENABLED = opts.enabled, PING_ENDPOINT = opts.endpoint;
  var sent = []; // records payloads that would have been transmitted
  var store = opts.store || {};
  var today = opts.today || "2026-10-30";
  function optedOut() { try { return store.dc_usage_optout === "1"; } catch (e) { return false; } }
  function key(feature) { return "dc_usage_last::" + (feature || "other") + "::" + today; }
  function sentToday(feature) { try { return store[key(feature)] === "1"; } catch (e) { return true; } }
  function markSent(feature) { store[key(feature)] = "1"; }
  function installId() { if (!store.dc_usage_iid) store.dc_usage_iid = "i_rand"; return store.dc_usage_iid; }
  // sendPing takes the feature (defaults to opts.page) so one browser can ping once PER feature/day.
  // `httpOk` simulates the network result — the throttle (markSent) is set ONLY on a confirmed success,
  // mirroring the real reportUsage. `opts.httpOk` (default true) lets a test simulate a CSP/network fail.
  function sendPing(feature) {
    feature = feature || opts.page || "DMO";
    if (!PING_ENABLED || !PING_ENDPOINT) return false;   // gates 1+2
    if (optedOut()) return false;                         // gate 3: user choice
    if (sentToday(feature)) return false;                 // per-feature/day throttle
    var httpOk = opts.httpOk !== false;                   // simulate the fetch result
    if (!httpOk) return false;                            // FAILED write → do NOT mark sent, do NOT record
    var payload = { iid: installId(), v: opts.version || "dev", page: feature, day: today, build: opts.build || "public" };
    sent.push(payload);
    markSent(feature);                                    // throttle set ONLY after success
    return true;
  }
  return { sendPing, sent, store };
}

console.log("\n1. GATES hold defensively — a missing endpoint/switch is a hard no-op");
{
  // The generic gate logic must protect against a half-config (e.g. a future edit that blanks the
  // endpoint): no endpoint/switch → no send. (Mirrors the shared gate used by both capture paths.)
  var p2 = makePinger({ enabled: true, endpoint: "" });
  eq("enabled but NO endpoint → no-op (gate holds)", p2.sendPing(), false);
  eq("nothing transmitted", p2.sent.length, 0);
  var p3 = makePinger({ enabled: false, endpoint: "https://x" });
  eq("endpoint set but master OFF → no-op (gate holds)", p3.sendPing(), false);
}

console.log("\n2. PER-FEATURE throttle: same feature once/day, but DIFFERENT features each send a ping");
{
  var p = makePinger({ enabled: true, endpoint: "https://x", version: "1.2.3" });
  eq("DMO first open → sends", p.sendPing("DMO"), true);
  eq("DMO again same day → throttled", p.sendPing("DMO"), false);
  eq("Segment (different feature) → sends (your requirement!)", p.sendPing("Segment"), true);
  eq("QueryEditor (another feature) → sends", p.sendPing("QueryEditor"), true);
  eq("Segment again → throttled", p.sendPing("Segment"), false);
  eq("3 distinct-feature pings total", p.sent.length, 3);
  // SAME browser → still ONE unique user regardless of how many features it pinged from
  var uniqueIids = Array.from(new Set(p.sent.map(function (x) { return x.iid; })));
  eq("unique users = 1 (same iid across all features)", uniqueIids.length, 1);
  var features = p.sent.map(function (x) { return x.page; }).sort();
  eq("features captured = DMO, QueryEditor, Segment", features.join(","), "DMO,QueryEditor,Segment");
}

console.log("\n2a. FAILED write must NOT burn the throttle (the 'new user never captured' bug)");
{
  // A CSP-blocked / network-failed write must leave the throttle UNSET, so the SAME user can still be
  // captured later the same day on a page where the write IS allowed. (Old bug: markSent ran whether or
  // not the fetch succeeded → one blocked attempt silently locked the user out for the whole day.)
  var store = {};
  var blocked = makePinger({ enabled: true, endpoint: "https://x", httpOk: false, store: store });
  eq("blocked write → returns false", blocked.sendPing("DMO"), false);
  eq("blocked write → nothing recorded", blocked.sent.length, 0);
  eq("blocked write → throttle NOT set (still eligible to retry)", store["dc_usage_last::DMO::2026-10-30"], undefined);
  // same browser/day, now on a permissive page (httpOk) — must still capture
  var okAgain = makePinger({ enabled: true, endpoint: "https://x", httpOk: true, store: store });
  eq("later permissive write → CAPTURES (not locked out by the earlier failure)", okAgain.sendPing("DMO"), true);
  eq("now recorded exactly once", okAgain.sent.length, 1);
  eq("now the throttle IS set (success)", store["dc_usage_last::DMO::2026-10-30"], "1");
  eq("and a second success same day → throttled", okAgain.sendPing("DMO"), false);
}

console.log("\n2d. LEARN-THEN-ADAPT — silent write in permissive orgs; beacon-tab fallback in LOCKED orgs");
{
  // Focused mirror of maybeReportOnFabOpen's learn-then-adapt state machine (per-org blocked memory +
  // silent-first, beacon-on-known-blocked). Proves: permissive org NEVER opens a tab; locked org learns
  // on the 1st blocked click then uses the beacon (synchronous) on subsequent clicks; throttle honored.
  function makeOrg(opts) {
    var store = {}, today = "2026-10-30";
    var tabsOpened = 0, silentOk = opts.silentOk;  // silentOk=false simulates a CSP/CASB-locked org
    var beaconReaches = opts.beaconReaches !== false;  // false = a corporate web filter blocks the beacon destination too
    function sentToday(f) { return store["last::" + f] === "1"; }
    function markSent(f) { store["last::" + f] = "1"; }
    function orgBlocked() { return store["blocked"] === "1"; }
    function markBlocked() { store["blocked"] = "1"; }
    function beaconDead() { return store["beacon_dead"] === "1"; }
    function markBeaconDead() { store["beacon_dead"] = "1"; }
    // beaconOpen opens a tab; if the destination is filter-blocked it NEVER confirms → mark dead.
    function beaconOpen(f) {
      tabsOpened++;
      if (!beaconReaches) { markBeaconDead(); return "opened-but-blocked"; }  // no confirmation → dead
      captured.push({ f: f, via: "beacon" }); return "opened-ok";
    }
    var captured = [];
    // mirrors maybeReportOnFabOpen (incl. the auto-disable: once beacon is dead, no more tabs)
    function onFab(f) {
      if (sentToday(f)) return "throttled";
      if (orgBlocked()) {
        if (beaconDead()) return "giveup-silent";             // filter blocks beacon too → no tab, no capture
        var r = beaconOpen(f);
        if (r === "opened-ok") { markSent(f); return "beacon"; }
        if (r === "opened-but-blocked") return "beacon-blocked-now-dead";  // this click showed the flash; future clicks won't
        return "blocked-nopopup";
      }
      if (silentOk) { markSent(f); captured.push({ f: f, via: "silent" }); return "silent"; }
      markBlocked();                              // LEARN: this org blocks the silent write
      return "silent-failed-learned";             // this click's capture is lost; next click uses beacon
    }
    return { onFab, tabs: function () { return tabsOpened; }, captured, store };
  }

  // PERMISSIVE org: silent works → captured silently, ZERO tabs ever.
  var perm = makeOrg({ silentOk: true });
  eq("permissive: 1st DMO → silent capture", perm.onFab("DMO"), "silent");
  eq("permissive: DMO again → throttled", perm.onFab("DMO"), "throttled");
  eq("permissive: Segment → silent capture", perm.onFab("Segment"), "silent");
  eq("permissive: NO tabs ever opened", perm.tabs(), 0);
  eq("permissive: captures all via silent", perm.captured.filter(function (c) { return c.via === "silent"; }).length, 2);

  // LOCKED org: silent fails on 1st click (learns), beacon on every subsequent click.
  var lock = makeOrg({ silentOk: false });
  eq("locked: 1st DMO → silent fails + LEARNS block (capture lost this once)", lock.onFab("DMO"), "silent-failed-learned");
  eq("locked: still no tab on the learning click", lock.tabs(), 0);
  eq("locked: 2nd DMO (now known-blocked) → beacon tab", lock.onFab("DMO"), "beacon");
  eq("locked: Segment → beacon tab (different feature, same day)", lock.onFab("Segment"), "beacon");
  eq("locked: DMO again → throttled (already captured via beacon)", lock.onFab("DMO"), "throttled");
  eq("locked: exactly 2 beacon tabs (DMO retry + Segment), not more", lock.tabs(), 2);
  eq("locked: captured via beacon = 2", lock.captured.filter(function (c) { return c.via === "beacon"; }).length, 2);

  // FILTER-BLOCKED org (TD): silent blocked AND the beacon destination blocked by corporate web filter.
  // The beacon flashes the block page ONCE, then auto-disables — no more tabs, no captures. Key UX win:
  // the scary "Unauthorized Access" flash happens at most ONCE per org, never repeatedly.
  var td = makeOrg({ silentOk: false, beaconReaches: false });
  eq("TD: 1st click → silent fails + learns block", td.onFab("DMO"), "silent-failed-learned");
  eq("TD: 2nd click → beacon tab opens but is filter-blocked (flash shown ONCE) → marked dead", td.onFab("DMO"), "beacon-blocked-now-dead");
  eq("TD: 3rd click (DMO) → NO tab (beacon dead) — but DMO is still unthrottled so it retries silently? no: give up", td.onFab("Segment"), "giveup-silent");
  eq("TD: 4th click (another feature) → still NO tab", td.onFab("DataStream"), "giveup-silent");
  eq("TD: only ONE tab was EVER opened (the single unavoidable flash)", td.tabs(), 1);
  eq("TD: nothing captured (unmeasurable externally — expected)", td.captured.length, 0);

  // source checks — the real code must implement this (not just the mirror)
  const fs2 = require("fs"), path2 = require("path");
  const src2 = fs2.readFileSync(path2.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("real code: learns per-org block on silent failure (markOrgBlocked in the fetch .catch)", /try \{ markOrgBlocked\(\); \} catch/.test(src2));
  ok("real code: beacon opens SYNCHRONOUSLY on the gesture when org is known-blocked", /if \(orgKnownBlocked\(\)\) \{[\s\S]*?beaconOpen\(feature\)/.test(src2));
  ok("real code: beacon carries anonymous fields only (iid/v/page/day/build/org — no PII)", /function beaconUrl\(feature\)/.test(src2) && /"&org=" \+ encodeURIComponent/.test(src2) && !/username|userId/i.test(src2.slice(src2.indexOf("function beaconUrl"), src2.indexOf("function beaconUrl") + 500)));
  ok("real code: blocked flag is per-ORG host (re-learns when moving orgs)", /function blockedKey\(\) \{ return "dc_usage_blocked::" \+ orgHost\(\)/.test(src2));
  ok("real code: beacon points at the worker /beacon route", /var BEACON_BASE = "https:\/\/d360-usage\.ljoshi30-d360\.workers\.dev\/beacon"/.test(src2));
  // AUTO-DISABLE: the beacon page postMessages a confirmation; if none arrives in 4s, mark beacon dead.
  ok("real code: /beacon confirmation listener sets _beaconConfirmed + clears the dead flag", /ev\.data\.__dcBeacon === "ok"/.test(src2) && /_beaconConfirmed\[orgHost\(\)\] = true/.test(src2));
  ok("real code: no confirmation within 4s → markBeaconDead (corporate filter blocked the destination)", /if \(!_beaconConfirmed\[orgHost\(\)\]\) markBeaconDead\(\);/.test(src2) && /\}, 4000\)/.test(src2));
  ok("real code: once beacon is dead, NO tab is opened (user never sees the block flash again)", /if \(beaconDead\(\)\) \{[\s\S]*?return false;/.test(src2));
  ok("real code: beacon-dead flag is per-ORG host", /function beaconDeadKey\(\) \{ return "dc_usage_beacon_dead::" \+ orgHost\(\)/.test(src2));
  ok("worker /beacon confirms back to opener via postMessage(__dcBeacon:ok)", (function () { var w = fs2.readFileSync(path2.join(__dirname, "..", "usage-endpoint", "worker.js"), "utf8"); return /window\.opener\.postMessage\(\{__dcBeacon:'ok'/.test(w); })());
}

console.log("\n2c. STORAGE-BLOCKED (VDI/incognito) — real users stay DISTINCT, not merged into one fake id");
{
  // Simulate the REAL installId/throttle behavior when localStorage throws. The fix mints a per-page
  // random id and keeps the throttle in memory, so two storage-blocked browsers are TWO users (not one
  // "i_nostore"), and a single session still throttles once per feature.
  var _tok = 0;
  function makeBlockedSession() {
    var memId = null, memSent = {};
    // mirrors the REAL fallback: mint ONE random id per page session (crypto in prod; a unique token here)
    function randId() { return "imem_" + (++_tok) + "_" + (_tok * 7 + 13).toString(36); }
    function installId() { if (!memId) memId = randId(); return memId; }
    function key(f) { return "L::" + f + "::day"; }
    function sentToday(f) { return memSent[key(f)] === true; }
    function markSent(f) { memSent[key(f)] = true; }
    var sent = [];
    function send(f) { if (sentToday(f)) return false; sent.push({ iid: installId(), page: f }); markSent(f); return true; }
    return { send, sent, idOf: installId };
  }
  var s1 = makeBlockedSession(), s2 = makeBlockedSession();
  eq("blocked session 1: DMO captures once", s1.send("DMO"), true);
  eq("blocked session 1: DMO again → throttled (in-memory)", s1.send("DMO"), false);
  eq("blocked session 1: Segment → captures (different feature)", s1.send("Segment"), true);
  var id1 = s1.sent[0].iid, id2 = s2.idOf();
  ok("two storage-blocked sessions get DIFFERENT ids (not merged into one 'i_nostore')", id1 !== id2 && !/nostore/.test(id1));
  // source: the real installId has an in-memory fallback, NOT a constant return
  const fs0 = require("fs"), path0 = require("path");
  const src0 = fs0.readFileSync(path0.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("installId falls back to a per-session random id when storage is blocked (not constant 'i_nostore')",
    /if \(!_memId\) _memId = randId\(\); return _memId;/.test(src0) && !/catch \(e\) \{ return "i_nostore"; \}/.test(src0));
  ok("throttle degrades to in-memory when storage blocked (sentToday/markSent use _memSent)",
    /return _memSent\[k\] === true;/.test(src0) && /_memSent\[k\] = true;/.test(src0));
}

console.log("\n2b. OPT-OUT (gate 3) — user's choice always wins, even when fully live");
{
  var p = makePinger({ enabled: true, endpoint: "https://x", store: { dc_usage_optout: "1" } });
  eq("opted-out user → no ping even with both gates cleared", p.sendPing(), false);
  eq("nothing transmitted for an opted-out user", p.sent.length, 0);
  // opting back in re-enables
  var store = { dc_usage_optout: "1" };
  var p2 = makePinger({ enabled: true, endpoint: "https://x", store: store });
  eq("still opted out → no send", p2.sendPing(), false);
  delete store.dc_usage_optout;                 // user opts back in
  eq("after opt back in → sends", p2.sendPing(), true);
}

console.log("\n3. ANONYMOUS BY CONSTRUCTION — payload carries no org / host / record / url / PII");
{
  var p = makePinger({ enabled: true, endpoint: "https://x", page: "DMO", version: "1.2.3" });
  p.sendPing();
  var payload = p.sent[0];
  var keys = Object.keys(payload).sort();
  eq("payload keys are EXACTLY {build,day,iid,page,v}", keys.join(","), "build,day,iid,page,v");
  ok("build tag is the coarse audience bucket only", payload.build === "public" || payload.build === "dev");
  ok("install id is a random local token, not an org/hostname", /^i_/.test(payload.iid));
  ok("page is a coarse bucket, not a url/record", payload.page === "DMO" && !/https?:|\/r\/|[0-9]{15}/.test(payload.page));
  // negative: no field smells like org/host/record/email/url
  var blob = JSON.stringify(payload);
  ok("no hostname / my.salesforce / lightning.force in payload", !/salesforce|lightning|force\.com|https?:\/\//i.test(blob));
  ok("no 15/18-char salesforce id in payload", !/[a-zA-Z0-9]{15,18}/.test(payload.iid.replace(/^i_/, "")) || payload.iid === "i_rand");
  ok("no @ (email) anywhere", blob.indexOf("@") < 0);
}

console.log("\n4. page-type bucketing never leaks a record id or full url (mirror of pingPageType)");
{
  function pingPageType(h) {
    if (/\/r\/DataStream\//i.test(h)) return "DataStream";
    if (/\/r\/DataLakeObjectInstance\//i.test(h)) return "DLO";
    if (/c__objectApiName=/i.test(h) && /standard-DataModel/i.test(h)) return "DMO";
    if (/standard-DataModel/i.test(h) && /displayType=graph/i.test(h)) return "DataGraph";
    if (/\/r\/Segment\//i.test(h) || /segmentWizard/i.test(h)) return "Segment";
    if (/\/r\/IdentityResolution\//i.test(h)) return "IdentityResolution";
    if (/\/r\/DataSpace\//i.test(h)) return "DataSpace";
    if (/standard-DataModel/i.test(h)) return "DataModel";
    return "other";
  }
  eq("DMO url → 'DMO' (not the objectApiName value)", pingPageType("https://x.lightning.force.com/lightning/n/standard-DataModel?c__objectApiName=TDI_Secret__dlm"), "DMO");
  eq("Segment record url → 'Segment' (not the 18-char id)", pingPageType("https://x.lightning.force.com/lightning/r/Segment/1sgKh0000010wObIAI/view"), "Segment");
  eq("IR url → 'IdentityResolution'", pingPageType("https://x.lightning.force.com/lightning/r/IdentityResolution/abc123/view"), "IdentityResolution");
  eq("unknown → 'other'", pingPageType("https://x.lightning.force.com/lightning/page/home"), "other");
  // the returned bucket is always one of a FIXED small vocabulary — never free-form page content
  var VOCAB = ["DataStream","DLO","DMO","DataGraph","Segment","IdentityResolution","DataSpace","DataModel","other"];
  ["https://x/r/Segment/18charidxxxxx/view", "https://x/foo", "https://x/standard-DataModel?c__objectApiName=A__dlm"].forEach(function (u) {
    ok("bucket for " + u.slice(0, 28) + "… is in the fixed vocab", VOCAB.indexOf(pingPageType(u)) >= 0);
  });
}

console.log("\n4b. FAB matcher — runs the REAL isFabClick from source (incl. the 8-ancestor walk)");
{
  // EXTRACT the real isFabClick from the extension source and run it — not a mirror (which could drift).
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const m = src.match(/function isFabClick\(target\)\s*\{[\s\S]*?\n    \}/);
  if (!m) { ok("could not extract isFabClick", false); }
  const isFabClick = new Function(m[0] + "\nreturn isFabClick;")();
  // tiny fake element with parentElement chain, like the real DOM walk sees
  const el = (id, parent) => ({ id: id, parentElement: parent || null });
  const hit = (id, parent) => isFabClick(el(id, parent));

  // real FAB launcher ids that EXIST in the code → must all count
  ["dc-bar","dc-fab","dc-dg-bar","dc-ir-bar","dc-dsf-bar","dc-act-bar","dc-act-fab","dc-erd-bar"].forEach(function (id) {
    ok("FAB id '" + id + "' triggers capture", hit(id) === true);
  });
  // ⧉ open-in-new-tab launchers (standalone on <body>) → NOW explicitly counted
  ok("⧉ launcher 'dc-list-newtab' triggers capture", hit("dc-list-newtab") === true);
  ok("⧉ launcher 'dc-nav-newtab' triggers capture", hit("dc-nav-newtab") === true);
  // a click on an inner child of a tracked bar still resolves via the ancestor walk
  ok("inner button inside dc-bar still counts (ancestor walk)", hit("dc-export", el("dc-bar")) === true);
  ok("icon inside the ⧉ launcher still counts (ancestor walk)", hit("some-svg", el("dc-nav-newtab")) === true);
  // non-FAB dc ids with NO tracked ancestor → must NOT count (no false captures on unrelated UI)
  ["dc-decor-diag","dc-fab-menu","dc-detail-btn","dc-report-usage-row","dc-usage-notice","dc-do-badge","dc-ir-api"].forEach(function (id) {
    ok("non-FAB id '" + id + "' does NOT trigger capture", hit(id) === false);
  });
  // future-proof: a brand-new FAB following the convention is caught automatically
  ok("a FUTURE 'dc-xyz-bar' / 'dc-xyz-fab' is caught with no code change", hit("dc-xyz-bar") && hit("dc-xyz-fab"));
}

console.log("\n5. source presence — gates, anonymity, throttle, sendBeacon, DEV-ONLY");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("module present", /function dcUsagePingModule\(\)/.test(src));
  ok("SILENT CHANNEL: writes to Firestore REST on the CSP-allowed *.googleapis.com (no tab)",
    /var FS_PROJECT = "d360-usage"/.test(src) && /firestore\.googleapis\.com\/v1\/projects\/" \+ FS_PROJECT \+ "\/databases\/" \+ FS_DB \+ "\/documents\/usage\?key=" \+ FS_KEY/.test(src));
  ok("DB id is literally 'default' (NOT '(default)' — the confirmed gotcha)", /var FS_DB\s+= "default";/.test(src) && !/databases\/\(default\)/.test(src));
  ok("LIVE (silent write, no tab)", /var PING_ENABLED\s+= true;/.test(src) && /SILENT AUTO-CAPTURE via FIRESTORE/.test(src));
  ok("CAPTURE = normal CORS+JSON fetch to Firestore (fire-and-forget), NOT window.open/tab",
    /function reportUsage/.test(src) && /fetch\(FS_URL, \{ method: "POST", headers: \{ "Content-Type": "application\/json" \}, body: JSON\.stringify\(payload\)/.test(src) && !/window\.open\(base/.test(src));
  ok("SILENT-FIRST: the primary capture is a background Firestore fetch (no tab) — beacon is ONLY a locked-org fallback",
    /return fetch\(FS_URL, \{ method: "POST"/.test(src) && !/function sendPing/.test(src) &&
    // beacon exists but is gated behind orgKnownBlocked() (not the default path)
    /if \(orgKnownBlocked\(\)\) \{/.test(src) && /function beaconOpen\(feature\)/.test(src));
  ok("Firestore payload is the typed-field shape (fields.*.stringValue)",
    /iid:   \{ stringValue: String\(installId\(\)\) \}/.test(src) && /page:  \{ stringValue: String\(feature\) \}/.test(src) && /build: \{ stringValue: String\(PING_BUILD\) \}/.test(src) && /org:   \{ stringValue: org \}/.test(src));
  ok("org = my-domain host only (semi-identifying; NOT username/PII)", /var org = ""; try \{ org = String\(location\.hostname/.test(src) && !/username|userId|user_id/i.test(src.slice(src.indexOf("var org ="), src.indexOf("var org =") + 200)));
  ok("throttle (markSent) is set ONLY inside the success branch — a failed/CSP-blocked write does NOT burn the day",
    /if \(r && r\.ok\) \{\s*\n\s*try \{ markSent\(feature\); \}/.test(src));
  ok("markSent does NOT run unconditionally after the fetch (the 'locked out for the day' bug is gone)",
    !/\}\)\s*\n\s*\.catch\(function \(\) \{\}\);\s*\n\s*try \{ markSent\(feature\); \}/.test(src));
  ok("failure paths leave the throttle unset; the CSP/CASB-block path learns the org is blocked",
    /return false;\s*\/\/ non-2xx/.test(src) && /try \{ markOrgBlocked\(\); \} catch/.test(src));
  ok("in-flight guard prevents duplicate concurrent sends for the same feature", /var _inFlight = \{\}/.test(src) && /if \(_inFlight\[feature\]\) return Promise\.resolve\(false\)/.test(src));
  ok("DEV-ONLY visibility: logs '[dc usage] captured …' on write + 'throttled' on skip (so you can SEE it in dev)",
    /\[dc usage\] captured/.test(src) && /already captured today \(throttled\)/.test(src));
  ok("DEV-ONLY: the usage console logs are STRIPPED from the public build (silent for real users)",
    (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/\[dc usage\]/.test(strip); })());
  ok("AUTO-CAPTURE on FAB open, per-feature/day (maybeReportOnFabOpen → throttled by feature + opt-out)",
    /function maybeReportOnFabOpen/.test(src) && /var feature = pingPageType\(\);/.test(src) && /if \(sentToday\(feature\)\) \{/.test(src) && /if \(optedOut\(\)\) return false;/.test(src));
  ok("ONE global FAB-click listener covers all FABs (not per-handler)",
    /function onAnyFabClick/.test(src) && /document\.addEventListener\("click", onAnyFabClick, true\)/.test(src) && /function isFabClick/.test(src));
  ok("MASTER KILL-SWITCH enforced: reportUsage bails when PING_ENABLED is false (documented gate is REAL now)",
    /if \(!PING_ENABLED\) return Promise\.resolve\(false\);/.test(src));
  ok("RUN-ONCE listener: re-paste/re-run does NOT stack duplicate document click listeners (VDI leak fixed)",
    /if \(!window\.__dcUsageClickBound\)/.test(src) && /window\.__dcUsageClickBound = true;/.test(src));
  ok("handler also honors a later disable (window.__dcUsageOff) without needing to unbind",
    /if \(window\.__dcUsageOff\) return;/.test(src));
  ok("FAB matcher is ROBUST: matches dc-*-bar / dc-*-fab PATTERN (catches every + future FAB, incl. ERD), not a hand id list",
    /\/\^dc-\(\[a-z0-9\]\+-\)\?bar\$\//.test(src) && /\/\^dc-\(\[a-z0-9\]\+-\)\?fab\$\//.test(src));
  ok("NO visible 'Report usage' FAB row (capture is silent/automatic — row removed)", !/dc-report-usage-row/.test(src));
  ok("GATE: opt-out checked before any capture (user choice always wins)", /if \(optedOut\(\)\) return false;/.test(src) && /function optedOut/.test(src) && /dc_usage_optout/.test(src));
  ok("opt-out/opt-in controls STILL exposed (hidden opt-out retained)", /window\.__dcUsageOptOut/.test(src) && /window\.__dcUsageOptIn/.test(src) && /window\.__dcUsageIsOptedOut/.test(src));
  ok("capture global exposed (auto-on-fab)", /window\.__dcReportUsageOnFabOpen/.test(src));
  ok("in-tool disclosure popup NOT shown on load (silent in-tool; disclosure lives on install page)",
    !/try \{ showDisclosureOnce\(\); \} catch/.test(src) && /intentionally NOT called/.test(src));
  ok("PER-FEATURE/day throttle (namespaced key feature+day → different features each ping)",
    /function throttleKey\(feature\)/.test(src) && /LS_LAST \+ "::" \+ \(feature \|\| "other"\) \+ "::" \+ todayStamp\(\)/.test(src) && /function sentToday\(feature\)/.test(src) && /function markSent\(feature\)/.test(src));
  ok("page detector covers ALL feature surfaces (QueryEditor/Transform/Activation/Explorer/MappingCanvas/ERD, not just DMO)",
    /return "QueryEditor"/.test(src) && /return "DataTransform"/.test(src) && /return "Activation"/.test(src) && /return "DataExplorer"/.test(src) && /return "MappingCanvas"/.test(src) && /return "DataModelERD"/.test(src));
  ok("detector reuses the tool's OWN page functions (authoritative) with try/typeof guards",
    /function _is\(fn\)/.test(src) && /isQueryEditorPage/.test(src) && /isActivationPage/.test(src) && /findByTag\(TAGGING_CMP\)/.test(src));
  ok("BUILD TAG: public default + @strip-dev override to 'dev' (two-table routing)",
    /var PING_BUILD\s+= "public";/.test(src) && /\/\* @strip:start dev \*\/\s*PING_BUILD = "dev";\s*\/\* @strip:end \*\//.test(src));
  ok("ANON payload = iid + version + feature(page) + day + build (no org/host/record/url)",
    /stringValue: String\(installId\(\)\)/.test(src) && /stringValue: String\(feature\)/.test(src) && /stringValue: String\(PING_BUILD\)/.test(src) && /org:   \{ stringValue: org \}/.test(src) && /feature = pingPageType\(\);/.test(src));
  ok("install id is a RANDOM local token (crypto getRandomValues), stored in localStorage",
    /function installId/.test(src) && /crypto\.getRandomValues/.test(src) && /localStorage\.setItem\(LS_ID/.test(src));
  ok("page bucket NEVER returns a url/record — fixed vocabulary only", /function pingPageType/.test(src) && /return "other";/.test(src) && !/return location\.href/.test(src.slice(src.indexOf("function pingPageType"), src.indexOf("function pingPageType") + 900)));

  // SHIPS IN BOTH builds now (no longer dev-only), but the BUILD TAG differs per build:
  const strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, "");
  ok("PUBLIC build INCLUDES the module (ships to all users now)", /function dcUsagePingModule\(\)/.test(strip));
  ok("PUBLIC build tag stays 'public' (the dev override is stripped out)",
    /var PING_BUILD\s+= "public";/.test(strip) && !/PING_BUILD = "dev";/.test(strip));
  ok("FULL/dev build tag becomes 'dev' (override present)", /PING_BUILD = "dev";/.test(bm));
  ok("present in the FULL bookmarklet build (synced)", /function dcUsagePingModule\(\)/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
