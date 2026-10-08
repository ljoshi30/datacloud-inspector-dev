/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v21 — UNIVERSAL Data Cloud LIST probe (any list → row key + URL scheme)
 *
 * We're generalizing "open in new tab" (today DMO-only) to every DC list: DLO, CI,
 * Segments, Data Streams, Activations, etc. Each list is the SAME component
 * (runtime_cdp-custom-datatable) with <tr role=row data-row-key-value="<key>">, but the
 * KEY differs per list and the DETAIL URL differs per list. This probe captures, for the
 * list on the CURRENT page (whatever it is), everything needed to wire it WITHOUT guessing:
 *   - page URL + origin (so we see the list route, e.g. standard-DataModel / .../o/DataStream/home)
 *   - each datatable's keyField + a few .data[] samples (name/id/label/developerName/...)
 *   - sample rendered <tr data-row-key-value=...> values (the real per-row key)
 *   - any <a href> inside the first data row (sometimes the detail URL is right there!)
 *   - all row attrs (data-row-number etc.)
 * Then: OPEN ONE ROW normally (so its detail URL shows in the address bar) and tell me that
 * URL — that pins the per-list URL template. Read-only. Copies JSON.
 *
 * RUN on ANY Data Cloud list page (DLO, CI, Segments, Data Streams, …). Scroll a row in.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe21() {
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
  function isInside(el, host) { var n = el, h = 0; while (n && h < 60) { if (n === host) return true; var p = n.parentElement; if (!p) { try { var rn = n.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } } n = p; h++; } return false; }
  function pick(o, keys) { var r = {}; keys.forEach(function (k) { try { if (o && o[k] != null && typeof o[k] !== "function" && typeof o[k] !== "object") r[k] = String(o[k]).slice(0, 120); } catch (e) {} }); return r; }

  var ALL = deepAll(document, []);
  var dts = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-custom-datatable"; });

  var tables = dts.slice(0, 3).map(function (dt) {
    var data = null; try { data = dt.data; } catch (e) {}
    var keyField = null; try { keyField = dt.keyField; } catch (e) {}
    var dataSample = (data || []).slice(0, 3).map(function (r) {
      // common identity/label fields across DC lists
      var base = pick(r, ["name", "id", "Id", "developerName", "DeveloperName", "apiName", "label", "Label", "type", "category", "status"]);
      if (r && r.objectLabel) base["objectLabel.label"] = (r.objectLabel.label || "");
      return base;
    });
    // rendered rows + the first data row's <a href> (detail link may be present)
    var inside = ALL.filter(function (el) { return el !== dt && isInside(el, dt); });
    var rows = inside.filter(function (el) { return (tagOf(el) === "tr" || roleOf(el) === "row"); });
    var rowSamples = rows.slice(0, 4).map(function (tr) {
      var key = ""; try { key = tr.getAttribute("data-row-key-value") || ""; } catch (e) {}
      var links = [];
      try { var as = tr.querySelectorAll("a[href]"); for (var i = 0; i < as.length && i < 4; i++) { links.push({ href: as[i].getAttribute("href") || "", abs: as[i].href || "", text: (as[i].textContent || "").trim().slice(0, 40) }); } } catch (e) {}
      return { key: key, rowAttrs: attrsOf(tr), links: links };
    });
    return { keyField: keyField, dataLen: data ? data.length : 0, dataSample: dataSample, renderedRows: rows.length, rowSamples: rowSamples };
  });

  var out = {
    _tool: "dom-probe", _version: 21, page: location.href, origin: location.origin,
    hint: "Open ONE row normally and copy its address-bar URL — that pins the per-list detail URL template.",
    datatables: dts.length, tables: tables
  };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var kf = tables[0] ? (tables[0].keyField || "?") : "?";
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v21 · any list</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Datatables: <b>" + dts.length + "</b> · keyField: <b>" + kf + "</b><br>Rendered rows: <b>" + (tables[0] ? tables[0].renderedRows : 0) + "</b><br><i>Then open one row &amp; copy its URL.</i></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on ANY Data Cloud list (DLO / CI / Segments / Data Streams). Tell me the list name + one row's opened URL.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v21-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v21 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
