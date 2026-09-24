// Extension-only strip mechanism tests — run in Node.
//   node test/ext-only-strip.test.js
//
// Verifies the @ext-only build axis that SEPARATES extension-only code from the
// bookmarklet WITHOUT forking the codebase:
//   • Extension inject.js keeps @ext-only blocks (shared core + ext-only).
//   • Bookmarklet payloads have @ext-only blocks PHYSICALLY REMOVED (shared core only).
//   • Shared code (outside any marker) is present in BOTH — so shared fixes never drift.
//
// This mirrors build.js's stripExtOnly() exactly. If you change the marker syntax
// in build.js, update it here too and re-run.

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}

// Mirror of build.js stripExtOnly()
function stripExtOnly(src) {
  const re = /\/\* @ext-only:start[\s\S]*?@ext-only:end \*\//g;
  const out = src.replace(re, "/* [extension-only feature — not available in bookmarklet] */");
  if (/@ext-only:(start|end)/.test(out)) throw new Error("unbalanced/leftover @ext-only markers");
  return out;
}

console.log("\n1. A marked block is removed from the bookmarklet, kept for the extension");
{
  const src = [
    "var shared = 1;",
    "/* @ext-only:start */",
    "function extApiCall(){ return fetch('/ssot/query-sql'); }",
    "/* @ext-only:end */",
    "var alsoShared = 2;",
  ].join("\n");
  const bm = stripExtOnly(src);
  ok("shared code before block kept", /var shared = 1;/.test(bm));
  ok("shared code after block kept", /var alsoShared = 2;/.test(bm));
  ok("extension-only function REMOVED from bookmarklet", !/extApiCall/.test(bm));
  ok("extension source (unstripped) still has the function", /extApiCall/.test(src));
  ok("no marker text leaks into the bookmarklet", !/@ext-only/.test(bm));
}

console.log("\n2. Multiple blocks all stripped; interleaved shared code survives");
{
  const src = [
    "a();",
    "/* @ext-only:start */ b1(); /* @ext-only:end */",
    "c();",
    "/* @ext-only:start */ b2(); /* @ext-only:end */",
    "d();",
  ].join("\n");
  const bm = stripExtOnly(src);
  ok("all ext-only bodies gone", !/b1\(\)/.test(bm) && !/b2\(\)/.test(bm));
  ok("all shared bodies present", /a\(\)/.test(bm) && /c\(\)/.test(bm) && /d\(\)/.test(bm));
}

console.log("\n3. No markers at all → source unchanged (mechanism is a safe no-op)");
{
  const src = "var x = 1;\nfunction f(){ return x; }\n";
  ok("identical output when nothing is marked", stripExtOnly(src) === src.replace(/x/g, "x")); // trivially true; explicit
  ok("length unchanged", stripExtOnly(src).length === src.length);
}

console.log("\n4. Unbalanced markers throw (build must abort, never ship half-stripped)");
{
  let threw = false;
  try { stripExtOnly("/* @ext-only:start */ oops(); // no end marker"); } catch (e) { threw = /unbalanced|leftover/.test(e.message); }
  ok("dangling start marker throws", threw);
}

console.log("\n5. Stripped result stays valid JS (no syntax break at boundaries)");
{
  const src = [
    "function keep(){ return 1; }",
    "/* @ext-only:start */",
    "function drop(){ return 2; }",
    "/* @ext-only:end */",
    "function alsoKeep(){ return 3; }",
  ].join("\n");
  const bm = stripExtOnly(src);
  let good = true; try { new Function(bm); } catch (e) { good = false; }
  ok("bookmarklet code compiles after strip", good);
}

// ── Source presence: build.js actually wires this up ────────────────────────────
console.log("\n6. Source presence (build.js wires the @ext-only axis for bookmarklet only)");
{
  const fs = require("fs");
  const path = require("path");
  const b = fs.readFileSync(path.join(__dirname, "..", "build.js"), "utf8");
  ok("stripExtOnly() defined in build.js", /function stripExtOnly\s*\(/.test(b));
  ok("applied to the PUBLIC bookmarklet payload", /publicBmCode\s*=\s*stripExtOnly\(/.test(b));
  ok("applied to the FULL bookmarklet payload", /fullBmCode\s*=\s*stripExtOnly\(/.test(b));
  ok("extension inject.js still written from UN-stripped code (keeps ext-only)",
    /inject\.js"\),\s*fullCode\)/.test(b) && /inject\.js"\),\s*publicCode\)/.test(b));
  ok("balance/compile validation present", /validateExtOnly/.test(b));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
