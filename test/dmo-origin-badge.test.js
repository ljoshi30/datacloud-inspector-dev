// DMO field-origin badge (Standard / Custom / System) — pure logic + source-presence. Run in Node.
//   node test/dmo-origin-badge.test.js
//
// Feature: on a DMO detail Fields tab, badge each field with its creationType — Standard
// (product-given), Custom (hand-created), or System (internal). Works on ANY org / ANY DMO:
// reads SF's own datatable data, maps the row by its OWN key (never a blind index guess).
//
// PROVEN DOM (DOM Probe v51 on the live org, DMO TDI_UnifiedIndividualApp1__dlm):
//   <runtime_cdp-custom-datatable> with an "isMapped" column = the field table.
//     keyField:"name"  data[] = { name:"X__c", label, creationType:"Standard"|"Custom"|"System" }
//     rendered <tr> data-row-key-value = the field's `name` (== keyField value)
//     dataLen 19 == renderedRowCount 19; creationType seen {Custom:8, Standard:10, System:1}

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirror of doStyleFor: map a creationType to a badge spec (or null to show nothing). ──
function styleFor(ct) {
  var c = String(ct || "").toLowerCase();
  if (c === "custom") return { label: "Custom", tone: "warm" };
  if (c === "standard") return { label: "Standard", tone: "neutral" };
  if (c === "system") return { label: "System", tone: "muted" };
  if (!c) return null;
  return { label: String(ct), tone: "neutral" };   // forward-safe: unknown value shown verbatim
}

console.log("\n1. three real origins render distinctly; blank shows NOTHING (never guess)");
{
  eq("Standard → product-given badge", styleFor("Standard").label, "Standard");
  eq("Custom → hand-created badge", styleFor("Custom").label, "Custom");
  eq("System → internal badge", styleFor("System").label, "System");
  eq("Custom is the standout tone", styleFor("Custom").tone, "warm");
  ok("blank creationType → null (no badge, not a wrong one)", styleFor("") === null && styleFor(null) === null && styleFor(undefined) === null);
  ok("case-insensitive (SF casing varies)", styleFor("custom").label === "Custom" && styleFor("STANDARD").label === "Standard");
  // a value SF might add later must not crash or vanish silently
  eq("unknown future value shown verbatim", styleFor("Managed").label, "Managed");
}

// ── Mirror of doDecorate's row→origin resolution: map by the row's OWN key, not by index. ──
function keyField(dt) { var k = dt.keyField; return (typeof k === "string" && k) ? k : "name"; }
function buildMap(dt) {
  var data = dt.data || [], kf = keyField(dt), map = {};
  for (var i = 0; i < data.length; i++) { var r = data[i]; if (r && r[kf] != null) map[String(r[kf])] = r.creationType; }
  return map;
}
// given a rendered row's key, what origin do we badge it with? (null = skip)
function originForRowKey(dt, rowKey) {
  if (rowKey == null) return null;                       // no key → never guess
  var map = buildMap(dt);
  if (!Object.prototype.hasOwnProperty.call(map, String(rowKey))) return null;
  return map[String(rowKey)];
}

console.log("\n2. each row is badged by ITS OWN key (data-row-key-value ↔ data[].name) — exact, dup-proof");
{
  var dt = {
    keyField: "name",
    data: [
      { name: "TDI_Account_Multiline__c", label: "Account Multiline", creationType: "Custom" },
      { name: "BirthDt__c", label: "Birth Date", creationType: "Standard" },
      { name: "Id__c", label: "Id", creationType: "System" }
    ]
  };
  eq("row key TDI_Account_Multiline__c → Custom", originForRowKey(dt, "TDI_Account_Multiline__c"), "Custom");
  eq("row key BirthDt__c → Standard", originForRowKey(dt, "BirthDt__c"), "Standard");
  eq("row key Id__c → System", originForRowKey(dt, "Id__c"), "System");
  eq("unknown row key → null (skip, never a wrong badge)", originForRowKey(dt, "Not_A_Field__c"), null);
  eq("null row key → null", originForRowKey(dt, null), null);
}

console.log("\n3. two fields sharing a LABEL still get their own origin (keyed by name, not label)");
{
  var dt = {
    keyField: "name",
    data: [
      { name: "TDI_Account_Multiline__c", label: "Account Multiline", creationType: "Custom" },
      { name: "TDI_GI_Account_Multiline__c", label: "Account Multiline", creationType: "Standard" }
    ]
  };
  eq("dup-label A → its own origin (Custom)", originForRowKey(dt, "TDI_Account_Multiline__c"), "Custom");
  eq("dup-label B → its own origin (Standard), not A's", originForRowKey(dt, "TDI_GI_Account_Multiline__c"), "Standard");
}

