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
    if (node.type === "nested-segment") { flags.hasNested = true; return "EXISTS (/* member of segment: " + (node.objectLabel || "") + " (" + (node.fieldLabel || "") + ") — expand separately */)"; }
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
  var tabKind = /rank/i.test(String(activeTab || "")) ? "rank" : (/exclude/i.test(String(activeTab || "")) ? "exclude" : "include");
  function firstSimpleObj(node) {
    if (!node) return "";
    if (node.type === "simple") return node.objApi || "";
    if (node.type === "set") { for (var i = 0; i < (node.items || []).length; i++) { var o = firstSimpleObj(node.items[i]); if (o) return o; } }
    return "";
  }
  if (tabKind === "rank") {
    var rankLines = (tree && tree.items || []).map(function (it) {
      var obj = it.objApi || it.objectLabel || "/* object */";
      var rankField = it.fieldApi || it.operator || it.fieldLabel || "/* rank field */";
      var rankType = it.fieldLabel || "";
      var dir = /low|asc|bottom|smallest/i.test(rankType) ? "ASC" : "DESC";
      var lim = (String(it.values || "").match(/\d+/) || [""])[0];
      return "-- " + obj + ": rank by " + rankField + " (" + (rankType || dir) + ")" + (lim ? ", keep " + lim : "") + "\n" +
             "SELECT * FROM " + obj + "\nORDER BY " + rankField + " " + dir + (lim ? "\nLIMIT " + lim : "") + ";";
    });
    var rankHdr = "-- ⚠️ RANK & LIMIT — not a filter. Each ruleset picks top/bottom N by a field,\n" +
                  "-- applied SEQUENTIALLY (each over the previous ruleset's results). Illustrative only.\n" +
                  "-- Segment: " + (segName || "") + "  (tab: Rank and Limit)\n";
    return rankLines.length ? rankHdr + rankLines.join("\n\n") : rankHdr + "-- (no rank/limit rulesets)";
  }
  var where = walk(tree, 0);
  var objList = Object.keys(flags.objs).filter(Boolean);
  var primeObj = primaryObj || firstSimpleObj(tree) || objList[0] || null;
  var multiObject = objList.filter(function (o) { return o !== primeObj; }).length > 0;
  var isComplex = flags.hasAgg || flags.hasCi || flags.hasNested || multiObject;
  var fromObj = primeObj;
  var whereClause = (tabKind === "exclude") ? "NOT (\n  " + where + "\n)" : where;
  var reasons = [];
  if (multiObject) reasons.push("multiple objects");
  if (flags.hasAgg) reasons.push("aggregations");
  if (flags.hasCi) reasons.push("calculated insights");
  if (flags.hasNested) reasons.push("nested segment references");
  var banner = isComplex
    ? ("-- ⚠️ LOGIC VIEW — NOT runnable as-is (" + reasons.join(", ") + "). The join relationships /\n" +
       "-- nested-segment / CI definitions are NOT part of the segment criteria, so a single runnable\n" +
       "-- SQL can't be reconstructed. Use this to READ the logic, not to execute.\n")
    : ("-- APPROXIMATE SQL — single-object segment; verify before running.\n");
  var header = banner +
               "-- Segment: " + (segName || "") + (activeTab ? "  (tab: " + activeTab + ")" : "") +
               (tabKind === "exclude" ? "  [EXCLUDE → condition is NEGATED]" : "") + "\n" +
               "-- Real API names used where available; [Label] = unresolved label (not an API).\n" +
               (objList.length ? "-- Objects referenced: " + objList.join(", ") + "\n" : "");
  if (!where) return header + "-- (no conditions on this tab)";
  var fromLine = fromObj ? ("FROM " + fromObj) : "FROM /* segment's primary object (Segment On) */";
  return header + "SELECT *\n" + fromLine + "\nWHERE " + whereClause + ";";
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

