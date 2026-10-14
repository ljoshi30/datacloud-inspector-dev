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
  // MEMORY: after building the Blob, the big line array must be released so a large export
  // doesn't hold the same data twice in RAM (the VDI-smoothness fix). Locked here so a
  // refactor can't quietly reintroduce the double-hold.
  ok("releases the big CSV array after Blob is built (csvOut = null in finish)", /var url = URL\.createObjectURL\(blob\);[\s\S]{0,700}csvOut = null;/.test(feBody));
  // Memory stays bounded by revoking the PREVIOUS result's Blob when a new one replaces it
  // (setLastResult) — NOT by a timer after download, which broke a 2nd Download click
  // (revoked URL → downloads nothing). Download must NOT revoke the current blob.
  ok("setLastResult revokes the previous Blob when a new result replaces it", /function setLastResult\(next\)[\s\S]{0,260}URL\.revokeObjectURL\(_lastResult\.blobUrl\)/.test(src));
  ok("all QE result assignments route through setLastResult (none raw after decl)", (src.match(/setLastResult\(/g) || []).length >= 5);
  ok("download does NOT revoke the current result's Blob (re-download stays valid)", /do NOT revoke the Blob URL here/.test(src) && !/\}, 1500\)/.test(src.slice(src.indexOf("downloadBtn.onclick"), src.indexOf("downloadBtn.onclick") + 1200)));
  ok("memory-release (csvOut=null after Blob) synced into the bookmarklet build too", /csvOut = null;/.test(bm) && /function setLastResult\(next\)/.test(bm));
  ok("default cap flagged for the UI warning (cappedAtDefault)", /cappedAtDefault/.test(feBody));
  ok("explicit user LIMIT honored (min with hard max)", /userLimit > 0 \? Math\.min\(userLimit, QE_HARD_MAX\)/.test(feBody));
  ok("extension branch is QE-PRIVATE (does NOT call shared exportPaginatedCsv)", !/exportPaginatedCsv\(sql, ds, onProgress/.test(feBody));
  ok("extension branch yields between pages (soon/setTimeout)", /function soon\(fn\)\s*\{\s*setTimeout/.test(feBody));
  // decoupling: exportPaginatedCsv must no longer be called anywhere inside Query Editor
  // handlers (only Data Explorer). Count-anyway fallback now uses qeFetchExport.
  ok("QE 'Count anyway' uses qeFetchExport, not exportPaginatedCsv", /Use QE's OWN fetch path[\s\S]{0,400}qeFetchExport\(cleanSql/.test(src));
  // the fix is in SHARED code → bookmarklet source must have it too
  ok("bookmarklet source has the paging fix (synced)", /QE_ASK/.test(bm) && /arrData\.length === 0 \|\| totalFetched >= effectiveMax/.test(bm));
  ok("UI warns when capped (points to Export ALL / LIMIT, no jargon)", /Stopped at <b>[\s\S]{0,160}Export ALL<\/b>[\s\S]{0,40}LIMIT/.test(src));
  ok("button labelled 'Export ALL' (no 'stream' jargon)", /streamBtn\.textContent = "⤓ Export ALL"/.test(src) && !/Export ALL \(stream\)/.test(src));
  ok("already-exported guard warns + saves credits (memo by normalized SQL)", /var _lastStreamExport = null/.test(src) && /_lastStreamExport && _lastStreamExport\.sqlKey === sqlKey/.test(src) && /Already exported/.test(src));
  ok("memo only set on real non-cancelled result (not on cancel/0 rows)", /!res\.cancelled && res\.totalRows > 0[\s\S]{0,80}_lastStreamExport = \{ sqlKey: sqlKey/.test(src));
  ok("viewer-limit heads-up: warns when export exceeds Excel (1,048,576) / Sheets (10M cells/cols)", /var EXCEL_MAX = 1048576, SHEETS_CELLS = 10000000/.test(src) && /sheetsMax = nCols > 0 \? Math\.floor\(SHEETS_CELLS \/ nCols\)/.test(src) && /viewers truncate/.test(src));
  ok("qeStreamFullExport returns columns so Sheets cell-math works", /function result\(\) \{ return \{ totalRows: got, cancelled: cancelled\(\), columns: cols/.test(src));
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
  // BUG FIX: result() must report the REAL cancel state (was hardcoded false → a cancelled
  // partial export looked "complete" and got memoized as a full export, then wrongly warned
  // "already exported, don't re-run"). finishOk runs on both end-of-data AND cancel.
  ok("stream result() reports the real cancel flag (not hardcoded false)", /function result\(\) \{ return \{ totalRows: got, cancelled: cancelled\(\), columns: cols/.test(src));
  ok("no leftover hardcoded cancelled:false in the stream result", !/cancelled: false, columns: cols/.test(src));
  ok("cancel-state fix synced into the bookmarklet build too", /cancelled: cancelled\(\), columns: cols/.test(bm));
  ok("closes the file writer on success AND failure (no leaked handle)", /writer\.close\(\)/.test(src) && /function fail\(/.test(src));
  ok("stream button hidden unless browser supports streaming", /qeCanStream\(\)\) streamBtn\.style\.display = "block"/.test(src));
  ok("stream handler confirms + warns on no-LIMIT whole-table export", /No LIMIT — this fetches the WHOLE table/.test(src));
  // Locked-file (replacing a CSV still open in Excel): retry once, then a clear actionable msg.
  ok("createWritable retries once on a lock error (transient lock)", /function openWritable\(attempt\)/.test(src) && /attempt < 1 && \/truncate\|create\|locked/.test(src) && /openWritable\(attempt \+ 1\)/.test(src));
  ok("locked-file error is tagged (err.fileLocked) for a friendly message", /err\.fileLocked = \/truncate\|create\|locked\|NoModificationAllowed\|InvalidState\/i\.test\(em\)/.test(src));
  ok("locked-file shows 'still open in Excel' guidance, not the raw browser error", /Couldn’t save over that file[\s\S]{0,200}still <b>open in Excel<\/b>/.test(src));
  ok("locked-file handling synced into the bookmarklet build too", /function openWritable\(attempt\)/.test(bm) && /still <b>open in Excel<\/b>/.test(bm));
  ok("stream has its OWN cancel button (no out-of-scope cancelBtn reference)", /function makeStreamCancelBtn\(\)/.test(src) && /window\.__dcStreamCancel = true;/.test(src));
  ok("progress UI appends the stream's own cancel button (not Fetch handler's)", /cardBody\.appendChild\(streamCancelBtn\)/.test(src));
  ok("no user-facing 'browser extension' wording in the capped warning", !/use the <b>browser extension<\/b>/.test(src));
  ok("streaming export present in bookmarklet build too (synced)", /function qeStreamFullExport\s*\(/.test(bm) && /createWritable/.test(bm));

  // ── Export ALL state SURVIVES closing the card (new feature) ───────────────────────
  // Closing the info card (×) or the panel must NOT lose a running/finished export; re-
  // opening (panel toggle / ℹ / re-click Export ALL) re-shows live progress or the result,
  // and never starts a duplicate export. These lock that wiring into the real source.
  ok("persistent stream state object (_streamState with status/rows/finalHtml)", /var _streamState = null/.test(src) && /_streamState = \{ status: "running"/.test(src));
  ok("renderStreamCard re-paints progress OR final result from _streamState", /function renderStreamCard\(\)/.test(src) && /_streamState\.status === "running"/.test(src));
  ok("re-clicking Export ALL while running re-shows progress (no duplicate export)", /_streamState && _streamState\.status === "running"\) \{ renderStreamCard\(\); return;/.test(src));
  ok("re-opening the panel brings a live/finished export back", /if \(_panelOpen\)[\s\S]{0,400}renderStreamCard\(\)/.test(src));
  ok("ℹ button re-shows the live/finished export instead of a stale card", /if \(!\(typeof renderStreamCard === "function" && renderStreamCard\(\)\)\) card\.style\.display = "block"/.test(src));
  ok("final result persisted to _streamState (done/cancelled/error) for re-open", /_streamState = \{ status: res\.cancelled \? "cancelled" : "done"/.test(src) && /status: "error"/.test(src));
  ok("Count/Fetch supersede a FINISHED stream card but never a running one", (src.match(/if \(_streamState && _streamState\.status !== "running"\) _streamState = null/g) || []).length >= 2);
  ok("progress only repaints the card when it's visible (silent update when closed)", /if \(card\.style\.display !== "none"\) renderStreamCard\(\)/.test(src));
  ok("stream state fix synced into the bookmarklet build too", /var _streamState = null/.test(bm) && /function renderStreamCard\(\)/.test(bm));
  // BUG FIX: Count/Fetch must be PAUSED during a stream, else they fight over the shared card.
  ok("setExportBusy disables Count + Fetch during a stream", /function setExportBusy\(on\)[\s\S]{0,200}\[countBtn, runBtn\]\.forEach/.test(src));
  ok("stream START pauses Count/Fetch (setExportBusy(true))", /streamBtn\.disabled = true;\s*\n\s*setExportBusy\(true\);/.test(src));
  ok("stream DONE + ERROR re-enable Count/Fetch (setExportBusy(false) on both terminal paths)", (src.match(/setExportBusy\(false\);/g) || []).length >= 2);
  ok("busy-pause fix synced into the bookmarklet build too", /function setExportBusy\(on\)/.test(bm) && /setExportBusy\(true\);/.test(bm));

  // ── Launcher stays on-screen when all buttons show (responsive) ────────────────────
  ok("button row is height-capped + scrollable so the FAB never goes off-screen", /function clampQeButtonRow\(\)/.test(src) && /btnRow\.style\.maxHeight =/.test(src) && /btnRow\.style\.overflowY = "auto"/.test(src));
  ok("button row re-clamped when the panel opens and on resize", /if \(_panelOpen\) \{\s*try \{ clampQeButtonRow\(\); \} catch/.test(src) && /window\.addEventListener\("resize", clampQeButtonRow\)/.test(src));
  ok("button-row clamp synced into the bookmarklet build too", /function clampQeButtonRow\(\)/.test(bm));
  // Auto-reposition must SNAP BACK on close (FAB not left stranded), but respect a user drag.
  ok("tracks auto-move vs user-drag (two separate flags)", /var _autoPositioned = false/.test(src) && /var _userDragged = false/.test(src));
  ok("clamp marks its repositioning as AUTOMATIC (_autoPositioned = true)", /_autoPositioned = true;\s*\/\/ remember THIS was an automatic move/.test(src));
  ok("a real drag marks _userDragged + clears auto flag", /_dragMoved = true; _userDragged = true; _autoPositioned = false;/.test(src));
  ok("closing the panel snaps an AUTO-moved launcher back to its home corner", /if \(_autoPositioned && !_userDragged\) resetWrapToDefaultAnchor\(\)/.test(src));
  ok("reset restores the exact default anchor (bottom:16px/left:16px)", /function resetWrapToDefaultAnchor\(\)[\s\S]{0,200}bottom = "16px";[\s\S]{0,40}left = "16px"/.test(src));
  ok("snap-back + drag-respect synced into the bookmarklet build too", /var _autoPositioned = false/.test(bm) && /if \(_autoPositioned && !_userDragged\) resetWrapToDefaultAnchor\(\)/.test(bm));

  // ── View Results renders in non-blocking chunks (VDI-safe) ─────────────────────────
  // Building up to 2,000 rows × many columns in ONE synchronous innerHTML froze VDI tabs.
  // Initial load, sort, AND the empty-column toggle must all fill via the chunked filler
  // with a generation token (so a newer render cancels an in-flight one). Lock it so a
  // refactor can't reintroduce a synchronous full-table build.
  ok("View Results has a chunked tbody filler with a cancel token", /function fillTbodyChunked\(data\)/.test(src) && /var _fillGen = 0;/.test(src) && /var myGen = \+\+_fillGen;/.test(src));
  ok("filler yields between chunks (setTimeout) and bails on newer gen / closed modal", /if \(myGen !== _fillGen \|\| !document\.getElementById\("dc-qe-results-modal"\)\) return;/.test(src) && /if \(i < max\) setTimeout\(step, 16\)/.test(src));
  ok("SORT uses the chunked filler (not a synchronous 2,000-row innerHTML)", /fillTbodyChunked\(rows\);\s*\/\/ chunked, not one synchronous/.test(src));
  ok("empty-column TOGGLE uses the chunked filler too", /fillTbodyChunked\(rows\);\s*\/\/ fill rows in non-blocking chunks/.test(src));
  ok("no leftover synchronous full-table renderTableBody in View Results", !/renderTableBody/.test(src));
  ok("VDI-safe chunked View Results synced into the bookmarklet build too", /function fillTbodyChunked\(data\)/.test(bm) && /var _fillGen = 0;/.test(bm));
  // REGRESSION: the initial fill must run AFTER the modal is in the DOM (the filler guards on
  // the modal existing). Filling before document.body.appendChild(modal) rendered ZERO rows
  // until the user toggled columns — the "empty View Results" bug. Lock the ordering.
  ok("initial View Results fill runs AFTER the modal is appended to the DOM", /document\.body\.appendChild\(modal\);[\s\S]{0,220}fillTbodyChunked\(rows\);/.test(src));
  // The header-build block builds an EMPTY tbody and comments that the fill is deferred to
  // after the append — proving the regression fix (fill-before-append rendered nothing).
  ok("header build uses an empty tbody + defers the fill to after append", /The ROWS are filled AFTER the modal is\s*\n\s*\/\/ added to the document/.test(src));

  // ── RUNTIME scope-leak guard ──────────────────────────────────────────────────────
  // The 'cancelBtn is not defined' and 'startT is not defined' bugs were cross-.then scope
  // leaks that source-presence regexes CAN'T catch. This actually RUNS the stream handler
  // under a fake DOM with stubbed showSaveFilePicker + qeStreamFullExport, so any variable
  // referenced out of scope throws a ReferenceError we catch here — before users do.
  const vm = require("vm");
  // extract the goBtn.onclick handler body
  var gi = src.indexOf("if (goBtn) goBtn.onclick = function () {");
  ok("found stream goBtn handler for runtime check", gi >= 0);
  if (gi >= 0) {
    // grab from the handler start to its matching close (balance braces)
    var from = src.indexOf("{", gi);
    var depth = 0, end = from;
    for (var ci = from; ci < src.length; ci++) { var ch = src[ci]; if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) { end = ci; break; } } }
    var handlerBody = src.slice(from + 1, end);
    // Build a sandbox providing EVERY free variable the handler legitimately closes over,
    // plus a fake DOM. If the handler references something NOT provided and NOT declared
    // inside it (the bug class), running it throws ReferenceError.
    var threw = null, ranProgress = false, ranComplete = false;
    var fakeEl = function () { return { style: {}, textContent: "", innerHTML: "", disabled: false, onclick: null, setAttribute: function () {}, getAttribute: function () { return ""; }, appendChild: function () {}, addEventListener: function () {} }; };
    var sandbox = {
      // free vars the real handler closes over (from ensureQueryEditorLauncher scope):
      getHighlightedSql: function () { return 'SELECT * FROM "T__dll"'; },
      normalizeSql: function (s) { return s; },
      validateSql: function () { return { ok: true }; },
      showGuide: function () {},
      extractTableName: function () { return "T__dll"; },
      readPageDataSpace: function () { return "DS"; },
      dataSpaceCandidates: function () { return ["DS"]; },
      todayStr: function () { return "2026-01-01"; },
      normSqlKey: function (s) { return s; },
      streamBtn: fakeEl(), cardBody: fakeEl(), card: fakeEl(),
      _savedSelection: "", _lastResult: null,
      // Export-ALL live-state closures the handler now reads (persist-across-close feature):
      _streamState: null, streamCancelBtn: null,
      renderStreamCard: function () { return true; },
      makeStreamCancelBtn: function () { return fakeEl(); },
      setExportBusy: function () {},   // closure helper the handler now calls (pause Count/Fetch)
      // vars the ENCLOSING streamBtn.onclick legitimately declares before goBtn (so the
      // guard flags only TRUE cross-.then leaks, not these in-scope locals):
      sql: 'SELECT * FROM "T__dll"', ds: "DS", tableName: "T__dll", hasLimit: false,
      sqlKey: 'select * from "t__dll"', _lastStreamExport: null,
      // stub the two async boundaries so the whole promise chain executes synchronously-ish
      qeStreamFullExport: function (sql, ds, handle, onProgress) { try { onProgress(10); ranProgress = true; } catch (e) {} return Promise.resolve({ totalRows: 10, cancelled: false }); },
      window: { showSaveFilePicker: function () { return Promise.resolve({ createWritable: function () { return Promise.resolve({ write: function () { return Promise.resolve(); }, close: function () { return Promise.resolve(); } }); } }); }, __dcStreamCancel: false },
      document: { createElement: function () { return fakeEl(); }, getElementById: function () { return fakeEl(); }, body: { appendChild: function () {} } },
      Date: Date, Promise: Promise, setTimeout: setTimeout, encodeURIComponent: encodeURIComponent, JSON: JSON,
    };
    sandbox.goBtn = { onclick: null };
    try {
      // define the handler, assign to goBtn.onclick, then CALL it — executes the full chain.
      var code = "(function(){ if (goBtn) goBtn.onclick = function () {" + handlerBody + "}; return goBtn.onclick; })()";
      var fn = vm.runInNewContext(code, sandbox, { timeout: 2000 });
      Promise.resolve(fn && fn()).catch(function (e) { threw = e; });
    } catch (e) { threw = e; }
    // give the microtask chain a tick to surface any ReferenceError
    var waited = 0;
    (function spin() {
      if (threw || waited > 50) {
        ok("stream handler RUNS with no scope-leak ReferenceError (catches cancelBtn/startT class)", !threw, threw && String(threw.message || threw));
        console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
        process.exit(fail === 0 ? 0 : 1);
      } else { waited++; setTimeout(spin, 10); }
    })();
    return; // defer final print to the spin loop above
  }
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
