/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v51 — DMO detail Fields table: row rendering, for a VISIBLE
 * Standard/Custom badge. We already read creationType off data[] (readDmoFields),
 * but to anchor a badge on the RIGHT row we must confirm: does rendered <tr> count
 * == data.length (align by index)? is there a stable row key? where is the label
 * cell? and are creationType values actually present per row? Never guess the row
 * mapping — a wrong badge ("Custom" on a standard field) would be a silent bug.
 *
 * RUN on a DMO detail page with the FIELDS tab showing. Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe51() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v51", href: location.href, fieldTables: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 24) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function attrsOf(el) { var o = {}; try { var a = el.attributes; for (var i = 0; i < a.length; i++) o[a[i].name] = String(a[i].value).slice(0, 50); } catch (e) {} return o; }

  function byTag(t) { var o = []; eachEl(document, 0, function (el) { if (tag(el) === t) o.push(el); }); return o; }

  byTag("runtime_cdp-custom-datatable").forEach(function (dt, idx) {
    var cols = []; try { cols = (dt.columns || []).map(function (c) { return c && (c.fieldName || c.label); }); } catch (e) {}
    var isFieldTable = false; try { isFieldTable = cols.indexOf("isMapped") >= 0; } catch (e) {}
    if (!isFieldTable) return;
    var data = null, keyField = null; try { data = dt.data; } catch (e) {} try { keyField = dt.keyField; } catch (e) {}
    // rendered data rows
    var sr = dt.shadowRoot || dt, trs = [], dataTrs = [];
    try { var tb = sr.querySelector("tbody"); trs = (tb || sr).querySelectorAll("tr"); } catch (e) {}
    for (var i = 0; i < trs.length; i++) { var has = false; try { has = !!trs[i].querySelector("th,td"); } catch (e) {} if (has) dataTrs.push(trs[i]); }
    // first 2 rows: tr attrs (row key?) + each cell's data-label + whether it holds the label text
    var sample = dataTrs.slice(0, 2).map(function (tr, ri) {
      var cells = [];
      try { var cs = tr.querySelectorAll("th,td"); for (var k = 0; k < cs.length; k++) { var c = cs[k]; var dl = ""; try { dl = c.getAttribute("data-label") || ""; } catch (e) {} var t2 = ""; try { t2 = (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30); } catch (e) {} cells.push({ i: k, dataLabel: dl, text: t2 }); } } catch (e) {}
      return { trAttrs: attrsOf(tr), cells: cells, dataAtIndex: (Array.isArray(data) && data[ri]) ? { label: data[ri].label, name: data[ri].name, creationType: data[ri].creationType } : null };
    });
    var creationTypes = {};
    try { if (Array.isArray(data)) data.forEach(function (r) { if (r) { var ct = String(r.creationType || "(blank)"); creationTypes[ct] = (creationTypes[ct] || 0) + 1; } }); } catch (e) {}
    out.fieldTables.push({
      index: idx, keyField: keyField, columns: cols,
      dataLen: Array.isArray(data) ? data.length : 0,
      renderedRowCount: dataTrs.length,
      ALIGNED: (Array.isArray(data) && dataTrs.length > 0 && dataTrs.length === data.length),
      creationTypeValues: creationTypes,
      sampleRows: sample
    });
  });

  out.notes.push("field tables (isMapped col): " + out.fieldTables.length);
  var ft = out.fieldTables[0];
  if (!ft) out.notes.push("No DMO field table found — open a DMO detail page on the FIELDS tab, then re-run.");
  else {
    out.notes.push(ft.ALIGNED ? "✓ rendered rows == data length → align by INDEX." : "✗ rendered != data (virtualized?) — need a row key; see sampleRows.trAttrs.");
    out.notes.push("creationType values seen: " + JSON.stringify(ft.creationTypeValues));
  }

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v51 — DMO field table rows (Standard/Custom badge)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
