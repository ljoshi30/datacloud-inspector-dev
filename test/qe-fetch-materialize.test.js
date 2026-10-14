// QE Fetch & Export async-materialization poll tests — run in Node.
//   node test/qe-fetch-materialize.test.js
//
// THE BUG this guards against: Data Cloud's queryDCSql returns state:"SUCCESS" with an
// EMPTY dataRows[] while the query is still materializing asynchronously. Fetch & Export
// used to treat ANY empty batch as "done → 0 rows" and quit (~0.5s), even though SF's own
// grid showed the row ~2.5s later. The # Count path already polled through this; Fetch &
// Export did not. Reported live: "count button works but fetch and export does not, it
// says Query returned 0 rows" (Rows Retrieved: 1 in SF's native grid at the same time).
//
// The fix: when a batch comes back EMPTY, decide whether the query is still materializing
// (→ re-poll the same offset) or genuinely finished (→ stop). This file locks that
// decision (shouldPoll) so a future refactor can't silently reintroduce the 0-row race
// OR the opposite regression (making a genuinely-empty table hang for 30s).

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirror of qeFetchExport's empty-batch decision ───────────────────────────────
// Inputs reflect exactly what the branch sees after parsing one /aura batch:
//   arrData      — rows in THIS batch (array)
//   status       — rv.status || {}  (completionStatus, progress, …)
//   haveSchema   — we already have columns (cols2.length) OR this batch had metadata
//   pollAttempt  — how many times we've already re-polled this offset
//   FE_MAX_POLL  — ceiling
// Returns true iff we should re-issue the SAME offset after a delay.
const FE_MAX_POLL = 20;
// totalFetched = rows already fetched before THIS batch. The poll is a COLD-START guard only:
// an empty offset-0 batch can mean "query still materializing". Once ANY row has been fetched,
// an empty batch is the genuine end of data — never poll (that was the "2 rows took 30s" bug).
function shouldPoll(arrData, status, haveSchema, pollAttempt, totalFetched) {
  if (arrData.length !== 0) return false;             // any rows → progressing, never poll
  if ((totalFetched || 0) > 0) return false;          // rows already in → empty batch = end, stop
  if (pollAttempt >= FE_MAX_POLL) return false;       // ceiling reached → give up, finish
  var st = status || {};
  var cs = st.completionStatus;
  var runningStatus = (cs === "Unspecified" || cs === "Running" || cs === "Processing" ||
    cs === "InProgress" || (typeof st.progress === "number" && st.progress < 100));
  var noTerminalSignal = (cs == null && !(typeof st.progress === "number" && st.progress >= 100));
  var looksUnfinished = runningStatus || (!haveSchema && noTerminalSignal);
  return looksUnfinished;
}

// ── 1. Still-materializing responses → KEEP POLLING (the actual bug) ──────────────
console.log("\n1. empty batch + query still running → poll (don't quit at 0 rows)");
ok("completionStatus Running → poll", shouldPoll([], { completionStatus: "Running" }, true, 0));
ok("completionStatus Unspecified → poll", shouldPoll([], { completionStatus: "Unspecified" }, true, 0));
ok("completionStatus Processing → poll", shouldPoll([], { completionStatus: "Processing" }, true, 0));
ok("completionStatus InProgress → poll", shouldPoll([], { completionStatus: "InProgress" }, true, 0));
ok("progress < 100 → poll", shouldPoll([], { progress: 40 }, true, 0));
ok("progress 0 → poll", shouldPoll([], { progress: 0 }, true, 0));
ok("no status + no schema yet (cold materialize) → poll", shouldPoll([], {}, false, 0));
ok("null status + no schema → poll", shouldPoll([], null, false, 0));

// ── 2. Genuinely finished → STOP (no 30s hang on an empty table) ──────────────────
console.log("\n2. empty batch + query finished → stop (no false hang)");
ok("completed empty result WITH schema (progress 100) → stop", !shouldPoll([], { progress: 100 }, true, 0));
ok("completed empty result, terminal Completed status → stop", !shouldPoll([], { completionStatus: "Completed" }, true, 0));
ok("completed empty, status present + schema → stop", !shouldPoll([], { completionStatus: "Success" }, true, 0));
ok("empty + schema present + no status → stop (schema = query ran, table just empty)",
  !shouldPoll([], {}, true, 0));
ok("progress exactly 100 even without schema → stop (terminal)", !shouldPoll([], { progress: 100 }, false, 0));

// ── 3. Rows present → never poll (normal path) ────────────────────────────────────
console.log("\n3. batch returned rows → never poll");
ok("1 row + running status → NO poll (data is flowing)", !shouldPoll([["a"]], { completionStatus: "Running" }, true, 0));
ok("full page of rows → NO poll", !shouldPoll(new Array(49999).fill([1]), {}, true, 0));

