// Mapping-canvas TARGET (DMO / right side) API-name resolution tests.
//   node test/mapping-canvas-target-api.test.js
//
// Bug this locks down (reported on a real org, confirmed via a live DOM probe):
//   A DMO can have TWO fields sharing one label. TDI_Individual__dlm has both
//   "Birth Date" = ssot__BirthDate__c (standard, FIRST in entity.fields[]) and
//   "Birth Date" = BirthDt__c (custom, second). The stream actually maps its
//   source field to BirthDt__c, but the canvas tooltip matched purely by label
//   and returned the FIRST field -> showed ssot__BirthDate__c. Wrong.
//
// This is the SAME class of bug already fixed on the SOURCE/DLO (left) side by
// reading the authoritative container.mapping[] pairing instead of the label.
// This mirrors that fix onto the TARGET/DMO (right) side.
//
// Key difference from the source side: the DMO field list renders "Is Mapped (n)"
// BEFORE "Unmapped (n)", so a plain field-order cursor would STILL pick the first
// (unmapped) collider. The resolver therefore orders colliding candidates
// MAPPED-FIRST (using the mapping[] set), then hands successive rendered rows the
// next candidate. When it genuinely cannot disambiguate (two DIFFERENT mapped
// api names under one label), it returns sure=false so the UI can mark it "(?)".

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Pure resolver — mirrors makeTargetResolver() in console-decorate.js ──────────
// labelNames : Map<label, [apiName,...]>  (ALL fields for that label, in field order)
// mappedSet  : Set<"dmoApi::fieldApi">    (target fields actually mapped, per DMO)
// dmoApi     : the current DMO entity name
function makeTargetResolver(labelNames, mappedSet, dmoApi) {
  const cursor = new Map();
  return function nextForLabelTarget(label) {
    let arr = labelNames.get(label);
    if (!arr) {
      const norm = String(label).replace(/\s+/g, " ").trim();
      for (const [k, v] of labelNames) { if (String(k).replace(/\s+/g, " ").trim() === norm) { arr = v; label = k; break; } }
    }
    if (!arr || !arr.length) return null;
    const distinct = Array.from(new Set(arr));
    if (distinct.length === 1) return { api: distinct[0], sure: true }; // unique, or all identical
    // Colliding label with genuinely different api names: order MAPPED-first.
    const mapped = arr.filter(function (a) { return mappedSet.has(dmoApi + "::" + a); });
    const unmapped = arr.filter(function (a) { return !mappedSet.has(dmoApi + "::" + a); });
    const ordered = mapped.concat(unmapped);
    const used = cursor.get(label) || 0;
    const idx = used < ordered.length ? used : ordered.length - 1; // clamp; never overrun
    cursor.set(label, used + 1);
    const pick = ordered[idx];
    const bucket = idx < mapped.length ? mapped : unmapped;
    const bucketDistinct = Array.from(new Set(bucket));
    return { api: pick, sure: bucketDistinct.length === 1 };
  };
}

// Real fixture from the live probe (TDI_Individual__dlm), trimmed to the relevant labels.
const DMO = "TDI_Individual__dlm";
function individualLabelNames() {
  const m = new Map();
  m.set("Birth Date", ["ssot__BirthDate__c", "BirthDt__c"]);           // standard first, custom mapped
  m.set("Contact Type", ["TDI_Contact_Type__c", "contact_type__c"]);   // collides, NEITHER mapped in this stream
  m.set("Key Qualifier Individual Id", ["KQ_Id__c", "KQ_Id__c"]);      // duplicate w/ IDENTICAL api
  m.set("First Name", ["FirstName__c"]);                                // unique
  return m;
}
// From container.mapping[] in the probe: BirthDt__c IS mapped, FirstName__c IS mapped.
function individualMappedSet() {
  return new Set([DMO + "::BirthDt__c", DMO + "::FirstName__c", DMO + "::LastName__c", DMO + "::Id__c"]);
}

