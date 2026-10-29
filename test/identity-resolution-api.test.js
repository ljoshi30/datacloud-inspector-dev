// Identity Resolution API-name decorator — pure logic + source-presence. Run in Node.
//   node test/identity-resolution-api.test.js
//
// Feature: on the IR ruleset page, show each DMO section's API name + each reconciliation field's
// API name (friendly labels only otherwise). Works on ANY org, EVERY DMO — reads Salesforce's own
// component props, nothing hardcoded, loops all sections/rows.
//
// PROVEN DOM (DOM Probe v48/v49 on the real org):
//   <runtime_cdp-identity-resolution-recon-rule-field>.fieldId = "TDI_Account_Multiline__c"  (FIELD api, ON THE ROW — exact, no label match)
//   <runtime_cdp-identity-resolution-recon-table-rules>.entity = { id:"TDI_Individual__dlm" (DMO api), label, fields:[…] }

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

function irSafe(o, k) { try { return o[k]; } catch (e) { return undefined; } }

// Mirror of irDecorate's per-row/section qualify: read api DIRECTLY off the element, require "__".
function rowApi(row) { var a = irSafe(row, "fieldId"); return (a && /__/.test(String(a))) ? String(a) : null; }
function sectionApi(sec) { var e = irSafe(sec, "entity"); return (e && e.id) ? String(e.id) : null; }

console.log("\n1. field api read DIRECTLY off the row (exact — no label matching, no dup-label risk)");
{
  var row = { fieldId: "TDI_Account_Multiline__c", label: "Account Multiline" };
  eq("row → its fieldId", rowApi(row), "TDI_Account_Multiline__c");
  // two fields sharing a label are STILL exact, because we read each row's own fieldId
  var a = { fieldId: "TDI_Account_Multiline__c", label: "Account Multiline" };
  var b = { fieldId: "TDI_GI_Account_Multiline__c", label: "Account Multiline" };
  eq("dup label A → its own api", rowApi(a), "TDI_Account_Multiline__c");
  eq("dup label B → its own api (not confused with A)", rowApi(b), "TDI_GI_Account_Multiline__c");
  eq("row without an api-looking fieldId → null (don't show junk)", rowApi({ fieldId: "plainword", label: "x" }), null);
  eq("row with no fieldId → null", rowApi({ label: "x" }), null);
}

console.log("\n2. DMO section api from entity.id (works for ANY dmo)");
{
  eq("Individual section → TDI_Individual__dlm", sectionApi({ entity: { id: "TDI_Individual__dlm", label: "Individual" } }), "TDI_Individual__dlm");
  eq("Contact Point Email section → its own dmo api", sectionApi({ entity: { id: "ssot__ContactPointEmail__dlm", label: "Contact Point Email" } }), "ssot__ContactPointEmail__dlm");
  eq("section with no entity → null", sectionApi({}), null);
}

console.log("\n3. EVERY row/section is decorated (not a fixed list) — loop covers all");
{
  // model the forEach: given N rows, N api lines are produced (one per row with a valid api)
  var rows = [
    { fieldId: "TDI_A__c", label: "A" }, { fieldId: "TDI_B__c", label: "B" },
    { fieldId: "TDI_C__c", label: "C" }, { fieldId: "bad", label: "D" }
  ];
  var produced = rows.map(rowApi).filter(Boolean);
  eq("3 of 4 rows yield an api (4th has no __ token)", produced.length, 3);
  ok("each api is the row's own", produced[0] === "TDI_A__c" && produced[2] === "TDI_C__c");
}

