/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v33 — DATA GRAPH builder: where are the API names?
 *
 * Goal: add API-name hints on the Data Graph builder like we do on Segment/Activation —
 *   • LEFT panel: each Data Model Object / CI node (its OBJECT api name)
 *   • RIGHT panel: each field row (its FIELD api name + the owning object)
 *   • FILTERS tab: each filtered field's api name
 * The right way (no guessing) is to read the api name off the LWC element's JS PROPERTY,
 * exactly like segApi* does. This probe finds those property paths.
 *
 * HOW TO USE (read-only, copies JSON):
 *   1. Open a Data Graph → its builder (the Fields view in your screenshot).
 *   2. Click a LEFT object node (e.g. "Individual") so its fields show on the right.
 *   3. HOVER a field row on the right, then click this probe.  It dumps:
 *      - the hovered field row element: tag + any JS prop holding a fieldApiName/objectApiName/
 *        developerName/apiName (deep-scanned), and its text.
 *      - the LEFT node elements: tag + object-api-looking props.
 *      - the custom-element tag names present (so we know the component to hook, e.g.
 *        runtime_cdp-data-graph-*).
 *   Paste the JSON back.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe33() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var TRACK = "__dcProbeHover";
  // FIRST click installs a hover tracker + tells you to hover the field then click again.
  // SECOND click dumps the element you last hovered (plus the generic scan). This lets you
  // target the EXACT field row / left node / filter chip.
  if (!window[TRACK]) {
    window[TRACK] = { el: null };
    document.addEventListener("mouseover", function (e) { window[TRACK].el = e.target; }, true);
    var hint = document.createElement("div");
    hint.id = PANEL_ID;
    hint.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:12px/1.5 -apple-system,sans-serif;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.6);";
    hint.innerHTML = "<b>DOM Probe armed.</b><br>Now <b>hover the exact thing</b> you want me to read &mdash; a field row on the right, a DMO/CI node on the left, or a filter field &mdash; then <b>click the DOM Probe bookmark again</b> to capture it.";
    document.body.appendChild(hint);
    setTimeout(function () { try { hint.remove(); } catch (e) {} }, 6000);
    return;
  }

  var out = { href: location.href, hovered: null, leftNodes: [], customTags: [], notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 16) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function attr(el, a) { try { return el.getAttribute(a) || ""; } catch (e) { return ""; } }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50); } catch (e) { return ""; } }

  // deep-scan an element's JS properties for api-name-looking string values
  var API_KEYS = /^(fieldApiName|objectApiName|developerName|apiName|fieldName|entityName|qualifiedApiName|fullApiName|objectName|dmoApiName|name)$/i;
  function scanApiProps(el, label) {
    var hits = [], seen = [];
    function walk(o, path, depth) {
      if (!o || depth > 6 || hits.length > 30) return;
      if (typeof o === "object") { if (seen.indexOf(o) >= 0) return; if (seen.length < 600) seen.push(o); else return; }
      for (var k in o) {
        if (hits.length > 30) break;
        var v; try { v = o[k]; } catch (e) { continue; }
        if (v == null) continue;
        var t = typeof v;
        if (t === "string") {
          if (API_KEYS.test(k) && /^[A-Za-z0-9_]+(__[a-z]+)?$/.test(v) && v.length > 1 && v.length < 80) hits.push({ path: (path + "." + k).slice(0, 90), value: v });
        } else if (t === "object") {
          if (v.nodeType || v === window || k === "parentNode" || k === "ownerDocument" || k === "__proto__" || k === "host") continue;
          walk(v, path + "." + k, depth + 1);
        }
      }
    }
    try { walk(el, label, 0); } catch (e) {}
    return hits;
  }

  // 0) THE CAPTURED HOVER (what you pointed at). Climb up to ~10 ancestors (crossing shadow),
  //    scanning JS props for api names at each level — the api name usually lives a couple of
  //    levels up from the text span (on the row component). Report the first level that has them.
  try {
    var hv = window[TRACK] && window[TRACK].el;
    if (hv) {
      var chain = [], n = hv, g = 0, firstHit = null;
      while (n && g++ < 10 && n.nodeType === 1) {
        var props = scanApiProps(n, "el");
        var entry = { level: g - 1, tag: (n.tagName || "").toLowerCase(), cls: attr(n, "class").slice(0, 60), text: txt(n), apiProps: props };
        chain.push(entry);
        if (!firstHit && props.length) firstHit = entry;
        var pe = n.parentElement; if (!pe) { var rt = null; try { rt = n.getRootNode && n.getRootNode(); } catch (e) {} pe = rt && rt.host ? rt.host : null; }
        n = pe;
      }
      out.hovered = { firstApiHit: firstHit, chain: chain };
    } else { out.hovered = "(no hovered element — hover something, then click the probe again)"; }
  } catch (e) { out.hovered = "ERR:" + e; }

  // 1) also capture a few field-row-looking elements generically (fallback context).
  var fieldRows = [];
  eachEl(document, 0, function (el) {
    var tg = (el.tagName || "").toLowerCase();
    var role = attr(el, "role");
    var cls = attr(el, "class");
    // a field row: a grid row / tr / li inside the right Fields table, with some text
    if ((role === "row" || tg === "tr" || /field-row|datatable-row|slds-hint-parent/i.test(cls)) && txt(el)) {
      fieldRows.push(el);
    }
  });
  out.notes.push("candidate field rows found: " + fieldRows.length);
  out.fieldRowSamples = fieldRows.slice(0, 6).map(function (el) {
    return { tag: (el.tagName || "").toLowerCase(), text: txt(el), apiProps: scanApiProps(el, "row") };
  });

  // 2) left-panel object nodes (the DMO/CI tree). Look for tree items / rows in the left region.
  eachEl(document, 0, function (el) {
    var role = attr(el, "role"), cls = attr(el, "class"), tg = (el.tagName || "").toLowerCase();
    if ((role === "treeitem" || /tree.*item|dmo-node|object-node|data-model-object/i.test(cls + " " + tg)) && txt(el)) {
      out.leftNodes.push({ tag: tg, text: txt(el), apiProps: scanApiProps(el, "node") });
    }
  });
  out.leftNodes = out.leftNodes.slice(0, 12);

  // 3) all custom element tag names (runtime_cdp-*, lightning-*) so we know the components present.
  var tags = {};
  eachEl(document, 0, function (el) { var tg = (el.tagName || "").toLowerCase(); if (/^(runtime_cdp|lightning|c|force)-/.test(tg)) tags[tg] = (tags[tg] || 0) + 1; });
  out.customTags = Object.keys(tags).filter(function (t) { return /graph|field|datatable|tree|attribute|object|filter/i.test(t); }).slice(0, 40);

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(720px,95vw);max-height:86vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v33 — Data Graph API names\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
