/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v34 — DATA GRAPH builder API names (NO HOVER needed).
 *
 * v33 relied on hovering the exact field — fragile (the tracker caught page chrome).
 * v34 is deterministic: it finds the KNOWN Data Graph components (discovered in the last
 * probe: runtime_cdp-dao-editor-tree-grid / -tree-grid-row / -tree-grid-cell on the LEFT,
 * runtime_cdp-dao-editor-fields + runtime_cdp-custom-datatable + lightning-datatable on the
 * RIGHT) and dumps their JS DATA props so we can see WHERE the field/object API names live.
 *
 * RUN on the Data Graph builder (Fields view). Read-only; copies JSON. Just click once —
 * no hover. Click a LEFT object first so the right panel has fields, then run.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe34() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { href: location.href, leftTreeRows: [], rightFieldRows: [], datatableData: null, treeGridData: null, notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 18) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i]); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50); } catch (e) { return ""; } }
  function byTag(t) { var out = []; eachEl(document, 0, function (el) { if (tag(el) === t) out.push(el); }); return out; }

  // Compact view of an object: for each OWN key, the type and (for strings) the value.
  // Lets us SEE the shape even when api-name keys are named unusually. Depth-limited.
  function shape(o, depth) {
    if (o == null || depth > 3) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 60) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) {
      if (n++ > 25) { r["…"] = "(more)"; break; }
      var v; try { v = o[k]; } catch (e) { continue; }
      if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; }
      r[k] = shape(v, depth + 1);
    }
    return r;
  }
  // The LWC data property on an element is usually one of these.
  function lwcData(el) {
    var keys = ["data", "columns", "node", "row", "item", "record", "field", "fields", "attribute",
      "treeNode", "rowData", "value", "_node", "_data", "entity", "objectInfo", "selectedObject"];
    var found = {};
    keys.forEach(function (k) { try { if (el[k] != null && typeof el[k] !== "function") found[k] = shape(el[k], 0); } catch (e) {} });
    return found;
  }

  // LEFT tree: runtime_cdp-tree-grid-row (the DMO/CI nodes)
  byTag("runtime_cdp-tree-grid-row").slice(0, 8).forEach(function (el) {
    out.leftTreeRows.push({ text: txt(el), props: lwcData(el) });
  });
  // the tree grid container (may hold the whole node list)
  var tg = byTag("runtime_cdp-dao-editor-tree-grid")[0];
  if (tg) out.treeGridData = lwcData(tg);

  // RIGHT fields panel + its datatable. EXPAND the first data row + all columns FULLY (deeper
  // shape) so we can see the field-API-name key. There are TWO custom-datatables (the dialog
  // Fields tab + the dao-editor right panel) — dump BOTH, and prefer the one under dao-editor.
  var fp = byTag("runtime_cdp-dao-editor-fields")[0];
  if (fp) out.rightFieldsPanel = lwcData(fp);
  var cdts = byTag("runtime_cdp-custom-datatable").concat(byTag("lightning-datatable"));
  out.datatables = cdts.slice(0, 4).map(function (cdt, i) {
    var o = { index: i, tag: tag(cdt) };
    try { o.firstRow = cdt.data && cdt.data.length ? shape(cdt.data[0], 0) : "(no data[])"; } catch (e) { o.firstRow = "ERR:" + e; }
    try { o.columns = cdt.columns ? cdt.columns.map(function (c) { return shape(c, 1); }) : "(no columns)"; } catch (e) { o.columns = "ERR:" + e; }
    try { o.dataLen = cdt.data ? cdt.data.length : 0; } catch (e) {}
    return o;
  });
  // also the dao-editor-fields panel's own data, expanded one level deeper
  if (fp) { try { out.fieldsPanelDeep = { fields: fp.fields ? shape(fp.fields, 0) : undefined, data: fp.data ? shape(fp.data, 0) : undefined, selectedObject: fp.selectedObject ? shape(fp.selectedObject, 0) : undefined }; } catch (e) {} }

  // the actual field rows in the datatable (tr with cells)
  var frows = [];
  eachEl(document, 0, function (el) {
    if (tag(el) === "runtime_cdp-tree-grid-cell") return;   // left cells, skip
    if (tag(el) === "tr" && txt(el) && /gridcell|rowheader/i.test((function () { var r = ""; try { r = el.getAttribute("role") || ""; for (var i = 0; i < el.children.length; i++) r += " " + (el.children[i].getAttribute && el.children[i].getAttribute("role") || ""); } catch (e) {} return r; })())) frows.push(el);
  });
  out.notes.push("datatable <tr> rows found: " + frows.length);
  out.rightFieldRows = frows.slice(0, 6).map(function (el) { return { text: txt(el), props: lwcData(el) }; });

  out.customTagsPresent = (function () { var s = {}; eachEl(document, 0, function (el) { var t = tag(el); if (/dao-editor|tree-grid|data-model-tab|custom-datatable/.test(t)) s[t] = (s[t] || 0) + 1; }); return s; })();

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(760px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v34 — Data Graph API names (no hover)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
