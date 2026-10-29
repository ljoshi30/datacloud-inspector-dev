/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v43 — Data Space DLO filter: the BETWEEN-GROUP operator.
 *
 * v42 proved there are 4 distinct AND-groups of conditions. The one thing not yet
 * known: how the GROUPS join to each other (OR vs AND). This probe looks three ways
 * so we read it, never guess:
 *   A) walk UP from a filter-group element to its parent container, dump the
 *      container's props (a rootFilterGroup / filterOperator / groupOperator / etc.)
 *   B) dump the -table-filter root component's FULL prop set (any group-level operator)
 *   C) capture any operator TEXT/pill rendered between the group cards in the DOM
 *      (e.g. a little "OR"/"AND" chip), with its nearby context.
 *
 * RUN on the Data Space page with the DLO filter visible. Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe43() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v43", href: location.href, parentContainers: [], rootFilterComponentAllProps: null, betweenGroupText: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 24) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }

  function shallow(o, depth) {
    if (o == null || depth > 3) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 80) : String(o));
    if (Array.isArray(o)) return "[" + o.length + "]";
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 40) { r["…"] = 1; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v == null || typeof v === "function") continue; if (v && typeof v === "object" && (v.nodeType || v === window)) continue; r[k] = shallow(v, depth + 1); }
    return r;
  }
  // climb across shadow boundaries
  function parentOf(el) { try { return el.parentElement || (el.getRootNode && el.getRootNode() && el.getRootNode().host) || null; } catch (e) { return null; } }

  // A) parent chain of the FIRST filter-group — find the container that holds all groups + its props
  var firstGroupEl = null;
  eachEl(document, 0, function (el) { if (!firstGroupEl && tag(el) === "runtime_cdp-data-spaces-table-filter-group") firstGroupEl = el; });
  if (firstGroupEl) {
    var n = parentOf(firstGroupEl), hops = 0, chain = [];
    while (n && hops++ < 30) {
      var t = tag(n);
      var interesting = /filter|group|criteria|condition|data-space/i.test(t);
      var entry = { tag: t, hop: hops };
      if (interesting || hops <= 3) {
        // pull any operator/group-ish props
        var p = {};
        ["filterOperator", "groupOperator", "operator", "rootFilterGroup", "filterGroup", "filterGroups", "groupLogicOperator", "logicalOperator", "matchType", "filter", "criteria"].forEach(function (k) {
          try { var v = n[k]; if (v != null && typeof v !== "function") p[k] = shallow(v, 0); } catch (e) {}
        });
        if (Object.keys(p).length) entry.props = p;
      }
      chain.push(entry);
      n = parentOf(n);
    }
    out.parentContainers = chain;
  } else { out.notes.push("No filter-group element found — open the DLO filter first."); }

  // B) the -table-filter root component: dump ALL non-function own props (names only + small values)
  eachEl(document, 0, function (el) {
    if (tag(el) !== "runtime_cdp-data-spaces-table-filter" || out.rootFilterComponentAllProps) return;
    var all = {};
    try { for (var k in el) { if (/^(node|child|parent|element|first|last|next|previous|owner|shadow|attributes|classList|style|dataset|__|\$\$)/i.test(k)) continue; var v; try { v = el[k]; } catch (e) { continue; } if (typeof v === "function") continue; if (v && typeof v === "object" && (v.nodeType || v === window)) continue; all[k] = shallow(v, 0); } } catch (e) {}
    out.rootFilterComponentAllProps = all;
  });

  // C) operator text rendered BETWEEN group cards: short elements whose text is exactly AND/OR,
  // plus their immediate container tag so we can see where they sit.
  eachEl(document, 0, function (el) {
    var t = txt(el);
    if (/^(AND|OR)$/i.test(t)) {
      // only leaf-ish nodes (avoid huge wrappers that merely contain an AND somewhere)
      var childCount = 0; try { childCount = el.children ? el.children.length : 0; } catch (e) {}
      if (childCount <= 1) out.betweenGroupText.push({ tag: tag(el), text: t.toUpperCase(), parentTag: (function () { var p = parentOf(el); return p ? tag(p) : ""; })() });
    }
  });
  // dedupe betweenGroupText
  var seen = {}; out.betweenGroupText = out.betweenGroupText.filter(function (x) { var k = x.tag + "|" + x.text + "|" + x.parentTag; if (seen[k]) return false; seen[k] = 1; return true; });

  out.notes.push("parent-chain entries: " + out.parentContainers.length + " · AND/OR text nodes: " + out.betweenGroupText.length);

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v43 — between-group operator (OR vs AND)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
