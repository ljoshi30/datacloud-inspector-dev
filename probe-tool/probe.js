/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v7 — Segment condition CONTAINER PATH values
 *
 * Earlier probes showed condition elements expose containerPathForDisplay /
 * containerPath / containerJoinPath (+ simpleCondition.path/joinPath/pathForDisplay)
 * but we never captured their VALUES. v7 dumps exactly those, per condition, so we
 * can show the path on hover (the "Container Path" that today only appears on edit)
 * and add it to the export — WITHOUT guessing the shape.
 *
 * Run on the SEGMENT page with the Insurance Policy / related conditions visible.
 * Read-only. Copies JSON to clipboard; also window.__DOM_PROBE.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe7() {
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
  function sketch(v, d) {
    d = d || 0;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return undefined;
    if (t !== "object") return (t === "string" && v.length > 300) ? v.slice(0, 300) + "…" : v;
    if (d >= 4) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 8).map(function (x) { return sketch(x, d + 1); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 30).forEach(function (k) { try { var s = sketch(v[k], d + 1); if (s !== undefined) out[k] = s; } catch (e) {} });
    return out;
  }

  var COND = {
    "runtime_cdp-segment-builder-simple-condition": 1,
    "runtime_cdp-segment-builder-aggregation-condition": 1,
    "runtime_cdp-segment-builder-calculated-insight-condition": 1,
    "runtime_cdp-segment-builder-condition-set": 1,
    "runtime_cdp-canvas-item": 1
  };
  // path-related prop names to capture (element-level + inside the condition object)
  var PATH_PROPS = ["containerPathForDisplay", "containerPath", "containerJoinPath", "pathForDisplay", "path", "joinPath", "displayPath"];

  var ALL = deepAll(document, []);
  var samples = [];
  ALL.forEach(function (el) {
    if (!COND[tagOf(el)]) return;
    if (samples.length >= 12) return;
    var rec = { tag: tagOf(el), elementPath: {}, conditionPath: {} };
    PATH_PROPS.forEach(function (p) { var v = g(el, p); if (v != null && v !== "") rec.elementPath[p] = sketch(v, 0); });
    // the inner condition object (simpleCondition / aggregationCondition / item.details…)
    ["simpleCondition", "aggregationCondition", "calculatedInsightCondition", "condition", "item"].forEach(function (cp) {
      var c = g(el, cp);
      if (c && typeof c === "object") {
        var inner = {};
        PATH_PROPS.forEach(function (p) { var v = g(c, p); if (v != null && v !== "") inner[p] = sketch(v, 0); });
        var subj = g(c, "subject"); if (subj) inner.subject = sketch(subj, 0);
        if (g(c, "attributeName")) inner.attributeName = g(c, "attributeName");
        if (Object.keys(inner).length) rec.conditionPath[cp] = inner;
      }
    });
    // only keep conditions that actually carry some path info (the related ones)
    if (Object.keys(rec.elementPath).length || Object.keys(rec.conditionPath).length) samples.push(rec);
  });

  var out = { _tool: "dom-probe", _version: 7, page: location.href, note: "container-path prop VALUES on condition elements", conditionsWithPath: samples.length, samples: samples };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

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
    + "<b style='font:700 13px system-ui'>DOM Probe v7</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:" + (samples.length ? "#059669" : "#b45309") + ";margin-bottom:8px'>" + (samples.length ? ("✓ Copied (" + kb + " KB) — " + samples.length + " conditions with path") : "⚠ No path props found") + "</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.5'>" + (samples.length ? "Paste it back." : "Scroll so the Insurance Policy / related conditions are visible, then re-run.") + "</div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok && samples.length) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v7-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v7 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
