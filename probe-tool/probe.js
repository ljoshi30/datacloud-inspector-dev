/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v46 — Data Space OBJECT LIST (no modal). Can we read each DLO's filter
 * WITHOUT opening Edit Filters? The list shows "N Filters applied" per object. This
 * checks whether the list component actually holds the full filter DEFINITION
 * (field/operator/value) in its props, or only the count (→ modal/API required).
 *
 * RUN on the Data Space detail page showing the object LIST (the "N Filters applied"
 * column visible), WITHOUT opening Edit Filters. Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe46() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v46", href: location.href, listComponents: [], tagCensus: {}, filterDataSeen: false, notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }

  function shape(o, depth) {
    if (o == null || depth > 5) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 90) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 50) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } if (typeof v === "function") { r[k] = "fn"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }
  // does a value anywhere inside hold a real filter condition ({field, operator, value} / filterGroup)?
  function hasFilterData(o, depth) {
    if (!o || typeof o !== "object" || depth > 6) return false;
    if (o.filterGroup || (o.field && o.operator) || o.filterType === "CONDITION") return true;
    for (var k in o) { try { var v = o[k]; if (v && typeof v === "object" && !v.nodeType && hasFilterData(v, depth + 1)) return true; } catch (e) {} }
    return false;
  }

  // the known list/table components for the Data Space object list + any provider holding rows
  var LIST_TAGS = [
    "runtime_cdp-data-space-objects-lwc",
    "runtime_cdp-data-space-objects",
    "runtime_cdp-data-spaces-detail",
    "runtime_cdp-data-spaces-table",
    "runtime_cdp-custom-datatable"
  ];
  // props on those components that might hold the per-object rows (with their filters)
  var ROW_PROPS = ["objects", "rows", "data", "members", "dataLakeObjects", "objectList", "tableData", "items", "records"];

  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/cdp|dao|data-space|datatable/i.test(t)) out.tagCensus[t] = (out.tagCensus[t] || 0) + 1;
    if (LIST_TAGS.indexOf(t) < 0) return;
    if (out.listComponents.length >= 8) return;
    var entry = { tag: t, rowProps: {} };
    ROW_PROPS.forEach(function (k) {
      try { var v = el[k]; if (v != null && typeof v !== "function" && typeof v === "object") { entry.rowProps[k] = shape(v, 0); if (hasFilterData(v, 0)) out.filterDataSeen = true; } } catch (e) {}
    });
    out.listComponents.push(entry);
  });

  out.notes.push("list components found: " + out.listComponents.length);
  out.notes.push(out.filterDataSeen
    ? "✓ FILTER DEFINITION data is present in a list component → we CAN export from the list, no modal."
    : "✗ no full filter definition in the list props — the list likely has only the COUNT; conditions load on Edit Filters (modal or API needed).");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v46 — Data Space object list (filters without a modal?)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
