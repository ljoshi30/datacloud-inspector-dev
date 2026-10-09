/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v25 — WHY the nav ⧉ matcher misses the new SF left nav
 *
 * The nav "open in new tab" ⧉ is installed but shows nothing on the newly-released SF left
 * nav → the matcher (dcNavItemFrom: a/role=button/link OR class slds-nav-vertical__action|
 * slds-context-bar__label-action|navItem, label via aria-label/title/text, must be in
 * DC_NAV_ROUTES) doesn't recognize the new structure. This probe reports, for EACH known
 * DC nav label, the element that actually renders it + everything the matcher checks, so we
 * fix the matcher against the REAL DOM (no guessing):
 *   - find the leaf whose own/aria text == the label
 *   - climb ancestors; for each, record tag, role, class, aria-label, title, href
 *   - flag the FIRST ancestor the current matcher WOULD accept (if any) → shows the gap
 *   - also: tally every custom-element tag containing "nav" so we see the new nav component
 *
 * RUN on a page showing the LEFT nav (the new SF one). Expand it. Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe25() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  function deepAll(root, acc) {
    acc = acc || [];
    if (acc.length > 250000) return acc;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return acc; }
    for (var i = 0; i < all.length; i++) { var el = all[i]; acc.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, acc); }
    return acc;
  }
  function tagOf(el) { try { return (el.tagName || "").toLowerCase(); } catch (e) { return ""; } }
  function ownText(el) { try { var s = ""; for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3) s += n.nodeValue; } return s.replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function g(el, a) { try { return (el.getAttribute && el.getAttribute(a)) || ""; } catch (e) { return ""; } }
  function labelOf(el) { return g(el, "aria-label") || g(el, "title") || ownText(el); }

  // mirror of the SHIPPED matcher so we can see where it fails
  var ROUTES = ["Data Streams", "Data Lake Objects", "Data Transforms", "Data Model",
    "Identity Resolution", "Data Spaces", "Data Governance", "Intelligent Context",
    "Document AI", "Search Indexes", "Knowledge Harmonization", "Query Editor",
    "Data Explorer", "Data Graphs"];
  function matcherAccepts(node) {
    var tag = tagOf(node), cls = g(node, "class"), role = g(node, "role");
    return tag === "a" || role === "button" || role === "link" || /slds-nav-vertical__action|slds-context-bar__label-action|navItem/.test(cls);
  }

  var ALL = deepAll(document, []);

  // tally nav-ish custom tags
  var navTags = {};
  ALL.forEach(function (el) { var t = tagOf(el); if (t.indexOf("-") >= 0 && /nav/.test(t)) navTags[t] = (navTags[t] || 0) + 1; });

  var items = ROUTES.map(function (label) {
    // find leaf whose own text OR aria-label is exactly the label
    var leaf = null;
    for (var i = 0; i < ALL.length; i++) { var el = ALL[i]; if (ownText(el) === label || g(el, "aria-label") === label) { leaf = el; break; } }
    if (!leaf) return { label: label, found: false };
    var chain = [], node = leaf, firstAccepted = -1;
    for (var h = 0; h < 8 && node; h++) {
      var entry = { tag: tagOf(node), role: g(node, "role"), cls: g(node, "class").slice(0, 80), ariaLabel: g(node, "aria-label"), title: g(node, "title"), href: g(node, "href"), accepts: matcherAccepts(node), labelSeen: labelOf(node).slice(0, 40) };
      if (entry.accepts && firstAccepted < 0 && ROUTES.indexOf(labelOf(node)) >= 0) firstAccepted = h;
      chain.push(entry);
      var p = node.parentElement; if (!p) { try { var rn = node.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } }
      node = p;
    }
    return { label: label, found: true, matcherWouldMatchAtHop: firstAccepted, climb: chain };
  });

  var matched = items.filter(function (x) { return x.found && x.matcherWouldMatchAtHop >= 0; }).length;
  var foundCount = items.filter(function (x) { return x.found; }).length;

  var out = { _tool: "dom-probe", _version: 25, page: location.href, origin: location.origin, navTags: navTags, labelsFound: foundCount, matcherMatches: matched, items: items };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v25 · nav matcher</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Nav labels found: <b>" + foundCount + "</b> / " + items.length + "<br>Current matcher would match: <b>" + matched + "</b><br>Nav component tags: <b>" + Object.keys(navTags).length + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on a page showing the NEW left nav. Expand it so all items render.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v25-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v25 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
