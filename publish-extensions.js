#!/usr/bin/env node
/* Sync the built extension output into the two dedicated extension repos.
 *
 *   node build.js               # regenerates the chrome-extension + firefox-extension dirs
 *   node publish-extensions.js  # copies built output into the two repos below
 *
 * Two SEPARATE repos so multiple people can work on the extension without touching
 * the bookmarklet, and so the internal build never lands in a public repo:
 *   • DEV/INTERNAL (PRIVATE): chrome-extension/ + firefox-extension/  (FULL — AI +
 *     internal SF gateway). Must stay a PRIVATE GitHub repo.
 *   • PUBLIC (store-safe):    chrome-extension-public/ + firefox-extension-public/
 *
 * This copies files only; it does not commit/push (you review the diff, then commit
 * in each repo). Refuses to run if the public output still contains internal markers.
 */
const fs = require("fs");
const path = require("path");

const SRC = __dirname;
const HOME = process.env.HOME || require("os").homedir();

const TARGETS = [
  { label: "DEV (private)", repo: path.join(HOME, "datacloud-inspector-extension-dev"),
    chrome: "chrome-extension", firefox: "firefox-extension", internalOk: true },
  { label: "PUBLIC", repo: path.join(HOME, "datacloud-inspector-extension"),
    chrome: "chrome-extension-public", firefox: "firefox-extension-public", internalOk: false },
];

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (name === ".DS_Store") continue;
    const s = path.join(srcDir, name), d = path.join(destDir, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Guard: the public output must not carry internal-only code.
function assertNoInternal(dir) {
  const inj = path.join(dir, "inject.js");
  if (!fs.existsSync(inj)) return;
  const code = fs.readFileSync(inj, "utf8");
  ["function openSegmentExport", "function ensureExploreLauncher"].forEach((sym) => {
    if (code.includes(sym)) {
      console.error("ERROR: public extension inject.js still defines '" + sym + "' — refusing to publish. Rebuild with `node build.js`.");
      process.exit(1);
    }
  });
  const bg = path.join(dir, "background.js");
  if (fs.existsSync(bg) && /gateway|sf-gateway/i.test(fs.readFileSync(bg, "utf8"))) {
    console.error("ERROR: public extension background.js references an internal gateway — refusing to publish.");
    process.exit(1);
  }
}

let synced = 0;
for (const t of TARGETS) {
  if (!fs.existsSync(t.repo)) {
    console.warn("SKIP " + t.label + ": repo not found at " + t.repo);
    continue;
  }
  const chromeSrc = path.join(SRC, t.chrome);
  const firefoxSrc = path.join(SRC, t.firefox);
  if (!fs.existsSync(chromeSrc) || !fs.existsSync(firefoxSrc)) {
    console.warn("SKIP " + t.label + ": build output missing (run `node build.js` first).");
    continue;
  }
  if (!t.internalOk) { assertNoInternal(chromeSrc); assertNoInternal(firefoxSrc); }
  copyDir(chromeSrc, path.join(t.repo, "chrome"));
  copyDir(firefoxSrc, path.join(t.repo, "firefox"));
  synced++;
  console.log("Synced " + t.label + " -> " + t.repo + "  (chrome/ + firefox/)");
}
console.log(synced === TARGETS.length
  ? "\nDone. Review the diff in each repo, then commit + push."
  : "\nDone with warnings — some targets were skipped (see above).");
