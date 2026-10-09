/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v22 — DataStream (and id-routed lists): where is the 18-char record id?
 *
 * A Data Stream opens at /lightning/r/DataStream/<18charId>/view — by RECORD ID, not by
 * name/api. But the list rows' data-row-key-value were __dlm api names (not ids), so that
 * key can't build the /r/ URL. This probe hunts the real 15/18-char SF id for each row:
 *   - the <tr> attrs (data-row-key-value / data-recordid / any id-looking attr)
 *   - any <a href> inside the row that contains /DataStream/<id> or an 18-char id
 *   - the datatable .data[] rows: dump id-ish fields (id/Id/recordId/dataStreamId/…)
 *   - the first .data[] row FULL (so we see every field name available)
 * From that we learn which field/attr carries the id → build /r/DataStream/<id>/view with
 * NO guessing. Also re-reports keyField + page url to catch stale-table mismatches.
 *
 * RUN on the Data Streams LIST page (hard-refresh first so no stale DMO table lingers).
 * Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe22() {
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
  function attrsOf(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 200); } } catch (e) {} return o; }
  function isInside(el, host) { var n = el, h = 0; while (n && h < 60) { if (n === host) return true; var p = n.parentElement; if (!p) { try { var rn = n.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } } n = p; h++; } return false; }
  var ID_RE = /\b[a-zA-Z0-9]{18}\b|\b[a-zA-Z0-9]{15}\b/;
  function idsIn(s) { var out = []; if (typeof s !== "string") return out; var re = /\b[a-zA-Z0-9]{18}\b|\b[a-zA-Z0-9]{15}\b/g, m; while ((m = re.exec(s))) { if (/[0-9]/.test(m[0]) && /[a-zA-Z]/.test(m[0])) out.push(m[0]); } return out; }
  function sketch(v, d) { d = d || 0; if (v == null) return v; var t = typeof v; if (t === "function") return "ƒ"; if (t !== "object") return (t === "string" && v.length > 160) ? v.slice(0, 160) + "…" : v; if (d >= 3) return Array.isArray(v) ? "array[" + v.length + "]" : "obj"; if (Array.isArray(v)) return v.slice(0, 6).map(function (x) { return sketch(x, d + 1); }); var o = {}, k; try { k = Object.keys(v); } catch (e) { return "obj?"; } k.slice(0, 40).forEach(function (key) { try { o[key] = sketch(v[key], d + 1); } catch (e) {} }); return o; }

  var ALL = deepAll(document, []);
  var dt = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-custom-datatable"; })[0] || null;

  var result = { found: !!dt, page: location.href };
  if (dt) {
    var data = null; try { data = dt.data; } catch (e) {}
    try { result.keyField = dt.keyField; } catch (e) {}
    result.dataLen = data ? data.length : 0;
    // FULL first row so we can see every field (one of them is the record id)
    result.firstRowFull = data && data[0] ? sketch(data[0], 0) : null;
    // id-ish fields across first few rows
    result.idFields = (data || []).slice(0, 3).map(function (r) {
      var o = {};
      try { Object.keys(r).forEach(function (k) { if (/^(id|recordid|.*id)$/i.test(k) || /id$/i.test(k)) { var v = r[k]; if (typeof v === "string" && ID_RE.test(v)) o[k] = v; } }); } catch (e) {}
      // also any string value that looks like an 18-char id, regardless of field name
      try { Object.keys(r).forEach(function (k) { var v = r[k]; if (typeof v === "string" && idsIn(v).length && !o[k]) o[k] = v; }); } catch (e) {}
      return o;
    });

    // rendered rows: tr key + any href containing an id + any id-looking attr anywhere in the row
    var inside = ALL.filter(function (el) { return el !== dt && isInside(el, dt); });
    var rows = inside.filter(function (el) { return tagOf(el) === "tr" || roleOf(el) === "row"; });
    result.rowSamples = rows.slice(0, 4).map(function (tr) {
      var key = ""; try { key = tr.getAttribute("data-row-key-value") || ""; } catch (e) {}
      var hrefs = [], idAttrs = {};
      try { var as = tr.querySelectorAll("a[href]"); for (var i = 0; i < as.length && i < 5; i++) { var hv = as[i].getAttribute("href") || ""; hrefs.push(hv); } } catch (e) {}
      // scan every element in the row for an id-looking attribute value
      try {
        deepAll(tr, []).slice(0, 60).forEach(function (el) {
          for (var j = 0; j < el.attributes.length; j++) { var a = el.attributes[j]; if (idsIn(a.value).length) idAttrs[tagOf(el) + "[" + a.name + "]"] = a.value.slice(0, 60); }
        });
      } catch (e) {}
      return { key: key, hrefs: hrefs, idAttrsInRow: idAttrs };
    });
  }

  var out = { _tool: "dom-probe", _version: 22, origin: location.origin, datastream: result };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var idFound = (result.idFields || []).some(function (o) { return Object.keys(o).length; }) || (result.rowSamples || []).some(function (r) { return Object.keys(r.idAttrsInRow).length || r.hrefs.some(function (h) { return /[a-zA-Z0-9]{15,18}/.test(h); }); });
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v22 · record id</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Datatable: <b>" + (result.found ? "yes" : "no") + "</b> · rows: <b>" + (result.dataLen || 0) + "</b><br>18-char id found: <b>" + (idFound ? "yes" : "no") + "</b><br>keyField: <b>" + (result.keyField || "?") + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Hard-refresh the Data Streams LIST first (clear stale tables), then run.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v22-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v22 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
