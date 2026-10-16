// Mapping-canvas launcher UI tests — run in Node.
//   node test/mapping-canvas-ui.test.js
//
// Locks the UX changes on the DLO→DMO mapping canvas launcher:
//   1. Buttons show a clear ENABLED state (green ● ON + a confirming subtitle) — this only
//      works because the label/subtitle spans carry .dc-lbl / .dc-sub (without them the
//      relabel in updateBadge silently no-ops, which was the "can't tell it's on" bug).
//   2. The destructive "Remove" row is gone; a top-right × CLOSES the menu (re-click the
//      bookmark to uninstall).
//   3. Pinned API names (both render paths: .dc-api-inline and mkSpan .dc-*api-inline) are
//      CLICK-TO-COPY and copy the CLEAN api (dataset.api), never the " (?)" display marker.
//   4. A brief confirmation toast (#dc-map-toast) fires on enable.
// Mix of source-presence (wiring) + a BEHAVIOR check that runs the clean-api copy logic.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

console.log("\n1. buttons carry .dc-lbl/.dc-sub so the ON state can actually render");
{
  ok("mkBtn label span has class dc-lbl", /<span class='dc-lbl'/.test(src));
  ok("mkBtn subtitle span has class dc-sub", /<span class='dc-sub'/.test(src));
  ok("updateBadge shows a green ● ON in the label when active", /API Tooltip <span style='color:#34d399[^>]*>● ON<\/span>/.test(src));
  ok("updateBadge sets a confirming subtitle when enabled", /Enabled — hover any field to see its API name/.test(src));
  ok("pin button subtitle confirms click-to-copy when on", /Pinned — click any name to copy it/.test(src));
}

console.log("\n2. Remove row replaced by a top-right × that closes the menu — on EVERY launcher");
{
  // The destructive "Remove" dismissRow is gone from ALL launchers (re-click the bookmark to
  // uninstall; its guard sets __dcOff directly). Every launcher now gets the shared close-×.
  ok("no dismissRow 'Remove' rows remain in any launcher", !/dismissRow/.test(src));
  ok("shared dcMakeMenuCloseX helper defined (× that calls closeMenu, not uninstall)", /function dcMakeMenuCloseX\(closeMenu\)/.test(src) && /try \{ closeMenu\(\); \} catch/.test(src));
  ok("× is NOT destructive (never calls dcFullOff)", !/dcMakeMenuCloseX[\s\S]{0,400}dcFullOff/.test(src));
  // used by all 4 launchers: mapping, explore, activation, detail (1 def + 4 call sites = 5)
  ok("close-× wired into every launcher (>=4 call sites)", (src.match(/dcMakeMenuCloseX\(/g) || []).length >= 5);
}

console.log("\n3. pinned API names are click-to-copy (both render paths), copy the CLEAN api");
{
  // .dc-api-inline path (source-side single span)
  ok(".dc-api-inline stores clean api in dataset.api", /span\.dataset\.api = apiName;/.test(src));
  // The handler is: compute clean → define flash() → clipboard.writeText(clean).then(flash,…).
  var inlineHandler = src.slice(src.indexOf('span.addEventListener("click"'), src.indexOf('root.appendChild(span);'));
  ok(".dc-api-inline has a click handler that copies the clean api", /navigator\.clipboard\.writeText\(clean\)/.test(inlineHandler) && /var clean = span\.dataset\.api/.test(inlineHandler));
  ok(".dc-api-inline flashes ✓ Copied then restores", /span\.textContent = "✓ Copied"[\s\S]{0,200}span\.textContent = restore/.test(inlineHandler));
  // mkSpan path (header/table .dc-sapi-inline / .dc-tapi-inline)
  ok("mkSpan stores clean api in dataset.api", /sp\.dataset\.api = text;/.test(src));
  ok("mkSpan has a copy click handler", /sp\.addEventListener\("click",[\s\S]{0,500}navigator\.clipboard\.writeText\(clean\)/.test(src));
  ok("pinned names advertise 'Click to copy' in the title", /setAttribute\("title", "Click to copy " \+ apiName\)/.test(src) && /"Click to copy " \+ text/.test(src));
  ok("copy falls back to execCommand when clipboard API unavailable", /document\.execCommand\("copy"\)/.test(src));
}

console.log("\n4. enable toast fires (#dc-map-toast), auto-dismiss, teardown-swept");
{
  ok("dcMapToast helper defined", /function dcMapToast\(msg\)/.test(src));
  ok("toast id is dc-map-toast (so the [id^='dc-'] teardown removes it)", /_dcMapToastEl\.id = "dc-map-toast"/.test(src));
  ok("toggle() fires the toast on enable", /dcMapToast\("✓ <b>API Tooltip on<\/b>/.test(src));
  ok("pin fires the toast on enable", /dcMapToast\("✓ <b>Pinned /.test(src));
  ok("toast auto-dismisses (~2s)", /_dcMapToastT = setTimeout\(function \(\)[\s\S]{0,120}\}, 2000\)/.test(src));
}

console.log("\n5. BEHAVIOR: copy uses the CLEAN api, never the '(?)' display marker");
{
  // Mirror of the exact clean-api expression used in the .dc-api-inline click handler:
  //   var clean = span.dataset.api || span.textContent.replace(/\s*\(\?\)\s*$/, "");
  function cleanApi(datasetApi, shownText) {
    return datasetApi || shownText.replace(/\s*\(\?\)\s*$/, "");
  }
  eq("uncertain display '(?)' is stripped when dataset.api missing", cleanApi(undefined, "Foo__c (?)"), "Foo__c");
  eq("dataset.api wins (always clean) even if text has the marker", cleanApi("Foo__c", "Foo__c (?)"), "Foo__c");
  eq("plain name unchanged", cleanApi(undefined, "Bar__dlm"), "Bar__dlm");
  eq("trailing spaces around marker handled", cleanApi(undefined, "Baz__c  (?)  "), "Baz__c");
}

console.log("\n5b. export modals close ONLY via × / Escape — NOT on click-outside");
{
  // Reported: clicking anywhere on the page closed the export modal (together with the menu).
  // The click-outside closers were removed from the mapping export AND the detail-page export
  // modals (DMO / DLO / Data Stream). They keep × and Escape. (Data Explorer's column modal is
  // a separate feature and intentionally still closes on outside-click — not touched here.)
  ok("mapping export has NO click-outside closer (onDocDown removed)", !/onDocDown = \(e\) =>/.test(src));
  ok("mapping export still closes on Escape", /onKey = \(e\) => \{ if \(e\.key === "Escape"\) closeExport\(\); \}/.test(src));
  ok("mapping export still has an × close button", /#dc-x-close"\)\.onclick = closeExport/.test(src));
  // detail-page export modals: the onOut pointerdown closers are gone; onEsc stays.
  ok("detail export modals have NO onOut click-outside closers", !/onOut\s*=\s*\(e\)\s*=>\s*\{\s*if\s*\(detailExportEl/.test(src));
  ok("detail export modals still close on Escape (onEsc kept)", /onEsc\s*=\s*\(e\)\s*=>\s*\{\s*if\s*\(e\.key\s*===\s*"Escape"\)\s*\{\s*closeDetail\(\)/.test(src));
  ok("detail export modals still have an × close (dc-d-close)", /#dc-d-close"\)\.onclick = closeDetail/.test(src));
}

console.log("\n6. synced into the bookmarklet build too");
{
  ok("dc-lbl label + ON state synced", /<span class='dc-lbl'/.test(bm) && /● ON/.test(bm));
  ok("shared close-× synced + no dismissRow", /function dcMakeMenuCloseX\(closeMenu\)/.test(bm) && !/dismissRow/.test(bm));
  ok("click-to-copy pinned names synced", /span\.dataset\.api = apiName;/.test(bm) && /sp\.dataset\.api = text;/.test(bm));
  ok("enable toast synced", /function dcMapToast\(msg\)/.test(bm));
  ok("export modals no-click-outside synced", !/onDocDown = \(e\) =>/.test(bm) && !/onOut\s*=\s*\(e\)\s*=>\s*\{\s*if\s*\(detailExportEl/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
