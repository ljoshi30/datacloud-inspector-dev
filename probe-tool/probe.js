/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v56 — ACTIVATION documentation inventory. Dumps EVERYTHING a DOM-only
 * (bookmarklet-safe) "Document Activation" export could use, so we confirm the real,
 * reachable fields BEFORE building the feature (no org-specific assumptions).
 * ---------------------------------------------------------------------------
 * It reads the Activation page's shadow DOM the SAME way the tool does and reports,
 * for each relevant LWC element, the useful data props (not raw HTML):
 *   • runtime_cdp-activation-attribute-datatable  → .data[]      (uid, name, entityName, outputName…)
 *   • runtime_cdp-activation-summary              → .includedAttributes[] (uid, label, attributeName, entityName)
 *                                                   + any membership/segment/channel/target props it exposes
 *   • runtime_cdp-drag-item                       → .details     (fieldApiName, objectApiName, label)
 *   • contact-point / target elements             → best-effort prop sniff
 * For each, it prints the FULL key list of a sample object so we can see what ELSE
 * is available that we haven't used yet. Read-only; copies JSON to clipboard.
 *
 * RUN on an Activation page (edit view preferred — the /view page may render fewer props).
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe56() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v56-activation", href: location.href.slice(0, 200), tagCensus: {}, elements: [], notes: [] };

  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function get(el, prop) { try { return el[prop]; } catch (e) { return undefined; } }
  // shallow, safe snapshot of an object: primitive values inline, arrays summarized, nested objects → keys only
  function shallow(o, maxKeys) {
    if (o == null || typeof o !== "object") return o;
    var r = {}, keys = Object.keys(o).slice(0, maxKeys || 40);
    keys.forEach(function (k) {
      var v;
      try { v = o[k]; } catch (e) { v = "<err>"; }
      if (v == null || typeof v !== "object") r[k] = v;
      else if (Array.isArray(v)) r[k] = "[array " + v.length + "]";
      else r[k] = "{obj:" + Object.keys(v).slice(0, 12).join(",") + "}";
    });
    return r;
  }
  function sampleArray(arr, n) {
    if (!Array.isArray(arr)) return { note: "not an array", value: arr == null ? null : typeof arr };
    return { length: arr.length, keysOfFirst: arr[0] ? Object.keys(arr[0]) : [], sample: arr.slice(0, n || 3).map(function (x) { return shallow(x, 30); }) };
  }

  // full shadow-DOM crawl (same as the tool's collectRaw)
  function collectRaw() {
    var acc = [];
    (function walk(root, depth) {
      if (depth > 14) return;
      var all; try { all = root.querySelectorAll("*"); } catch (e) { return; }
      for (var i = 0; i < all.length; i++) { var el = all[i]; acc.push(el); var sr = null; try { sr = el.shadowRoot; } catch (e) {} if (sr) walk(sr, depth + 1); }
    })(document, 0);
    return acc;
  }

  var raw = collectRaw();

  // census of every runtime_cdp-activation* / contact-point / target tag
  raw.forEach(function (el) {
    var t = tag(el);
    if (/^runtime_cdp-(activation|contact|segment|data-stream)/.test(t) || /activation|contactpoint|target|publish/.test(t)) {
      out.tagCensus[t] = (out.tagCensus[t] || 0) + 1;
    }
  });

  // props worth sniffing on any element (membership / segment / channel / target / contact point)
  var SNIFF = ["data", "includedAttributes", "details", "attributes", "contactPoints", "contactPoint",
    "segmentName", "segmentApiName", "segmentDeveloperName", "membershipName", "membership",
    "activationName", "name", "label", "channel", "channelType", "platformName", "platformType",
    "activationTargetName", "targetName", "value", "config", "fieldConfig", "queryPathConfig",
    "dataSpaceName", "developerName", "masterLabel", "entity", "fields", "record"];

  // dump the key elements
  raw.forEach(function (el) {
    var t = tag(el);
    var want = (t === "runtime_cdp-activation-attribute-datatable" ||
      t === "runtime_cdp-activation-summary" ||
      t === "runtime_cdp-drag-item" ||
      /activation/.test(t) || /contact-?point/.test(t));
    if (!want) return;
    var rec = { tag: t, props: {} };
    SNIFF.forEach(function (p) {
      var v = get(el, p);
      if (v === undefined) return;
      if (Array.isArray(v)) rec.props[p] = sampleArray(v, 3);
      else if (v && typeof v === "object") rec.props[p] = shallow(v, 30);
      else rec.props[p] = v;
    });
    // also list ALL own-enumerable prop names on the element's LWC data (so we spot unknown useful props)
    try {
      var names = [];
      for (var k in el) { if (/^[a-z]/.test(k) && typeof el[k] !== "function" && names.length < 60) names.push(k); }
      rec.allLwcPropNames = names;
    } catch (e) {}
    if (Object.keys(rec.props).length || (rec.allLwcPropNames && rec.allLwcPropNames.length)) out.elements.push(rec);
  });

  out.notes.push("activation/contact tags present: " + Object.keys(out.tagCensus).length);
  if (!out.elements.length) out.notes.push("⚠️ No activation datatable/summary/drag-item found. Are you on the Activation EDIT page (not /view)? Try opening the activation for edit, or scroll the attributes into view, then re-run.");
  else out.notes.push("Captured " + out.elements.length + " element(s). Look at datatable.data[] (name/entityName/outputName) + summary.includedAttributes[] (attributeName/entityName) — that's the attribute inventory. Check allLwcPropNames for membership/segment/channel props we can also pull.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(960px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v56 — Activation documentation inventory\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
