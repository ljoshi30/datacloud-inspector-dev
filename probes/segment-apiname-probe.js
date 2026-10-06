/* ───────────────────────────────────────────────────────────────────────────
 * Segment builder — API-name probe
 * Run in the browser console ON THE SEGMENT PAGE (the one in the screenshot:
 *   .../runtime_cdp__segmentWizardLanding?...)
 *
 * GOAL: discover the REAL DOM so we can decorate it with API names — WITHOUT
 * guessing. It answers four questions and prints them clearly:
 *   A) LEFT PALETTE  — the "Search Attributes" list + the DMO drill-down items
 *      (e.g. "Birth Date", "First Name", "Individual Additional Information (59)").
 *      Which custom element are they? Do they expose an API name / .field / .entity?
 *   B) USED RULES    — the condition rows on the right (e.g. "Account Multiline
 *      Is Equal To A"). Do they expose .entity.fields[] with {label,name}? (We
 *      already read this for export via apiNamesFor — confirm it's live here.)
 *   C) DUPLICATE LABELS — find labels that appear >1x in the left palette (the
 *      exact pain: same label, different API name) and show their API names.
 *   D) INJECT POINT  — where could we place a small "api name" chip on each row?
 *
 * Paste the WHOLE output back. Nothing is modified on the page.
 * ─────────────────────────────────────────────────────────────────────────── */
