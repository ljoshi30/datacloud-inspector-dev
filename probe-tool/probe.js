/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v3 — tiny, two targets only
 *
 * v2 solved the LEFT palette:
 *   runtime_cdp-attribute-row.attributeNode  = {fieldApiName,objectApiName,label,fieldType,isPrimaryKey,…}
 *   runtime_cdp-attribute-group-row.groupNode = {objectApiName,primaryKeyFieldApiName,children[],fullLabel,…}
 * v3 captures the TWO remaining unknowns, compactly (won't truncate):
 *   (1) RIGHT-SIDE rule element prop shape (runtime_cdp-segment-builder-simple-condition)
 *       — where its field/object API name lives (prop keys + api-signature hits only).
 *   (2) SHADOW-DOM internals of ONE attribute-row and ONE group-row: the inner element
 *       tree (tags + the text node that shows the label) so we know WHERE to inject a chip.
 *
 * Read-only. Copies JSON to clipboard; also window.__DOM_PROBE.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe3() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  function deepAll(root, acc) {
    acc = acc || [];
    if (acc.length > 80000) return acc;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return acc; }
    for (var i = 0; i < all.length; i++) { var el = all[i]; acc.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, acc); }
    return acc;
  }
  function tagOf(el) { try { return (el.tagName || "").toLowerCase(); } catch (e) { return ""; } }
  function txt(el) { try { return (el.textContent || "").trim().replace(/\s+/g, " "); } catch (e) { return ""; } }
  function shortTxt(el, n) { var t = txt(el); n = n || 80; return t.length > n ? t.slice(0, n) + "…" : t; }

  function sketch(v, d) {
    d = d || 0;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return undefined;
    if (t !== "object") return (t === "string" && v.length > 100) ? v.slice(0, 100) + "…" : v;
    if (d >= 3) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 4).map(function (x) { return sketch(x, d + 1); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 25).forEach(function (k) { try { var s = sketch(v[k], d + 1); if (s !== undefined) out[k] = s; } catch (e) {} });
    return out;
  }
  function allProps(el) {
    var names = {};
    try { Object.keys(el).forEach(function (k) { names[k] = 1; }); } catch (e) {}
    var proto = Object.getPrototypeOf(el), hops = 0;
    while (proto && hops < 12) {
      var dsc; try { dsc = Object.getOwnPropertyDescriptors(proto); } catch (e) { dsc = null; }
      if (dsc) Object.keys(dsc).forEach(function (k) { if (k === "constructor") return; var d = dsc[k]; if (d && (typeof d.get === "function" || ("value" in d && typeof d.value !== "function"))) names[k] = 1; });
      proto = Object.getPrototypeOf(proto); hops++;
    }
    var out = {};
    Object.keys(names).forEach(function (k) {
      if (/^(template|refs|shadowRoot|parentElement|children|childNodes|classList|style|dataset|attributes|nextElement|previousElement|first|last|owner|offset|client|scroll|aria|inner|outer|content|node|ELEMENT_|ATTRIBUTE_|TEXT_|CDATA|ENTITY|PROCESSING|COMMENT|DOCUMENT|NOTATION|base|is[A-Z]|tag|local|namespace|current|translate|autocorrect|tabIndex|assigned|\$)/.test(k)) return;
      var v; try { v = el[k]; } catch (e) { return; }
      if (v == null) return;
      var t = typeof v;
      if (t === "function") return;
      if (t === "object") { var s = sketch(v, 0); if (s && (typeof s !== "object" || Object.keys(s).length)) out[k] = s; }
      else if (t === "string" || t === "number" || t === "boolean") { if (v !== "" && v !== false) out[k] = v; }
    });
    return out;
  }
  function apiHits(obj) {
    var found = [];
    (function walk(v, path) {
      if (found.length > 10 || v == null) return;
      if (typeof v === "string") { if (/__/.test(v) && !/force\.com|https?:/.test(v)) found.push(path + " = " + v); return; }
      if (typeof v === "object") { try { Object.keys(v).slice(0, 25).forEach(function (k) { walk(v[k], path ? path + "." + k : k); }); } catch (e) {} }
    })(obj, "");
    return found;
  }

  // compact shadow tree: tag + (if leaf) its text, depth-limited
  function shadowTree(el, depth, maxDepth) {
    depth = depth || 0; maxDepth = maxDepth || 5;
    var node = { tag: tagOf(el) || el.nodeName };
    var cls = ""; try { cls = (el.className && el.className.baseVal != null) ? el.className.baseVal : (typeof el.className === "string" ? el.className : ""); } catch (e) {}
    if (cls) node.class = String(cls).slice(0, 40);
    // direct text (not from descendants)
    var ownText = "";
    try { for (var i = 0; i < el.childNodes.length; i++) { var c = el.childNodes[i]; if (c.nodeType === 3) { var tt = (c.nodeValue || "").trim(); if (tt) ownText += tt + " "; } } } catch (e) {}
    if (ownText.trim()) node.text = ownText.trim().slice(0, 50);
    if (depth >= maxDepth) { node.more = "…"; return node; }
    var kids = [];
    var roots = [];
    if (el.shadowRoot) roots.push(el.shadowRoot);
    roots.push(el);
    roots.forEach(function (r) {
      try { for (var j = 0; j < r.children.length; j++) kids.push(r.children[j]); } catch (e) {}
    });
    if (el.shadowRoot) node.hasShadow = true;
    if (kids.length) node.children = kids.slice(0, 8).map(function (k) { return shadowTree(k, depth + 1, maxDepth); });
    return node;
  }

  var ALL = deepAll(document, []);
  function firstOf(tag) { return ALL.filter(function (e) { return tagOf(e) === tag; })[0]; }

  // (1) right-side condition prop shapes (3 samples)
  var condTags = ["runtime_cdp-segment-builder-simple-condition", "runtime_cdp-segment-builder-aggregation-condition"];
  var conditions = {};
  condTags.forEach(function (tag) {
    var els = ALL.filter(function (e) { return tagOf(e) === tag; });
    conditions[tag] = { count: els.length, samples: els.slice(0, 3).map(function (el) { var p = allProps(el); return { text: shortTxt(el, 90), propKeys: Object.keys(p), apiHits: apiHits(p), props: p }; }) };
  });

  // (2) shadow trees for one attribute-row + one group-row (so we know where to inject)
  var attrRow = firstOf("runtime_cdp-attribute-row");
  var groupRow = firstOf("runtime_cdp-attribute-group-row");
  var condEl = firstOf("runtime_cdp-segment-builder-simple-condition");

  var SNAP = {
    _tool: "dom-probe", _version: 3,
    page: location.href,
    conditions: conditions,
    shadow_attributeRow: attrRow ? shadowTree(attrRow, 0, 6) : null,
    shadow_attributeGroupRow: groupRow ? shadowTree(groupRow, 0, 6) : null,
    shadow_simpleCondition: condEl ? shadowTree(condEl, 0, 6) : null
  };

  var json = ""; try { json = JSON.stringify(SNAP, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = SNAP; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:320px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v3</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:12px;color:#475569;line-height:1.6'>simple-condition: <b>" + (conditions["runtime_cdp-segment-builder-simple-condition"] ? conditions["runtime_cdp-segment-builder-simple-condition"].count : 0) + "</b><br>attribute-row shadow: <b>" + (attrRow ? "captured" : "—") + "</b><br>group-row shadow: <b>" + (groupRow ? "captured" : "—") + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Open the segment <b>builder</b> (left attributes + Include rules visible) before clicking.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v3-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v3 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", SNAP);
  return SNAP;
})();
