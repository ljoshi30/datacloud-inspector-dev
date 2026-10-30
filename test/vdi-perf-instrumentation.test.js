// VDI perf harness (__dcPerf) + instrumentation of the hot API-name modules. Run in Node:
//   node test/vdi-perf-instrumentation.test.js
//
// __dcPerf is a STOPWATCH, not an optimization — it measures crawl node-counts + decorate-pass
// timing so the optimization pass is driven by NUMBERS, not guesses. It must be ZERO-COST when off
// and fully stripped from the public build. The 3 hot decorators (IR / Data Graph / DMO origin)
// are wired to report to it, GUARDED so they no-op when the harness is absent.
//
// (The former "universal API names" prototype module this file also used to cover was REMOVED at
// the user's request 2026-10-30 — only the perf harness + its wiring remain.)

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

console.log("\n1. harness is ZERO-COST when OFF (crawl ignored; pass still runs the fn, untimed)");
{
  // mirror of __dcPerf
  var ON = false, stats = {};
  function slot(l) { return stats[l] || (stats[l] = { crawls: 0, nodes: 0, passes: 0, totalMs: 0, maxMs: 0 }); }
  var perf = {
    on: function () { ON = true; }, off: function () { ON = false; }, isOn: function () { return ON; },
    reset: function () { stats = {}; },
    crawl: function (l, n) { if (!ON) return; var s = slot(l); s.crawls++; if (typeof n === "number") s.nodes += n; },
    pass: function (l, fn) { if (!ON) return fn(); var s = slot(l); s.passes++; return fn(); }
  };
  perf.crawl("m", 100);
  eq("off: crawl is a no-op (no stats slot created)", Object.keys(stats).length, 0);
  var ran = 0, ret = perf.pass("m", function () { ran++; return 42; });
  ok("off: pass STILL runs the fn (behavior preserved)", ran === 1);
  eq("off: pass returns the fn's value unchanged", ret, 42);
  eq("off: pass created no stats slot", Object.keys(stats).length, 0);
}

console.log("\n2. harness ACCUMULATES correctly when ON");
{
  var ON = false, stats = {};
  function slot(l) { return stats[l] || (stats[l] = { crawls: 0, nodes: 0, passes: 0, totalMs: 0, maxMs: 0 }); }
  var perf = {
    on: function () { ON = true; }, reset: function () { stats = {}; },
    crawl: function (l, n) { if (!ON) return; var s = slot(l); s.crawls++; if (typeof n === "number") s.nodes += n; },
    pass: function (l, fn) { if (!ON) return fn(); var s = slot(l); s.passes++; return fn(); },
    rows: function () { return Object.keys(stats).map(function (k) { var s = stats[k]; return { module: k, crawls: s.crawls, nodesVisited: s.nodes, passes: s.passes }; }); }
  };
  perf.on();
  perf.crawl("ir", 1200); perf.crawl("ir", 800);
  perf.pass("ir", function () {}); perf.pass("ir", function () {});
  var s = stats.ir;
  ok("two crawls summed (2 crawls, 2000 nodes)", s.crawls === 2 && s.nodes === 2000);
  ok("two passes counted", s.passes === 2);
  // multiple modules tracked independently
  perf.crawl("data-graph", 5000); perf.pass("data-graph", function () {});
  var rows = perf.rows();
  eq("report lists each module as its own row", rows.length, 2);
  ok("per-module isolation (ir vs data-graph don't mix)", stats.ir.nodes === 2000 && stats["data-graph"].nodes === 5000);
  perf.reset();
  eq("reset clears all stats", Object.keys(stats).length, 0);
}

