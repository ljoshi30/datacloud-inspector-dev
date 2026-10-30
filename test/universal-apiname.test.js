// Universal "API names" controller + generic best-effort decorator + VDI perf harness.
// Pure logic + source-presence. Run in Node:  node test/universal-apiname.test.js
//
// PROTOTYPE (dev-only) for the "show API names everywhere without a probe" idea. Two tiers:
//   TIER 1 — a REGISTRY over the EXACT probed readers already shipped (Data Graph / IR / Segment);
//            one button drives whichever matches the page. No new guessing; references their toggles.
//   TIER 2 — a GENERIC best-effort decorator for NEVER-probed pages: read a UNION VOCABULARY of the
//            prop names our curated readers proved exist across SF's components. Marked best-effort.
// VDI perf harness (__dcPerf) = measurement foundation for the someday optimization pass.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirror of looksApi / preferApi / bestApiOn (the generic tier's core) ──
var API_SUFFIX = /__(c|dlm|dll|dls|cio|e|mdt|r|b|x|hd|s)$/i;
function looksApi(v) {
  if (typeof v !== "string") return false;
  var s = v.trim();
  if (s.length < 3 || s.length > 120) return false;
  if (/\s/.test(s)) return false;
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)?$/.test(s)) return false;
  return API_SUFFIX.test(s) || /__/.test(s);
}
function preferApi(a, b) {
  if (!a) return b; if (!b) return a;
  var aw = API_SUFFIX.test(a), bw = API_SUFFIX.test(b);
  if (aw !== bw) return aw ? a : b;
  return b.length > a.length ? b : a;
}
var DIRECT = ["objectApiName", "fieldApiName", "developerName", "apiName", "fullName", "devName", "fieldDeveloperName", "entityApiName", "fieldId", "value"];
var OBJS = ["node", "attributeNode", "groupNode", "entity", "subject", "filter", "filterGroup"];
var SUB = ["objectApiName", "fieldApiName", "apiName", "developerName", "devName", "id", "value", "name"];
function uSafe(o, k) { try { return o[k]; } catch (e) { return undefined; } }
function bestApiOn(el) {
  var best = null, i, v;
  for (i = 0; i < DIRECT.length; i++) { v = uSafe(el, DIRECT[i]); if (looksApi(v)) best = preferApi(best, String(v)); }
  for (i = 0; i < OBJS.length; i++) {
    var o = uSafe(el, OBJS[i]);
    if (o && typeof o === "object" && o.nodeType === undefined) {
      for (var j = 0; j < SUB.length; j++) { v = uSafe(o, SUB[j]); if (looksApi(v)) best = preferApi(best, String(v)); }
    }
  }
  return best;
}

console.log("\n1. looksApi — accepts real api shapes, rejects labels/sentences/guids");
{
  ok("Custom field X__c", looksApi("Account_Multiline__c"));
  ok("DMO __dlm", looksApi("ssot__ContactPointEmail__dlm"));
  ok("DLO __dll / data stream __dls", looksApi("My_Stream__dll") && looksApi("Foo__dls"));
  ok("qualified Obj.Field with __", looksApi("ssot__Account__dlm.City__c"));
  ok("reject human label (space)", !looksApi("Account Multiline"));
  ok("reject plain word (no __ / no suffix)", !looksApi("Standard"));
  ok("reject enum like EXACT", !looksApi("EXACT"));
  ok("reject a GUID-ish long value", !looksApi("0Xxff0000000000AAA111222333444555"));
  ok("reject empty / too short", !looksApi("") && !looksApi("a"));
  ok("non-string → false", !looksApi(null) && !looksApi(42) && !looksApi({}));
}

console.log("\n2. preferApi — a recognized suffix beats bare __, else the more specific (longer)");
{
  eq("suffix beats bare __", preferApi("ns__Account", "Account__c"), "Account__c");
  eq("longer wins when both suffixed", preferApi("A__c", "Account_Multiline__c"), "Account_Multiline__c");
  eq("null-safe left", preferApi(null, "X__c"), "X__c");
  eq("null-safe right", preferApi("X__c", null), "X__c");
}

