// Data Space DLO-filter export — pure logic + source-presence tests. Run in Node.
//   node test/dataspace-filter-export.test.js
//
// Feature: on a Data Space page, export a member object's (DLO) membership filter — grouped
// conditions, like a segment — to a COLORED Excel (or Copy-for-Sheets). SF lets you build the
// filter but not take it out.
//
// PROVEN DOM (DOM Probe v41/v42/v43 on the real org):
//   <runtime_cdp-data-spaces-table-filter-group>.filterGroup =
//       { id, filterOperator:"AND"|"OR", filters:[CONDITION…], filterGroups:[nested…] }
//   CONDITION = { object:{devName,label}, field:{devName,label,type}, operator:{devName,label}, value }
//   WITHIN-group operator = filterGroup.filterOperator (in data).
//   BETWEEN-group operator = NOT in any prop → read from the rendered AND/OR bar (DOM).
// This file locks the pure flatten → rows → csv/tsv → summary logic + the between-op picker.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── mirrors of the pure logic (dsf* in source) ──────────────────────────────────
function flatten(g, acc) {
  if (!g) return;
  var filters = g.filters;
  if (Array.isArray(filters)) {
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i]; if (!f) continue;
      if (f.filterType === "GROUP" || f.filterGroups || (f.filters && !f.field)) { flatten(f, acc); continue; }
      var obj = f.object || {}, fld = f.field || {}, op = f.operator || {};
      acc.push({
        objectLabel: obj.label || "", objectApi: obj.devName || "",
        fieldLabel: fld.label || "", fieldApi: fld.devName || "", fieldType: fld.type || "",
        operator: op.label || op.devName || "", value: (f.value == null) ? "" : String(f.value)
      });
    }
  }
  if (Array.isArray(g.filterGroups)) g.filterGroups.forEach(function (sg) { flatten(sg, acc); });
}
var DSF_COLS = ["Group", "Within-group logic", "Between-groups logic", "Object", "Object API Name", "Field", "Field API Name", "Operator", "Value"];
function dsfRows(model) {
  var rows = [DSF_COLS.slice()];
  model.groups.forEach(function (g, gi) {
    var groupLabel = "Group " + (gi + 1);
    var between = (gi < model.groups.length - 1) ? (model.betweenOp || "") : "";
    if (!g.conditions.length) { rows.push([groupLabel, g.operator, between, "", "", "(no conditions)", "", "", ""]); return; }
    g.conditions.forEach(function (c, ci) {
      rows.push([ci === 0 ? groupLabel : "", g.operator, ci === 0 ? between : "", c.objectLabel, c.objectApi, c.fieldLabel, c.fieldApi, c.operator, c.value]);
    });
  });
  return rows;
}
function dsfSummary(model) {
  return model.groups.map(function (g) {
    var inner = g.conditions.map(function (c) { return c.fieldLabel + " " + c.operator + (c.value !== "" ? " " + c.value : ""); }).join(" " + g.operator + " ");
    return "(" + inner + ")";
  }).join("  " + (model.betweenOp || "OR") + "  ");
}
function csvEsc(s) { var t = String(s == null ? "" : s); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }
function toCsv(rows) { return rows.map(function (r) { return r.map(csvEsc).join(","); }).join("\n"); }
// between-op picker: distinct outer AND/OR values → the one value, or joined if mixed, or "".
function pickBetween(outerOps) { var u = {}; outerOps.forEach(function (v) { u[v.toUpperCase()] = 1; }); var k = Object.keys(u); return k.length === 1 ? k[0] : (k.length > 1 ? k.join("/") : ""); }

// ── real data shaped exactly like probe v42 (TDI_RH_Profile, 2 of the 4 groups) ──
var liveGroup1 = {
  id: "g1", filterOperator: "AND", filterGroups: [],
  filters: [
    { filterType: "CONDITION", object: { devName: "TDI_RH_Profile__dll", label: "TDI_RH_Profile" }, field: { devName: "contact_active_in__c", label: "contact_active_in", type: "Boolean" }, operator: { devName: "EQUALS", label: "EQUALS" }, value: "true" },
    { filterType: "CONDITION", object: { devName: "TDI_RH_Profile__dll", label: "TDI_RH_Profile" }, field: { devName: "contact_last_name__c", label: "contact_last_name", type: "Text" }, operator: { devName: "IS_EMPTY_STRING", label: "IS EMPTY STRING" }, value: undefined }
  ]
};

console.log("\n1. flatten a filterGroup → conditions with object/field/api/operator/value");
{
  var conds = []; flatten(liveGroup1, conds);
  eq("2 conditions", conds.length, 2);
  eq("cond1 field api", conds[0].fieldApi, "contact_active_in__c");
  eq("cond1 value", conds[0].value, "true");
  eq("cond1 operator label", conds[0].operator, "EQUALS");
  eq("cond2 field label", conds[1].fieldLabel, "contact_last_name");
  eq("cond2 (no value) → empty string", conds[1].value, "");
  eq("object api carried", conds[0].objectApi, "TDI_RH_Profile__dll");
}

console.log("\n2. nested filterGroups flatten too (defensive — one level seen live, deeper handled)");
{
  var nested = { id: "root", filterOperator: "AND", filters: [], filterGroups: [liveGroup1] };
  var acc = []; flatten(nested, acc);
  eq("nested conditions surfaced", acc.length, 2);
}

