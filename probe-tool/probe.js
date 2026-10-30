/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v53 — Segment operator API enum (take 2, fixing v52's misses)
 * ---------------------------------------------------------------------------
 * v52 inspected the wrong element (comparison-summary) and found only field-type
 * enums (_subjectFieldDataType:"TEXT") — NOT the operator. The real per-condition
 * data holder is runtime_cdp-segment-builder-simple-condition (25 on the page).
 * This probe DUMPS THE FULL STRUCTURE (all own keys + value previews, not just
 * enum-shaped ones) of the simple-condition AND its comparison object, plus the
 * shadow-pierced DISPLAYED operator text — so we can SEE exactly where the enum
 * is (e.g. comparison._ruleType / .operator / .comparisonOperator) and map it to
 * the label. If no enum exists in the DOM at all, we'll see that too and derive
 * it from the label with an explicit lookup (and say so).
 *
 * RUN on a Segment builder page with conditions (ideally a mix of operators:
 *   "is equal to", "is empty", "contains"). Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe53() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v53", href: location.href, simpleConditions: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function safe(o, k) { try { return o[k]; } catch (e) { return undefined; } }

  // Shadow-piercing text collector (textContent does NOT cross shadow roots — that's why v52's
  // displayedText was blank). Returns the trimmed, de-duplicated short text leaves.
  function shadowTexts(root) {
    var acc = [];
    (function walk(r, d) {
      if (!r || d > 10) return;
      var cn = r.childNodes || [];
      for (var i = 0; i < cn.length; i++) {
        var n = cn[i];
        if (n.nodeType === 3) { var t = (n.nodeValue || "").replace(/\s+/g, " ").trim(); if (t) acc.push(t); }
        else if (n.nodeType === 1) { var sr = null; try { sr = n.shadowRoot; } catch (e) {} if (sr) walk(sr, d + 1); walk(n, d + 1); }
      }
    })(root.shadowRoot || root, 0);
    // de-dup, keep order, cap
    var seen = {}, outT = [];
    for (var j = 0; j < acc.length && outT.length < 40; j++) { if (!seen[acc[j]]) { seen[acc[j]] = 1; outT.push(acc[j]); } }
    return outT;
  }

  // Preview any value as a short string with its type (so we SEE the real keys + values).
  function preview(v) {
    try {
      if (v === null) return "null";
      var t = typeof v;
      if (t === "string") return "str:" + JSON.stringify(v.slice(0, 60));
      if (t === "number" || t === "boolean") return t + ":" + v;
      if (t === "function") return "fn";
      if (Array.isArray(v)) return "arr[" + v.length + "]";
      if (t === "object") { if (v.nodeType) return "DOMNode<" + ((v.tagName || "").toLowerCase()) + ">"; return "obj{" + Object.keys(v).slice(0, 12).join(",") + "}"; }
      return t;
    } catch (e) { return "(err)"; }
  }
  // Dump own keys + a curated set of likely-getter props (getters don't appear in Object.keys).
  function dumpKeys(obj) {
    var o = {}; if (!obj || typeof obj !== "object") return o;
    var keys = [];
    try { keys = Object.keys(obj); } catch (e) {}
    ["comparison", "_comparison", "condition", "_condition", "rule", "_rule", "subject", "_subject",
     "operator", "_operator", "operatorType", "comparisonOperator", "ruleType", "_ruleType", "type", "_type",
     "value", "_value", "values", "_values", "fieldApiName", "objectApiName"].forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    keys.forEach(function (k) { var v = safe(obj, k); if (v !== undefined) o[k] = preview(v); });
    return o;
  }

  var count = 0;
  eachEl(document, 0, function (el) {
    if (tag(el) !== "runtime_cdp-segment-builder-simple-condition") return;
    if (count >= 8) return;      // first 8 conditions is plenty to see the pattern
    count++;
    var rec = { displayedText: shadowTexts(el), self: dumpKeys(el) };
    // one level into the most likely data holders so we SEE the operator's home
    ["comparison", "_comparison", "condition", "_condition", "rule", "_rule"].forEach(function (holder) {
      var h = safe(el, holder);
      if (h && typeof h === "object" && !h.nodeType) rec[holder] = dumpKeys(h);
    });
    out.simpleConditions.push(rec);
  });

  out.notes.push("simple-conditions inspected: " + out.simpleConditions.length);
  out.notes.push("LOOK FOR: a key whose value preview is str:\"IS_EQUAL_TO\"/\"CONTAINS\"/\"IS_EMPTY_STRING\" etc.");
  out.notes.push("displayedText shows the visible operator words — cross-reference to confirm the enum↔label mapping.");
  if (!out.simpleConditions.length) out.notes.push("✗ none found — open the Segment builder with at least one condition and re-run.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(900px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v53 — Segment operator API enum (take 2)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
