// Data Stream / DLO formula-hover feature — pure logic + source-presence tests. Run in Node.
//   node test/ds-formula-hover.test.js
//
// Feature: on a Data Stream / DLO page, the Fields table shows a Formula column as a CHECKMARK
// only — the actual expression is never on the page. Toggle "Show formulas" from the FAB → hover
// a FORMULA field → a popover shows its formula with a Copy button. ONLY formula fields react.
//
// PROVEN DOM (DOM Probe v38 on the real org — field datatable):
//   <runtime_cdp-custom-datatable>.data[] = { fieldLabel, fieldName:"X__c",
//        isFormulaField:"true"|"false", formula:"if(ISEMPTY(...)) {…}" | "" , … }
//   The VISIBLE table's rendered <tr> count === data.length  → align data[j] ↔ row j by INDEX.
//   (Stale cached copies render 0 rows → skipped via visibility.)
// The formula is read DIRECTLY off data[j].formula — no guessing.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

function fmSafe(o, k) { try { return o[k]; } catch (e) { return undefined; } }
function fmTruthy(v) { return String(v == null ? "" : v).toLowerCase() === "true"; }

// Mirror of fmDecorate's per-row qualify: a row gets wired ONLY if it's a formula field with a
// non-empty formula. Returns the formula to show, or null (row is left completely alone).
function qualifyRow(rec) {
  if (!rec || !fmTruthy(fmSafe(rec, "isFormulaField"))) return null;
  var formula = fmSafe(rec, "formula");
  if (formula == null || formula === "") return null;
  return String(formula);
}

// Mirror of the field-table identification (columns include headerLabel + fieldLabel).
function isFieldTable(cols) {
  if (!Array.isArray(cols)) return false;
  var names = cols.map(function (c) { return fmSafe(c, "fieldName") || ""; });
  return names.indexOf("headerLabel") >= 0 && names.indexOf("fieldLabel") >= 0;
}

// Mirror of the index-alignment gate: only decorate when rendered row count === data length.
function aligned(dataLen, renderedRowCount) { return dataLen === renderedRowCount; }

// Mirror of __dcDsFormulaCount: number of formula fields with a formula.
function formulaCount(data) {
  var n = 0;
  for (var i = 0; i < data.length; i++) { if (qualifyRow(data[i]) != null) n++; }
  return n;
}

console.log("\n1. ONLY formula fields qualify (the explicit requirement)");
{
  // real rows from DOM Probe v38
  var fFormula = { fieldLabel: "cdp_sys_PartitionDate", fieldName: "cdp_sys_PartitionDate__c", isFormulaField: "true", formula: "if(ISEMPTY(formulaField['dateTime__c'])) { null; } else { DAYPRECISION(formulaField['dateTime__c']); }" };
  var fConst   = { fieldLabel: "Data Source", fieldName: "DataSource__c", isFormulaField: "true", formula: "'UploadedFiles'" };
  var fPlain   = { fieldLabel: "affinity", fieldName: "catalog_affinity__c", isFormulaField: "false", formula: "" };
  var fFlaggedButEmpty = { fieldLabel: "Weird", fieldName: "Weird__c", isFormulaField: "true", formula: "" };

  eq("formula field with expression → shows the formula", qualifyRow(fFormula), "if(ISEMPTY(formulaField['dateTime__c'])) { null; } else { DAYPRECISION(formulaField['dateTime__c']); }");
  eq("formula field with a constant expression → shows it", qualifyRow(fConst), "'UploadedFiles'");
  eq("NON-formula field → null (no popover, no badge, row untouched)", qualifyRow(fPlain), null);
  eq("flagged formula but empty expression → null (nothing to show)", qualifyRow(fFlaggedButEmpty), null);
  eq("null record → null", qualifyRow(null), null);
  eq("missing isFormulaField → null", qualifyRow({ fieldName: "X__c", formula: "ABC" }), null);
}

console.log("\n2. formula count drives whether the FAB row is offered at all");
{
  var mixed = [
    { isFormulaField: "true", formula: "A" },
    { isFormulaField: "false", formula: "" },
    { isFormulaField: "true", formula: "B" },
    { isFormulaField: "true", formula: "" }   // flagged-but-empty doesn't count
  ];
  eq("count = number of formula fields WITH an expression", formulaCount(mixed), 2);
  eq("no formula fields → count 0 (launcher hides the Show-formulas row)", formulaCount([{ isFormulaField: "false", formula: "" }]), 0);
  eq("empty table → 0", formulaCount([]), 0);
}

