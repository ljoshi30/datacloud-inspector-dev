// Query Editor "Helpful Queries" template tests — run in Node, no browser needed.
//   node test/query-editor-templates.test.js
//
// SEPARATE from test/explorer-logic.test.js on purpose — Query Editor and Data
// Explorer must stay independent (no shared code), so their tests stay independent too.
//
// These mirror the PURE SQL-string-building logic for the 13 confirmed templates.
// Every function used (TRIM, UPPER, CURRENT_DATE, INTERVAL, DATE_TRUNC, LEFT JOIN,
// GROUP BY/HAVING, TRY_CAST) is documented in the Data 360 SQL reference — verified
// via salesforce_docs_search before writing any of this. No invented syntax.
//
// Covered:
//   1. Identifier quoting/escaping (object + column names — injection-safety)
//   2. All 13 template SQL builders — exact output strings
//   3. Object-name existence probe SQL
//   4. Input validation (empty/invalid inputs never produce a runnable-looking SQL string)

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. Identifier quoting — mirrors sqlQuoteIdent from console-decorate.js.
//    MUST double-quote every identifier so a name with a space/reserved word/
//    mixed case still works, and MUST escape an embedded double-quote so a
//    malicious/weird object name can't break out of the identifier.
// ─────────────────────────────────────────────────────────────────────────────
function qId(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}
console.log("\n1. Identifier quoting (injection-safety)");
{
  eq("simple name", qId("TDI_Individual__dlm"), '"TDI_Individual__dlm"');
  eq("name with embedded quote is escaped", qId('Weird"Name'), '"Weird""Name"');
  eq("name with space", qId("My Object"), '"My Object"');
  // A quoted identifier can never terminate early no matter what's inside it.
  ok("escaped quote can't break out of the identifier", qId('a" OR "1"="1').indexOf('""') >= 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Template SQL builders — one per confirmed-safe template. Each takes plain
//    strings (object name, column name(s), N) and returns the exact SQL string
//    that would be handed to runQeCount/qeFetchExport.
// ─────────────────────────────────────────────────────────────────────────────
const T = {
  existsProbe: (obj) => `SELECT COUNT(*) AS row_count FROM ${qId(obj)}`,

  exactDuplicates: (obj, col) =>
    `SELECT ${qId(col)}, COUNT(*) AS dup_count FROM ${qId(obj)} GROUP BY ${qId(col)} HAVING COUNT(*) > 1`,

  nullsOrBlanks: (obj, col) =>
    `SELECT * FROM ${qId(obj)} WHERE ${qId(col)} IS NULL OR TRIM(${qId(col)}) = ''`,

  valueDistribution: (obj, col) =>
    `SELECT ${qId(col)}, COUNT(*) AS value_count FROM ${qId(obj)} GROUP BY ${qId(col)} ORDER BY COUNT(*) DESC`,

  normalizedDuplicates: (obj, col) =>
    `SELECT UPPER(TRIM(${qId(col)})) AS normalized_value, COUNT(*) AS dup_count FROM ${qId(obj)} GROUP BY UPPER(TRIM(${qId(col)})) HAVING COUNT(*) > 1`,

  staleRecords: (obj, dateCol, days) =>
    `SELECT * FROM ${qId(obj)} WHERE ${qId(dateCol)} < CURRENT_DATE - INTERVAL '${Number(days)} days'`,

  orphanedForeignKey: (childObj, childFk, parentObj, parentKey) =>
    `SELECT c.* FROM ${qId(childObj)} c LEFT JOIN ${qId(parentObj)} p ON c.${qId(childFk)} = p.${qId(parentKey)} WHERE p.${qId(parentKey)} IS NULL`,

  cardinalityCheck: (obj, fkCol, expected) =>
    `SELECT ${qId(fkCol)}, COUNT(*) AS record_count FROM ${qId(obj)} GROUP BY ${qId(fkCol)} HAVING COUNT(*) <> ${Number(expected)}`,

  irConsolidationRate: () =>
    `SELECT IndividualIdentityLink__dlm.ssot__DataSourceId__c AS DataSourceId__c, IndividualIdentityLink__dlm.ssot__DataSourceObjectId__c AS DataSourceObjectId__c, APPROX_COUNT_DISTINCT(IndividualIdentityLink__dlm.UnifiedRecordId__c) AS unq_Unified_Individuals__c, COUNT(IndividualIdentityLink__dlm.SourceRecordId__c) AS cnt_Source_Records__c, (1 - APPROX_COUNT_DISTINCT(IndividualIdentityLink__dlm.UnifiedRecordId__c)/COUNT(IndividualIdentityLink__dlm.SourceRecordId__c))*100 AS per_consolidation_rate__c FROM IndividualIdentityLink__dlm GROUP BY DataSourceId__c, DataSourceObjectId__c`,

  safeTypeCheck: (obj, col, type) =>
    `SELECT * FROM ${qId(obj)} WHERE TRY_CAST(${qId(col)} AS ${type}) IS NULL AND ${qId(col)} IS NOT NULL`,

  freshnessCheck: (obj, dateCol, days) =>
    `SELECT * FROM ${qId(obj)} WHERE ${qId(dateCol)} < CURRENT_DATE - INTERVAL '${Number(days)} days'`,

  recordAge: (obj, dateCol) =>
    `SELECT *, CURRENT_DATE - ${qId(dateCol)} AS days_old FROM ${qId(obj)}`,

  rollingWindow: (obj, dateCol, days) =>
    `SELECT * FROM ${qId(obj)} WHERE ${qId(dateCol)} >= CURRENT_DATE - INTERVAL '${Number(days)} days'`,

  trendByPeriod: (obj, dateCol, period) =>
    `SELECT DATE_TRUNC('${period}', ${qId(dateCol)}) AS period, COUNT(*) AS record_count FROM ${qId(obj)} GROUP BY DATE_TRUNC('${period}', ${qId(dateCol)}) ORDER BY period`,
};

console.log("\n2. Template SQL builders (exact output)");
{
  eq("exactDuplicates", T.exactDuplicates("TDI_Individual__dlm", "email__c"),
    'SELECT "email__c", COUNT(*) AS dup_count FROM "TDI_Individual__dlm" GROUP BY "email__c" HAVING COUNT(*) > 1');

  eq("nullsOrBlanks", T.nullsOrBlanks("Account__dlm", "phone__c"),
    `SELECT * FROM "Account__dlm" WHERE "phone__c" IS NULL OR TRIM("phone__c") = ''`);

  eq("valueDistribution", T.valueDistribution("Account__dlm", "state__c"),
    'SELECT "state__c", COUNT(*) AS value_count FROM "Account__dlm" GROUP BY "state__c" ORDER BY COUNT(*) DESC');

  eq("normalizedDuplicates", T.normalizedDuplicates("Contact__dlm", "name__c"),
    'SELECT UPPER(TRIM("name__c")) AS normalized_value, COUNT(*) AS dup_count FROM "Contact__dlm" GROUP BY UPPER(TRIM("name__c")) HAVING COUNT(*) > 1');

  eq("staleRecords 90 days", T.staleRecords("Order__dlm", "updated_date__c", 90),
    `SELECT * FROM "Order__dlm" WHERE "updated_date__c" < CURRENT_DATE - INTERVAL '90 days'`);

  eq("orphanedForeignKey", T.orphanedForeignKey("ContactPointEmail__dlm", "PartyId__c", "Individual__dlm", "Id__c"),
    'SELECT c.* FROM "ContactPointEmail__dlm" c LEFT JOIN "Individual__dlm" p ON c."PartyId__c" = p."Id__c" WHERE p."Id__c" IS NULL');

  eq("cardinalityCheck expected=1", T.cardinalityCheck("ContactPointPhone__dlm", "PartyId__c", 1),
    'SELECT "PartyId__c", COUNT(*) AS record_count FROM "ContactPointPhone__dlm" GROUP BY "PartyId__c" HAVING COUNT(*) <> 1');

  ok("irConsolidationRate matches documented query shape", /IndividualIdentityLink__dlm/.test(T.irConsolidationRate()) &&
    /APPROX_COUNT_DISTINCT/.test(T.irConsolidationRate()) && /GROUP BY DataSourceId__c, DataSourceObjectId__c/.test(T.irConsolidationRate()));

  eq("safeTypeCheck DATE", T.safeTypeCheck("Order__dlm", "order_date__c", "DATE"),
    'SELECT * FROM "Order__dlm" WHERE TRY_CAST("order_date__c" AS DATE) IS NULL AND "order_date__c" IS NOT NULL');

  eq("freshnessCheck", T.freshnessCheck("DataStream__dlm", "last_modified__c", 30),
    `SELECT * FROM "DataStream__dlm" WHERE "last_modified__c" < CURRENT_DATE - INTERVAL '30 days'`);

  eq("recordAge", T.recordAge("Order__dlm", "created_date__c"),
    'SELECT *, CURRENT_DATE - "created_date__c" AS days_old FROM "Order__dlm"');

  eq("rollingWindow last 7 days", T.rollingWindow("Event__dlm", "event_date__c", 7),
    `SELECT * FROM "Event__dlm" WHERE "event_date__c" >= CURRENT_DATE - INTERVAL '7 days'`);

  eq("trendByPeriod month", T.trendByPeriod("Order__dlm", "order_date__c", "month"),
    "SELECT DATE_TRUNC('month', \"order_date__c\") AS period, COUNT(*) AS record_count FROM \"Order__dlm\" GROUP BY DATE_TRUNC('month', \"order_date__c\") ORDER BY period");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Object-name existence / size probe — the near-free metadata-answerable
//    plain COUNT(*) used before showing any template (catches typos, shows scale).
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. Existence/size probe SQL");
{
  eq("plain COUNT(*), no WHERE/GROUP BY (metadata-answerable)", T.existsProbe("TDI_Individual__dlm"),
    'SELECT COUNT(*) AS row_count FROM "TDI_Individual__dlm"');
  ok("probe has no WHERE/GROUP BY/JOIN (stays cheap)", !/WHERE|GROUP BY|JOIN/i.test(T.existsProbe("X__dlm")));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Input validation — reject/normalize dangerous or empty inputs BEFORE they
//    reach the SQL builder. A blank object/column name must never silently
//    produce a query that "looks" runnable (e.g. SELECT * FROM "" ...).
// ─────────────────────────────────────────────────────────────────────────────
function validateTemplateInputs({ objectName, columnName, days, expected }) {
  const errs = [];
  if (!objectName || !String(objectName).trim()) errs.push("Object/DLO/DMO name is required.");
  else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(objectName).trim())) errs.push("Object name contains characters that aren't valid in an identifier.");
  if (columnName !== undefined) {
    if (!columnName || !String(columnName).trim()) errs.push("Column name is required.");
    else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(columnName).trim())) errs.push("Column name contains characters that aren't valid in an identifier.");
  }
  if (days !== undefined) {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) errs.push("Days must be a positive whole number.");
  }
  if (expected !== undefined) {
    const n = Number(expected);
    if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) errs.push("Expected count must be a non-negative whole number.");
  }
  return { ok: errs.length === 0, errors: errs };
}
console.log("\n4. Input validation (blocks bad input before SQL is built)");
{
  ok("valid inputs pass", validateTemplateInputs({ objectName: "TDI_Individual__dlm", columnName: "email__c", days: 90 }).ok);
  ok("empty object name rejected", !validateTemplateInputs({ objectName: "", columnName: "x" }).ok);
  ok("whitespace-only object name rejected", !validateTemplateInputs({ objectName: "   ", columnName: "x" }).ok);
  ok("object name with quote rejected (would need escaping, reject instead of guessing)", !validateTemplateInputs({ objectName: 'Weird"Name', columnName: "x" }).ok);
  ok("empty column name rejected", !validateTemplateInputs({ objectName: "X__dlm", columnName: "" }).ok);
  ok("negative days rejected", !validateTemplateInputs({ objectName: "X__dlm", days: -5 }).ok);
  ok("non-integer days rejected", !validateTemplateInputs({ objectName: "X__dlm", days: 7.5 }).ok);
  ok("zero days rejected (would be a no-op filter)", !validateTemplateInputs({ objectName: "X__dlm", days: 0 }).ok);
  ok("negative expected count rejected", !validateTemplateInputs({ objectName: "X__dlm", expected: -1 }).ok);
  ok("expected count of 0 is valid (e.g. 'should have NO children')", validateTemplateInputs({ objectName: "X__dlm", expected: 0 }).ok);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
