// Segment criteria → APPROXIMATE SQL (dev-only). Pure logic + source-presence. Run in Node:
//   node test/segment-sql.test.js
//
// Translates the captured condition TREE into illustrative Data Cloud SQL. HONEST: approximate,
// labeled "verify before running". Uses real objApi/fieldApi when present, else [Label] (never
// fakes an API). This test mirrors segmentTreeToSql's operator mapping + tree walk and asserts the
// SQL is correct for known inputs, then checks the real function is wired dev-only into the export.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirror of segmentTreeToSql (kept in sync with the source) ──
function segmentTreeToSql(tree, segName, activeTab) {
  function opToSql(opRaw, valuesRaw) {
    var op = String(opRaw || "").trim().toLowerCase();
    var vals = String(valuesRaw == null ? "" : valuesRaw).trim();
    var list = vals ? vals.split(/\s*,\s*/).filter(Boolean) : [];
    function q(v) { if (/^-?\d+(\.\d+)?$/.test(v)) return v; if (/^(true|false)$/i.test(v)) return v.toUpperCase(); return "'" + v.replace(/'/g, "''") + "'"; }
    switch (op) {
      case "is equal to": case "equals": return "= " + (list[0] != null ? q(list[0]) : "''");
      case "is not equal to": case "does not equal": return "<> " + (list[0] != null ? q(list[0]) : "''");
      case "contains": return "LIKE " + q("%" + (list[0] || "") + "%");
      case "does not contain": return "NOT LIKE " + q("%" + (list[0] || "") + "%");
      case "starts with": return "LIKE " + q((list[0] || "") + "%");
      case "ends with": return "LIKE " + q("%" + (list[0] || ""));
      case "is in": return "IN (" + (list.length ? list.map(q).join(", ") : "''") + ")";
      case "is not in": return "NOT IN (" + (list.length ? list.map(q).join(", ") : "''") + ")";
      case "is between": return "BETWEEN " + (list[0] != null ? q(list[0]) : "''") + " AND " + (list[1] != null ? q(list[1]) : "''");
      case "is not between": return "NOT BETWEEN " + (list[0] != null ? q(list[0]) : "''") + " AND " + (list[1] != null ? q(list[1]) : "''");
      case "greater than": case "is greater than": return "> " + (list[0] != null ? q(list[0]) : "''");
      case "less than": case "is less than": return "< " + (list[0] != null ? q(list[0]) : "''");
      case "has value": case "is not null": return "IS NOT NULL";
      case "has no value": case "is null": return "IS NULL";
      case "is true": return "= TRUE";
      case "is false": return "= FALSE";
      default: return (op ? "/* " + opRaw + " */ " + (list.length ? q(list[0]) : "") : "/* no operator */");
    }
  }
  function colRef(node) {
    var o = node.objApi || (node.objectLabel ? "[" + node.objectLabel + "]" : "");
    var f = node.fieldApi || (node.fieldLabel ? "[" + node.fieldLabel + "]" : "");
    if (o && f) return o + "." + f;
    return f || o || "/* field? */";
  }
  function condSql(node) {
    if (node.type === "simple") return colRef(node) + " " + opToSql(node.operator, node.values);
    if (node.type === "ci") return "/* calculated insight */ " + colRef(node) + " " + opToSql(node.operator, node.values);
    if (node.type === "aggregation") {
      var inner = (node.subFilters && node.subFilters.length)
        ? " WHERE " + node.subFilters.map(function (s) { return colRef(s) + " " + opToSql(s.operator, s.values); }).join(" " + (node.subJoin || "AND") + " ")
        : "";
      return "/* aggregation */ " + (node.fieldLabel || "AGG") + "(" + (node.objApi || node.objectLabel || "") + inner + ") " + opToSql(node.operator, node.values);
    }
    if (node.type === "nested-segment") return "/* references segment: " + (node.objectLabel || "") + " (" + (node.fieldLabel || "") + ") — expand separately */";
    return "/* unsupported condition */";
  }
  function walk(node, depth) {
    if (!node) return "";
    if (node.type === "set") {
      var parts = (node.items || []).map(function (it) { return walk(it, depth + 1); }).filter(Boolean);
      if (!parts.length) return "";
      var joined = parts.join("\n" + "  ".repeat(depth + 1) + (node.join || "AND") + " ");
      return depth === 0 ? joined : "(" + joined + ")";
    }
    return condSql(node);
  }
  var where = walk(tree, 0);
  var header = "-- APPROXIMATE SQL — illustrative, verify before running.\n" +
               "-- Segment: " + (segName || "") + (activeTab ? "  (tab: " + activeTab + ")" : "") + "\n" +
               "-- Real field API names used where available; [Label] = unresolved label, not an API.\n";
  if (!where) return header + "-- (no conditions on this tab)";
  return header + "SELECT *\nFROM /* primary segmented object */\nWHERE " + where + ";";
}

console.log("\n1. operator mapping — each UI operator → correct SQL");
{
  function w(op, vals, api) { return segmentTreeToSql({ type: "set", join: "AND", items: [{ type: "simple", objApi: "Obj__dlm", fieldApi: api || "F__c", operator: op, values: vals }] }); }
  ok("is equal to (text) → = 'x'", /F__c = 'x'/.test(w("is equal to", "x")));
  ok("is equal to (number) → unquoted", /F__c = 42/.test(w("is equal to", "42")));
  ok("is true → = TRUE", /F__c = TRUE/.test(w("is true", "")));
  ok("is false → = FALSE", /F__c = FALSE/.test(w("is false", "")));
  ok("contains → LIKE %x%", /F__c LIKE '%x%'/.test(w("contains", "x")));
  ok("does not contain → NOT LIKE %x%", /F__c NOT LIKE '%x%'/.test(w("does not contain", "x")));
  ok("starts with → LIKE x%", /F__c LIKE 'x%'/.test(w("starts with", "x")));
  ok("ends with → LIKE %x", /F__c LIKE '%x'/.test(w("ends with", "x")));
  ok("is in (list) → IN ('a', 'b')", /F__c IN \('a', 'b'\)/.test(w("is in", "a, b")));
  ok("is not in → NOT IN", /F__c NOT IN \('a', 'b'\)/.test(w("is not in", "a, b")));
  ok("is between → BETWEEN a AND b", /F__c BETWEEN 10 AND 20/.test(w("is between", "10, 20")));
  ok("greater than → >", /F__c > 5/.test(w("greater than", "5")));
  ok("less than → <", /F__c < 5/.test(w("less than", "5")));
  ok("has value → IS NOT NULL", /F__c IS NOT NULL/.test(w("has value", "")));
  ok("has no value → IS NULL", /F__c IS NULL/.test(w("has no value", "")));
  ok("unknown operator → passed through as a /* comment */, never silently wrong", /\/\* weird op \*\//.test(w("weird op", "x")));
  ok("SQL-injection-ish value is single-quote-escaped", /= 'O''Brien'/.test(w("is equal to", "O'Brien")));
}

console.log("\n2. column reference — real APIs preferred; [Label] fallback shows it's unresolved (never faked)");
{
  var withApi = segmentTreeToSql({ type: "set", items: [{ type: "simple", objApi: "ssot__Individual__dlm", fieldApi: "City__c", operator: "is equal to", values: "NYC" }] });
  ok("uses Object.Field API when present", /ssot__Individual__dlm\.City__c = 'NYC'/.test(withApi));
  var noApi = segmentTreeToSql({ type: "set", items: [{ type: "simple", objectLabel: "Individual", fieldLabel: "City", operator: "is equal to", values: "NYC" }] });
  ok("falls back to [Object].[Field] labels (bracketed = NOT an api)", /\[Individual\]\.\[City\] = 'NYC'/.test(noApi));
  ok("header honestly flags [Label] = unresolved, not an API", /\[Label\] = unresolved label, not an API/.test(noApi));
}

console.log("\n3. tree structure — AND/OR joins + nested groups become parenthesized SQL");
{
  var tree = { type: "set", join: "AND", items: [
    { type: "simple", fieldApi: "A__c", operator: "is equal to", values: "1" },
    { type: "set", join: "OR", items: [
      { type: "simple", fieldApi: "B__c", operator: "is equal to", values: "2" },
      { type: "simple", fieldApi: "C__c", operator: "is equal to", values: "3" }
    ] }
  ] };
  var sql = segmentTreeToSql(tree, "Seg", "Include");
  ok("top-level AND joins the two items", /A__c = 1[\s\S]*AND[\s\S]*\(/.test(sql));
  ok("nested OR group is parenthesized", /\(B__c = 2[\s\S]*OR[\s\S]*C__c = 3\)/.test(sql));
}

console.log("\n4. honesty + special condition types");
{
  var sql = segmentTreeToSql({ type: "set", items: [{ type: "simple", fieldApi: "X__c", operator: "is equal to", values: "1" }] }, "My Seg", "Include");
  ok("header says APPROXIMATE + verify before running", /APPROXIMATE SQL — illustrative, verify before running/.test(sql));
  ok("includes the segment name + tab in a comment", /Segment: My Seg  \(tab: Include\)/.test(sql));
  ok("empty tree → honest 'no conditions' (not a fake query)", /no conditions on this tab/.test(segmentTreeToSql({ type: "set", items: [] })));
  ok("nested-segment → comment pointing to expand separately (not fabricated SQL)",
    /references segment: Loyal \(Include\) — expand separately/.test(segmentTreeToSql({ type: "set", items: [{ type: "nested-segment", objectLabel: "Loyal", fieldLabel: "Include" }] })));
  ok("aggregation → marked /* aggregation */ (illustrative, not claimed runnable)",
    /\/\* aggregation \*\//.test(segmentTreeToSql({ type: "set", items: [{ type: "aggregation", objectLabel: "Orders", fieldLabel: "COUNT", operator: "greater than", values: "5", subFilters: [] }] })));
  ok("CI condition → marked /* calculated insight */",
    /\/\* calculated insight \*\//.test(segmentTreeToSql({ type: "set", items: [{ type: "ci", fieldApi: "Score__c", operator: "greater than", values: "90" }] })));
}

console.log("\n5. source presence — real function wired dev-only into the segment export");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("segmentTreeToSql present", /function segmentTreeToSql\(tree, segName, activeTab\)/.test(src));
  ok("honest header baked into the output", /APPROXIMATE SQL — illustrative, verify before running/.test(src));
  ok("operator map covers the UI vocabulary", /case "is equal to"/.test(src) && /case "is between"/.test(src) && /case "contains"/.test(src) && /case "has no value"/.test(src));
  ok("never fakes an api — [Label] fallback", /"\[" \+ node\.objectLabel \+ "\]"/.test(src) && /\[Label\] = unresolved label, not an API/.test(src));
  ok("single-quote escaping (no trivial injection / broken SQL)", /replace\(\/'\/g, "''"\)/.test(src));
  ok("'Copy SQL (approx)' toolbar button wired to the current tab's tree", /id='dc-d-sql'/.test(src) && /segmentTreeToSql\(d\.tree, segName, currentModalTab\)/.test(src));
  ok("button guarded on the function existing (runtime dev-gate)", /typeof segmentTreeToSql !== "function"/.test(src));
  ok("DEV-ONLY: absent from the public/stripped bookmarklet", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/function segmentTreeToSql/.test(strip) && !/dc-d-sql/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function segmentTreeToSql/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
