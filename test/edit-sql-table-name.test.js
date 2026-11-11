// Edit SQL: FROM must be EXACTLY the selected table name (never stripped), in every org / Data Space.
// Runs the REAL buildInitialSoql source extracted from console-decorate.extension.js (not a mirror).
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? " → " + x : "")); } };

const a = src.indexOf("const buildInitialSoql = () => {");
const b = src.indexOf("\n      };\n", a) + 9;
ok("found real buildInitialSoql source", a > 0 && b > a);
const body = src.slice(a, b);
const make = (objectName, recName, dsGuess, fields) => {
  const fn = new Function("objectName", "recList", "orderedSelected", "checked", "_filterState", "soqlPanelEl", "DC_MAX_FETCH_ROWS",
    "sqlQuoteIdent", "escapeLike", "resolveDataSpace", body + "\nreturn buildInitialSoql;");
  return fn(objectName, { objectName: recName }, fields, new Set(fields), {}, null, 49999,
    n => '"' + String(n).replace(/"/g, '""') + '"', s => s, () => dsGuess)();
};
const from = sql => (sql.match(/\nFROM\s+(\S+)/) || [])[1];

console.log("\nFROM equals the selected table, untouched");
const cases = [
  ["prefixed, space known",      "TDI_Individual__dlm",       "TDI_Individual__dlm",       "TDI"],
  ["prefixed, space unknown",    "TDI_Individual__dlm",       "TDI_Individual__dlm",       ""],
  ["doubled prefix",             "TDI_TDI_GI_Unified__dlm",   "TDI_TDI_GI_Unified__dlm",   "TDI"],
  ["custom space name",          "Retail_Customer__dlm",      "Retail_Customer__dlm",      "Retail"],
  ["default space",              "Individual__dlm",           "Individual__dlm",           "default"],
  ["no prefix at all",           "Account_Home__dll",         "Account_Home__dll",         ""],
  ["name differs from recList",  "TDI_Individual__dlm",       "SomethingElse__dlm",        "TDI"],
];
cases.forEach(([n, obj, rec, ds]) => {
  const sql = make(obj, rec, ds, ["Id__c", "Birth_Date__c"]);
  ok(n + " → FROM \"" + obj + "\"", from(sql) === '"' + obj + '"', from(sql));
});
const s1 = make("TDI_Individual__dlm", "x", "TDI", ["A__c"]);
ok("columns + LIMIT still generated", /^SELECT "A__c"\nFROM "TDI_Individual__dlm"\nLIMIT 49999$/.test(s1), s1);
ok("no data-space stripping code left in the builder", !/ds0|slice\(ds0|Strip dataspace/.test(body));
ok("editor header shows the same selected table", /esc\(objectName \|\| recList\.objectName/.test(src));
ok("Run resolves the table from the selected object first", /var objName = objectName \|\|/.test(src));

console.log("\nRows / Back-to-original wiring (source-level; UI flow needs a live page)");
ok("SQL run keeps the user's Rows (not the returned row count)", /var keepWant = _originalWantRows\[objName\] \|\| res\.rows\.length;/.test(src) && !/showAllColumnsTable\(objName, res2?\.columns, res2?\.rows, res2?\.rows\.length/.test(src));
ok("SQL result without WHERE is flagged as a query result (never cached as original)", /where: "", conds: null, fromSql: true/.test(src));
ok("filter state only replaced AFTER a successful run", !/_filterState\[objName\] = null; \/\/ Reset first/.test(src));
ok("auto-retry (dropped column) uses the same success path", /finishOk\(res2\)/.test(src));
ok("original total remembered and restored on Back/Clear", (src.match(/_originalTotal\[objectName\]/g) || []).length >= 4);
console.log(fail ? "\n❌ FAILURES: " + pass + " passed, " + fail + " failed" : "\n✅ ALL PASS: " + pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
