// Behavior test for runDcSegmentDef (chrome-extension/background.js) — proves the LIST path
// PAGES THROUGH ALL segments instead of returning only the first batch. This is the bug that made
// Copy SQL fail for any segment past offset 20 ("Segment not found" / DOM fallback) in large orgs.
//
// We don't assert on source strings — we EXTRACT the real function and RUN it against a mocked
// fetch that simulates a 45-segment org served in pages, then check the merged result actually
// contains segment #21 and #45 (which the old single-fetch code could never return).

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

const src = fs.readFileSync(path.join(__dirname, "..", "chrome-extension", "background.js"), "utf8");

// Pull the real runDcSegmentDef source out of background.js and build a callable from it, injecting
// the few globals it relies on (fetch, readSid, safeError, console, AbortController, setTimeout).
const m = src.match(/async function runDcSegmentDef\(req\)\s*\{[\s\S]*?\n\}/);
if (!m) { console.log("  ✗ could not locate runDcSegmentDef in background.js"); process.exit(1); }

function makeRunner(fetchImpl) {
  const factory = new Function(
    "fetch", "readSid", "safeError", "console", "AbortController", "setTimeout", "clearTimeout",
    m[0] + "\nreturn runDcSegmentDef;"
  );
  return factory(
    fetchImpl,
    async () => ({ sid: "SID", coreHost: "example.my.salesforce.com" }),  // readSid mock
    (e) => String(e && e.message || e),                                   // safeError mock
    { log() {} },                                                          // quiet console
    function () { return { abort() {}, signal: {} }; },                    // AbortController mock
    (fn) => 0, () => {}                                                    // setTimeout/clearTimeout no-ops
  );
}

// Build a mock /ssot/segments LIST server: TOTAL segments, served in pages of PAGE from &offset=.
function listServer(total, page) {
  return async function (url) {
    const u = new URL(url);
    const offset = parseInt(u.searchParams.get("offset") || "0", 10);
    const batch = parseInt(u.searchParams.get("batchSize") || String(page), 10);
    const step = Math.min(batch, page);                 // server caps at its own page size
    const segs = [];
    for (let i = offset; i < Math.min(offset + step, total); i++) {
      segs.push({ apiName: "SEG_" + (i + 1), displayName: "Seg " + (i + 1), includeCriteria: "{}" });
    }
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ batchSize: step, offset, totalSize: total, segments: segs })
    };
  };
}

(async () => {
  console.log("\nrunDcSegmentDef — LIST pagination (behavior)");

  // CASE 1: 45-segment org, server pages 20 at a time. Old code returned 20; new code must return 45.
  {
    const run = makeRunner(listServer(45, 20));
    const res = await run({ host: "example.my.salesforce.com", segmentApiNameOrId: "" });
    const segs = (res && res.data && res.data.segments) || [];
    const names = segs.map(s => s.apiName);
    ok("LIST returns ALL 45 segments (not just the first page of 20)", res.ok && segs.length === 45);
    ok("reaches segment #21 (the one past the old 20-cap)", names.indexOf("SEG_21") >= 0);
    ok("reaches the last segment #45", names.indexOf("SEG_45") >= 0);
    ok("no duplicates across pages", new Set(names).size === names.length);
  }

  // CASE 2: exactly one short page (3 segments) — must stop after one fetch, not loop forever.
  {
    let calls = 0;
    const run = makeRunner(async (url) => { calls++; return listServer(3, 20)(url); });
    const res = await run({ host: "example.my.salesforce.com", segmentApiNameOrId: "" });
    ok("small org (3 segs) returns all 3", res.ok && res.data.segments.length === 3);
    ok("small org makes exactly ONE page request (short page ends loop)", calls === 1);
  }

  // CASE 3: zero segments — clean empty result, no crash.
  {
    const run = makeRunner(listServer(0, 20));
    const res = await run({ host: "example.my.salesforce.com", segmentApiNameOrId: "" });
    ok("empty org returns ok with 0 segments", res.ok && res.data.segments.length === 0);
  }

  // CASE 4: BY-NAME (non-empty id) must do a single GET, NOT the paging loop.
  {
    let calls = 0;
    const run = makeRunner(async (url) => {
      calls++;
      return { ok: true, status: 200, text: async () => JSON.stringify({ apiName: "SEG_X", includeCriteria: "{}" }) };
    });
    const res = await run({ host: "example.my.salesforce.com", segmentApiNameOrId: "SEG_X" });
    ok("by-name does a single GET (no paging)", res.ok && calls === 1);
  }

  // CASE 5: HTTP 401 on the first list page surfaces sessionExpired (not a silent empty list).
  {
    const run = makeRunner(async () => ({ ok: false, status: 401, text: async () => "INVALID_SESSION_ID" }));
    const res = await run({ host: "example.my.salesforce.com", segmentApiNameOrId: "" });
    ok("401 on first page => sessionExpired error (not empty success)", !res.ok && res.sessionExpired === true);
  }

  // CASE 6: a mid-paging fetch error keeps the pages already collected (partial > nothing).
  {
    let n = 0;
    const base = listServer(45, 20);
    const run = makeRunner(async (url) => {
      n++;
      if (n === 2) throw Object.assign(new Error("network"), { name: "TypeError" });  // 2nd page fails
      return base(url);
    });
    const res = await run({ host: "example.my.salesforce.com", segmentApiNameOrId: "" });
    ok("mid-paging error keeps the first page's segments (partial, still ok)", res.ok && res.data.segments.length === 20);
  }

  console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
  process.exit(fail === 0 ? 0 : 1);
})();
