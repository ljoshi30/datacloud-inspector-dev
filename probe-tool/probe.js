/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v30 — the NEW Salesforce Data Cloud LEFT NAV: why the ⧉ "open in new
 * tab" doesn't appear on its items, and how to match/route them correctly.
 *
 * RUN on any Data Cloud page that shows the new left nav. Read-only. Copies JSON + shows panel.
 * Reports, crossing shadow DOM:
 *   - every element that LOOKS like a nav item (anchors + role=link/button/treeitem/menuitem
 *     + known nav classes/tags), with: tag, role, class, aria-label/title/text, href
 *   - whether a top context-bar exists to harvest hrefs from (slds-context-bar__label-action)
 *   - the ancestor chain of the FIRST left-nav item (so we see the container tags/classes our
 *     dcIsNavAnchor gate should recognize)
 *   - whether the current matcher markers appear anywhere
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe30() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { href: "", navItems: [], topBarAnchors: 0, currentMarkersSeen: {}, firstItemChain: [], notes: [] };
  try { out.href = location.href; } catch (e) {}

  function eachEl(root, d, fn) {
    if (d > 16) return;
    var q; try { q = root.querySelectorAll("*"); } catch (e) { return; }
    for (var i = 0; i < q.length; i++) {
      fn(q[i]);
      var sr = null; try { sr = q[i].shadowRoot; } catch (e) {}
      if (sr) eachEl(sr, d + 1, fn);
    }
  }
  function attr(el, a) { try { return el.getAttribute(a) || ""; } catch (e) { return ""; } }
  function labelOf(el) { return (attr(el, "aria-label") || attr(el, "title") || (el.textContent || "")).replace(/\s+/g, " ").trim().slice(0, 50); }

  // markers the SHIPPED matcher currently recognizes — see if any appear
  var MARKERS = ["slds-nav-vertical__action", "slds-context-bar__label-action", "navItem", "slds-context-bar__item",
    "one-app-nav-bar-item", "desktop-vertical-navigation", "lightning-vertical-navigation"];
  MARKERS.forEach(function (m) { out.currentMarkersSeen[m] = 0; });

  var items = [], firstLeftItem = null;
  eachEl(document, 0, function (el) {
    var tag = (el.tagName || "").toLowerCase();
    var cls = attr(el, "class");
    var role = attr(el, "role");
    // count current markers
    MARKERS.forEach(function (m) { if (cls.indexOf(m) >= 0 || tag.indexOf(m) >= 0) out.currentMarkersSeen[m]++; });
    if (/slds-context-bar__label-action/.test(cls)) out.topBarAnchors++;
    // candidate nav item?
    var looksNav =
      tag === "a" ||
      role === "link" || role === "button" || role === "treeitem" || role === "menuitem" || role === "tab" ||
      /nav.*item|vertical-navigation|slds-nav-vertical|nav-items|navItem|menu-item|tree.*item/i.test(cls) ||
      /nav-item|navigation-item|tree-item/i.test(tag);
    if (!looksNav) return;
    var href = attr(el, "href");
    var lbl = labelOf(el);
    if (!lbl && !href) return;
    var rec = { tag: tag, role: role, cls: cls.slice(0, 90), label: lbl, href: href.slice(0, 80) };
    items.push(rec);
    // the first LEFT-nav-looking item (vertical nav, not the top bar) → capture its ancestor chain
    if (!firstLeftItem && /vertical|nav-vertical|tree/i.test(cls + " " + tag) && lbl) firstLeftItem = el;
  });
  // de-dup + cap
  var seen = {}, uniq = [];
  for (var i = 0; i < items.length && uniq.length < 60; i++) {
    var k = items[i].tag + "|" + items[i].role + "|" + items[i].label + "|" + items[i].href;
    if (seen[k]) continue; seen[k] = 1; uniq.push(items[i]);
  }
  out.navItems = uniq;
  out.notes.push("candidate nav items (deduped, capped 60): " + uniq.length);
  out.notes.push("top context-bar harvestable anchors: " + out.topBarAnchors + (out.topBarAnchors === 0 ? "  ← if 0, left-nav labels can't resolve via harvest; need learned/seed or the item's own href" : ""));

  // ancestor chain of the first left-nav item (so we learn the container markers to gate on)
  if (firstLeftItem) {
    var n = firstLeftItem, g = 0;
    while (n && g++ < 12) {
      var t = (n.tagName || "").toLowerCase(), c = attr(n, "class"), r = attr(n, "role");
      out.firstItemChain.push(t + (r ? "[role=" + r + "]" : "") + (c ? " ." + c.split(/\s+/).slice(0, 3).join(".") : ""));
      var pe = n.parentElement;
      if (!pe) { var rt = null; try { rt = n.getRootNode && n.getRootNode(); } catch (e) {} if (rt && rt.host) { pe = rt.host; out.firstItemChain.push("⟦shadow⟧"); } }
      n = pe;
    }
  } else {
    out.notes.push("no 'vertical/tree' left-nav item matched by the loose probe heuristic — paste the panel so we can see the real markup from navItems[]");
  }

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(720px,95vw);max-height:86vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11.5px/1.5 'SF Mono',Menlo,monospace;box-shadow:0 20px 60px rgba(0,0,0,.6);white-space:pre-wrap;";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v30 — new left-nav ⧉ diagnosis\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;";
  x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
