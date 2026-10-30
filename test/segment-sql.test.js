// Segment criteria → SQL logic view (dev-only). Pure logic + source-presence. Run in Node:
//   node test/segment-sql.test.js
//
// Translates the captured condition TREE into SQL. HONEST about runnability: a single-object segment
// (no aggregation/CI/second object) is ~runnable; anything multi-object/aggregation/CI is a LOGIC VIEW
// ONLY (the join relationships aren't in the criteria, so no runnable SQL can be reconstructed) and is
// clearly banner-labeled as such. Uses real objApi/fieldApi when present, else [Label] (never fakes an
// API). Aggregations render as (SELECT COUNT(*) FROM obj WHERE … ) >= N with the real threshold operator.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirror of segmentTreeToSql (kept in sync with the source) ──
function segmentTreeToSql(tree, segName, activeTab, primaryObj) {
  var flags = { hasAgg: false, hasCi: false, objs: {} };
  function noteObj(o) { if (o) flags.objs[o] = true; }
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
      default: return (op ? "/* " + opRaw + " */ " + (list.length ? q(list[0]) : "") : "/* ? */");
    }
  }
  function aggCmp(opRaw) {
    var op = String(opRaw || "").trim().toLowerCase();
    if (/at least/.test(op)) return ">=";
    if (/at most/.test(op)) return "<=";
    if (/exactly|equal/.test(op)) return "=";
    if (/greater/.test(op)) return ">";
    if (/less|fewer/.test(op)) return "<";
    return ">=";
  }
  function colRef(node) {
    var o = node.objApi || (node.objectLabel ? "[" + node.objectLabel + "]" : "");
    var f = node.fieldApi || (node.fieldLabel ? "[" + node.fieldLabel + "]" : "");
    if (node.objApi) noteObj(node.objApi);
    if (o && f) return o + "." + f;
    return f || o || "/* field? */";
  }
  function condSql(node, indent) {
    if (node.type === "simple") { if (node.objApi) noteObj(node.objApi); return colRef(node) + " " + opToSql(node.operator, node.values); }
    if (node.type === "ci") { flags.hasCi = true; if (node.objApi) noteObj(node.objApi); return "EXISTS (/* calculated insight " + (node.objApi || node.objectLabel || "") + " */ " + colRef(node) + " " + opToSql(node.operator, node.values) + ")"; }
    if (node.type === "aggregation") {
      flags.hasAgg = true;
      var obj = node.objApi || node.objectLabel || "/* object */";
      noteObj(node.objApi || "");
      var innerPad = "\n" + indent + "    ";
      var inner = (node.subFilters && node.subFilters.length)
        ? innerPad + "WHERE " + node.subFilters.map(function (s) { return colRef(s) + " " + opToSql(s.operator, s.values); }).join(innerPad + "  " + (node.subJoin || "AND") + " ")
        : "";
      var n = (String(node.values || "").match(/\d+/) || ["1"])[0];
      return "( SELECT COUNT(*) FROM " + obj + inner + innerPad + "/* TODO: correlate to primary */ ) " + aggCmp(node.operator) + " " + n;
    }
    if (node.type === "nested-segment") return "EXISTS (/* member of segment: " + (node.objectLabel || "") + " (" + (node.fieldLabel || "") + ") — expand separately */)";
    return "/* unsupported condition */";
  }
  function walk(node, depth) {
    if (!node) return "";
    if (node.type === "set") {
      var pad = "  ".repeat(depth + 1);
      var parts = (node.items || []).map(function (it) { return walk(it, depth + 1); }).filter(Boolean);
      if (!parts.length) return "";
      var joined = parts.join("\n" + pad + (node.join || "AND") + " ");
      return depth === 0 ? joined : "(" + joined + ")";
    }
    return condSql(node, "  ".repeat(depth));
  }
  var where = walk(tree, 0);
  var objList = Object.keys(flags.objs).filter(Boolean);
  function firstSimpleObj(node) {
    if (!node) return "";
    if (node.type === "simple") return node.objApi || "";
    if (node.type === "set") { for (var i = 0; i < (node.items || []).length; i++) { var o = firstSimpleObj(node.items[i]); if (o) return o; } }
    return "";
  }
  var primeObj = primaryObj || firstSimpleObj(tree) || objList[0] || null;
  var multiObject = objList.filter(function (o) { return o !== primeObj; }).length > 0;
  var isComplex = flags.hasAgg || flags.hasCi || multiObject;
  var fromObj = primeObj;
  var banner = isComplex
    ? ("-- ⚠️ LOGIC VIEW — NOT runnable as-is. This segment spans multiple objects/aggregations/\n" +
       "-- calculated insights, whose JOIN relationships are NOT part of the segment criteria, so a\n" +
       "-- single runnable SQL can't be reconstructed. Use this to READ the logic, not to execute.\n")
    : ("-- APPROXIMATE SQL — single-object segment; verify before running.\n");
  var header = banner +
               "-- Segment: " + (segName || "") + (activeTab ? "  (tab: " + activeTab + ")" : "") + "\n" +
               "-- Real API names used where available; [Label] = unresolved label (not an API).\n" +
               (objList.length ? "-- Objects referenced: " + objList.join(", ") + "\n" : "");
  if (!where) return header + "-- (no conditions on this tab)";
  var fromLine = fromObj ? ("FROM " + fromObj) : "FROM /* segment's primary object (Segment On) */";
  return header + "SELECT *\n" + fromLine + "\nWHERE " + where + ";";
}

