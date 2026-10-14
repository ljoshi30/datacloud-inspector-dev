// QE Fetch & Export OFFSET-paging + cap logic tests — run in Node.
//   node test/qe-fetch-paging.test.js
//
// THE BUG this guards against: the /aura queryDCSql endpoint caps each response by PAYLOAD
// (~100k cells), so a batch is almost always SHORT (e.g. 3,087 rows for a 35-column table)
// even when millions of rows remain. qeFetchExport USED to stop whenever a batch came back
// shorter than the requested page size (`arrData.length < pageSize`) → it quit after the
// first ~3k rows of a 1,734,552-row table. Count worked (single COUNT*), export didn't.
// Proven via __dcProbeOffset: OFFSET paging DOES advance (5,993 distinct rows over 3 offset
// batches of 2,000). The fix: keep paging on ANY non-empty batch; stop only on empty OR cap.
// Deep OFFSET re-scans each batch (billed rows PROCESSED) → default cap + warn, not grind.
//
// Also locks: QE uses its OWN constants/path (independent of Data Explorer), the cap honors
// an explicit user LIMIT, and the loop can't run away or double-fetch.

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirror of qeFetchExport's loop (bookmarklet branch) as a pure simulator ──────────
// We model the server's PAYLOAD cap: each response returns min(askSize, serverRowsLeftInPage)
// where the server never returns more than `serverPage` rows per response regardless of the
// LIMIT asked. This reproduces "ask 49999, get 3087".
const QE_ASK = 49999;
const QE_DEFAULT_CAP = 50000;
const QE_HARD_MAX = 500000;

// simulate a full export against a virtual table.
//   totalRows   — rows actually in the table
//   serverPage  — max rows the endpoint returns per response (payload cap), e.g. 3087
//   userLimit   — explicit LIMIT in SQL (0 = none)
// returns { fetched, batches, cappedAtDefault, offsets }
function simulateExport(totalRows, serverPage, userLimit) {
  const effectiveMax = userLimit > 0 ? Math.min(userLimit, QE_HARD_MAX) : QE_DEFAULT_CAP;
  let fetched = 0, batches = 0, cappedAtDefault = false;
  const offsets = [];
  let offset = 0, guard = 0;
  while (true) {
    if (++guard > 100000) throw new Error("runaway loop");       // safety: must terminate
    const remaining = effectiveMax - offset;
    if (remaining <= 0) { break; }
    const askSize = Math.min(QE_ASK, remaining);
    offsets.push(offset);
    // server returns up to serverPage rows, bounded by what's left in the table and askSize
    const availableInTable = Math.max(0, totalRows - offset);
    const got = Math.min(serverPage, askSize, availableInTable);
    batches++;
    // append rows (capped at effectiveMax)
    const room = effectiveMax - fetched;
    fetched += Math.min(got, room);
    // TERMINATION (the fix): stop ONLY on empty batch or reaching effectiveMax
    if (got === 0 || fetched >= effectiveMax) {
      if (fetched >= effectiveMax && !userLimit && effectiveMax === QE_DEFAULT_CAP && got > 0) cappedAtDefault = true;
      break;
    }
    offset += got;   // advance by ACTUAL rows returned (not the asked page size)
  }
  return { fetched, batches, cappedAtDefault, offsets };
}

// ── 1. THE BUG: short batches must NOT stop paging ────────────────────────────────────
console.log("\n1. payload-capped short batches keep paging (the reported 3k bug)");
{
  // 1.7M-row table, server returns 3,087/response (35 cols), no user LIMIT → cap at 50k.
  var r = simulateExport(1734552, 3087, 0);
  eq("fetches up to the default cap, NOT just the first 3,087", r.fetched, 50000);
  ok("took many batches (paged, not single-shot)", r.batches >= 16, "batches=" + r.batches);
  ok("flagged cappedAtDefault (there's more beyond 50k)", r.cappedAtDefault === true);
  ok("offsets advance by actual rows (0, 3087, 6174, …)", r.offsets[1] === 3087 && r.offsets[2] === 6174);
}