(function segmentApiNameProbe() {
  "use strict";
  var OUT = { page: location.href, A_leftPalette: {}, B_usedRules: {}, C_dupLabels: {}, D_inject: {} };

  // deep shadow-DOM walker (same approach as the tool's deepAll)
  function deepAll(root, acc) {
    acc = acc || [];
    var all = [];
    try { all = root.querySelectorAll("*"); } catch (e) { return acc; }
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      acc.push(el);
      if (el.shadowRoot) deepAll(el.shadowRoot, acc);
    }
    return acc;
  }
  function tagOf(el) { try { return (el.tagName || "").toLowerCase(); } catch (e) { return ""; } }
  function safeGet(o, k) { try { return o[k]; } catch (e) { return undefined; } }
  function txt(el) { try { return (el.textContent || "").trim().replace(/\s+/g, " "); } catch (e) { return ""; } }
  function shortTxt(el, n) { var t = txt(el); return t.length > (n || 60) ? t.slice(0, n || 60) + "…" : t; }

  var ALL = deepAll(document);
  console.log("%cSEGMENT API-NAME PROBE", "font:700 14px system-ui;color:#4338ca");
  console.log("total elements (incl. shadow):", ALL.length);

  // ── Tag census: which custom elements are on this page + counts ──────────────
  var census = {};
  ALL.forEach(function (el) { var t = tagOf(el); if (t.indexOf("-") > 0) census[t] = (census[t] || 0) + 1; });
  var censusSorted = Object.keys(census).filter(function (t) {
    return /segment|attribute|field|palette|picker|tree|dmo|entity|condition|list-item|lwc-|runtime_cdp/.test(t);
  }).sort(function (a, b) { return census[b] - census[a]; }).map(function (t) { return t + " ×" + census[t]; });
  OUT.census = censusSorted;
  console.log("%cRelevant custom elements:", "font-weight:700", censusSorted);

  // ── A) LEFT PALETTE ──────────────────────────────────────────────────────────
  // Heuristic: left-rail attribute items are small elements whose text matches a
  // known left label from the screenshot and that live under an attributes panel.
  var KNOWN_LEFT = ["Account Multiline", "Birth Date", "Birth Date Year", "Civic No",
    "Contact Type", "First Name", "Internal Organization", "Last Name", "Primary Language",
    "State Province", "Marital Status", "Party", "Person Name", "Segment Code"];
  var leftHits = [];
  ALL.forEach(function (el) {
    var t = txt(el);
    if (!t) return;
    if (KNOWN_LEFT.indexOf(t) < 0) return;              // exact single-label match only
    if (el.children && el.children.length > 2) return;  // leaf-ish only
    // record this element + what props it exposes
    var props = {};
    ["field", "attribute", "entity", "apiName", "developerName", "name", "value", "data", "item", "node", "record"].forEach(function (k) {
      var v = safeGet(el, k);
      if (v !== undefined && typeof v !== "function") {
        if (v && typeof v === "object") {
          // show a shallow sketch of object props
          var sk = {}; try { Object.keys(v).slice(0, 12).forEach(function (kk) { var vv = v[kk]; sk[kk] = (vv && typeof vv === "object") ? ("<" + (Array.isArray(vv) ? "array[" + vv.length + "]" : "obj") + ">") : vv; }); } catch (e) {}
          props[k] = sk;
        } else props[k] = v;
      }
    });
    // climb a few hosts for an .entity (object the attribute belongs to)
    var entitySketch = null, node = el;
    for (var h = 0; h < 6 && node; h++) {
      var ent = safeGet(node, "entity");
      if (ent) { entitySketch = { tag: tagOf(node), name: safeGet(ent, "name"), label: safeGet(ent, "label"), fieldsLen: safeGet(ent, "fields") && safeGet(ent, "fields").length }; break; }
      try { var rn = node.getRootNode(); node = (rn && rn.host) ? rn.host : node.parentElement; } catch (e) { node = null; }
    }
    leftHits.push({ tag: tagOf(el), label: t, hostTag: el.parentElement ? tagOf(el.parentElement) : "", props: props, entityUp: entitySketch });
  });
  OUT.A_leftPalette = { count: leftHits.length, samples: leftHits.slice(0, 12) };
  console.log("%cA) LEFT PALETTE hits:", "font-weight:700;color:#0d6efd", leftHits.length);
  console.log(leftHits.slice(0, 12));

  // What is the common custom-element tag for those left items?
  var leftTagCensus = {};
  leftHits.forEach(function (h) { leftTagCensus[h.tag] = (leftTagCensus[h.tag] || 0) + 1; });
  OUT.A_leftPalette.tagCensus = leftTagCensus;
  console.log("   left item tags:", leftTagCensus);

  // ── B) USED RULES (right side) ────────────────────────────────────────────────
  var COND_TAGS = ["runtime_cdp-segment-builder-simple-condition",
    "runtime_cdp-segment-builder-aggregation-condition",
    "runtime_cdp-segment-builder-calculated-insight-condition"];
  var condEls = ALL.filter(function (el) { return COND_TAGS.indexOf(tagOf(el)) >= 0; });
  var ruleSamples = condEls.slice(0, 10).map(function (el) {
    // find nearest .entity with fields
    var entity = null, node = el;
    for (var h = 0; h < 6 && node; h++) {
      var ent = safeGet(node, "entity");
      if (ent) { entity = ent; break; }
      try { var rn = node.getRootNode(); node = (rn && rn.host) ? rn.host : node.parentElement; } catch (e) { node = null; }
    }
    var fieldsSketch = null;
    if (entity) {
      var fs = safeGet(entity, "fields");
      if (fs && fs.length) fieldsSketch = Array.prototype.slice.call(fs, 0, 6).map(function (f) { return { label: safeGet(f, "label"), name: safeGet(f, "name"), isPrimaryKey: safeGet(f, "isPrimaryKey") }; });
    }
    return { tag: tagOf(el), text: shortTxt(el, 80), entityName: entity ? safeGet(entity, "name") : null, entityLabel: entity ? safeGet(entity, "label") : null, fieldsSample: fieldsSketch };
  });
  OUT.B_usedRules = { count: condEls.length, samples: ruleSamples };
  console.log("%cB) USED-RULE condition elements:", "font-weight:700;color:#0d6efd", condEls.length);
  console.log(ruleSamples);

  // ── C) DUPLICATE LABELS in the left palette (the core pain) ───────────────────
  // Collect ALL leaf label texts under the Attributes panel region and find repeats.
  var allLeftLabels = {};
  leftHits.forEach(function (h) { (allLeftLabels[h.label] = allLeftLabels[h.label] || []).push(h.entityUp && h.entityUp.name); });
  // broaden: also scan any element whose .field/.entity exposes a label+name pair
  var labelToApis = {};
  ALL.forEach(function (el) {
    var f = safeGet(el, "field") || safeGet(el, "attribute");
    if (f && typeof f === "object") {
      var lbl = safeGet(f, "label"), nm = safeGet(f, "name") || safeGet(f, "apiName") || safeGet(f, "developerName");
      if (lbl && nm) { (labelToApis[lbl] = labelToApis[lbl] || new Set()).add(String(nm)); }
    }
  });
  var dups = {};
  Object.keys(labelToApis).forEach(function (lbl) { if (labelToApis[lbl].size > 1) dups[lbl] = Array.from(labelToApis[lbl]); });
  OUT.C_dupLabels = { fromFieldProp: dups, note: "labels mapping to >1 API name = exactly why users pick the wrong attribute" };
  console.log("%cC) DUPLICATE LABELS (label -> many API names):", "font-weight:700;color:#dc2626", dups);

  // ── D) INJECT POINT ───────────────────────────────────────────────────────────
  // For a left item and a rule row, show the element box so we know where a chip fits.
  function boxOf(el) { try { var r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 }; } catch (e) { return null; } }
  OUT.D_inject = {
    leftSample: leftHits[0] ? { tag: leftHits[0].tag, box: boxOf(document) && leftHits[0] && null } : null,
    note: "see A/B samples; a chip can be appended into each item's shadowRoot or as an overlay"
  };
  if (leftHits[0]) console.log("D) left item box sample is in A samples; inject = append chip span into item element");

  // ── FINAL: copy this ──────────────────────────────────────────────────────────
  try { window.__SEG_PROBE = OUT; } catch (e) {}
  console.log("%c=== COPY EVERYTHING BELOW (or run: copy(JSON.stringify(window.__SEG_PROBE,null,2))) ===", "font:700 12px system-ui;color:#059669");
  try { console.log(JSON.stringify(OUT, function (k, v) { return v instanceof Set ? Array.from(v) : v; }, 2)); } catch (e) { console.log(OUT); }
  return OUT;
})();