console.log("\n3. field-table identification (headerLabel + fieldLabel)");
{
  var fieldCols = [{ fieldName: "headerLabel" }, { fieldName: "fieldLabel" }, { fieldName: "Field API Name" }, { fieldName: "Formula Field" }];
  var historyCols = [{ fieldName: "startExecutionTime" }, { fieldName: "status" }];
  ok("field table recognized", isFieldTable(fieldCols) === true);
  ok("refresh-history table NOT treated as field table", isFieldTable(historyCols) === false);
  ok("non-array columns → false", isFieldTable(null) === false);
}

console.log("\n4. index alignment gate (proven: visible table rendered-rows === data length)");
{
  ok("56 data / 56 rendered → aligned, decorate", aligned(56, 56) === true);
  ok("56 data / 0 rendered (stale cached table) → NOT aligned, skip", aligned(56, 0) === false);
  ok("13 data / 13 rendered → aligned", aligned(13, 13) === true);
}

console.log("\n4b. cell→formula resolution: match by ROW KEY (virtualization-proof), index fallback");
{
  function recFormula(rec) {
    if (!rec || !fmTruthy(fmSafe(rec, "isFormulaField"))) return null;
    var formula = fmSafe(rec, "formula"); if (formula == null || formula === "") return null;
    return { label: String(rec.fieldLabel || rec.fieldName || "Formula"), formula: String(formula) };
  }
  // Mirror of fmFormulaForCell: PRIMARY = match hovered row's key to data[].<keyField>, regardless
  // of how many rows are rendered; FALLBACK = index alignment only when rendered count === data.
  function cellFormula(data, keyField, renderedKeys, hoveredKey, hoveredIndex) {
    // PRIMARY — by key
    if (hoveredKey != null) {
      for (var i = 0; i < data.length; i++) { if (String(data[i][keyField]) === String(hoveredKey)) return recFormula(data[i]); }
    }
    // FALLBACK — by index when fully aligned
    if (renderedKeys.length === data.length && hoveredIndex >= 0) return recFormula(data[hoveredIndex]);
    return null;
  }
  // 109-field SFTP-style table, only 3 rows rendered (VIRTUALIZED) — the reported failure case.
  var big = [];
  for (var i = 0; i < 109; i++) big.push({ id: "f" + i, fieldLabel: "F" + i, fieldName: "F" + i + "__c", isFormulaField: "false", formula: "" });
  big[7] = { id: "f7", fieldLabel: "Data Source Object", fieldName: "DataSourceObject__c", isFormulaField: "true", formula: "env['filename']" };
  var rendered = ["f5", "f6", "f7"];   // only 3 of 109 in the DOM (virtualized)

  var got = cellFormula(big, "id", rendered, "f7", -1 /* index unknown/irrelevant */);
  eq("VIRTUALIZED (3 of 109 rendered): hover the formula row by KEY → its formula", got && got.formula, "env['filename']");
  eq("VIRTUALIZED: label resolved too", got && got.label, "Data Source Object");
  eq("VIRTUALIZED: hover a NON-formula row by key → null", cellFormula(big, "id", rendered, "f6", -1), null);
  eq("key not in data → null (no wrong match)", cellFormula(big, "id", rendered, "nope", -1), null);

  // small aligned table with NO key attr available → index fallback still works
  var small = [
    { id: "a", fieldLabel: "Person Name", fieldName: "Person_Name__c", isFormulaField: "true", formula: "CONCAT(a,b)" },
    { id: "b", fieldLabel: "affinity", fieldName: "x__c", isFormulaField: "false", formula: "" }
  ];
  eq("aligned + no key: index fallback row 0 → formula", cellFormula(small, "id", ["a", "b"], null, 0) && cellFormula(small, "id", ["a", "b"], null, 0).formula, "CONCAT(a,b)");
  eq("aligned + no key: index fallback NON-formula row 1 → null", cellFormula(small, "id", ["a", "b"], null, 1), null);
  eq("misaligned + no key (can't trust index) → null", cellFormula(small, "id", ["a"], null, 0), null);

  // Mirror of fmIsFormulaCell: formula column detected by data-label OR a check icon.
  function isFormulaCell(dataLabel, hasCheckIcon) { return /formula/i.test(dataLabel || "") || !!hasCheckIcon; }
  ok("cell with data-label 'Formula Field' → formula cell", isFormulaCell("Formula Field", false) === true);
  ok("cell with a check icon (no data-label) → formula cell (fallback)", isFormulaCell("", true) === true);
  ok("cell in 'Data Type' column, no check → NOT a formula cell", isFormulaCell("Data Type", false) === false);
}

