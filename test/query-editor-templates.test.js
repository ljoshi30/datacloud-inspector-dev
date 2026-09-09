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
// Accepts EITHER a plain date (YYYY-MM-DD) or a full timestamp (YYYY-MM-DD HH:MM:SS,
// optionally with fractional seconds; "T" separator from a datetime-local picker is
// normalized to a space). Returns the correctly-typed SQL literal (DATE '...' vs
// TIMESTAMP '...' — both confirmed in the Data 360 SQL reference), or null if the
// input matches neither shape (caller must reject, never guess).
function dateOrTimestampLiteral(raw) {
  const v = String(raw).trim().replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "DATE '" + v + "'";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) return "TIMESTAMP '" + v + "'";
  return null;
}

const T = {
  existsProbe: (obj) => `SELECT COUNT(*) AS row_count FROM ${qId(obj)}`,
  fieldsProbe: (obj) => `SELECT * FROM ${qId(obj)} LIMIT 1`,

  exactDuplicates: (obj, col) =>
    `SELECT ${qId(col)}, COUNT(*) AS dup_count FROM ${qId(obj)} GROUP BY ${qId(col)} HAVING COUNT(*) > 1`,

  nullsOrBlanks: (obj, col) =>
    `SELECT * FROM ${qId(obj)} WHERE ${qId(col)} IS NULL OR TRIM(${qId(col)}) = ''`,

  valueDistribution: (obj, col) =>
    `SELECT ${qId(col)}, COUNT(*) AS value_count FROM ${qId(obj)} GROUP BY ${qId(col)} ORDER BY COUNT(*) DESC`,

  normalizedDuplicates: (obj, col) =>
    `SELECT UPPER(TRIM(${qId(col)})) AS normalized_value, COUNT(*) AS dup_count FROM ${qId(obj)} GROUP BY UPPER(TRIM(${qId(col)})) HAVING COUNT(*) > 1`,

  betweenDates: (obj, dateCol, from, to) =>
    `SELECT * FROM ${qId(obj)} WHERE ${qId(dateCol)} BETWEEN ${dateOrTimestampLiteral(from)} AND ${dateOrTimestampLiteral(to)}`,

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

  eq("betweenDates with plain dates", T.betweenDates("Order__dlm", "order_date__c", "2026-01-01", "2026-03-31"),
    `SELECT * FROM "Order__dlm" WHERE "order_date__c" BETWEEN DATE '2026-01-01' AND DATE '2026-03-31'`);
  eq("betweenDates with full timestamps", T.betweenDates("Order__dlm", "order_date__c", "2026-01-01 09:00:00", "2026-01-01 17:30:00"),
    `SELECT * FROM "Order__dlm" WHERE "order_date__c" BETWEEN TIMESTAMP '2026-01-01 09:00:00' AND TIMESTAMP '2026-01-01 17:30:00'`);
  eq("betweenDates mixing date + timestamp (both forms independently valid)", T.betweenDates("Order__dlm", "order_date__c", "2026-01-01", "2026-01-01 17:30:00"),
    `SELECT * FROM "Order__dlm" WHERE "order_date__c" BETWEEN DATE '2026-01-01' AND TIMESTAMP '2026-01-01 17:30:00'`);

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
// 2b. dateOrTimestampLiteral — accepts a plain date OR a full timestamp so users
//    can filter down to the hour/minute/second, not just whole days. Both forms
//    are documented (DATE '...' and TIMESTAMP '...' literals). Rejects anything
//    that matches neither shape rather than guessing.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2b. dateOrTimestampLiteral (date-only OR full timestamp)");
{
  eq("plain date", dateOrTimestampLiteral("2026-01-01"), "DATE '2026-01-01'");
  eq("timestamp with seconds", dateOrTimestampLiteral("2026-01-01 09:30:00"), "TIMESTAMP '2026-01-01 09:30:00'");
  eq("timestamp without seconds (HH:MM only)", dateOrTimestampLiteral("2026-01-01 09:30"), "TIMESTAMP '2026-01-01 09:30'");
  eq("timestamp with fractional seconds", dateOrTimestampLiteral("2026-01-01 09:30:00.123"), "TIMESTAMP '2026-01-01 09:30:00.123'");
  eq("datetime-local picker's 'T' separator is normalized to a space", dateOrTimestampLiteral("2026-01-01T09:30:00"), "TIMESTAMP '2026-01-01 09:30:00'");
  eq("surrounding whitespace trimmed", dateOrTimestampLiteral("  2026-01-01  "), "DATE '2026-01-01'");
  eq("garbage input rejected (null, not a guess)", dateOrTimestampLiteral("01/01/2026"), null);
  eq("empty string rejected", dateOrTimestampLiteral(""), null);
  eq("SQL-injection-shaped input rejected, not passed through", dateOrTimestampLiteral("2026-01-01' OR '1'='1"), null);
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

  eq("fields probe: SELECT * LIMIT 1 (works even on an empty table)", T.fieldsProbe("TDI_Individual__dlm"),
    'SELECT * FROM "TDI_Individual__dlm" LIMIT 1');
  ok("fields probe has LIMIT so it can never fetch a real row's worth of data", /LIMIT 1$/.test(T.fieldsProbe("X__dlm")));
}

// ─────────────────────────────────────────────────────────────────────────────
// Field auto-fetch → dropdown, with a free-text fallback if the fetch fails.
// The user chose "auto-fetch + dropdown with manual fallback": success shows a
// dropdown of real column names; ANY failure (network, permissions, timeout)
// must fall back to a free-text input, NEVER block the user from proceeding.
// ─────────────────────────────────────────────────────────────────────────────
function decideColumnInputMode(fetchResult) {
  if (!fetchResult) return "text"; // never fetched (e.g. fetch not yet attempted)
  if (fetchResult.error) return "text"; // any failure → fallback, never block
  if (!Array.isArray(fetchResult.columns) || fetchResult.columns.length === 0) return "text"; // empty/malformed → fallback
  return "dropdown";
}
console.log("\n3b. Field auto-fetch → dropdown-or-fallback decision");
{
  eq("no fetch attempted yet → text fallback", decideColumnInputMode(null), "text");
  eq("fetch succeeded with columns → dropdown", decideColumnInputMode({ columns: ["email__c", "phone__c"] }), "dropdown");
  eq("fetch errored → text fallback (never blocks the user)", decideColumnInputMode({ error: "timeout" }), "text");
  eq("fetch succeeded but empty columns array → text fallback", decideColumnInputMode({ columns: [] }), "text");
  eq("fetch returned malformed (non-array) columns → text fallback", decideColumnInputMode({ columns: "not-an-array" }), "text");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Input validation — reject/normalize dangerous or empty inputs BEFORE they
//    reach the SQL builder. A blank object/column name must never silently
//    produce a query that "looks" runnable (e.g. SELECT * FROM "" ...).
// ─────────────────────────────────────────────────────────────────────────────
function validateTemplateInputs({ objectName, columnName, days, expected, fromDate, toDate }) {
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
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (fromDate !== undefined && !dateRe.test(fromDate)) errs.push("From date must be YYYY-MM-DD.");
  if (toDate !== undefined && !dateRe.test(toDate)) errs.push("To date must be YYYY-MM-DD.");
  if (fromDate !== undefined && toDate !== undefined && dateRe.test(fromDate) && dateRe.test(toDate) && fromDate > toDate) {
    errs.push("From date must be on or before To date.");
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
  ok("valid date range passes", validateTemplateInputs({ objectName: "X__dlm", fromDate: "2026-01-01", toDate: "2026-03-31" }).ok);
  ok("malformed fromDate rejected", !validateTemplateInputs({ objectName: "X__dlm", fromDate: "01/01/2026", toDate: "2026-03-31" }).ok);
  ok("fromDate after toDate rejected", !validateTemplateInputs({ objectName: "X__dlm", fromDate: "2026-06-01", toDate: "2026-01-01" }).ok);
  ok("fromDate equal to toDate is valid (single day)", validateTemplateInputs({ objectName: "X__dlm", fromDate: "2026-01-01", toDate: "2026-01-01" }).ok);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Field-label collision guard — extracts the REAL TEMPLATE_DEFS + FIELD_LABELS
//    from console-decorate.js (not a re-typed copy, so source and test can't drift)
//    and asserts the exact bug a user hit in production: the "object" field and a
//    "column"-family field in the SAME template must NEVER render the same label,
//    or the user can't tell which box the object name goes in (they end up typing
//    a column name into the object box and vice versa → "table X does not exist").
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Field-label collision guard (real source, not a copy)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.js"), "utf8");

  function extractBlock(startMarker) {
    const startIdx = src.indexOf(startMarker);
    if (startIdx < 0) return null;
    // find the matching closing bracket by bracket-depth counting from the opening one
    const openIdx = src.indexOf(startMarker.trim().endsWith("[") ? "[" : "{", startIdx);
    const openCh = src[openIdx], closeCh = openCh === "[" ? "]" : "}";
    let depth = 0, i = openIdx;
    for (; i < src.length; i++) {
      if (src[i] === openCh) depth++;
      else if (src[i] === closeCh) { depth--; if (depth === 0) break; }
    }
    return src.slice(openIdx, i + 1);
  }

  const templateDefsSrc = extractBlock("var TEMPLATE_DEFS = [");
  const fieldLabelsSrc = extractBlock("var FIELD_LABELS = {");
  ok("TEMPLATE_DEFS found in source", !!templateDefsSrc);
  ok("FIELD_LABELS found in source", !!fieldLabelsSrc);

  if (templateDefsSrc && fieldLabelsSrc) {
    // Evaluate as plain JS object/array literals (safe — this is our own source, no I/O).
    // Wrapped in parens: a bare leading "{" is parsed as a block statement, not an
    // object literal, which would throw on the object's first "key:" token.
    const TEMPLATE_DEFS = eval("(" + templateDefsSrc + ")");
    const FIELD_LABELS = eval("(" + fieldLabelsSrc + ")");

    ok("extracted at least 10 templates", TEMPLATE_DEFS.length >= 10, "got " + TEMPLATE_DEFS.length);

    let collisionFound = false;
    TEMPLATE_DEFS.forEach(function (def) {
      const labels = def.fields.map(function (f) { return FIELD_LABELS[f] || f; });
      const uniqueLabels = new Set(labels);
      if (uniqueLabels.size !== labels.length) {
        collisionFound = true;
        ok("template '" + def.key + "' has NO duplicate field labels", false,
          "fields=" + JSON.stringify(def.fields) + " labels=" + JSON.stringify(labels));
      }
    });
    if (!collisionFound) ok("no template has two fields sharing the same label", true);

    // The specific regression: object vs column must always differ.
    ok("'object' and 'column' labels are distinct", FIELD_LABELS.object !== FIELD_LABELS.column,
      "object=" + JSON.stringify(FIELD_LABELS.object) + " column=" + JSON.stringify(FIELD_LABELS.column));
    ok("'childObject' and 'childFk' labels are distinct", FIELD_LABELS.childObject !== FIELD_LABELS.childFk);
    ok("'parentObject' and 'parentKey' labels are distinct", FIELD_LABELS.parentObject !== FIELD_LABELS.parentKey);
    ok("'childObject' and 'parentObject' labels are distinct (two different objects)", FIELD_LABELS.childObject !== FIELD_LABELS.parentObject);

    // Every field referenced by any template must have a label (no silent "f" fallback).
    var allFields = new Set();
    TEMPLATE_DEFS.forEach(function (def) { def.fields.forEach(function (f) { allFields.add(f); }); });
    var missingLabel = [...allFields].filter(function (f) { return !FIELD_LABELS[f]; });
    eq("every field used by a template has an explicit label", missingLabel.length, 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. fieldVal() selector guard — regression test for a REAL bug: a column dropdown
//    renders as <select>, but fieldVal() originally used the selector
//    "input[data-field='x']" which only matches <input> — so a chosen dropdown value
//    was silently ignored (fieldVal always returned "" for a <select>). Extracts the
//    REAL function source from console-decorate.js and asserts the selector can match
//    ANY tag with that data-field attribute, not just <input>.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. fieldVal() selector guard (must match <select>, not just <input>)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.js"), "utf8");
  const m = src.match(/function fieldVal\([^)]*\)\s*\{[^}]*\}/);
  ok("fieldVal() found in source", !!m);
  if (m) {
    const fnSrc = m[0];
    // The exact regression: a selector hard-coded to the "input" tag can never match a
    // <select data-field="..."> dropdown.
    ok("selector is NOT restricted to input[data-field=...] (the exact bug)", !/input\[data-field/.test(fnSrc), fnSrc);
    // A bare attribute selector — [data-field='x'] — matches any element regardless of
    // tag name, which is what's needed since fields render as either <input> or <select>.
    ok("selector uses a bare [data-field=...] attribute match (works for input AND select)", /(?<!input|select)\[data-field/.test(fnSrc), fnSrc);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. isDateType — the dateColumn dropdown must only offer columns whose reported SQL
//    type is actually date/timestamp; picking a text column produced a real error from
//    the engine ("cannot compare 'text' and 'timestamp'"). Mirrors console-decorate.js.
// ─────────────────────────────────────────────────────────────────────────────
function isDateType(t) { return /date|timestamp/i.test(String(t || "")); }
console.log("\n7. isDateType (dateColumn dropdown filter)");
{
  ok("'date' is a date type", isDateType("date"));
  ok("'timestamp' is a date type", isDateType("timestamp"));
  ok("'timestamp with time zone' is a date type", isDateType("timestamp with time zone"));
  ok("'DATE' (uppercase, as engines often report) is a date type", isDateType("DATE"));
  ok("'text' is NOT a date type", !isDateType("text"));
  ok("'varchar' is NOT a date type", !isDateType("varchar"));
  ok("'integer' is NOT a date type", !isDateType("integer"));
  ok("undefined/missing type is NOT a date type (fails closed, not open)", !isDateType(undefined));
  ok("empty string is NOT a date type", !isDateType(""));
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. dateColumn dropdown-population decision — given fetched columns + their types,
//    only date/timestamp columns should appear as options. If NONE qualify, the UI
//    must fall back to free text (never render an empty, unusable dropdown).
// ─────────────────────────────────────────────────────────────────────────────
function dateColumnOptions(columns, types) {
  return columns.filter(function (c) { return isDateType(types[c]); });
}
console.log("\n8. dateColumn dropdown-population decision");
{
  const cols = ["created_date__c", "email__c", "DataSourceObjectId__c", "amount__c"];
  const types = { created_date__c: "timestamp", email__c: "text", DataSourceObjectId__c: "text", amount__c: "numeric" };
  const opts = dateColumnOptions(cols, types);
  eq("only the timestamp column is offered", opts.length, 1);
  eq("the offered column is the right one", opts[0], "created_date__c");

  const noDatesCols = ["email__c", "amount__c"];
  const noDatesTypes = { email__c: "text", amount__c: "numeric" };
  eq("zero date columns → empty options (caller falls back to free text)", dateColumnOptions(noDatesCols, noDatesTypes).length, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Sample-fetch row cap — raised from the original 100 to 2,000 (matches the View
//    Results table's own 2,000-row display cap in qeFetchExport, so nothing fetched
//    is ever un-viewable). Verifies the LIMIT actually appended to the SQL and that
//    the button label reflects the real cap (not a stale "100" that lies to the user).
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n9. Sample-fetch row cap (100 -> 2,000)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.js"), "utf8");
  ok("SAMPLE_ROWS is 2000, not the old 100", /SAMPLE_ROWS\s*=\s*2000/.test(src));
  ok("sample fetch appends LIMIT + SAMPLE_ROWS to the query", /sampleSql\s*=\s*res\.sql\s*\+\s*"\s*LIMIT\s*"\s*\+\s*SAMPLE_ROWS/.test(src));
  ok("button label says up to 2,000, not the stale 100", /Fetch rows \(up to 2,000\)/.test(src));
  ok("old hard-coded 'LIMIT 100' sample query is gone", !/res\.sql\s*\+\s*"\s*LIMIT 100"/.test(src));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
