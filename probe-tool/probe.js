/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v40 — DLO fields: how does a Data Lake Object page render its field
 * list, and does it carry the `formula` expression like a Data Stream does?
 *
 * v39 only looked at runtime_cdp-custom-datatable with headerLabel+fieldLabel and
 * found NONE on the DLO page. v40 is broader: it dumps EVERY table-like component
 * (runtime_cdp-custom-datatable AND lightning-datatable), their columns + first
 * data row, whether any row carries isFormulaField/formula, and a census of the
 * custom tags present — so we can tell whether the DLO exposes formulas at all.
 *
 * RUN on a DLO detail page. If its Fields section is lower down, SCROLL to it so
 * it renders, THEN click. Read-only; copies JSON. Click once.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe40() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v40", href: location.href, tables: [], fieldishComponents: [], customTagsPresent: {}, notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 20) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function byTag(t) { var o = []; eachEl(document, 0, function (el) { if (tag(el) === t) o.push(el); }); return o; }
  function val(v) { return typeof v === "string" ? v.slice(0, 120) : v; }

  function shape(o, depth) {
    if (o == null || depth > 2) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 80) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 40) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } if (typeof v === "function") { r[k] = "fn"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }

  function dumpTable(dt, idx) {
    var cols = []; try { cols = (dt.columns || []).map(function (c) { return c && (c.fieldName || c.label); }); } catch (e) {}
    var data = null; try { data = dt.data; } catch (e) {}
    var hasFormulaKey = false, formulaSample = null, firstRow = null;
    try {
      if (Array.isArray(data) && data.length) {
        firstRow = shape(data[0], 0);
        for (var j = 0; j < data.length; j++) {
          var r = data[j]; if (!r) continue;
          if (("isFormulaField" in r) || ("formula" in r)) hasFormulaKey = true;
          if (!formulaSample && r && String(r.isFormulaField).toLowerCase() === "true") formulaSample = { index: j, fieldName: val(r.fieldName), fieldLabel: val(r.fieldLabel), isFormulaField: val(r.isFormulaField), formula: val(r.formula) };
        }
      }
    } catch (e) {}
    return { index: idx, tag: tag(dt), keyField: (function () { try { return dt.keyField; } catch (e) { return undefined; } })(), columns: cols, dataLen: Array.isArray(data) ? data.length : 0, hasFormulaKeyInData: hasFormulaKey, firstRow: firstRow, formulaSample: formulaSample };
  }

  byTag("runtime_cdp-custom-datatable").forEach(function (dt, i) { out.tables.push(dumpTable(dt, "cdp-" + i)); });
  byTag("lightning-datatable").forEach(function (dt, i) { out.tables.push(dumpTable(dt, "ltng-" + i)); });

  // any component whose tag hints it holds fields (so we see what DLO uses instead)
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/field|column|schema|attribute/i.test(t) && /cdp|dao|runtime|data|lake|dlo/i.test(t)) {
      var props = {};
      ["data", "fields", "columns", "records", "rows"].forEach(function (k) { try { if (el[k] != null && typeof el[k] !== "function") props[k] = shape(el[k], 0); } catch (e) {} });
      out.fieldishComponents.push({ tag: t, props: props });
    }
  });
  if (out.fieldishComponents.length > 12) out.fieldishComponents = out.fieldishComponents.slice(0, 12);

  out.customTagsPresent = (function () { var s = {}; eachEl(document, 0, function (el) { var t = tag(el); if (/cdp|dao|datatable|field|lake|dlo|data-/i.test(t)) s[t] = (s[t] || 0) + 1; }); return s; })();

  out.notes.push("tables found (cdp + lightning): " + out.tables.length);
  var withFormula = out.tables.filter(function (t) { return t.hasFormulaKeyInData; });
  out.notes.push(withFormula.length ? ("✓ " + withFormula.length + " table(s) carry isFormulaField/formula in data → DLO DOES expose formulas") : "✗ no table carries isFormulaField/formula → DLO does NOT expose the formula expression here");
  if (!out.tables.length) out.notes.push("No tables rendered — SCROLL to the DLO's Fields section (so it loads) and re-run.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(820px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v40 — DLO field rendering + formula presence\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
