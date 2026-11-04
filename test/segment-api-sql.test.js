// BEHAVIOR test for segmentApiCriteriaToSql (console-decorate.extension.js) — the API-JSON → clean SQL
// renderer. We EXTRACT the real function from source and RUN it against the EXACT includeCriteria JSON
// captured live from /ssot/segments (not a mirror, not hand-stubs). Every node type below is a real
// shape pulled from a live Data Cloud org:
//   • LogicalComparison (and)            — SF_PM_GI_TRGT__Multiline
//   • TextComparison values:["M"]        — Multiline leaf 1
//   • BooleanComparison value:true       — Multiline leaf 2 (SCALAR value, not values[])
//   • NestedSegment membership           — Multiline leaf 3 (member of another segment)
//   • NumberAggregation count ≥ 1        — SP_Test / Test_Segment_in_SP
//   • NumberComparison "greater than or equal" value:1  — the aggregation threshold
//   • "has value" operator               — Test_Segment_in_SP inner subject
//   • CalculatedInsight                  — TDI_5_random_control

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }

const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");

// Extract the real function body and make it callable.
const start = src.indexOf("function segmentApiCriteriaToSql(criteria, segName, tabLabel, fromObj, segResolver)");
if (start < 0) { console.log("  ✗ could not locate segmentApiCriteriaToSql"); process.exit(1); }
// find the matching close: the function ends at the first "\n  }\n" after start (2-space-indented close)
let end = src.indexOf("\n  }", start);
while (end > 0 && src[end + 4] !== "\n") end = src.indexOf("\n  }", end + 1); // be forgiving
const fnSrc = src.slice(start, end + 4);
const render = new Function(fnSrc + "\nreturn segmentApiCriteriaToSql;")();

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nsegmentApiCriteriaToSql — real captured node shapes (behavior)");

// (1) THE MULTILINE SEGMENT — the exact JSON the user pasted (Text + Boolean-scalar + NestedSegment).
const multiline = {
  type: "LogicalComparison", operator: "and", filters: [
    { type: "TextComparison", subject: { objectApiName: "TDI_UnifiedIndividualApp6__dlm", fieldApiName: "TDI_Account_Multiline__c" }, operator: "equal", values: ["M"] },
    { type: "BooleanComparison", subject: { objectApiName: "TDI_UnifiedIndividualApp6__dlm", fieldApiName: "TDI_Is_Active_Customer__c" }, operator: "equal", value: true },
    { type: "NestedSegment", nestingType: "membership", segmentId: "TDI_SF_PM_GI_SUPP_Cust_Mkt_Contact_Ind",
      subject: { fieldApiName: "SF_PM_GI_SUPP__Cust Mkt Contact Ind", segmentDevName: "TDI_SF_PM_GI_SUPP_Cust_Mkt_Contact_Ind", memberCount: 96239, nestedPublishBehavior: "useLastPublishedMembership" } }
  ]
};
// helper: the AND/OR chain must never dangle (…AND;  …AND\n;  …AND <comment>;)
function noDanglingBool(sql) {
  // strip block comments, then check no AND/OR is immediately followed by ; or end
  const bare = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
  return !/\b(AND|OR)\s*;/i.test(bare) && !/\b(AND|OR)\s*$/i.test(bare.trim());
}
// helper: the WHERE body must not contain a predicate that IS just a comment (no real left/op)
function noCommentPredicate(sql) {
  const body = (sql.split(/\nWHERE /)[1] || "");
  // every AND/OR-joined term should contain an operator/keyword, not be a lone comment
  return !/\b(AND|OR)\s*\/\*/i.test(body);
}
// helper: the SQL BODY (from SELECT onward) must have ZERO inline /* */ comments — annotations
// belong ONLY in the leading -- header. (A /* */ anywhere in the executable body is clutter and the
// FROM-placeholder form is an outright syntax error.)
function bodyHasNoBlockComment(sql) {
  const i = sql.indexOf("\nSELECT ");
  const body = i >= 0 ? sql.slice(i) : sql;
  return body.indexOf("/*") < 0;
}
// helper: no UNKNOWN_* / placeholder leaking where a real identifier should be, UNLESS flagged LOGIC VIEW
function placeholdersImplyLogicView(sql) {
  const hasPlaceholder = /\b(UNKNOWN_FIELD|UNKNOWN_OBJECT|UNSUPPORTED_NODE|IS_MEMBER_OF_SEGMENT|CORRELATE)\b/.test(sql.slice(sql.indexOf("\nSELECT ")));
  return !hasPlaceholder || /LOGIC VIEW/.test(sql);
}

