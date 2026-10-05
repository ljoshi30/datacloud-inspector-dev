// Query Editor JSON-viewer logic tests — run in Node.
//   node test/qe-json-view.test.js
//
// INDEPENDENT from the Data Explorer JSON view by design (user requirement: do NOT
// share code between Explorer and QE). This tests the pure logic that the QE results
// table uses to (a) decide a cell holds "viewable" JSON, and (b) flatten any JSON
// shape into table rows/columns + a safe pretty-print — covering every edge case we
// could think of as a backend/TA engineer, so it never breaks or drops info.
//
// Functions mirrored from console-decorate.extension.js (qeJson* namespace):
//   qeJsonDetect(raw)      -> { isJson, kind, value } | { isJson:false }
//   qeJsonToTable(value)   -> { columns:[...], rows:[{...}] }  (array-of-objects / single obj / scalar list)
//   qeJsonPretty(value)    -> stable pretty string (2-space), never throws

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirrors of the QE JSON logic ─────────────────────────────────────────────────
// Detect: only treat as "viewable JSON" when the TRIMMED text starts with { or [ AND
// parses. A bare number/bool/quoted-string is NOT given a JSON viewer (it's a scalar).
function qeJsonDetect(raw) {
  if (raw == null) return { isJson: false };
  if (typeof raw === "object") { // already parsed (SF sometimes returns objects)
    return { isJson: true, kind: Array.isArray(raw) ? "array" : "object", value: raw };
  }
  const s = String(raw).trim();
  if (s.length < 2) return { isJson: false };
  const c = s[0];
  if (c !== "{" && c !== "[") return { isJson: false }; // scalars/plain text → not viewable JSON
  let v; try { v = JSON.parse(s); } catch (e) { return { isJson: false }; } // malformed { → text
  if (v === null || typeof v !== "object") return { isJson: false };
  return { isJson: true, kind: Array.isArray(v) ? "array" : "object", value: v };
}

function isPlainObj(x) { return x && typeof x === "object" && !Array.isArray(x); }
function cellStr(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v); // nested → compact string in a cell
  return String(v);
}
// Flatten any JSON value into {columns, rows} for a table view.
function qeJsonToTable(value) {
  // array of objects → union of keys as columns, one row each
  if (Array.isArray(value)) {
    if (value.length && value.every(isPlainObj)) {
      const cols = [];
      const seen = {};
      value.forEach((o) => Object.keys(o).forEach((k) => { if (!seen[k]) { seen[k] = 1; cols.push(k); } }));
      return { columns: cols, rows: value.map((o) => { const r = {}; cols.forEach((k) => r[k] = cellStr(o[k])); return r; }) };
    }
    // array of scalars (or mixed) → single "value" column, one row per element (index kept)
    return { columns: ["#", "value"], rows: value.map((el, i) => ({ "#": String(i), value: cellStr(el) })) };
  }
  // single object → two-column key/value table
  if (isPlainObj(value)) {
    return { columns: ["key", "value"], rows: Object.keys(value).map((k) => ({ key: k, value: cellStr(value[k]) })) };
  }
  // scalar (shouldn't reach here via detect, but be safe)
  return { columns: ["value"], rows: [{ value: cellStr(value) }] };
}

function qeJsonPretty(value) {
  try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
}

