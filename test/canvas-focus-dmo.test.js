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

console.log("\n4c. data-type mismatch detection (only when BOTH types known)");
{
  const isMismatch = (p) => { const a = String(p.sourceType || "").trim().toLowerCase(), b = String(p.targetType || "").trim().toLowerCase(); return !!(a && b && a !== b); };
  ok("Text -> Date flagged", isMismatch({ sourceType: "Text", targetType: "Date" }));
  ok("Text -> text NOT flagged (case-insensitive)", !isMismatch({ sourceType: "Text", targetType: "text" }));
  ok("blank source type -> NOT flagged (don't guess)", !isMismatch({ sourceType: "", targetType: "Date" }));
  ok("blank target type -> NOT flagged", !isMismatch({ sourceType: "Text", targetType: "" }));
  ok("both blank -> NOT flagged", !isMismatch({ sourceType: "", targetType: "" }));
}

console.log("\n4d. PK badge uses the authoritative per-side flag");
{
  // mirror: isPK = isSrc ? sourceIsPrimaryKey : targetIsPrimaryKey
  const pkShown = (side, p) => side === "L" ? !!p.sourceIsPrimaryKey : !!p.targetIsPrimaryKey;
  ok("target PK field shows PK on right", pkShown("R", { targetIsPrimaryKey: true }));
  ok("source PK field shows PK on left", pkShown("L", { sourceIsPrimaryKey: true }));
  ok("target PK does NOT bleed to left", !pkShown("L", { targetIsPrimaryKey: true }));
  ok("source PK does NOT bleed to right", !pkShown("R", { sourceIsPrimaryKey: true }));
  ok("missing flags -> no PK (never guessed)", !pkShown("R", {}) && !pkShown("L", {}));
}

console.log("\n4e. pairsToTSV — clipboard export of a DMO's pairs (type + PK columns)");
{
  const isMismatch = (p) => { const a = String(p.sourceType || "").trim().toLowerCase(), b = String(p.targetType || "").trim().toLowerCase(); return !!(a && b && a !== b); };
  function pairsToTSV(pairs) {
    const head = ["Source Field", "Source API", "Source Type", "Source PK", "Target Field", "Target API", "Target Type", "Target PK", "Type Mismatch"];
    const lines = [head.join("\t")];
    pairs.forEach((p) => lines.push([p.sourceLabel || "", p.sourceApi || "", p.sourceType || "", p.sourceIsPrimaryKey ? "PK" : "", p.targetLabel || "", p.targetApi || "", p.targetType || "", p.targetIsPrimaryKey ? "PK" : "", isMismatch(p) ? "YES" : ""].map((v) => String(v).replace(/\t/g, " ")).join("\t")));
    return lines.join("\n");
  }
  const pairs = [
    { sourceLabel: "deviceId", sourceApi: "deviceId__c", sourceType: "Text", sourceIsPrimaryKey: true, targetLabel: "Contact Point Phone Id", targetApi: "Id__c", targetType: "Text", targetIsPrimaryKey: true },
    { sourceLabel: "DQ_Birthdate", sourceApi: "DQ_Birthdate__c", sourceType: "Text", targetLabel: "Birth Date", targetApi: "BirthDt__c", targetType: "Date" },
  ];
  const tsv = pairsToTSV(pairs);
  const rows = tsv.split("\n");
  eq("header + 2 rows", rows.length, 3);
  ok("header has all 9 columns", rows[0].split("\t").length === 9);
  ok("PK marked on both sides for the PK row", /\tPK\t.*\tPK\t/.test(rows[1]));
  ok("type mismatch flagged YES (Text->Date)", /\tYES$/.test(rows[2]));
  ok("non-mismatch row has empty mismatch cell", rows[1].endsWith("\t"));
}

console.log("\n4f. system/key field classification (explains why our count > SF's 'Is Mapped')");
{
  const SYS_TARGETS = { "datasourceid__c": 1, "datasourceobjectid__c": 1, "internalorganizationid__c": 1, "datasource__c": 1, "datasourceobject__c": 1, "internalorganization__c": 1, "ssot__datasourceid__c": 1, "ssot__datasourceobjectid__c": 1, "ssot__internalorganizationid__c": 1, "cdp_sys_sourceversion__c": 1 };
  function isSystemPair(p) {
    const t = String(p.targetApi || "").toLowerCase();
    if (SYS_TARGETS[t]) return true;
    if (/^kq_/i.test(String(p.targetApi || "")) || /^kq_/i.test(String(p.sourceApi || ""))) return true;
    return false;
  }
  ok("DataSourceId__c flagged system", isSystemPair({ targetApi: "DataSourceId__c" }));
  ok("InternalOrganizationId__c flagged system", isSystemPair({ targetApi: "InternalOrganizationId__c" }));
  ok("KQ_ target flagged (key qualifier)", isSystemPair({ targetApi: "KQ_Id__c" }));
  ok("KQ_ source flagged (key qualifier)", isSystemPair({ sourceApi: "KQ_contact_key__c", targetApi: "Id__c" }));
  ok("a real business field is NOT system", !isSystemPair({ targetApi: "BirthDt__c" }));
  // the reported case: 14 total, 9 business → 5 system/key
  const pairs = [
    { targetApi: "Id__c" }, { targetApi: "City__c" }, { targetApi: "PostalCode__c" }, { targetApi: "Country__c" },
    { targetApi: "Street__c" }, { targetApi: "APT__c" }, { targetApi: "ContactPointType__c" }, { targetApi: "StateProvince__c" }, { targetApi: "LastModifiedDate__c" },
    { targetApi: "DataSourceId__c" }, { targetApi: "DataSourceObjectId__c" }, { targetApi: "InternalOrganizationId__c" }, { targetApi: "KQ_Id__c" }, { targetApi: "KQ_PartyId__c" },
  ];
  eq("14 total pairs", pairs.length, 14);
  eq("5 are system/key (explains 14 vs SF's 9)", pairs.filter(isSystemPair).length, 5);
}

