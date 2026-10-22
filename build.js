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
const { execFileSync } = require("child_process");

const dir = __dirname;

// ---- run logic tests FIRST — a failing test aborts the build (no untested push) ----
// One file per feature area (kept separate on purpose — Data Explorer and Query
// Editor must stay independent, so their test suites stay independent too).
(function runTests() {
  ["explorer-logic.test.js", "query-editor-templates.test.js", "mapping-canvas-target-api.test.js", "mapping-canvas-source-api.test.js", "mapping-canvas-ui.test.js", "ext-only-strip.test.js", "ext-autoload.test.js", "bookmarklet-size.test.js", "install-page-public.test.js", "canvas-focus-dmo.test.js", "qe-json-view.test.js", "qe-snapshot-diff.test.js", "qe-fetch-materialize.test.js", "qe-fetch-paging.test.js", "segment-apiname.test.js"].forEach(function (name) {
    const testFile = path.join(dir, "test", name);
    if (!fs.existsSync(testFile)) { console.warn("WARN: test/" + name + " missing — skipping."); return; }
    try {
      execFileSync(process.execPath, [testFile], { stdio: "inherit" });
    } catch (e) {
      console.error("\nERROR: " + name + " FAILED — aborting build. Fix tests before building/pushing.");
      process.exit(1);
    }
  });
})();

