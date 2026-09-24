// Public install-page accuracy guard — run in Node.
//   node test/install-page-public.test.js
//
// The public home page must advertise ONLY what the PUBLIC bookmarklet actually
// does. The public build strips Data Explorer, Segment, Query Editor, and Data
// Transform — so the page must not list those as supported pages/features, and must
// not leak internal example field names.
//
// The REAL enforcement is inline in build.js (verifyPublicHtmlAccuracy), which runs
// on the freshly-generated HTML string and aborts the build if anything forbidden
// appears. This test verifies that guard is wired up AND that the page generator
// gates the dev-only tiles/rows behind includeDev. (It checks build.js source, not a
// possibly-stale index.html, because the gate runs before index.html is written.)

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

const fs = require("fs");
const path = require("path");
const b = fs.readFileSync(path.join(__dirname, "..", "build.js"), "utf8");

console.log("\n1. build.js enforces public-page accuracy on the fresh HTML");
{
  ok("verifyPublicHtmlAccuracy() guard exists", /verifyPublicHtmlAccuracy/.test(b));
  ok("guard runs on the public pubHtml", /verifyPublicHtmlAccuracy\)\(pubHtml\)|\}\)\(pubHtml\)/.test(b));
  ok("guard aborts the build (process.exit) on a violation",
    /verifyPublicHtmlAccuracy[\s\S]{0,1600}process\.exit\(1\)/.test(b));
}

console.log("\n2. Dev-only accordion rows are gated behind includeDev");
{
  ok("devRows is gated by includeDev", /devRows\s*=\s*!includeDev\s*\?\s*""/.test(b));
  ok("devRows carries Data Model (ERD) / Segment / Data Explorer / Query Editor / Data Transform",
    /devRows[\s\S]{0,700}Data Model \(ERD\)[\s\S]{0,500}Segment[\s\S]{0,500}Data Explorer[\s\S]{0,500}Query Editor[\s\S]{0,500}Data Transform/.test(b));
  ok("body renders sharedRows + devRows accordion (not the old 3 sections)", /\$\{sharedRows\}\$\{devRows\}/.test(b));
  ok("old redundant sections removed (no 'Features by page' / 'Launcher menu' headings)",
    !/<h2>Features by page<\/h2>/.test(b) && !/<h2>Launcher menu<\/h2>/.test(b));
  ok("ERD is dev-only (not in the always-shared rows)", !/sharedRows[\s\S]{0,600}Data Model \(ERD\)/.test(b));
}

console.log("\n3. The forbidden list covers the stripped features + internal examples");
{
  ok("guards against a Segment accordion row", /acc-nm">Segment</.test(b));
  ok("guards against Data Model (ERD) leaking public", /Data Model \\\(ERD\\\)/.test(b));
  ok("guards against Birth Date example", /birth\\s\*date|birth\s*date/i.test(b));
  ok("guards against Account Number example", /account number/i.test(b));
}

console.log("\n4. The public MAPPING-canvas copy stays generic (no internal jargon)");
{
  // We deliberately do NOT advertise "Duplicate-label safe" — it's correctness, not a
  // feature, and naming it invites doubt. Make sure it didn't creep back in.
  ok("does not advertise 'Duplicate-label safe' on the page", !/Duplicate-label safe/.test(b));
}

console.log("\n5. Row-limit claims match the code (no false/guessed numbers)");
{
  // The old "bypasses SF's 2,000-row UI limit" was FALSE — 2,000 is our own render cap
  // (DC_MAX_RENDER_ROWS), not an SF UI limit. Must never return.
  ok("no false 'SF 2,000-row UI limit' claim", !/2,?000-row UI limit/.test(b));
  // Verified facts that SHOULD be present in the dev feature copy.
  ok("Query Editor grid cap stated as 1,000 rows (SF product UI)", /1,000 rows<\/b> the Query Editor grid/.test(b));
  ok("Explorer's 100-row own-view is stated", /own view loads 100 rows|loads only 100 rows|100 rows/.test(b));
  ok("CSV export cap stated as 500K (matches DC_MAX_TOTAL_EXPORT=500000)", /500K rows/.test(b));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
