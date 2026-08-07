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
// Read current version from manifest (used in install page display)
const _mfVer = (function() { try { return JSON.parse(fs.readFileSync(path.join(dir, "chrome-extension/manifest.json"), "utf8")).version; } catch(e) { return "dev"; } })();

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
    ? `All-in-one toolkit for Salesforce Data Cloud &mdash; mapping canvas API names, field exports, Data Explorer with unlimited row export, Query Editor with full pagination, segment rule extraction, and data transform viewer. Page-aware: only activates on supported pages.`
    : `Floating toolkit for Salesforce Data Cloud &mdash; reveals API names on the DLO&rarr;DMO mapping canvas and exports Data&nbsp;Stream, DLO, and DMO fields to Sheets, CSV, or Excel.`;

  // In-development feature sections — only rendered in the FULL build.
  const devFeatureSections = !includeDev ? "" : `
    <h3>&#127937; Segment pages</h3>
    <ul>
      <li><span class="pill">Export Rules</span> &mdash; reads all segment conditions live from the canvas across <strong>Include</strong>, <strong>Exclude</strong>, and <strong>Rank &amp; Limit</strong> tabs</li>
      <li><strong>Copy for Sheets</strong> &mdash; rich HTML table with group structure, AND/OR joiners, and sub-filters; pastes into Google Sheets or Excel with full formatting</li>
      <li><strong>Download HTML</strong> &mdash; saves a self-contained file that opens in Excel or Sheets with colours, groups, and a metadata footer</li>
    </ul>

    <h3>&#128202; Data Explorer (DLO / DMO / any Data Cloud object)</h3>
    <ul>
      <li><span class="pill">Columns</span> &mdash; opens the Column Selector showing <strong>all available fields</strong> for the object, not just the handful SF shows by default</li>
      <li><strong>Available tab</strong> &mdash; search fields by name or label, sort A&rarr;Z / Z&rarr;A, select all / deselect all</li>
      <li><strong>Column Order tab</strong> &mdash; drag rows to reorder your selected columns before applying</li>
      <li><strong>Apply columns</strong> &mdash; applies your selection and loads data with a live query</li>
      <li><strong>Save / Restore / Clear set</strong> &mdash; persists your selection per object per org (90-day TTL)</li>
      <li><strong>True row count</strong> &mdash; shows the real total rows in the table (e.g. &ldquo;Total: 117,204 rows&rdquo;) regardless of how many are loaded in the view</li>
      <li><span class="pill new">Export All</span> &mdash; fetches <strong>ALL rows</strong> from the server (up to 500k) as a paginated CSV download, with live progress. No row-count cap.</li>
      <li><strong>Download CSV (loaded rows)</strong> &mdash; instantly downloads the currently loaded rows as CSV</li>
      <li><strong>Filter bar</strong> &mdash; multi-condition filter (AND/OR) with type-aware controls (text/number/date/boolean). Runs server-side WHERE clause.</li>
      <li><strong>Hide empty columns</strong> &mdash; toggle to hide columns that have no data in the loaded rows</li>
      <li><span class="pill">Edit SQL</span> &mdash; opens SQL editor prepopulated with the current query; edit and re-run directly</li>
    </ul>

    <h3>&#128270; Query Editor (SQL workspace)</h3>
    <ul>
      <li><span class="pill new">Run &amp; Export</span> &mdash; run <strong>any</strong> highlighted SQL query and export the full result as CSV &mdash; bypasses Salesforce&rsquo;s 2,000-row UI limit</li>
      <li><strong>Full pagination</strong> &mdash; automatically fetches all result pages (up to 500k rows) with a live progress bar</li>
      <li><strong>Smart selection</strong> &mdash; select with mouse OR Cmd+A / Ctrl+A; falls back to the full editor content when nothing is highlighted</li>
      <li><strong>Auto-retry dataspace</strong> &mdash; if the detected dataspace is wrong, automatically tries candidate dataspaces until one works</li>
      <li><strong>Meaningful errors</strong> &mdash; actionable messages for &ldquo;denied authorization&rdquo;, session expired, timeout, and connection issues</li>
    </ul>

    <h3>&#9881;&#65039; Data Transform pages</h3>
    <ul>
      <li><span class="pill">View Definition</span> &mdash; reads the full transform definition (batch = node graph, streaming = SQL) and renders it in a collapsible tree view</li>
      <li><strong>Copy JSON</strong> &mdash; copies the raw API response to clipboard for documentation or comparison</li>
    </ul>

    <div class="note">
      <strong>Extension vs Bookmarklet:</strong> The browser extension enables full pagination (fetches ALL rows via the documented <code>/ssot/query-sql</code> API). The bookmarklet uses Salesforce&rsquo;s internal API and may be limited by session or internal caps. For large exports, the extension is recommended.
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
        <tr><td><strong>Columns</strong></td><td>Data Explorer</td><td>Opens Column Selector &mdash; pick, reorder, apply, save/restore, export CSV, filter, Export All</td></tr>
        <tr><td><strong>Export CSV</strong></td><td>Data Explorer</td><td>Exports currently visible rows as CSV</td></tr>
        <tr><td><strong>Run &amp; Export</strong></td><td>Query Editor</td><td>Runs highlighted SQL and exports full result as CSV with pagination</td></tr>
        <tr><td><strong>View Definition</strong></td><td>Data Transform</td><td>Reads and displays the transform definition (batch graph or streaming SQL)</td></tr>`;

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
  .pill.new{background:var(--greenbg);color:var(--green)}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
  th{text-align:left;padding:7px 10px;background:var(--bg);color:var(--muted);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line)}
  td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:none}
  @media(max-width:600px){.feat-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">

  <!-- Always-visible update banner: tells user to delete old + re-drag on every visit -->
  <div id="dc-update-banner" style="border-radius:12px;padding:16px 20px;margin-bottom:18px;font-size:14px;line-height:1.6;border:2px solid #f59e0b;background:#fffbeb;color:#78350f">
    <div style="display:flex;align-items:flex-start;gap:12px">
      <span style="font-size:22px;line-height:1.2">&#128260;</span>
      <div style="flex:1">
        <strong id="dc-update-title" style="font-size:15px;color:#92400e;">Always grab the latest version</strong>
        <div id="dc-update-sub" style="margin-top:4px;font-size:13px;color:#92400e;">
          <strong>1.</strong> Delete your old <em>Data 360 Inspector</em> bookmark &nbsp;&rarr;&nbsp;
          <strong>2.</strong> Drag the button below to your bookmarks bar &nbsp;&rarr;&nbsp;
          <strong>3.</strong> Done! You now have the latest build.
        </div>
        <div id="dc-update-status" style="margin-top:8px;font-size:12px;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.05);display:inline-block;"></div>
      </div>
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
      <li>Open any Data Cloud / Data 360 page in Salesforce and <strong>click the bookmark</strong>. A purple circle button appears in the bottom-right corner &mdash; click it to open the action menu.</li>
      <li>Click the bookmark again at any time to remove the tool.</li>
    </ol>
    <div class="note">The launcher sits in the bottom-right corner and never overlaps the Salesforce navigation. Click the purple circle button to expand the menu; click outside or click it again to collapse.</div>
  </div>

  <div class="card">
    <h2>&#127919; Supported pages</h2>
    <p style="font-size:13px;color:var(--muted);margin:0 0 10px">The tool auto-detects the current page and shows only the relevant launcher. On unsupported pages you will see a brief toast message.</p>
    <div class="feat-grid">
      <div class="feat"><div class="icon">&#128257;</div><strong>Mapping Canvas</strong><span>DLO &rarr; DMO field mapping page</span></div>
      <div class="feat"><div class="icon">&#127760;</div><strong>Data Stream</strong><span>Data Stream detail page (with record ID in URL)</span></div>
      <div class="feat"><div class="icon">&#128451;</div><strong>DLO Detail</strong><span>Data Lake Object detail page</span></div>
      <div class="feat"><div class="icon">&#128450;</div><strong>DMO Detail</strong><span>Data Model Object detail page</span></div>
      <div class="feat"><div class="icon">&#128202;</div><strong>Data Explorer</strong><span>DLO / DMO record view with data table</span></div>
      <div class="feat"><div class="icon">&#127937;</div><strong>Segment</strong><span>Segment wizard / segment detail page</span></div>
      <div class="feat"><div class="icon">&#128270;</div><strong>Query Editor</strong><span>Data Cloud SQL workspace (DataQueryWorkspace)</span></div>
      <div class="feat"><div class="icon">&#9881;&#65039;</div><strong>Data Transform</strong><span>Batch or streaming transform detail page</span></div>
    </div>
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
      <li>Runs entirely in your browser &mdash; no external servers, no third-party services.</li>
      <li><strong>Bookmarklet:</strong> uses only data the page has already loaded + Salesforce&rsquo;s own internal APIs (same-origin).</li>
      <li><strong>Extension:</strong> calls Salesforce&rsquo;s <em>documented</em> <code>/ssot/query-sql</code> API (read-only SELECT queries) using your existing session cookie. No data leaves your browser or your org.</li>
      <li>Nothing is stored permanently &mdash; the tool disappears on page reload. Column selections use localStorage (per-org, 90-day TTL).</li>
      <li>Read-only: it never creates, modifies, or deletes any Salesforce data.</li>
    </ul>
  </div>

</div>
<script>
(function(){
  var BUILD_ID = ${JSON.stringify(buildId || "")};
  var KEY = "dc-inspector-installed-build";
  var statusEl = document.getElementById("dc-update-status");
  var banner = document.getElementById("dc-update-banner");
  if (!statusEl || !BUILD_ID) return;
  var seen;
  try { seen = localStorage.getItem(KEY); } catch(e) { seen = null; }
  if (!seen) {
    // First time — show banner
    statusEl.innerHTML = "&#128308; <strong>Not installed yet</strong> &mdash; drag the button below to add it.";
    statusEl.style.background = "#fef2f2"; statusEl.style.color = "#991b1b";
  } else if (seen !== BUILD_ID) {
    // Outdated — show banner with urgency
    statusEl.innerHTML = "&#128680; <strong>NEW UPDATE AVAILABLE!</strong> Your bookmark is outdated. Delete it and re-drag below.";
    statusEl.style.background = "#fef2f2"; statusEl.style.color = "#dc2626";
    if (banner) { banner.style.borderColor = "#dc2626"; banner.style.background = "#fef2f2"; banner.style.animation = "dcpulse 1.5s infinite"; }
  } else {
    // Already up to date — HIDE banner completely
    if (banner) banner.style.display = "none";
    return;
  }
  // Mark as installed when they drag the bookmarklet link — hide the banner
  var bmLink = document.querySelector("a.bm");
  if (bmLink) {
    bmLink.addEventListener("mousedown", function() {
      try { localStorage.setItem(KEY, BUILD_ID); } catch(e){}
      if (banner) {
        banner.style.transition = "opacity .4s, transform .4s";
        banner.style.opacity = "0";
        banner.style.transform = "translateY(-10px)";
        setTimeout(function(){ banner.style.display = "none"; }, 400);
      }
    });
  }
})();
</script>
<style>@keyframes dcpulse{0%,100%{border-color:#dc2626}50%{border-color:#fca5a5}}</style>
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
// index.html is written AFTER version bump (below) so it shows the correct version.

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

// index.html for GitHub Pages — written AFTER version bump so the displayed version is correct.
const finalVersion = extVersion || _mfVer;
const indexHtml = fullHtml.replace("<strong>v" + _mfVer + "</strong>", "<strong>v" + finalVersion + "</strong>");
fs.writeFileSync(path.join(dir, "index.html"), indexHtml);

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
