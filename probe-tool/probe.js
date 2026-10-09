/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v24 — classify a Data Cloud LIST: "already works" vs "needs a rule"
 *
 * Finding so far: standard Lightning list views (force-list-view-manager / lst-*) render
 * each row as a REAL <a href="/lightning/r/<id>/view"> → right-click new-tab already works
 * (Data Streams). Only the CUSTOM component runtime_cdp-custom-datatable renders rows as
 * javascript:void(0) → broken (DMO). This probe runs on whatever list you're on and gives
 * a one-line VERDICT so we instantly know if it needs wiring:
 *   verdict = "ALREADY_WORKS"  → rows are real /r/ links (standard list) — no fix needed
 *            = "NEEDS_RULE"    → custom datatable w/ void(0) rows — report key + sample so
 *                                we add a DC_LIST_TYPES entry (after you open one row → URL)
 *            = "UNKNOWN"       → neither pattern clearly detected (dump clues)
 * Also captures: datatable keyField + sample data-row-key-value, sample /r/ detail links,
 * grid component tags, and the page url. Read-only. Copies JSON.
 *
 * RUN on each list to check (Calculated Insights, Segments, Data Lake Objects). Hard-refresh
 * first so no stale table from a previous page lingers.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe24() {
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
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { return ""; } }
  function isInside(el, host) { var n = el, h = 0; while (n && h < 60) { if (n === host) return true; var p = n.parentElement; if (!p) { try { var rn = n.getRootNode(); p = rn && rn.host ? rn.host : null; } catch (e) { p = null; } } n = p; h++; } return false; }

  var ALL = deepAll(document, []);

  // custom DC datatable?
  var dts = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-custom-datatable"; });
  var customInfo = null;
  if (dts.length) {
    var dt = dts[0];
    var data = null; try { data = dt.data; } catch (e) {}
    var kf = null; try { kf = dt.keyField; } catch (e) {}
    // sample data-row-key-value off rendered rows inside this datatable (shadow-crossing)
    var inside = ALL.filter(function (el) { return el !== dt && isInside(el, dt); });
    var keys = [];
    inside.forEach(function (el) { if (keys.length >= 5) return; if (tagOf(el) === "tr") { var k = ""; try { k = el.getAttribute("data-row-key-value") || ""; } catch (e) {} if (k && k !== "HEADER") keys.push(k); } });
    // do the custom rows have ONLY void(0) links (broken) or real /r/ links?
    var voidLinks = 0, realLinks = 0;
    inside.forEach(function (el) { if (tagOf(el) !== "a") return; var hv = ""; try { hv = el.getAttribute("href") || ""; } catch (e) {} if (/^javascript:/.test(hv)) voidLinks++; else if (/\/lightning\/r\//.test(hv) || /\/view$/.test(hv)) realLinks++; });
    customInfo = { keyField: kf, dataLen: data ? data.length : 0, sampleKeys: keys, voidLinks: voidLinks, realLinks: realLinks };
  }

  // standard list: real /r/<id>/view anchors in the main content
  var detailLinks = [];
  ALL.forEach(function (el) {
    if (detailLinks.length >= 6) return;
    if (tagOf(el) !== "a") return;
    var hv = ""; try { hv = el.getAttribute("href") || ""; } catch (e) {}
    if (/\/lightning\/r\/[a-zA-Z0-9]{15,18}\/view/.test(hv) || /\/lightning\/r\/[A-Za-z_]+\/[a-zA-Z0-9]{15,18}\//.test(hv)) {
      var rid = ""; try { rid = el.getAttribute("data-recordid") || ""; } catch (e) {}
      detailLinks.push({ href: hv, recordId: rid, text: txt(el).slice(0, 50) });
    }
  });

  // grid component tags (so we see which component this list uses)
  var gridTags = {};
  ALL.forEach(function (el) { var t = tagOf(el); if (t.indexOf("-") >= 0 && /(datatable|list-view|listview|grid|data-table)/.test(t)) gridTags[t] = (gridTags[t] || 0) + 1; });

  // VERDICT
  var verdict = "UNKNOWN", why = "";
  if (detailLinks.length > 0 && (!customInfo || customInfo.realLinks > 0 || customInfo.voidLinks === 0)) {
    verdict = "ALREADY_WORKS"; why = "rows render as real /lightning/r/<id>/view links (standard list) — right-click new-tab works";
  } else if (customInfo && customInfo.voidLinks > 0 && detailLinks.length === 0) {
    verdict = "NEEDS_RULE"; why = "custom runtime_cdp-custom-datatable with javascript:void(0) rows; per-row key via data-row-key-value (keyField=" + (customInfo.keyField || "?") + ")";
  } else if (customInfo) {
    verdict = "NEEDS_RULE"; why = "custom datatable present; confirm key + open one row for the detail URL";
  }

  var out = {
    _tool: "dom-probe", _version: 24, page: location.href, origin: location.origin,
    verdict: verdict, why: why,
    nextStep: verdict === "NEEDS_RULE" ? "Open ONE row normally and paste its address-bar URL so I can pin the detail URL template." : "Nothing to wire — this list already supports open-in-new-tab.",
    customDatatable: customInfo,
    standardDetailLinks: detailLinks,
    gridTags: gridTags
  };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var vColor = verdict === "ALREADY_WORKS" ? "#059669" : verdict === "NEEDS_RULE" ? "#b45309" : "#64748b";
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:350px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v24 · verdict</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font:800 15px system-ui;color:" + vColor + ";margin-bottom:4px'>" + verdict + "</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.5'>" + why + "</div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>Run on each list (CI / Segments / DLO). If NEEDS_RULE, open one row &amp; send me its URL.</div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v24-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v24 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
