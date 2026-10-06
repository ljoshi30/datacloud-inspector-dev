/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v5 — Activation-specific tags, COMPACT (won't truncate)
 *
 * v4 proved: the "Add Additional Attributes" modal reuses runtime_cdp-attribute-row /
 * -attribute-group-row (already handled) and runtime_cdp-drag-item.details.fieldApiName.
 * The ONE unknown is the MAIN activation attribute TABLE. v5 targets ONLY the activation
 * components and prints a COMPACT view (apiHits + prop keys + a shallow sketch that SKIPS
 * the huge builderState / attributeLibraryMetadata blobs that blew up v4's output).
 *
 * Read-only. Copies JSON to clipboard; also window.__DOM_PROBE.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe5() {
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
  function txt(el) { try { return (el.textContent || "").trim().replace(/\s+/g, " "); } catch (e) { return ""; } }
  function shortTxt(el, n) { var t = txt(el); n = n || 70; return t.length > n ? t.slice(0, n) + "…" : t; }

  // props too huge to be useful — skip them so output stays small
  var SKIP = { builderState: 1, attributeLibraryMetadata: 1, segmentationConfiguration: 1, canvasExpression: 1, template: 1, pathSignature: 1 };
  function sketch(v, d) {
    d = d || 0;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return undefined;
    if (t !== "object") return (t === "string" && v.length > 80) ? v.slice(0, 80) + "…" : v;
    if (d >= 4) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 6).map(function (x) { return sketch(x, d + 1); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 30).forEach(function (k) { if (SKIP[k]) { out[k] = "«skipped»"; return; } try { var s = sketch(v[k], d + 1); if (s !== undefined) out[k] = s; } catch (e) {} });
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
      if (SKIP[k]) { out[k] = "«skipped»"; return; }
      if (/^(refs|shadowRoot|parentElement|children|childNodes|classList|style|dataset|attributes|nextElement|previousElement|first|last|owner|offset|client|scroll|aria|inner|outer|content|node[A-Z]|ELEMENT_|ATTRIBUTE_|TEXT_|CDATA|ENTITY|PROCESSING|COMMENT|DOCUMENT|NOTATION|base|is[A-Z]|tag|local|namespace|current|translate|autocorrect|tabIndex|assigned|\$)/.test(k)) return;
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
      if (found.length > 20 || v == null) return;
      if (typeof v === "string") { if (/__[a-z]{1,5}\b|__c\b|__dlm\b|__dll\b|__cio\b/i.test(v) && !/https?:|force\.com|\/lightning\//.test(v)) found.push(path + " = " + v); return; }
      if (typeof v === "object") { try { Object.keys(v).slice(0, 30).forEach(function (k) { walk(v[k], path ? path + "." + k : k); }); } catch (e) {} }
    })(obj, "");
    return found;
  }

  var ALL = deepAll(document, []);
  // target ONLY activation-specific components (+ the modal palette rows & drag-item)
  var WANT = [
    "runtime_cdp-activation-attribute-datatable",
    "runtime_cdp-activation-attribute-datatable-attribute-column",
    "runtime_cdp-activation-attribute-entity-group",
    "runtime_cdp-activation-related-attribute-limit",
    "runtime_cdp-activation-attribute-container",
    "runtime_cdp-activation-attribute-selector",
    "runtime_cdp-add-additional-attributes-panel",
    "runtime_cdp-activation-summary",
    "runtime_cdp-attribute-row",
    "runtime_cdp-attribute-group-row",
    "runtime_cdp-drag-item"
  ];
  var want = {}; WANT.forEach(function (t) { want[t] = 1; });

  var report = {};
  ALL.forEach(function (el) {
    var tag = tagOf(el);
    if (!want[tag]) return;
    if (!report[tag]) report[tag] = { count: 0, samples: [] };
    report[tag].count++;
    if (report[tag].samples.length < 3) {
      var props = allProps(el);
      report[tag].samples.push({ text: shortTxt(el, 70), propKeys: Object.keys(props), apiHits: apiHits(props), props: props });
    }
  });

  var SNAP = {
    _tool: "dom-probe", _version: 5,
    page: location.href,
    note: "activation-specific tags only; huge metadata props skipped to stay compact",
    targetCounts: Object.keys(report).reduce(function (o, k) { o[k] = report[k].count; return o; }, {}),
    byTag: report
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
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:330px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  var listHtml = Object.keys(report).map(function (t) { return "<div style='display:flex;justify-content:space-between;gap:8px'><span style='color:#64748b;word-break:break-all'>" + t.replace("runtime_cdp-", "") + "</span><b>" + report[t].count + "</b></div>"; }).join("") || "<div style='color:#94a3b8'>No activation components found. Make sure the activation attribute view (or Add Additional Attributes modal) is open.</div>";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v5</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.6;max-height:200px;overflow:auto;background:#f8fafc;border-radius:7px;padding:8px'>" + listHtml + "</div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run once on the main attribute view, once in the Add Additional Attributes modal.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v5-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v5 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", SNAP);
  return SNAP;
})();
