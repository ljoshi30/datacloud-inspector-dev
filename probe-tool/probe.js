/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v50 — IDR "Configure Match Criteria" modal. Each criterion row has
 * dropdowns: Data Model Object / Field / Match Method, shown by LABEL only
 * (Contact Point Email · Email Address). We want the API names here too. This finds
 * where the object/field API lives — on the row's component props, the combobox
 * value, or the option objects — so we attach them exactly, never guessed.
 *
 * RUN with the "Configure Match Criteria" modal OPEN (criteria rows visible, as in
 * the screenshot). Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe50() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v50", href: location.href, tagCensus: {}, matchComponents: [], comboboxes: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60); } catch (e) { return ""; } }

  function shape(o, depth) {
    if (o == null || depth > 4) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 90) : (typeof o === "function" ? "fn" : String(o)));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 50) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }
  function props(el) {
    var keys = ["criterion", "criteria", "matchRule", "rule", "row", "data", "object", "objectApiName",
      "objectDevName", "field", "fieldApiName", "fieldDevName", "matchMethod", "method", "value",
      "entity", "entityApiName", "dmo", "selected", "item", "record", "fields", "options"];
    var found = {};
    keys.forEach(function (k) { try { var v = el[k]; if (v != null && typeof v !== "function") found[k] = shape(v, 0); } catch (e) {} });
    return found;
  }

  // census of match/criteria custom tags
  out.tagCensus = (function () { var s = {}; eachEl(document, 0, function (el) { var t = tag(el); if (/match|criteri|rule|idr|identity/i.test(t) && /cdp|dao|runtime|identity/i.test(t)) s[t] = (s[t] || 0) + 1; }); return s; })();

  // any component whose tag hints it's a match-criterion row/container → dump props
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/match.*criteri|criteri.*row|match.*rule|match-criterion|configure-match/i.test(t)) {
      if (out.matchComponents.length < 10) out.matchComponents.push({ tag: t, text: txt(el), props: props(el) });
    }
  });

  // the Object/Field comboboxes: label + value + first option (value is often the API name)
  eachEl(document, 0, function (el) {
    if (tag(el) !== "lightning-combobox" && tag(el) !== "lightning-grouped-combobox") return;
    if (out.comboboxes.length >= 12) return;
    var label = "", value = "", opts = null;
    try { label = String(el.label || ""); } catch (e) {}
    try { value = String(el.value || ""); } catch (e) {}
    try { opts = el.options; } catch (e) {}
    out.comboboxes.push({ label: label, value: value, firstOption: (Array.isArray(opts) && opts.length) ? shape(opts[0], 0) : "(no options[])", optionCount: Array.isArray(opts) ? opts.length : 0 });
  });

  out.notes.push("match/criteria tags: " + Object.keys(out.tagCensus).join(", "));
  out.notes.push("match components: " + out.matchComponents.length + " · comboboxes: " + out.comboboxes.length);
  if (!out.matchComponents.length && !out.comboboxes.length) out.notes.push("Nothing captured — make sure the 'Configure Match Criteria' modal is OPEN with criteria rows showing.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v50 — IDR Match Criteria modal (object/field API)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
