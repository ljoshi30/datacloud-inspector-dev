/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v39 — Data Stream / DLO fields table: diagnose the SFTP "hover shows
 * nothing" case + find a STABLE row key so formula-hover stops depending on full
 * row/data count alignment (virtualization-proof).
 *
 * Captures, for each field datatable:
 *   • dataLen vs renderedDataRowCount  → confirms/denies virtualization (rendered < data)
 *   • keyField of the datatable        → the property that identifies a row
 *   • first rendered <tr>'s attributes (data-row-key-value etc.) → so we can match by key
 *   • whether data[] rows carry isFormulaField / formula (works on DLO too)
 *
 * RUN on the stream/DLO where hover DIDN'T work (e.g. the SFTP connector stream).
 * Read-only; copies JSON. Click once.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe39() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v39", href: location.href, fieldDatatables: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 20) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function attrsOf(el) { var o = {}; try { var a = el.attributes; for (var i = 0; i < a.length; i++) o[a[i].name] = String(a[i].value).slice(0, 60); } catch (e) {} return o; }
  function byTag(t) { var o = []; eachEl(document, 0, function (el) { if (tag(el) === t) o.push(el); }); return o; }
  function val(v) { return typeof v === "string" ? v.slice(0, 120) : v; }

  byTag("runtime_cdp-custom-datatable").forEach(function (dt, idx) {
    var cols = []; try { cols = (dt.columns || []).map(function (c) { return c && (c.fieldName || c.label); }); } catch (e) {}
    var isFieldTable = cols.indexOf("headerLabel") >= 0 && cols.indexOf("fieldLabel") >= 0;
    if (!isFieldTable) return;
    var data = null; try { data = dt.data; } catch (e) {}
    var keyField = null; try { keyField = dt.keyField; } catch (e) {}

    // rendered data rows
    var sr = dt.shadowRoot || dt, trs = [], dataTrs = [];
    try { var tb = sr.querySelector("tbody"); trs = (tb || sr).querySelectorAll("tr"); } catch (e) {}
    for (var i = 0; i < trs.length; i++) { var has = false; try { has = !!trs[i].querySelector("th,td"); } catch (e) {} if (has) dataTrs.push(trs[i]); }

    // first 2 rendered rows: attributes (to find data-row-key-value) + each cell's data-label + which cell holds a check icon
    var sampleRows = dataTrs.slice(0, 2).map(function (tr) {
      var cells = [];
      try {
        var cs = tr.querySelectorAll("th,td");
        for (var k = 0; k < cs.length; k++) {
          var c = cs[k];
          var dl = ""; try { dl = c.getAttribute("data-label") || c.getAttribute("aria-label") || ""; } catch (e) {}
          var hasCheck = false; try { var u = c.querySelector("use,lightning-primitive-icon,lightning-icon,svg"); if (u) { var h = (u.getAttribute && (u.getAttribute("xlink:href") || u.getAttribute("href") || u.getAttribute("icon-name"))) || ""; hasCheck = /check/i.test(h); } } catch (e) {}
          cells.push({ i: k, dataLabel: dl, hasCheckIcon: hasCheck });
        }
      } catch (e) {}
      return { trAttrs: attrsOf(tr), cells: cells };
    });

    // sample formula rows from data[]
    var formulaSample = [];
    try { if (Array.isArray(data)) for (var j = 0; j < data.length && formulaSample.length < 2; j++) { var r = data[j]; if (r && String(r.isFormulaField).toLowerCase() === "true") formulaSample.push({ index: j, keyFieldValue: keyField ? val(r[keyField]) : undefined, fieldName: val(r.fieldName), fieldLabel: val(r.fieldLabel), formula: val(r.formula) }); } } catch (e) {}

    out.fieldDatatables.push({
      index: idx,
      keyField: keyField,
      dataLen: Array.isArray(data) ? data.length : 0,
      renderedDataRowCount: dataTrs.length,
      VIRTUALIZED: (Array.isArray(data) && dataTrs.length > 0 && dataTrs.length < data.length),
      columns: cols,
      sampleRenderedRows: sampleRows,
      formulaRowCount: (Array.isArray(data) ? data.filter(function (r) { return r && String(r.isFormulaField).toLowerCase() === "true"; }).length : 0),
      formulaSample: formulaSample
    });
  });

  out.notes.push("field datatables: " + out.fieldDatatables.length);
  var virt = out.fieldDatatables.filter(function (t) { return t.VIRTUALIZED; });
  if (virt.length) out.notes.push("⚠ VIRTUALIZED table(s) found — rendered rows < data length. This is why index-alignment hover fails; need key-based matching (keyField shown above).");
  else out.notes.push("No virtualization seen in the CURRENTLY rendered tables (scroll the field list and re-run if the failing stream is long).");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(820px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v39 — field table virtualization + row key (formula hover)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
