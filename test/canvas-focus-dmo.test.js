// Canvas "Focus DMO" logic tests — run in Node.
//   node test/canvas-focus-dmo.test.js
//
// Tier-1 of the mapping-canvas verification helper: instead of tracing the wire
// spaghetti, pick ONE target DMO from a dropdown and see its exact source->target
// pairs as a clean list (dim/highlight + click-to-jump happen in the browser).
//
// This tests the PURE data logic that mirrors console-decorate.extension.js:
//   • groupByDmo(rows)         -> Map<dmoApi, pairs[]> from buildMappingRows() output
//   • dmoDropdownOptions(rows) -> [{dmo, label, count}] sorted, for the <select>
//   • rowKeysForDmo(rows, dmo) -> the source + target field api names to highlight
// buildMappingRows() itself is DOM-driven (tested live); here we lock the grouping.

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Pure helpers — mirror console-decorate.extension.js ──────────────────────────
function groupByDmo(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r || !r.dmo) continue;
    if (!m.has(r.dmo)) m.set(r.dmo, []);
    m.get(r.dmo).push(r);
  }
  return m;
}
function dmoDropdownOptions(rows) {
  const g = groupByDmo(rows);
  const out = [];
  for (const [dmo, pairs] of g) {
    out.push({ dmo: dmo, label: (pairs[0] && pairs[0].dmoLabel) || dmo, count: pairs.length });
  }
  // sort by label (stable, case-insensitive) so the dropdown is predictable
  out.sort((a, b) => String(a.label).toLowerCase().localeCompare(String(b.label).toLowerCase()));
  return out;
}
function rowKeysForDmo(rows, dmo) {
  const src = new Set(), tgt = new Set();
  for (const r of rows) {
    if (r.dmo !== dmo) continue;
    if (r.sourceApi) src.add(r.sourceApi);
    if (r.targetApi) tgt.add(r.targetApi);
  }
  return { source: src, target: tgt };
}

// Fixture modeled on the real probe (Contact Point Phone etc.)
function sampleRows() {
  return [
    { srcObj: "DLO", sourceLabel: "Phone", sourceApi: "Phone__c", dmo: "TDI_ContactPointPhone__dlm", dmoLabel: "Contact Point Phone", targetLabel: "Formatted E164 Phone Number", targetApi: "FormattedE164PhoneNumber__c" },
    { srcObj: "DLO", sourceLabel: "deviceId", sourceApi: "deviceId__c", dmo: "TDI_ContactPointPhone__dlm", dmoLabel: "Contact Point Phone", targetLabel: "Contact Point Phone Id", targetApi: "Id__c" },
    { srcObj: "DLO", sourceLabel: "contact_type", sourceApi: "contact_type__c", dmo: "TDI_ContactPointPhone__dlm", dmoLabel: "Contact Point Phone", targetLabel: "Contact Point Type", targetApi: "ContactPointTypeId__c" },
    { srcObj: "DLO", sourceLabel: "DQ_Birthdate", sourceApi: "DQ_Birthdate__c", dmo: "TDI_Individual__dlm", dmoLabel: "Individual", targetLabel: "Birth Date", targetApi: "BirthDt__c" },
    { srcObj: "DLO", sourceLabel: "DQ_FirstName", sourceApi: "DQ_FirstName__c", dmo: "TDI_Individual__dlm", dmoLabel: "Individual", targetLabel: "First Name", targetApi: "FirstName__c" },
    { srcObj: "DLO", sourceLabel: "consent_in", sourceApi: "consent_in__c", dmo: "TDI_Engagement_Consent__dlm", dmoLabel: "Engagement Consent", targetLabel: "Account Consent In", targetApi: "AccountConsentIn__c" },
  ];
}

console.log("\n1. groupByDmo buckets rows by target DMO");
{
  const g = groupByDmo(sampleRows());
  eq("3 distinct DMOs", g.size, 3);
  eq("Contact Point Phone has 3 pairs", g.get("TDI_ContactPointPhone__dlm").length, 3);
  eq("Individual has 2 pairs", g.get("TDI_Individual__dlm").length, 2);
}

console.log("\n2. dmoDropdownOptions — label + count, sorted");
{
  const opts = dmoDropdownOptions(sampleRows());
  eq("3 options", opts.length, 3);
  eq("sorted first = Contact Point Phone", opts[0].label, "Contact Point Phone");
  eq("...with count 3", opts[0].count, 3);
  eq("sorted = Engagement Consent, Individual next", opts[1].label + "|" + opts[2].label, "Engagement Consent|Individual");
  ok("each option carries the dmo api name", opts.every(o => /__dlm$/.test(o.dmo)));
}

console.log("\n3. per-DMO field scoping (fixes the shared-field over-match: Id__c etc.)");
{
  const k = rowKeysForDmo(sampleRows(), "TDI_ContactPointPhone__dlm");
  eq("3 source fields", k.source.size, 3);
  eq("3 target fields", k.target.size, 3);
  ok("includes the mapped source Phone__c", k.source.has("Phone__c"));
  ok("includes the mapped target Id__c", k.target.has("Id__c"));
  ok("does NOT include another DMO's field (BirthDt__c)", !k.target.has("BirthDt__c"));
}

