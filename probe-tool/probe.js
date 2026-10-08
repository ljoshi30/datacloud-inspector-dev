/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v14 — DATA CLOUD LEFT NAV + LIST ROWS ("open in a new tab")
 *
 * Goal (two halves, one run):
 *  (NAV) Does each left-nav item ("Data Streams", "Data Transforms", "Data Model", …)
 *        carry a REAL navigable URL anywhere — <a href>, data-route, or LWC
 *        pageReference — so our launcher can offer target="_blank" links? If it's a
 *        pure JS click handler (no url) we must know, so we don't fake a 404 link.
 *  (ROWS) Same question for LIST ROWS on the current page (DMOs, Data Streams,
 *        Transforms, …). A DMO detail page HAS a real URL, so if the row exposes the
 *        record id / developer name / a cell <a href>, we can build a real new-tab
 *        link per row (today you must duplicate the tab). Capture whatever identifier
 *        the row carries — id, apiName, developerName, pageReference, cell href.
 * Plus the page origin so we can see the real pod/path scheme.
 *
 * RUN on a Data Cloud LIST page (e.g. Data Model / Data Lake Objects) with the left
 * nav visible. Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe14() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  function deepAll(root, acc) {
    acc = acc || [];
    if (acc.length > 120000) return acc;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return acc; }
    for (var i = 0; i < all.length; i++) { var el = all[i]; acc.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, acc); }
    return acc;
  }
  function tagOf(el) { try { return (el.tagName || "").toLowerCase(); } catch (e) { return ""; } }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function ownText(el) { try { var s = ""; for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3) s += n.nodeValue; } return s.replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function attrsOf(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 200); } } catch (e) {} return o; }
  function hrefOf(el) { try { return el.href || (el.getAttribute && el.getAttribute("href")) || ""; } catch (e) { return ""; } }
  function sketch(v, d, maxD) {
    d = d || 0; maxD = maxD || 4;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return undefined;
    if (t !== "object") return (t === "string" && v.length > 300) ? v.slice(0, 300) + "…" : v;
    if (d >= maxD) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 8).map(function (x) { return sketch(x, d + 1, maxD); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 40).forEach(function (k) { try { var s = sketch(v[k], d + 1, maxD); if (s !== undefined) out[k] = s; } catch (e) {} });
    return out;
  }
  // props whose NAME hints at navigation, sketched
  function navProps(el) {
    var out = {};
    var names = {};
    try { Object.keys(el).forEach(function (k) { names[k] = 1; }); } catch (e) {}
    var proto = Object.getPrototypeOf(el), hops = 0;
    while (proto && hops < 10) {
      var dsc; try { dsc = Object.getOwnPropertyDescriptors(proto); } catch (e) { dsc = null; }
      if (dsc) Object.keys(dsc).forEach(function (k) { if (k === "constructor") return; var d = dsc[k]; if (d && (typeof d.get === "function" || ("value" in d && typeof d.value !== "function"))) names[k] = 1; });
      proto = Object.getPrototypeOf(proto); hops++;
    }
    Object.keys(names).forEach(function (k) {
      if (!/href|url|route|pageref|page_ref|navig|attributes|apiname|objectapi|target|^to$|link|destination|menuitem|tab/i.test(k)) return;
      var v; try { v = el[k]; } catch (e) { return; }
      if (v == null || typeof v === "function") return;
      var s = sketch(v, 0, 4);
      if (s !== undefined && !(typeof s === "object" && !Object.keys(s).length)) out[k] = s;
    });
    return out;
  }

  var ALL = deepAll(document, []);
  var NAV_LABELS = ["Data Streams", "Data Lake Objects", "Data Transforms", "Data Model",
    "Identity Resolution", "Data Spaces", "Data Governance", "Intelligent Context",
    "Document AI", "Search Indexes", "Knowledge Harmonization", "Query Editor",
    "Data Explorer", "Data Graphs"];

  // Candidate nav containers (common Lightning nav tags) — report their tag so we know the host
  var NAV_HOST_TAGS = ["one-app-nav-bar", "one-appnav", "lightning-vertical-navigation",
    "lightning-vertical-nav-item", "lightning-vertical-nav-section", "runtime_navigation-nav",
    "forcenavdesktop", "one-app-nav-bar-item-root"];
  var navHosts = {};
  ALL.forEach(function (el) { var t = tagOf(el); if (NAV_HOST_TAGS.indexOf(t) >= 0) navHosts[t] = (navHosts[t] || 0) + 1; });

  // For each known nav label, find the element whose OWN text is that label, then walk up a
  // few parents to the clickable item and capture url/attrs/props.
  var items = [];
  NAV_LABELS.forEach(function (label) {
    if (items.length >= 20) return;
    var leaf = null;
    for (var i = 0; i < ALL.length; i++) { if (ownText(ALL[i]) === label) { leaf = ALL[i]; break; } }
    if (!leaf) return;
    // climb to the nearest anchor/button/[role] ancestor (the actual clickable)
    var node = leaf, clickable = null, hops = [];
    for (var h = 0; h < 6 && node; h++) {
      var tg = tagOf(node);
      hops.push(tg);
      if (!clickable && (tg === "a" || tg === "button" || (node.getAttribute && (node.getAttribute("role") === "menuitem" || node.getAttribute("role") === "link")))) clickable = node;
      var p = node.parentElement; if (!p) { try { var rn = node.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } }
      node = p;
    }
    var host = clickable || leaf;
    // find any descendant anchor with an href under the leaf's clickable ancestor chain
    var descHref = "";
    try { var a = (clickable || leaf).querySelector && (clickable || leaf).querySelector("a[href]"); if (a) descHref = a.href || a.getAttribute("href") || ""; } catch (e) {}
    // ── climb further to the NAV-ITEM HOST (the LWC that owns the route) and deep-dump it.
    // v12 proved the inner <a> has an empty href — the real target (pageReference / url /
    // apiName / developerName) lives on the lightning-vertical-navigation-item or
    // one-app-nav-bar-item-root ancestor. Collect the first such host and sketch ALL props.
    var NAVITEM_TAGS = ["lightning-vertical-navigation-item", "lightning-vertical-navigation-item-icon",
      "one-app-nav-bar-item-root", "one-app-nav-bar-item", "forcenavdesktopitem"];
    var navHost = null, chainTags = [], n2 = leaf;
    for (var hh = 0; hh < 14 && n2; hh++) {
      var tg2 = tagOf(n2); if (tg2.indexOf("-") >= 0) chainTags.push(tg2);
      if (!navHost && NAVITEM_TAGS.indexOf(tg2) >= 0) navHost = n2;
      var pp = n2.parentElement; if (!pp) { try { var rr = n2.getRootNode(); pp = rr && rr.host ? rr.host : null; } catch (e) { pp = null; } }
      n2 = pp;
    }
    var navHostDump = null;
    if (navHost) {
      var full = {};
      var nm = {}; try { Object.keys(navHost).forEach(function (k) { nm[k] = 1; }); } catch (e) {}
      var pr = Object.getPrototypeOf(navHost), hc = 0;
      while (pr && hc < 10) { var dd; try { dd = Object.getOwnPropertyDescriptors(pr); } catch (e) { dd = null; } if (dd) Object.keys(dd).forEach(function (k) { if (k === "constructor") return; var d = dd[k]; if (d && (typeof d.get === "function" || ("value" in d && typeof d.value !== "function"))) nm[k] = 1; }); pr = Object.getPrototypeOf(pr); hc++; }
      Object.keys(nm).forEach(function (k) {
        if (/^(template|refs|shadowRoot|parent|children|childNodes|classList|style|dataset|attributes|next|previous|first|last|offset|client|scroll|aria|inner|outer|node[A-Z]|base|tag|local|namespace|current|translate|autocorrect|contentEditable|isContentEditable|inputMode|spellcheck|draggable|hidden|inert|accessKey|title|lang|dir|slot|id$|className|\$|ELEMENT_|ATTRIBUTE_|TEXT_|CDATA|ENTITY|PROCESSING|COMMENT|DOCUMENT|NOTATION)/.test(k)) return;
        var v; try { v = navHost[k]; } catch (e) { return; }
        if (v == null || typeof v === "function") return;
        var s = sketch(v, 0, 5);
        if (s !== undefined && !(typeof s === "object" && !Object.keys(s).length)) full[k] = s;
      });
      navHostDump = { tag: tagOf(navHost), attrs: attrsOf(navHost), props: full };
    }
    items.push({
      label: label,
      leafTag: tagOf(leaf),
      clickableTag: clickable ? tagOf(clickable) : "(none — not an a/button/role)",
      ancestorChain: hops,
      customAncestorChain: chainTags,
      selfHref: hrefOf(host),
      descendantHref: descHref,
      attrs: attrsOf(host),
      navProps: navProps(host),
      navItemHost: navHostDump   // ← the LWC that owns the route (pageReference/url/apiName)
    });
  });

  // ── (ROWS) list rows on the current page (DMO/Data Stream/Transform tables) ──
  // Find data-table row elements, and for each capture: a cell <a href> (the gold),
  // row-level data-* attrs, and any id/apiName/developerName/pageReference-ish props
  // (what we'd need to BUILD a real detail URL for a new tab).
  var ROW_TAGS = ["tr", "lightning-tree-grid-row", "lightning-datatable",
    "runtime_cdp-data-lake-object-row", "runtime_cdp-dmo-row", "one-record-home-flexipage2",
    "lightning-primitive-cell-factory"];
  var rowEls = [];
  ALL.forEach(function (el) {
    var t = tagOf(el);
    if (t === "tr" || /(^|-)row$/.test(t)) rowEls.push(el);
  });
  // keep rows that actually have an <a href> OR a navish prop OR data-row-key-value
  var rowSamples = [];
  rowEls.forEach(function (el) {
    if (rowSamples.length >= 12) return;
    var label = "";
    try { var firstA = el.querySelector && el.querySelector("a"); if (firstA) label = txt(firstA); } catch (e) {}
    if (!label) label = txt(el).slice(0, 60);
    if (!label) return;
    var cellHref = "";
    try { var a = el.querySelector && el.querySelector("a[href]"); if (a) cellHref = a.href || a.getAttribute("href") || ""; } catch (e) {}
    var attrs = attrsOf(el);
    var np = navProps(el);
    // also harvest any id-ish attribute on a descendant anchor (data-recordid etc.)
    var anchorAttrs = {};
    try { var a2 = el.querySelector && el.querySelector("a"); if (a2) anchorAttrs = attrsOf(a2); } catch (e) {}
    var interesting = cellHref || Object.keys(np).length || /recordid|row-key|developername|apiname/i.test(JSON.stringify(attrs) + JSON.stringify(anchorAttrs));
    if (!interesting) return;
    rowSamples.push({ rowTag: t_(el), label: label, cellHref: cellHref, rowAttrs: attrs, anchorAttrs: anchorAttrs, navProps: np });
  });
  function t_(el) { return tagOf(el); }

  var out = {
    _tool: "dom-probe", _version: 14, page: location.href,
    origin: location.origin,
    navHostTagsSeen: navHosts,
    nav: { labelsFound: items.length, items: items },
    rows: { candidatesScanned: rowEls.length, withLinkOrId: rowSamples.length, samples: rowSamples }
  };
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
    + "<b style='font:700 13px system-ui'>DOM Probe v14 · Nav routes + Rows</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Nav labels: <b>" + items.length + "</b> (href: <b>" + items.filter(function (x) { return x.selfHref || x.descendantHref; }).length + "</b>)<br>List rows with link/id: <b>" + rowSamples.length + "</b> of " + rowEls.length + "</div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on a Data Cloud LIST page (e.g. Data Model) with the left nav visible. Expand the nav first so all items are in the DOM.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v12-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v14 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
