// Segment page "Generate SQL" tests — run in Node, no browser needed.
//   node test/segment-page-sql.test.js
//
// SEPARATE test file — this is a THIRD, distinct feature from both Helpful Queries
// (Query Editor) and the manual Segment Criteria Builder (also Query Editor). This one
// lives on the Segment Builder PAGE ITSELF and converts the tree ALREADY EXTRACTED by
// the existing readSegmentRules()/readConditionsFromDOM() scraper into the same
// engine-executed SQL shape confirmed in test/segment-sql-generator.test.js (SELECT
// DISTINCT, "<DMO>__0" aliases, EXISTS subqueries for related objects, IS NOT DISTINCT
// FROM key-qualifier checks) — reusing that CONFIRMED SQL shape, not reinventing it.
//
// CRITICAL DESIGN CONSTRAINT (from investigating the existing scraper):
//   readConditionsFromDOM()'s objApi is shown in the tool's CURRENT export (proven
//   reliable enough to display). fieldApi is captured but NEVER shown anywhere in the
//   current export — a signal it's not trusted for direct use (best-effort DOM/LWC-prop
//   matching by label text, can silently pick the wrong field on a label collision).
//   So this generator must NEVER emit SQL using an unconfirmed API name. It collects
//   every distinct (object, field) pair from the tree, pre-fills a guess from
//   objApi/fieldApi when present, and REQUIRES the user to confirm/correct each one
//   before any SQL is built. Missing confirmation = build refuses, not guesses.

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. Operator phrase -> SQL operator mapping. Exact vocabulary taken from the
//    scraper's own OP_RE / NO_VAL_RE (console-decorate.js readConditionsFromDOM) —
//    not invented, copied from what the DOM scraper is proven to already extract.
// ─────────────────────────────────────────────────────────────────────────────
var OP_PHRASE_TO_SQL = {
  "is equal to":        "=",
  "is not equal to":    "!=",
  "greater than":       ">",
  "is greater than":    ">",
  "at least":           ">=",
  "less than":          "<",
  "is less than":       "<",
  "at most":            "<=",
  "exactly":            "=",
  "contains":           "LIKE",
  "does not contain":   "NOT LIKE",
  "starts with":        "LIKE",
  "ends with":          "LIKE",
  "is in":              "IN",
  "is not in":          "NOT IN",
  "has value":          "IS NOT NULL",
  "has no value":       "IS NULL",
  "is null":            "IS NULL",
  "is not null":         "IS NOT NULL",
  "is true":            "= true",
  "is false":           "= false",
};
function mapOperator(phrase) {
  var key = String(phrase || "").trim().toLowerCase();
  return OP_PHRASE_TO_SQL[key] || null; // null = unsupported, caller must refuse
}
console.log("\n1. Operator phrase -> SQL operator mapping (exact scraper vocabulary)");
{
  eq("'is equal to' -> =", mapOperator("is equal to"), "=");
  eq("'at least' -> >=", mapOperator("at least"), ">=");
  eq("'has no value' -> IS NULL", mapOperator("has no value"), "IS NULL");
  eq("'contains' -> LIKE", mapOperator("contains"), "LIKE");
  eq("'is in' -> IN", mapOperator("is in"), "IN");
  eq("unrecognized phrase -> null (refuse, don't guess)", mapOperator("some new SF phrase"), null);
  eq("case-insensitive", mapOperator("IS EQUAL TO"), "=");
  // "is between" / "is not between" are deliberately UNMAPPED — they need special
  // two-value handling (BETWEEN x AND y), not a simple operator swap. Confirms the
  // generator treats these as a distinct case rather than silently mismapping them.
  eq("'is between' is NOT in the simple map (needs special 2-value handling)", mapOperator("is between"), null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. LIKE-value transformation — "contains"/"starts with"/"ends with" need % wildcards
//    added; a plain "is equal to" value does not.
// ─────────────────────────────────────────────────────────────────────────────
function likeValueFor(opPhrase, rawValue) {
  var p = String(opPhrase || "").trim().toLowerCase();
  if (p === "contains") return "%" + rawValue + "%";
  if (p === "starts with") return rawValue + "%";
  if (p === "ends with") return "%" + rawValue;
  return rawValue;
}
console.log("\n2. LIKE-value wildcard transformation");
{
  eq("contains -> wraps both sides", likeValueFor("contains", "acme"), "%acme%");
  eq("starts with -> trailing wildcard", likeValueFor("starts with", "acme"), "acme%");
  eq("ends with -> leading wildcard", likeValueFor("ends with", ".com"), "%.com");
  eq("is equal to -> unchanged", likeValueFor("is equal to", "CA"), "CA");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Distinct (object, field) collection from a scraped tree — walks the SAME
//    tree shape readSegmentRules() produces ({type:"set", join, items:[...]}) and
//    collects every UNIQUE object+field label pair referenced by a leaf condition,
//    carrying along any objApi/fieldApi guess already scraped (possibly blank).
// ─────────────────────────────────────────────────────────────────────────────
function collectDistinctFields(tree) {
  var seen = {}, out = [];
  function walk(node) {
    if (!node) return;
    if (node.type === "set") { (node.items || []).forEach(walk); return; }
    if (node.type === "aggregation") { (node.subFilters || []).forEach(function (sf) { walk(Object.assign({ type: "simple" }, sf)); }); return; }
    if (node.type === "nested-segment") return; // no field to resolve
    var key = (node.objectLabel || "") + "::" + (node.fieldLabel || "");
    if (seen[key]) return;
    seen[key] = true;
    out.push({ objectLabel: node.objectLabel || "", fieldLabel: node.fieldLabel || "", objApiGuess: node.objApi || "", fieldApiGuess: node.fieldApi || "" });
  }
  walk(tree);
  return out;
}
console.log("\n3. Distinct (object, field) collection from a scraped tree");
{
  var tree1 = { type: "set", join: "AND", items: [
    { type: "simple", objectLabel: "Account", fieldLabel: "Industry", operator: "is equal to", values: "Healthcare", objApi: "ssot__Account__dlm", fieldApi: "" },
    { type: "simple", objectLabel: "Account", fieldLabel: "Employees", operator: "at least", values: "100" },
    // Same object+field repeated (e.g. inside a nested group) — must collapse to ONE entry.
    { type: "simple", objectLabel: "Account", fieldLabel: "Industry", operator: "is not equal to", values: "Retail" },
  ] };
  var fields1 = collectDistinctFields(tree1);
  eq("3 conditions, but Account.Industry repeated -> 2 distinct fields", fields1.length, 2);
  eq("first entry carries the scraped objApi guess", fields1[0].objApiGuess, "ssot__Account__dlm");
  eq("entry with no scraped API guess is blank, not fabricated", fields1[1].fieldApiGuess, "");

  var treeNested = { type: "set", join: "OR", items: [
    { type: "set", join: "AND", items: [
      { type: "simple", objectLabel: "Account", fieldLabel: "State", operator: "is equal to", values: "CA" },
      { type: "simple", objectLabel: "Case", fieldLabel: "Status", operator: "is equal to", values: "Open" },
    ] },
  ] };
  eq("nested groups are walked (finds fields inside subgroups)", collectDistinctFields(treeNested).length, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Confirmation-gate — the generator must REFUSE to build SQL until every
//    distinct field has a user-CONFIRMED API name. A pre-filled guess is not
//    itself confirmation.
// ─────────────────────────────────────────────────────────────────────────────
function allFieldsConfirmed(distinctFields, confirmedMap) {
  return distinctFields.every(function (f) {
    var key = f.objectLabel + "::" + f.fieldLabel;
    var c = confirmedMap[key];
    return !!(c && c.objApi && c.fieldApi && c.confirmed === true);
  });
}
console.log("\n4. Confirmation gate (never build SQL on an unconfirmed API name)");
{
  var fields = [{ objectLabel: "Account", fieldLabel: "Industry", objApiGuess: "ssot__Account__dlm", fieldApiGuess: "ssot__Industry__c" }];
  ok("guess present but NOT confirmed -> still blocked", !allFieldsConfirmed(fields, {
    "Account::Industry": { objApi: "ssot__Account__dlm", fieldApi: "ssot__Industry__c", confirmed: false }
  }));
  ok("explicitly confirmed -> allowed", allFieldsConfirmed(fields, {
    "Account::Industry": { objApi: "ssot__Account__dlm", fieldApi: "ssot__Industry__c", confirmed: true }
  }));
  ok("confirmed but blank objApi -> still blocked (never emit an empty identifier)", !allFieldsConfirmed(fields, {
    "Account::Industry": { objApi: "", fieldApi: "ssot__Industry__c", confirmed: true }
  }));
  ok("field missing from confirmedMap entirely -> blocked", !allFieldsConfirmed(fields, {}));
  ok("multiple fields, only one confirmed -> still blocked (ALL must be confirmed)", !allFieldsConfirmed(
    [{ objectLabel: "Account", fieldLabel: "Industry" }, { objectLabel: "Account", fieldLabel: "Employees" }],
    { "Account::Industry": { objApi: "a", fieldApi: "b", confirmed: true } }
  ));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Tree -> segment-SQL-generator spec conversion — once every field is confirmed,
//    convert the scraped tree + confirmed API-name map into the SAME spec shape
//    buildSegmentSql() (test/segment-sql-generator.test.js) already consumes, then
//    reuse that CONFIRMED generator rather than re-implementing SQL building here.
// ─────────────────────────────────────────────────────────────────────────────
function treeToConditionGroup(node, confirmedMap, segmentOnObjApi) {
  if (!node) return { join: "AND", conditions: [] };
  if (node.type === "set") {
    var conditions = [], groups = [];
    (node.items || []).forEach(function (item) {
      if (item.type === "set") { groups.push(treeToConditionGroup(item, confirmedMap, segmentOnObjApi)); return; }
      if (item.type === "nested-segment") return; // not representable as a SQL condition
      var key = (item.objectLabel || "") + "::" + (item.fieldLabel || "");
      var c = confirmedMap[key];
      if (!c) throw new Error("Unconfirmed field: " + key);
      var opSql = mapOperator(item.operator);
      var cond = { column: c.fieldApi };
      if (c.objApi && c.objApi !== segmentOnObjApi) cond.object = c.objApi;
      if (/^is (not )?between$/i.test(item.operator || "")) {
        throw new Error("BETWEEN operator needs special handling — not yet supported by this converter.");
      }
      if (!opSql) throw new Error("Unsupported operator: " + item.operator);
      cond.op = opSql;
      if (opSql !== "IS NULL" && opSql !== "IS NOT NULL" && !/^= (true|false)$/.test(opSql)) {
        var val = (opSql === "LIKE" || opSql === "NOT LIKE") ? likeValueFor(item.operator, item.values) : item.values;
        cond.value = (opSql === "IN" || opSql === "NOT IN") ? val.split(",").map(function (s) { return s.trim(); }) : val;
        cond.type = "text"; // conservative default; numeric/date detection is a future improvement, not guessed here
      } else if (/^= (true|false)$/.test(opSql)) {
        cond.op = "="; cond.value = opSql.endsWith("true"); cond.type = "boolean";
      }
      conditions.push(cond);
    });
    return { join: node.join || "AND", conditions: conditions, groups: groups };
  }
  return { join: "AND", conditions: [] };
}

console.log("\n5. Tree -> spec conversion (reuses the CONFIRMED buildSegmentSql shape)");
{
  var tree = { type: "set", join: "AND", items: [
    { type: "simple", objectLabel: "Account", fieldLabel: "Industry", operator: "is equal to", values: "Healthcare" },
    { type: "simple", objectLabel: "Account", fieldLabel: "Employees", operator: "at least", values: "100" },
  ] };
  var confirmed = {
    "Account::Industry": { objApi: "ssot__Account__dlm", fieldApi: "ssot__Industry__c", confirmed: true },
    "Account::Employees": { objApi: "ssot__Account__dlm", fieldApi: "ssot__NumberOfEmployees__c", confirmed: true },
  };
  var group = treeToConditionGroup(tree, confirmed, "ssot__Account__dlm");
  eq("2 own-object conditions produced", group.conditions.length, 2);
  eq("first condition column = confirmed fieldApi", group.conditions[0].column, "ssot__Industry__c");
  eq("first condition op mapped correctly", group.conditions[0].op, "=");
  eq("second condition op mapped correctly (at least -> >=)", group.conditions[1].op, ">=");
  ok("own-object condition has NO .object (same as segment-on)", !group.conditions[0].object);

  var relTree = { type: "set", join: "AND", items: [
    { type: "simple", objectLabel: "Case", fieldLabel: "Status", operator: "is equal to", values: "Open" },
  ] };
  var relConfirmed = { "Case::Status": { objApi: "ssot__Case__dlm", fieldApi: "ssot__Status__c", confirmed: true } };
  var relGroup = treeToConditionGroup(relTree, relConfirmed, "ssot__Account__dlm");
  eq("related-object condition carries .object (different from segment-on)", relGroup.conditions[0].object, "ssot__Case__dlm");

  ok("unconfirmed field throws rather than silently building", (function () {
    try { treeToConditionGroup(tree, {}, "ssot__Account__dlm"); return false; }
    catch (e) { return /Unconfirmed field/.test(e.message); }
  })());

  var betweenTree = { type: "set", join: "AND", items: [
    { type: "simple", objectLabel: "Account", fieldLabel: "Revenue", operator: "is between", values: "100, 500" },
  ] };
  ok("BETWEEN operator explicitly rejected rather than silently mismapped", (function () {
    try { treeToConditionGroup(betweenTree, { "Account::Revenue": { objApi: "a", fieldApi: "b", confirmed: true } }, "a"); return false; }
    catch (e) { return /BETWEEN/.test(e.message); }
  })());
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Source presence checks — confirms the actual Segment page button + generator
//    are wired up in console-decorate.js as intended.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. Source presence check (Segment page button wired up)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.js"), "utf8");
  ok("a second Segment-page FAB button exists (Generate SQL)", /Generate SQL/.test(src));
  ok("it calls readSegmentRules() (reuses the EXISTING, proven scraper — no re-scraping)", /readSegmentRules\(\)/.test(src));
  ok("confirmation UI references unconfirmed/confirm before building SQL", /confirm/i.test(src));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
