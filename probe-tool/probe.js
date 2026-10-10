/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v27 — Segment "Shortcuts" panel: why hovering a shortcut shows a wrong API
 *
 * Hovering "Test Shortcut" (left Shortcuts tab) shows the chip for Account Multiline — a
 * different attribute. We need to see WHAT a shortcut row is, so we can either exclude the
 * Shortcuts panel from the API-name feature or decorate it correctly (no guessing).
 * Captures:
 *   (A) every element whose own text == a shortcut label (we try common ones + any element
 *       inside a container whose text/class mentions "shortcut") → tag/class/props
 *       (attributeNode / details / groupNode / data) that the feature would read.
 *   (B) the Shortcuts panel container: its tag + the tab labels (Shortcuts/Attributes/Segments)
 *   (C) for a given sample shortcut, the full composedPath-style ancestor chain with each
 *       element's SEG-relevant props, so we see exactly which element the matcher latches onto.
 *
 * RUN on the Segment builder with the Shortcuts tab visible. Hover is not needed. Read-only.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe27() {
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
  function cls(el) { try { return (el.getAttribute && el.getAttribute("class")) || ""; } catch (e) { return ""; } }
  function g(o, k) { try { return o[k]; } catch (e) { return undefined; } }
  function sketch(v, d) { d = d || 0; if (v == null) return v; var t = typeof v; if (t === "function") return "ƒ"; if (t !== "object") return (t === "string" && v.length > 120) ? v.slice(0, 120) + "…" : v; if (d >= 3) return Array.isArray(v) ? "array[" + v.length + "]" : "obj"; if (Array.isArray(v)) return v.slice(0, 5).map(function (x) { return sketch(x, d + 1); }); var o = {}, kk; try { kk = Object.keys(v); } catch (e) { return "obj?"; } kk.slice(0, 25).forEach(function (key) { try { o[key] = sketch(v[key], d + 1); } catch (e) {} }); return o; }
  // the SEG-relevant props the feature reads
  function segProps(el) {
    var o = {};
    ["attributeNode", "groupNode", "details", "simpleCondition", "aggregationCondition", "data"].forEach(function (k) {
      var v = g(el, k); if (v != null && typeof v !== "function") o[k] = sketch(v, 0);
    });
    return o;
  }

  var ALL = deepAll(document, []);

  // (B) Shortcuts panel container + tab labels
  var tabLabels = [];
  ALL.forEach(function (el) { var t = ownText(el); if (/^(Shortcuts|Attributes|Segments)$/.test(t) && tabLabels.indexOf(t) < 0 && ownText(el).length < 20) tabLabels.push(t); });
  var shortcutContainers = [];
  ALL.forEach(function (el) { var c = cls(el), tg = tagOf(el); if (/shortcut/i.test(c) || /shortcut/i.test(tg)) { if (shortcutContainers.length < 8) shortcutContainers.push({ tag: tg, cls: c.slice(0, 80) }); } });

  // (A) elements whose own text looks like a shortcut row (short text, inside something
  // shortcut-ish OR a list item in the left panel). Capture the ones carrying SEG props.
  var rows = [];
  ALL.forEach(function (el) {
    if (rows.length >= 12) return;
    var t = ownText(el);
    if (!t || t.length > 40) return;
    var sp = segProps(el);
    var inShortcut = false;
    try { var up = el; for (var k = 0; k < 8 && up; k++) { if (/shortcut/i.test(cls(up)) || /shortcut/i.test(tagOf(up))) { inShortcut = true; break; } up = up.parentElement || (up.getRootNode && up.getRootNode().host); } } catch (e) {}
    if (inShortcut || Object.keys(sp).length) {
      rows.push({ tag: tagOf(el), text: t, cls: cls(el).slice(0, 70), inShortcutPanel: inShortcut, segProps: sp });
    }
  });

  // (C) for the sample label "Test Shortcut" (and any shortcut), climb ancestors recording
  // which element carries a SEG prop that resolves to an API — the thing the matcher grabs.
  function climbFor(label) {
    var leaf = null;
    for (var i = 0; i < ALL.length; i++) { if (ownText(ALL[i]) === label) { leaf = ALL[i]; break; } }
    if (!leaf) return { label: label, found: false };
    var chain = [], node = leaf;
    for (var h = 0; h < 8 && node; h++) {
      var sp = segProps(node);
      chain.push({ tag: tagOf(node), cls: cls(node).slice(0, 60), ownText: ownText(node).slice(0, 40), hasSegProp: Object.keys(sp).length ? sp : undefined });
      var p = node.parentElement; if (!p) { try { var rn = node.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } }
      node = p;
    }
    return { label: label, found: true, climb: chain };
  }
  var samples = ["Test Shortcut", "Segment Code"].map(climbFor);

  var out = { _tool: "dom-probe", _version: 27, page: location.href, tabLabels: tabLabels, shortcutContainers: shortcutContainers, shortcutRowsWithProps: rows, sampleClimbs: samples };
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
    + "<b style='font:700 13px system-ui'>DOM Probe v27 · Shortcuts</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Tabs: <b>" + tabLabels.join(", ") + "</b><br>Shortcut containers: <b>" + shortcutContainers.length + "</b><br>Rows w/ seg props: <b>" + rows.length + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on the Segment builder with the Shortcuts tab showing.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var bl = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(bl); a.download = "dom-probe-v27-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v27 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