console.log("\n5b. nested-segment forces LOGIC VIEW (NOT 'single-object runnable') — the reported mislabel");
{
  var tree = { type: "set", join: "AND", items: [
    { type: "simple", objApi: "TDI_UnifiedIndividualApp6__dlm", fieldApi: "TDI_Account_Multiline__c", operator: "is equal to", values: "M" },
    { type: "simple", objApi: "TDI_UnifiedIndividualApp6__dlm", fieldApi: "TDI_Is_Active_Customer__c", operator: "is true", values: "" },
    { type: "nested-segment", objectLabel: "SF_PM_GI_TRGT__Cust Mkt Contact Ind", fieldLabel: "Use Last Published Membership" }
  ] };
  var sql = segmentTreeToSql(tree, "SF_PM_GI_TRGT__Multiline", "Include");
  ok("a nested-segment reference → LOGIC VIEW banner (no longer mislabeled 'single-object; verify')",
    /LOGIC VIEW — NOT runnable as-is \(nested segment references\)/.test(sql) && !/single-object segment; verify/.test(sql));
  ok("still shows the EXISTS nested marker", /EXISTS \(\/\* member of segment: SF_PM_GI_TRGT__Cust Mkt Contact Ind/.test(sql));
}

console.log("\n5c. EXCLUDE tab negates the condition (remove-these semantics)");
{
  var tree = { type: "set", items: [{ type: "simple", objApi: "P__dlm", fieldApi: "x__c", operator: "is true", values: "" }] };
  var inc = segmentTreeToSql(tree, "s", "Include");
  var exc = segmentTreeToSql(tree, "s", "Exclude");
  ok("Include → plain WHERE", /WHERE P__dlm\.x__c = TRUE/.test(inc) && !/NOT \(/.test(inc));
  ok("Exclude → WHERE NOT ( … ) + [EXCLUDE → condition is NEGATED] note", /WHERE NOT \(/.test(exc) && /\[EXCLUDE → condition is NEGATED\]/.test(exc));
}

console.log("\n5d. RANK AND LIMIT is ORDER BY / LIMIT, NOT a WHERE filter (was producing garbage)");
{
  // rank rows: fieldLabel = rank direction, operator = rank field, values = "Limit: N"
  var tree = { type: "set", join: "SEQ", items: [
    { type: "simple", objApi: "TDI_Ind__dlm", fieldApi: "Score__c", fieldLabel: "Highest", operator: "", values: "Limit: 1000", subFilters: [] }
  ] };
  var sql = segmentTreeToSql(tree, "s", "Rank and Limit");
  ok("renders ORDER BY + LIMIT, not WHERE", /ORDER BY Score__c DESC/.test(sql) && /LIMIT 1000/.test(sql) && !/WHERE/.test(sql));
  ok("clearly flagged RANK & LIMIT — not a filter", /RANK & LIMIT — not a filter/.test(sql));
  ok("'Lowest' direction → ASC", /ORDER BY .* ASC/.test(segmentTreeToSql({ type:"set", items:[{type:"simple",objApi:"O__dlm",fieldApi:"V__c",fieldLabel:"Lowest",values:"Limit: 5"}] }, "s", "Rank and Limit")));
}

console.log("\n6. source presence — fixed function wired dev-only into the segment export");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("segmentTreeToSql present (takes primaryObj)", /function segmentTreeToSql\(tree, segName, activeTab, primaryObj\)/.test(src));
  ok("REAL FROM table (no '/* primary segmented object */' placeholder anymore)", /FROM " \+ fromObj/.test(src) && !/FROM \/\* primary segmented object \*\//.test(src));
  ok("aggregation = COUNT(*) subquery + threshold op (fixes 'Count(table WHERE) At Least N')", /SELECT COUNT\(\*\) FROM " \+ obj/.test(src) && /function aggCmp/.test(src) && /at least/.test(src) && /return ">="/.test(src));
  ok("complexity detection → LOGIC VIEW banner for multi-object/agg/CI/NESTED", /var isComplex = flags\.hasAgg \|\| flags\.hasCi \|\| flags\.hasNested \|\| multiObject/.test(src) && /LOGIC VIEW — NOT runnable as-is/.test(src));
  ok("EXCLUDE tab negates (WHERE NOT (...))", /tabKind === "exclude"\) \? "NOT \(/.test(src) && /\[EXCLUDE → condition is NEGATED\]/.test(src));
  ok("RANK & LIMIT handled as ORDER BY/LIMIT, not WHERE", /tabKind === "rank"/.test(src) && /ORDER BY " \+ rankField/.test(src) && /RANK & LIMIT — not a filter/.test(src));
  ok("primary object derived from first top-level simple condition when not passed", /function firstSimpleObj/.test(src));
  ok("never fakes an api — [Label] fallback", /"\[" \+ node\.objectLabel \+ "\]"/.test(src) && /not an API/.test(src));
  ok("caller passes a primary-object hint only when 'Segment On' looks like an api", /primaryHint = \(meta && \/__\(dlm\|dll\|dls\|c\|cio\)\$\/i\.test/.test(src) && /segmentTreeToSql\(d\.tree, segName, currentModalTab, primaryHint\)/.test(src));
  ok("'Copy SQL (approx)' button present, guarded on the fn", /id='dc-d-sql'/.test(src) && /typeof segmentTreeToSql !== "function"/.test(src));
  ok("DEV-ONLY: absent from the public/stripped bookmarklet", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/function segmentTreeToSql/.test(strip) && !/dc-d-sql/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function segmentTreeToSql/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
