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

  // Activation is a MULTI-STEP wizard (progress bar). Each step holds different doc-worthy info
  // (segment/membership, target/channel, contact points, attributes, filters, schedule). The big
  // open question: are ALL steps' elements in the DOM at once, or only the ACTIVE step's? This probe
  // reports the step/progress structure + which step is active so we know whether one capture is
  // enough or whether the export must visit each step (like the segment Include/Exclude/Rank tabs).
  out.wizard = { stepElements: [], progressText: [], activeHints: [] };

  // census of EVERY runtime_cdp-* tag (so we see step/progress/filter/schedule tags we don't know yet)
  raw.forEach(function (el) {
    var t = tag(el);
    if (/^runtime_cdp-/.test(t)) out.tagCensus[t] = (out.tagCensus[t] || 0) + 1;
  });
  // narrow the census to the interesting wizard/step/filter/schedule/target families for readability
  out.stepTagCensus = {};
  Object.keys(out.tagCensus).forEach(function (t) {
    if (/(step|progress|wizard|path|stage|nav|panel|section|publish|schedule|filter|target|contact|activation|segment|member)/.test(t)) out.stepTagCensus[t] = out.tagCensus[t];
  });

  // capture progress-bar / step labels (lightning-progress-indicator, *step*, aria-current, etc.)
  raw.forEach(function (el) {
    var t = tag(el);
    if (/progress|step|path-/.test(t) || /lightning-(progress|path|tab)/.test(t)) {
      var txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
      var cur = "";
      try { cur = el.getAttribute && (el.getAttribute("aria-current") || el.getAttribute("aria-selected") || ""); } catch (e) {}
      if (txt || cur) out.wizard.stepElements.push({ tag: t, text: txt, current: cur });
    }
    // active-step hints: elements marked current/selected
    try {
      if (el.getAttribute) {
        var ac = el.getAttribute("aria-current"), as = el.getAttribute("aria-selected");
        if (ac === "true" || ac === "step" || ac === "page" || as === "true") {
          out.wizard.activeHints.push({ tag: t, text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80), aria_current: ac, aria_selected: as });
        }
      }
    } catch (e) {}
  });
  out.wizard.stepElements = out.wizard.stepElements.slice(0, 30);
  out.wizard.activeHints = out.wizard.activeHints.slice(0, 15);

  // props worth sniffing on any element (membership / segment / channel / target / contact / filter / schedule)
  var SNIFF = ["data", "includedAttributes", "details", "attributes", "contactPoints", "contactPoint",
    "segmentName", "segmentApiName", "segmentDeveloperName", "membershipName", "membership",
    "activationName", "name", "label", "channel", "channelType", "platformName", "platformType",
    "activationTargetName", "targetName", "value", "config", "fieldConfig", "queryPathConfig",
    "dataSpaceName", "developerName", "masterLabel", "entity", "fields", "record",
    "filters", "filter", "criteria", "conditions", "schedule", "publishSchedule", "refreshType",
    "frequency", "startDate", "endDate", "relatedDmoFilters", "directDmoFilters", "step", "stepName", "selected"];

  // dump the key elements — include wizard/step/filter/schedule/target families, not just attributes
  raw.forEach(function (el) {
    var t = tag(el);
    var want = (t === "runtime_cdp-activation-attribute-datatable" ||
      t === "runtime_cdp-activation-summary" ||
      t === "runtime_cdp-drag-item" ||
      /activation|contact-?point|publish|schedule|filter|target|member/.test(t));
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

  // ── FOCUSED summary dump: the runtime_cdp-activation-summary element aggregates the WHOLE activation
  // (segment, target, platform, data space, membership, attributes). Dump its overview prop VALUES in
  // full (not shallow) so we know their exact shapes before building the doc export.
  out.summary = null;
  (function () {
    var el = raw.filter(function (e) { return tag(e) === "runtime_cdp-activation-summary"; })[0];
    if (!el) return;
    var want = ["selectedDataSpace", "selectedDmoLabel", "selectedIdMembership", "selectedDataGraph",
      "selectedSegment", "isSelectedSegmentWaterfall", "waterfallSelectAll", "selectedWaterfallSubsegments",
      "selectedTarget", "selectedPlatformName", "selectedTemplate", "selectedEventType", "selectedEventOptions",
      "selectedPartnerObjects", "selectedMatchBoostProvider", "displaySelectedDmo", "savedCalculatedInsightRecords"];
    var dump = {};
    want.forEach(function (k) {
      var v = get(el, k);
      if (v === undefined) return;
      // full (bounded) serialization so we see exact shapes/values
      try { dump[k] = JSON.parse(JSON.stringify(v)); } catch (e) { dump[k] = String(v); }
    });
    // also the first 2 includedAttributes in FULL to confirm the join keys
    var inc = get(el, "includedAttributes");
    dump._includedAttributes_first2 = Array.isArray(inc) ? inc.slice(0, 2) : inc;
    out.summary = dump;
  })();

  out.notes.push("runtime_cdp tags present: " + Object.keys(out.tagCensus).length + " (step/filter/target families in stepTagCensus)");
  out.notes.push("SUMMARY element " + (out.summary ? "FOUND — see out.summary for the overview field VALUES (segment/target/platform/dataspace/membership). This one element aggregates all steps → no step traversal needed." : "NOT found — open the activation's Review/summary step and re-run."));
  out.notes.push("WIZARD: " + out.wizard.stepElements.length + " step/progress element(s), " + out.wizard.activeHints.length + " active-step hint(s). KEY QUESTION: run this probe on DIFFERENT steps — if each step shows DIFFERENT elements[], the export must VISIT each step (like segment tabs); if all steps' data is present regardless of active step, one capture is enough.");
  if (!out.elements.length) out.notes.push("⚠️ No activation elements found. Are you on the Activation EDIT page (not /view)? Open the activation for edit, make sure a step's content is on screen, then re-run.");
  else out.notes.push("Captured " + out.elements.length + " element(s). Attribute inventory = datatable.data[] (name/entityName/outputName) + summary.includedAttributes[] (attributeName/entityName). Check allLwcPropNames on each for membership/segment/channel/filter/schedule props to pull per step.");
  out.notes.push("TIP: capture once per wizard step (segment, target, contact points, attributes, filters, schedule) so we see which step exposes what, and whether non-active steps are empty.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(960px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v56 — Activation documentation inventory\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