console.log("\n3. rows: one per condition + group columns; label+between only on first row");
{
  var model = {
    objectLabel: "TDI_RH_Profile", objectDevName: "TDI_RH_Profile__dll", betweenOp: "OR",
    groups: [
      { operator: "AND", conditions: (function () { var a = []; flatten(liveGroup1, a); return a; })() },
      { operator: "AND", conditions: [{ objectLabel: "TDI_RH_Profile", objectApi: "TDI_RH_Profile__dll", fieldLabel: "commercial_in", fieldApi: "commercial_in__c", operator: "EQUALS", value: "false" }] }
    ]
  };
  var rows = dsfRows(model);
  eq("header + 3 condition rows", rows.length, 4);
  eq("header col 0", rows[0][0], "Group");
  eq("g1 first row has label", rows[1][0], "Group 1");
  eq("g1 first row has between-op OR", rows[1][2], "OR");
  eq("g1 SECOND row: no label (merged look)", rows[2][0], "");
  eq("g1 second row: no repeated between-op", rows[2][2], "");
  eq("within-op repeats on every row of the group", rows[2][1], "AND");
  eq("LAST group has no between-op (nothing after it)", rows[3][2], "");
  eq("field api column", rows[1][6], "contact_active_in__c");

  // CSV round-trip: empty-string value and a comma-free operator stay clean; quotes escaped
  var csv = toCsv(rows);
  ok("CSV has header line", csv.split("\n")[0] === DSF_COLS.join(","));
  ok("CSV escapes a value with a comma", toCsv([["a,b"]]) === '"a,b"');
  ok("CSV escapes quotes", toCsv([['he said "hi"']]) === '"he said ""hi"""');

  // summary string
  var s = dsfSummary(model);
  ok("summary groups with within-op AND", /contact_active_in EQUALS true AND contact_last_name IS EMPTY STRING/.test(s));
  ok("summary joins groups with between-op OR", /\)  OR  \(/.test(s));
}

console.log("\n4. between-group operator picker (read from DOM, never guessed)");
{
  eq("single OR → OR", pickBetween(["OR"]), "OR");
  eq("single AND → AND", pickBetween(["AND", "AND"]), "AND");
  eq("mixed → joined (surface both, don't guess)", pickBetween(["OR", "AND"]), "OR/AND");
  eq("none → '' (unknown, left blank + warned)", pickBetween([]), "");
}

console.log("\n5. source presence — reader reads proven props, export is 3-format, dev-only, FAB-gated");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("module present", /function dcDataSpaceFilterExport\(\)/.test(src));
  ok("gated to Data Space detail pages only", /\/\\\/r\\\/DataSpace\\\/\[a-zA-Z0-9\]\{15,18\}\\\//.test(src));
  ok("reads the proven filter-group component + .filterGroup", /findByTag\("runtime_cdp-data-spaces-table-filter-group"\)/.test(src) && /dsfSafe\(el, "filterGroup"\)/.test(src));
  ok("within-group operator read from data (filterOperator)", /g\.filterOperator \|\| "AND"/.test(src));
  ok("between-group operator read from the DOM AND/OR bar (not invented)", /function dsfReadBetweenOp/.test(src) && /\^\(AND\|OR\)\$/.test(src) && /dcWithinTag2\(el, "runtime_cdp-data-spaces-table-filter-group"\)/.test(src));
  ok("top-level groups exclude nested child groups (no double-count)", /childIds\[sg\.id\] = true/.test(src) && /return !childIds\[id\]/.test(src));
  ok("one row per condition + group/logic columns", /var DSF_COLS = \[/.test(src) && /"Within-group logic", "Between-groups logic"/.test(src) && /ci === 0 \? groupLabel : ""/.test(src));
  ok("ONE download (colored Excel) + Copy-for-Sheets in THIS module (no separate plain CSV button)", (function () {
    var i = src.indexOf("function dcDataSpaceFilterExport"); var j = src.indexOf("/* @strip:end */", i); var mod = src.slice(i, j);
    return /buildXlsx\(\[\{ name: "Filters"[\s\S]{0,90}styleFor: built\.styleFor/.test(mod) && /function dsfToTsv/.test(mod) && !/Download CSV/.test(mod);
  })());
  ok("Excel is colored/banded via a styleFor map (header dark+bold, groups tinted AND=blue/OR=purple)", /function dsfXlsxRowsAndStyle/.test(src) && /isOr \? \(alt \? 7 : 5\) : \(alt \? 6 : 4\)/.test(src) && /return col === 0 \? st\.label : st\.band/.test(src));
  ok("Copy-for-Sheets copies the COLORED grid HTML (execCommand copy), TSV fallback", /dsfCardsHtml\(model\)/.test(src) && /document\.execCommand\("copy"\)/.test(src) && /function dsfToTsv/.test(src));
  // buildXlsx gained opt-in color styles without changing default output for existing callers
  const bx = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("buildXlsx supports opt-in colored header + band fills (styleFor), defaults unchanged", /opts\.styleFor/.test(bx) && /fontId=\\"2\\" fillId=\\"2\\"/.test(bx) && /cellXfs count=\\"12\\"/.test(bx));
  ok("warns when between-op unreadable (never shows a guessed operator)", /wasn.rsquo;t readable from the page/.test(src));
  ok("exposes open + count; FAB only when a filter exists", /window\.__dcDsFilterExport/.test(src) && /window\.__dcDsFilterCount/.test(src) && /if \(!has\) return;/.test(src));
  ok("FAB poll stops after a bounded number of tries (no infinite timer)", /_dsfFabTries > 40/.test(src));
  ok("DEV-ONLY (absent from the public/stripped bookmarklet)", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/dcDataSpaceFilterExport/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function dcDataSpaceFilterExport\(\)/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
