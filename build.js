/* Rebuilds shareable artifacts from console-decorate.js (the private source).
 *
 * TWO VARIANTS are produced from the SAME source:
 *   PUBLIC (shipped to GitHub Pages) — mapping + Data Stream + DLO + DMO only.
 *     Data Explorer + Segment code is PHYSICALLY REMOVED via @strip markers.
 *       - console-decorate.min.js : obfuscated paste version
 *       - bookmarklet.txt         : obfuscated javascript: one-liner
 *       - install.html            : drag-to-install page (this is pushed as index.html)
 *   FULL (local dev only — DO NOT push) — every feature, incl. in-dev ones.
 *       - console-decorate-full.min.js
 *       - bookmarklet-full.txt
 *       - install-full.html
 *   The chrome-extension gets the FULL source (local dev vehicle).
 *
 * Run:  node build.js
 *
 * Obfuscation note (honest): browser JS can't be truly hidden — it runs in the
 * user's browser, so it can always be recovered. This only DETERS casual copying.
 * The @strip mechanism is different: it removes the in-dev code from the public
 * payload ENTIRELY, so those features are not recoverable from what's shipped.
 * Keep console-decorate.js private.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dir = __dirname;
const fullCode = fs.readFileSync(path.join(dir, "console-decorate.js"), "utf8");

// Short build id = hash of a payload string. Embedded in install pages so the page
// can tell the user (via localStorage) when the code actually changed → re-drag needed.
function buildIdOf(payload) { return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12); }

// ---- strip in-development sections for the public build ----
// Removes every /* @strip:start ... */ ... /* @strip:end */ block.
function stripDev(src) {
  const re = /\/\* @strip:start[\s\S]*?@strip:end \*\//g;
  const out = src.replace(re, "/* [in-development features removed from public build] */");
  if (/@strip:(start|end)/.test(out)) {
    console.error("ERROR: unbalanced or leftover @strip markers after stripping; aborting.");
    process.exit(1);
  }
  return out;
}

const publicCode = stripDev(fullCode);

// sanity: stripping must have removed a meaningful amount of code
if (publicCode.length >= fullCode.length) {
  console.error("ERROR: stripDev removed nothing — check @strip markers; aborting.");
  process.exit(1);
}
// sanity: stripped code must still be syntactically valid JS (compile without running)
try { new Function(publicCode); } catch (e) {
  console.error("ERROR: public (stripped) code has a syntax error: " + e.message + "; aborting.");
  process.exit(1);
}
// sanity: no in-dev entry points survive in the public code
["openSegmentExport", "ensureExploreLauncher", "openExploreModal", "readSegmentRules"].forEach(sym => {
  if (new RegExp("function\\s+" + sym + "\\b").test(publicCode)) {
    console.error("ERROR: in-dev function '" + sym + "' still defined in public build; aborting.");
    process.exit(1);
  }
});