console.log("\n3. bestApiOn — reads the UNION VOCABULARY (direct props + known data objects)");
{
  eq("direct objectApiName", bestApiOn({ objectApiName: "ssot__Individual__dlm" }), "ssot__Individual__dlm");
  eq("direct fieldId (IR row shape)", bestApiOn({ fieldId: "TDI_Account__c", label: "Account" }), "TDI_Account__c");
  eq("combobox-style .value", bestApiOn({ label: "Field", value: "EmailAddress__c" }), "EmailAddress__c");
  eq("nested node.objectApiName (Data Graph tree shape)", bestApiOn({ node: { objectApiName: "ssot__Acct__dlm", label: "Acct" } }), "ssot__Acct__dlm");
  eq("nested attributeNode.fieldApiName (segment shape)", bestApiOn({ attributeNode: { fieldApiName: "City__c", label: "City" } }), "City__c");
  eq("nested entity.id (IR DMO section shape)", bestApiOn({ entity: { id: "TDI_Individual__dlm", label: "Individual" } }), "TDI_Individual__dlm");
  eq("no api-looking prop → null (don't chip)", bestApiOn({ label: "Just A Label", value: "EXACT" }), null);
  ok("a DOM node in an obj slot is IGNORED (nodeType defined)", bestApiOn({ node: { nodeType: 1, objectApiName: "x__c" } }) === null);
  eq("picks the most specific among several", bestApiOn({ apiName: "A__c", objectApiName: "Account_Long__dlm" }), "Account_Long__dlm");
}

