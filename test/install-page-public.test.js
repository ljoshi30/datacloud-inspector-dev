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

console.log("\n2. Dev-only 'Supported pages' tiles are gated behind includeDev");
{
  ok("devPageTiles is gated by includeDev", /devPageTiles\s*=\s*!includeDev\s*\?\s*""/.test(b));
  ok("devPageTiles carries Data Explorer / Segment / Query Editor / Data Transform",
    /devPageTiles[\s\S]{0,400}Data Explorer[\s\S]{0,200}Segment[\s\S]{0,200}Query Editor[\s\S]{0,200}Data Transform/.test(b));
  ok("the grid appends devPageTiles (not hardcoded 8 tiles)", /DMO Detail<\/strong>[\s\S]{0,120}\$\{devPageTiles\}/.test(b));
}

console.log("\n3. The forbidden list covers the stripped features + internal examples");
{
  ok("guards against a Segment tile", /<strong>Segment<\\?\/strong>/.test(b));
  ok("guards against Birth Date example", /birth\\?s\*date|birth\s*date/i.test(b));
  ok("guards against Account Number example", /account number/i.test(b));
}

console.log("\n4. The public MAPPING-canvas copy stays generic (no internal jargon)");
{
  // We deliberately do NOT advertise "Duplicate-label safe" — it's correctness, not a
  // feature, and naming it invites doubt. Make sure it didn't creep back in.
  ok("does not advertise 'Duplicate-label safe' on the page", !/Duplicate-label safe/.test(b));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
