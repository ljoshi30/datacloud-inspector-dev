// Data Explorer logic tests — run in Node, no browser needed.
//   node test/explorer-logic.test.js
//
// These mirror the PURE logic in console-decorate.js so we can verify behavior +
// edge cases + error paths BEFORE pushing to the live dev site. When you change one
// of these functions in console-decorate.js, update its mirror here and re-run.
//
// Covered:
//   1. _dxCreditStr        — Data Explorer credit precision + 0/edge handling
//   2. _badDsNames guard   — UI placeholder text never treated as a real dataspace
//   3. dataspace error msg — the "sort a column" fallback is triggered for the right errors
//   4. establishDataSpace  — deterministic capture/finish flow (no double-cb, acts on capture)
//   5. incremental cache   — column reuse math (allCached / partialCache / newCols)

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. _dxCreditStr — mirrors console-decorate.js exactly. Rate 1.6 (Sandbox) / 2 (Prod).
// ─────────────────────────────────────────────────────────────────────────────
function makeDxCreditStr(rate) {
  return function _dxCreditStr(rowsProcessed) {
    var c = (Number(rowsProcessed) / 1000000) * rate;
    if (!isFinite(c) || c <= 0) return "0";
    if (c >= 1) return c.toFixed(2);
    if (c >= 0.0001) return c.toFixed(4);
    return c.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "");
  };
}
console.log("\n1. _dxCreditStr (credit precision)");
{
  const sb = makeDxCreditStr(1.6);   // Sandbox
  const pr = makeDxCreditStr(2);     // Production
  eq("0 rows → '0'", sb(0), "0");
  eq("null → '0'", sb(null), "0");
  eq("negative → '0'", sb(-5), "0");
  eq("NaN → '0'", sb("abc"), "0");
  // 1.315M rows @ 1.6/1M = 2.1043 → >=1 so 2dp
  eq("1,315,197 rows Sandbox → 2dp", sb(1315197), "2.10");
  // small: 50k rows @ 1.6/1M = 0.08 → >=0.0001 so 4dp
  eq("50,000 rows Sandbox → 4dp", sb(50000), "0.0800");
  // tiny: 100 rows @ 1.6/1M = 0.00016 → >=0.0001 so 4dp
  eq("100 rows Sandbox → 4dp", sb(100), "0.0002");
  // very tiny: 10 rows @ 1.6/1M = 0.000016 → <0.0001 so 4 sig figs
  eq("10 rows Sandbox → sigfigs", sb(10), "0.000016");
  // NOT the old "<0.01" collapse — must be a real number
  ok("small value is not '<0.01'", sb(50000).indexOf("<") === -1);
  ok("tiny value is not '<0.01'", sb(10).indexOf("<") === -1);
  // Production rate differs
  eq("1M rows Production → 2.00", pr(1000000), "2.00");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. _badDsNames — UI placeholder strings must NEVER be accepted as a dataspace.
// ─────────────────────────────────────────────────────────────────────────────
const _badDsNames = /^(Selected|Select|Sort|Filter|Edit|View|Loading|None|All|Default selection)$/i;
console.log("\n2. _badDsNames guard (reject UI placeholder text)");
{
  ["Selected","select","SORT","Filter","Edit","View","Loading","None","All","Default selection"]
    .forEach(s => ok("rejects '" + s + "'", _badDsNames.test(s)));
  ["TDI","TD_Insurance","default","CAMEP_SFP","dataspace1","td-insurance"]
    .forEach(s => ok("accepts real ds '" + s + "'", !_badDsNames.test(s)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Dataspace-error detection — the regex that decides whether to show the
//    "sort a column" fallback message (vs a raw SQL error).
// ─────────────────────────────────────────────────────────────────────────────
function isDataspaceErr(msg) {
  return /dataspace="?"?\s*(?:,|\])/.test(msg) || /tried.*dataspace/i.test(msg) || /does not exist|INVALID_ARGUMENT/i.test(msg);
}
console.log("\n3. dataspace-error detection (triggers friendly message)");
{
  ok("catches [tried table=.. dataspace=\"\"]", isDataspaceErr('SQL query failed: [tried table="X" dataspace=""] ...'));
  ok("catches dataspace=\"default\"", isDataspaceErr('[tried table="X" dataspace="default"] table does not exist'));
  ok("catches INVALID_ARGUMENT", isDataspaceErr('INVALID_ARGUMENT: table "X__dll" does not exist'));
  ok("catches 'does not exist'", isDataspaceErr('table "Y" does not exist'));
  ok("does NOT trigger on unrelated error", !isDataspaceErr('network timeout after 30s'));
  ok("does NOT trigger on permission error", !isDataspaceErr('user has insufficient privileges'));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. establishDataSpace flow — deterministic finish. Mirrors the control flow:
//    calls cb exactly once; cb(true) if a dataspace appears within the poll window,
//    cb(false) if no sort control was found or it timed out. No double-cb.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. establishDataSpace flow (deterministic, single cb)");
function simulateEstablish({ knownUpfront, foundSortControl, dsAppearsAtTick }) {
  // returns { result, cbCount, ticks } synchronously by simulating the tick loop
  let cbCount = 0, result = null;
  const cb = (ok) => { cbCount++; if (result === null) result = ok; };

  if (knownUpfront) { cb(true); return { result, cbCount, ticks: 0 }; }
  const fired = !!foundSortControl;
  let done = false, tries = 0, tick = 0;
  function finish(okv) { if (done) return; done = true; cb(okv); }
  // simulate up to 30 polls (like the real ~6s window)
  for (tick = 0; tick <= 31 && !done; tick++) {
    const got = (dsAppearsAtTick != null && tick >= dsAppearsAtTick);
    if (got) { finish(true); break; }
    if (!fired || tries++ > 30) { finish(false); break; }
  }
  return { result, cbCount, ticks: tick };
}
{
  let r;
  r = simulateEstablish({ knownUpfront: true });
  ok("known upfront → cb(true), no polling", r.result === true && r.cbCount === 1 && r.ticks === 0);

  r = simulateEstablish({ foundSortControl: true, dsAppearsAtTick: 3 });
  ok("sort fires, ds appears → cb(true) once", r.result === true && r.cbCount === 1);

  r = simulateEstablish({ foundSortControl: true, dsAppearsAtTick: null });
  ok("sort fires, ds never appears → cb(false) once (timeout)", r.result === false && r.cbCount === 1);

  r = simulateEstablish({ foundSortControl: false, dsAppearsAtTick: null });
  ok("no sort control found → cb(false) immediately", r.result === false && r.cbCount === 1);

  // The critical regression guard: cb must fire EXACTLY once in every path.
  ok("cb fires exactly once (all paths)", [
    simulateEstablish({ knownUpfront: true }),
    simulateEstablish({ foundSortControl: true, dsAppearsAtTick: 1 }),
    simulateEstablish({ foundSortControl: true, dsAppearsAtTick: null }),
    simulateEstablish({ foundSortControl: false }),
  ].every(x => x.cbCount === 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Incremental-fetch cache math — decides allCached vs partialCache vs full fetch.
//    Mirrors viewAllBtn.onclick logic (field-name STRING arrays).
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. incremental-fetch cache math");
function cacheDecision(cachedRows, loadedFns, cols) {
  const newCols = cols.filter(fn => loadedFns.indexOf(fn) === -1);
  const hasRows = cachedRows && cachedRows.length > 0;
  return {
    newCols,
    allCached: hasRows && newCols.length === 0,
    partialCache: hasRows && newCols.length > 0,
    fullFetch: !hasRows,
  };
}
{
  let d;
  d = cacheDecision([{a:1}], ["a","b"], ["a","b"]);
  ok("all selected already loaded → allCached", d.allCached && !d.partialCache && d.newCols.length === 0);

  d = cacheDecision([{a:1}], ["a","b"], ["a","b","c"]);
  ok("one new column → partialCache, fetch only [c]", d.partialCache && d.newCols.length === 1 && d.newCols[0] === "c");

  d = cacheDecision([], [], ["a","b"]);
  ok("no cache → fullFetch", d.fullFetch && !d.allCached && !d.partialCache);

  d = cacheDecision([{a:1}], ["a","b","c"], ["a"]);
  ok("selecting a subset of loaded → allCached (no query)", d.allCached && d.newCols.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
