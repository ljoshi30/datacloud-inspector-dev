// FULL/dev bookmarklet size-guard tests — run in Node.
//   node test/bookmarklet-size.test.js
//
// Mirrors the size-check logic in build.js (checkFullBookmarkletSize). The FULL
// bookmarklet's `javascript:` URL must stay under the 2 MB browser bookmark cap;
// warn at 75%. Only the FULL/dev bookmarklet is guarded (public sits ~19%).

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

const LIMIT = 2 * 1024 * 1024;          // 2,097,152
const WARN = Math.floor(LIMIT * 0.75);  // 1,572,864

// Mirror of build.js: classify a byte count into ok | warn | over.
// AT the limit counts as "over" — a bookmark URL exactly at the 2^21 cap is unsafe.
function classify(n) {
  if (n >= LIMIT) return "over";
  if (n >= WARN) return "warn";
  return "ok";
}

console.log("\n1. Thresholds classify correctly");
{
  ok("well under (400KB) -> ok", classify(400 * 1024) === "ok");
  ok("just under 75% -> ok", classify(WARN - 1) === "ok");
  ok("exactly 75% -> warn", classify(WARN) === "warn");
  ok("between 75% and 100% -> warn", classify(Math.floor(LIMIT * 0.9)) === "warn");
  ok("one byte under limit -> warn (not over)", classify(LIMIT - 1) === "warn");
  ok("exactly at limit -> over (hard fail — cap is unsafe)", classify(LIMIT) === "over");
  ok("one byte over -> over (hard fail)", classify(LIMIT + 1) === "over");
}

console.log("\n2. The ACTUAL current FULL bookmarklet is within limits");
{
  const fs = require("fs");
  const path = require("path");
  const p = path.join(__dirname, "..", "bookmarklet-full.txt");
  if (!fs.existsSync(p)) {
    ok("bookmarklet-full.txt present (run build.js first)", false, "missing — skipping size assertion");
  } else {
    const n = Buffer.byteLength(fs.readFileSync(p, "utf8"), "utf8");
    const cls = classify(n);
    ok("current FULL bookmarklet is NOT over the 2MB cap (" + n.toLocaleString() + " bytes, " + (n / LIMIT * 100).toFixed(1) + "%)", cls !== "over");
    // informational: flag if we've crossed into the warn band so the test log shows it
    if (cls === "warn") console.log("     note: FULL bookmarklet is past the 75% soft line — consider moving heavy features to @ext-only.");
  }
}

console.log("\n3. Source presence — build.js wires the FULL-only size guard");
{
  const fs = require("fs");
  const path = require("path");
  const b = fs.readFileSync(path.join(__dirname, "..", "build.js"), "utf8");
  ok("checkFullBookmarkletSize() defined in build.js", /checkFullBookmarkletSize/.test(b));
  ok("hard-fails at/over the 2MB cap", /n >= LIMIT[\s\S]{0,200}process\.exit\(1\)/.test(b));
  ok("warns at the 75% soft line", /0\.75/.test(b) && /WARNING/.test(b));
  ok("measures the FULL bookmarklet only (full.bm), not the public one",
    /Buffer\.byteLength\(full\.bm/.test(b));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
