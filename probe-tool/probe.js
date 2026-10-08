/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v18 — DMO list RENDERED ROWS: find a reliable per-row key anchor
 *
 * The hover ⧉ feature matched a row by its VISIBLE text against .data[] labels, but
 * the list truncates labels ("Activation Audience - …") so the match fails → no button.
 * Lightning datatables usually tag each rendered <tr> with data-row-key-value="<keyField>"
 * (here keyField = "name" = the DMO api). If that's present we read the api straight off
 * the hovered row — no text matching, truncation-proof. This probe inspects the ACTUAL
 * rendered rows under runtime_cdp-custom-datatable and reports, per row:
 *   - the <tr> (and its cells') attributes — looking for data-row-key-value / data-* keys
 *   - the api-name cell's full text + its title attr (full value even when display-truncated)
 *   - which element in the row is the clickable label
 * Plus: does .data[] still line up 1:1 with rendered rows (so index-mapping is a fallback)?
 *
 * RUN on the Data Model LIST page. Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe18() {
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
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function attrsOf(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 200); } } catch (e) {} return o; }
  // attributes anywhere in the subtree that look like a row key / id (data-row-key-value etc.)
  function keyAttrsInSubtree(root) {
    var hits = {};
    deepAll(root, []).slice(0, 120).forEach(function (el) {
      try {
        for (var i = 0; i < el.attributes.length; i++) {
          var a = el.attributes[i];
          if (/row-key|rowkey|data-row|row-id|rowid|data-key|data-id|data-name|data-recordid|__dlm/i.test(a.name + "=" + a.value)) {
            hits[tagOf(el) + "[" + a.name + "]"] = String(a.value).slice(0, 120);
          }
        }
      } catch (e) {}
    });
    return hits;
  }

  var ALL = deepAll(document, []);
  var dts = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-custom-datatable"; });

  var report = dts.slice(0, 2).map(function (dt) {
    // the authoritative model
    var data = null; try { data = dt.data; } catch (e) {}
    var dataSample = (data || []).slice(0, 3).map(function (r) { return { name: r && r.name, label: r && r.label, objectLabel: r && r.objectLabel && r.objectLabel.label }; });
    var keyField = null; try { keyField = dt.keyField; } catch (e) {}

    // rendered rows: find <tr> elements inside this datatable's subtree
    var rows = deepAll(dt, []).filter(function (el) { return tagOf(el) === "tr"; });
    var rowSamples = rows.slice(0, 4).map(function (tr) {
      // cells
      var cells = [];
      try {
        var tds = tr.querySelectorAll("td,th");
        for (var i = 0; i < tds.length && i < 10; i++) {
          var c = tds[i];
          var a = c.querySelector && c.querySelector("a,span[title],lightning-base-formatted-text");
          cells.push({
            cellTag: tagOf(c),
            text: txt(c).slice(0, 60),
            title: (function () { try { var t = c.querySelector("[title]"); return t ? (t.getAttribute("title") || "").slice(0, 120) : ((c.getAttribute && c.getAttribute("title")) || ""); } catch (e) { return ""; } })(),
            attrs: attrsOf(c),
            innerLinkTag: a ? tagOf(a) : "",
            innerLinkTitle: a ? ((a.getAttribute && a.getAttribute("title")) || "").slice(0, 120) : ""
          });
        }
      } catch (e) {}
      return {
        trAttrs: attrsOf(tr),
        rowText: txt(tr).slice(0, 100),
        keyAttrs: keyAttrsInSubtree(tr),
        cells: cells
      };
    });

    return {
      tag: "runtime_cdp-custom-datatable",
      keyField: keyField,
      dataLen: data ? data.length : 0,
      dataSample: dataSample,
      renderedRowCount: rows.length,
      rowSamples: rowSamples
    };
  });

  var out = { _tool: "dom-probe", _version: 18, page: location.href, origin: location.origin, datatables: dts.length, report: report };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var keyFound = report.some(function (r) { return r.rowSamples.some(function (s) { return Object.keys(s.keyAttrs).length || /row-key/i.test(JSON.stringify(s.trAttrs)); }); });
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v18 · DMO rows</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Datatables: <b>" + dts.length + "</b><br>Rendered rows: <b>" + (report[0] ? report[0].renderedRowCount : 0) + "</b> · .data[]: <b>" + (report[0] ? report[0].dataLen : 0) + "</b><br>Row-key attr found: <b>" + (keyFound ? "yes" : "no") + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on the Data Model LIST page. Scroll a few rows into view first.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v18-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v18 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
