/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v54 — Data Space FILTER edit modal: where does each condition's FIELD
 * render on screen, so we can anchor an API-name chip next to it (like IR/segment).
 * ---------------------------------------------------------------------------
 * We ALREADY read the api from .filterGroup.filters[].field.devName (export works).
 * This probe finds the on-screen anchor: the element showing the field LABEL inside
 * each rendered condition row, + whether the condition element exposes .filter /
 * .condition with the field on it (so we can map row→api WITHOUT guessing).
 *
 * RUN on a Data Space page with the "Edit Filters" modal OPEN (a DLO member filter
 * with at least one condition). Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe54() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v54", href: location.href, tagCensus: {}, conditionEls: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function safe(o, k) { try { return o[k]; } catch (e) { return undefined; } }
  function shadowTexts(root) {
    var acc = [];
    (function walk(r, d) {
      if (!r || d > 8) return;
      var cn = r.childNodes || [];
      for (var i = 0; i < cn.length; i++) {
        var n = cn[i];
        if (n.nodeType === 3) { var t = (n.nodeValue || "").replace(/\s+/g, " ").trim(); if (t) acc.push(t); }
        else if (n.nodeType === 1) { var sr = null; try { sr = n.shadowRoot; } catch (e) {} if (sr) walk(sr, d + 1); walk(n, d + 1); }
      }
    })(root.shadowRoot || root, 0);
    var seen = {}, o = []; for (var j = 0; j < acc.length && o.length < 20; j++) { if (!seen[acc[j]]) { seen[acc[j]] = 1; o.push(acc[j]); } }
    return o;
  }

  // census of condition/filter-ish components
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/filter|condition|data-spaces/.test(t) && t.indexOf("-") > 0) out.tagCensus[t] = (out.tagCensus[t] || 0) + 1;
  });

  // inspect the likely per-condition components for their field data + on-screen text
  var CAND = ["runtime_cdp-data-spaces-table-filter-condition", "runtime_cdp-data-spaces-table-filter-row", "runtime_cdp-data-spaces-filter-condition", "runtime_cdp-data-spaces-table-filter-group"];
  var count = 0;
  eachEl(document, 0, function (el) {
    var t = tag(el);
    var isCand = CAND.indexOf(t) >= 0 || (/data-spaces.*(filter|condition)/.test(t));
    if (!isCand || count >= 6) return;
    count++;
    var rec = { tag: t, text: shadowTexts(el) };
    // look for the field api on common props
    ["filter", "condition", "filterGroup", "field"].forEach(function (p) {
      var v = safe(el, p);
      if (v && typeof v === "object") {
        if (p === "filter" || p === "condition") rec[p] = { fieldLabel: v.field && v.field.label, fieldDevName: v.field && v.field.devName, filterType: v.filterType };
        else if (p === "field") rec.field = { label: v.label, devName: v.devName };
        else if (p === "filterGroup") rec.filterGroup = { id: v.id, nFilters: (v.filters || []).length, firstField: v.filters && v.filters[0] && v.filters[0].field && { label: v.filters[0].field.label, devName: v.filters[0].field.devName } };
      }
    });
    out.conditionEls.push(rec);
  });

  out.notes.push("tag census: " + JSON.stringify(out.tagCensus));
  out.notes.push("condition elements inspected: " + out.conditionEls.length);
  out.notes.push("LOOK FOR: which tag has .filter.field.devName (the api) + a text[] entry equal to the field label (the anchor).");
  if (!out.conditionEls.length) out.notes.push("✗ none found — open the Edit Filters modal with a condition, then re-run. Also paste the tag census.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(900px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v54 — Data Space filter field anchor\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
