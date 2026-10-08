/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v16 — LEFT VERTICAL NAV item route (the FUTURE default nav)
 *
 * Salesforce is moving Data Cloud to the LEFT vertical nav for everyone. Those
 * items are <a role="button" href=""> (no link) → right-click "open in new tab"
 * fails. v14 dumped the wrong ancestor; the REAL nav-item element (seen in the
 * fullcopy customAncestorChain) is:
 *      runtime_cdp-desktop-vertical-navigation-item
 * This probe dumps THAT element (and its tooltip/panel kin) fully, so we can find
 * the prop that holds each item's destination (pageReference / navigationTarget /
 * apiName / url / route / tab api). If it's there, we read it live and build real
 * target="_blank" links for every left-nav item — no hardcoded guesses.
 *
 * For each left-nav item it captures, on runtime_cdp-desktop-vertical-navigation-item:
 *  - label (from the inner text / aria-label)
 *  - ALL own + prototype-getter props (sketched deep) — the full surface, so we
 *    don't miss the route wherever SF hid it
 *  - any attrs; any 15/18-char id or *__dlm/__c token; any string that looks like
 *    a "/lightning/…" or "standard-…" route or a base64 one.app hash
 *
 * RUN on a Data Cloud page showing the LEFT vertical nav. Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe16() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  function deepAll(root, acc) {
    acc = acc || [];
    if (acc.length > 150000) return acc;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return acc; }
    for (var i = 0; i < all.length; i++) { var el = all[i]; acc.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, acc); }
    return acc;
  }
  function tagOf(el) { try { return (el.tagName || "").toLowerCase(); } catch (e) { return ""; } }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function attrsOf(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 240); } } catch (e) {} return o; }
  function sketch(v, d, maxD) {
    d = d || 0; maxD = maxD || 6;
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
  // FULL prop surface (minus the DOM-plumbing noise), sketched deep — we want to SEE the route
  function allProps(el) {
    var out = {};
    propNames(el).forEach(function (k) {
      if (/^(template|refs|shadowRoot|parentNode|parentElement|children|childNodes|classList|style|dataset|attributes|next|previous|first|last|offset|client|scroll|aria|innerHTML|outerHTML|innerText|outerText|textContent|node[A-Z]|baseURI|is[A-Z]|tagName|localName|namespace|prefix|ownerDocument|assignedSlot|part|slot|contentEditable|isContentEditable|inputMode|enterKeyHint|virtualKeyboardPolicy|spellcheck|autocapitalize|writingSuggestions|draggable|hidden|inert|accessKey|title|lang|dir|translate|autocorrect|nonce|elementTiming|focusGroup|autofocus|\$|ELEMENT_|ATTRIBUTE_|TEXT_|CDATA|ENTITY|PROCESSING|COMMENT|DOCUMENT|NOTATION)/.test(k)) return;
      var v; try { v = el[k]; } catch (e) { return; }
      if (v === undefined) return;
      var s = sketch(v, 0, 6);
      if (s !== undefined && !(typeof s === "object" && !Object.keys(s).length)) out[k] = s;
    });
    return out;
  }
  var ROUTE = /\/lightning\/[a-z]\/|standard-[A-Za-z]|\/one\/one\.app#|c__[A-Za-z]|objectApiName|pageReference|runtime_cdp:/;
  function routeStrings(el) {
    var hits = {};
    propNames(el).forEach(function (k) {
      var v; try { v = el[k]; } catch (e) { return; }
      if (typeof v === "string") { if (ROUTE.test(v)) hits[k] = v.slice(0, 300); }
      else if (v && typeof v === "object") { var j = ""; try { j = JSON.stringify(v); } catch (e) {} if (j && ROUTE.test(j)) hits[k] = j.slice(0, 500); }
    });
    try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (ROUTE.test(a.value)) hits["@" + a.name] = a.value.slice(0, 300); } } catch (e) {}
    return hits;
  }

  var ALL = deepAll(document, []);
  // the real left-nav item elements (+ their tooltip/panel kin, in case the route sits there)
  var ITEM_TAG = "runtime_cdp-desktop-vertical-navigation-item";
  var KIN = ["runtime_cdp-desktop-vertical-navigation-item", "runtime_cdp-desktop-vertical-navigation-tooltip", "runtime_cdp-desktop-vertical-navigation-panel"];
  var itemEls = ALL.filter(function (el) { return tagOf(el) === ITEM_TAG; });

  var items = itemEls.slice(0, 20).map(function (el) {
    var label = ""; try { label = (el.getAttribute && el.getAttribute("aria-label")) || ""; } catch (e) {}
    if (!label) label = txt(el).slice(0, 60);
    return {
      tag: ITEM_TAG,
      label: label,
      attrs: attrsOf(el),
      routeStrings: routeStrings(el),   // ← the gold: any route-looking value, by prop name
      props: allProps(el)               // ← full surface so we can see WHERE the route is
    };
  });

  // Also: the panel element often holds the whole nav MODEL (array of items w/ targets).
  var panels = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-desktop-vertical-navigation-panel"; })
    .slice(0, 2).map(function (el) { return { tag: tagOf(el), routeStrings: routeStrings(el), props: allProps(el) }; });

  // And any lightning-vertical-navigation-item (the SLDS wrapper) in case the href lives there
  var sldsItems = ALL.filter(function (el) { return /lightning-vertical-navigation-item$/.test(tagOf(el)); })
    .slice(0, 4).map(function (el) { return { tag: tagOf(el), attrs: attrsOf(el), routeStrings: routeStrings(el), props: allProps(el) }; });

  var out = {
    _tool: "dom-probe", _version: 16, page: location.href, origin: location.origin,
    itemTag: ITEM_TAG, itemCount: itemEls.length,
    items: items,
    navPanels: panels,
    sldsNavItems: sldsItems
  };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var withRoute = items.filter(function (x) { return Object.keys(x.routeStrings).length; }).length;
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v16 · Left nav route</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Left-nav items: <b>" + itemEls.length + "</b><br>With a route-looking value: <b>" + withRoute + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on a Data Cloud page with the LEFT vertical nav. Expand it so all items render.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v16-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v16 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