// ---- obfuscation payload builder ----
// realCode -> encodeURIComponent -> base64 (no % / no quotes / no backslash).
// Runtime loader decodes in reverse and evals. atob() means NO percent signs in
// the payload, avoiding the double-decode trap on javascript: URLs.
function makePayload(code, label) {
  const enc = encodeURIComponent(code);
  const b64 = Buffer.from(enc, "latin1").toString("base64");
  const loader = 'eval(decodeURIComponent(atob("' + b64 + '")))';
  const roundtrip = decodeURIComponent(Buffer.from(b64, "base64").toString("latin1"));
  if (roundtrip !== code) {
    console.error("ERROR [" + label + "]: obfuscated payload does not round-trip; aborting.");
    process.exit(1);
  }
  if (/[%"'\\<>]/.test(b64)) {
    console.error("ERROR [" + label + "]: unexpected char in base64 payload; aborting.");
    process.exit(1);
  }
  const bm = "javascript:" + encodeURIComponent(loader);
  if (decodeURIComponent(bm.replace(/^javascript:/, "")) !== loader) {
    console.error("ERROR [" + label + "]: bookmarklet does not decode to the loader; aborting.");
    process.exit(1);
  }
  const hrefSafe = bm.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { b64, loader, bm, hrefSafe };
}

// ---- install.html builder (feature list gated by includeDev) ----
function makeHtml(hrefSafe, includeDev, buildId) {
  const heroBlurb = includeDev
    ? `Floating toolkit for Salesforce Data Cloud &mdash; reveals API names on the mapping canvas, exports DLO/DMO/Data&nbsp;Stream fields, and exports segment rules to Sheets or Excel. Works on every Data 360 page type.`
    : `Floating toolkit for Salesforce Data Cloud &mdash; reveals API names on the DLO&rarr;DMO mapping canvas and exports Data&nbsp;Stream, DLO, and DMO fields to Sheets, CSV, or Excel.`;

  // In-development feature sections — only rendered in the FULL build.
  const devFeatureSections = !includeDev ? "" : `
    <h3>&#127937; Segment pages</h3>
    <ul>
      <li><span class="pill">Export Rules</span> &mdash; reads all segment conditions live from the canvas across <strong>Include</strong>, <strong>Exclude</strong>, and <strong>Rank &amp; Limit</strong> tabs</li>
      <li><strong>Copy for Sheets</strong> &mdash; rich HTML table with group structure, AND/OR joiners, and sub-filters; pastes into Google Sheets or Excel with full formatting</li>
      <li><strong>Download HTML</strong> &mdash; saves a self-contained file that opens in Excel or Sheets with colours, groups, and a metadata footer</li>
    </ul>

    <h3>&#128202; Data Explorer (DLO / DMO query view)</h3>
    <ul>
      <li><span class="pill">Columns</span> &mdash; opens the Column Selector showing <strong>all available fields</strong> for the object, not just the handful SF shows by default</li>
      <li><strong>Available tab</strong> &mdash; search fields by name or label, sort A&rarr;Z / Z&rarr;A, select all / deselect all</li>
      <li><strong>Column Order tab</strong> &mdash; drag rows to reorder your selected columns before applying</li>
      <li><strong>Apply columns</strong> &mdash; applies your selection; SF re-fetches data for those columns (max 10 shown &mdash; Data Cloud limit)</li>
      <li><strong>Save / Restore / Clear set</strong> &mdash; persists your selection per object per org (90-day TTL)</li>
      <li><strong>Export CSV</strong> &mdash; downloads all visible rows as a CSV with the current column set</li>
      <li><span class="pill">Edit SOQL</span> &mdash; dark SOQL editor with syntax highlighting and inline field autocomplete; copy the query to run in Developer Console</li>
    </ul>
    <div class="note">
      <strong>Note:</strong> Data Cloud's Data Explorer displays at most 10 columns at once. The SOQL editor can list every field for copying into Developer Console / Workbench, but only 10 apply to the live table.
    </div>`;

  // Roadmap — shown only in the PUBLIC build, since these are the in-dev features
  // that were stripped out. In the FULL build they already exist, so no roadmap.
  const roadmapSection = includeDev ? "" : `
  <div class="card">
    <h2>&#128736;&#65039; Roadmap &mdash; coming soon</h2>
    <p style="font-size:13px;color:var(--muted);margin:0 0 12px">Features currently in development and rolling out in upcoming versions.</p>
    <table>
      <thead><tr><th>Feature</th><th>What it will do</th></tr></thead>
      <tbody>
        <tr><td><strong>Segment rule export</strong></td><td>Capture the full <strong>criteria used in a segment</strong> &mdash; Include / Exclude conditions, AND/OR logic, and Rank &amp; Limit &mdash; exported to Sheets or Excel.</td></tr>
        <tr><td><strong>Data Explorer &mdash; Columns</strong></td><td>Add and reorder fields to view <strong>all available columns</strong> in the Data Explorer &mdash; beyond the default set SF shows &mdash; with save / restore of your column selections and a built-in SOQL editor.</td></tr>
      </tbody>
    </table>
    <div class="note">Have a request? Reach out &mdash; feedback shapes what ships next.</div>
  </div>`;

  // Launcher-menu rows that belong to in-dev features.
  const devMenuRows = !includeDev ? "" : `
        <tr><td><strong>Export Rules</strong></td><td>Segment pages</td><td>Opens the segment rules export with Include / Exclude / Rank &amp; Limit tabs</td></tr>
        <tr><td><strong>Columns</strong></td><td>Data Explorer</td><td>Opens Column Selector &mdash; pick &amp; reorder fields, apply, save/restore, export CSV, open SOQL Editor</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Data 360 Inspector — Install</title>
<link rel="icon" type="image/png" href="favicon.png">
<link rel="icon" type="image/x-icon" href="favicon.ico">
<style>
  :root{--blue:#0d6efd;--dark:#1e3a5f;--ink:#16325c;--muted:#5c6b8a;--line:#e0e5ee;--bg:#f3f6fb;--green:#0a6b2d;--greenbg:#d4f0db}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#f7f9fc}
  .wrap{max-width:860px;margin:0 auto;padding:36px 24px 72px}
  .hero{background:linear-gradient(135deg,var(--dark) 0%,var(--blue) 100%);border-radius:16px;padding:32px 32px 28px;margin-bottom:24px;color:#fff}
  .hero h1{font-size:28px;margin:0 0 8px;font-weight:800;letter-spacing:-.02em}
  .hero p{margin:0;font-size:14px;opacity:.85;max-width:580px;line-height:1.55}
  .badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 10px;border-radius:12px;margin-bottom:12px}
  .badge.rec{background:rgba(255,255,255,.2);color:#fff}
  .badge.tip{background:var(--bg);color:var(--blue)}
  .card{border:1px solid var(--line);border-radius:12px;padding:22px 26px;margin:16px 0;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.05)}
  .card.rec{border-color:#93c5fd;box-shadow:0 2px 14px rgba(13,110,253,.1)}
  .card h2{margin:0 0 6px;font-size:17px;color:var(--ink)}
  .card h3{margin:14px 0 6px;font-size:14px;font-weight:700;color:var(--dark)}
  .bm{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,var(--dark),var(--blue));color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:24px;box-shadow:0 3px 12px rgba(13,110,253,.35);cursor:grab;user-select:none;transition:opacity .15s}
  .bm:hover{opacity:.88}.bm:active{cursor:grabbing}
  ol,ul{padding-left:22px}li{margin:7px 0}
  kbd{font:12px "SF Mono",Menlo,monospace;background:#eef1f6;border:1px solid #d6dbe6;border-radius:4px;padding:1px 6px}
  .note{font-size:13px;color:var(--muted);background:var(--bg);border-radius:8px;padding:11px 15px;margin-top:14px;line-height:1.5}
  code{font:12px "SF Mono",Menlo,monospace;background:#eef1f6;padding:1px 5px;border-radius:4px}
  .feat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .feat{background:var(--bg);border-radius:10px;padding:14px 16px}
  .feat .icon{font-size:20px;margin-bottom:6px}
  .feat strong{display:block;font-size:13px;color:var(--ink);margin-bottom:3px}
  .feat span{font-size:12px;color:var(--muted);line-height:1.5}
  .pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px;background:#edf4ff;color:var(--blue);margin-right:4px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
  th{text-align:left;padding:7px 10px;background:var(--bg);color:var(--muted);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line)}
  td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:none}
  @media(max-width:600px){.feat-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">

  <!-- Update banner: this page remembers (in localStorage) the build you last added.
       When the embedded build id changes, it shows a "re-drag needed" notice. This
       page opens in a normal tab (NOT Salesforce), so localStorage is unrestricted. -->
  <div id="dc-update-banner" style="display:none;border-radius:12px;padding:14px 18px;margin-bottom:18px;font-size:14px;line-height:1.5;border:1px solid #f0c36d;background:#fff8e6;color:#5c4a00">
    <div style="display:flex;align-items:flex-start;gap:12px">
      <span style="font-size:18px;line-height:1.2">&#128260;</span>
      <div style="flex:1">
        <strong id="dc-update-title">The bookmarklet was updated since you last added it.</strong>
        <div id="dc-update-sub" style="margin-top:3px;color:#7a6410">Delete your old <em>Data 360 Inspector</em> bookmark, then drag the button below again to get the latest version.</div>
      </div>
      <button id="dc-update-ok" style="flex-shrink:0;border:1px solid #d9a520;background:#fff;color:#5c4a00;border-radius:8px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer">I re-added it</button>
    </div>
  </div>

  <div class="hero">
    <div class="badge rec">&#9679; Read-only &nbsp;&middot;&nbsp; Nothing leaves your browser</div>
    <h1>Data 360 Inspector</h1>
    <p>${heroBlurb}</p>
  </div>

  <div class="card rec">
    <div class="badge tip">No install &middot; works in any browser</div>
    <h2>Add the bookmarklet</h2>
    <ol>
      <li>Show your <strong>bookmarks bar</strong>: <kbd>&#8984;&#8679;B</kbd> on Mac &nbsp;/&nbsp; <kbd>Ctrl&#8679;B</kbd> on Windows.</li>
      <li><strong>Drag</strong> this button to your bookmarks bar:&nbsp;&nbsp;
        <a class="bm" href="${hrefSafe}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="4" r="1.2" fill="currentColor"/><circle cx="17.7" cy="6.3" r="1.2" fill="currentColor"/><circle cx="20" cy="12" r="1.2" fill="currentColor"/><circle cx="17.7" cy="17.7" r="1.2" fill="currentColor"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/><circle cx="6.3" cy="17.7" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="6.3" cy="6.3" r="1.2" fill="currentColor"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/><path d="M8 16.5c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          Data 360 Inspector
        </a>
      </li>
      <li>Open any Data Cloud / Data 360 page in Salesforce and <strong>click the bookmark</strong>. A blue circle with a magnifying-glass icon appears in the bottom-right corner &mdash; click it to open the action menu.</li>
      <li>Click the bookmark again at any time to remove the tool.</li>
    </ol>
    <div class="note">The launcher sits in the bottom-right corner and never overlaps the Salesforce navigation. Click the purple circle button to expand the menu; click outside or click it again to collapse.</div>
  </div>

  <div class="card">
    <h2>Features by page</h2>

    <h3>&#128257; DLO &rarr; DMO Mapping canvas</h3>
    <ul>
      <li><span class="pill">API Tooltip</span> &mdash; hover any field to see its API name in a tooltip; click to copy to clipboard</li>
      <li><span class="pill">Pin API names</span> &mdash; pins all API names directly on the canvas at once; click <strong>Unpin names</strong> to clear</li>
      <li><span class="pill">Export</span> &mdash; full DLO&rarr;DMO mapping table filterable by DMO &middot; <strong>Copy for Sheets</strong> or <strong>Download CSV</strong></li>
    </ul>

    <h3>&#127760; Data Stream &amp; DLO detail pages</h3>
    <ul>
      <li><span class="pill">Export Fields</span> &mdash; all fields with API name, label, data type, status, and key qualifier &middot; <strong>Copy for Sheets</strong> or <strong>Download CSV</strong></li>
    </ul>

    <h3>&#127760; DMO detail pages</h3>
    <ul>
      <li><span class="pill">Export Fields</span> &mdash; <strong>Fields</strong> tab (API name, type, mapped status, key qualifier) and <strong>Relationships</strong> tab (related objects and join fields) &middot; <strong>Copy for Sheets</strong> or <strong>Download XLS</strong></li>
    </ul>
${devFeatureSections}
    <p style="font-size:12px;color:var(--muted);margin:10px 0 0">All modals are draggable (grab the header) and resizable (drag the bottom-right corner).</p>
  </div>

  <div class="card">
    <h2>Launcher menu</h2>
    <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Click the blue launcher button (bottom-right corner) to open the menu. Only buttons relevant to the current page are shown.</p>
    <table>
      <thead><tr><th>Button</th><th>Page</th><th>What it does</th></tr></thead>
      <tbody>
        <tr><td><strong>API Tooltip</strong></td><td>Mapping canvas</td><td>Hover tooltip showing API name; click field to copy. Turns blue when active.</td></tr>
        <tr><td><strong>Pin API names</strong></td><td>Mapping canvas</td><td>Pins all API names on the canvas; button changes to <strong>Unpin names</strong> when active.</td></tr>
        <tr><td><strong>Export</strong></td><td>Mapping canvas</td><td>Opens the full mapping export modal</td></tr>
        <tr><td><strong>Export Fields</strong></td><td>DLO / Data Stream / DMO</td><td>Opens the field export modal</td></tr>${devMenuRows}
        <tr><td><strong>Remove</strong></td><td>All pages</td><td>Removes the tool from the page</td></tr>
      </tbody>
    </table>
  </div>
${roadmapSection}
  <div class="card">
    <h2>Privacy &amp; safety</h2>
    <ul>
      <li>Runs entirely in your browser tab using data the page has already loaded.</li>
      <li>No API calls, no network requests, no data sent anywhere.</li>
      <li>Nothing is stored &mdash; the tool disappears when you close or reload the tab.</li>
      <li>Read-only: it never modifies your Salesforce data.</li>
    </ul>
  </div>

</div>
<script>
(function(){
  // Build id embedded at build time = hash of the actual bookmarklet payload, so it
  // changes ONLY when the code really changed (not on a no-op rebuild).
  var BUILD_ID = ${JSON.stringify(buildId || "")};
  var KEY = "dc-inspector-installed-build";
  var banner = document.getElementById("dc-update-banner");
  var okBtn  = document.getElementById("dc-update-ok");
  var title  = document.getElementById("dc-update-title");
  var sub    = document.getElementById("dc-update-sub");
  if (!banner || !BUILD_ID) return;
  var seen;
  try { seen = localStorage.getItem(KEY); } catch(e) { seen = null; }
  if (seen === BUILD_ID) return;                    // already on the latest — no nag
  if (seen) {                                       // had an older build → re-drag needed
    banner.style.display = "block";
  } else {                                          // first visit — gentle first-time hint
    title.textContent = "First time here? Add the bookmarklet below.";
    sub.textContent   = "Drag the button to your bookmarks bar. This page will let you know whenever a newer version is available.";
    banner.style.display = "block";
  }
  if (okBtn) okBtn.onclick = function(){
    try { localStorage.setItem(KEY, BUILD_ID); } catch(e){}
    banner.style.display = "none";
  };
})();
</script>
</body>
</html>`;
}

// verify an install.html's embedded bookmarklet still decodes to the loader
function verifyHtml(html, loader, label) {
  const m = html.match(/href="(javascript:[^"]*)"/);
  if (!m) { console.error("ERROR [" + label + "]: no bookmarklet href found in html; aborting."); process.exit(1); }
  const hrefRaw = m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  if (decodeURIComponent(hrefRaw.replace(/^javascript:/, "")) !== loader) {
    console.error("ERROR [" + label + "]: install html bookmarklet does not decode to the loader; aborting.");
    process.exit(1);
  }
}