// ── 4. Poll ceiling respected (bounded wait, no infinite loop) ────────────────────
console.log("\n4. poll ceiling");
ok("at ceiling → stop even if still running", !shouldPoll([], { completionStatus: "Running" }, true, FE_MAX_POLL));
ok("one below ceiling → still polls", shouldPoll([], { completionStatus: "Running" }, true, FE_MAX_POLL - 1));
ok("ceiling bounds total wait (<= ~30s at 1.5s/poll)", FE_MAX_POLL * 1.5 <= 31);

// ── 5. The exact reported scenario ────────────────────────────────────────────────
console.log("\n5. reported scenario: SF grid shows the row ~2.5s later; we quit at 0.5s");
{
  // First batch at ~0.5s: SUCCESS, empty rows, still materializing, no schema yet.
  ok("t=0.5s empty+running → poll (previously quit → bug)", shouldPoll([], { completionStatus: "Running" }, false, 0));
  // ~2.5s later the batch finally carries the row → we stop and return it.
  ok("t=2.5s row arrives → stop + keep the row", !shouldPoll([["D", "1sgbc0000001yer"]], { completionStatus: "Completed" }, true, 2));
}

// ── 5b. REGRESSION: small result must NOT poll at the END ("2 rows took 30s") ─────
// After a small result is fetched, the loop asks for the next OFFSET page to check for
// more. That page comes back EMPTY (true end of data). WITHOUT the totalFetched>0 gate it
// looked "unfinished" and polled 20×1.5s = 30s before finishing. This locks the fix.
console.log("\n5b. regression: empty end-of-data batch AFTER rows → stop instantly (no 30s)");
{
  // 2 rows already fetched, next OFFSET batch empty + no terminal signal (looks unfinished):
  ok("empty batch, 2 rows already in, running-ish status → STOP (was: polled 30s)",
    !shouldPoll([], { completionStatus: "Unspecified" }, true, 0, 2));
  ok("empty batch, 2 rows in, no schema/no status → STOP", !shouldPoll([], {}, false, 0, 2));
  ok("empty batch, 1 row in, progress<100 → STOP", !shouldPoll([], { progress: 50 }, true, 0, 1));
  // cold start (0 fetched) still polls — the original fix is preserved:
  ok("cold start (0 fetched) + running → STILL polls (original 0-rows fix intact)",
    shouldPoll([], { completionStatus: "Running" }, false, 0, 0));
  ok("default totalFetched (undefined) behaves as cold start → polls",
    shouldPoll([], { completionStatus: "Running" }, false, 0));
}

// ── 6. Source presence — the guard is actually wired into qeFetchExport ───────────
console.log("\n6. source presence (poll wired into qeFetchExport, not just tested here)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");
  // isolate the qeFetchExport body so we don't match the Count path's poll. Size to the
  // whole function (it grew when the QE-private extension branch was added) by ending at the
  // next top-level comment, not a fixed 9000 chars that no longer reaches the poll code.
  const feStart = src.indexOf("function qeFetchExport");
  const feEnd = src.indexOf("// ── Helpful Queries: template SQL builders", feStart);
  const feBody = src.slice(feStart, feEnd > feStart ? feEnd : feStart + 20000);
  ok("qeFetchExport has a poll ceiling (FE_MAX_POLL)", /FE_MAX_POLL/.test(feBody));
  ok("qeFetchExport has a poll delay (FE_POLL_MS)", /FE_POLL_MS/.test(feBody));
  ok("fetchBatch carries a pollAttempt counter", /fetchBatch\(offset,\s*pollAttempt/.test(feBody) || /pollAttempt\s*=\s*pollAttempt/.test(feBody));
  ok("re-polls the SAME offset on unfinished empty batch", /setTimeout\([\s\S]{0,120}fetchBatch\(offset,\s*pollAttempt\s*\+\s*1\)/.test(feBody));
  ok("checks completionStatus Running/Unspecified", /completionStatus[\s\S]{0,80}(Running|Unspecified)/.test(feBody));
  ok("distinguishes completed-empty via schema (no false 30s hang)", /_haveSchema|haveSchema/.test(feBody));
  // REGRESSION GUARD: poll ONLY on cold start (totalFetched===0) so a small result doesn't
  // poll 30s at the end. Must be ANDed into the Fetch-path poll condition.
  ok("Fetch poll gated on cold start (totalFetched === 0 → no 30s tail on small results)",
    /arrData\.length === 0 && totalFetched === 0 && _looksUnfinished/.test(feBody));
  // the fix lives in SHARED code → must be present in the bookmarklet source too
  ok("bookmarklet source got the same poll (shared fix synced)", /FE_MAX_POLL/.test(bm) && /pollAttempt/.test(bm));
  ok("bookmarklet Fetch poll also cold-start gated", /arrData\.length === 0 && totalFetched === 0 && _looksUnfinished/.test(bm));
  // the STREAMING path has the same guard (got === 0)
  ok("stream poll gated on cold start (got === 0)", /arr\.length === 0 && got === 0 &&/.test(src) && /arr\.length === 0 && got === 0 &&/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