console.log("\n4g. object-context bar: distinct source DLO(s) + target DMO");
{
  // mirror buildObjectBar's distinct-source collection
  function sources(pairs) {
    const out = [], seen = {};
    pairs.forEach((p) => { const api = p.srcObj || "", lbl = p.srcObjLabel || p.srcObj || "", key = api + "|" + lbl; if ((api || lbl) && !seen[key]) { seen[key] = 1; out.push({ api, label: lbl }); } });
    return out;
  }
  const oneSrc = [
    { srcObj: "TDI_RH_Profile__dll", srcObjLabel: "TDI_RH_Profile", dmo: "TDI_ContactPointPhone__dlm", dmoLabel: "Contact Point Phone" },
    { srcObj: "TDI_RH_Profile__dll", srcObjLabel: "TDI_RH_Profile", dmo: "TDI_ContactPointPhone__dlm", dmoLabel: "Contact Point Phone" },
  ];
  eq("same DLO twice -> 1 distinct source", sources(oneSrc).length, 1);
  eq("source API captured", sources(oneSrc)[0].api, "TDI_RH_Profile__dll");
  const multiSrc = oneSrc.concat([{ srcObj: "TDI_Other__dll", srcObjLabel: "Other", dmo: "TDI_ContactPointPhone__dlm", dmoLabel: "Contact Point Phone" }]);
  eq("two different DLOs -> 2 distinct sources", sources(multiSrc).length, 2);
  eq("target DMO api from first row", (multiSrc[0].dmo), "TDI_ContactPointPhone__dlm");
}

console.log("\n5. empty / malformed rows don't crash");
{
  eq("empty rows -> 0 options", dmoDropdownOptions([]).length, 0);
  const g = groupByDmo([{ sourceApi: "x" }, null, { dmo: "" }]); // no dmo / null / blank
  eq("rows without a dmo are skipped", g.size, 0);
}

// ── Source presence — the feature is wired into console-decorate.extension.js ────
console.log("\n6. Source presence (own-diagram Focus DMO wired up; no canvas manipulation)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("a Focus DMO button/panel exists", /Focus DMO|dc-focus-btn|openFocusPanel/.test(src));
  ok("groups mapping rows by DMO", /groupRowsByDmo/.test(src));
  ok("reuses buildMappingRows() (authoritative mapping), not re-scraping", /buildMappingRows\(\)/.test(src));
  ok("has a field search box", /Type to find a field/.test(src));
  ok("panel is resizable (addResizeHandle wired)", /addResizeHandle\(panel/.test(src));
  ok("draws its OWN svg diagram (createElementNS svg/path)", /createElementNS\(svgNS/.test(src));
  ok("shows data type pills + PK badge", /isMismatch/.test(src) && /targetIsPrimaryKey/.test(src));
  ok("target PK from the field's own isPrimaryKey (confirmed via probe)", /safeGet\(f, "isPrimaryKey"\)/.test(src));
  ok("source PK from the source entity's isPrimaryKey (both sides)", /srcPkSet/.test(src) && /isPrimaryKey/.test(src));
  ok("shows a Copied toast on field click", /function toast\(/.test(src) && /Copied/.test(src));
  ok("has a Copy-mappings button (TSV export)", /Copy mappings/.test(src) && /pairsToTSV/.test(src));
  ok("has an 'All DMOs' grouped view (collapsible sections)", /__ALL__/.test(src) && /mode === "all"/.test(src));
  ok("flags system/key fields (SYS badge + 'SF hides' note)", /isSystemPair/.test(src) && /SYS/.test(src) && /SF hides/.test(src));
  ok("shows DLO + DMO object name + API (object context bar)", /function buildObjectBar/.test(src) && /Target · DMO/.test(src));
  ok("does NOT manipulate SF canvas anymore (no hideOtherForDmo/restoreCanvas)",
    !/hideOtherForDmo/.test(src) && !/function restoreCanvas/.test(src));
  ok("no 'Declutter canvas' / zoom-warning left over",
    !/Declutter canvas/.test(src) && !/zoom\/pan may act oddly/.test(src));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