{
  const sql = render(multiline, "SF_PM_GI_TRGT__Multiline", "Include", "TDI_UnifiedIndividualApp6__dlm");
  ok("D1 FROM is the REAL segmentOnApiName (not a comment)", /FROM TDI_UnifiedIndividualApp6__dlm\b/.test(sql) && !/FROM \/\*/.test(sql), sql);
  ok("Text leaf → real col = 'M'", /TDI_UnifiedIndividualApp6__dlm\.TDI_Account_Multiline__c = 'M'/.test(sql), sql);
  ok("D5 Boolean SCALAR value:true → = TRUE (not dropped, not '')", /TDI_Is_Active_Customer__c = TRUE/.test(sql), sql);
  ok("AND joins the three filters", /= 'M'[\s\S]*\bAND\b[\s\S]*= TRUE[\s\S]*\bAND\b/.test(sql), sql);
  ok("★ NO dangling AND/OR (the reported bug) — chain stays syntactically valid", noDanglingBool(sql), sql);
  ok("★ NO comment-only predicate after AND (the reported bug)", noCommentPredicate(sql), sql);
  ok("NestedSegment (unresolved) → VALID named pseudo-predicate, not a bare comment", /IS_MEMBER_OF_SEGMENT\('TDI_SF_PM_GI_SUPP_Cust_Mkt_Contact_Ind'\)/.test(sql), sql);
  ok("★ SQL BODY has NO inline /* */ comment (facts live in the -- header only)", bodyHasNoBlockComment(sql), sql);
  ok("unresolved nested → whole query marked LOGIC VIEW (not claimed runnable)", /LOGIC VIEW — not directly runnable/.test(sql), sql);
  ok("unresolved nested → devName named in the LOGIC-VIEW reason (so the user knows which segment)", /TDI_SF_PM_GI_SUPP_Cust_Mkt_Contact_Ind/.test(sql), sql);
}