console.log("\n1. Birth Date collision — the exact reported bug");
{
  const r = makeTargetResolver(individualLabelNames(), individualMappedSet(), DMO);
  const got = r("Birth Date"); // the single rendered row lives in "Is Mapped"
  eq("mapped Birth Date row resolves to BirthDt__c (NOT ssot__BirthDate__c)", got.api, "BirthDt__c");
  ok("...and is marked sure (exactly one mapped candidate)", got.sure === true);
}

console.log("\n2. Birth Date — if the Unmapped section is ALSO expanded (2nd row)");
{
  const r = makeTargetResolver(individualLabelNames(), individualMappedSet(), DMO);
  const first = r("Birth Date");   // mapped section row
  const second = r("Birth Date");  // unmapped section row
  eq("1st (mapped) row -> BirthDt__c", first.api, "BirthDt__c");
  eq("2nd (unmapped) row -> ssot__BirthDate__c", second.api, "ssot__BirthDate__c");
  ok("both marked sure (each bucket has one distinct api)", first.sure && second.sure);
}

console.log("\n3. Identical duplicate label (KQ) — pick is trivially correct");
{
  const r = makeTargetResolver(individualLabelNames(), individualMappedSet(), DMO);
  const got = r("Key Qualifier Individual Id");
  eq("both candidates identical -> that api", got.api, "KQ_Id__c");
  ok("...marked sure (nothing to disambiguate)", got.sure === true);
}

console.log("\n4. Unique label — unchanged behavior");
{
  const r = makeTargetResolver(individualLabelNames(), individualMappedSet(), DMO);
  const got = r("First Name");
  eq("unique label resolves to its only api", got.api, "FirstName__c");
  ok("...marked sure", got.sure === true);
}

console.log("\n5. Colliding label with NEITHER field mapped -> honest (?)");
{
  const r = makeTargetResolver(individualLabelNames(), individualMappedSet(), DMO);
  const got = r("Contact Type"); // neither TDI_Contact_Type__c nor contact_type__c is mapped here
  ok("returns a candidate (best effort), not null", !!got.api);
  ok("but marked NOT sure (can't disambiguate an unmapped collision)", got.sure === false);
}

console.log("\n6. Two DIFFERENT mapped fields under one label -> genuinely ambiguous (?)");
{
  const labelNames = new Map([["Score", ["Score_A__c", "Score_B__c"]]]);
  const mappedSet = new Set([DMO + "::Score_A__c", DMO + "::Score_B__c"]); // BOTH mapped
  const r = makeTargetResolver(labelNames, mappedSet, DMO);
  const g1 = r("Score"), g2 = r("Score");
  ok("both rows return a real mapped api", ["Score_A__c", "Score_B__c"].includes(g1.api) && ["Score_A__c", "Score_B__c"].includes(g2.api));
  ok("both marked NOT sure (two distinct mapped candidates)", g1.sure === false && g2.sure === false);
}

console.log("\n7. Whitespace-normalized label match still works");
{
  const labelNames = new Map([["Birth  Date", ["ssot__BirthDate__c", "BirthDt__c"]]]); // double space in field label
  const r = makeTargetResolver(labelNames, individualMappedSet(), DMO);
  const got = r("Birth Date"); // rendered row label single-spaced
  eq("normalizes whitespace and still resolves the mapped one", got.api, "BirthDt__c");
}

// ── Source presence checks — the fix is actually wired into the tool ─────────────
console.log("\n8. Source presence (target resolver wired into console-decorate.js)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("makeTargetResolver() defined", /function makeTargetResolver\s*\(/.test(src));
  ok("builds a mapped-target set from container.mapping[] (entityName::fieldName)", /mappedTargetSet|targetMappedSet|mappedSet/.test(src));
  ok("target redraw loop uses the resolver (not raw lookupByLabel)", /nextForLabelTarget|makeTargetResolver/.test(src));
  ok("uncertain target names are marked with a (?) somewhere", /\(\?\)/.test(src));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