// ── TIER-1 registry routing ──
var REG = [
  { id: "dg",  matches: function (h) { return /standard-DataModel/i.test(h) && /displayType=graph|c__displayType=graph/i.test(h); }, toggleName: "__dcToggleDgApi", isOnName: "__dcDgApiIsOn" },
  { id: "ir",  matches: function (h) { return /\/r\/IdentityResolution\//i.test(h); }, toggleName: "__dcToggleIrApi", isOnName: "__dcIrApiIsOn" },
  { id: "seg", matches: function (h) { return /\/r\/Segment\//i.test(h) || /segmentWizard/i.test(h); }, toggleName: "__dcToggleSegApi", isOnName: "__dcSegApiIsOn" }
];
function curatedActive(href, win) { return REG.filter(function (r) { try { return r.matches(href) && typeof win[r.toggleName] === "function"; } catch (e) { return false; } }); }

console.log("\n4. controller routes to CURATED when a probed reader matches the page; else GENERIC");
{
  var win = { __dcToggleDgApi: function () {}, __dcToggleIrApi: function () {}, __dcToggleSegApi: function () {} };
  var irHref = "https://x.lightning.force.com/lightning/r/IdentityResolution/abc123def456ghi/view";
  var dgHref = "https://x.lightning.force.com/lightning/n/standard-DataModel?c__displayType=graph";
  var unknownHref = "https://x.lightning.force.com/lightning/r/DataLakeObjectInstance/abc123def456ghi/view";
  eq("IR page → curated 'ir'", curatedActive(irHref, win).map(r => r.id).join(","), "ir");
  eq("Data Graph page → curated 'dg'", curatedActive(dgHref, win).map(r => r.id).join(","), "dg");
  eq("un-probed page → NO curated reader → generic tier", curatedActive(unknownHref, win).length, 0);
  // if the module didn't load (toggle missing), it is NOT considered active even on a matching URL
  eq("matching URL but reader not loaded → not active", curatedActive(irHref, {}).length, 0);
  // mode decision the controller makes:
  ok("mode = curated when any active, generic otherwise",
    (curatedActive(irHref, win).length ? "curated" : "generic") === "curated" &&
    (curatedActive(unknownHref, win).length ? "curated" : "generic") === "generic");
}

console.log("\n5. generic honesty — caps are declared, not silent (no fake 'covered everything')");
{
  // model the cap bookkeeping: collecting with a tiny chip cap flips _genCapped and warns
  var GEN_MAX_CHIPS = 3;
  var found = [{ api: "a__c" }, { api: "b__c" }, { api: "c__c" }, { api: "d__c" }, { api: "e__c" }];
  var kept = [], capped = false;
  for (var i = 0; i < found.length; i++) { if (kept.length < GEN_MAX_CHIPS) kept.push(found[i]); else capped = true; }
  eq("keeps only up to the cap", kept.length, 3);
  ok("records that it was capped (so we can warn — not silently truncate)", capped === true);
}

console.log("\n6. generic signature — stable set → no redraw; changed set → redraw (VDI churn guard)");
{
  function sig(cands) { var p = cands.map(c => c.api); p.sort(); return p.join("|"); }
  var a = [{ api: "b__c" }, { api: "a__c" }];
  var b = [{ api: "a__c" }, { api: "b__c" }];   // same set, different order
  var c = [{ api: "a__c" }, { api: "z__c" }];
  ok("order-independent: same set → same signature", sig(a) === sig(b));
  ok("different set → different signature", sig(a) !== sig(c));
}

console.log("\n7. VDI perf harness — zero cost off, accumulates when on");
{
  // mirror of __dcPerf
  var ON = false, stats = {};
  function slot(l) { return stats[l] || (stats[l] = { crawls: 0, nodes: 0, passes: 0, totalMs: 0, maxMs: 0 }); }
  var perf = {
    on: function () { ON = true; }, off: function () { ON = false; },
    crawl: function (l, n) { if (!ON) return; var s = slot(l); s.crawls++; if (typeof n === "number") s.nodes += n; },
    pass: function (l, fn) { if (!ON) return fn(); var s = slot(l); s.passes++; return fn(); }
  };
  perf.crawl("m", 100);                       // off → ignored
  eq("off: crawl is a no-op", Object.keys(stats).length, 0);
  var ran = 0; perf.pass("m", function () { ran++; });
  ok("off: pass still runs the fn (just untimed)", ran === 1 && Object.keys(stats).length === 0);
  perf.on();
  perf.crawl("m", 250); perf.pass("m", function () {});
  ok("on: accumulates crawls + nodes + passes", stats.m.crawls === 1 && stats.m.nodes === 250 && stats.m.passes === 1);
}

console.log("\n8. source presence — registry, generic vocab, VDI-safety, one controller, dev-only");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  // perf harness
  ok("perf harness present", /function dcPerfHarness\(\)/.test(src) && /window\.__dcPerf = api/.test(src));
  ok("perf: zero cost when OFF (crawl/pass early-return / passthrough)", /crawl: function \(label, nodes\) \{ if \(!ON\) return;/.test(src) && /pass: function \(label, fn\) \{ if \(!ON\) return fn\(\);/.test(src));
  ok("perf: report via console.table", /report: function/.test(src) && /console\.table/.test(src));

  // universal module
  ok("universal module present", /function dcUniversalApiModule\(\)/.test(src));
  ok("gated to Data Cloud pages only (not every SF page)", /function onDataCloud/.test(src) && /if \(!onDataCloud\(\)\) return;/.test(src));
  ok("TIER 1: registry REFERENCES existing toggles (never redefines them)",
    /var REG = \[/.test(src) && /toggleName: "__dcToggleDgApi"/.test(src) && /toggleName: "__dcToggleIrApi"/.test(src) && /toggleName: "__dcToggleSegApi"/.test(src) &&
    !/window\.__dcToggleDgApi = function/.test(src.slice(src.indexOf("dcUniversalApiModule"))));   // module doesn't define them
  ok("TIER 1: only counts a reader active when its module actually loaded (typeof toggle === function)",
    /typeof window\[r\.toggleName\] === "function"/.test(src));
  ok("TIER 2: generic looksApi with Data Cloud suffixes + __ fallback", /var API_SUFFIX = \/__\(c\|dlm\|dll\|dls\|cio\|e/.test(src) && /function looksApi/.test(src));
  ok("TIER 2: UNION VOCABULARY from the curated readers' proven props", /var DIRECT = \[/.test(src) && /objectApiName/.test(src) && /fieldApiName/.test(src) && /fieldId/.test(src) && /var OBJS = \[/.test(src) && /attributeNode/.test(src) && /entity/.test(src));
  ok("TIER 2: ignores DOM nodes in object slots (nodeType check — don't read the DOM tree as data)", /o\.nodeType === undefined/.test(src));
  ok("TIER 2: chips are visibly BEST-EFFORT (dashed border + 'best-effort' title)", /border", "1px dashed/.test(src) && /best-effort \(unverified\)/.test(src));
  ok("ONE controller: uniToggle delegates to curated if present, else generic", /function uniToggle/.test(src) && /if \(cur\.length\)/.test(src) && /if \(GEN_ON\) genStop\(\); else genStart\(\);/.test(src));
  ok("controller drives ALL matching curated readers to the SAME state", /cur\.forEach\(function \(r\)/.test(src) && /if \(on !== turnOn\) window\[r\.toggleName\]\(\);/.test(src));
  ok("exposes controller + introspection globals", /window\.__dcToggleUniversalApi/.test(src) && /window\.__dcUniversalApiIsOn/.test(src) && /window\.__dcApiRegistry/.test(src) && /window\.__dcUniversalMode/.test(src));

  // VDI-safety of the generic tier
  ok("VDI: ONE bounded crawl with a node cap (not unbounded)", /function genCollect/.test(src) && /GEN_MAX_NODES/.test(src) && /visited\+\+ > GEN_MAX_NODES/.test(src));
  ok("VDI: NO SILENT TRUNCATION — caps are logged (console.warn PARTIAL)", /_genCapped/.test(src) && /results are PARTIAL/.test(src));
  ok("VDI: chip cap too (bounded injected-node count)", /GEN_MAX_CHIPS/.test(src) && /cands\.length < GEN_MAX_CHIPS/.test(src));
  ok("VDI: signature dirty-check skips no-op redraws", /function genSignature/.test(src) && /sig === _genSig/.test(src));
  ok("VDI: observer DISCONNECTS while writing + debounced", /_genWriting = true;/.test(src) && /if \(_genObs\) _genObs\.disconnect\(\);/.test(src) && /function genSchedule\(\) \{ if \(_genWriting \|\| _genT\) return;/.test(src));
  ok("VDI: reference-tracked chips, unstackable", /var GEN_ON = false, _genSpans = \[\]/.test(src) && /function genClear/.test(src) && /_genSpans\.push\(sp\)/.test(src));
  ok("VDI: decorates only VISIBLE custom elements", /isVisible\(el\)/.test(src) && /tg\.indexOf\("-"\) > 0/.test(src));
  ok("VDI: default OFF; teardown clears + disconnects", /var GEN_ON = false/.test(src) && /function genStop/.test(src) && /genClear\(\);/.test(src));
  ok("VDI: generic crawl + pass are INSTRUMENTED via __dcPerf (guarded)", /window\.__dcPerf\.crawl\("universal-generic"/.test(src) && /window\.__dcPerf\.pass\("universal-generic"/.test(src));

  // The real hot modules are wired for the measurement pass (guarded so zero-cost off / stripped public)
  ok("INSTRUMENTED: IR crawl + decorate pass report to __dcPerf (guarded)",
    /window\.__dcPerf\.crawl\("ir"/.test(src) && /window\.__dcPerf\.pass\("ir", function \(\) \{ irClear\(\); irDecorate\(\); \}\)/.test(src));
  ok("INSTRUMENTED: Data Graph crawl + decorate pass report to __dcPerf (guarded)",
    /window\.__dcPerf\.crawl\("data-graph"/.test(src) && /window\.__dcPerf\.pass\("data-graph", _dgWrite\)/.test(src));
  ok("INSTRUMENTED: DMO origin crawl + decorate pass report to __dcPerf (guarded)",
    /window\.__dcPerf\.crawl\("dmo-origin"/.test(src) && /window\.__dcPerf\.pass\("dmo-origin", function \(\) \{ doClear\(\); doDecorate\(\); \}\)/.test(src));
  ok("INSTRUMENTATION IS GUARDED: every window.__dcPerf call site sits behind `if (window.__dcPerf)` (no hard dependency)",
    (function () {
      // real call sites use `window.__dcPerf.crawl(` / `window.__dcPerf.pass(` (the harness's own
      // method DEFINITIONS and the doc comment use a bare `__dcPerf.` form → excluded).
      var lines = src.split("\n").filter(function (l) { return /window\.__dcPerf\.(crawl|pass)\(/.test(l); });
      return lines.length >= 4 && lines.every(function (l) { return /if \(window\.__dcPerf\)/.test(l); });
    })());
  ok("INSTRUMENTATION STRIPPED FROM PUBLIC with the modules (no __dcPerf refs survive strip)",
    (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/__dcPerf/.test(strip); })());
  ok("one-time load sweep removes a prior instance's generic chips", /el\.classList\.contains\("dc-uni-api"\)/.test(src));
  ok("launcher is a LEFT-edge teal tab (never collides with bottom-right FAB / bottom-left filter)", /id="dc-uni-bar"/.test(src) === false && /wrap\.id = "dc-uni-bar"/.test(src) && /left:0;top:50%/.test(src) && /#0d9488/.test(src));
  ok("best-effort pages advertise themselves (generic tab shows ± and 'verify' tooltip)", /API ±/.test(src) && /Verify before relying/.test(src));

  // dev-only
  ok("DEV-ONLY: perf harness module stripped from public", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/function dcPerfHarness/.test(strip); })());
  ok("DEV-ONLY: universal module stripped from public", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/function dcUniversalApiModule/.test(strip) && !/__dcToggleUniversalApi/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function dcUniversalApiModule\(\)/.test(bm) && /function dcPerfHarness\(\)/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
