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
      case "starts with": case "begins with": return "LIKE " + q((list[0] || "") + "%");
      case "does not begin with": case "does not start with": return "NOT LIKE " + q((list[0] || "") + "%");
      case "ends with": return "LIKE " + q("%" + (list[0] || ""));
      case "does not end with": return "NOT LIKE " + q("%" + (list[0] || ""));
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

console.log("\n5e. string operators incl. SF's actual labels (Begins With) — the reported /* Begins With */ bug");
{
  function w(op, v) { return segmentTreeToSql({ type:"set", items:[ {type:"simple",objApi:"P__dlm",fieldApi:"F__c",operator:op,values:v} ] }, "s"); }
  ok("'Begins With' → LIKE 'x%' (was rendered as an unhandled /* Begins With */ comment)", /F__c LIKE 'x%'/.test(w("begins with", "x")) && !/\/\* Begins With \*\//i.test(w("begins with", "x")));
  ok("'starts with' still → LIKE 'x%'", /F__c LIKE 'x%'/.test(w("starts with", "x")));
  ok("'ends with' → LIKE '%x'", /F__c LIKE '%x'/.test(w("ends with", "x")));
  ok("'does not begin with' → NOT LIKE 'x%'", /F__c NOT LIKE 'x%'/.test(w("does not begin with", "x")));
  ok("'does not end with' → NOT LIKE '%x'", /F__c NOT LIKE '%x'/.test(w("does not end with", "x")));
  ok("'contains' → LIKE '%x%'", /F__c LIKE '%x%'/.test(w("contains", "x")));
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

console.log("\n5f. API-criteria renderer (segmentApiCriteriaToSql) — mirror, against REAL captured node shapes");
{
  // Mirror of the renderer's core (operator enum + col + walk) kept in sync with source.
  function q(v){ var s=String(v==null?"":v); if(/^-?\d+(\.\d+)?$/.test(s))return s; if(/^(true|false)$/i.test(s))return s.toUpperCase(); return "'"+s.replace(/'/g,"''")+"'"; }
  function opSql(opRaw,vals){ var op=String(opRaw||"").trim().toLowerCase(); var list=Array.isArray(vals)?vals.slice():(vals==null?[]:[vals]);
    switch(op){ case "equal":case "equals":return "= "+(list.length?q(list[0]):"''");
      case "notequal":return "<> "+(list.length?q(list[0]):"''");
      case "contains":return "LIKE "+q("%"+(list[0]||"")+"%");
      case "in":return "IN ("+(list.length?list.map(q).join(", "):"''")+")";
      case "greaterthanorequal":return ">= "+(list.length?q(list[0]):"0");
      case "between":return "BETWEEN "+(list[0]!=null?q(list[0]):"''")+" AND "+(list[1]!=null?q(list[1]):"''");
      case "istrue":return "= TRUE"; case "isnotnull":case "hasvalue":return "IS NOT NULL";
      default:return "/* op:"+opRaw+" */ "+(list.length?q(list[0]):""); } }
  function col(s){ if(!s)return "/* field? */"; var o=s.objectApiName||"",f=s.fieldApiName||""; return (o&&f)?(o+"."+f):(f||o||"/* field? */"); }
  var joins={};
  function notePath(p){ if(!Array.isArray(p))return; p.forEach(function(h){ if(Array.isArray(h)&&h.length===2&&h[0]&&h[1]) joins[col(h[0])+" = "+col(h[1])]=true; }); }
  function leaf(n){ notePath(n.path); if(n.comparison)notePath(n.comparison.path); var c=n.comparison||n; return col(c.subject)+" "+opSql(c.operator,c.values); }
  function walk(n,d){ if(!n||typeof n!=="object")return ""; if(n.filter&&typeof n.filter==="object")return walk(n.filter,d);
    var t=String(n.type||"");
    if(t==="LogicalComparison"){ var j=String(n.operator||"AND").toUpperCase(); var parts=(n.filters||[]).map(function(f){return walk(f,d+1);}).filter(Boolean); if(!parts.length)return ""; var body=parts.join("\n"+"  ".repeat(d+1)+j+" "); return d===0?body:"("+body+")"; }
    if(t==="CalculatedInsight"){ notePath(n.path); return "/* calculated insight */ "+leaf(n); }
    if(/Comparison$/.test(t))return leaf(n);
    return "/* UNHANDLED: "+(t||"unknown node")+" */"; }

  // (a) the REAL CI leaf sample (TDI_5_random_control)
  joins={};
  var ci = { type:"CalculatedInsight", subject:{objectApiName:"TDI_Independent_Audience_Splits__cio",fieldApiName:"Unified_Individual_ID__c"},
    path:[[{objectApiName:"TDI_UnifiedIndividualTdir__dlm",fieldApiName:"Id__c"},{objectApiName:"TDI_Independent_Audience_Splits__cio",fieldApiName:"Unified_Individual_ID__c"}]],
    comparison:{type:"TextComparison",subject:{objectApiName:"TDI_Independent_Audience_Splits__cio",fieldApiName:"Control_5_Pct__c"},operator:"equal",values:["T"]} };
  var ciSql = walk(ci,0);
  ok("CI leaf → real col + '= T' using real operator enum", /TDI_Independent_Audience_Splits__cio\.Control_5_Pct__c = 'T'/.test(ciSql));
  ok("CI join PATH captured (Individual.Id__c = CI.Unified_Individual_ID__c)", joins["TDI_UnifiedIndividualTdir__dlm.Id__c = TDI_Independent_Audience_Splits__cio.Unified_Individual_ID__c"] === true);

  // (b) the REAL group sample (TDI_Gift_Card_Auto_95T): LogicalComparison AND with a leaf + wrapped child
  joins={};
  var grp = { type:"LogicalComparison", operator:"and", filters:[
    { type:"TextComparison", subject:{objectApiName:"TDI_UnifiedIndividualTdir__dlm",fieldApiName:"TDI_Account_Multiline__c"}, operator:"equal", values:["A"] },
    { filter: { type:"TextComparison", subject:{objectApiName:"TDI_TDI_GI_Individual_Additional__dlm",fieldApiName:"DataSourceObject__c"}, operator:"equal", values:["RH_Profile_Synthetic (79).csv"] } }
  ] };
  var gSql = walk(grp,0);
  ok("group leaf 1 (real api + = 'A')", /TDI_UnifiedIndividualTdir__dlm\.TDI_Account_Multiline__c = 'A'/.test(gSql));
  ok("AND join between filters", /= 'A'[\s\S]*\n\s*AND\s/.test(gSql));
  ok("WRAPPED child {filter:…} is unwrapped to its inner leaf", /TDI_TDI_GI_Individual_Additional__dlm\.DataSourceObject__c = 'RH_Profile_Synthetic \(79\)\.csv'/.test(gSql));

  // (c) nested OR group inside AND → parenthesized
  var nested = { type:"LogicalComparison", operator:"and", filters:[
    { type:"TextComparison", subject:{objectApiName:"O__dlm",fieldApiName:"a__c"}, operator:"equal", values:["1"] },
    { type:"LogicalComparison", operator:"or", filters:[
      { type:"TextComparison", subject:{objectApiName:"O__dlm",fieldApiName:"b__c"}, operator:"equal", values:["2"] },
      { type:"TextComparison", subject:{objectApiName:"O__dlm",fieldApiName:"c__c"}, operator:"equal", values:["3"] } ] }
  ] };
  var nSql = walk(nested,0);
  ok("nested OR group is parenthesized", /\(O__dlm\.b__c = 2[\s\S]*OR[\s\S]*O__dlm\.c__c = 3\)/.test(nSql));

  // (d) operator enum coverage + unhandled node safety
  ok("'greaterThanOrEqual' → >=", /\>= 5/.test(walk({type:"NumberComparison",subject:{objectApiName:"O__dlm",fieldApiName:"n__c"},operator:"greaterThanOrEqual",values:["5"]},0)));
  ok("'in' list → IN (...)", /IN \('x', 'y'\)/.test(walk({type:"TextComparison",subject:{objectApiName:"O__dlm",fieldApiName:"s__c"},operator:"in",values:["x","y"]},0)));
  ok("unknown node type → /* UNHANDLED */ (never silently wrong)", /\/\* UNHANDLED: WeirdNode \*\//.test(walk({type:"WeirdNode"},0)));
  ok("unknown OPERATOR → /* op:xyz */ (surfaced, not dropped)", /\/\* op:xyz \*\//.test(walk({type:"TextComparison",subject:{objectApiName:"O__dlm",fieldApiName:"f__c"},operator:"xyz",values:["1"]},0)));
}

console.log("\n6. source presence — fixed function wired dev-only into the segment export");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("segmentTreeToSql present (takes primaryObj)", /function segmentTreeToSql\(tree, segName, activeTab, primaryObj\)/.test(src));
  ok("REAL FROM table (no '/* primary segmented object */' placeholder anymore)", /FROM " \+ fromObj/.test(src) && !/FROM \/\* primary segmented object \*\//.test(src));
  ok("aggregation = COUNT(*) subquery + threshold op (fixes 'Count(table WHERE) At Least N')", /SELECT COUNT\(\*\) FROM " \+ obj/.test(src) && /function aggCmp/.test(src) && /at least/.test(src) && /return ">="/.test(src));
  ok("string operators include SF's 'begins with' / 'does not begin with' / 'does not end with'", /case "starts with": case "begins with"/.test(src) && /case "does not begin with"/.test(src) && /case "does not end with"/.test(src));
  ok("reader OP_RE recognizes 'begins with' (so it's captured, not dropped)", /begins with\|ends with\|does not begin with/.test(src));
  ok("complexity detection → LOGIC VIEW banner for multi-object/agg/CI/NESTED", /var isComplex = flags\.hasAgg \|\| flags\.hasCi \|\| flags\.hasNested \|\| multiObject/.test(src) && /LOGIC VIEW — NOT runnable as-is/.test(src));
  ok("EXCLUDE tab negates (WHERE NOT (...))", /tabKind === "exclude"\) \? "NOT \(/.test(src) && /\[EXCLUDE → condition is NEGATED\]/.test(src));
  ok("RANK & LIMIT handled as ORDER BY/LIMIT, not WHERE", /tabKind === "rank"/.test(src) && /ORDER BY " \+ rankField/.test(src) && /RANK & LIMIT — not a filter/.test(src));
  ok("primary object derived from first top-level simple condition when not passed", /function firstSimpleObj/.test(src));
  ok("never fakes an api — [Label] fallback", /"\[" \+ node\.objectLabel \+ "\]"/.test(src) && /not an API/.test(src));
  ok("caller passes a primary-object hint only when 'Segment On' looks like an api", /primaryHint = \(meta && \/__\(dlm\|dll\|dls\|c\|cio\)\$\/i\.test/.test(src) && /segmentTreeToSql\(d\.tree, segName, currentModalTab, primaryHint\)/.test(src));
  ok("'Copy SQL' button present, guarded on the fn", /id='dc-d-sql'/.test(src) && /typeof segmentTreeToSql !== "function"/.test(src));
  ok("API-criteria renderer present (authoritative tree → clean SQL)", /function segmentApiCriteriaToSql\(criteria, segName, tabLabel\)/.test(src));
  ok("renderer handles the real node grammar: LogicalComparison / CalculatedInsight / *Comparison / {filter} unwrap",
    /t === "LogicalComparison"/.test(src) && /t === "CalculatedInsight"/.test(src) && /\/Comparison\$\/\.test\(t\)/.test(src) && /node\.filter && typeof node\.filter === "object"\) return walk\(node\.filter/.test(src));
  ok("renderer maps REAL operator enums (equal/contains/in/greaterThanOrEqual/between/isTrue…)",
    /case "equal":/.test(src) && /case "contains":/.test(src) && /case "greaterthanorequal":/.test(src) && /case "between":/.test(src) && /case "istrue":/.test(src));
  ok("renderer captures JOIN keys from path[] (the thing the DOM lacked)", /function notePath\(path\)/.test(src) && /Join keys \(from the criteria's path\)/.test(src));
  ok("renderer marks UNHANDLED nodes (never silently wrong)", /UNHANDLED: " \+ \(t \|\| "unknown node"\)/.test(src));
  ok("Copy SQL PREFERS API criteria when extension present, DOM fallback otherwise",
    /typeof window\.__dcGetSegmentDef === "function" && segId/.test(src) && /segmentApiCriteriaToSql\(crit, segName, currentModalTab\)/.test(src) && /var domFallback = function/.test(src));
  ok("reads segment id from URL (runtime_cdp__record_id) + decodes HTML entities before JSON.parse",
    /runtime_cdp__record_id/.test(src) && /ta\.innerHTML = String\(s \|\| ""\); return ta\.value/.test(src) && /JSON\.parse\(dsEsc\(raw\)\)/.test(src));
  ok("DEV-ONLY: absent from the public/stripped bookmarklet", (function () { var strip = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, ""); return !/function segmentTreeToSql/.test(strip) && !/dc-d-sql/.test(strip); })());
  ok("present in the FULL bookmarklet build (synced)", /function segmentTreeToSql/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