console.log("\n4. VIRTUALIZATION-safe: a row order change can't mislabel — key lookup, not index");
{
  // data in one order; the DOM happens to render a WINDOW in a different order (as virtual scroll does)
  var dt = {
    keyField: "name",
    data: [
      { name: "A__c", label: "A", creationType: "Standard" },
      { name: "B__c", label: "B", creationType: "Custom" },
      { name: "C__c", label: "C", creationType: "System" }
    ]
  };
  // rendered rows appear as [C, A] (scrolled) — index 0 would wrongly say C is "Standard"
  eq("rendered row 0 is C → System (NOT data[0]=Standard)", originForRowKey(dt, "C__c"), "System");
  eq("rendered row 1 is A → Standard", originForRowKey(dt, "A__c"), "Standard");
  ok("index-based mapping WOULD have been wrong here", "System" !== dt.data[0].creationType);
}

console.log("\n5. ALL rows covered + counts (not a fixed list; org-agnostic loop)");
{
  var dt = {
    keyField: "name",
    data: [
      { name: "a__c", creationType: "Custom" }, { name: "b__c", creationType: "Custom" },
      { name: "c__c", creationType: "Standard" }, { name: "d__c", creationType: "System" },
      { name: "e__c", creationType: "" }   // blank — not counted/badged
    ]
  };
  var badged = dt.data.filter(function (r) { return styleFor(r.creationType); });
  eq("4 of 5 fields get a badge (blank excluded)", badged.length, 4);
  var byOrigin = { Custom: 0, Standard: 0, System: 0 };
  badged.forEach(function (r) { byOrigin[styleFor(r.creationType).label]++; });
  ok("per-origin counts match the data", byOrigin.Custom === 2 && byOrigin.Standard === 1 && byOrigin.System === 1);
}

console.log("\n6. signature changes only when the visible set/origins change (dirty-check → no churn)");
{
  // model doSignature over a list of {key, origin} visible rows
  function sig(rows) { return rows.map(function (r) { return r.key + "=" + r.origin; }).join("|"); }
  var a = [{ key: "x__c", origin: "Custom" }, { key: "y__c", origin: "Standard" }];
  var b = [{ key: "x__c", origin: "Custom" }, { key: "y__c", origin: "Standard" }];
  var c = [{ key: "x__c", origin: "Standard" }, { key: "y__c", origin: "Standard" }]; // x changed origin
  ok("identical visible set → same signature (skip redraw)", sig(a) === sig(b));
  ok("changed origin → different signature (redraw)", sig(a) !== sig(c));
}

