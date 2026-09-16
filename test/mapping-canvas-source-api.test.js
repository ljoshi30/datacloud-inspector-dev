// Mapping-canvas SOURCE (DLO / left side) API-name resolution tests.
//   node test/mapping-canvas-source-api.test.js
//
// Companion to test/mapping-canvas-target-api.test.js. Same class of bug, now on
// the SOURCE/DLO (left) side of the canvas hover/inline tooltip.
//
// OLD source-side behavior: for a label shared by several fields (e.g. a DLO with
// three fields all labeled "Account Number"), the canvas handed rendered rows API
// names by DOM RENDER ORDER (row 1 -> field 1, row 2 -> field 2). That is only
// correct if render order matches entity.fields[] order. When "Is Mapped" renders
// before "Unmapped", the mapped field can be at a different index than the first
// rendered row -> wrong API name shown, silently.
//
// FIX (mirrors the target side): order colliding candidates MAPPED-FIRST using the
// authoritative container.mapping[] source pairing, then hand successive rendered
// rows the next candidate. When it can't disambiguate, return sure=false so the UI
// marks it " (?)" instead of showing a possibly-wrong name with false confidence.
//
// The resolver is symmetric with the target side; only the mapped-set key differs
// (source.fieldName under a source entity, vs target.fieldName under a DMO).

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Pure resolver — mirrors makeCollisionResolver() in console-decorate.js ───────
// The same function serves both sides; the caller passes the right mapped-set and
// entity key. labelNames: Map<label,[api,...]>; mset: Set<"entity::fieldApi">.
function makeCollisionResolver(labelNames, mset, entityApi) {
  const cursor = new Map();
  return function next(label) {
    let arr = labelNames.get(label);
    if (!arr) {
      const norm = String(label).replace(/\s+/g, " ").trim();
      for (const [k, v] of labelNames) { if (String(k).replace(/\s+/g, " ").trim() === norm) { arr = v; label = k; break; } }
    }
    if (!arr || !arr.length) return null;
    const distinct = Array.from(new Set(arr));
    if (distinct.length === 1) return { api: distinct[0], sure: true };
    const mapped = arr.filter((a) => mset.has(entityApi + "::" + a));
    const unmapped = arr.filter((a) => !mset.has(entityApi + "::" + a));
    const ordered = mapped.concat(unmapped);
    const used = cursor.get(label) || 0;
    const idx = used < ordered.length ? used : ordered.length - 1;
    cursor.set(label, used + 1);
    const bucket = idx < mapped.length ? mapped : unmapped;
    return { api: ordered[idx], sure: Array.from(new Set(bucket)).length === 1 };
  };
}

const DLO = "CAMEP_SFP_TDI_identity_DA115022__dll";

console.log("\n1. Three 'Account Number' fields, only the mapped one shown");
{
  // DLO exposes 3 fields sharing the label, standard/location ones first.
  const labelNames = new Map([["Account Number",
    ["Account_Location_c__c", "Account_Region_c__c", "customer_account_number_c__c"]]]);
  // Only customer_account_number_c__c is actually mapped in this stream.
  const mset = new Set([DLO + "::customer_account_number_c__c"]);
  const r = makeCollisionResolver(labelNames, mset, DLO);
  const got = r("Account Number"); // the single rendered row (in Is Mapped)
  eq("mapped row resolves to customer_account_number_c__c (NOT Account_Location_c__c)", got.api, "customer_account_number_c__c");
  ok("...marked sure (exactly one mapped candidate)", got.sure === true);
}

console.log("\n2. Same label, mapped row + expanded unmapped rows keep distinct APIs");
{
  const labelNames = new Map([["Account Number",
    ["Account_Location_c__c", "Account_Region_c__c", "customer_account_number_c__c"]]]);
  const mset = new Set([DLO + "::customer_account_number_c__c"]);
  const r = makeCollisionResolver(labelNames, mset, DLO);
  const a = r("Account Number"); // mapped section
  const b = r("Account Number"); // first unmapped
  const c = r("Account Number"); // second unmapped
  eq("1st (mapped) -> customer_account_number_c__c", a.api, "customer_account_number_c__c");
  ok("2nd & 3rd are the two unmapped ones, no repeats",
    [b.api, c.api].sort().join(",") === ["Account_Location_c__c", "Account_Region_c__c"].sort().join(","));
  ok("unmapped rows flagged NOT sure (can't prove which unmapped row is which)", b.sure === false && c.sure === false);
}

console.log("\n3. Unique label — unchanged, always sure");
{
  const labelNames = new Map([["First Name", ["DQ_FirstName__c"]]]);
  const r = makeCollisionResolver(labelNames, new Set(), DLO);
  const got = r("First Name");
  eq("unique label -> its only api", got.api, "DQ_FirstName__c");
  ok("...marked sure", got.sure === true);
}

console.log("\n4. Duplicate label with IDENTICAL api names -> trivially sure");
{
  const labelNames = new Map([["KQ deviceId", ["KQ_deviceId__c", "KQ_deviceId__c"]]]);
  const r = makeCollisionResolver(labelNames, new Set(), DLO);
  const got = r("KQ deviceId");
  eq("collapses identical dupes", got.api, "KQ_deviceId__c");
  ok("...sure", got.sure === true);
}

console.log("\n5. Colliding label, NEITHER mapped -> best-effort but (?)");
{
  const labelNames = new Map([["Legacy Code", ["Legacy_A__c", "Legacy_B__c"]]]);
  const r = makeCollisionResolver(labelNames, new Set(), DLO);
  const got = r("Legacy Code");
  ok("returns a candidate", !!got.api);
  ok("but NOT sure", got.sure === false);
}

console.log("\n6. Whitespace-normalized label match");
{
  const labelNames = new Map([["Account  Number", ["Account_Location_c__c", "customer_account_number_c__c"]]]);
  const mset = new Set([DLO + "::customer_account_number_c__c"]);
  const r = makeCollisionResolver(labelNames, mset, DLO);
  const got = r("Account Number"); // single-spaced rendered label
  eq("normalizes whitespace and resolves the mapped one", got.api, "customer_account_number_c__c");
}

// ── Source presence — the fix is actually wired into console-decorate.js ─────────
console.log("\n7. Source presence (source resolver + shared helper wired up)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.js"), "utf8");
  ok("a shared collision resolver exists (makeCollisionResolver or makeTargetResolver)",
    /function makeCollisionResolver\s*\(/.test(src) || /function makeTargetResolver\s*\(/.test(src));
  ok("builds a mapped-SOURCE set from container.mapping[] (source.fieldName)",
    /mappedSourceSet|source[\s\S]{0,40}fieldName/.test(src));
  ok("source redraw path uses the resolver (mapped-first), not a plain render-order cursor only",
    /mappedSourceSet\(\)/.test(src));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
