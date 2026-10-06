/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v6 — Activation Summary panel internals ("Attributes Included")
 *
 * We already have runtime_cdp-activation-summary.includedAttributes[] = ordered
 * {uid,label,attributeName,entityName}. To show API names on each line of the
 * "Attributes Included (N)" list WITHOUT guessing, we need its INTERNAL DOM: what
 * element each line is, whether a line carries an index/uid/data-* we can map to
 * includedAttributes[i], and the visible text per line. v6 dumps exactly that.
 *
 * Read-only. Copies JSON to clipboard; also window.__DOM_PROBE.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe6() {
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
  function ownText(el) {
    var s = "";
    try { for (var i = 0; i < el.childNodes.length; i++) { var c = el.childNodes[i]; if (c.nodeType === 3) { var t = (c.nodeValue || "").trim(); if (t) s += t + " "; } } } catch (e) {}
    return s.trim();
  }
  function fullText(el) { try { return (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80); } catch (e) { return ""; } }
  function attrsOf(el) {
    var o = {};
    try { for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; o[a.name] = (a.value || "").slice(0, 40); } } catch (e) {}
    return o;
  }
  function safeGet(o, k) { try { return o[k]; } catch (e) { return undefined; } }

  var ALL = deepAll(document, []);
  var summary = ALL.filter(function (el) { return tagOf(el) === "runtime_cdp-activation-summary"; })[0];

  var out = { _tool: "dom-probe", _version: 6, page: location.href };
  if (!summary) {
    out.error = "runtime_cdp-activation-summary not found — scroll so the 'Attributes Included' panel is visible, then re-run.";
  } else {
    // the ordered data model we want to map lines onto
    var inc = safeGet(summary, "includedAttributes") || [];
    out.includedAttributes = inc.slice(0, 60).map(function (a) { return { uid: a && a.uid, label: a && a.label, attributeName: a && a.attributeName, entityName: a && a.entityName }; });

    // dump the summary's shadow tree, but ONLY leaf-ish nodes that show text (the lines),
    // with their tag, attrs, own-text, and a hint whether an ancestor has a uid/index attr.
    var lines = [];
    (function walk(root, depth) {
      if (depth > 10) return;
      var kids; try { kids = root.children; } catch (e) { return; }
      for (var i = 0; i < (kids ? kids.length : 0); i++) {
        var el = kids[i];
        var ot = ownText(el);
        var at = attrsOf(el);
        var interesting = ot || Object.keys(at).some(function (k) { return /uid|index|key|data-|id$/i.test(k); });
        if (interesting && lines.length < 80) {
          lines.push({ tag: tagOf(el), ownText: ot.slice(0, 60), text: fullText(el), attrs: at, childCount: (el.children ? el.children.length : 0) });
        }
        if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
        walk(el, depth + 1);
      }
    })(summary.shadowRoot || summary, 0);
    out.summaryLineNodes = lines;
    out.summaryAttrs = attrsOf(summary);
  }

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
    + "<b style='font:700 13px system-ui'>DOM Probe v6</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:" + (summary ? "#059669" : "#b45309") + ";margin-bottom:8px'>" + (summary ? ("✓ Copied (" + kb + " KB) — summary found") : "⚠ Summary panel not found") + "</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.5'>" + (summary ? ((out.includedAttributes ? out.includedAttributes.length : 0) + " included attrs, " + ((out.summaryLineNodes || []).length) + " line nodes") : "Scroll so 'Attributes Included' is visible, then re-run.") + "</div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok && summary) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v6-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v6 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
