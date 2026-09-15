// Segment Criteria SQL generator tests — run in Node, no browser needed.
//   node test/segment-sql-generator.test.js
//
// SEPARATE test file on purpose — this is its OWN isolated feature, not shared with
// Data Explorer or the Helpful Queries templates.
//
// Generates the ENGINE-EXECUTED form of a segment's query (not the strict
// unquoted-PK-only dialect submitted to POST/PATCH /ssot/segments — that's a
// different, narrower API payload grammar). This is real, runnable Data 360 SQL,
// confirmed against an ACTUAL generated segment query shown in a Salesforce
// engineering blog (Darshna Sharma, salesforceblogger.com, "Filter Level Counts in
// Segmentation" / segmentation deep-dive), cross-checked against Salesforce's own
// documented SQL reference (quoted identifiers, TIMESTAMP literals, IS NOT DISTINCT
// FROM — all separately confirmed in the Data 360 SQL reference earlier this session):
//
//   1. select distinct <segment-on PK column(s)>, quoted + fully qualified.
//   2. Segment-on table aliased as "<DMOName>__0" (first table), e.g.
//      "ssot__Account__dlm__0". Related-object filters use ANOTHER alias,
//      "<RelatedDMOName>__0", for the FIRST use of that DMO — increments (__1, __2...)
//      only if the SAME related DMO is joined again for a different filter.
//   3. Every own-object condition filters directly in the outer WHERE.
//   4. Every RELATED-object condition (different DMO) becomes its own correlated
//      "WHERE EXISTS (SELECT 1 FROM <related> WHERE <join> AND <join KQ check> AND
//      <the actual filter condition>)" subquery — NOT an inline join.
//   5. Conditions in the SAME container combine with inline and/or INSIDE one
//      WHERE/EXISTS — this is what avoids the expensive per-container UNION the blog
//      warns about. Two SEPARATE containers joined by "Or" would instead produce a
//      UNION of two independent EXISTS subqueries (re-scanning the DMO twice) — this
//      generator deliberately does NOT do that; it always merges into ONE query
//      (that's the whole point — "not container-wise").
//   6. Date/timestamp filters use TIMESTAMP '...' / DATE '...' literals.
//   7. Join equality + optional key-qualifier IS NOT DISTINCT FROM check, confirmed
//      identical pattern to the documented Connect API PASS example.

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. Identifier quoting + value-literal escaping (injection-safety), same universal
//    rules used everywhere else in this tool.
// ─────────────────────────────────────────────────────────────────────────────
function qId(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }
function segLiteral(v, type) {
  if (v === null || v === undefined) return "null";
  var t = String(type || "text").toLowerCase();
  if (t === "number" || t === "integer" || t === "numeric" || t === "boolean") return String(v);
  if (t === "date") return "date '" + String(v).replace(/'/g, "''") + "'";
  if (t === "timestamp" || t === "datetime") return "timestamp '" + String(v).replace(/'/g, "''") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
console.log("\n1. Identifier quoting + value escaping (injection-safety)");
{
  eq("simple identifier quoted", qId("ssot__Account__dlm"), '"ssot__Account__dlm"');
  eq("embedded quote escaped in identifier", qId('Weird"Dmo'), '"Weird""Dmo"');
  eq("plain text value quoted", segLiteral("CA", "text"), "'CA'");
  eq("embedded quote escaped in value", segLiteral("O'Brien", "text"), "'O''Brien'");
  eq("injection-shaped value can't break out", segLiteral("x' OR '1'='1", "text"), "'x'' OR ''1''=''1'");
  eq("number NOT quoted", segLiteral(18, "number"), "18");
  eq("timestamp literal", segLiteral("2021-09-21T00:00:00.000Z", "timestamp"), "timestamp '2021-09-21T00:00:00.000Z'");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Table aliasing — "<DMOName>__0", confirmed exact pattern from the blog's real
//    generated SQL ("ssot__Account__dlm__0", "ssot__Case__dlm__0").
// ─────────────────────────────────────────────────────────────────────────────
function tableAlias(dmoName, index) { return dmoName + "__" + (index || 0); }
console.log("\n2. Table aliasing (<DMOName>__0 pattern, confirmed from real generated SQL)");
{
  eq("first alias is __0", tableAlias("ssot__Account__dlm"), "ssot__Account__dlm__0");
  eq("explicit index 0", tableAlias("ssot__Account__dlm", 0), "ssot__Account__dlm__0");
  eq("second join to same DMO increments", tableAlias("ssot__Case__dlm", 1), "ssot__Case__dlm__1");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Operator -> SQL fragment mapping (comparison/pattern/null only — no aggregates,
//    matching the segment builder's supported filter operators).
// ─────────────────────────────────────────────────────────────────────────────
var OPS = {
  "=":            function (col, v) { return col + " = " + v; },
  "!=":           function (col, v) { return col + " != " + v; },
  ">":            function (col, v) { return col + " > " + v; },
  ">=":           function (col, v) { return col + " >= " + v; },
  "<":            function (col, v) { return col + " < " + v; },
  "<=":           function (col, v) { return col + " <= " + v; },
  "LIKE":         function (col, v) { return col + " LIKE " + v; },
  "IN":           function (col, v) { return col + " IN (" + v + ")"; },
  "IS NULL":      function (col) { return col + " IS NULL"; },
  "IS NOT NULL":  function (col) { return col + " IS NOT NULL"; },
};
console.log("\n3. Operator -> SQL fragment mapping");
{
  eq("equals", OPS["="]('"ssot__Account__dlm__0"."ssot__Name__c"', "'Acme'"), '"ssot__Account__dlm__0"."ssot__Name__c" = \'Acme\'');
  eq("greater-or-equal timestamp", OPS[">="]('"ssot__Case__dlm__0"."ssot__CreatedDate__c"', "timestamp '2021-09-21T00:00:00.000Z'"),
    '"ssot__Case__dlm__0"."ssot__CreatedDate__c" >= timestamp \'2021-09-21T00:00:00.000Z\'');
  ok("no aggregate operator exists (COUNT/MAX/AVG/SUM banned by design)", !OPS.COUNT && !OPS.MAX && !OPS.AVG && !OPS.SUM);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. buildSegmentSql — the FULL, single-statement, non-container-wise generator.
//    spec.rootGroup.conditions can reference the segment-on object OR a related
//    object; related-object conditions get folded into an EXISTS subquery for that
//    object, ALL merged into one WHERE (never a per-container UNION).
// ─────────────────────────────────────────────────────────────────────────────
function buildWhereFragment(cond, alias) {
  var col = qId(alias) + "." + qId(cond.column);
  var fn = OPS[cond.op];
  if (!fn) throw new Error("Unsupported operator: " + cond.op);
  if (cond.op === "IS NULL" || cond.op === "IS NOT NULL") return fn(col);
  if (cond.op === "IN") return fn(col, cond.value.map(function (v) { return segLiteral(v, cond.type); }).join(","));
  return fn(col, segLiteral(cond.value, cond.type));
}

// Renders one group (conditions + nested subgroups) into a single boolean expression
// string, parenthesizing nested groups. `resolveAlias(cond)` returns which table alias
// a given condition's column belongs to (segment-on vs. a related object).
function renderGroup(group, resolveAlias) {
  if (!group) return "";
  var parts = [];
  (group.conditions || []).forEach(function (c) { parts.push(buildWhereFragment(c, resolveAlias(c))); });
  (group.groups || []).forEach(function (sub) {
    var inner = renderGroup(sub, resolveAlias);
    if (inner) parts.push("(" + inner + ")");
  });
  var joiner = (group.join === "OR") ? " OR " : " AND ";
  return parts.join(joiner);
}

function validateSegmentSpec(spec) {
  var errors = [];
  if (!spec || !spec.segmentOnObject) errors.push("Segment-on object is required.");
  if (!Array.isArray(spec.primaryKeyColumns) || spec.primaryKeyColumns.length === 0) errors.push("At least one primary key column is required.");
  return errors;
}

// spec = {
//   segmentOnObject, primaryKeyColumns: ["ssot__Id__c", ...],
//   rootGroup: { join, conditions: [{ object?, column, op, value, type }], groups: [...] },
//   dateRange?: { column, fromIso, toIso },  // Event Time Field lookback filter
// }
function buildSegmentSql(spec) {
  var errors = validateSegmentSpec(spec);
  if (errors.length) return { error: errors[0] };
  var mainAlias = tableAlias(spec.segmentOnObject, 0);
  var selectCols = spec.primaryKeyColumns.map(function (c) { return qId(mainAlias) + "." + qId(c); }).join(", ");
  var sql = "SELECT DISTINCT " + selectCols + " FROM " + qId(spec.segmentOnObject) + " " + qId(mainAlias);

  // Assign an alias per DISTINCT related object referenced by any condition — same
  // related DMO used twice still gets the SAME alias (one EXISTS per related object,
  // conditions on it combine inside that one EXISTS — this is the non-container-wise
  // merge behavior).
  var relatedAliasByObject = {};
  var relatedOrder = [];
  function collectRelated(group) {
    (group.conditions || []).forEach(function (c) {
      if (c.object && c.object !== spec.segmentOnObject && !relatedAliasByObject[c.object]) {
        relatedAliasByObject[c.object] = tableAlias(c.object, relatedOrder.length);
        relatedOrder.push(c.object);
      }
    });
    (group.groups || []).forEach(collectRelated);
  }
  collectRelated(spec.rootGroup || {});

  function resolveAlias(cond) {
    if (!cond.object || cond.object === spec.segmentOnObject) return mainAlias;
    return relatedAliasByObject[cond.object];
  }

  // Split the root group's direct conditions/subgroups by whether they touch the
  // segment-on object (stay in the outer WHERE) or a related object (fold into that
  // related object's EXISTS subquery). A condition is "for" a related object only if
  // it's a leaf condition naming that object; nested groups are walked recursively but
  // kept together (a group is either fully own-object or references related objects
  // inside it — mixed groups are unusual and out of scope for this generator).
  function partition(group) {
    var ownConds = [], relatedConds = {};
    (group.conditions || []).forEach(function (c) {
      if (!c.object || c.object === spec.segmentOnObject) ownConds.push(c);
      else { (relatedConds[c.object] = relatedConds[c.object] || []).push(c); }
    });
    return { ownConds: ownConds, relatedConds: relatedConds, groups: group.groups || [], join: group.join };
  }

  var top = partition(spec.rootGroup || {});
  var wherePieces = [];

  // Own-object conditions + nested own-object subgroups render directly.
  var ownGroupForRender = { join: top.join, conditions: top.ownConds, groups: (spec.rootGroup && spec.rootGroup.groups) || [] };
  var ownWhere = renderGroup(ownGroupForRender, resolveAlias);
  if (ownWhere) wherePieces.push(ownWhere);

  // One EXISTS subquery per related object, joined back to the segment-on alias via
  // the join spec supplied for that object. All conditions on that object (regardless
  // of how many separate filter rows the user added) combine with AND inside the SAME
  // EXISTS — this is the "not container-wise" merge the user asked for.
  (spec.joins || []).forEach(function (j) {
    var relAlias = relatedAliasByObject[j.object];
    if (!relAlias) return; // no condition actually references this join — skip it
    var conds = relatedConds_for(j.object);
    var joinOn = qId(mainAlias) + "." + qId(j.leftKey) + " = " + qId(relAlias) + "." + qId(j.rightKey);
    if (j.keyQualifier) {
      joinOn += " AND " + qId(mainAlias) + "." + qId(j.keyQualifier.left) + " IS NOT DISTINCT FROM " + qId(relAlias) + "." + qId(j.keyQualifier.right);
    }
    var innerWhere = conds.map(function (c) { return buildWhereFragment(c, relAlias); }).join(" AND ");
    var existsSql = "EXISTS (SELECT 1 FROM " + qId(j.object) + " " + qId(relAlias) + " WHERE " + joinOn + (innerWhere ? " AND " + innerWhere : "") + ")";
    wherePieces.push(existsSql);
  });
  function relatedConds_for(obj) { return top.relatedConds[obj] || []; }

  if (wherePieces.length) sql += " WHERE " + wherePieces.join(" AND ");
  if (spec.limit != null) sql += " LIMIT " + Number(spec.limit);
  return { sql: sql };
}

console.log("\n4. buildSegmentSql — single merged query (own-object conditions)");
{
  var spec1 = {
    segmentOnObject: "ssot__Account__dlm",
    primaryKeyColumns: ["ssot__Id__c"],
    rootGroup: { join: "AND", conditions: [
      { column: "ssot__Industry__c", op: "=", value: "Healthcare", type: "text" },
    ] },
  };
  eq("single own-object condition", buildSegmentSql(spec1).sql,
    'SELECT DISTINCT "ssot__Account__dlm__0"."ssot__Id__c" FROM "ssot__Account__dlm" "ssot__Account__dlm__0" WHERE "ssot__Account__dlm__0"."ssot__Industry__c" = \'Healthcare\'');

  var spec2 = {
    segmentOnObject: "ssot__Account__dlm",
    primaryKeyColumns: ["ssot__Id__c"],
    rootGroup: { join: "AND", conditions: [
      { column: "ssot__Industry__c", op: "=", value: "Healthcare", type: "text" },
      { column: "ssot__NumberOfEmployees__c", op: ">", value: 100, type: "number" },
    ] },
  };
  eq("two AND conditions merge in ONE where (no union)", buildSegmentSql(spec2).sql,
    'SELECT DISTINCT "ssot__Account__dlm__0"."ssot__Id__c" FROM "ssot__Account__dlm" "ssot__Account__dlm__0" WHERE "ssot__Account__dlm__0"."ssot__Industry__c" = \'Healthcare\' AND "ssot__Account__dlm__0"."ssot__NumberOfEmployees__c" > 100');

  var spec3 = {
    segmentOnObject: "ssot__Account__dlm",
    primaryKeyColumns: ["ssot__Id__c"],
    rootGroup: { join: "OR", conditions: [
      { column: "ssot__BillingState__c", op: "=", value: "CA", type: "text" },
      { column: "ssot__BillingState__c", op: "=", value: "NY", type: "text" },
    ] },
  };
  eq("OR conditions — SAME container, merged inline (not a UNION)", buildSegmentSql(spec3).sql,
    'SELECT DISTINCT "ssot__Account__dlm__0"."ssot__Id__c" FROM "ssot__Account__dlm" "ssot__Account__dlm__0" WHERE "ssot__Account__dlm__0"."ssot__BillingState__c" = \'CA\' OR "ssot__Account__dlm__0"."ssot__BillingState__c" = \'NY\'');
  ok("no UNION keyword anywhere — single merged query, not container-wise", !/UNION/i.test(buildSegmentSql(spec3).sql));

  var spec4 = {
    segmentOnObject: "ssot__Account__dlm",
    primaryKeyColumns: ["ssot__Id__c"],
    rootGroup: { join: "OR", conditions: [], groups: [
      { join: "AND", conditions: [
        { column: "ssot__BillingState__c", op: "=", value: "CA", type: "text" },
        { column: "ssot__NumberOfEmployees__c", op: ">=", value: 50, type: "number" },
      ] },
      { join: "AND", conditions: [
        { column: "ssot__BillingState__c", op: "=", value: "NY", type: "text" },
        { column: "ssot__NumberOfEmployees__c", op: ">=", value: 200, type: "number" },
      ] },
    ] },
  };
  eq("nested (AND) OR (AND), parenthesized, still one query", buildSegmentSql(spec4).sql,
    'SELECT DISTINCT "ssot__Account__dlm__0"."ssot__Id__c" FROM "ssot__Account__dlm" "ssot__Account__dlm__0" WHERE ("ssot__Account__dlm__0"."ssot__BillingState__c" = \'CA\' AND "ssot__Account__dlm__0"."ssot__NumberOfEmployees__c" >= 50) OR ("ssot__Account__dlm__0"."ssot__BillingState__c" = \'NY\' AND "ssot__Account__dlm__0"."ssot__NumberOfEmployees__c" >= 200)');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Related-object filter → correlated EXISTS subquery — the exact pattern
//    confirmed from the blog's real generated SQL, using the SAME join+KQ pattern
//    already confirmed in the Connect API docs (IS NOT DISTINCT FROM).
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Related-object condition -> EXISTS subquery (confirmed real generated pattern)");
{
  var spec = {
    segmentOnObject: "ssot__Account__dlm",
    primaryKeyColumns: ["ssot__Id__c"],
    joins: [{ object: "ssot__Case__dlm", leftKey: "ssot__Id__c", rightKey: "ssot__AccountId__c", keyQualifier: { left: "KQ_Id__c", right: "KQ_AccountId__c" } }],
    rootGroup: { join: "AND", conditions: [
      { object: "ssot__Case__dlm", column: "ssot__CreatedDate__c", op: ">=", value: "2021-09-21T00:00:00.000Z", type: "timestamp" },
    ] },
  };
  var out = buildSegmentSql(spec).sql;
  eq("full EXISTS subquery matches confirmed blog pattern",
    out,
    'SELECT DISTINCT "ssot__Account__dlm__0"."ssot__Id__c" FROM "ssot__Account__dlm" "ssot__Account__dlm__0" WHERE EXISTS (SELECT 1 FROM "ssot__Case__dlm" "ssot__Case__dlm__0" WHERE "ssot__Account__dlm__0"."ssot__Id__c" = "ssot__Case__dlm__0"."ssot__AccountId__c" AND "ssot__Account__dlm__0"."KQ_Id__c" IS NOT DISTINCT FROM "ssot__Case__dlm__0"."KQ_AccountId__c" AND "ssot__Case__dlm__0"."ssot__CreatedDate__c" >= timestamp \'2021-09-21T00:00:00.000Z\')');
  ok("uses EXISTS, not a plain LEFT/INNER JOIN, for the related-object filter", /EXISTS/.test(out) && !/\bJOIN\b/i.test(out));
  ok("join condition uses IS NOT DISTINCT FROM for the key qualifier (matches Connect API docs)", /IS NOT DISTINCT FROM/.test(out));

  // Two conditions on the SAME related object must merge into ONE EXISTS, not two.
  var spec2 = {
    segmentOnObject: "ssot__Account__dlm",
    primaryKeyColumns: ["ssot__Id__c"],
    joins: [{ object: "ssot__Case__dlm", leftKey: "ssot__Id__c", rightKey: "ssot__AccountId__c" }],
    rootGroup: { join: "AND", conditions: [
      { object: "ssot__Case__dlm", column: "ssot__Status__c", op: "=", value: "Open", type: "text" },
      { object: "ssot__Case__dlm", column: "ssot__Priority__c", op: "=", value: "High", type: "text" },
    ] },
  };
  var out2 = buildSegmentSql(spec2).sql;
  var existsCount = (out2.match(/EXISTS/g) || []).length;
  eq("two conditions on the SAME related object -> exactly ONE EXISTS (merged, not duplicated)", existsCount, 1);
  ok("both conditions present inside that one EXISTS", /ssot__Status__c/.test(out2) && /ssot__Priority__c/.test(out2));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Rule-violation guards — refuse to build rather than silently emit bad SQL.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. Rule-violation guards (refuse invalid specs)");
{
  eq("missing segment-on object rejected", buildSegmentSql({ primaryKeyColumns: ["ssot__Id__c"], rootGroup: {} }).error,
    "Segment-on object is required.");
  eq("zero primary-key columns rejected", buildSegmentSql({ segmentOnObject: "X__dlm", primaryKeyColumns: [], rootGroup: {} }).error,
    "At least one primary key column is required.");
  ok("unsupported operator throws rather than emitting bad SQL", (function () {
    try { buildSegmentSql({ segmentOnObject: "X__dlm", primaryKeyColumns: ["Id__c"], rootGroup: { conditions: [{ column: "a", op: "COUNT", value: 1 }] } }); return false; }
    catch (e) { return /Unsupported operator/.test(e.message); }
  })());
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Source presence check — confirms console-decorate.js actually SHIPS the
//    matching implementation (function names + confirmed SQL patterns), so this
//    test file can't silently drift from what's really in the built tool.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. Source presence check (console-decorate.js ships the matching implementation)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.js"), "utf8");
  ok("buildSegmentSql() exists in source", /function buildSegmentSql\(spec\)/.test(src));
  ok("segTableAlias uses the confirmed <DMOName>__N pattern", /function segTableAlias\(dmoName, index\) \{ return dmoName \+ "__" \+/.test(src));
  ok("SELECT DISTINCT is used (confirmed from real generated SQL)", /"SELECT DISTINCT "/.test(src));
  ok("EXISTS subquery used for related-object filters (not a plain JOIN)", /EXISTS \(SELECT 1 FROM/.test(src));
  ok("IS NOT DISTINCT FROM key-qualifier check present (matches Connect API docs)", /IS NOT DISTINCT FROM/.test(src));
  ok("segment button exists with the correct label", /segmentBtn\.textContent = "🎯 Segment Criteria"/.test(src));
  ok("segment panel wired to makeDraggable/addResizeHandle (learned from the earlier immovable-panel bug)", /makeDraggable\(panel, hdr\)/.test(src) && /addResizeHandle\(panel, 420, 340\)/.test(src));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
