#!/usr/bin/env node
/* Shared-code helper for the forked sources.
 *
 * The two sources must share identical code OUTSIDE @ext-only blocks:
 *   console-decorate.extension.js   = superset (shared core + @ext-only blocks)
 *   console-decorate.bookmarklet.js = shared core only (no @ext-only blocks)
 *
 * Usage:
 *   node sync-shared.js --check      Report whether the shared code matches (exit 1 if drift).
 *   node sync-shared.js --from-ext   Regenerate the bookmarklet source FROM the extension
 *                                    source by removing @ext-only blocks. Use this when a
 *                                    SHARED fix was made in console-decorate.extension.js and
 *                                    you want it mirrored into the bookmarklet source safely.
 *
 * IMPORTANT: --from-ext OVERWRITES console-decorate.bookmarklet.js with
 * (extension source minus @ext-only). That is correct ONLY when every shared change
 * lives in the extension source. If you edited the bookmarklet source directly,
 * copy that change into the extension source by hand first, then run --from-ext.
 */
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const EXT = path.join(dir, "console-decorate.extension.js");
const BM  = path.join(dir, "console-decorate.bookmarklet.js");

function stripExtOnly(src) {
  const re = /\/\* @ext-only:start[\s\S]*?@ext-only:end \*\//g;
  const out = src.replace(re, "/* [extension-only feature — not available in bookmarklet] */");
  if (/@ext-only:(start|end)/.test(out)) {
    console.error("ERROR: unbalanced/leftover @ext-only markers in extension source; fix before syncing.");
    process.exit(1);
  }
  return out;
}

const mode = process.argv[2] || "--check";
const extCode = fs.readFileSync(EXT, "utf8");
const shared = stripExtOnly(extCode);

if (mode === "--check") {
  const bm = fs.readFileSync(BM, "utf8");
  if (shared === bm) { console.log("✓ shared code matches (extension minus @ext-only == bookmarklet source)."); process.exit(0); }
  const a = shared.split("\n"), b = bm.split("\n");
  let ln = 0; const max = Math.min(a.length, b.length);
  while (ln < max && a[ln] === b[ln]) ln++;
  console.error("✗ DRIFT: shared code differs at ~line " + (ln + 1) + ".");
  console.error("    extension (minus ext-only): " + JSON.stringify((a[ln] || "").slice(0, 120)));
  console.error("    bookmarklet source        : " + JSON.stringify((b[ln] || "").slice(0, 120)));
  console.error("  If the fix lives in the extension source, run: node sync-shared.js --from-ext");
  process.exit(1);
} else if (mode === "--from-ext") {
  fs.writeFileSync(BM, shared);
  console.log("✓ Regenerated console-decorate.bookmarklet.js from the extension source (@ext-only removed).");
  console.log("  Run `node build.js` to rebuild + verify.");
} else {
  console.error("Unknown mode: " + mode + "\nUse --check or --from-ext.");
  process.exit(1);
}
