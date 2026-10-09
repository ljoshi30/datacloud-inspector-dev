/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v23 — find the grid/rows on ANY list (no component-tag assumption)
 *
 * v22 found NO runtime_cdp-custom-datatable on the Data Streams list → that list uses a
 * DIFFERENT table component than Data Model. (The earlier __dlm keys were a stale DMO
 * table left in the DOM.) So stop assuming the tag. This probe finds whatever rows exist
 * and how each exposes its record id / link, WITHOUT guessing the component:
 *   - every element with role=row (or <tr>) that sits in the MAIN content (not nav)
 *   - per row: data-row-key-value / data-recordid / any id-looking attr, and any <a href>
 *     (the id, or the /r/<Entity>/<id>/view detail link, is often right in the row's anchor)
 *   - a tally of custom-element tags that look like a grid/table/list (so we see the real
 *     component name, e.g. lightning-datatable / lst-* / forcelist-* / one of SF's)
 *   - the first row's anchors in full (href + text) — the detail link is usually here
 * This is the catch-all: on a standard Lightning list, rows ARE real <a href=/r/.../view>
 * links (unlike the custom DC datatable), so new-tab may already work / be trivially read.
 *
 * RUN on the Data Streams LIST (hard-refresh first). Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe23() {
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
  function roleOf(el) { try { return el.getAttribute("role") || ""; } catch (e) { return ""; } }
  function attrsOf(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 160); } } catch (e) {} return o; }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function idsIn(s) { var out = []; if (typeof s !== "string") return out; var re = /\b[a-zA-Z0-9]{18}\b|\b[a-zA-Z0-9]{15}\b/g, m; while ((m = re.exec(s))) { if (/[0-9]/.test(m[0]) && /[a-zA-Z]/.test(m[0])) out.push(m[0]); } return out; }

  var ALL = deepAll(document, []);

  // (1) tally custom-element tags that look like a grid/table/list
  var gridTagTally = {};
  ALL.forEach(function (el) { var t = tagOf(el); if (t.indexOf("-") >= 0 && /(datatable|data-table|grid|list|table|rowset)/.test(t)) gridTagTally[t] = (gridTagTally[t] || 0) + 1; });

  // (2) all role=row / <tr> elements, excluding ones inside the nav/header chrome
  function inChrome(el) { var n = el, h = 0; while (n && h < 40) { var t = tagOf(n); if (t === "one-appnav" || t === "one-app-nav-bar" || t === "nav" || t === "header" || /navigation/.test(t)) return true; var p = n.parentElement; if (!p) { try { var rn = n.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } } n = p; h++; } return false; }
  var rows = ALL.filter(function (el) { return (tagOf(el) === "tr" || roleOf(el) === "row") && !inChrome(el); });

  // (3) per-row: key attrs, id-looking attrs, and anchors (href+text) — the detail link
  var rowSamples = rows.slice(0, 6).map(function (tr) {
    var idAttrs = {};
    try { for (var j = 0; j < tr.attributes.length; j++) { var a = tr.attributes[j]; if (/row-key|recordid|data-id|row-id|__dl|[a-zA-Z0-9]{15,18}/.test(a.value) || /row-key|record|data-id/.test(a.name)) idAttrs[a.name] = String(a.value).slice(0, 80); } } catch (e) {}
    var anchors = [];
    try { var as = tr.querySelectorAll("a[href]"); for (var i = 0; i < as.length && i < 6; i++) { anchors.push({ href: as[i].getAttribute("href") || "", text: txt(as[i]).slice(0, 40) }); } } catch (e) {}
    // scan descendants for any id-looking attr (the record id may be on an inner cell/link)
    var innerIdAttrs = {};
    try { deepAll(tr, []).slice(0, 50).forEach(function (el) { for (var k = 0; k < el.attributes.length; k++) { var a = el.attributes[k]; if (idsIn(a.value).length) innerIdAttrs[tagOf(el) + "[" + a.name + "]"] = a.value.slice(0, 60); } }); } catch (e) {}
    return { tag: tagOf(tr), role: roleOf(tr), rowIdAttrs: idAttrs, anchors: anchors, innerIdAttrs: innerIdAttrs, text: txt(tr).slice(0, 80) };
  });

  // (4) ALSO: all anchors on the page whose href looks like a /r/<Entity>/<id>/view detail
  var detailLinks = [];
  ALL.forEach(function (el) {
    if (detailLinks.length >= 8) return;
    if (tagOf(el) !== "a") return;
    var hv = ""; try { hv = el.getAttribute("href") || ""; } catch (e) {}
    if (/\/lightning\/r\/[A-Za-z_]+\/[a-zA-Z0-9]{15,18}\//.test(hv) || /\/[a-zA-Z0-9]{15,18}\/view/.test(hv)) detailLinks.push({ href: hv, text: txt(el).slice(0, 50) });
  });

  var out = {
    _tool: "dom-probe", _version: 23, page: location.href, origin: location.origin,
    gridTagTally: gridTagTally,
    rowCount: rows.length,
    rowSamples: rowSamples,
    detailLinksOnPage: detailLinks
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
    + "<b style='font:700 13px system-ui'>DOM Probe v23 · any grid</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Rows (role=row/tr): <b>" + rows.length + "</b><br>Grid tags seen: <b>" + Object.keys(gridTagTally).length + "</b><br>/r/…/view links on page: <b>" + detailLinks.length + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Hard-refresh the Data Streams LIST first, then run (so no stale table lingers).</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v23-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v23 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