console.log("\n4. field filter/search within a DMO");
{
  // mirrors panel paint(): filter pairs by substring across both labels + api names
  function filterPairs(pairs, q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return pairs;
    return pairs.filter((p) => [p.sourceLabel, p.sourceApi, p.targetLabel, p.targetApi]
      .some((v) => String(v || "").toLowerCase().indexOf(q) >= 0));
  }
  const pairs = groupByDmo(sampleRows()).get("TDI_ContactPointPhone__dlm");
  eq("no query -> all 3", filterPairs(pairs, "").length, 3);
  eq("filter 'phone' matches both phone-labeled pairs", filterPairs(pairs, "phone").length, 2);
  eq("filter by target label 'E164' is specific", filterPairs(pairs, "e164").length, 1);
  eq("filter by source api 'contact_type'", filterPairs(pairs, "contact_type").length, 1);
  eq("no match -> 0", filterPairs(pairs, "zzz").length, 0);
}

console.log("\n4b. declutter: normFieldKey + shared-field detection + keep-set");
{
  // mirror console-decorate.extension.js
  const normFieldKey = (s) => String(s == null ? "" : s).replace(/__c$/i, "").replace(/[_\s]+/g, " ").trim().toLowerCase();
  eq("api name normalizes", normFieldKey("Address_Contact_Point_Type__c"), "address contact point type");
  eq("row data-tid normalizes to same key", normFieldKey("Address Contact Point Type"), "address contact point type");
  eq("api == tid after norm (join works)", normFieldKey("apt__c"), normFieldKey("apt"));

  function sharedSourceKeys(rows) {
    const byField = new Map();
    for (const r of rows) { if (!r.sourceApi || !r.dmo) continue; const k = normFieldKey(r.sourceApi); if (!byField.has(k)) byField.set(k, new Set()); byField.get(k).add(r.dmo); }
    const shared = new Set(); for (const [k, set] of byField) if (set.size > 1) shared.add(k); return shared;
  }
  // DataSource maps to 2 DMOs (shared); Phone maps to 1 (unique)
  const rows = [
    { sourceApi: "DataSource__c", dmo: "TDI_ContactPointPhone__dlm" },
    { sourceApi: "DataSource__c", dmo: "TDI_Individual__dlm" },
    { sourceApi: "Phone__c", dmo: "TDI_ContactPointPhone__dlm" },
  ];
  const shared = sharedSourceKeys(rows);
  ok("DataSource flagged shared (>1 DMO)", shared.has("datasource"));
  ok("Phone NOT shared (1 DMO)", !shared.has("phone"));

  // keep-set with hideShared=true excludes shared fields (removes stray wires)
  function keepSet(rows, dmo, hideShared) {
    const sh = hideShared ? sharedSourceKeys(rows) : new Set();
    const keep = new Set();
    for (const r of rows) { if (r.dmo === dmo && r.sourceApi) { const k = normFieldKey(r.sourceApi); if (!(hideShared && sh.has(k))) keep.add(k); } }
    return keep;
  }
  const kAll = keepSet(rows, "TDI_ContactPointPhone__dlm", false);
  ok("hideShared=false keeps DataSource + Phone", kAll.has("datasource") && kAll.has("phone"));
  const kClean = keepSet(rows, "TDI_ContactPointPhone__dlm", true);
  ok("hideShared=true drops DataSource (stray wire gone)", !kClean.has("datasource"));
  ok("hideShared=true keeps the unique Phone field", kClean.has("phone"));
}

console.log("\n5. empty / malformed rows don't crash");
{
  eq("empty rows -> 0 options", dmoDropdownOptions([]).length, 0);
  const g = groupByDmo([{ sourceApi: "x" }, null, { dmo: "" }]); // no dmo / null / blank
  eq("rows without a dmo are skipped", g.size, 0);
}

// ── Source presence — the feature is wired into console-decorate.extension.js ────
console.log("\n6. Source presence (panel-only Focus DMO wired up)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("a Focus DMO button/panel exists", /Focus DMO|dc-focus-btn|openFocusPanel/.test(src));
  ok("groups mapping rows by DMO", /groupRowsByDmo/.test(src));
  ok("reuses buildMappingRows() (authoritative mapping), not re-scraping", /buildMappingRows\(\)/.test(src));
  ok("has a field filter/search box", /Filter fields in this DMO/.test(src));
  ok("declutter hides other DMOs + unrelated source rows", /hideOtherForDmo/.test(src));
  ok("has Show all restore + auto-restore on close", /restoreCanvas/.test(src) && /Show all/.test(src));
  ok("has the shared-field (stray-wire) option", /sharedSourceKeys/.test(src) && /hide shared/.test(src));
  ok("warns that SF zoom may act oddly while decluttered", /zoom\/pan may act oddly/.test(src));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