console.log("\n3b. MATCH CRITERIA modal — combobox .value IS the api (proven v50), skip Match Method");
{
  // Mirror the combo pass: only "Data Model Object"/"Field" dropdowns, value must look like an api.
  function comboApi(cb) {
    var lbl = String(cb.label || "").trim();
    if (!/^(data model object|field)$/i.test(lbl)) return null;
    var v = String(cb.value || "");
    return /__/.test(v) ? v : null;
  }
  eq("Data Model Object dropdown → its dmo api", comboApi({ label: "Data Model Object", value: "TDI_ContactPointEmail__dlm" }), "TDI_ContactPointEmail__dlm");
  eq("Field dropdown → its field api", comboApi({ label: "Field", value: "EmailAddress__c" }), "EmailAddress__c");
  eq("Match Method (EXACT) → null (not an api)", comboApi({ label: "Match Method", value: "EXACT" }), null);
  eq("Field dropdown with no selection → null", comboApi({ label: "Field", value: "" }), null);
  // every criterion row's two api dropdowns are covered (loop, not fixed)
  var combos = [
    { label: "Data Model Object", value: "TDI_ContactPointEmail__dlm" }, { label: "Field", value: "EmailAddress__c" }, { label: "Match Method", value: "EXACT" },
    { label: "Data Model Object", value: "TDI_ContactPointPhone__dlm" }, { label: "Field", value: "FormattedE164PhoneNumber__c" }, { label: "Match Method", value: "EXACT" }
  ];
  eq("2 rows × (object+field) = 4 api lines, methods skipped", combos.map(comboApi).filter(Boolean).length, 4);
}

console.log("\n4. source presence — proven props, org-agnostic loop, VDI-safe scaffolding, dev-only");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("module present", /function dcIdentityResApiModule\(\)/.test(src));
  ok("gated to Identity Resolution pages only", /\/\\\/r\\\/IdentityResolution\\\/\[a-zA-Z0-9\]\{15,18\}\\\//.test(src));
  ok("FIELD api read DIRECTLY off the row (.fieldId, requires __) — exact, no label matching",
    /irSafe\(row, "fieldId"\)/.test(src) && /!\/__\/.test\(String\(api\)\)/.test(src));
  ok("DMO api from the section's entity.id", /irSafe\(sec, "entity"\)/.test(src) && /ent\.id/.test(src));
  ok("ORG-AGNOSTIC: loops ALL rows + ALL sections found (no hardcoded dmo/field list)",
    /_irBuckets\.rows\.forEach/.test(src) && /_irBuckets\.sections\.forEach/.test(src));
  ok("MATCH CRITERIA: reads combobox .value as api for Data Model Object / Field, skips Match Method",
    /_irBuckets\.combos\.forEach/.test(src) && /\^\(data model object\|field\)\$/i.test(src) && /!\/__\/.test\(val\)/.test(src) && /lightning-combobox/.test(src));
  ok("ONE shadow crawl per pass (irCollect) — not a per-move scan (VDI-safe)",
    /function irCollect/.test(src) && /q\[i\]\.shadowRoot/.test(src) && /recon-rule-field/.test(src) && /recon-table-rules/.test(src));
  ok("unstackable dedup: tracked spans cleared by reference each pass", /var _irSpans = \[\]/.test(src) && /function irClear/.test(src) && /_irSpans\.push\(sp\)/.test(src));
  ok("signature guard skips no-op redraws (no flicker/churn)", /function irSignature/.test(src) && /sig === _irSig/.test(src));
  ok("observer DISCONNECTS while writing (no feedback loop / VDI peg)",
    /_irWriting = true;/.test(src) && /if \(_irObs\) _irObs\.disconnect\(\);/.test(src) && /if \(_irWriting \|\| _irT\) return;/.test(src));
  ok("re-applies on DOM change (expand a different DMO → its rows render → decorate)", /_irObs = new MutationObserver\(irSchedule\)/.test(src));
  ok("decorates only VISIBLE rows/sections (skip stale cached DOM)", /if \(!isVisible\(row\)\) return;/.test(src) && /if \(!isVisible\(sec\)\) return;/.test(src));
  ok("anchors under the row's/section's own label leaf (not a cell guess)", /function irLabelHost/.test(src) && /nodeValue\.trim\(\)\.toLowerCase\(\) === want/.test(src));
  ok("click-to-copy the clean api (sp._irApi)", /sp\._irApi/.test(src) && /navigator\.clipboard\.writeText\(t\)/.test(src));
  ok("toggle + default OFF", /window\.__dcToggleIrApi/.test(src) && /window\.__dcIrApiIsOn/.test(src) && /var IR_ON = false;/.test(src));
  ok("stop() clears + disconnects (no leak)", /function irStop/.test(src) && /irClear\(\)/.test(src));
  ok("DEV-ONLY (absent from the public/stripped bookmarklet)", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/dcIdentityResApiModule/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function dcIdentityResApiModule\(\)/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