console.log("\n7. source presence — proven props, org-agnostic, VDI-safe scaffolding, dev-only");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("module present", /function dcDmoOriginModule\(\)/.test(src));
  ok("gated to a DMO detail page only (standard-DataModel + c__objectApiName)",
    /c__objectApiName=\[a-zA-Z0-9_\]\+/.test(src) && /standard-DataModel/.test(src) && /function dcDmoOriginModule\(\)\s*\{\s*try \{ if \(!\/c__objectApiName/.test(src));
  ok("reads creationType off the field table's data[] (SF's own prop — no API call)",
    /doSafe\(r, "creationType"\)/.test(src) || /doSafe\(r, 'creationType'\)/.test(src));
  ok("three origins styled distinctly; blank → null (no badge); unknown shown verbatim",
    /function doStyleFor/.test(src) && /=== "custom"/.test(src) && /=== "standard"/.test(src) && /=== "system"/.test(src) && /if \(!c\) return null;/.test(src));
  ok("maps row by its OWN key (data-row-key-value ↔ data[keyField]) — NOT a blind index align",
    /function doRowKey/.test(src) && /data-row-key-value/.test(src) && /function doKeyField/.test(src) && /hasOwnProperty\.call\(map, String\(key\)\)/.test(src));
  ok("ORG-AGNOSTIC: loops ALL field tables + ALL rows found (no hardcoded field list)",
    /_doTables\.forEach/.test(src) && /doDataRows\(dt\)\.forEach/.test(src));
  ok("anchors the badge in the row's 'Field Label' cell (not a cell-index guess)",
    /function doLabelCell/.test(src) && /field label/i.test(src));
  ok("ONE shadow crawl per pass (doCollect) — not per-move (VDI-safe)",
    /function doCollect/.test(src) && /q\[i\]\.shadowRoot/.test(src) && /runtime_cdp-custom-datatable/.test(src));
  ok("VDI FAST PATH: reuse cached table if still connected (no full re-crawl on every SF re-render)",
    /VDI FAST PATH/.test(src) && /if \(_doTables\.length\)/.test(src) && /\.isConnected/.test(src) && /0 nodes = reused cache/.test(src));
  ok("FAB row shows a clear ON indicator (green ● ON + active tint) so the active state is visible",
    /const doPaint = \(\) =>/.test(src) && /● ON/.test(src) && /rgba\(52,211,153,\.12\)/.test(src) && /dmoOriginRow\.onclick =[\s\S]{0,160}doPaint\(\);/.test(src));
  ok("unstackable dedup: tracked badges cleared by reference each pass", /var _doSpans = \[\]/.test(src) && /function doClear/.test(src) && /_doSpans\.push\(sp\)/.test(src));
  ok("VDI: doClear is reference-only (no full-doc crawl every pass — doRun already crawls once)",
    /function doClear\(\)\s*\{[\s\S]{0,160}_doSpans\[i\]\.remove[\s\S]{0,80}_doSpans = \[\];\s*\}/.test(src) && !/function doClear[\s\S]{0,220}eachElement\(document/.test(src));
  ok("NO DOUBLE badge: ONE-TIME load sweep removes a prior instance's leftover badges",
    /One-time cleanup on load/.test(src) && /el\.classList\.contains\("dc-do-badge"\)/.test(src));
  ok("signature guard skips no-op redraws (no flicker/churn)", /function doSignature/.test(src) && /sig === _doSig/.test(src));
  ok("observer DISCONNECTS while writing (no feedback loop / VDI peg)",
    /_doWriting = true;/.test(src) && /if \(_doObs\) _doObs\.disconnect\(\);/.test(src) && /if \(_doWriting \|\| _doT\) return;/.test(src));
  ok("VDI: the observer re-run is DEBOUNCED (bursty virtual-scroll mutations collapse to one)",
    /function doSchedule\(\) \{ if \(_doWriting \|\| _doT\) return; _doT = setTimeout/.test(src));
  ok("decorates only VISIBLE tables/rows (skip stale cached DOM)", /if \(!isVisible\(dt\)\) return;/.test(src) && /if \(!isVisible\(row\)\) return;/.test(src));
  ok("toggle + default OFF", /window\.__dcToggleDmoOrigin/.test(src) && /window\.__dcDmoOriginIsOn/.test(src) && /var DO_ON = false;/.test(src));
  ok("count fn so the FAB offers the toggle only when fields carry an origin", /window\.__dcDmoOriginCount/.test(src));
  ok("stop() clears + disconnects (no leak)", /function doStop/.test(src) && /doClear\(\)/.test(src));
  ok("FAB row wired on the DMO page, runtime-gated by the toggle fn + count>0",
    /detailPageType === "DMO" &&/.test(src) && /typeof window\.__dcToggleDmoOrigin === "function"/.test(src) && /window\.__dcDmoOriginCount\(\) > 0/.test(src) && /dmoOriginRow/.test(src));
  // DEV-ONLY: the MODULE (which DEFINES window.__dcToggleDmoOrigin) is stripped from public, so
  // the toggle fn is never defined there and the typeof-guarded FAB row never appears. The FAB
  // row's `typeof window.__dcToggleDmoOrigin === "function"` reference lives OUTSIDE a strip block
  // (it's the shared launcher), so that string legitimately survives — exactly like the segment
  // (__dcToggleSegApi) and formula (__dcToggleDsFormula) rows. The correct dev-only assertion is
  // therefore: the module definition is absent, AND no code DEFINES the toggle (only references it).
  ok("DEV-ONLY: module definition stripped from the public bookmarklet", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/function dcDmoOriginModule/.test(strip); })());
  ok("DEV-ONLY: public build never DEFINES the toggle (only the guarded FAB reference remains)",
    (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/window\.__dcToggleDmoOrigin\s*=[^=]/.test(strip) && !/function doStart/.test(strip); })());
  // sanity: this module is gated the same way the shipped seg/formula rows are (consistency)
  ok("same runtime-gating pattern as the already-shipped seg/formula FAB rows",
    (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return /typeof window\.__dcToggleDmoOrigin === "function"/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function dcDmoOriginModule\(\)/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