// ═══ PUBLIC build (shipped to GitHub Pages) ═══
const pub = makePayload(publicCode, "public");
fs.writeFileSync(path.join(dir, "console-decorate.min.js"), pub.loader + "\n");
fs.writeFileSync(path.join(dir, "bookmarklet.txt"), pub.bm);
const pubHtml = makeHtml(pub.hrefSafe, false, buildIdOf(pub.b64));
verifyHtml(pubHtml, pub.loader, "public");
fs.writeFileSync(path.join(dir, "install.html"), pubHtml);

// ═══ FULL build (local dev only — DO NOT push) ═══
const full = makePayload(fullCode, "full");
fs.writeFileSync(path.join(dir, "console-decorate-full.min.js"), full.loader + "\n");
fs.writeFileSync(path.join(dir, "bookmarklet-full.txt"), full.bm);
const fullHtml = makeHtml(full.hrefSafe, true, buildIdOf(full.b64));
verifyHtml(fullHtml, full.loader, "full");
fs.writeFileSync(path.join(dir, "install-full.html"), fullHtml);
// Also write the internal-named copy people actually drag the bookmarklet from.
// Same document as install-full.html; kept in sync so the bookmarklet is never stale.
fs.writeFileSync(path.join(dir, "Data360-Inspector-FULL-internal.html"), fullHtml);
// index.html = GitHub Pages entry point for the dev repo (ljoshi30.github.io/datacloud-inspector-dev)
fs.writeFileSync(path.join(dir, "index.html"), fullHtml);