// ── 2. Small table: fetch ALL, no false cap ───────────────────────────────────────────
console.log("\n2. small table fully fetched (short final batch is NOT a bug)");
{
  var r = simulateExport(5000, 3087, 0);   // 5k rows total, 3,087/page
  eq("fetches all 5,000 rows", r.fetched, 5000);
  ok("stops naturally (last batch empty/short), not capped", r.cappedAtDefault === false);
  // 3 batches: 3087 (off 0) + 1913 (off 3087, non-empty → must try once more) + 0 (off 5000
  // → empty → stop). The trailing confirm-batch is CORRECT: a short non-empty batch can't be
  // assumed to be the last (that assumption WAS the bug), so one extra call confirms the end.
  eq("3 batches: 3087 + 1913 + empty-terminator", r.batches, 3);
}
{
  var r = simulateExport(3087, 3087, 0);   // exactly one server page
  eq("table == one page: fetches all 3,087", r.fetched, 3087);
  // after 3087, offset=3087, next batch returns 0 → stop
  eq("one data batch + one empty terminator", r.batches, 2);
}
{
  var r = simulateExport(0, 3087, 0);      // empty table
  eq("empty table → 0 rows", r.fetched, 0);
  eq("single batch then stop", r.batches, 1);
  ok("empty table NOT flagged as capped", r.cappedAtDefault === false);
}

// ── 3. Explicit user LIMIT honored (and can exceed the default cap, up to hard max) ───
console.log("\n3. explicit LIMIT in SQL is honored");
{
  eq("LIMIT 10 → 10 rows", simulateExport(1734552, 3087, 10).fetched, 10);
  eq("LIMIT 100000 → 100000 (beyond default cap, under hard max)", simulateExport(1734552, 3087, 100000).fetched, 100000);
  ok("LIMIT 100000 not flagged capped-at-default (user chose it)", simulateExport(1734552, 3087, 100000).cappedAtDefault === false);
  eq("LIMIT 999999 clamped to hard max 500000", simulateExport(1734552, 3087, 999999).fetched, 500000);
  eq("LIMIT larger than table → only table rows", simulateExport(4000, 3087, 100000).fetched, 4000);
}

// ── 4. Big server page (few columns → ~6k/response) still works ───────────────────────
console.log("\n4. variable server page size (fewer columns → more rows/batch)");
{
  var r = simulateExport(1734552, 6000, 0);
  eq("6k/page: still fills the 50k cap", r.fetched, 50000);
  ok("fewer batches than the 3k case", r.batches < 10, "batches=" + r.batches);
}

// ── 5. Loop ALWAYS terminates (negative/robustness) ───────────────────────────────────
console.log("\n5. robustness: loop terminates on odd inputs (no freeze/runaway)");
{
  ok("tiny page size 1 on 50k cap terminates", (function(){ var r = simulateExport(1734552,1,0); return r.fetched===50000; })());
  ok("serverPage larger than cap terminates in 1 data batch", (function(){ var r = simulateExport(1734552,999999,0); return r.fetched===50000; })());
  ok("no infinite loop even if table huge + tiny page (guard holds)", (function(){ try { simulateExport(500000000, 1, 0); return true; } catch(e){ return false; } })());
}

// ── 6. The OLD buggy rule would have stopped at the first short batch ─────────────────
console.log("\n6. regression proof: old 'stop on short batch' rule == the bug");
{
  // old rule: stop when got < askSize. First batch: got=3087 < ask=49999 → stop.
  function oldBuggyExport(totalRows, serverPage) {
    var ask = Math.min(QE_ASK, QE_DEFAULT_CAP);
    var got = Math.min(serverPage, ask, totalRows);
    // old code stopped immediately because got < ask
    return got < ask ? got : got; // first batch only
  }
  eq("old rule returns only first ~3,087 of 1.7M (the bug)", oldBuggyExport(1734552, 3087), 3087);
  ok("new rule returns far more than old on same input", simulateExport(1734552, 3087, 0).fetched > oldBuggyExport(1734552, 3087));
}