console.log("\n5. source presence — on-demand (no inject, no poll), dev-only, export-independent");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("module present", /function dcDsFormulaModule\(\)/.test(src));
  ok("gated to Data Stream / DLO detail pages only",
    /\/\\\/r\\\/DataStream\\\/\[a-zA-Z0-9\]\{15,18\}\\\//.test(src) && /DataLakeObjectInstance/.test(src));
  ok("reads formula DIRECTLY from data[idx].formula (no guessing)",
    /fmSafe\(rec, "formula"\)/.test(src) && /fmTruthy\(fmSafe\(rec, "isFormulaField"\)\)/.test(src));
  ok("resolves the hovered cell's row to a formula ONLY if it's a formula field with a formula",
    /function fmFormulaForCell/.test(src) && /function fmRecFormula/.test(src) && /if \(!rec \|\| !fmTruthy\(fmSafe\(rec, "isFormulaField"\)\)\) return null;/.test(src) && /if \(formula == null \|\| formula === ""\) return null;/.test(src));
  ok("PRIMARY match is by ROW KEY (virtualization-proof) — fixes long/SFTP streams + intermittency",
    /function fmRowKey/.test(src) && /data-row-key-value/.test(src) && /String\(fmSafe\(r, kf\)\) === String\(key\)/.test(src));
  ok("keyField read from the datatable (default 'id')", /function fmKeyField/.test(src) && /fmSafe\(table, "keyField"\)/.test(src));
  ok("index alignment kept only as a FALLBACK when counts match", /if \(rows\.length === data\.length\)/.test(src) && /var idx = rows\.indexOf\(row\)/.test(src));
  ok("field table identified by headerLabel + fieldLabel (same as export)",
    /names\.indexOf\("headerLabel"\) >= 0 && names\.indexOf\("fieldLabel"\) >= 0/.test(src));
  ok("triggers ONLY on the Formula column cell (data-label OR check-icon fallback)",
    /function fmIsFormulaCell/.test(src) && /\/formula\/i\.test\(fmCellLabel\(cell\)\)/.test(src) && /fmCellHasCheckIcon/.test(src));
  ok("INJECTS NOTHING into the table (no badge, no row title) — row size never changes",
    !/dc-fm-badge/.test(src) && !/tr\.setAttribute\("title"/.test(src) && !/cell\.insertBefore/.test(src));
  ok("NO MutationObserver and NO interval in the module (zero idle/background work)",
    !/MutationObserver\(fmSchedule\)/.test(src) && !/setInterval\([^)]*fmRun/.test(src) && !/_fmTick/.test(src));
  ok("only always-on cost is ONE delegated pointerover listener, added on enable",
    /document\.addEventListener\("pointerover", fmOnOver, true\)/.test(src) && /function fmWire/.test(src));
  ok("hover handler early-returns when the feature is OFF (cheap no-op)",
    /function fmOnOver\(e\) \{\s*if \(!FM_ON\) return;/.test(src));
  ok("popover built lazily (only when first shown) with a Copy button to clipboard",
    /function fmBuildPopover/.test(src) && /id = "dc-fm-pop"/.test(src) && /navigator\.clipboard\.writeText\(txt\)/.test(src));
  ok("toggle + default OFF + count exposed to the launcher",
    /window\.__dcToggleDsFormula/.test(src) && /window\.__dcDsFormulaIsOn/.test(src) && /window\.__dcDsFormulaCount/.test(src) && /var FM_ON = false;/.test(src));

  // launcher wiring: the row shows ONLY when count>0, and export is a separate button
  ok("launcher offers the toggle ONLY when formula fields exist (count>0)",
    /window\.__dcDsFormulaCount\(\) > 0/.test(src));
  ok("launcher row is DataStream/DLO only", /\(detailPageType === "DataStream" \|\| detailPageType === "DLO"\)[\s\S]{0,160}__dcToggleDsFormula/.test(src));
  ok("export button (Export Fields) is a SEPARATE action, unaffected by the toggle",
    /openDsExport\(\)/.test(src) && /dc-detail-btn/.test(src));

  // dev-only: stripped from the public bookmarklet
  ok("module is DEV-ONLY (absent from the public/stripped bookmarklet)", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/dcDsFormulaModule/.test(strip); })());
  ok("module present in the FULL bookmarklet build (synced)", /function dcDsFormulaModule\(\)/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