console.log("\n1. SINGLE-OBJECT segment → ~runnable, real FROM, no logic-view banner");
{
  var tree = { type: "set", join: "AND", items: [
    { type: "simple", objApi: "ssot__Individual__dlm", fieldApi: "City__c", operator: "is equal to", values: "NYC" },
    { type: "simple", objApi: "ssot__Individual__dlm", fieldApi: "Active__c", operator: "is true", values: "" }
  ] };
  var sql = segmentTreeToSql(tree, "Seg", "Include");
  ok("has a REAL FROM table (not a comment placeholder)", /FROM ssot__Individual__dlm/.test(sql) && !/FROM \/\*/.test(sql));
  ok("no 'LOGIC VIEW' banner for a clean single-object segment", !/LOGIC VIEW/.test(sql) && /APPROXIMATE SQL — single-object/.test(sql));
  ok("conditions render correctly", /City__c = 'NYC'/.test(sql) && /Active__c = TRUE/.test(sql) && /AND/.test(sql));
  ok("FROM is immediately followed by WHERE with a real column (the reported syntax error is gone)", /FROM ssot__Individual__dlm\nWHERE ssot__Individual__dlm\.City__c/.test(sql));
}

console.log("\n2. the EXACT failure from the user's segment: FROM placeholder + Count(… WHERE) + missing >=");
{
  // reproduce an aggregation like theirs: Count(obj WHERE …) At Least 1, plus a different primary object
  var tree = { type: "set", join: "AND", items: [
    { type: "simple", objApi: "TDI_UnifiedIndividualTdir__dlm", fieldApi: "TDI_Account_Multiline__c", operator: "is equal to", values: "A" },
    { type: "aggregation", objApi: "TDI_InsurancePolicy__dlm", fieldLabel: "Count", operator: "At Least", values: "1",
      subFilters: [{ objApi: "TDI_InsurancePolicy__dlm", fieldApi: "DaystoExpiration__c", operator: "is between", values: "83, 93" }], subJoin: "AND" }
  ] };
  var sql = segmentTreeToSql(tree, "Gift", "Include");
  ok("FROM is the PRIMARY object (first top-level simple), not a placeholder", /FROM TDI_UnifiedIndividualTdir__dlm/.test(sql));
  ok("aggregation is now a valid COUNT(*) SUBQUERY (not 'Count(table WHERE)')", /\( SELECT COUNT\(\*\) FROM TDI_InsurancePolicy__dlm/.test(sql) && !/Count\(TDI_InsurancePolicy__dlm WHERE/.test(sql));
  ok("'At Least 1' now renders a real comparison >= 1 (was a bare number before)", /\) >= 1/.test(sql));
  ok("subquery WHERE uses BETWEEN correctly", /DaystoExpiration__c BETWEEN 83 AND 93/.test(sql));
  ok("multi-object/aggregation → clearly flagged as LOGIC VIEW, NOT runnable", /LOGIC VIEW — NOT runnable as-is/.test(sql));
  ok("lists the objects referenced (honesty about the join problem)", /Objects referenced: TDI_UnifiedIndividualTdir__dlm, TDI_InsurancePolicy__dlm/.test(sql));
}

console.log("\n3. aggregation threshold operators map correctly");
{
  function agg(op, n) { return segmentTreeToSql({ type:"set", items:[ {type:"simple",objApi:"P__dlm",fieldApi:"x__c",operator:"is true",values:""}, { type:"aggregation", objApi:"O__dlm", fieldLabel:"Count", operator:op, values:String(n), subFilters:[] } ] }, "s"); }
  ok("At Least → >=", /\) >= 3/.test(agg("At Least", 3)));
  ok("At Most → <=", /\) <= 5/.test(agg("At Most", 5)));
  ok("Exactly → =", /\) = 2/.test(agg("Exactly", 2)));
}

