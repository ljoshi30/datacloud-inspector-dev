/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v41 — FILTER CAPTURE. Finds filter logic ANYWHERE in Data Cloud
 * (Data Graph object Filters tab, Data Space, Calculated Insight, etc.) and dumps
 * the full structure: the AND/OR grouping ("Take Action When"), each condition
 * (field / operator / value), and any Sort & Limit. Used to confirm WHERE the
 * "DLO filters" you want to export live, and the exact data shape to read.
 *
 * RUN on the screen that SHOWS the filters you want exported (open the Filters tab
 * / expand the conditions so they render). Read-only; copies JSON. Click once.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe41() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v41", href: location.href, filterComponents: [], criteriaCombos: [], sortLimit: [], customTagsPresent: {}, notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 22) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80); } catch (e) { return ""; } }

  function shape(o, depth) {
    if (o == null || depth > 4) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 100) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 50) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } if (typeof v === "function") { r[k] = "fn"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }
  function props(el) {
    var found = {};
    try { for (var k in el) { if (!/filter|condition|criteria|subject|operator|value|sort|limit|field|object|rule|group|logic|node|data/i.test(k)) continue; var v; try { v = el[k]; } catch (e) { continue; } if (v == null || typeof v === "function") continue; if (v && typeof v === "object" && (v.nodeType || v === window)) continue; found[k] = shape(v, 0); } } catch (e) {}
    return found;
  }

  // Any component whose tag hints it holds filter/condition/sort logic — dump its props DEEP.
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/filter|condition|criteria|sort|rank|where|predicate/i.test(t) && /cdp|dao|runtime|data|lake|graph|insight|space/i.test(t)) {
      out.filterComponents.push({ tag: t, text: txt(el), props: props(el) });
    }
  });
  if (out.filterComponents.length > 20) { out.notes.push("capped filter components at 20 of " + out.filterComponents.length); out.filterComponents = out.filterComponents.slice(0, 20); }

  // Criteria / grouping comboboxes: "Take Action When" = All(AND)/Any(OR); also any logic selector.
  eachEl(document, 0, function (el) {
    if (tag(el) !== "lightning-combobox") return;
    var label = ""; try { label = String(el.label || ""); } catch (e) {}
    var value = ""; try { value = String(el.value || ""); } catch (e) {}
    if (/criteria|take action|logic|match|condition|sort|order|operator|field/i.test(label) || /^(AND|OR)$/i.test(value)) {
      out.criteriaCombos.push({ label: label, value: value, name: (function () { try { return el.name || ""; } catch (e) { return ""; } })() });
    }
  });

  // Sort & Limit inputs (so export can include them like the Segment Rank & Limit).
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (t === "lightning-input" || t === "input") {
      var label = ""; try { label = String(el.label || el.getAttribute("aria-label") || el.getAttribute("name") || ""); } catch (e) {}
      if (/limit|sort|record/i.test(label)) { var v = ""; try { v = String(el.value || ""); } catch (e) {} out.sortLimit.push({ label: label, value: v }); }
    }
  });

  out.customTagsPresent = (function () { var s = {}; eachEl(document, 0, function (el) { var t = tag(el); if (/filter|condition|criteria|sort|rank|dao-editor|data-space|insight|predicate/i.test(t)) s[t] = (s[t] || 0) + 1; }); return s; })();

  out.notes.push("filter components: " + out.filterComponents.length + " · criteria combos: " + out.criteriaCombos.length + " · sort/limit inputs: " + out.sortLimit.length);
  if (!out.filterComponents.length && !out.criteriaCombos.length) out.notes.push("No filter structure captured here — open the Filters tab / expand conditions so they render, then re-run. If this screen has no filter UI, this isn't the right place.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v41 — filter capture (where DLO filters live + their shape)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
