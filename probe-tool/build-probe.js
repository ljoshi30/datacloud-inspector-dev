/* Build the DOM Probe into a draggable bookmarklet + a tiny install page.
 * Standalone — nothing to do with the main inspector build.
 *   node probe-tool/build-probe.js
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const dir = __dirname;
const srcPath = path.join(dir, "probe.js");
const src = fs.readFileSync(srcPath, "utf8");

// minify with the repo's esbuild if present, else ship unminified (it's small)
let code = src;
try {
  const esbuild = path.join(dir, "..", "node_modules", ".bin", "esbuild");
  if (fs.existsSync(esbuild)) {
    const tmp = path.join(dir, ".probe.tmp.js");
    fs.writeFileSync(tmp, src);
    code = execFileSync(esbuild, [tmp, "--minify", "--legal-comments=none"], { encoding: "utf8" });
    fs.unlinkSync(tmp);
  }
} catch (e) { console.warn("esbuild minify skipped:", e.message); }

// bookmarklet payload (base64 to survive quotes/newlines), same scheme as the main tool
const enc = encodeURIComponent(code);
const b64 = Buffer.from(enc, "latin1").toString("base64");
const loader = 'eval(decodeURIComponent(atob("' + b64 + '")))';
// round-trip sanity
const back = decodeURIComponent(Buffer.from(b64, "base64").toString("latin1"));
if (back !== code) { console.error("ERROR: payload does not round-trip; aborting."); process.exit(1); }
const href = "javascript:" + encodeURIComponent(loader);
const hrefSafe = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DOM Probe — drag to install</title>
<style>
  body{font:15px/1.6 -apple-system,system-ui,sans-serif;color:#1e293b;background:#f8fafc;margin:0;padding:40px 20px;display:flex;justify-content:center}
  .card{max-width:620px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:30px 34px;box-shadow:0 10px 40px rgba(0,0,0,.06)}
  h1{font-size:22px;margin:0 0 6px}
  .sub{color:#64748b;margin:0 0 22px}
  .drag{display:inline-block;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;box-shadow:0 4px 14px rgba(67,56,202,.3);cursor:grab}
  .drag:active{cursor:grabbing}
  ol{padding-left:20px} li{margin:7px 0}
  .note{background:#f1f5f9;border-radius:8px;padding:12px 14px;font-size:13px;color:#475569;margin-top:20px}
  code{background:#eef2ff;color:#4338ca;border-radius:4px;padding:1px 6px;font:600 12px SF Mono,monospace}
</style></head><body><div class="card">
  <h1>🔎 DOM Probe — Activation</h1>
  <p class="sub">One-click snapshot of what an Activation page exposes to the bookmarklet → clipboard.</p>
  <p><a class="drag" href="${hrefSafe}">🔎 DOM Probe</a> &nbsp;← drag this to your bookmarks bar</p>
  <ol>
    <li>Drag the button above to your <b>bookmarks bar</b>.</li>
    <li>Open an <b>Activation</b> page (the <b>edit</b> view is best — the /view page may show fewer fields).</li>
    <li>Make sure the attributes / contact points are on screen.</li>
    <li>Click the <b>DOM Probe</b> bookmark → it copies a snapshot to your clipboard.</li>
    <li>Paste it back in chat.</li>
  </ol>
  <div class="note"><b>What it captures (read-only):</b> the attribute inventory a DOM-only export could use — the activation datatable <code>.data[]</code> (name, object, output name), the summary <code>.includedAttributes[]</code> (field API, object API), drag-item details, plus a sniff of membership / segment / channel / target props and each element's full LWC prop-name list (so we see what else is available). No raw HTML; never changes the page.</div>
</div></body></html>`;

fs.writeFileSync(path.join(dir, "index.html"), html);
fs.writeFileSync(path.join(dir, "bookmarklet.txt"), href);
console.log("Built DOM Probe:");
console.log("  probe-tool/index.html      (open, drag the bookmarklet)");
console.log("  probe-tool/bookmarklet.txt (" + href.length + " chars)");
console.log("  payload: " + code.length + " chars raw, base64 " + b64.length);