// ---- extensions: FULL source, built for BOTH Chrome and Firefox ----
// The extension is the FULL build (includes in-dev Explorer + Segment). We keep
// ONE source of truth for the shared files (inject.js, background.js, icons,
// bookmarklet.txt) and emit a browser-specific manifest for each target.
const extDir = path.join(dir, "chrome-extension");     // Chrome (source of shared files)
const ffDir  = path.join(dir, "firefox-extension");    // Firefox (generated)

// Auto-bump the extension patch version, but ONLY when the injected code actually
// changed since the last build — so Chrome Web Store / AMO see a new version to
// roll out, without churning the number on no-op rebuilds. The build id (hash of
// the full code) is stamped next to the manifest; if it matches, version holds.
function bumpVersionIfCodeChanged(manifestPath, codeHash) {
  const mf = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const stampPath = path.join(extDir, ".buildid");
  let prevHash = "";
  try { prevHash = fs.readFileSync(stampPath, "utf8").trim(); } catch (e) {}
  if (prevHash !== codeHash) {
    const parts = String(mf.version || "1.0.0").split(".").map((n) => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    parts[2] += 1;                                     // bump patch
    mf.version = parts.join(".");
    fs.writeFileSync(manifestPath, JSON.stringify(mf, null, 2) + "\n");
    fs.writeFileSync(stampPath, codeHash + "\n");
    console.log("  extension version bumped -> " + mf.version + " (code changed)");
  } else {
    console.log("  extension version held at " + mf.version + " (no code change)");
  }
  return mf.version;
}

let extVersion = "";
if (fs.existsSync(extDir)) {
  // 1) sync shared files into the Chrome dir
  fs.writeFileSync(path.join(extDir, "inject.js"), fullCode);
  if (fs.readFileSync(path.join(extDir, "inject.js"), "utf8") !== fullCode) {
    console.error("ERROR: chrome-extension/inject.js did not match full source; aborting.");
    process.exit(1);
  }
  // NOTE: bookmarklet.txt is intentionally NOT bundled into the extension anymore
  // (the auto-install-bookmark feature was removed for store compliance — no
  // bookmarks permission, no web_accessible_resources). Remove any stale copy.
  try { fs.unlinkSync(path.join(extDir, "bookmarklet.txt")); } catch (e) {}

  // 2) version bump (shared across both browser builds)
  const chromeManifestPath = path.join(extDir, "manifest.json");
  extVersion = bumpVersionIfCodeChanged(chromeManifestPath, buildIdOf(fullCode));

  // 3) generate the Firefox variant from the SAME shared files
  const chromeManifest = JSON.parse(fs.readFileSync(chromeManifestPath, "utf8"));
  // Firefox MV3 differences vs Chrome:
  //  - background uses `scripts`, not `service_worker`
  //  - MAIN-world scripting.executeScript requires Firefox 128+
  //  - needs a browser_specific_settings.gecko id + strict_min_version
  const ffManifest = JSON.parse(JSON.stringify(chromeManifest));
  ffManifest.background = { scripts: ["background.js"] };
  ffManifest.browser_specific_settings = {
    gecko: { id: "data360-inspector@ljoshi30", strict_min_version: "128.0" }
  };
  try { fs.mkdirSync(ffDir, { recursive: true }); } catch (e) {}
  // copy shared files verbatim
  for (const f of ["inject.js", "background.js", "bridge.js"]) {
    fs.copyFileSync(path.join(extDir, f), path.join(ffDir, f));
  }
  // icons
  const ffIcons = path.join(ffDir, "icons"); try { fs.mkdirSync(ffIcons, { recursive: true }); } catch (e) {}
  const chIcons = path.join(extDir, "icons");
  if (fs.existsSync(chIcons)) for (const ic of fs.readdirSync(chIcons)) fs.copyFileSync(path.join(chIcons, ic), path.join(ffIcons, ic));
  // Firefox manifest
  fs.writeFileSync(path.join(ffDir, "manifest.json"), JSON.stringify(ffManifest, null, 2) + "\n");
}

console.log("Built PUBLIC (stripped — mapping + Data Stream + DLO + DMO):");
console.log("  install.html               (" + pubHtml.length + " bytes)  ← push this as index.html");
console.log("  console-decorate.min.js    (" + pub.loader.length + " chars, base64 " + pub.b64.length + ")");
console.log("  bookmarklet.txt            (" + pub.bm.length + " chars)");
console.log("  public source: " + publicCode.length + " chars  (full: " + fullCode.length + " chars, stripped " + (fullCode.length - publicCode.length) + ")");
console.log("Built FULL (local dev only — DO NOT push):");
console.log("  install-full.html          (" + fullHtml.length + " bytes)");
console.log("  Data360-Inspector-FULL-internal.html  (same doc — drag bookmarklet from here)");
console.log("  console-decorate-full.min.js / bookmarklet-full.txt");
if (fs.existsSync(extDir)) {
  console.log("  chrome-extension/  (Chrome MV3, v" + extVersion + ", inject.js = FULL source)");
  console.log("  firefox-extension/ (Firefox MV3, v" + extVersion + ", generated; needs FF 128+)");
}
console.log("Round-trip + browser-decode + syntax + strip-symbol checks all verified.");
console.log("NOTE: obfuscation only DETERS copying; the @strip mechanism PHYSICALLY removes in-dev code from the public payload. Keep console-decorate.js private.");