console.log("\n3. the GUARD contract — a missing harness must never crash a module");
{
  // mirror the call-site guard:  try { if (window.__dcPerf) window.__dcPerf.pass("ir", write); else write(); } catch {}
  function callSite(win, write) {
    try { if (win.__dcPerf) win.__dcPerf.pass("ir", write); else write(); } catch (e) { /* module keeps working */ }
  }
  var ran = 0;
  callSite({}, function () { ran++; });                      // no harness (public build) → still runs
  eq("no harness → the decorate pass still runs (feature unaffected)", ran, 1);
  var ran2 = 0;
  callSite({ __dcPerf: { pass: function (l, fn) { return fn(); } } }, function () { ran2++; });
  eq("harness present → pass runs the same fn", ran2, 1);
}

console.log("\n4. source presence — harness shape, VDI-safety, and the 3 modules wired + guarded");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  // harness
  ok("perf harness present", /function dcPerfHarness\(\)/.test(src) && /window\.__dcPerf = api/.test(src));
  ok("ZERO cost when OFF (crawl early-returns, pass passes the fn through)",
    /crawl: function \(label, nodes\) \{ if \(!ON\) return;/.test(src) && /pass: function \(label, fn\) \{ if \(!ON\) return fn\(\);/.test(src));
  ok("pass RETURNS the fn's value (behavior-preserving wrap, never swallows output)", /return fn\(\);/.test(src) && /try \{ return fn\(\); \} finally/.test(src));
  ok("report via console.table (+ fallback)", /report: function/.test(src) && /console\.table/.test(src) && /console\.log\(rows\)/.test(src));

  // the universal prototype must be GONE
  ok("REMOVED: universal module no longer present", !/function dcUniversalApiModule/.test(src) && !/__dcToggleUniversalApi/.test(src) && !/dc-uni-bar/.test(src) && !/dc-uni-api/.test(src));

  // the 3 hot modules wired (guarded)
  ok("INSTRUMENTED: IR crawl + decorate pass report to __dcPerf (guarded)",
    /window\.__dcPerf\.crawl\("ir"/.test(src) && /window\.__dcPerf\.pass\("ir", function \(\) \{ irClear\(\); irDecorate\(\); \}\)/.test(src));
  ok("INSTRUMENTED: Data Graph crawl + decorate pass report to __dcPerf (guarded)",
    /window\.__dcPerf\.crawl\("data-graph"/.test(src) && /window\.__dcPerf\.pass\("data-graph", _dgWrite\)/.test(src));
  ok("INSTRUMENTED: DMO origin crawl + decorate pass report to __dcPerf (guarded)",
    /window\.__dcPerf\.crawl\("dmo-origin"/.test(src) && /window\.__dcPerf\.pass\("dmo-origin", function \(\) \{ doClear\(\); doDecorate\(\); \}\)/.test(src));
  ok("every window.__dcPerf call site is GUARDED by `if (window.__dcPerf)` (no hard dependency)",
    (function () {
      var lines = src.split("\n").filter(function (l) { return /window\.__dcPerf\.(crawl|pass)\(/.test(l); });
      return lines.length >= 6 && lines.every(function (l) { return /if \(window\.__dcPerf\)/.test(l); });
    })());
  // each instrumented module keeps its NON-perf fallback (the decorate still runs with no harness)
  ok("IR fallback: `else { irClear(); irDecorate(); }`", /else \{ irClear\(\); irDecorate\(\); \}/.test(src));
  ok("Data Graph fallback: `else _dgWrite\\(\\)` + catch runs it", /else _dgWrite\(\);/.test(src) && /catch \(e\) \{ _dgWrite\(\); \}/.test(src));
  ok("DMO origin fallback: `else { doClear(); doDecorate(); }`", /else \{ doClear\(\); doDecorate\(\); \}/.test(src));

  // dev-only
  ok("DEV-ONLY: perf harness module stripped from public", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/function dcPerfHarness/.test(strip); })());
  ok("DEV-ONLY: no __dcPerf reference survives the strip (the wired modules are all dev-only too)",
    (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/__dcPerf/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function dcPerfHarness\(\)/.test(bm));
  ok("strip markers stay balanced after the universal removal", (bm.match(/@strip:start/g) || []).length === (bm.match(/@strip:end/g) || []).length);
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
