/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v55 — Segment AND/OR grouping: dump the raw condition-set tree so we
 * can verify our reader captures mixed AND/OR + nesting correctly (precedence).
 * ---------------------------------------------------------------------------
 * The concern: a group showing "A AND B OR C" in the rails — is it ONE flat set
 * with a single join, or NESTED sub-sets? Our buildSetNode takes the FIRST and/or
 * text per set, so a flat MIXED group would be mis-read → wrong SQL/grouping.
 * This walks each <...condition-set> and prints: its join token(s) seen, its depth,
 * and its direct children (type + a short label), so we can compare to the UI rails.
 *
 * RUN on a Segment builder page with the Include tab showing. Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe55() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v55", href: location.href, sets: [], notes: [] };

  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function shadowTexts(root) {
    var acc = [];
    (function walk(r, d) {
      if (!r || d > 6) return;
      var cn = r.childNodes || [];
      for (var i = 0; i < cn.length; i++) {
        var n = cn[i];
        if (n.nodeType === 3) { var t = (n.nodeValue || "").replace(/\s+/g, " ").trim(); if (t) acc.push(t); }
        else if (n.nodeType === 1) { var sr = null; try { sr = n.shadowRoot; } catch (e) {} if (sr) walk(sr, d + 1); walk(n, d + 1); }
      }
    })(root.shadowRoot || root, 0);
    var seen = {}, o = []; for (var j = 0; j < acc.length && o.length < 12; j++) { if (!seen[acc[j]]) { seen[acc[j]] = 1; o.push(acc[j]); } }
    return o;
  }
  // direct child condition items of a set (mirror of getDirectChildren — li[data-tid=condition-set-filter])
  function directChildren(setEl) {
    var sr = setEl.shadowRoot || setEl, lis = [], out = [];
    try { lis = sr.querySelectorAll("[data-tid='condition-set-filter']"); } catch (e) {}
    for (var i = 0; i < lis.length; i++) {
      // the real condition element is the first custom element inside the li
      var kids = lis[i].querySelectorAll("*"), found = null;
      for (var k = 0; k < kids.length; k++) { var t = tag(kids[k]); if (/segment-builder-(condition-set|simple-condition|aggregation-condition|calculated-insight-condition|base-segment-item)/.test(t)) { found = kids[k]; break; } }
      if (found) out.push(found);
    }
    return out;
  }

  var SET = "runtime_cdp-segment-builder-condition-set";
  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i]); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }

  var idc = 0;
  eachEl(document, 0, function (el) {
    if (tag(el) !== SET) return;
    var allTexts = shadowTexts(el);
    var andOr = allTexts.filter(function (t) { return /^(and|or)$/i.test(t); });
    var kids = directChildren(el).map(function (c) {
      var t = tag(c).replace("runtime_cdp-segment-builder-", "");
      var txt = shadowTexts(c).slice(0, 3).join(" | ");
      return { type: t, text: txt };
    });
    out.sets.push({
      setIndex: idc++,
      joinTokensSeen: andOr,                          // ALL and/or tokens in this set's shadow
      distinctJoins: Array.from(new Set(andOr.map(function (x) { return x.toUpperCase(); }))),
      mixedJoin: (new Set(andOr.map(function (x) { return x.toUpperCase(); }))).size > 1,  // ← the danger flag
      childCount: kids.length,
      children: kids
    });
  });

  out.notes.push("condition-sets found: " + out.sets.length);
  var anyMixed = out.sets.some(function (s) { return s.mixedJoin; });
  out.notes.push(anyMixed
    ? "⚠️ A set has MIXED and/or tokens (distinctJoins length>1). If that set is FLAT (children are simple, not sub-sets), our reader's single-join-per-set is WRONG → SQL/grouping bug. Check which sets are mixed + whether their children include nested condition-sets."
    : "✓ No set shows mixed and/or tokens — each group is a single join (our single-join-per-set reading is fine for these).");
  out.notes.push("For each set: if mixedJoin=true AND children are all simple/agg/ci (NO 'condition-set' child), that's the misread case.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(900px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v55 — Segment AND/OR grouping\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
