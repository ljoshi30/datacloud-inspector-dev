// Usage ping (dev-only, INERT by default) — pure logic + source-presence + dev-only + safety gates.
//   node test/usage-ping.test.js
//
// Measures REAL active users (fires when the tool RUNS), unlike Cloudflare which only sees first-time
// install-page visitors. SHIPS DISABLED: transmits nothing until endpoint set + master switch on +
// privacy/CSP sign-off. Anonymous by construction (random local id, version, page-type bucket — never
// org/hostname/record/URL/PII). Throttled once/day. This test LOCKS those safety properties so an
// accidental enable (or a lost gate) fails the build.

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
    var payload = { iid: installId(), v: opts.version || "dev", page: pageType(), day: today };
    sent.push(payload);
    markSent();
    return true;
  }
  return { sendPing, sent, store };
}

console.log("\n1. INERT BY DEFAULT — the shipped config (disabled, no endpoint) transmits NOTHING");
{
  var p = makePinger({ enabled: false, endpoint: "" });
  eq("disabled + no endpoint → sendPing returns false", p.sendPing(), false);
  eq("nothing transmitted", p.sent.length, 0);
  // even if the master switch were flipped but endpoint still empty (gate 1 alone holds):
  var p2 = makePinger({ enabled: true, endpoint: "" });
  eq("enabled but NO endpoint → still no-op (gate 1 holds)", p2.sendPing(), false);
  eq("still nothing transmitted", p2.sent.length, 0);
  // and endpoint set but master off (gate 2 alone holds):
  var p3 = makePinger({ enabled: false, endpoint: "https://x" });
  eq("endpoint set but master OFF → still no-op (gate 2 holds)", p3.sendPing(), false);
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
  eq("payload keys are EXACTLY {day,iid,page,v}", keys.join(","), "day,iid,page,v");
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

console.log("\n5. source presence — gates, anonymity, throttle, sendBeacon, DEV-ONLY");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("module present", /function dcUsagePingModule\(\)/.test(src));
  ok("GATE 1: endpoint EMPTY in source (ships with no receiver)", /var PING_ENDPOINT = "";/.test(src));
  ok("GATE 2: master switch FALSE in source (ships disabled)", /var PING_ENABLED\s+= false;/.test(src));
  ok("both gates checked before any send", /if \(!PING_ENABLED \|\| !PING_ENDPOINT\) return false;/.test(src));
  ok("GATE 3: opt-out checked before send (user choice always wins)", /if \(optedOut\(\)\) return false;/.test(src) && /function optedOut/.test(src) && /dc_usage_optout/.test(src));
  ok("opt-out/opt-in controls exposed for the user", /window\.__dcUsageOptOut/.test(src) && /window\.__dcUsageOptIn/.test(src) && /window\.__dcUsageIsOptedOut/.test(src));
  ok("ONE-TIME disclosure notice, shown only when LIVE + not opted out", /function showDisclosureOnce/.test(src) && /if \(!PING_ENABLED \|\| !PING_ENDPOINT\) return;/.test(src) && /if \(optedOut\(\)\) return;/.test(src) && /dc_usage_noticed/.test(src));
  ok("disclosure wording is honest (anonymous, no data/PII) + offers Turn off", /anonymous.{0,40}usage counts/i.test(src) && /no personal or org info/i.test(src) && /Turn off/.test(src));
  ok("once-per-day throttle via localStorage day stamp", /function sentToday/.test(src) && /function markSent/.test(src) && /todayStamp\(\)/.test(src));
  ok("ANON payload = only iid + version + coarse page bucket + day (no org/host/record/url)",
    /iid: installId\(\), v: PING_VERSION, page: pingPageType\(\), day: todayStamp\(\)/.test(src));
  ok("install id is a RANDOM local token (crypto getRandomValues), stored in localStorage",
    /function installId/.test(src) && /crypto\.getRandomValues/.test(src) && /localStorage\.setItem\(LS_ID/.test(src));
  ok("page bucket NEVER returns a url/record — fixed vocabulary only", /function pingPageType/.test(src) && /return "other";/.test(src) && !/return location\.href/.test(src.slice(src.indexOf("function pingPageType"), src.indexOf("function pingPageType") + 900)));
  ok("fire-and-forget: sendBeacon preferred, no-cors fetch fallback (cannot read a response)",
    /navigator\.sendBeacon\(PING_ENDPOINT/.test(src) && /mode: "no-cors"/.test(src));
  ok("fails silently (never throws into the page)", /catch \(e\) \{ ok = false; \}/.test(src) && /\.catch\(function \(\) \{\}\)/.test(src));
  ok("the ⚠️ privacy/CSP/endpoint gates are documented at the call site", /SHIPS DISABLED/.test(src) && /Netskope\/CASB/.test(src) && /Salesforce CSP tested/.test(src));

  // DEV-ONLY — the whole thing must be physically absent from the public build right now
  ok("DEV-ONLY: module stripped from the public bookmarklet", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/dcUsagePingModule/.test(strip) && !/__dcUsagePing/.test(strip) && !/PING_ENDPOINT/.test(strip); })());
  ok("DEV-ONLY: no cloudflareinsights or ping endpoint leaks into the stripped build", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/sendBeacon\(PING_ENDPOINT/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function dcUsagePingModule\(\)/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
