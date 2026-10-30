// Usage tracking — pure logic + source-presence + safety gates.
//   node test/usage-ping.test.js
//
// CSP REALITY (2026-10-30): Salesforce page CSP blocks ALL silent in-page transports to our domain
// (fetch/sendBeacon via connect-src, image via img-src, iframe via frame-src/sandbox — all tested,
// all blocked). So the silent auto-ping is DISABLED. The ONLY channel that survives CSP is a
// USER-INITIATED navigation (window.open → our /beacon page, which runs under OUR origin). So usage
// is captured: (a) automatically on the user's FIRST FAB-open each day (throttled once/day), and
// (b) via a manual "Report usage" FAB row. Each capture is tagged build="public"|"dev" → separate
// tables. Anonymous by construction (random local id, version, page-type bucket, build — never
// org/host/record/URL/PII), honors opt-out. This test LOCKS those safety properties.
// NOTE: section 2's makePinger mirror still exercises the generic gate/throttle/opt-out LOGIC.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirror of sendPing's gate logic (the safety-critical core) ──
function makePinger(opts) {
  var PING_ENABLED = opts.enabled, PING_ENDPOINT = opts.endpoint;
  var sent = []; // records payloads that would have been transmitted
  var store = opts.store || {};
  var today = opts.today || "2026-10-30";
  function optedOut() { try { return store.dc_usage_optout === "1"; } catch (e) { return false; } }
  function sentToday() { try { return store.dc_usage_last === today; } catch (e) { return true; } }
  function markSent() { store.dc_usage_last = today; }
  function pageType() { return opts.page || "DMO"; }
  function installId() { if (!store.dc_usage_iid) store.dc_usage_iid = "i_rand"; return store.dc_usage_iid; }
  function sendPing() {
    if (!PING_ENABLED || !PING_ENDPOINT) return false;   // gates 1+2
    if (optedOut()) return false;                         // gate 3: user choice
    if (sentToday()) return false;                        // throttle
    var payload = { iid: installId(), v: opts.version || "dev", page: pageType(), day: today, build: opts.build || "public" };
    sent.push(payload);
    markSent();
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

console.log("\n2. WHEN fully enabled (both gates cleared) it sends ONCE, then throttles for the day");
{
  var p = makePinger({ enabled: true, endpoint: "https://x", page: "Segment", version: "1.2.3" });
  eq("first call sends", p.sendPing(), true);
  eq("one payload", p.sent.length, 1);
  eq("second call same day → throttled", p.sendPing(), false);
  eq("still one payload (once/day)", p.sent.length, 1);
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

console.log("\n4b. FAB matcher (mirror of isFabClick) — every dc FAB counts, non-FABs don't");
{
  // mirror the two patterns in isFabClick
  function isFabId(id) { return /^dc-([a-z0-9]+-)?bar$/.test(id) || /^dc-([a-z0-9]+-)?fab$/.test(id); }
  // real FAB launcher ids that EXIST in the code → must all count
  ["dc-bar","dc-fab","dc-dg-bar","dc-ir-bar","dc-dsf-bar","dc-act-bar","dc-act-fab","dc-erd-bar"].forEach(function (id) {
    ok("FAB id '" + id + "' triggers capture", isFabId(id) === true);
  });
  // non-FAB dc ids → must NOT count (no false captures on unrelated UI)
  ["dc-decor-diag","dc-fab-menu","dc-detail-btn","dc-report-usage-row","dc-usage-notice","dc-do-badge","dc-ir-api"].forEach(function (id) {
    ok("non-FAB id '" + id + "' does NOT trigger capture", isFabId(id) === false);
  });
  // future-proof: a brand-new FAB following the convention is caught automatically
  ok("a FUTURE 'dc-xyz-bar' / 'dc-xyz-fab' is caught with no code change", isFabId("dc-xyz-bar") && isFabId("dc-xyz-fab"));
}

console.log("\n5. source presence — gates, anonymity, throttle, sendBeacon, DEV-ONLY");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("module present", /function dcUsagePingModule\(\)/.test(src));
  ok("endpoint set to the Cloudflare Worker", /var PING_ENDPOINT = "https:\/\/d360-usage\.ljoshi30-d360\.workers\.dev\/ping";/.test(src));
  ok("auto-ping DISABLED (CSP-blocked — documented, not pretended to work)", /var PING_ENABLED\s+= false;/.test(src) && /AUTO-PING DISABLED/.test(src) && /CSP/.test(src));
  ok("CAPTURE CHANNEL = user-click navigation (window.open to /beacon) — survives CSP",
    /function reportUsage/.test(src) && /window\.open\(base \+ "\?" \+ qs/.test(src) && /\/ping\$\/, "\/beacon"/.test(src));
  ok("mark-sent ONLY when the tab actually opened (popup-blocked → retries, doesn't lose the day)",
    /if \(w\) \{ try \{ markSent\(\); \} catch \(e\) \{\} return true; \}/.test(src) && /return false;\s*\/\/ popup-blocked/.test(src));
  ok("AUTO-CAPTURE on FAB open, once/day (maybeReportOnFabOpen → throttled + opt-out)",
    /function maybeReportOnFabOpen/.test(src) && /if \(sentToday\(\)\) return false;/.test(src) && /if \(optedOut\(\)\) return false;/.test(src));
  ok("ONE global FAB-click listener covers all FABs (not per-handler)",
    /function onAnyFabClick/.test(src) && /document\.addEventListener\("click", onAnyFabClick, true\)/.test(src) && /function isFabClick/.test(src));
  ok("FAB matcher is ROBUST: matches dc-*-bar / dc-*-fab PATTERN (catches every + future FAB, incl. ERD), not a hand id list",
    /\/\^dc-\(\[a-z0-9\]\+-\)\?bar\$\//.test(src) && /\/\^dc-\(\[a-z0-9\]\+-\)\?fab\$\//.test(src));
  ok("manual 'Report usage' FAB row wired, hidden when opted out",
    /dc-report-usage-row/.test(src) && /typeof window\.__dcReportUsage === "function"/.test(src) && /window\.__dcUsageIsOptedOut\(\)/.test(src));
  ok("GATE 3: opt-out checked before any capture (user choice always wins)", /if \(optedOut\(\)\) return false;/.test(src) && /function optedOut/.test(src) && /dc_usage_optout/.test(src));
  ok("opt-out/opt-in controls exposed for the user", /window\.__dcUsageOptOut/.test(src) && /window\.__dcUsageOptIn/.test(src) && /window\.__dcUsageIsOptedOut/.test(src));
  ok("capture globals exposed (manual + auto-on-fab)", /window\.__dcReportUsage\b/.test(src) && /window\.__dcReportUsageOnFabOpen/.test(src));
  ok("ONE-TIME disclosure notice, shown when endpoint set + not opted out", /function showDisclosureOnce/.test(src) && /if \(!PING_ENDPOINT\) return;/.test(src) && /if \(optedOut\(\)\) return;/.test(src) && /dc_usage_noticed/.test(src));
  ok("disclosure wording honest (anonymous, no record/field/personal/org data, brief tab) + Turn off", /anonymous<\/b> usage count/i.test(src) && /no record, field, personal, or org data/i.test(src) && /brief tab/i.test(src) && /Turn off/.test(src));
  ok("once-per-day throttle via localStorage day stamp", /function sentToday/.test(src) && /function markSent/.test(src) && /todayStamp\(\)/.test(src));
  ok("BUILD TAG: public default + @strip-dev override to 'dev' (two-table routing)",
    /var PING_BUILD\s+= "public";/.test(src) && /\/\* @strip:start dev \*\/\s*PING_BUILD = "dev";\s*\/\* @strip:end \*\//.test(src));
  ok("ANON payload = iid + version + page bucket + day + build (no org/host/record/url)",
    /iid: installId\(\), v: PING_VERSION, page: pingPageType\(\), day: todayStamp\(\), build: PING_BUILD/.test(src));
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
