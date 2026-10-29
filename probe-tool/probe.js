/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v45 — Data Space filter: what does THIS object render? Our reader got
 * "0 conditions" on the Loyalty object (flat, 3 × Line of Business OR). We only ever
 * probed TDI_RH_Profile's item shape — this dumps whatever the CURRENT filter modal
 * uses so we read it, never guess.
 *
 * Captures: a census of every custom tag containing filter/condition/criteria/rule,
 * and for EACH such element, which of {filter, filterGroup, condition, conditions,
 * subject, value, data} props it carries + their shape.
 *
 * RUN with the Data Space "Edit Filters" modal OPEN (so conditions render). Read-only.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe45() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v45", href: location.href, tagCensus: {}, elements: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 24) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70); } catch (e) { return ""; } }

  function shape(o, depth) {
    if (o == null || depth > 4) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 90) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 45) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } if (typeof v === "function") { r[k] = "fn"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }

  var CARE = ["filter", "filterGroup", "filterGroups", "condition", "conditions", "criteria", "rule", "rules", "subject", "field", "operator", "value", "data", "items", "node"];

  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (!/filter|condition|criteria|rule/i.test(t)) return;
    if (!/cdp|dao|runtime|data|space|lake/i.test(t)) return;
    out.tagCensus[t] = (out.tagCensus[t] || 0) + 1;
    if (out.elements.length >= 20) return;
    var props = {};
    CARE.forEach(function (k) { try { var v = el[k]; if (v != null && typeof v !== "function") props[k] = shape(v, 0); } catch (e) {} });
    // only record elements that actually carry one of the data props (skip pure layout wrappers)
    if (Object.keys(props).length) out.elements.push({ tag: t, text: txt(el), props: props });
  });

  out.notes.push("filter-ish tags: " + Object.keys(out.tagCensus).join(", "));
  out.notes.push("elements with data props captured: " + out.elements.length);
  if (!out.elements.length) out.notes.push("No element carried filter/condition props — the modal may not be open, or this object renders conditions a different way (see tagCensus).");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v45 — Data Space filter structure (this object)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
