/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v49 — Identity Resolution recon ROW exact props. v48 proved the API
 * names exist: DMO api = recon-table-rules.entity.id (TDI_Individual__dlm); field
 * api = recon datatable data[].id (TDI_Account_Multiline__c). The open question:
 * does the VISIBLE row element (runtime_cdp-identity-resolution-recon-rule-field)
 * carry the field api DIRECTLY (clean, exact), or only .label (→ we'd have to match
 * by label, the duplicate-label risk)? This fully dumps ONE row's own props + the
 * entity.fields[0] shape so we attach the api the EXACT way, never guessed.
 *
 * RUN on an IR ruleset with a DMO section EXPANDED (field rows visible). Read-only.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe49() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v49", href: location.href, reconRowAllProps: null, entityFieldsSample: null, reconDatatableRow: null, notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }

  function shape(o, depth) {
    if (o == null || depth > 4) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 90) : (typeof o === "function" ? "fn" : String(o)));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 60) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }
  // ALL own non-DOM, non-function props of an element (skip the inherited HTMLElement noise)
  function allOwn(el) {
    var r = {};
    try {
      for (var k in el) {
        if (/^(on|aria|node|child|parent|element|first|last|next|previous|owner|shadow|attributes|classList|style|dataset|__|\$\$|offset|client|scroll|inner|outer|base|content|text|local|tag|namespace|prefix|slot|part|assigned|is[A-Z]|DOCUMENT|ELEMENT|ATTRIBUTE|TEXT|CDATA|ENTITY|PROCESSING|COMMENT|NOTATION)/.test(k)) continue;
        var v; try { v = el[k]; } catch (e) { continue; }
        if (typeof v === "function") continue;
        if (v && typeof v === "object" && (v.nodeType || v === window)) continue;
        r[k] = shape(v, 0);
      }
    } catch (e) {}
    return r;
  }

  // 1) one recon-rule-field row — ALL its props
  var rowEl = null;
  eachEl(document, 0, function (el) { if (!rowEl && tag(el) === "runtime_cdp-identity-resolution-recon-rule-field") rowEl = el; });
  if (rowEl) out.reconRowAllProps = allOwn(rowEl);
  else out.notes.push("No recon-rule-field row found — expand a DMO section so its fields render.");

  // 2) the entity.fields[0] shape (from recon-table-rules) — the per-DMO field list
  eachEl(document, 0, function (el) {
    if (out.entityFieldsSample || tag(el) !== "runtime_cdp-identity-resolution-recon-table-rules") return;
    var ent = null; try { ent = el.entity; } catch (e) {}
    if (ent) out.entityFieldsSample = { dmoId: ent.id, dmoLabel: ent.label, firstField: (Array.isArray(ent.fields) && ent.fields.length) ? shape(ent.fields[0], 0) : "(no fields[])", fieldCount: Array.isArray(ent.fields) ? ent.fields.length : 0 };
  });

  // 3) first recon datatable row (field api source we already know) for cross-check
  eachEl(document, 0, function (el) {
    if (out.reconDatatableRow || tag(el) !== "runtime_cdp-custom-datatable") return;
    var cols = null, data = null; try { cols = (el.columns || []).map(function (c) { return c && (c.fieldName || c.label); }); } catch (e) {}
    try { data = el.data; } catch (e) {}
    // the recon table has columns Field/ruleLabel/isDefaultRule (21 rows), not the 116-field dialog
    if (Array.isArray(cols) && cols.indexOf("ruleLabel") >= 0 && Array.isArray(data) && data.length) out.reconDatatableRow = shape(data[0], 0);
  });

  out.notes.push("recon-rule-field props captured: " + (out.reconRowAllProps ? Object.keys(out.reconRowAllProps).join(", ") : "none"));
  if (out.reconRowAllProps) {
    var hasApi = JSON.stringify(out.reconRowAllProps).match(/__c|__dlm|ApiName|apiName|devName/);
    out.notes.push(hasApi ? "✓ the row element itself carries an api-looking value → attach EXACTLY from the row (no label matching)." : "✗ the row has no api prop — attach field api from entity.fields / datatable, aligned by INDEX within the section (not label).");
  }

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v49 — IR recon row exact props\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