// ── 1. Detection edge cases ──────────────────────────────────────────────────────
console.log("\n1. qeJsonDetect — only real objects/arrays are 'viewable JSON'");
ok("null -> no", !qeJsonDetect(null).isJson);
ok("empty string -> no", !qeJsonDetect("").isJson);
ok("plain text -> no", !qeJsonDetect("hello world").isJson);
ok("bare number string '123' -> no (scalar, not a viewer)", !qeJsonDetect("123").isJson);
ok("bare 'true' -> no", !qeJsonDetect("true").isJson);
ok("bare 'null' -> no", !qeJsonDetect("null").isJson);
ok("quoted string '\"hi\"' -> no", !qeJsonDetect('"hi"').isJson);
ok("object -> yes", qeJsonDetect('{"a":1}').isJson);
eq("object kind", qeJsonDetect('{"a":1}').kind, "object");
ok("array -> yes", qeJsonDetect('[1,2,3]').isJson);
eq("array kind", qeJsonDetect('[1,2,3]').kind, "array");
ok("whitespace-padded object -> yes", qeJsonDetect('   {"a":1}  ').isJson);
ok("malformed '{ oops' -> no (doesn't parse → text, no crash)", !qeJsonDetect("{ oops").isJson);
ok("'[' incomplete -> no", !qeJsonDetect("[1,2").isJson);
ok("already-parsed object value -> yes", qeJsonDetect({ a: 1 }).isJson);
ok("already-parsed array value -> yes", qeJsonDetect([1, 2]).isJson);
ok("string that merely CONTAINS braces mid-text -> no", !qeJsonDetect("total {x}").isJson);

// ── 2. Array of objects → union columns ──────────────────────────────────────────
console.log("\n2. qeJsonToTable — array of objects (ragged keys unioned)");
{
  const t = qeJsonToTable([{ a: 1, b: 2 }, { a: 3, c: 4 }]);
  eq("union columns a,b,c", t.columns.join(","), "a,b,c");
  eq("3 columns", t.columns.length, 3);
  eq("2 rows", t.rows.length, 2);
  eq("missing key -> empty cell", t.rows[1].b, "");
  eq("value coerced to string", t.rows[0].a, "1");
}

// ── 3. Nested values become compact strings in cells (no info lost) ──────────────
console.log("\n3. nested objects/arrays rendered as compact JSON in a cell");
{
  const t = qeJsonToTable([{ id: 1, addr: { city: "NYC" }, tags: ["a", "b"] }]);
  eq("nested object cell", t.rows[0].addr, '{"city":"NYC"}');
  eq("nested array cell", t.rows[0].tags, '["a","b"]');
}

// ── 4. Single object → key/value table ───────────────────────────────────────────
console.log("\n4. single object → 2-col key/value");
{
  const t = qeJsonToTable({ name: "x", age: 30, meta: { k: 1 } });
  eq("columns key,value", t.columns.join(","), "key,value");
  eq("3 rows", t.rows.length, 3);
  eq("scalar value", t.rows.find(r => r.key === "age").value, "30");
  eq("nested value compact", t.rows.find(r => r.key === "meta").value, '{"k":1}');
}

// ── 5. Array of scalars / mixed → indexed value column ───────────────────────────
console.log("\n5. array of scalars / mixed");
{
  const t = qeJsonToTable([10, 20, 30]);
  eq("columns #,value", t.columns.join(","), "#,value");
  eq("row count", t.rows.length, 3);
  eq("index kept", t.rows[2]["#"], "2");
  eq("value", t.rows[1].value, "20");
  const m = qeJsonToTable([{ a: 1 }, 5]); // mixed obj + scalar → not all objects → scalar list
  eq("mixed -> value column", m.columns.join(","), "#,value");
  eq("mixed obj element compact", m.rows[0].value, '{"a":1}');
}

// ── 6. Empty structures ──────────────────────────────────────────────────────────
console.log("\n6. empty object / empty array");
{
  const eo = qeJsonToTable({});
  eq("empty object -> 0 rows", eo.rows.length, 0);
  const ea = qeJsonToTable([]);
  eq("empty array -> 0 rows", ea.rows.length, 0);
}

// ── 7. null/undefined inside objects ─────────────────────────────────────────────
console.log("\n7. null/undefined cells never throw, render empty");
{
  const t = qeJsonToTable([{ a: null, b: undefined, c: 0, d: false }]);
  eq("null -> ''", t.rows[0].a, "");
  eq("undefined -> ''", t.rows[0].b, "");
  eq("zero preserved", t.rows[0].c, "0");
  eq("false preserved", t.rows[0].d, "false");
}

