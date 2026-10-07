/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v11 — CONTAINER PATH (literal, as SF renders it)
 *
 * Goal: find the DOM element that holds the Container Path string SF shows in the
 * container EDIT view, e.g.
 *   "Insurance Policy.Insurance Account Number > TDI Insurance Account.Insurance
 *    Account Primary Insured > Unified Individual TDI.Unified Individual Id"
 * so the tool can READ it verbatim (never reconstruct). Captures, compactly:
 *  (A) EVERY element whose textContent OR a string prop (value/inputText/selected…)
 *      contains the path separator " > " AND a "." — the rendered path value.
 *      For each: tag, the matching prop name(s) + value, and all string/scalar props.
 *  (B) Any element whose own text === "Container Path" (the field LABEL), plus a
 *      sketch of its following-sibling / parent subtree (where the value combobox is).
 *  (C) The container header elements (canvas-item / condition-set / aggregation-
 *      condition) and whether THEY expose the path on a prop (so we know if it's on
 *      the collapsed card or only in the open edit panel).
 *
 * RUN: open a RELATED container that shows a Container Path, click its EDIT (pencil)
 * so the path field is visible, then run this. Read-only. Copies JSON to clipboard.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe11() {
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
  function ownText(el) {
    // text of THIS node only (not descendants) — to find the "Container Path" label leaf
    try { var s = ""; for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3) s += n.nodeValue; } return s.replace(/\s+/g, " ").trim(); } catch (e) { return ""; }
  }
  function sketch(v, d, maxD) {
    d = d || 0; maxD = maxD || 5;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return undefined;
    if (t !== "object") return (t === "string" && v.length > 300) ? v.slice(0, 300) + "…" : v;
    if (d >= maxD) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 12).map(function (x) { return sketch(x, d + 1, maxD); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 60).forEach(function (k) { try { var s = sketch(v[k], d + 1, maxD); if (s !== undefined) out[k] = s; } catch (e) {} });
    return out;
  }
  // all enumerable + prototype-getter props (where @api values hide), scalars/strings/small objs
  function allProps(el, maxD) {
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
      if (/^(template|refs|shadowRoot|parentNode|parentElement|children|childNodes|classList|style|dataset|attributes|nextS|nextE|previous|firstC|lastC|firstE|lastE|offset|client|scroll|aria|innerHTML|outerHTML|node[A-Z]|baseURI|is[A-Z]?$|tagName|localName|namespace|current|translate|autocorrect|tabIndex|assigned|\$|ELEMENT_|ATTRIBUTE_|TEXT_|CDATA|ENTITY|PROCESSING|COMMENT|DOCUMENT|NOTATION)/.test(k)) return;
      var v; try { v = el[k]; } catch (e) { return; }
      if (v == null || typeof v === "function") return;
      var s = sketch(v, 0, maxD || 5);
      if (s !== undefined && !(typeof s === "object" && !Object.keys(s).length)) out[k] = s;
    });
    return out;
  }
  // find prop names on el whose STRING value contains needle
  function propsContaining(el, needle) {
    var hits = {};
    var p = allProps(el, 2);
    (function walk(obj, prefix, depth) {
      if (depth > 3 || obj == null) return;
      if (typeof obj === "string") { if (obj.indexOf(needle) >= 0) hits[prefix || "(self)"] = obj.length > 300 ? obj.slice(0, 300) + "…" : obj; return; }
      if (typeof obj !== "object") return;
      Object.keys(obj).slice(0, 40).forEach(function (k) { walk(obj[k], prefix ? prefix + "." + k : k, depth + 1); });
    })(p, "", 0);
    return hits;
  }

  var ALL = deepAll(document, []);
  var SEP = " > ";

  // ── (A) elements whose rendered text or props carry the literal path (sep + dot) ──
  var pathEls = [];
  ALL.forEach(function (el) {
    if (pathEls.length >= 8) return;
    var t = txt(el);
    var hasInText = t.indexOf(SEP) >= 0 && /\.[^ ]/.test(t);
    // also check common value props even if not in textContent
    var valHits = propsContaining(el, SEP);
    var hasInProp = Object.keys(valHits).length > 0;
    if (!hasInText && !hasInProp) return;
    // keep the DEEPEST such elements (skip huge ancestors that merely contain the text):
    // require the element's own text to be reasonably short OR a prop hit
    if (hasInText && t.length > 400 && !hasInProp) return;
    pathEls.push({
      tag: tagOf(el),
      ownText: ownText(el).slice(0, 300),
      text: t.length > 300 ? t.slice(0, 300) + "…" : t,
      propHits: valHits,
      props: allProps(el, 4)
    });
  });

  // ── (B) the "Container Path" LABEL leaf + its value neighbourhood ──
  var labelEls = [];
  ALL.forEach(function (el) {
    if (labelEls.length >= 5) return;
    var ot = ownText(el);
    if (!/^\*?\s*Container Path\s*$/i.test(ot)) return;
    // climb a couple parents and sketch the subtree text + any combobox-ish descendants
    var host = el;
    for (var h = 0; h < 3 && host.parentElement; h++) host = host.parentElement;
    var combos = [];
    deepAll(host, []).forEach(function (d) {
      var dt = tagOf(d);
      if (/combobox|lightning-base-combobox|input|lightning-grouped-combobox|runtime_cdp-.*path/i.test(dt)) {
        var v = {}; ["value", "inputText", "text", "selectedValue", "label", "placeholder"].forEach(function (p) { try { if (d[p] != null && typeof d[p] !== "function") v[p] = String(d[p]).slice(0, 300); } catch (e) {} });
        var iv = ""; try { if (d.tagName === "INPUT") iv = d.value || ""; } catch (e) {}
        if (iv) v["input.value"] = iv.slice(0, 300);
        combos.push({ tag: dt, valueProps: v });
      }
    });
    labelEls.push({ labelOwnText: ot, hostTag: tagOf(host), hostText: txt(host).slice(0, 400), comboboxes: combos });
  });

  // ── (C) container header elements — do THEY carry the path on a prop? (collapsed vs edit) ──
  var CONTAINER_TAGS = ["runtime_cdp-canvas-item", "runtime_cdp-segment-builder-condition-set", "runtime_cdp-segment-builder-aggregation-condition", "runtime_cdp-segment-builder-simple-condition"];
  var headerSamples = [];
  ALL.forEach(function (el) {
    if (headerSamples.length >= 8) return;
    if (CONTAINER_TAGS.indexOf(tagOf(el)) < 0) return;
    var hits = propsContaining(el, SEP);
    // also look for prop NAMES hinting at path
    var p = allProps(el, 3);
    var named = {}; Object.keys(p).forEach(function (k) { if (/path|container/i.test(k)) named[k] = p[k]; });
    if (Object.keys(hits).length || Object.keys(named).length) headerSamples.push({ tag: tagOf(el), text: txt(el).slice(0, 70), pathValueHits: hits, pathNamedProps: named });
  });

  var out = {
    _tool: "dom-probe", _version: 11, page: location.href, separator: SEP,
    A_pathBearingElements: { count: pathEls.length, samples: pathEls },
    B_containerPathLabel: { count: labelEls.length, samples: labelEls },
    C_containerHeaderProps: { count: headerSamples.length, samples: headerSamples }
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
    + "<b style='font:700 13px system-ui'>DOM Probe v11 · Container Path</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>"
    + "(A) path-bearing els: <b>" + pathEls.length + "</b><br>"
    + "(B) 'Container Path' labels: <b>" + labelEls.length + "</b><br>"
    + "(C) header props w/ path: <b>" + headerSamples.length + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Open a container that shows <b>Container Path</b>, click its <b>edit (pencil)</b> so the path is visible, then run.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v11-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v11 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
