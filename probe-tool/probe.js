/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v42 — DATA SPACE DLO filter: FULLY expand the filterGroup tree.
 *
 * v41 found the shape (runtime_cdp-data-spaces-table-filter-group .filterGroup =
 * {filterOperator, filters[], filterGroups[]}; conditions = {object, field,
 * operator, value}) but TRUNCATED the arrays. v42 deep-serializes the whole tree
 * with NO truncation (cycle-safe) so we can see the real AND/OR nesting before
 * building the "export filters to CSV, grouped like segments" feature.
 *
 * It also works out the ROOT group (the one that is not nested inside any other),
 * so the export groups correctly.
 *
 * RUN on the Data Space page with the DLO filter open/visible. Read-only; copies
 * JSON. Click once.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe42() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v42", href: location.href, rootComponentProps: null, groups: [], rootGroupTree: null, notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 22) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }

  // Deep, cycle-safe serialize of a filterGroup / condition — pulls ONLY the fields we care about,
  // recursing fully. Never DOM nodes, never functions. This is what the export will read.
  function cond(f) {
    if (!f) return null;
    var o = f.object || {}, fld = f.field || {}, op = f.operator || {};
    return {
      filterType: f.filterType,
      objectDevName: o.devName, objectLabel: o.label,
      fieldDevName: fld.devName, fieldLabel: fld.label, fieldType: fld.type,
      operatorDevName: op.devName, operatorLabel: op.label,
      value: (f.value === undefined ? null : f.value),
      filterCreationType: f.filterCreationType
    };
  }
  function grp(g, depth, seen) {
    if (!g || depth > 12) return null;
    seen = seen || [];
    if (seen.indexOf(g) >= 0) return { CYCLE: true };
    seen.push(g);
    var filters = [];
    try { if (Array.isArray(g.filters)) filters = g.filters.map(function (f) { return f && f.filterType === "GROUP" ? { GROUP: grp(f, depth + 1, seen) } : cond(f); }); } catch (e) {}
    var subGroups = [];
    try { if (Array.isArray(g.filterGroups)) subGroups = g.filterGroups.map(function (sg) { return grp(sg, depth + 1, seen); }); } catch (e) {}
    return { id: g.id, filterType: g.filterType, filterOperator: g.filterOperator, objectDevName: g.objectDevName, filters: filters, filterGroups: subGroups };
  }

  // Collect every filter-group element's .filterGroup object (dedup by id).
  var byId = {}, order = [];
  eachEl(document, 0, function (el) {
    if (tag(el) !== "runtime_cdp-data-spaces-table-filter-group") return;
    var fg = null; try { fg = el.filterGroup; } catch (e) {}
    if (fg && fg.id && !byId[fg.id]) { byId[fg.id] = fg; order.push(fg.id); }
  });

  // Also grab the root -table-filter component's own props (it may hold the true root tree).
  eachEl(document, 0, function (el) {
    if (tag(el) !== "runtime_cdp-data-spaces-table-filter" || out.rootComponentProps) return;
    var p = {};
    ["cdpDataSpaceRecordId", "cdpDataSpaceMemberId", "objectDevName", "filterGroup", "rootFilterGroup", "filter", "dataset", "value"].forEach(function (k) {
      try { var v = el[k]; if (v == null) return; if (typeof v === "object" && (v.id || v.filterOperator || v.filters)) p[k] = grp(v, 0, []); else if (typeof v !== "object" && typeof v !== "function") p[k] = v; } catch (e) {}
    });
    out.rootComponentProps = p;
  });

  // Build parent/child from ids: a group is a child if its id appears in another group's filterGroups.
  var childIds = {};
  order.forEach(function (id) {
    var g = byId[id];
    try { if (Array.isArray(g.filterGroups)) g.filterGroups.forEach(function (sg) { if (sg && sg.id) childIds[sg.id] = true; }); } catch (e) {}
  });
  var rootIds = order.filter(function (id) { return !childIds[id]; });

  out.groups = order.map(function (id) { var g = byId[id]; return { id: id, filterOperator: g.filterOperator, directFilters: (Array.isArray(g.filters) ? g.filters.length : 0), directGroups: (Array.isArray(g.filterGroups) ? g.filterGroups.length : 0), isRoot: rootIds.indexOf(id) >= 0 }; });
  out.notes.push("distinct groups: " + order.length + " · root group(s): " + rootIds.length);
  if (rootIds.length === 1) out.rootGroupTree = grp(byId[rootIds[0]], 0, []);
  else if (rootIds.length > 1) { out.notes.push("MULTIPLE roots — dumping all"); out.rootGroupTree = rootIds.map(function (id) { return grp(byId[id], 0, []); }); }
  else if (order.length) { out.notes.push("no clear root (cycle?) — dumping first group"); out.rootGroupTree = grp(byId[order[0]], 0, []); }

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v42 — Data Space DLO filter tree (full)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