// ── 8. Big-number precision kept from original text (detect returns parsed, but the
//     pretty/cell path must not silently corrupt). We assert JSON.parse round-trips
//     typical values; genuinely huge ints are a known JS limit (documented, not hidden).
console.log("\n8. values preserved");
{
  const t = qeJsonToTable([{ amt: 1234.56, flag: true, s: "a,b\tc" }]);
  eq("float", t.rows[0].amt, "1234.56");
  eq("bool", t.rows[0].flag, "true");
  eq("string with comma/tab kept", t.rows[0].s, "a,b\tc");
}

// ── 9. pretty-print never throws ─────────────────────────────────────────────────
console.log("\n9. qeJsonPretty");
{
  ok("pretty of object has newlines + indent", /\n  /.test(qeJsonPretty({ a: 1, b: { c: 2 } })));
  ok("pretty of array ok", qeJsonPretty([1, 2]).indexOf("[") === 0);
}

// ── 9b. Nested rendering: chip label + per-level column derivation (recursive) ───
console.log("\n9b. nested inline-expand helpers");
{
  var isObjOrArr = (v) => v && typeof v === "object";
  var chipLabel = (v) => Array.isArray(v) ? ("[ " + v.length + (v.length === 1 ? " item" : " items") + " ]") : ("{ " + Object.keys(v).length + (Object.keys(v).length === 1 ? " field" : " fields") + " }");
  eq("array chip label (1 item)", chipLabel([{ a: 1 }]), "[ 1 item ]");
  eq("array chip label (3 items)", chipLabel([1, 2, 3]), "[ 3 items ]");
  eq("object chip label (2 fields)", chipLabel({ a: 1, b: 2 }), "{ 2 fields }");
  ok("nested array detected as expandable", isObjOrArr([{ x: 1 }]));
  ok("nested object detected as expandable", isObjOrArr({ x: 1 }));
  ok("scalar NOT expandable", !isObjOrArr("ON") && !isObjOrArr(42) && !isObjOrArr(false));
  ok("null NOT expandable", !isObjOrArr(null));

  // the exact screenshot case: array-of-one-object nested field expands to its own sub-table
  var cell = [{ StateProvinceId: "ON" }];
  ok("screenshot nested cell is expandable (not flat string)", isObjOrArr(cell));
  var sub = qeJsonToTable(cell);
  eq("expands to 1-col-of-keys sub-table (union)", sub.columns.join(","), "StateProvinceId");
  eq("sub-table 1 row", sub.rows.length, 1);
  eq("sub-table value", sub.rows[0].StateProvinceId, "ON");

  // deep nesting: object -> array -> object
  var deep = { a: { b: [{ c: 1 }] } };
  ok("deep level-1 value expandable", isObjOrArr(deep.a));
  ok("deep level-2 value expandable", isObjOrArr(deep.a.b));
}

// ── 10. Source presence (independent QE module wired; NOT reusing Explorer) ───────
console.log("\n10. Source presence (independent QE JSON viewer wired up)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("qeJsonDetect defined", /function qeJsonDetect\s*\(/.test(src));
  ok("qeJsonToTable defined", /function qeJsonToTable\s*\(/.test(src));
  ok("qeJsonPretty defined", /function qeJsonPretty\s*\(/.test(src));
  ok("QE opens its OWN json modal (not Explorer's openCellValue)", /dc-qe-json/.test(src));
  ok("independent from Explorer (QE code doesn't call renderJsonAsTable)",
    !/openResultsModal[\s\S]{0,4000}renderJsonAsTable/.test(src)); // loose guard
  ok("recursive nested inline-expand builder (buildJsonTable + depth)", /function buildJsonTable\s*\(\s*val\s*,\s*depth\s*\)/.test(src));
  ok("generic/shape-driven (no activation/TDI hardcoding in the viewer)",
    !/qeJson[\s\S]{0,2500}(TDI_|Activation_Record)/.test(src));
  ok("depth guard + array cap present", /MAX_DEPTH/.test(src) && /ARR_CAP/.test(src));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
