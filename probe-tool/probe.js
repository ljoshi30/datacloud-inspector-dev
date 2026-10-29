/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v48 — IDENTITY RESOLUTION reconciliation page. Each DMO section
 * (Contact Point Address, Individual, …) lists reconciliation FIELDS by friendly
 * label (Account Multiline, Birth Date, First Name…) with NO API names. This finds
 * WHERE the field API name + the DMO/object API name live in the component props,
 * so we can reveal them (hover/inline) like we do elsewhere — never guessed.
 *
 * RUN on an Identity Resolution ruleset page with a DMO section EXPANDED (so its
 * field rows render — e.g. "Individual" open, as in the screenshot). Read-only.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe48() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v48", href: location.href, tagCensus: {}, sections: [], datatables: [], fieldRows: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60); } catch (e) { return ""; } }

  function shape(o, depth) {
    if (o == null || depth > 4) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 90) : (typeof o === "function" ? "fn" : String(o)));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 45) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }
  // dump props that may carry field/object API names or the row record
  function props(el) {
    var keys = ["data", "columns", "fields", "field", "row", "record", "item", "node", "attribute",
      "reconciliationRule", "rule", "entity", "entityApiName", "objectApiName", "fieldApiName",
      "apiName", "developerName", "name", "label", "dmo", "dmoApiName", "section", "value"];
    var found = {};
    keys.forEach(function (k) { try { var v = el[k]; if (v != null && typeof v !== "function") found[k] = shape(v, 0); } catch (e) {} });
    return found;
  }

  // 1) census of the IR custom tags so we see what the page is built from
  out.tagCensus = (function () { var s = {}; eachEl(document, 0, function (el) { var t = tag(el); if (/cdp|dao|runtime|identity|reconcil|ruleset|match/i.test(t)) s[t] = (s[t] || 0) + 1; }); return s; })();

  // 2) section headers (the DMO accordions: Contact Point Address / Individual / …) — dump props
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/section|accordion|reconcil|entity|object|ruleset/i.test(t) && /cdp|dao|runtime|identity/i.test(t)) {
      if (out.sections.length < 8) out.sections.push({ tag: t, text: txt(el), props: props(el) });
    }
  });

  // 3) any datatable rendering the field rows (label + reconciliation rule). Dump columns + 1 row.
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (t !== "runtime_cdp-custom-datatable" && t !== "lightning-datatable") return;
    if (out.datatables.length >= 4) return;
    var cols = null, data = null;
    try { cols = (el.columns || []).map(function (c) { return c && (c.fieldName || c.label); }); } catch (e) {}
    try { data = el.data; } catch (e) {}
    out.datatables.push({ tag: t, columns: cols, dataLen: Array.isArray(data) ? data.length : 0, firstRow: (Array.isArray(data) && data.length) ? shape(data[0], 0) : "(no data)" });
  });

  // 4) individual field-row components if the page uses them instead of a datatable
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/field-row|reconcil.*row|rule-row|attribute-row/i.test(t)) {
      if (out.fieldRows.length < 6) out.fieldRows.push({ tag: t, text: txt(el), props: props(el) });
    }
  });

  out.notes.push("IR tags: " + Object.keys(out.tagCensus).join(", "));
  out.notes.push("sections: " + out.sections.length + " · datatables: " + out.datatables.length + " · field-row comps: " + out.fieldRows.length);
  if (!out.datatables.length && !out.fieldRows.length) out.notes.push("No field table/rows captured — EXPAND a DMO section (e.g. Individual) so its fields render, then re-run.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v48 — Identity Resolution field/DMO API names\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