// ---- minify (bookmarklet payload only) ----
// The inlined bookmarklet must stay under the browser's ~2MB bookmark-URL limit.
// Raw source (~945KB) base64-encodes to ~2.1MB → OVER the limit. esbuild minify
// (comments + whitespace, string/regex-safe via a real parser) roughly halves it.
// Only the BOOKMARKLET payload is minified; the extension inject.js keeps full
// readable source (no size limit there). Falls back to raw source if esbuild is
// missing so the build never hard-fails on a fresh checkout.
const _esbuildBin = path.join(dir, "node_modules/.bin/esbuild");
function minifyForBookmarklet(code, label) {
  if (!fs.existsSync(_esbuildBin)) {
    console.warn("WARN [" + label + "]: esbuild not found — bookmarklet uses UNMINIFIED source (may exceed 2MB). Run `npm install`.");
    return code;
  }
  const tmp = path.join(dir, ".bm-min-" + label + ".tmp.js");
  fs.writeFileSync(tmp, code);
  try {
    const out = execFileSync(_esbuildBin, [tmp, "--minify", "--legal-comments=none"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    // esbuild output must still parse and preserve behavior — verify it compiles.
    try { new Function(out); } catch (e) {
      console.error("ERROR [" + label + "]: minified bookmarklet has a syntax error: " + e.message + "; aborting.");
      process.exit(1);
    }
    return out;
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}
// TWO forked sources (no shared file): the extension source is the superset;
// the bookmarklet source omits extension-only code so the bookmarklet stays small
// and can't be affected by extension work. The SHARED code (everything outside
// @ext-only blocks) MUST stay identical between them — enforced by drift-check
// below, so a shared fix applied to only one file fails the build instead of
// silently diverging.
const extSourcePath = path.join(dir, "console-decorate.extension.js");
const bmSourcePath  = path.join(dir, "console-decorate.bookmarklet.js");
const extCode = fs.readFileSync(extSourcePath, "utf8");   // extension source (superset)
const bmSource = fs.readFileSync(bmSourcePath, "utf8");   // bookmarklet source
// `fullCode` name kept for the rest of the script = the EXTENSION source (drives inject.js).
const fullCode = extCode;
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

// ---- strip EXTENSION-ONLY sections for the BOOKMARKLET builds ----
// SECOND, INDEPENDENT axis from @strip (public/full). @ext-only marks code that
// exists ONLY in the browser extension (inject.js) — typically extended API-call
// features that the bookmarklet can't support (CSP-blocked fetches, higher row
// caps via the bridge, etc.). build.js removes every /* @ext-only:start ... */ ...
// /* @ext-only:end */ block from the BOOKMARKLET payloads, so:
//   • extension inject.js  = full source (keeps @ext-only code)  ← shared core + ext-only
//   • bookmarklet payloads = @ext-only PHYSICALLY REMOVED        ← shared core only
// Shared code (everything NOT inside a marker) stays in BOTH — so a shared fix
// (Birth Date, Account Number, segment scraper …) lands everywhere automatically
// with no drift, while extension-only work can never reach — or break — the
// bookmarklet. Orthogonal to @strip: an @ext-only block may sit inside or outside
// an @strip block; both strippers run independently and idempotently.
function stripExtOnly(src) {
  const re = /\/\* @ext-only:start[\s\S]*?@ext-only:end \*\//g;
  const out = src.replace(re, "/* [extension-only feature — not available in bookmarklet] */");
  if (/@ext-only:(start|end)/.test(out)) {
    console.error("ERROR: unbalanced or leftover @ext-only markers after stripping; aborting.");
    process.exit(1);
  }
  return out;
}

// ---- DRIFT CHECK: the two forked sources must share identical NON-ext-only code ----
// Invariant that keeps the fork safe: console-decorate.bookmarklet.js must equal
// console-decorate.extension.js with the @ext-only blocks removed. If they differ,
// a shared change was applied to one file but not the other → the two builds would
// silently diverge. We abort with a diff hint instead of shipping drift.
(function checkForkDrift() {
  const extSharedShape = stripExtOnly(extCode); // extension source minus ext-only blocks
  if (extSharedShape === bmSource) return;      // shared code identical → good
  // find the first differing line to point the user at it
  const a = extSharedShape.split("\n"), b = bmSource.split("\n");
  let ln = 0; const max = Math.min(a.length, b.length);
  while (ln < max && a[ln] === b[ln]) ln++;
  console.error("ERROR: fork drift — shared (non-@ext-only) code differs between the two sources.");
  console.error("  console-decorate.extension.js (ext-only stripped) != console-decorate.bookmarklet.js");
  console.error("  First difference around line " + (ln + 1) + ":");
  console.error("    extension : " + JSON.stringify((a[ln] || "").slice(0, 120)));
  console.error("    bookmarklet: " + JSON.stringify((b[ln] || "").slice(0, 120)));
  console.error("  A shared fix must be applied to BOTH files. See `node sync-shared.js --check`.");
  process.exit(1);
})();

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
["openSegmentExport", "ensureExploreLauncher", "openExploreModal", "readSegmentRules", "openFocusPanel", "hideOtherForDmo", "segApiInfo", "toggleSegApi", "segBuildUidResolver"].forEach(sym => {
  if (new RegExp("function\\s+" + sym + "\\b").test(publicCode)) {
    console.error("ERROR: in-dev function '" + sym + "' still defined in public build; aborting.");
    process.exit(1);
  }
});

// sanity: @ext-only markers are balanced, and (when present) the bookmarklet strip
// actually removes them + still compiles. Runs on BOTH the full and public source
// so a malformed extension-only block can never silently ship in a bookmarklet.
(function validateExtOnly() {
  const starts = (fullCode.match(/@ext-only:start/g) || []).length;
  const ends = (fullCode.match(/@ext-only:end/g) || []).length;
  if (starts !== ends) {
    console.error("ERROR: @ext-only markers unbalanced (" + starts + " start / " + ends + " end); aborting.");
    process.exit(1);
  }
  if (starts === 0) return; // none defined yet — nothing to check
  [["full", fullCode], ["public", publicCode]].forEach(([label, code]) => {
    const bm = stripExtOnly(code);
    if (bm.length >= code.length) {
      console.error("ERROR: stripExtOnly removed nothing from " + label + " — check @ext-only markers; aborting.");
      process.exit(1);
    }
    try { new Function(bm); } catch (e) {
      console.error("ERROR: " + label + " bookmarklet code (ext-only stripped) has a syntax error: " + e.message + "; aborting.");
      process.exit(1);
    }
  });
})();

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
    ? `All-in-one toolkit for Salesforce Data Cloud &mdash; explore data, export segment rules &amp; transforms, query any object to CSV. Read-only, zero setup.`
    : `Reveals API names on the DLO&rarr;DMO mapping canvas and exports Data&nbsp;Stream, DLO &amp; DMO fields to Sheets, CSV, or Excel. Read-only, zero setup.`;

  // ── ONE consolidated "What it does" grid — one card per supported page ──────────
  // Replaces the old 3 redundant sections (Supported-pages tiles + Features-by-page
  // lists + Launcher-menu table), which described every feature ~3× and made the page
  // long. Each card = icon + page name + the buttons you get + what they do, in a
  // single scannable line. Public build shows only the 4 always-shipped pages; the
  // dev-only pages (Data Explorer, Segment, Query Editor, Data Transform) are gated.
  //
  // Every claim verified against console-decorate.extension.js — no guessed numbers:
  //   • Explorer's own view loads 100 rows (code: "hard-capped at 100").
  //   • Query Editor grid shows 1,000 rows on screen (Salesforce product UI limit).
  //   • CSV export cap = 500K rows (DC_MAX_TOTAL_EXPORT), paginated.
  // Accordion row: one collapsed <details> per page. Page loads short (all collapsed);
  // click a row to expand its launcher buttons + what they do. Fixes the old bug where
  // inline <strong> broke onto its own line (we use <b>, and .acc-body has no block
  // rule). Every claim verified against console-decorate.extension.js.
  function acc(icon, name, pills, desc) {
    const pillHtml = pills.map(p => '<span class="pill">' + p + '</span>').join("");
    return `<details class="acc">
        <summary><span class="acc-ic">${icon}</span><span class="acc-nm">${name}</span><span class="acc-pills">${pillHtml}</span></summary>
        <div class="acc-body">${desc}</div>
      </details>`;
  }
  const chips = ["DLO &rarr; DMO Mapping Canvas", "Data Stream", "DLO", "DMO"]
    .concat(includeDev ? ["Data Model (ERD)", "Data Graph", "Object lists &rarr; New Tab", "Nav &rarr; New Tab", "Data Explorer", "Segment", "Activation", "Query Editor", "Data Transform"] : [])
    .map(c => `<span class="chip">${c}</span>`).join("");

  const sharedRows =
    acc("&#128257;", "DLO &rarr; DMO Mapping Canvas", ["API Tooltip", "Pin API names", "Export"],
      "<p>The mapping canvas normally shows only field <b>labels</b> &mdash; not the API names you actually need when building queries, transforms, or integrations. This fills that gap.</p>" +
      "<ul>" +
      "<li><b>API Tooltip</b> &mdash; hover a field to see its API name on both the source (DLO) and target (DMO) side; press <kbd>C</kbd> to copy. When on, the button shows a green &ldquo;&bull; ON&rdquo; so you know it&rsquo;s live.</li>" +
      "<li><b>Pin API names</b> &mdash; show every API name on the canvas at once, so you can read the whole mapping without hovering. <b>Click any pinned name to copy it</b> (it flashes &ldquo;&#10003; Copied&rdquo;).</li>" +
      "<li><b>Export</b> &mdash; download the full mapping table (source field &rarr; target field, with both API names) to Google Sheets or CSV. You can filter to a single DMO first.</li>" +
      "</ul>" +
      "<span class=\"gi\"><b>Good to know:</b> if the same label is used on both a DLO and a DMO, the tooltip marks which side it read so you&rsquo;re never shown the wrong API name.</span>") +
    acc("&#127760;", "Data Stream &amp; DLO", ["Export Fields"],
      "<p>On a Data Stream or Data Lake Object page, export the complete field list in one click &mdash; no copy-pasting row by row.</p>" +
      "<p>Each row includes the <b>API name</b>, <b>label</b>, <b>data type</b>, <b>status</b>, and <b>key qualifier</b> (primary key / event time / etc.). Copy it straight into Google Sheets, or download as a CSV.</p>") +
    acc("&#128450;", "DMO Detail", ["Export Fields"],
      "<p>On a Data Model Object detail page, grab both tabs of information:</p>" +
      "<ul>" +
      "<li><b>Fields</b> &mdash; API name, data type, whether the field is mapped, and its key qualifier.</li>" +
      "<li><b>Relationships</b> &mdash; the objects this DMO is related to and the fields that join them.</li>" +
      "</ul>" +
      "<p>Copy it into Google Sheets, or download as an Excel (XLS) file.</p>");
  // Query Editor gets a fuller, per-button write-up (it's the most capable + the one with
  // real nuances users must understand: credits, caps, viewer limits, big-table caution).
  // Every number here is taken straight from console-decorate.extension.js:
  //   • grid-on-screen limit 1,000 rows (SF product UI)
  //   • Fetch & Export default stop 50,000 rows, hard max 500,000 (QE_DEFAULT_CAP / QE_HARD_MAX)
  //   • View Results up to 2,000 rows (viewBtn title)
  //   • Export ALL backstop 100,000,000 rows (HARD in qeStreamFullExport)
  const qeAccordion = acc("&#128270;", "Query Editor", ["Count", "Fetch &amp; Export", "Export ALL", "Helpful Queries", "View", "Download"],
    "<p>The Query Editor shows query results on screen, but only about <b>1,000 rows</b>, and getting the full result out as a file is awkward. This adds a small toolbar (a round button, bottom-left) that does the rest. Highlight a query first to run just that one; otherwise it uses the whole editor.</p>" +
    "<p><b>What each button does:</b></p>" +
    "<ul class=\"btnlist\">" +
    "<li><span class=\"bl-nm\"># Count</span> Gives you the exact number of rows a query returns &mdash; without downloading any data. One quick call. Works for plain queries as well as GROUP BY and JOINs.</li>" +
    "<li><span class=\"bl-nm\">&#9654; Fetch &amp; Export</span> Fetches the rows and saves them as a CSV file. It pulls in batches behind the scenes, so it keeps going past the 1,000 on-screen rows. If your query has no <code>LIMIT</code>, it stops at <b>50,000 rows</b> by default (and tells you there were more) &mdash; add your own <code>LIMIT</code> to go higher, up to <b>500,000</b>. For bigger than that, use Export ALL.</li>" +
    "<li><span class=\"bl-nm\">&#10515; Export ALL</span> Exports the <b>entire</b> result to a CSV, with no row cap. You pick where to save first, then the rows write straight to that file as they&rsquo;re fetched &mdash; so even a very large table won&rsquo;t run your browser out of memory. You can <b>Cancel</b> anytime, and a progress count keeps you posted. If you close the little panel while it runs, it keeps going; re-open it (or click the button again) and your progress comes right back.</li>" +
    "<li><span class=\"bl-nm\">&#128295; Helpful Queries</span> Builds common checks for you &mdash; find duplicates, empty (null) values, stale records, orphaned keys, records in a date range, and more &mdash; just by picking an object and a column. No SQL to write. It runs through the same Count / Fetch buttons.</li>" +
    "<li><span class=\"bl-nm\">&#128065; View Results</span> Shows the fetched rows in a table right on the page (up to <b>2,000 rows</b>) so you can glance at them without opening a file. Click any cell to copy it. No extra query.</li>" +
    "<li><span class=\"bl-nm\">&#11015; Download CSV</span> Saves rows you&rsquo;ve already fetched to a CSV. No new query, so no extra credits.</li>" +
    "</ul>" +
    "<span class=\"gi\"><b>About Data Cloud credits:</b> Count and Fetch each run a real query, and Data Cloud bills by rows <b>processed</b> (scanned), not rows returned &mdash; so a heavy JOIN or GROUP BY can cost more than its row count suggests. The toolbar shows your org&rsquo;s rate and an estimate, and it <b>remembers results</b> &mdash; re-running the same query or re-downloading an already-fetched file is free. If you re-run an Export ALL you already did, it warns you first so you don&rsquo;t pay twice.</span>" +
    "<span class=\"gi\"><b>Opening very large files:</b> a CSV can hold any number of rows, but Excel stops showing rows after about <b>1,048,576</b> and Google Sheets after about <b>10&nbsp;million cells</b> (so fewer rows the more columns you have). If an export is bigger, the tool tells you, and suggests Power Query or a database so you don&rsquo;t silently lose data.</span>" +
    "<span class=\"gi\"><b>A note on huge tables (tens of millions of rows):</b> a browser isn&rsquo;t the right tool for a full dump at that scale &mdash; it&rsquo;s slow, uses a lot of credits, and the file is hard to open. For those, export in slices (for example by date range) or use a server-side option like the Data Cloud Query API or a data share. This toolbar is ideal for counts, exploring, and exports up to a few hundred thousand (and into the low millions with Export ALL).</span>");

  const devRows = !includeDev ? "" :
    acc("&#128506;&#65039;", "Data Model (ERD)", ["Diagram"],
      "<p>On the Data Model graph page, build a shareable <b>entity-relationship diagram</b> of your objects and how they connect &mdash; without drawing it by hand.</p>" +
      "<ul>" +
      "<li>Generates a copyable <b>Mermaid</b> diagram you can paste into Lucidchart, draw.io, GitHub, or any Markdown doc.</li>" +
      "<li>Includes a <b>cardinality legend</b> (one-to-many, etc.) so the relationships are easy to read.</li>" +
      "<li><b>Searchable entity cards</b> let you look up any object and see everything it&rsquo;s connected to.</li>" +
      "</ul>") +
    acc("&#128376;&#65039;", "Data Graph", ["Field API Names", "Filters", "Copy"],
      "<p>The Data Graph builder shows only friendly <b>labels</b> for the fields you pick &mdash; not the API names you need for queries and integrations. Turn on <b>API names</b> from the &#9678; button (bottom-right) to reveal them.</p>" +
      "<ul>" +
      "<li><b>Objects &amp; fields</b> &mdash; the API name appears under each object on the left and under each field on the right. It refreshes automatically as you click between objects.</li>" +
      "<li><b>Filters tab</b> &mdash; the field chosen in each <b>Sort</b> and <b>Condition</b> dropdown is labelled with its API name too (and on hover).</li>" +
      "<li><b>Click any API name to copy it</b> (it flashes &ldquo;&#10003; Copied&rdquo;). Every field also shows its API name on <b>hover</b> as a fallback.</li>" +
      "</ul>" +
      "<span class=\"gi\"><b>Duplicate labels are exact, not guessed:</b> the Filters tab reads each dropdown&rsquo;s <b>selected field API directly</b> from the page &mdash; so even if two fields share the same label, you always get the exact one that was picked.</span>") +
    acc("&#128194;", "Object lists (records)", ["Open in New Tab"],
      "<p>On <b>any</b> Data Cloud object list &mdash; Data Streams, Data Lake Objects, Data Model Objects, Calculated Insights, Segments, Activations, Data Graphs, Identity Resolution, and the rest &mdash; hover a row and a <b>&#10697;</b> button appears by its name to <b>open that record in a new tab</b>.</p>" +
      "<span class=\"gi\"><b>Why this helps:</b> many of these list rows aren&rsquo;t real links (the name runs a script instead of a URL), so a normal right-click &rarr; &ldquo;Open in new tab&rdquo; doesn&rsquo;t work &mdash; today you have to duplicate the tab. The tool reads the row&rsquo;s own record id and opens the exact record directly &mdash; and deliberately ignores lookup columns (e.g. a &ldquo;Data Space&rdquo; cell), so it always opens the row&rsquo;s record, never a related one.</span>") +
    acc("&#129517;", "Left &amp; Top Nav", ["Open in New Tab"],
      "<p>Hover any Data Cloud navigation item &mdash; in the left side menu or the top bar &mdash; and a <b>&#10697;</b> button lets you <b>open it in a new tab</b>. Covers every item, including newer ones (Segments, Activations, Calculated Insights, AI Models, Clean Rooms, Data Shares, Semantic Layer, &hellip;).</p>" +
      "<span class=\"gi\">Only real menu items get the button &mdash; ordinary record or user links on a page won&rsquo;t be mistaken for navigation. You don&rsquo;t need to re-click the bookmark as you move between pages.</span>") +
    acc("&#127937;", "Segment", ["Export Rules", "API Names", "Container Path"],
      "<p>Read and export the real logic behind a segment &mdash; API names and all &mdash; which the builder normally hides behind friendly labels.</p>" +
      "<ul>" +
      "<li><b>Hover any attribute or rule</b> to see its object and field API name. Press <kbd>C</kbd> to copy it.</li>" +
      "<li><b>Container Path</b> is shown exactly as it appears when a related object&rsquo;s edit panel is open &mdash; so you can see which related record a rule actually points at.</li>" +
      "<li><b>Export</b> every condition &mdash; Include, Exclude, and Rank &amp; Limit &mdash; with the full AND/OR logic, nested segments, and sub-filters preserved, plus columns for the object and field API names. Save to Google Sheets, or as HTML / Excel.</li>" +
      "</ul>" +
      "<span class=\"gi\"><b>Reads only what&rsquo;s on screen:</b> the Container Path is copied straight from the open panel, never reconstructed or guessed &mdash; if it isn&rsquo;t shown in Data Cloud, the tool won&rsquo;t invent it.</span>") +
    acc("&#127919;", "Activation", ["API Names", "Export"],
      "<p>The same help as Segment, for the <b>activation wizard</b>.</p>" +
      "<ul>" +
      "<li><b>Hover</b> any attribute in the main table or in &ldquo;Add Additional Attributes&rdquo; to see its object and field API name.</li>" +
      "<li><b>Export</b> the activation&rsquo;s included attributes, with their object and field API names, in one click.</li>" +
      "</ul>" +
      "<span class=\"gi\">API-name help appears on the <b>wizard</b> (where you&rsquo;re choosing attributes). On a finished activation&rsquo;s read-only detail page there are no attributes to label, so only Export is offered there.</span>") +
    acc("&#128202;", "Data Explorer", ["Columns", "Export CSV"],
      "<p>Salesforce&rsquo;s Data Explorer only shows about 10 columns at a time and a limited set of rows. This lets you see and take the whole picture.</p>" +
      "<ul>" +
      "<li><b>Columns</b> &mdash; pick exactly which fields to show (well past the 10-column limit), reorder them, and save the set so it&rsquo;s there next time. Then view all their data together in one table.</li>" +
      "<li><b>Sort, multi-filter, and a live row count</b> on the results, plus an <b>Edit SQL</b> option if you want to tweak the query behind the view.</li>" +
      "<li><b>Export CSV</b> &mdash; download the rows. Large exports fetch in batches automatically, up to <b>500,000 rows</b>, and you can cancel partway.</li>" +
      "</ul>" +
      "<span class=\"gi\">Column choices are saved only in your own browser (per org, cleared after 90 days). Nothing is written back to Salesforce.</span>") +
    qeAccordion +
    acc("&#9881;&#65039;", "Data Transform", ["View Definition"],
      "<p>Understand what a Data Transform actually does without reading its raw definition.</p>" +
      "<p>The tool <b>reads the transform automatically</b> and writes a plain-English, step-by-step summary: the <b>sources</b> it reads, the <b>filters</b> it applies, any <b>formulas</b> and <b>joins</b>, the <b>outputs</b> it writes, and which fields are <b>kept, dropped, or renamed</b> along the way.</p>" +
      "<p>Download the summary as an HTML file (which you can print to PDF). An optional AI explanation is available if you want it rewritten in even simpler terms.</p>");
  const roadmapNote = includeDev ? "" : `
    <p style="font-size:12px;color:var(--muted);margin:12px 2px 0"><strong>Coming soon:</strong> segment rule export &amp; Data Explorer column tooling &mdash; rolling out in upcoming versions.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Data 360 Inspector — Install</title>
<link rel="icon" type="image/png" href="favicon.png">
<link rel="icon" type="image/x-icon" href="favicon.ico">
<style>
  /* Light palette (default). --dark/--blue are BRAND colors for the hero gradient and
     stay fixed; theme-varying surfaces/text use the vars below. */
  :root{--blue:#0d6efd;--dark:#1e3a5f;--ink:#16325c;--muted:#5c6b8a;--line:#e0e5ee;--bg:#f3f6fb;--green:#0a6b2d;--greenbg:#d4f0db;--page:#f7f9fc;--card:#fff;--head:#1e3a5f;--pill-bg:#edf4ff}
  /* Dark palette — auto-applied when the user's OS/browser is in dark mode. Only the
     surface/text vars flip; the hero keeps its blue gradient (white text reads on it). */
  @media (prefers-color-scheme: dark){
    :root{--blue:#60a5fa;--ink:#e6edf6;--muted:#9fb0c6;--line:#2b3648;--bg:#1b2536;--head:#cbd8ee;--page:#0e1420;--card:#161f2e;--pill-bg:#1e2f4a;--greenbg:#173a2a;--green:#4ade80}
    .upd{color:#fde9c8;background:#3a2c10;border-color:#7a5a1a}
    .card{box-shadow:0 1px 4px rgba(0,0,0,.35)}
    .hero-cta .bm{background:#e8eefb}
  }
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--page)}
  .wrap{max-width:860px;margin:0 auto;padding:8px 24px 10px}
  .hero{background:linear-gradient(135deg,var(--dark) 0%,var(--blue) 100%);border-radius:14px;padding:14px 22px;margin-bottom:8px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
  .hero-info{flex:1;min-width:250px}
  .hero h1{font-size:21px;margin:0 0 4px;font-weight:800;letter-spacing:-.02em;line-height:1.1}
  .hero p{margin:0 0 7px;font-size:13px;opacity:.85;line-height:1.4;max-width:520px}
  .hero .badge{margin:0}
  .hero-cta{display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0}
  .hero-cta .bm{background:#fff;color:var(--dark);font-size:13px;padding:5px 10px;border-radius:9px;gap:6px;box-shadow:0 3px 10px rgba(0,0,0,.22)}
  .hero-cta .bm svg{width:14px;height:14px}
  .hero-cta .bm:hover{opacity:1;transform:translateY(-1px);box-shadow:0 5px 14px rgba(0,0,0,.28)}
  .hero-cta-hint{font-size:11px;opacity:.8;white-space:nowrap}
  /* slim update reminder */
  .upd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px;color:#78350f;background:#fffbeb;border:1px solid #fcd34d;border-radius:9px;padding:7px 13px;margin-bottom:10px}
  .upd-status{font-weight:600}
  @media(max-width:560px){.hero{padding:16px 18px}.hero h1{font-size:20px}.hero-cta{align-items:flex-start}}
  .badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 10px;border-radius:12px;margin-bottom:12px}
  .badge.rec{background:rgba(255,255,255,.2);color:#fff}
  .badge.tip{background:var(--bg);color:var(--blue)}
  .card{border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:12px 0;background:var(--card);box-shadow:0 1px 4px rgba(0,0,0,.05)}
  .card.rec{border-color:#93c5fd;box-shadow:0 2px 14px rgba(13,110,253,.1)}
  .card h2{margin:0 0 6px;font-size:16px;color:var(--ink)}
  .card h3{margin:14px 0 6px;font-size:14px;font-weight:700;color:var(--head)}
  .bm{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,var(--dark),var(--blue));color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:24px;box-shadow:0 3px 12px rgba(13,110,253,.35);cursor:grab;user-select:none;transition:opacity .15s,transform .12s,box-shadow .15s}
  .bm:hover{opacity:.88}.bm:active{cursor:grabbing;transform:scale(.98)}
  ol,ul{padding-left:22px}li{margin:7px 0}
  kbd{font:12px "SF Mono",Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
  .note{font-size:13px;color:var(--muted);background:var(--bg);border-radius:8px;padding:11px 15px;margin-top:14px;line-height:1.5}
  code{font:12px "SF Mono",Menlo,monospace;background:var(--bg);padding:1px 5px;border-radius:4px}
  .feat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
  .feat{background:var(--bg);border-radius:10px;padding:14px 16px}
  .feat .icon{font-size:20px;margin-bottom:6px}
  .feat strong{display:block;font-size:13px;color:var(--ink);margin-bottom:3px}
  .feat span{font-size:12px;color:var(--muted);line-height:1.5}
  .pill{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px;background:var(--pill-bg);color:var(--blue);margin-right:4px}
  /* page chips (at-a-glance list of supported pages) */
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:12px;font-weight:600;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:3px 11px}
  /* accordion rows */
  .acc{border:1px solid var(--line);border-radius:10px;margin:5px 0;background:var(--card);overflow:hidden}
  .acc[open]{border-color:#bcd3f7;box-shadow:0 1px 6px rgba(13,110,253,.07)}
  .acc summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:9px;padding:9px 14px;font-size:14px;user-select:none}
  .acc summary::-webkit-details-marker{display:none}
  .acc summary::after{content:"\\203A";margin-left:auto;color:var(--muted);font-size:18px;transform:rotate(90deg);transition:transform .15s}
  .acc[open] summary::after{transform:rotate(-90deg)}
  .acc summary:hover{background:var(--bg)}
  .acc-ic{font-size:17px;line-height:1}
  .acc-nm{font-weight:700;color:var(--ink)}
  .acc-pills{display:flex;flex-wrap:wrap;gap:3px}
  .acc-body{padding:2px 15px 14px 40px;font-size:13px;color:var(--muted);line-height:1.55}
  .acc-body b{color:var(--ink);font-weight:600}
  .acc-body p{margin:4px 0 8px}
  .acc-body ul{margin:4px 0 8px;padding-left:18px}
  .acc-body li{margin:3px 0}
  /* "Good to know" callout inside an accordion body — a soft note users should read */
  .acc-body .gi{display:block;margin-top:8px;font-size:12px;background:var(--bg);border:1px solid var(--line);border-left:3px solid var(--blue);border-radius:6px;padding:8px 11px;color:var(--muted);line-height:1.5}
  .acc-body .gi b{color:var(--ink)}
  .acc-body .btnlist{margin:4px 0 6px;padding-left:0;list-style:none}
  .acc-body .btnlist li{margin:5px 0;padding-left:0}
  .acc-body .btnlist .bl-nm{display:inline-block;font-weight:700;color:var(--ink);background:var(--pill-bg);border-radius:6px;padding:1px 7px;margin-right:5px;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}
  th{text-align:left;padding:7px 10px;background:var(--bg);color:var(--muted);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line)}
  td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:none}
  @media(max-width:600px){.feat-grid{grid-template-columns:1fr}}
</style>
<!-- Cloudflare Web Analytics (privacy-first: no cookies, no fingerprinting) -->
<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "0d6d64614a494f34a06fb61145f59228"}'></script>
</head>
<body>
<div class="wrap">

  <!-- Slim update reminder — FIRST thing on the page so an alert is seen immediately.
       Turns red via script when a newer build is detected; hides once you drag/click. -->
  <div id="dc-update-banner" class="upd">
    <span class="upd-txt">&#128260; Always re-drag to get the latest build &mdash; delete your old bookmark first, then drag the button below.</span>
    <span id="dc-update-status" class="upd-status"></span>
  </div>

  <!-- Hero = title + blurb + the drag CTA, all in one compact block. -->
  <div class="hero">
    <div class="hero-info">
      <h1>Data 360 Inspector</h1>
      <p>${heroBlurb}</p>
      <div class="badge rec">&#9679; Read-only &middot; nothing leaves your browser</div>
    </div>
    <div class="hero-cta">
      <a class="bm" href="${hrefSafe}" draggable="true">&#128269; Data 360 Inspector</a>
      <span class="hero-cta-hint">&#8598; Drag me to your bookmarks bar</span>
    </div>
  </div>

  <details class="acc" style="margin:2px 0 16px">
    <summary><span class="acc-ic">&#10067;</span><span class="acc-nm">How to install &amp; use</span></summary>
    <div class="acc-body">
      <b>1.</b> Show your bookmarks bar &mdash; <kbd>&#8984;&#8679;B</kbd> (Mac) / <kbd>Ctrl&#8679;B</kbd> (Windows).<br>
      <b>2.</b> Drag the <b>Data 360 Inspector</b> button above onto the bookmarks bar. No install, no permissions.<br>
      <b>3.</b> On any Data Cloud / Data 360 page, click the bookmark &mdash; a purple circle button appears bottom-right; click it for the menu.<br>
      <b>4.</b> Click the bookmark again anytime to remove the tool. It never overlaps the Salesforce nav.
    </div>
  </details>

  <div class="card">
    <h2>What it does</h2>
    <p style="font-size:12px;color:var(--muted);margin:0 0 8px">Works on these pages (the launcher shows only that page&rsquo;s buttons) &mdash; click a row to see what you can do. All read-only.</p>
    <div class="chips" style="margin-bottom:10px">${chips}</div>
    ${sharedRows}${devRows}
    <p style="font-size:12px;color:var(--muted);margin:10px 2px 0">Modals are draggable &amp; resizable. The <strong>&times;</strong> on a menu just closes it; to remove the tool entirely, click the bookmark again.</p>${roadmapNote}
  </div>
  <details class="acc" style="margin-top:16px">
    <summary><span class="acc-ic">&#128274;</span><span class="acc-nm">Privacy &amp; safety</span></summary>
    <div class="acc-body">
      <ul style="margin:4px 0;padding-left:18px">
        <li>Runs entirely in your browser &mdash; no external servers, no third-party services.</li>
        <li>Uses Salesforce&rsquo;s own APIs (same-origin). No data leaves your browser or your org.</li>
        <li>Nothing is stored permanently &mdash; the tool disappears on page reload. Column selections use localStorage (per-org, 90-day TTL).</li>
        <li>Read-only: it never creates, modifies, or deletes any Salesforce data.</li>
        <li>No installation required &mdash; no package, no Connected App, no admin approval.</li>
      </ul>
    </div>
  </details>

  <div style="text-align:center;color:var(--muted);font-size:12px;margin-top:14px;line-height:1.6">
    Data 360 Inspector &middot; internal tool for Salesforce Data Cloud<br>
    Questions, bugs, or ideas? &#128231; <a href="https://mail.google.com/mail/?view=cm&amp;fs=1&amp;to=ljoshi@salesforce.com&amp;su=Data%20360%20Inspector" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">ljoshi@salesforce.com</a> <button type="button" class="dc-copy-email" data-email="ljoshi@salesforce.com" title="Copy email address" style="border:1px solid var(--line);background:#fff;color:var(--muted);border-radius:5px;padding:1px 7px;font-size:11px;cursor:pointer;vertical-align:middle">Copy</button> &nbsp;&middot;&nbsp; &#128172; <a href="https://salesforce.enterprise.slack.com/team/U06F0T5PFUP" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">Slack</a>
  </div>

</div>
<script>
// Copy-email buttons — universal fallback when the Gmail link can't open (multiple
// Google accounts, non-Gmail mail client, etc.). Click = copy address + confirm.
(function(){
  function copyEmail(btn){
    var email = btn.getAttribute("data-email") || "";
    var done = function(){ var t = btn.textContent; btn.textContent = "✓ Copied"; setTimeout(function(){ btn.textContent = t; }, 1400); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(email).then(done).catch(function(){ legacy(); }); }
      else legacy();
    } catch(e){ legacy(); }
    function legacy(){
      try { var ta = document.createElement("textarea"); ta.value = email; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); done(); } catch(e2){}
    }
  }
  var btns = document.querySelectorAll(".dc-copy-email");
  for (var i=0;i<btns.length;i++){ btns[i].addEventListener("click", function(e){ e.preventDefault(); copyEmail(this); }); }
})();
(function(){
  var BUILD_ID = ${JSON.stringify(buildId || "")};
  var KEY = "dc-inspector-installed-build";
  var statusEl = document.getElementById("dc-update-status");
  var banner = document.getElementById("dc-update-banner");
  if (!statusEl || !BUILD_ID) return;

  // Read from localStorage OR cookie (whichever works in this env)
  function readMark() {
    try { var v = localStorage.getItem(KEY); if (v) return v; } catch(e){}
    var m = document.cookie.match(new RegExp("(?:^|; )" + KEY + "=([^;]+)"));
    return m ? m[1] : null;
  }
  function writeMark() {
    try { localStorage.setItem(KEY, BUILD_ID); } catch(e){}
    document.cookie = KEY + "=" + BUILD_ID + ";path=/;max-age=31536000;SameSite=Lax";
  }

  var seen = readMark();
  if (seen === BUILD_ID) {
    // Up to date — hide banner, show nothing
    if (banner) banner.style.display = "none";
    return;
  }
  if (seen) {
    // Outdated — red urgent banner
    statusEl.innerHTML = "&#128680; <strong>NEW UPDATE AVAILABLE!</strong> Delete your old bookmark and re-drag the button below.";
    statusEl.style.background = "#fef2f2"; statusEl.style.color = "#dc2626";
    if (banner) { banner.style.borderColor = "#dc2626"; banner.style.background = "#fef2f2"; banner.style.animation = "dcpulse 1.5s infinite"; }
  }
  // else: first visit — show default banner (amber, instructions already in HTML)

  // Mark installed only when the drag completes OUTSIDE the page (= dropped on
  // bookmarks bar) or when user clicks the link. A simple mousedown/dragstart is
  // NOT enough — user may just move the mouse without actually adding the bookmark.
  var bmLink = document.querySelector("a.bm");
  if (bmLink) {
    function hideBanner() {
      writeMark();
      if (banner) {
        banner.style.transition = "opacity .3s";
        banner.style.opacity = "0";
        setTimeout(function(){ banner.style.display = "none"; }, 300);
      }
    }
    // dragend fires after the drag is released. If dropped outside the page
    // (bookmarks bar), dropEffect is "copy"/"link"/"move". If cancelled (dropped
    // back on page or ESC), dropEffect is "none".
    bmLink.addEventListener("dragend", function(e) {
      if (e.dataTransfer && e.dataTransfer.dropEffect !== "none") {
        hideBanner();
      }
    });
    // Fallback: if user clicks the link (some browsers navigate to javascript:),
    // also treat it as installed.
    bmLink.addEventListener("click", function(e) {
      e.preventDefault();
      hideBanner();
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
// Bookmarklet payload comes from the BOOKMARKLET source (already ext-only-free, per
// the drift check). Public = that source with in-dev @strip blocks removed.
const publicBmCode = stripDev(bmSource);
const pub = makePayload(minifyForBookmarklet(publicBmCode, "public"), "public");
fs.writeFileSync(path.join(dir, "console-decorate.min.js"), pub.loader + "\n");
fs.writeFileSync(path.join(dir, "bookmarklet.txt"), pub.bm);
const pubHtml = makeHtml(pub.hrefSafe, false, buildIdOf(pub.b64));
verifyHtml(pubHtml, pub.loader, "public");
// Accuracy guard: the PUBLIC page must not advertise features stripped from the
// public bookmarklet, nor leak internal example field names. Checked on the fresh
// HTML string (not a stale file) so it can never ship wrong.
(function verifyPublicHtmlAccuracy(html) {
  // Dev-only page/feature names & buttons that must never appear on the public page,
  // in ANY markup (accordion row name, chip, or button pill).
  const forbidden = [
    [/acc-nm">Data Explorer</, "Data Explorer accordion row (stripped from public)"],
    [/acc-nm">Segment</, "Segment accordion row (stripped from public)"],
    [/acc-nm">Query Editor</, "Query Editor accordion row (stripped from public)"],
    [/acc-nm">Data Transform</, "Data Transform accordion row (stripped from public)"],
    [/Data Model \(ERD\)/, "Data Model / ERD (dev-only, stripped from public)"],
    [/acc-nm">Data Graph</, "Data Graph accordion row (dev-only, stripped from public)"],
    [/chip">Data Graph</, "Data Graph chip (dev-only, stripped from public)"],
    [/chip">Data Explorer</, "Data Explorer chip (stripped from public)"],
    [/chip">Segment</, "Segment chip (stripped from public)"],
    [/Export Rules/, "Export Rules launcher (Segment)"],
    [/Export ALL/, "Export ALL launcher (Query Editor)"],
    [/Helpful Queries/, "Helpful Queries launcher (Query Editor)"],
    [/View Definition/, "View Definition launcher (Data Transform)"],
    [/birth\s*date|birthdt|ssot__birthdate/i, "internal 'Birth Date' example"],
    [/account number|customer_account_number/i, "internal 'Account Number' example"],
  ];
  for (const [re, what] of forbidden) {
    if (re.test(html)) {
      console.error("ERROR: public install page advertises/leaks '" + what + "' — public build must not. Aborting.");
      process.exit(1);
    }
  }
})(pubHtml);
fs.writeFileSync(path.join(dir, "install.html"), pubHtml);

// ═══ FULL build (local dev only — DO NOT push) ═══
// Full bookmarklet = the bookmarklet source as-is (ext-only-free by construction).
const fullBmCode = bmSource;
const full = makePayload(minifyForBookmarklet(fullBmCode, "full"), "full");
fs.writeFileSync(path.join(dir, "console-decorate-full.min.js"), full.loader + "\n");
fs.writeFileSync(path.join(dir, "bookmarklet-full.txt"), full.bm);

// ---- SIZE CHECK: FULL/dev bookmarklet vs the 2 MB browser bookmark-URL cap ----
// Only the FULL bookmarklet is watched (the public one sits ~19% and isn't a
// concern). The measured value is the actual `javascript:` URL that gets stored in
// the bookmark — that is what the 2^21-byte limit applies to. Warn at 75%, and
// HARD-FAIL past 100% (a bookmark URL over the cap truncates silently in-browser,
// which would ship a broken bookmarklet).
(function checkFullBookmarkletSize() {
  const LIMIT = 2 * 1024 * 1024;           // 2,097,152 bytes
  const WARN = Math.floor(LIMIT * 0.75);   // 75% soft line
  const n = Buffer.byteLength(full.bm, "utf8");
  const pct = (n / LIMIT * 100).toFixed(1);
  const line = "FULL bookmarklet size: " + n.toLocaleString() + " bytes = " + pct +
               "% of 2MB  (" + Math.round((LIMIT - n) / 1024) + "KB free)";
  if (n >= LIMIT) {
    console.error("ERROR: " + line + " — AT/OVER the 2MB bookmark cap; it would truncate and break. " +
      "Move heavy in-dev features to @ext-only (extension), or trim. Aborting.");
    process.exit(1);
  } else if (n >= WARN) {
    console.warn("⚠ WARNING: " + line + " — past the 75% soft limit. Consider moving heavy " +
      "features to @ext-only so they ship only in the extension, not the bookmarklet.");
  } else {
    console.log("  ✓ " + line);
  }
})();
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

// ---- PUBLIC extensions (Chrome + Firefox) for the WEB STORE ------------------
// The FULL chrome-extension/ above is the internal dev vehicle (includes the AI
// feature + an internal SF gateway host) and must NOT be published. This block
// emits a CLEAN, store-safe extension from the STRIPPED public code:
//   - inject.js  = publicCode (mapping + DS/DLO/DMO only; AI already @strip'd out)
//   - background = ONLY the toolbar-click injector (no SQL relay, no AI, no sid read)
//   - NO bridge.js (public features inject directly; they never use the bridge)
//   - manifest   = minimal perms (scripting, activeTab) + Salesforce hosts ONLY
//                  (no `cookies`, no `storage`, no AI/internal hosts)
// This matches the public listing's promise: read-only, nothing leaves the browser.
if (fs.existsSync(extDir)) {
  const pubExtDir = path.join(dir, "chrome-extension-public");
  const pubFfDir  = path.join(dir, "firefox-extension-public");
  try { fs.mkdirSync(pubExtDir, { recursive: true }); } catch (e) {}

  // Minimal background: the toolbar click toggles the tool by injecting the public
  // code into the page's MAIN world. Nothing else. (Same toggle contract: 2nd run
  // tears down.) Cross-browser via the browser/chrome alias.
  const PUBLIC_BG =
`/*
 * PUBLIC build — Data 360 Inspector (Chrome Web Store / Firefox AMO).
 * Toolbar-icon click injects the inspector into the page's MAIN world.
 * MAIN world is required to read Salesforce Lightning component properties
 * that hold the API names we display. Clicking again tears it down (toggle).
 * READ-ONLY. No network calls of any kind — nothing leaves the browser.
 */
var api = (typeof browser !== "undefined") ? browser : chrome;
api.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await api.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      world: "MAIN",
      files: ["inject.js"],
    });
  } catch (e) {}
});
`;

  // Minimal, store-safe manifest: no cookies, no storage, no AI/internal hosts.
  const chromeManifestFull = JSON.parse(fs.readFileSync(path.join(extDir, "manifest.json"), "utf8"));
  const sfHosts = [
    "https://*.lightning.force.com/*",
    "https://*.salesforce.com/*",
    "https://*.salesforce-setup.com/*",
    "https://*.force.com/*",
  ];
  const pubChromeManifest = {
    manifest_version: 3,
    name: "Data 360 Inspector",
    version: chromeManifestFull.version,
    description: "Read-only developer tool for Salesforce Data Cloud / Data 360. Reveals API (developer) names on the DLO→DMO mapping canvas and exports Data Stream / DLO / DMO field lists. Nothing leaves your browser.",
    icons: chromeManifestFull.icons,
    action: chromeManifestFull.action,
    permissions: ["scripting", "activeTab"],
    host_permissions: sfHosts,
    content_scripts: [
      { matches: sfHosts, js: ["inject.js"], run_at: "document_idle", all_frames: false }
    ],
    background: { service_worker: "background.js" },
  };
  // NOTE: content_scripts here would double-inject with the click handler; the tool
  // self-guards (2nd run = teardown), but to avoid a load-time auto-inject we DROP the
  // content_scripts entry — injection is user-initiated via the toolbar click only.
  delete pubChromeManifest.content_scripts;

  fs.writeFileSync(path.join(pubExtDir, "inject.js"), publicCode);
  fs.writeFileSync(path.join(pubExtDir, "background.js"), PUBLIC_BG);
  fs.writeFileSync(path.join(pubExtDir, "manifest.json"), JSON.stringify(pubChromeManifest, null, 2) + "\n");
  // icons (reuse)
  const pubIcons = path.join(pubExtDir, "icons"); try { fs.mkdirSync(pubIcons, { recursive: true }); } catch (e) {}
  const srcIcons = path.join(extDir, "icons");
  if (fs.existsSync(srcIcons)) for (const ic of fs.readdirSync(srcIcons)) { if (/^icon\d+\.(png|ico)$/i.test(ic)) fs.copyFileSync(path.join(srcIcons, ic), path.join(pubIcons, ic)); }
  // remove any stale bridge.js (public build must not ship it)
  try { fs.unlinkSync(path.join(pubExtDir, "bridge.js")); } catch (e) {}

  // Firefox public variant
  try { fs.mkdirSync(pubFfDir, { recursive: true }); } catch (e) {}
  const pubFfManifest = JSON.parse(JSON.stringify(pubChromeManifest));
  pubFfManifest.background = { scripts: ["background.js"] };
  pubFfManifest.browser_specific_settings = { gecko: { id: "data360-inspector@ljoshi30", strict_min_version: "128.0" } };
  fs.writeFileSync(path.join(pubFfDir, "inject.js"), publicCode);
  fs.writeFileSync(path.join(pubFfDir, "background.js"), PUBLIC_BG);
  fs.writeFileSync(path.join(pubFfDir, "manifest.json"), JSON.stringify(pubFfManifest, null, 2) + "\n");
  const pubFfIcons = path.join(pubFfDir, "icons"); try { fs.mkdirSync(pubFfIcons, { recursive: true }); } catch (e) {}
  if (fs.existsSync(srcIcons)) for (const ic of fs.readdirSync(srcIcons)) { if (/^icon\d+\.(png|ico)$/i.test(ic)) fs.copyFileSync(path.join(srcIcons, ic), path.join(pubFfIcons, ic)); }

  // GUARD: the public extension must NEVER contain AI/internal-host strings.
  const forbidden = ["anthropic", "openai", "googleapis", "sfproxy", "sfdc.cl", "dc-ai-explain", "cookies"];
  for (const dirp of [pubExtDir, pubFfDir]) {
    for (const f of ["inject.js", "background.js", "manifest.json"]) {
      const content = fs.readFileSync(path.join(dirp, f), "utf8").toLowerCase();
      for (const bad of forbidden) {
        if (content.includes(bad)) {
          console.error("ERROR: public extension " + path.join(dirp, f) + " contains forbidden token '" + bad + "'; aborting.");
          process.exit(1);
        }
      }
    }
  }
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

// ---- sync the built extension output into the two extension repos ----
// Local file copy only (no git). Keeps datacloud-inspector-extension-dev (private)
// and datacloud-inspector-extension (public) working dirs current after every
// build. Wrapped so a missing/failed sync never aborts the build itself.
try {
  require("./publish-extensions.js");
} catch (e) {
  console.warn("NOTE: extension sync skipped (" + e.message + "). Run `node publish-extensions.js` manually if needed.");
}
