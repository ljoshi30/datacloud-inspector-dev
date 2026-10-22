/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v37 — DATA GRAPH *FILTERS* tab. Finds the field chosen in a Sort /
 * Condition dropdown and dumps the component props so we can see whether the real
 * field API name is stored anywhere (so we can read it DIRECTLY instead of guessing
 * from a label cache — which breaks when two fields share a label).
 *
 * RUN on the Data Graph builder → select an object on the LEFT → open the FILTERS
 * tab → pick a Sort Field and add a Condition with a Field. THEN click this. It is
 * read-only and copies JSON to the clipboard. Just click once; no hover.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe37() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = {
    probe: "v37", href: location.href,
    comboboxes: [], conditionRows: [], filterComponents: [],
    selectedLeftObject: null, customTagsPresent: {}, notes: []
  };

  function eachEl(root, d, fn) { if (!root || d > 20) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function attr(el, n) { try { return el.getAttribute(n); } catch (e) { return null; } }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60); } catch (e) { return ""; } }

  // Compact view of a value: for objects, each OWN key → type/(string value). Depth-limited so
  // we SEE the shape even when the api-name key is named unusually.
  function shape(o, depth) {
    if (o == null || depth > 4) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 80) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) {
      if (n++ > 40) { r["…"] = "(more)"; break; }
      var v; try { v = o[k]; } catch (e) { continue; }
      if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; }
      if (typeof v === "function") { r[k] = "fn"; continue; }
      r[k] = shape(v, depth + 1);
    }
    return r;
  }
  // Dump the LWC-ish data props an element may carry.
  function props(el) {
    var keys = ["value", "name", "fieldApiName", "apiName", "field", "fields", "selectedField",
      "selected", "selectedValue", "options", "condition", "conditions", "subject", "filter",
      "filters", "sortBy", "sortField", "sort", "data", "row", "item", "record", "node",
      "attribute", "objectApiName", "entityApiName", "label", "developerName", "columnApiName",
      "_value", "_selectedValue", "primaryObjectName", "targetObjectName"];
    var found = {};
    keys.forEach(function (k) { try { var v = el[k]; if (v != null && typeof v !== "function") found[k] = shape(v, 0); } catch (e) {} });
    // also any own-enumerable props that LOOK like they hold an api/field (defensive net)
    try { for (var k in el) { if (/api|field|subject|condition|sort/i.test(k) && !(k in found)) { try { var v2 = el[k]; if (v2 != null && typeof v2 !== "function") found[k] = shape(v2, 0); } catch (e) {} } } } catch (e) {}
    return found;
  }

  // 1) The LEFT selected object (so we know which object the filter is on).
  eachEl(document, 0, function (el) {
    if (tag(el) === "runtime_cdp-tree-grid-row") {
      var sel = attr(el, "aria-selected") === "true" || /is-selected|slds-is-selected/.test((el.className || "") + "");
      if (sel) { try { out.selectedLeftObject = { text: txt(el), node: shape(el.node, 0) }; } catch (e) {} }
    }
  });

  // 2) Every combobox (Sort Field / Condition Field). Dump props + the visible value + inner input.
  eachEl(document, 0, function (el) {
    var t = tag(el), role = attr(el, "role") || "";
    var isCombo = /combobox/.test(t) || role === "combobox" || t === "lightning-combobox" || t === "lightning-base-combobox" || t === "lightning-grouped-combobox";
    if (!isCombo) return;
    var inner = ""; try { var i2 = (el.shadowRoot || el).querySelector("input"); if (i2) inner = i2.value || ""; } catch (e) {}
    out.comboboxes.push({ tag: t, role: role, shown: txt(el), inputValue: inner, dataLabel: attr(el, "data-label") || attr(el, "name") || "", props: props(el) });
  });

  // 3) The KNOWN Filters-tab components (discovered via v35's tag census). These are where the
  // real filter/sort condition objects live — dump their props DEEP + every own-enumerable key.
  var KNOWN_FILTER_TAGS = [
    "runtime_cdp-dao-editor-filters-tab",
    "runtime_cdp-dao-editor-adhoc-filter-builder",
    "runtime_cdp-dao-editor-adhoc-filter-condition",
    "runtime_cdp-dao-editor-sort",
    "runtime_cdp-dao-editor-sort-limit"
  ];
  function allOwn(el) {
    var r = {};
    try { for (var k in el) { var v; try { v = el[k]; } catch (e) { continue; } if (v == null || typeof v === "function") continue; if (v && typeof v === "object" && (v.nodeType || v === window)) continue; r[k] = shape(v, 0); } } catch (e) {}
    return r;
  }
  eachEl(document, 0, function (el) {
    var t = tag(el);
    var known = KNOWN_FILTER_TAGS.indexOf(t) >= 0;
    var loose = /filter|condition|sort|rank|criteria/i.test(t) && /cdp|dao|runtime|data/i.test(t);
    if (known || loose) {
      out.filterComponents.push({ tag: t, known: known, text: txt(el), props: props(el), allOwnProps: known ? allOwn(el) : undefined });
    }
  });

  // 4) Condition rows rendered as a row structure (label/operator/value triples).
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/condition-row|filter-row|criteria-row/i.test(t)) out.conditionRows.push({ tag: t, text: txt(el), props: props(el) });
  });

  // 5) Census of custom tags present (so if none of the above hit, we still see what IS here).
  out.customTagsPresent = (function () { var s = {}; eachEl(document, 0, function (el) { var t = tag(el); if (/cdp|dao-editor|filter|condition|sort|combobox|rank/i.test(t)) s[t] = (s[t] || 0) + 1; }); return s; })();

  out.notes.push("comboboxes found: " + out.comboboxes.length);
  out.notes.push("filter/condition/sort components: " + out.filterComponents.length);
  out.notes.push("condition rows: " + out.conditionRows.length);
  if (!out.comboboxes.length) out.notes.push("No combobox captured — make sure a Sort Field / Condition Field is SELECTED on the Filters tab before running.");

  // cap arrays so the JSON stays pasteable
  function cap(a, n) { return a.length > n ? a.slice(0, n) : a; }
  out.comboboxes = cap(out.comboboxes, 10);
  out.filterComponents = cap(out.filterComponents, 10);
  out.conditionRows = cap(out.conditionRows, 10);

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(820px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v37 — Data Graph FILTERS tab\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
