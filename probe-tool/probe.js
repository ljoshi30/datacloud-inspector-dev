/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v15 — DMO LIST ROW: hunt the hidden record id / API name
 *
 * v14 proved the Data Model list rows are old-style AURA rows whose link is
 * href="javascript:void(0)" + a title = display name only — no id, no apiName in
 * plain DOM. BUT Aura/LWC often stash the real record id (or objectApiName) on a
 * JS property or an event-handler payload. This probe digs into ONE representative
 * row deeply and reports anything that looks like an id/apiName/url, so we can
 * decide if a real "open in new tab" link is buildable (no guessing).
 *
 * For the first ~3 data rows (a.text-wrapper[title] inside a <tr>) it captures:
 *  - the anchor + its ancestors up to <tr>: tag, ALL attributes, and ALL JS props
 *    (own + prototype getters) whose NAME or VALUE looks id/apiName/url/record-ish
 *  - any 15/18-char Salesforce id or *__dlm/__dll/__c token found ANYWHERE in the
 *    row's attributes or string props (the gold — a real identifier)
 *  - the Aura "rendered-by" global id so we can see the component wiring
 *  - a short dump of the anchor's own enumerable props + onclick presence
 *
 * RUN on the Data Model (or Data Lake Objects) LIST page. Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe15() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  function deepAll(root, acc) {
    acc = acc || [];
    if (acc.length > 150000) return acc;
    var all; try { all = root.querySelectorAll("*"); } catch (e) { return acc; }
    for (var i = 0; i < all.length; i++) { var el = all[i]; acc.push(el); if (el.shadowRoot) deepAll(el.shadowRoot, acc); }
    return acc;
  }
  function tagOf(el) { try { return (el.tagName || "").toLowerCase(); } catch (e) { return ""; } }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function attrsOf(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 240); } } catch (e) {} return o; }
  var SFID = /\b[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?\b/g;        // 15/18-char SF id
  var APITOKEN = /\b[A-Za-z0-9_]+__(?:dlm|dll|c|dlr|cio)\b/g;  // DMO/DLO/CI api names
  function sketch(v, d, maxD) {
    d = d || 0; maxD = maxD || 4;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return "ƒ";
    if (t !== "object") return (t === "string" && v.length > 240) ? v.slice(0, 240) + "…" : v;
    if (d >= maxD) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 8).map(function (x) { return sketch(x, d + 1, maxD); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 50).forEach(function (k) { try { var s = sketch(v[k], d + 1, maxD); if (s !== undefined) out[k] = s; } catch (e) {} });
    return out;
  }
  // every own + prototype-getter prop name
  function propNames(el) {
    var names = {};
    try { Object.keys(el).forEach(function (k) { names[k] = 1; }); } catch (e) {}
    var proto = Object.getPrototypeOf(el), hops = 0;
    while (proto && hops < 12) {
      var dsc; try { dsc = Object.getOwnPropertyDescriptors(proto); } catch (e) { dsc = null; }
      if (dsc) Object.keys(dsc).forEach(function (k) { if (k === "constructor") return; var d = dsc[k]; if (d && (typeof d.get === "function" || "value" in d)) names[k] = 1; });
      proto = Object.getPrototypeOf(proto); hops++;
    }
    return Object.keys(names);
  }
  // props whose NAME is id/apiName/url/record-ish, sketched (incl. functions as "ƒ" so we
  // can SEE a navigate/onclick handler exists even if we can't read its closure)
  function interestingProps(el) {
    var out = {};
    propNames(el).forEach(function (k) {
      if (!/id$|recordid|rowid|apiname|objectapi|developername|devname|url|href|navig|pageref|record|rowkey|key$|value$|entity|datasetid|target/i.test(k)) return;
      if (/^(tabIndex|validity|valueAsNumber|valueAsDate|nodeValue)$/.test(k)) return;
      var v; try { v = el[k]; } catch (e) { return; }
      if (v === undefined) return;
      out[k] = sketch(v, 0, 4);
    });
    return out;
  }
  // scan ALL string props + attrs of an element for an SF id or api token
  function harvestIds(el) {
    var found = { ids: {}, apiTokens: {} };
    function scanStr(s) {
      if (typeof s !== "string" || !s) return;
      var m; SFID.lastIndex = 0; while ((m = SFID.exec(s))) { if (/^[a-zA-Z]/.test(m[0]) || /\d/.test(m[0])) found.ids[m[0]] = 1; }
      APITOKEN.lastIndex = 0; while ((m = APITOKEN.exec(s))) found.apiTokens[m[0]] = 1;
    }
    try { for (var i = 0; i < el.attributes.length; i++) scanStr(el.attributes[i].value); } catch (e) {}
    propNames(el).forEach(function (k) { var v; try { v = el[k]; } catch (e) { return; } if (typeof v === "string") scanStr(v); else if (v && typeof v === "object") { try { scanStr(JSON.stringify(v).slice(0, 4000)); } catch (e) {} } });
    return { ids: Object.keys(found.ids).slice(0, 20), apiTokens: Object.keys(found.apiTokens).slice(0, 20) };
  }

  var ALL = deepAll(document, []);
  // representative data-row anchors: a.text-wrapper[title] (from v14) OR any <a> inside a <tr>
  var anchors = [];
  ALL.forEach(function (el) {
    if (tagOf(el) !== "a") return;
    var title = ""; try { title = el.getAttribute("title") || ""; } catch (e) {}
    var cls = ""; try { cls = el.getAttribute("class") || ""; } catch (e) {}
    // skip header toggle links ("Sort…")
    if (/toggle|slds-th__action/.test(cls)) return;
    if (!title && !/text-wrapper/.test(cls)) return;
    anchors.push(el);
  });

  var samples = [];
  anchors.slice(0, 3).forEach(function (a) {
    // climb to <tr>, capturing each ancestor's interesting props/attrs
    var chain = [], node = a;
    for (var h = 0; h < 10 && node; h++) {
      var tg = tagOf(node);
      chain.push({
        tag: tg,
        attrs: attrsOf(node),
        interestingProps: interestingProps(node),
        harvest: harvestIds(node),
        hasOnclick: (function () { try { return typeof node.onclick === "function"; } catch (e) { return false; } })()
      });
      if (tg === "tr") break;
      var p = node.parentElement; if (!p) { try { var rn = node.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } }
      node = p;
    }
    // also harvest ids/api tokens across the WHOLE <tr> subtree (deep), in case the id sits
    // on a sibling cell / hidden element
    var trIds = { ids: {}, apiTokens: {} };
    if (node && tagOf(node) === "tr") {
      deepAll(node, []).slice(0, 400).forEach(function (d) {
        var h = harvestIds(d);
        h.ids.forEach(function (x) { trIds.ids[x] = 1; });
        h.apiTokens.forEach(function (x) { trIds.apiTokens[x] = 1; });
      });
    }
    samples.push({
      label: (function () { try { return a.getAttribute("title") || txt(a); } catch (e) { return txt(a); } })().slice(0, 80),
      anchorOwnEnumerable: (function () { try { var o = {}; Object.keys(a).slice(0, 40).forEach(function (k) { o[k] = sketch(a[k], 0, 2); }); return o; } catch (e) { return {}; } })(),
      ancestorChain: chain,
      wholeRowIds: Object.keys(trIds.ids).slice(0, 25),
      wholeRowApiTokens: Object.keys(trIds.apiTokens).slice(0, 25)
    });
  });

  // Does the page expose any Aura action/global that lists rows with ids? (best-effort,
  // read-only): look for a data-table component with a .state/.rows/.data holding records.
  var tableGuess = [];
  ALL.forEach(function (el) {
    if (tableGuess.length >= 4) return;
    var tg = tagOf(el);
    if (!/datatable|data-table|listview|list-view|lst-/.test(tg)) return;
    var picked = {};
    ["data", "rows", "records", "state", "keyField", "columns"].forEach(function (k) { try { if (el[k] != null) picked[k] = sketch(el[k], 0, 3); } catch (e) {} });
    if (Object.keys(picked).length) tableGuess.push({ tag: tg, props: picked });
  });

  var out = {
    _tool: "dom-probe", _version: 15, page: location.href, origin: location.origin,
    anchorsFound: anchors.length,
    samples: samples,
    tableComponents: tableGuess
  };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var idHits = samples.reduce(function (n, s) { return n + s.wholeRowIds.length; }, 0);
  var apiHits = samples.reduce(function (n, s) { return n + s.wholeRowApiTokens.length; }, 0);
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v15 · DMO row id hunt</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Row anchors: <b>" + anchors.length + "</b><br>Ids found in rows: <b>" + idHits + "</b> · API tokens: <b>" + apiHits + "</b></div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on the Data Model LIST page. If 'Ids found' &gt; 0, a real new-tab link is buildable.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v15-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v15 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
