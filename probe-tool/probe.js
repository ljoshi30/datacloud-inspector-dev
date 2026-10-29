/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v44 — SEGMENT condition OPERATOR enum. Does a segment condition expose
 * the operator as an API enum (e.g. GREATER_THAN / IS_EMPTY_STRING) in its props,
 * not just the display label? If yes, the flat CSV can add an "Operator (API)"
 * column so QE automation can compare it against a Query/Connect API response.
 *
 * RUN on a Segment builder with at least one condition (ideally a multi-word
 * operator like "Is Empty String" / "Greater Than"). Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe44() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v44", href: location.href, conditions: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 22) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60); } catch (e) { return ""; } }

  function shape(o, depth) {
    if (o == null || depth > 4) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 80) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 40) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } if (typeof v === "function") { r[k] = "fn"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }

  var CONDTAGS = [
    "runtime_cdp-segment-builder-simple-condition",
    "runtime_cdp-segment-builder-aggregation-condition",
    "runtime_cdp-segment-builder-calculated-insight-condition"
  ];
  // the condition-object props that may carry the operator
  var CONDPROPS = ["simpleCondition", "aggregationCondition", "calculatedInsightCondition", "condition", "details", "filter"];

  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (CONDTAGS.indexOf(t) < 0) return;
    if (out.conditions.length >= 6) return;
    var cObj = null, cKey = "";
    for (var i = 0; i < CONDPROPS.length; i++) { var v = null; try { v = el[CONDPROPS[i]]; } catch (e) {} if (v && typeof v === "object") { cObj = v; cKey = CONDPROPS[i]; break; } }
    var entry = { tag: t, text: txt(el), conditionKey: cKey };
    if (cObj) {
      // dump the whole condition object shape so we SEE where an operator enum lives
      entry.condition = shape(cObj, 0);
      // and pull candidate operator fields explicitly from the condition + its subject
      var subj = cObj.subject || (cObj.filter && cObj.filter.subject) || {};
      var cand = {};
      ["operator", "operatorName", "operatorApiName", "comparisonOperator", "op", "relationalOperator", "function"].forEach(function (k) {
        try { if (cObj[k] != null) cand["condition." + k] = shape(cObj[k], 0); } catch (e) {}
        try { if (subj[k] != null) cand["subject." + k] = shape(subj[k], 0); } catch (e) {}
      });
      entry.operatorCandidates = cand;
    }
    out.conditions.push(entry);
  });

  out.notes.push("conditions captured: " + out.conditions.length);
  if (!out.conditions.length) out.notes.push("No condition components found — open a Segment with at least one condition, then re-run.");
  else {
    var anyEnum = out.conditions.some(function (c) { return c.operatorCandidates && Object.keys(c.operatorCandidates).length; });
    out.notes.push(anyEnum ? "✓ an operator enum field WAS found (see operatorCandidates) — we can add Operator (API) to the segment CSV." : "✗ no obvious operator enum field — the condition object shape above shows what IS there; we may need another key.");
  }

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v44 — Segment operator enum\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
