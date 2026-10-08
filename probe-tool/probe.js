/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v17 — LEFT VERTICAL NAV route, via the LABEL-CLIMB (can't come back empty)
 *
 * v16 filtered by exact tag runtime_cdp-desktop-vertical-navigation-item and returned
 * 0 on fullcopy — yet v14's ancestor chain clearly contained that tag. So instead of
 * trusting a tag filter, we do what v14 PROVED works: find each nav LABEL leaf by its
 * text, climb UP through every custom-element ancestor, and dump EACH ancestor's full
 * prop surface + route-looking strings. The route (pageReference, url, navigationTarget,
 * standard-NAME, or the one.app hash) must be on one of those ancestors — this reports
 * all of them so we see exactly which prop holds it. No tag guessing; no empty result if
 * the labels render.
 *
 * RUN on the fullcopy org (LEFT vertical nav). Expand the nav so labels render. Read-only.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe17() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  function deepAll(root, acc) {
    acc = acc || [];
    if (acc.length > 200000) return acc;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return acc; }
    for (var i = 0; i < all.length; i++) { var el = all[i]; acc.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, acc); }
    return acc;
  }
  function tagOf(el) { try { return (el.tagName || "").toLowerCase(); } catch (e) { return ""; } }
  function ownText(el) { try { var s = ""; for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3) s += n.nodeValue; } return s.replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function attrsOf(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 240); } } catch (e) {} return o; }
  function sketch(v, d, maxD) {
    d = d || 0; maxD = maxD || 5;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return "ƒ";
    if (t !== "object") return (t === "string" && v.length > 400) ? v.slice(0, 400) + "…" : v;
    if (d >= maxD) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 10).map(function (x) { return sketch(x, d + 1, maxD); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 60).forEach(function (k) { try { var s = sketch(v[k], d + 1, maxD); if (s !== undefined) out[k] = s; } catch (e) {} });
    return out;
  }
  function propNames(el) {
    var names = {};
    try { Object.keys(el).forEach(function (k) { names[k] = 1; }); } catch (e) {}
    var proto = Object.getPrototypeOf(el), hops = 0;
    while (proto && hops < 12) {
      var dsc; try { dsc = Object.getOwnPropertyDescriptors(proto); } catch (e) { dsc = null; }
      if (dsc) Object.keys(dsc).forEach(function (k) { if (k === "constructor") return; var d = dsc[k]; if (d && (typeof d.get === "function" || "value" in d)) names[k] = 1; });
      proto = Object.getPrototypeOf(proto); hops++;
    }
    return Object.keys(names);
  }
  var NOISE = /^(template|refs|shadowRoot|parentNode|parentElement|children|childNodes|classList|style|dataset|attributes|next|previous|first|last|offset|client|scroll|aria[A-Z]|innerHTML|outerHTML|innerText|outerText|textContent|node[A-Z]|baseURI|is[A-Z]|tagName|localName|namespace|prefix|ownerDocument|assignedSlot|part|slot|contentEditable|isContentEditable|inputMode|enterKeyHint|virtualKeyboardPolicy|spellcheck|autocapitalize|writingSuggestions|draggable|hidden|inert|accessKey|title|lang|dir|translate|autocorrect|nonce|elementTiming|focusGroup|autofocus|accessKeyLabel|ENTITY|ELEMENT_|ATTRIBUTE_|TEXT_|CDATA|PROCESSING|COMMENT|DOCUMENT|NOTATION|oninvalid|on[a-z]+)$/;
  function usefulProps(el) {
    var out = {};
    propNames(el).forEach(function (k) {
      if (NOISE.test(k)) return;
      var v; try { v = el[k]; } catch (e) { return; }
      if (v === undefined || typeof v === "function") return;
      var s = sketch(v, 0, 5);
      if (s !== undefined && !(typeof s === "object" && !Object.keys(s).length)) out[k] = s;
    });
    return out;
  }
  var ROUTE = /\/lightning\/|standard-[A-Za-z]|\/one\/one\.app#|c__[A-Za-z]|objectApiName|pageReference|navigationTarget|runtime_cdp:|\/o\/|\/n\/|\/r\//;
  function routeStrings(el) {
    var hits = {};
    propNames(el).forEach(function (k) {
      if (NOISE.test(k)) return;
      var v; try { v = el[k]; } catch (e) { return; }
      if (typeof v === "string") { if (ROUTE.test(v)) hits[k] = v.slice(0, 300); }
      else if (v && typeof v === "object") { var j = ""; try { j = JSON.stringify(v); } catch (e) {} if (j && ROUTE.test(j)) hits[k] = j.slice(0, 600); }
    });
    try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (ROUTE.test(a.value)) hits["@" + a.name] = a.value.slice(0, 300); } } catch (e) {}
    return hits;
  }

  var ALL = deepAll(document, []);
  var NAV_LABELS = ["Data Streams", "Data Lake Objects", "Data Transforms", "Data Model",
    "Identity Resolution", "Data Spaces", "Data Governance", "Intelligent Context",
    "Document AI", "Search Indexes", "Knowledge Harmonization", "Query Editor",
    "Data Explorer", "Data Graphs"];

  // tally of every custom-element tag that contains "nav" (so we SEE the real tag names)
  var navTagTally = {};
  ALL.forEach(function (el) { var t = tagOf(el); if (/nav/.test(t) && t.indexOf("-") >= 0) navTagTally[t] = (navTagTally[t] || 0) + 1; });

  var items = [];
  NAV_LABELS.forEach(function (label) {
    var leaf = null;
    for (var i = 0; i < ALL.length; i++) { if (ownText(ALL[i]) === label) { leaf = ALL[i]; break; } }
    if (!leaf) return;
    // climb up to 12 hops; for EACH custom-element (tag has a dash) ancestor, dump route
    // strings + a trimmed prop surface. This is what v14 proved reaches the nav item.
    var chain = [], node = leaf;
    for (var h = 0; h < 12 && node; h++) {
      var tg = tagOf(node);
      var rs = routeStrings(node);
      var entry = { tag: tg, attrs: attrsOf(node), routeStrings: rs };
      // only dump full props for custom elements OR when a route hit exists (keep JSON small)
      if (tg.indexOf("-") >= 0 || Object.keys(rs).length) entry.props = usefulProps(node);
      chain.push(entry);
      var p = node.parentElement; if (!p) { try { var rn = node.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } }
      node = p;
    }
    items.push({ label: label, climb: chain });
  });

  var out = {
    _tool: "dom-probe", _version: 17, page: location.href, origin: location.origin,
    navTagTally: navTagTally,
    labelsFound: items.length,
    items: items
  };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var withRoute = items.filter(function (x) { return x.climb.some(function (c) { return Object.keys(c.routeStrings).length; }); }).length;
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v17 · Left nav (climb)</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Labels found: <b>" + items.length + "</b><br>With a route value in the climb: <b>" + withRoute + "</b><br>Nav tags seen: <b>" + Object.keys(navTagTally).length + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on the fullcopy org with the LEFT vertical nav. Expand it so labels render, then click.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v17-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v17 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