// (1b) ★ SNAPSHOT nested segment (useLastPublishedMembership) → MUST read the published membership
// TABLE (current members only), NOT inline the live criteria. This is the 797-vs-25,341 bug: inlining
// the nested segment's criteria re-evaluates them LIVE and matches a totally different population.
{
  // give the resolver BOTH criteria AND a membership table — the snapshot path must choose the TABLE.
  const nestedCriteria = { type: "TextComparison", subject: { objectApiName: "TDI_UnifiedIndividualApp6__dlm", fieldApiName: "TDI_Marketing_Contactable__c" }, operator: "equal", values: ["Y"] };
  const resolver = (dev) => dev === "TDI_SF_PM_GI_SUPP_Cust_Mkt_Contact_Ind"
    ? { membershipTable: "Individual_Unified_SMH_123__dlm", segmentId: "1sgHo000000wkgRIAQ", criteria: nestedCriteria } : null;
  const sql = render(multiline, "SF_PM_GI_TRGT__Multiline", "Include", "TDI_UnifiedIndividualApp6__dlm", resolver);
  ok("★ snapshot nested → reads membership TABLE, does NOT inline the live criteria", /IN \(SELECT DISTINCT Id__c FROM Individual_Unified_SMH_123__dlm/.test(sql) && !/TDI_Marketing_Contactable__c/.test(sql), sql);
  ok("★ snapshot nested → current members only (Delta_Type__c = 'existing' — excludes churned rows)", /Delta_Type__c = 'existing'/.test(sql), sql);
  ok("★ snapshot nested → 15-char Segment_Id (18-char returns 0 rows)", /Segment_Id__c = '1sgHo000000wkgR'/.test(sql) && !/1sgHo000000wkgRIAQ/.test(sql), sql);
  ok("snapshot nested → NO dangling AND, valid chain", noDanglingBool(sql), sql);
  ok("snapshot nested → SQL body has NO inline comment", bodyHasNoBlockComment(sql), sql);
  ok("snapshot nested → VERIFY explains membership-table-is-correct vs inlining-would-differ", /FROZEN published snapshot/.test(sql) && /CORRECT source/.test(sql), sql);
  ok("snapshot nested (membership resolved) → marked runnable (no LOGIC VIEW)", !/LOGIC VIEW/.test(sql), sql);
}
// (1b-live) ★ LIVE/dynamic nested segment → inline its criteria (correct for that mode).
{
  const liveNested = { type: "LogicalComparison", operator: "and", filters: [
    { type: "TextComparison", subject: { objectApiName: "U__dlm", fieldApiName: "parent__c" }, operator: "equal", values: ["P"] },
    { type: "NestedSegment", segmentId: "TDI_LIVE", subject: { fieldApiName: "Live Child", segmentDevName: "TDI_LIVE", nestedPublishBehavior: "dynamic" } }
  ] };
  const nestedCriteria = { type: "TextComparison", subject: { objectApiName: "U__dlm", fieldApiName: "child__c" }, operator: "equal", values: ["C"] };
  const resolver = (dev) => dev === "TDI_LIVE" ? { membershipTable: "SMH__dlm", segmentId: "1sgHo000000aaaBBB", criteria: nestedCriteria } : null;
  const sql = render(liveNested, "LiveParent", "Include", "U__dlm", resolver);
  ok("★ live/dynamic nested → INLINES its criteria (not the membership table)", /U__dlm\.child__c = 'C'/.test(sql) && !/Delta_Type__c/.test(sql), sql);
  ok("live/dynamic nested → wrapped in parentheses, valid chain", /AND \(U__dlm\.child__c = 'C'\)/.test(sql) && noDanglingBool(sql), sql);
  ok("live/dynamic nested → runnable, no body comment", !/LOGIC VIEW/.test(sql) && bodyHasNoBlockComment(sql), sql);
}
// (1c) ★ CYCLE GUARD — a nested segment that references itself must NOT infinite-loop; falls back safely.
{
  // seg A's nested ref resolves to criteria that again contains a NestedSegment pointing back to A
  const selfRef = { type: "NestedSegment", segmentId: "TDI_A", subject: { fieldApiName: "A", segmentDevName: "TDI_A" } };
  const aCrit = { type: "LogicalComparison", operator: "and", filters: [
    { type: "TextComparison", subject: { objectApiName: "U__dlm", fieldApiName: "x__c" }, operator: "equal", values: ["1"] },
    selfRef
  ] };
  const resolver = (dev) => dev === "TDI_A" ? { criteria: aCrit, membershipTable: "", segmentId: "" } : null;
  // top-level criteria IS segment A (so inlining A's nested self-ref must hit the cycle guard)
  let sql, threw = false;
  try { sql = render(aCrit, "TDI_A", "Include", "U__dlm", resolver); } catch (e) { threw = true; }
  ok("★ self-referential nested segment does NOT infinite-loop", !threw, threw ? "THREW" : "");
  ok("cycle → flagged as a blocker (LOGIC VIEW), not silently wrong", threw ? false : /CYCLE/.test(sql) && /LOGIC VIEW/.test(sql), sql);
}
// (1d) membership subquery shape (snapshot segment, membership-only) — 15-char id + Delta_Type filter.
{
  const resolver = () => ({ membershipTable: "Individual_Unified_SMH_123__dlm", segmentId: "1sgHo000000wkgRIAQ", criteria: null });  // 18-char, no criteria
  const sql = render(multiline, "s", "Include", "TDI_UnifiedIndividualApp6__dlm", resolver);
  ok("★ membership subquery: 15-CHAR id + Delta_Type__c='existing' (current members only, live-verified)",
    /Id__c IN \(SELECT DISTINCT Id__c FROM Individual_Unified_SMH_123__dlm WHERE Segment_Id__c = '1sgHo000000wkgR' AND Delta_Type__c = 'existing'\)/.test(sql) && !/1sgHo000000wkgRIAQ/.test(sql), sql);
  ok("membership subquery → NO dangling AND + no body comment", noDanglingBool(sql) && bodyHasNoBlockComment(sql), sql);
}

// (2) AGGREGATION — real SP_Test shape: NumberAggregation(count) with inner filter + comparison ≥ 1.
const agg = {
  filter: { type: "TextComparison", subject: { objectApiName: "ssot__ProductBrowseEngagement__dlm", fieldApiName: "ssot__ProductId__c" }, operator: "equal", values: ["product_2"] },
  containerObjectApiName: "ssot__ProductBrowseEngagement__dlm",
  path: [[{ objectApiName: "UnifiedIndividual__dlm", fieldApiName: "ssot__Id__c" }, { objectApiName: "IndividualIdentityLink__dlm", fieldApiName: "UnifiedRecordId__c" }]],
  type: "NumberAggregation", aggregateFunction: "count",
  comparison: { type: "NumberComparison", subject: { objectApiName: "ssot__ProductBrowseEngagement__dlm", fieldApiName: "ssot__Id__c" }, operator: "greater than or equal", value: 1 }
};
{
  const sql = render(agg, "SP_Test", "Include", "UnifiedIndividual__dlm");
  ok("D4 aggregation renders COUNT(*) subquery (not silently dropped)", /\(SELECT COUNT\(\*\) FROM ssot__ProductBrowseEngagement__dlm/.test(sql), sql);
  ok("D4 aggregation inner filter preserved", /AND ssot__ProductBrowseEngagement__dlm\.ssot__ProductId__c = 'product_2'/.test(sql), sql);
  ok("D2+D5 threshold op 'greater than or equal' + scalar 1 → >= 1", /\) >= 1/.test(sql), sql);
  // ★ the 92,416 'returns everyone' fix: the subquery is now CORRELATED to the outer individual via the
  //   path join keys (verified live that Data Cloud supports this), NOT an uncorrelated COUNT(whole org).
  ok("★ aggregation subquery CORRELATES to the outer individual (real join pred, not uncorrelated)",
    /WHERE UnifiedIndividual__dlm\.ssot__Id__c = IndividualIdentityLink__dlm\.UnifiedRecordId__c/.test(sql), sql);
  ok("★ NO fake CORRELATE() placeholder anymore", !/CORRELATE\(/.test(sql), sql);
  ok("★ aggregation WITH a usable path → marked RUNNABLE (not LOGIC VIEW)", !/LOGIC VIEW/.test(sql), sql);
  ok("subquery FROM lists the container (+ intermediate hop objects when multi-hop)", /\(SELECT COUNT\(\*\) FROM ssot__ProductBrowseEngagement__dlm/.test(sql), sql);
}
// (2b) ★ OR/AND rails + CORRELATED aggregations (the real SF_PM_GI_TRGT__Cust Mkt Contact Ind shape).
//   email/phone = 1-hop (PartyId = Individual.Id); consent = 3-hop (via link + source individual).
{
  const emailAgg = { type: "NumberAggregation", aggregateFunction: "count", containerObjectApiName: "EmailCP__dlm",
    filter: { type: "TextComparison", subject: { objectApiName: "EmailCP__dlm", fieldApiName: "EmailAddress__c" }, operator: "has value" },
    comparison: { type: "NumberComparison", subject: { objectApiName: "EmailCP__dlm", fieldApiName: "Id__c" }, operator: "greater than or equal", value: 1 },
    path: [[{ objectApiName: "U__dlm", fieldApiName: "Id__c" }, { objectApiName: "EmailCP__dlm", fieldApiName: "PartyId__c" }]] };
  const phoneAgg = { type: "NumberAggregation", aggregateFunction: "count", containerObjectApiName: "PhoneCP__dlm",
    comparison: { type: "NumberComparison", subject: { objectApiName: "PhoneCP__dlm", fieldApiName: "Id__c" }, operator: "greater than or equal", value: 1 },
    path: [[{ objectApiName: "U__dlm", fieldApiName: "Id__c" }, { objectApiName: "PhoneCP__dlm", fieldApiName: "PartyId__c" }]] };
  const consentAgg = { type: "NumberAggregation", aggregateFunction: "count", containerObjectApiName: "Consent__dlm",
    filter: { type: "BooleanComparison", subject: { objectApiName: "Consent__dlm", fieldApiName: "Marketing_Consent__c" }, operator: "equal", value: true },
    comparison: { type: "NumberComparison", subject: { objectApiName: "Consent__dlm", fieldApiName: "Id__c" }, operator: "greater than or equal", value: 1 },
    path: [[{ objectApiName: "U__dlm", fieldApiName: "Id__c" }, { objectApiName: "Link__dlm", fieldApiName: "UnifiedRecordId__c" }],
           [{ objectApiName: "Link__dlm", fieldApiName: "SourceRecordId__c" }, { objectApiName: "Src__dlm", fieldApiName: "Id__c" }],
           [{ objectApiName: "Src__dlm", fieldApiName: "Id__c" }, { objectApiName: "Consent__dlm", fieldApiName: "SrcId__c" }]] };
  const crit = { type: "LogicalComparison", operator: "and", filters: [
    { type: "LogicalComparison", operator: "or", filters: [emailAgg, phoneAgg] },
    consentAgg
  ] };
  const sql = render(crit, "CustMktContactInd", "Include", "U__dlm");
  ok("★ OR group parenthesized, AND joins it to consent (rails handled)", /\(\(SELECT COUNT\(\*\) FROM EmailCP__dlm[\s\S]*OR \(SELECT COUNT\(\*\) FROM PhoneCP__dlm[\s\S]*\)\s*\n\s*AND \(SELECT COUNT\(\*\) FROM Consent__dlm/.test(sql), sql);
  ok("★ email agg correlated: U.Id = EmailCP.PartyId", /U__dlm\.Id__c = EmailCP__dlm\.PartyId__c/.test(sql), sql);
  ok("★ consent agg MULTI-HOP: FROM lists all 3 chain objects + all 3 hop joins", /FROM Consent__dlm, Link__dlm, Src__dlm/.test(sql) && /U__dlm\.Id__c = Link__dlm\.UnifiedRecordId__c/.test(sql) && /Link__dlm\.SourceRecordId__c = Src__dlm\.Id__c/.test(sql) && /Src__dlm\.Id__c = Consent__dlm\.SrcId__c/.test(sql), sql);
  ok("★ all aggregations correlated → query RUNNABLE (not a 92,416 LOGIC VIEW)", !/LOGIC VIEW/.test(sql), sql);
  ok("no fake CORRELATE() placeholder", !/CORRELATE\(/.test(sql), sql);
  ok("no dangling bool / valid chain", noDanglingBool(sql), sql);
}
// (2c) aggregation with NO path → cannot correlate → honest LOGIC VIEW fallback (not an uncorrelated count).
{
  const noPathAgg = { type: "NumberAggregation", aggregateFunction: "count", containerObjectApiName: "Orphan__dlm",
    comparison: { type: "NumberComparison", subject: { objectApiName: "Orphan__dlm", fieldApiName: "Id__c" }, operator: "greater than or equal", value: 1 } };
  const sql = render(noPathAgg, "NoPath", "Include", "U__dlm");
  ok("★ no-path aggregation → LOGIC VIEW (never an uncorrelated 'matches everyone' COUNT)", /LOGIC VIEW/.test(sql) && /no join path/.test(sql), sql);
  ok("★ no-path aggregation → valid placeholder (UNCORRELATED_COUNT), no dangling bool", /UNCORRELATED_COUNT\(Orphan__dlm\)/.test(sql) && noDanglingBool(sql), sql);
}

// (3) "has value" operator — real Test_Segment_in_SP inner subject (no values at all).
{
  const hv = { type: "TextComparison", subject: { objectApiName: "O__dlm", fieldApiName: "ProductId__c" }, operator: "has value" };
  const sql = render(hv, "s", "Include", "O__dlm");
  ok("D2 'has value' (space phrase) → IS NOT NULL (not /* op */)", /O__dlm\.ProductId__c IS NOT NULL/.test(sql) && !/\/\* op:/.test(sql), sql);
}

// (3b) UNKNOWN operator must NOT emit a bare '/* op */ ' predicate that dangles the AND.
{
  const grp = { type: "LogicalComparison", operator: "and", filters: [
    { type: "TextComparison", subject: { objectApiName: "O__dlm", fieldApiName: "a__c" }, operator: "equal", values: ["1"] },
    { type: "TextComparison", subject: { objectApiName: "O__dlm", fieldApiName: "b__c" }, operator: "some weird future op", values: ["Z"] }
  ] };
  const sql = render(grp, "s", "Include", "O__dlm");
  ok("unknown op → VALID comparison (no dangling AND)", noDanglingBool(sql) && noCommentPredicate(sql), sql);
  ok("unknown op → surfaced in VERIFY, not silent", /unrecognized operator/.test(sql), sql);
}

// (4) CalculatedInsight — real TDI_5_random_control shape.
const ci = {
  type: "CalculatedInsight",
  subject: { objectApiName: "TDI_Independent_Audience_Splits__cio", fieldApiName: "Unified_Individual_ID__c" },
  path: [[{ objectApiName: "TDI_UnifiedIndividualTdir__dlm", fieldApiName: "Id__c" }, { objectApiName: "TDI_Independent_Audience_Splits__cio", fieldApiName: "Unified_Individual_ID__c" }]],
  comparison: { type: "TextComparison", subject: { objectApiName: "TDI_Independent_Audience_Splits__cio", fieldApiName: "Control_5_Pct__c" }, operator: "equal", values: ["T"] }
};
{
  const sql = render(ci, "TDI_5_random_control", "Include", "TDI_UnifiedIndividualTdir__dlm");
  ok("CI leaf → real col = 'T'", /TDI_Independent_Audience_Splits__cio\.Control_5_Pct__c = 'T'/.test(sql), sql);
  // ★ CI is on a DIFFERENT object than the segment's FROM → must be a CORRELATED EXISTS (not a bare
  //   predicate referencing an unjoined table, which would be invalid SQL).
  ok("★ cross-object CI leaf → correlated EXISTS (joins CI object to the individual, runnable)",
    /EXISTS \(SELECT 1 FROM TDI_Independent_Audience_Splits__cio\s*\n\s*WHERE TDI_UnifiedIndividualTdir__dlm\.Id__c = TDI_Independent_Audience_Splits__cio\.Unified_Individual_ID__c/.test(sql), sql);
  ok("★ CI query marked runnable (correlated, not LOGIC VIEW)", !/LOGIC VIEW/.test(sql), sql);
}

// (5) SAFETY — a genuinely unknown node must be surfaced + block runnability, never silently wrong,
//     and must NOT dangle the AND.
{
  const sql = render({ type: "LogicalComparison", operator: "and", filters: [
    { type: "TextComparison", subject: { objectApiName: "O__dlm", fieldApiName: "a__c" }, operator: "equal", values: ["1"] },
    { type: "GalaxyBrainNode" }
  ] }, "s", "Include", "O__dlm");
  ok("unknown node → valid placeholder predicate (no dangling AND)", /UNSUPPORTED_NODE\('GalaxyBrainNode'\)/.test(sql) && noDanglingBool(sql), sql);
  ok("unknown node → blocks runnability (LOGIC VIEW)", /LOGIC VIEW/.test(sql), sql);
}

// (7) a fully-simple single-object segment should be marked RUNNABLE (positive control).
{
  const simple = { type: "LogicalComparison", operator: "and", filters: [
    { type: "TextComparison", subject: { objectApiName: "U__dlm", fieldApiName: "a__c" }, operator: "equal", values: ["X"] },
    { type: "BooleanComparison", subject: { objectApiName: "U__dlm", fieldApiName: "b__c" }, operator: "equal", value: false }
  ] };
  const sql = render(simple, "simple", "Include", "U__dlm");
  ok("simple segment → marked runnable (no LOGIC VIEW)", /Runnable against Data Cloud/.test(sql) && !/LOGIC VIEW/.test(sql), sql);
  ok("simple segment → = 'X' AND = FALSE, valid chain", /a__c = 'X'[\s\S]*AND[\s\S]*b__c = FALSE/.test(sql) && noDanglingBool(sql), sql);
}

// (6) EXCLUDE tab still renders (operand/FROM same; the caller passes tabLabel) — sanity it doesn't crash.
{
  const sql = render(multiline, "SF_PM_GI_TRGT__Multiline", "Exclude", "TDI_UnifiedIndividualApp6__dlm");
  ok("exclude tab label flows into the header", /tab: Exclude/.test(sql), sql);
}

// (8) SWEEP — every node shape, assert the executable BODY is comment-free + placeholders ⇒ LOGIC VIEW.
{
  const cases = {
    "simple has-value": { type: "TextComparison", subject: { objectApiName: "U__dlm", fieldApiName: "p__c" }, operator: "has value" },
    "boolean scalar": { type: "BooleanComparison", subject: { objectApiName: "U__dlm", fieldApiName: "b__c" }, operator: "equal", value: true },
    "aggregation": agg,
    "calculated insight": ci,
    "nested unresolved": multiline,
    "unknown op": { type: "TextComparison", subject: { objectApiName: "U__dlm", fieldApiName: "x__c" }, operator: "zzz future", values: ["1"] },
    "unknown node": { type: "LogicalComparison", operator: "and", filters: [{ type: "Nope" }] },
    "missing field": { type: "TextComparison", operator: "equal", values: ["1"] }
  };
  let allClean = true, allHonest = true;
  for (const name in cases) {
    const sql = render(cases[name], name, "Include", "U__dlm");
    if (!bodyHasNoBlockComment(sql)) { allClean = false; console.log("    body-comment leak in: " + name + "\n" + sql); }
    if (!placeholdersImplyLogicView(sql)) { allHonest = false; console.log("    placeholder without LOGIC VIEW in: " + name); }
    if (!noDanglingBool(sql)) { allClean = false; console.log("    dangling bool in: " + name); }
  }
  ok("★ SWEEP: NO inline /* */ in the SQL body of ANY node type", allClean);
  ok("★ SWEEP: any placeholder identifier ⇒ query flagged LOGIC VIEW (never a silent fake)", allHonest);
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
