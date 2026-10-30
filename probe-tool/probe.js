/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v52 — Segment condition OPERATOR: find the API ENUM behind the label
 * ---------------------------------------------------------------------------
 * The Segment export today writes the operator as the DISPLAYED text ("is equal
 * to"). The QE team compares exports against the API, which returns an ENUM
 * ("IS_EQUAL_TO" / "CONTAINS" / "IS_EMPTY_STRING" …). We need to find WHERE that
 * enum lives on the condition element so we can add an "Operator (API)" column
 * (like the Data Space export already has). NEVER guess this — read it live.
 *
 * Suspect (from an old code comment): a SingleFilterCondition component with
 *   .comparison._ruleType  (the enum).  We'll look for that AND dump any prop on
 *   the condition / comparison objects whose value looks like an ENUM.
 *
 * RUN on a Segment builder page that HAS at least one condition (ideally one with
 * a multi-word operator like "is empty" / "is equal to"). Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe52() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v52", href: location.href, conditionTags: {}, conditions: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function safe(o, k) { try { return o[k]; } catch (e) { return undefined; } }
  // Does a string look like an API enum?  UPPER_SNAKE, or clearly code-ish (no spaces).
  function looksEnum(v) { return typeof v === "string" && v.length >= 2 && v.length <= 60 && /^[A-Z][A-Z0-9_]+$/.test(v); }
  // Shallow dump of own-enumerable + a few known getters, capturing enum-looking values.
  function dumpEnumish(obj, depth) {
    var found = {};
    if (!obj || typeof obj !== "object" || depth > 2) return found;
    var keys = [];
    try { keys = Object.keys(obj); } catch (e) {}
    // also probe a few named props our comment/suspicions point at (getters won't show in keys)
    ["_ruleType", "ruleType", "operator", "operatorType", "comparisonOperator", "comparison", "filterOperator", "type", "_operator"].forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    keys.forEach(function (k) {
      var v = safe(obj, k);
      if (looksEnum(v)) found[k] = v;
      else if (v && typeof v === "object" && depth < 2 && (k === "comparison" || k === "_comparison" || k === "rule" || k === "condition")) {
        var sub = dumpEnumish(v, depth + 1);
        if (Object.keys(sub).length) found[k] = sub;
      }
    });
    return found;
  }

  // Tag census — which condition-ish components are on the page (helps if the tag differs per org).
  eachEl(document, 0, function (el) {
    var t = tag(el);
    if (/condition|comparison|filter|single.*rule|rule.*single/.test(t) && t.indexOf("-") > 0) out.conditionTags[t] = (out.conditionTags[t] || 0) + 1;
  });

  // Likely condition components to inspect for an operator enum.
  var CAND = ["runtime_cdp-segment-builder-single-filter-condition", "runtime_cdp-segment-builder-condition", "runtime_cdp-segment-builder-comparison-summary", "runtime_cdp-segment-builder-comparison"];
  var seen = [];
  eachEl(document, 0, function (el) {
    var t = tag(el);
    var isCand = CAND.indexOf(t) >= 0 || /single-filter-condition|comparison-summary|segment-builder-condition/.test(t);
    if (!isCand) return;
    if (seen.length >= 6) return;                      // cap: first few conditions is enough
    seen.push(el);
    var rec = { tag: t, enumish: {}, displayedText: "" };
    // displayed operator text (what the export currently captures) for cross-reference
    try { rec.displayedText = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80); } catch (e) {}
    // dump enum-looking props off the element itself + common data holders
    rec.enumish = dumpEnumish(el, 0);
    ["comparison", "_comparison", "condition", "_condition", "rule", "_rule", "subject", "value"].forEach(function (holder) {
      var h = safe(el, holder);
      if (h && typeof h === "object") { var d = dumpEnumish(h, 1); if (Object.keys(d).length) rec.enumish[holder] = d; }
    });
    out.conditions.push(rec);
  });

  out.notes.push("condition-ish tags seen: " + JSON.stringify(out.conditionTags));
  out.notes.push("conditions inspected: " + out.conditions.length);
  var anyEnum = out.conditions.some(function (c) { return Object.keys(c.enumish).length > 0; });
  out.notes.push(anyEnum
    ? "✓ enum-looking value(s) found — see conditions[].enumish (that prop path is the Operator API enum)."
    : "✗ no enum prop found on these elements. The enum may not be in the DOM (operator is label-only) → we'd DERIVE the enum from the label with a lookup map, and SAY it's derived. Send this either way.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(860px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v52 — Segment operator API enum\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
