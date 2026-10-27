/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v38 — DATA STREAM fields datatable (for the hover-formula feature).
 *
 * Confirms, on a Data Stream page that HAS a formula field, how the field rows
 * render: which runtime_cdp-custom-datatable holds the fields, what each row's
 * data props look like (isFormulaField / formula / headerLabel / fieldLabel),
 * and how the rendered <tr> rows line up with data[] (so we can anchor a hover
 * popover on the right row). Read-only; copies JSON to the clipboard.
 *
 * RUN on a Data Stream detail page that has at least one FORMULA field. Click
 * once; no hover needed.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe38() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v38", href: location.href, fieldDatatables: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 20) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80); } catch (e) { return ""; } }

  function shape(o, depth) {
    if (o == null || depth > 3) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 120) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 40) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } if (typeof v === "function") { r[k] = "fn"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }

  function byTag(t) { var o = []; eachEl(document, 0, function (el) { if (tag(el) === t) o.push(el); }); return o; }

  byTag("runtime_cdp-custom-datatable").forEach(function (dt, idx) {
    var cols = []; try { cols = (dt.columns || []).map(function (c) { return c && (c.fieldName || c.label); }); } catch (e) {}
    var data = null; try { data = dt.data; } catch (e) {}
    var isFieldTable = false; try { isFieldTable = cols.indexOf("headerLabel") >= 0 && cols.indexOf("fieldLabel") >= 0; } catch (e) {}
    // rendered <tr> rows (to see how they map to data[] by index)
    var sr = dt.shadowRoot || dt, trs = [], dataTrs = [];
    try { var tb = sr.querySelector("tbody"); trs = (tb || sr).querySelectorAll("tr"); } catch (e) {}
    for (var i = 0; i < trs.length; i++) { var has = false; try { has = !!trs[i].querySelector("th,td"); } catch (e) {} if (has) dataTrs.push(trs[i]); }
    // the FIRST formula row's data + its rendered row text, so we can confirm alignment
    var formulaRows = [];
    try { if (Array.isArray(data)) for (var j = 0; j < data.length && formulaRows.length < 3; j++) { var r = data[j]; if (r && String(r.isFormulaField).toLowerCase() === "true") formulaRows.push({ index: j, data: shape(r, 0), renderedRowText: dataTrs[j] ? txt(dataTrs[j]) : "(no tr at index)" }); } } catch (e) {}
    out.fieldDatatables.push({
      index: idx,
      isFieldTable: isFieldTable,
      columns: cols,
      dataLen: Array.isArray(data) ? data.length : 0,
      renderedDataRowCount: dataTrs.length,
      firstRow: (Array.isArray(data) && data.length) ? shape(data[0], 0) : "(no data)",
      formulaRowCount: (Array.isArray(data) ? data.filter(function (r) { return r && String(r.isFormulaField).toLowerCase() === "true"; }).length : 0),
      formulaRowsSample: formulaRows
    });
  });

  out.notes.push("custom-datatables found: " + out.fieldDatatables.length);
  var fieldTbl = out.fieldDatatables.filter(function (t) { return t.isFieldTable; });
  out.notes.push("field datatables (headerLabel+fieldLabel): " + fieldTbl.length);
  var anyFormula = fieldTbl.some(function (t) { return t.formulaRowCount > 0; });
  if (!anyFormula) out.notes.push("No formula field found — open a Data Stream that HAS a formula field, then re-run.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(820px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v38 — Data Stream fields datatable (formula hover)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
