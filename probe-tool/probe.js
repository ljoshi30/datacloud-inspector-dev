/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v19 — HOW the custom datatable renders rows (no <tr> assumption)
 *
 * v18 found 0 <tr> under runtime_cdp-custom-datatable though .data[] has 50 rows → the
 * component renders rows as something OTHER than <tr> (divs, role=row, etc). And visible
 * text is ambiguous (many rows show the same truncated "AA_Google_Ads_85UD…"), so we must
 * find a per-row element that carries the REAL key — a key attribute (data-row-key-value /
 * data-*), or a full-value `title`, or a position we can map to .data[] by index.
 *
 * This probe dumps the datatable's actual rendered structure: every descendant that has
 * a role, a title, OR any data-* / key-ish/id-ish attribute — reporting tag, role, those
 * attrs, title, and short text. From that we pick the truncation-proof anchor. Also
 * reports the first-level child tags of the datatable so we see the grid container.
 *
 * RUN on the Data Model LIST page (scroll a few rows into view). Read-only. Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe19() {
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
  function roleOf(el) { try { return el.getAttribute("role") || ""; } catch (e) { return ""; } }
  function allAttrs(el) { var o = {}; try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = String(a.value).slice(0, 160); } } catch (e) {} return o; }
  function hasInterestingAttr(el) {
    try { for (var i = 0; i < el.attributes.length; i++) { var n = el.attributes[i].name; if (/^(title|role|data-|aria-rowindex|aria-colindex)/.test(n) || /row|key|record|__dlm|dmo/i.test(n + "=" + el.attributes[i].value)) return true; } } catch (e) {}
    return false;
  }

  var ALL = deepAll(document, []);
  var dt = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-custom-datatable"; })[0] || null;

  var result = { found: !!dt };
  if (dt) {
    // model
    var data = null; try { data = dt.data; } catch (e) {}
    result.keyField = (function () { try { return dt.keyField; } catch (e) { return null; } })();
    result.dataLen = data ? data.length : 0;
    result.dataSample = (data || []).slice(0, 3).map(function (r) { return { name: r && r.name, label: r && r.label }; });

    // first-level children (light + shadow) so we see the grid container tag
    var kids = [];
    try { (dt.shadowRoot || dt).childNodes.forEach(function (n) { if (n.nodeType === 1) kids.push(tagOf(n)); }); } catch (e) {}
    result.firstLevelChildTags = kids;

    // every descendant with role/title/data-* / key-ish attr → the structure
    var desc = deepAll(dt, []);
    result.descendantCount = desc.length;
    var picked = [];
    for (var i = 0; i < desc.length && picked.length < 70; i++) {
      var el = desc[i];
      if (!hasInterestingAttr(el)) continue;
      var t = txt(el);
      picked.push({
        tag: tagOf(el),
        role: roleOf(el),
        title: (function () { try { return (el.getAttribute("title") || "").slice(0, 160); } catch (e) { return ""; } })(),
        text: t.length > 70 ? t.slice(0, 70) + "…" : t,
        attrs: allAttrs(el)
      });
    }
    result.interestingElements = picked;

    // tally of roles + tags among descendants (so we see what "rows" are called)
    var roleTally = {}, tagTally = {};
    desc.forEach(function (el) { var r = roleOf(el); if (r) roleTally[r] = (roleTally[r] || 0) + 1; var g = tagOf(el); if (g.indexOf("-") >= 0 || g === "tr" || g === "div") { } tagTally[g] = (tagTally[g] || 0) + 1; });
    result.roleTally = roleTally;
    result.tagTally = Object.keys(tagTally).sort(function (a, b) { return tagTally[b] - tagTally[a]; }).slice(0, 20).reduce(function (o, k) { o[k] = tagTally[k]; return o; }, {});
  }

  var out = { _tool: "dom-probe", _version: 19, page: location.href, origin: location.origin, datatable: result };
  var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"' + String(e) + '"}'; }
  try { window.__DOM_PROBE = out; } catch (e) {}

  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); });
    else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); cb(ok); } catch (e) { cb(false); } }
  }
  var kb = Math.round(json.length / 1024);
  var roleRows = result.roleTally && (result.roleTally.row || result.roleTally.gridcell) ? "yes" : "no";
  var panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:340px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v19 · row structure</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>✓ Copied (" + kb + " KB)</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.7'>Datatable found: <b>" + (result.found ? "yes" : "no") + "</b><br>.data[]: <b>" + (result.dataLen || 0) + "</b> · interesting els: <b>" + ((result.interestingElements || []).length) + "</b><br>role=row/gridcell present: <b>" + roleRows + "</b></div>"
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
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v19-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v19 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