console.log("\n4. CI + nested-segment rendered as EXISTS markers (not broken flat refs)");
{
  var ci = segmentTreeToSql({ type:"set", items:[ {type:"ci", objApi:"Tier__cio", fieldApi:"Id__c", operator:"is equal to", values:"T"} ] }, "s");
  ok("CI → EXISTS(/* calculated insight */ …), flagged logic view", /EXISTS \(\/\* calculated insight Tier__cio/.test(ci) && /LOGIC VIEW/.test(ci));
  var ns = segmentTreeToSql({ type:"set", items:[ {type:"simple",objApi:"P__dlm",fieldApi:"x__c",operator:"is true",values:""}, {type:"nested-segment", objectLabel:"Loyal", fieldLabel:"Include"} ] }, "s");
  ok("nested-segment → EXISTS(/* member of segment … */)", /EXISTS \(\/\* member of segment: Loyal \(Include\)/.test(ns));
}

console.log("\n5. honesty + safety: labels, quoting, empty");
{
  var noApi = segmentTreeToSql({ type:"set", items:[ {type:"simple", objectLabel:"Individual", fieldLabel:"City", operator:"is equal to", values:"NYC"} ] }, "s");
  ok("falls back to [Label].[Field] when no api (bracketed = not an api)", /\[Individual\]\.\[City\] = 'NYC'/.test(noApi));
  ok("header flags [Label] = unresolved", /\[Label\] = unresolved label \(not an API\)/.test(noApi));
  ok("single-quote escaping", /= 'O''Brien'/.test(segmentTreeToSql({ type:"set", items:[ {type:"simple",objApi:"P__dlm",fieldApi:"n__c",operator:"is equal to",values:"O'Brien"} ] }, "s")));
  ok("empty tree → honest 'no conditions'", /no conditions on this tab/.test(segmentTreeToSql({ type:"set", items:[] }, "s")));
}

console.log("\n6. source presence — fixed function wired dev-only into the segment export");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("segmentTreeToSql present (takes primaryObj)", /function segmentTreeToSql\(tree, segName, activeTab, primaryObj\)/.test(src));
  ok("REAL FROM table (no '/* primary segmented object */' placeholder anymore)", /FROM " \+ fromObj/.test(src) && !/FROM \/\* primary segmented object \*\//.test(src));
  ok("aggregation = COUNT(*) subquery + threshold op (fixes 'Count(table WHERE) At Least N')", /SELECT COUNT\(\*\) FROM " \+ obj/.test(src) && /function aggCmp/.test(src) && /at least/.test(src) && /return ">="/.test(src));
  ok("complexity detection → LOGIC VIEW banner for multi-object/agg/CI", /var isComplex = flags\.hasAgg \|\| flags\.hasCi \|\| multiObject/.test(src) && /LOGIC VIEW — NOT runnable as-is/.test(src));
  ok("primary object derived from first top-level simple condition when not passed", /function firstSimpleObj/.test(src));
  ok("never fakes an api — [Label] fallback", /"\[" \+ node\.objectLabel \+ "\]"/.test(src) && /not an API/.test(src));
  ok("caller passes a primary-object hint only when 'Segment On' looks like an api", /primaryHint = \(meta && \/__\(dlm\|dll\|dls\|c\|cio\)\$\/i\.test/.test(src) && /segmentTreeToSql\(d\.tree, segName, currentModalTab, primaryHint\)/.test(src));
  ok("'Copy SQL (approx)' button present, guarded on the fn", /id='dc-d-sql'/.test(src) && /typeof segmentTreeToSql !== "function"/.test(src));
  ok("DEV-ONLY: absent from the public/stripped bookmarklet", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/function segmentTreeToSql/.test(strip) && !/dc-d-sql/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function segmentTreeToSql/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
