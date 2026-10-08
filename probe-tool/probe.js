/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v20 — DMO datatable rows, via SHADOW-CROSSING filter of the global walk
 *
 * v19 bug: deepAll(dt,...) re-walked from the host and missed the host's OWN shadow
 * root (datatable content lives in shadow: firstLevelChildTags = slot/span/div/div,
 * descendantCount 0). The GLOBAL walk from document DOES capture shadow content. So
 * v20 filters the global element list to those INSIDE the datatable, climbing across
 * shadow boundaries (parentElement, else getRootNode().host). Then it reports every
 * row-ish element (tag tr / role=row / role=gridcell) with its key attrs + title +
 * text, plus role/tag tallies and the first element whose attr/title carries a __dlm
 * api token. This finds the real per-row key anchor (truncation-proof, unambiguous).
 *
 * RUN on the Data Model LIST page (scroll a couple rows into view). Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe20() {
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
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function roleOf(el) { try { return el.getAttribute("role") || ""; } catch (e) { return ""; } }
  function allAttrs(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 160); } } catch (e) {} return o; }
  function titleOf(el) { try { return (el.getAttribute("title") || "").slice(0, 160); } catch (e) { return ""; } }
  // climb across shadow boundaries; true if `host` is an ancestor of `el`
  function isInside(el, host) {
    var n = el, hops = 0;
    while (n && hops < 60) {
      if (n === host) return true;
      var p = n.parentElement;
      if (!p) { try { var rn = n.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } }
      n = p; hops++;
    }
    return false;
  }

  var ALL = deepAll(document, []);
  var dt = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-custom-datatable"; })[0] || null;

  var result = { found: !!dt };
  if (dt) {
    var data = null; try { data = dt.data; } catch (e) {}
    result.keyField = (function () { try { return dt.keyField; } catch (e) { return null; } })();
    result.dataLen = data ? data.length : 0;
    result.dataSample = (data || []).slice(0, 2).map(function (r) { return { name: r && r.name, label: r && r.label }; });

    // ALL elements inside the datatable (shadow-crossing)
    var inside = ALL.filter(function (el) { return el !== dt && isInside(el, dt); });
    result.insideCount = inside.length;

    // role + tag tallies among inside els
    var roleTally = {}, tagTally = {};
    inside.forEach(function (el) { var r = roleOf(el); if (r) roleTally[r] = (roleTally[r] || 0) + 1; var g = tagOf(el); tagTally[g] = (tagTally[g] || 0) + 1; });
    result.roleTally = roleTally;
    result.topTags = Object.keys(tagTally).sort(function (a, b) { return tagTally[b] - tagTally[a]; }).slice(0, 16).reduce(function (o, k) { o[k] = tagTally[k]; return o; }, {});

    // row-ish elements: tr OR role=row
    var rows = inside.filter(function (el) { return tagOf(el) === "tr" || roleOf(el) === "row"; });
    result.rowishCount = rows.length;
    result.rowSamples = rows.slice(0, 4).map(function (tr) {
      // key attrs on the row + first cell's title/link
      var cellTitles = [], cellLinks = [];
      try {
        var cells = tr.querySelectorAll("td,th,[role='gridcell'],[role='cell']");
        for (var i = 0; i < cells.length && i < 8; i++) {
          var c = cells[i];
          var tt = ""; try { var te = c.querySelector("[title]"); tt = te ? (te.getAttribute("title") || "") : titleOf(c); } catch (e) {}
          if (tt) cellTitles.push(tt.slice(0, 100));
          var a = c.querySelector && c.querySelector("a,button,[role='button']");
          if (a) cellLinks.push({ tag: tagOf(a), title: ((a.getAttribute && a.getAttribute("title")) || "").slice(0, 100), href: (a.getAttribute && a.getAttribute("href")) || "" });
        }
      } catch (e) {}
      return { tag: tagOf(tr), role: roleOf(tr), rowAttrs: allAttrs(tr), rowText: txt(tr).slice(0, 90), cellTitles: cellTitles, cellLinks: cellLinks };
    });

    // first element whose attribute VALUE or title contains a __dlm api token (the key!)
    var apiRe = /[A-Za-z0-9_]+__(?:dlm|dll|c)\b/;
    var keyEl = null;
    for (var j = 0; j < inside.length; j++) {
      var el = inside[j];
      var hit = "";
      try { for (var k = 0; k < el.attributes.length; k++) { if (apiRe.test(el.attributes[k].value)) { hit = el.attributes[k].name + "=" + el.attributes[k].value.slice(0, 80); break; } } } catch (e) {}
      if (!hit) { var tl = titleOf(el); if (apiRe.test(tl)) hit = "title=" + tl.slice(0, 80); }
      if (hit) { keyEl = { tag: tagOf(el), role: roleOf(el), where: hit, attrs: allAttrs(el) }; break; }
    }
    result.firstApiKeyElement = keyEl;
  }

  var out = { _tool: "dom-probe", _version: 20, page: location.href, origin: location.origin, datatable: result };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var r = result || {};
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v20 · rows (shadow-fixed)</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Inside datatable: <b>" + (r.insideCount || 0) + "</b> els<br>Row-ish (tr/role=row): <b>" + (r.rowishCount || 0) + "</b><br>Found __dlm key element: <b>" + (r.firstApiKeyElement ? "yes" : "no") + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on the Data Model LIST page. Scroll a couple rows into view first.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v20-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v20 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