// ── 7. Source presence — fix + decoupling actually wired into the real code ───────────
console.log("\n7. source presence (fix wired; QE independent of Data Explorer)");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");
  const feStart = src.indexOf("function qeFetchExport");
  // Window must cover the WHOLE function (extension branch + bookmarklet branch). It grew
  // past 12k when the QE-private extension cursor path was added — size to the next function.
  const feEnd = src.indexOf("// ── Helpful Queries: template SQL builders", feStart);
  const feBody = src.slice(feStart, feEnd > feStart ? feEnd : feStart + 20000);

  ok("QE has its OWN constants (QE_ASK/QE_DEFAULT_CAP), not shared DC_* in the loop", /QE_ASK/.test(feBody) && /QE_DEFAULT_CAP/.test(feBody));
  ok("termination no longer stops on a short batch (removed arrData.length < pageSize)", !/arrData\.length < pageSize/.test(feBody));
  ok("termination stops ONLY on empty batch or effectiveMax", /arrData\.length === 0 \|\| totalFetched >= effectiveMax/.test(feBody));
  ok("advances OFFSET by actual rows returned", /fetchBatch\(offset \+ arrData\.length\)/.test(feBody));
  ok("yields between batches (responsive page, no freeze)", /setTimeout\(function \(\) \{ fetchBatch\(offset \+ arrData\.length\)/.test(feBody));
  ok("default cap flagged for the UI warning (cappedAtDefault)", /cappedAtDefault/.test(feBody));
  ok("explicit user LIMIT honored (min with hard max)", /userLimit > 0 \? Math\.min\(userLimit, QE_HARD_MAX\)/.test(feBody));
  ok("extension branch is QE-PRIVATE (does NOT call shared exportPaginatedCsv)", !/exportPaginatedCsv\(sql, ds, onProgress/.test(feBody));
  ok("extension branch yields between pages (soon/setTimeout)", /function soon\(fn\)\s*\{\s*setTimeout/.test(feBody));
  // decoupling: exportPaginatedCsv must no longer be called anywhere inside Query Editor
  // handlers (only Data Explorer). Count-anyway fallback now uses qeFetchExport.
  ok("QE 'Count anyway' uses qeFetchExport, not exportPaginatedCsv", /Use QE's OWN fetch path[\s\S]{0,400}qeFetchExport\(cleanSql/.test(src));
  // the fix is in SHARED code → bookmarklet source must have it too
  ok("bookmarklet source has the paging fix (synced)", /QE_ASK/.test(bm) && /arrData\.length === 0 \|\| totalFetched >= effectiveMax/.test(bm));
  ok("UI warns when capped at default (how to get more)", /Stopped at <b>[\s\S]{0,120}default cap/.test(src));
}

// ── 8. STREAMING full export (no cap, memory-flat to disk) ────────────────────────────
console.log("\n8. streaming full export present + guarded");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("qeStreamFullExport defined", /function qeStreamFullExport\s*\(/.test(src));
  ok("gated behind File System Access support (qeCanStream → showSaveFilePicker)", /function qeCanStream\s*\(/.test(src) && /window\.showSaveFilePicker/.test(src));
  ok("writes to disk via createWritable (streaming, not in-memory Blob)", /fileHandle\.createWritable\(\)/.test(src));
  ok("streams per-batch writes (writer.write) — memory stays flat", /writer\.write\(/.test(src));
  ok("supports BOTH extension cursor path AND bookmarklet OFFSET path", /runDcSqlViaBridge\(sql[\s\S]{0,2500}baseSql \+ " LIMIT "/.test(src));
  ok("honors explicit LIMIT as a cap; else 100M backstop (bounded, never infinite)", /var HARD = 100000000/.test(src) && /cap = ul > 0 \? ul : HARD/.test(src));
  ok("cancellable mid-stream (isCancelled checked)", /if \(cancelled\(\)[\s\S]{0,40}finishOk\(\)/.test(src));
  ok("closes the file writer on success AND failure (no leaked handle)", /writer\.close\(\)/.test(src) && /function fail\(/.test(src));
  ok("stream button hidden unless browser supports streaming", /qeCanStream\(\)\) streamBtn\.style\.display = "block"/.test(src));
  ok("stream handler confirms + warns on no-LIMIT whole-table export", /No LIMIT — this fetches the WHOLE table/.test(src));
  ok("shared Cancel also stops the stream (__dcStreamCancel)", /__dcQueryExportCancelled = true; window\.__dcStreamCancel = true/.test(src));
  ok("streaming export present in bookmarklet build too (synced)", /function qeStreamFullExport\s*\(/.test(bm) && /createWritable/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
