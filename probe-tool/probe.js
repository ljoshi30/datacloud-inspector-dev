/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v26 — NESTED left-nav leaf items (Segments, Activations, Clean Rooms, …)
 *
 * The ⧉ shows on GROUP HEADERS (Segment & Act, Analyze & Predict) but NOT on the LEAF
 * items under them (Segments, Activations, Activation Targets, Communication Capping,
 * Data Actions, Data Action Targets, Data Shares, Data Share Targets, Clean Rooms,
 * Secondary Indexes, Calculated Insights, AI Models, Semantic Layer). We must see WHY —
 * where each leaf's route lives (href on some ancestor? a data-* attr? only after click?)
 * — so we fix the matcher against the REAL DOM, no guessing.
 *
 * For each target label it finds the leaf, climbs ≤10 ancestors and records per hop:
 * tag, role, class, aria-label, title, href, data-* attrs, and whether the SHIPPED matcher
 * (a / role=button|link / slds-nav-vertical__action|slds-context-bar__label-action|navItem)
 * accepts it + whether it has a usable href. Flags leaf vs group (has children-list / chevron).
 *
 * RUN with the Segment & Act and Analyze & Predict groups EXPANDED. Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe26() {
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
  function dataAttrs(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (/^data-|href|aria-current|role/.test(a.name)) o[a.name] = String(a.value).slice(0, 120); } } catch (e) {} return o; }

  function matcherAccepts(el) {
    var tag = tagOf(el), cls = g(el, "class"), role = g(el, "role");
    return tag === "a" || role === "button" || role === "link" || /slds-nav-vertical__action|slds-context-bar__label-action|navItem/.test(cls);
  }
  function usableHref(el) {
    var h = g(el, "href");
    return (h && h !== "#" && !/^javascript:/i.test(h) && /^(\/lightning\/|\/one\/|https?:)/i.test(h)) ? h : "";
  }

  var ALL = deepAll(document, []);
  var LABELS = ["Segments", "Activations", "Activation Targets", "Communication Capping",
    "Data Actions", "Data Action Targets", "Data Shares", "Data Share Targets", "Clean Rooms",
    "Secondary Indexes", "Calculated Insights", "AI Models", "Semantic Layer",
    "Segment & Act", "Analyze & Predict"];

  var items = LABELS.map(function (label) {
    var leaf = null;
    for (var i = 0; i < ALL.length; i++) { var el = ALL[i]; if (ownText(el) === label || g(el, "aria-label") === label) { leaf = el; break; } }
    if (!leaf) return { label: label, found: false };
    var chain = [], node = leaf, matchHop = -1, hrefHop = -1, hrefVal = "";
    for (var h = 0; h < 10 && node; h++) {
      var acc = matcherAccepts(node), uh = usableHref(node);
      var entry = { tag: tagOf(node), role: g(node, "role"), cls: g(node, "class").slice(0, 70), ariaLabel: g(node, "aria-label"), title: g(node, "title"), href: g(node, "href").slice(0, 100), accepts: acc, usableHref: uh ? true : false, data: dataAttrs(node) };
      if (acc && matchHop < 0) matchHop = h;
      if (uh && hrefHop < 0) { hrefHop = h; hrefVal = uh; }
      chain.push(entry);
      var p = node.parentElement; if (!p) { try { var rn = node.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } }
      node = p;
    }
    // is it a GROUP (expandable) or a LEAF? groups have a children-list / chevron nearby
    var isGroup = false;
    try { var up = leaf; for (var k = 0; k < 5 && up; k++) { if (/children-list|has-submenu|expandable/.test(g(up, "class"))) { isGroup = true; break; } up = up.parentElement; } } catch (e) {}
    return { label: label, found: true, matcherMatchHop: matchHop, usableHrefHop: hrefHop, usableHref: hrefVal, isGroup: isGroup, climb: chain };
  });

  var leafNoHref = items.filter(function (x) { return x.found && !x.isGroup && x.usableHrefHop < 0; }).map(function (x) { return x.label; });

  var out = { _tool: "dom-probe", _version: 26, page: location.href, origin: location.origin, labelsChecked: LABELS.length, items: items, leafItemsWithNoUsableHref: leafNoHref };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var foundN = items.filter(function (x) { return x.found; }).length;
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:350px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v26 · nested nav</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Labels found: <b>" + foundN + "</b> / " + LABELS.length + "<br>Leaf items w/ NO usable href: <b>" + leafNoHref.length + "</b><br><i>(those need learn-on-click or a found route)</i></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Expand Segment &amp; Act + Analyze &amp; Predict groups first, then run.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var bl = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = "dom-probe-v26-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v26 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
