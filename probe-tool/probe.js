/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v9 — expand attributeLibraryMetadata.displayPaths (Container Path source)
 *
 * v8 proved SF's "Container Path" is reconstructed from attributeLibraryMetadata,
 * not stored on the condition. v9 dumps, for each RELATED group node in
 * attributeLibraryMetadata._nodeIndexByNodeId, the FULLY-EXPANDED path structures:
 *   paths / displayPaths / joinPaths  (earlier probes truncated these to "array[1]")
 * plus objectApiName/label/primaryKeyFieldApiName, so we can see how a hop encodes
 * {object label, fk field label} and rebuild the exact "A.fk > B.fk > C" string.
 *
 * RUN on the SEGMENT page (any state — the metadata is on the canvas-item/condition).
 * Read-only. Copies JSON to clipboard; also window.__DOM_PROBE.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe9() {
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
  function g(o, k) { try { return o[k]; } catch (e) { return undefined; } }
  // FULL sketch (deeper + wider than usual) so path arrays are not truncated
  function sketch(v, d, maxD) {
    d = d || 0; maxD = maxD || 8;
    if (v == null) return v;
    var t = typeof v;
    if (t === "function") return undefined;
    if (t !== "object") return (t === "string" && v.length > 300) ? v.slice(0, 300) + "…" : v;
    if (d >= maxD) return Array.isArray(v) ? ("array[" + v.length + "]") : "obj";
    if (Array.isArray(v)) return v.slice(0, 20).map(function (x) { return sketch(x, d + 1, maxD); });
    var out = {}, keys; try { keys = Object.keys(v); } catch (e) { return "obj?"; }
    keys.slice(0, 60).forEach(function (k) { try { var s = sketch(v[k], d + 1, maxD); if (s !== undefined) out[k] = s; } catch (e) {} });
    return out;
  }

  // find the first element exposing attributeLibraryMetadata
  var ALL = deepAll(document, []);
  var meta = null, metaTag = "";
  for (var i = 0; i < ALL.length; i++) {
    var m = g(ALL[i], "attributeLibraryMetadata");
    if (m && typeof m === "object" && g(m, "_nodeIndexByNodeId")) { meta = m; metaTag = tagOf(ALL[i]); break; }
  }

  var out = { _tool: "dom-probe", _version: 9, page: location.href, foundOn: metaTag };
  if (!meta) {
    out.error = "attributeLibraryMetadata not found — open the segment builder (not the list), then re-run.";
  } else {
    var idx = g(meta, "_nodeIndexByNodeId") || {};
    var relatedNodes = [];
    Object.keys(idx).forEach(function (id) {
      var n = idx[id];
      if (!n || typeof n !== "object") return;
      // related CONTAINER nodes carry paths/displayPaths; attribute leaves don't
      var hasPaths = g(n, "paths") || g(n, "displayPaths") || g(n, "joinPaths");
      if (!hasPaths) return;
      relatedNodes.push({
        id: id,
        objectApiName: g(n, "objectApiName"),
        label: g(n, "label"),
        fullLabel: g(n, "fullLabel"),
        primaryKeyFieldApiName: g(n, "primaryKeyFieldApiName"),
        dataEntityCategoryId: g(n, "dataEntityCategoryId"),
        parentId: g(n, "parentId"),
        // THE important bit — fully expanded:
        paths: sketch(g(n, "paths"), 0, 9),
        displayPaths: sketch(g(n, "displayPaths"), 0, 9),
        joinPaths: sketch(g(n, "joinPaths"), 0, 9),
        pathCardinalityTypeList: sketch(g(n, "pathCardinalityTypeList"), 0, 4)
      });
    });
    out.relatedNodeCount = relatedNodes.length;
    out.relatedNodes = relatedNodes.slice(0, 12);
    out.foreignKeyDict = sketch(g(meta, "_foreignKeyDict"), 0, 5);
    // also: what a condition stores to pick its path (so we can match condition→path)
    var condSample = null;
    for (var j = 0; j < ALL.length; j++) {
      var c = g(ALL[j], "simpleCondition") || g(ALL[j], "aggregationCondition");
      if (c && typeof c === "object" && (c.subject || c.path || c.joinPath)) {
        condSample = { tag: tagOf(ALL[j]), attributeName: g(c, "attributeName"), subject: sketch(g(c, "subject"), 0, 4),
          path: sketch(g(c, "path"), 0, 6), joinPath: sketch(g(c, "joinPath"), 0, 6),
          containerCid: g(c, "parentCid") || g(c, "entityScopedGroupCid") || null,
          pathForDisplay: sketch(g(c, "pathForDisplay"), 0, 6) };
        break;
      }
    }
    out.conditionSample = condSample;
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
  panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:330px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
  panel.innerHTML =
    "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
    + "<b style='font:700 13px system-ui'>DOM Probe v9 — displayPaths</b>"
    + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
    + "<div style='padding:13px 14px'>"
    + "<div id='dc-probe-status' style='font-weight:700;color:" + (meta ? "#059669" : "#b45309") + ";margin-bottom:8px'>" + (meta ? ("✓ Copied (" + kb + " KB) — " + (out.relatedNodeCount || 0) + " related node(s)") : "⚠ metadata not found — open the segment builder, then re-run") + "</div>"
    + "<div style='font-size:11px;color:#475569;line-height:1.5'>" + (meta ? "Paste it back." : "") + "</div>"
    + "<div style='display:flex;gap:7px;margin-top:12px'>"
    + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy again</button>"
    + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
    + "</div>";
  document.body.appendChild(panel);
  var status = panel.querySelector("#dc-probe-status");
  copyText(json, function (ok) { if (!ok && meta) { status.textContent = "⚠ Auto-copy blocked — click Copy again"; status.style.color = "#b45309"; } });
  panel.querySelector("#dc-probe-x").onclick = function () { panel.remove(); };
  panel.querySelector("#dc-probe-copy").onclick = function () { copyText(json, function (ok) { status.textContent = ok ? "✓ Copied again" : "⚠ Use Download"; status.style.color = ok ? "#059669" : "#b45309"; }); };
  panel.querySelector("#dc-probe-dl").onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v9-" + Date.now() + ".json"; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000); } catch (e) {} };

  console.log("%cDOM PROBE v9 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
  return out;
})();
