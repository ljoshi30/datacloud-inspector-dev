/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v10 — Rank&Limit field API  +  container selected-path index
 *
 * Captures two outstanding unknowns, compactly:
 *  (A) runtime_cdp-segment-builder-group-rank-limit-condition — ALL props, so we can
 *      find where the Group-By / Sort-By ranked FIELD's api name lives (today the reader
 *      only scrapes the label text, so hover shows just the DMO api, not the field).
 *  (B) For a RELATED container (condition-set / canvas-item) that has MULTIPLE candidate
 *      paths, which prop stores the CHOSEN path (index / selectedPath / containerPath…),
 *      so a multi-path object (e.g. Insurance Policy) resolves to the exact Container Path.
 *
 * RUN on the segment: open the Rank & Limit tab for (A); have a related container for (B).
 * Read-only. Copies JSON to clipboard; also window.__DOM_PROBE.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe10() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  function deepAll(root, acc) {
    acc = acc || [];
    if (acc.length > 90000) return acc;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return acc; }
    for (var i = 0; i < all.length; i++) { var el = all[i]; acc.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, acc); }
    return acc;
  }
  function tagOf(el) { try { return (el.tagName || "").toLowerCase(); } catch (e) { return ""; } }
  function g(o, k) { try { return o[k]; } catch (e) { return undefined; } }
  function sketch(v, d, maxD) {
    d = d || 0; maxD = maxD || 6;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return undefined;
    if (t !== "object") return (t === "string" && v.length > 200) ? v.slice(0, 200) + "…" : v;
    if (d >= maxD) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 10).map(function (x) { return sketch(x, d + 1, maxD); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 50).forEach(function (k) { try { var s = sketch(v[k], d + 1, maxD); if (s !== undefined) out[k] = s; } catch (e) {} });
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
      if (/^(template|refs|shadowRoot|parent|children|childNodes|classList|style|dataset|attributes|next|previous|first|last|offset|client|scroll|aria|inner|outer|node[A-Z]|base|is[A-Z]|tag|local|namespace|current|translate|autocorrect|tabIndex|assigned|\$|ELEMENT_|ATTRIBUTE_|TEXT_|CDATA|ENTITY|PROCESSING|COMMENT|DOCUMENT|NOTATION)/.test(k)) return;
      if (k === "attributeLibraryMetadata" || k === "builderState" || k === "segmentationConfiguration") { out[k] = "«skipped»"; return; }
      var v; try { v = el[k]; } catch (e) { return; }
      if (v == null || typeof v === "function") return;
      var s = sketch(v, 0, 6);
      if (s !== undefined && !(typeof s === "object" && !Object.keys(s).length)) out[k] = s;
    });
    return out;
  }

  var ALL = deepAll(document, []);

  // (A) Rank & Limit condition — full props (up to 2 samples)
  var rankEls = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-segment-builder-group-rank-limit-condition"; });
  var rankSamples = rankEls.slice(0, 3).map(function (el) { return { tag: tagOf(el), props: allProps(el) }; });

  // (B) containers that may carry a selected-path — condition-set + canvas-item: dump any
  //     prop whose NAME hints at path selection (selected/index/path/container) + its value.
  var contEls = ALL.filter(function (el) { var t = tagOf(el); return t === "runtime_cdp-segment-builder-condition-set" || t === "runtime_cdp-canvas-item" || t === "runtime_cdp-segment-builder-aggregation-condition"; });
  var contSamples = [];
  contEls.forEach(function (el) {
    if (contSamples.length >= 6) return;
    var p = allProps(el);
    var picked = {};
    Object.keys(p).forEach(function (k) { if (/select|index|path|container|chosen|active|relationship/i.test(k)) picked[k] = p[k]; });
    if (Object.keys(picked).length) contSamples.push({ tag: tagOf(el), text: (function(){try{return (el.textContent||"").trim().replace(/\s+/g," ").slice(0,70);}catch(e){return"";}})(), selectionProps: picked });
  });

  var out = {
    _tool: "dom-probe", _version: 10, page: location.href,
    rankLimit: { count: rankEls.length, samples: rankSamples },
    containerSelection: { count: contEls.length, samples: contSamples }
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
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:330px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v10</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.6'>Rank&Limit els: <b>" + rankEls.length + "</b><br>Container selection candidates: <b>" + contSamples.length + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>For (A) open the <b>Rank and Limit</b> tab; for (B) have a related container visible.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v10-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v10 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
