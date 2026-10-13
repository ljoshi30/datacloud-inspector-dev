/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v28 — Query Editor Fetch&Export: why it stops at ~3-4k + does OFFSET page?
 *
 * Confirmed in code: the bookmarklet /aura queryDCSql returns only ~4,000 rows per request
 * (not the 49,999 we ask), and qeFetchExport quits when a batch is SHORTER than pageSize —
 * so it stops after the first ~4k even on a 1.7M table. Fix = keep paging via OFFSET while
 * rows keep coming. But that fix only works if deep OFFSET actually returns NEW rows on
 * THIS endpoint/org. This probe tests exactly that, read-only, on YOUR table:
 *   - edit TABLE below (or it auto-reads the FROM of the SQL in SF's editor)
 *   - runs 3 real /aura queries: LIMIT 2000 OFFSET 0, OFFSET 2000, OFFSET 4000
 *   - reports each batch's row count + the FIRST column's first value, so we can see if
 *     OFFSET 2000/4000 return DIFFERENT rows (paging works) or the SAME/empty (paging broken)
 *
 * RUN on the Query Editor page AFTER clicking SF's "Run Query" once (so the session/aura
 * token is live). Read-only (SELECT only). Copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe28() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  // ── find the live aura context/token the page already uses (same source the tool sniffs) ──
  function findAura() {
    var ctx = "", tok = "", uri = location.pathname;
    try {
      // Aura framework global
      if (window.$A && window.$A.getContext) {
        try { ctx = JSON.stringify(window.$A.getContext().getStorage ? {} : {}); } catch (e) {}
      }
    } catch (e) {}
    // Most reliable: scrape from any inline script / aura config on the page
    try {
      var html = document.documentElement.innerHTML;
      var mT = html.match(/"token":"([^"]+)"/); if (mT) tok = mT[1];
      var mC = html.match(/"fwuid":"[^"]+"[\s\S]*?\}/); // not reliable; leave ctx blank if unknown
    } catch (e) {}
    return { ctx: ctx, tok: tok, uri: uri };
  }
  // We can't easily rebuild aura.context here; instead REUSE the tool's sniffed creds if the
  // bookmarklet/extension is loaded (window.__DC_DECOR__ exposes nothing, so fall back to a
  // DOM scrape of aura.token + the context from a known inline). To stay robust and avoid
  // guessing, we instead drive the query through the SAME /aura endpoint using the aura
  // context that the page's own action framework exposes via a lightweight fetch of the
  // page config. If we can't get a token, we report that clearly.

  var TABLE = "";   // ← optionally hardcode "YourTable__dlm"; else auto-read from the editor
  function readEditorSql() {
    var best = "";
    try {
      var tas = document.querySelectorAll("textarea");
      for (var i = 0; i < tas.length; i++) { var v = tas[i].value || ""; if (/select/i.test(v) && /from/i.test(v) && v.length > best.length) best = v; }
      if (!best) { var ces = document.querySelectorAll("[contenteditable='true']"); for (var j = 0; j < ces.length; j++) { var t = ces[j].textContent || ""; if (/select/i.test(t) && /from/i.test(t) && t.length > best.length) best = t; } }
    } catch (e) {}
    return best;
  }
  var sqlInEditor = readEditorSql();
  if (!TABLE) { var fm = sqlInEditor.match(/\bFROM\s+["]?([A-Za-z0-9_]+)/i); if (fm) TABLE = fm[1]; }

  // Grab aura token + context the way the page stores it (window.Aura / inline bootstrap).
  var auraCtx = "", auraTok = "";
  try {
    // Lightning stores the action token on the aura config; the tool sniffs it from XHRs,
    // but we can read the current one from the global config if present.
    if (window.Aura && window.Aura.Initializer && window.Aura.Initializer.getConfig) {
      var cfg = window.Aura.Initializer.getConfig();
      if (cfg && cfg.context) { auraCtx = JSON.stringify({ mode: cfg.context.mode, fwuid: cfg.context.fwuid, app: cfg.context.app, loaded: cfg.context.loaded, apce: cfg.context.apce, apcp: cfg.context.apcp, globals: cfg.context.globalValueProviders ? undefined : undefined }); }
      if (cfg && cfg.token) auraTok = cfg.token;
    }
  } catch (e) {}
  try { if (!auraTok && window.$A && $A.clientService && $A.clientService._token) auraTok = $A.clientService._token; } catch (e) {}

  var dataspace = "";
  try { var fm2 = (sqlInEditor || "").match(/\bFROM\s+["]?([A-Za-z0-9]{2,6})_/i); if (fm2) dataspace = fm2[1]; } catch (e) {}

  function runBatch(offset, limit) {
    return new Promise(function (resolve) {
      if (!auraTok || !auraCtx) { resolve({ offset: offset, error: "no aura token/context available on page — run SF Run Query first, or this probe can't reach /aura" }); return; }
      var sql = "SELECT * FROM \"" + TABLE + "\" LIMIT " + limit + (offset > 0 ? " OFFSET " + offset : "");
      var qid = Math.floor((window.performance && performance.now ? performance.now() : 1) * 1) + offset;
      var act = { id: "dcprobe-" + qid + ";a", descriptor: "serviceComponent://ui.cdp.components.controllers.QueryWorkspaceController/ACTION$queryDCSql", callingDescriptor: "UNKNOWN", params: { sql: sql, rowLimit: limit, dataspace: dataspace } };
      var form = "message=" + encodeURIComponent(JSON.stringify({ actions: [act] })) + "&aura.context=" + encodeURIComponent(auraCtx) + "&aura.pageURI=" + encodeURIComponent(location.pathname) + "&aura.token=" + encodeURIComponent(auraTok);
      fetch("/aura?r=" + qid + "&ui-cdp-components-controllers.QueryWorkspace.queryDCSql=1", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: form, credentials: "include" })
        .then(function (r) { return r.text(); }).then(function (txt) {
          var j = null; try { j = JSON.parse(txt); } catch (e) { resolve({ offset: offset, error: "non-JSON (session?)", sample: txt.slice(0, 120) }); return; }
          var a = j && j.actions && j.actions[0];
          if (!a || a.state !== "SUCCESS") { resolve({ offset: offset, state: a && a.state, error: (a && a.error && a.error[0] && (a.error[0].message || a.error[0].primaryMessage)) || "action failed" }); return; }
          var rv = a.returnValue || {}; var dr = rv.dataRows || rv.rows || rv.data || [];
          var arr = dr.map(function (d) { return d && d.row ? d.row : d; });
          var firstVal = arr.length && Array.isArray(arr[0]) ? arr[0][0] : (arr.length ? JSON.stringify(arr[0]).slice(0, 40) : null);
          var lastVal = arr.length && Array.isArray(arr[arr.length - 1]) ? arr[arr.length - 1][0] : null;
          var st = rv.status || {};
          resolve({ offset: offset, requested: limit, returned: arr.length, firstCol0: firstVal, lastCol0: lastVal, completionStatus: st.completionStatus, progress: st.progress, rowsProcessed: st.rowsProcessed != null ? st.rowsProcessed : st.rowCount });
        }).catch(function (err) { resolve({ offset: offset, error: String(err) }); });
    });
  }

  var out = { _tool: "dom-probe", _version: 28, page: location.href, table: TABLE, dataspace: dataspace, sqlInEditor: (sqlInEditor || "").slice(0, 160), auraTokenFound: !!auraTok, auraContextFound: !!auraCtx, batches: [] };

  function render() {
    var json = ""; try { json = JSON.stringify(out, null, 2); } catch (e) { json = '{"error":"stringify"}'; }
    try { window.__DOM_PROBE = out; } catch (e) {}
    var kb = Math.round(json.length / 1024);
    var panel = document.getElementById(PANEL_ID) || document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:360px;background:#fff;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.35);font:13px -apple-system,system-ui,sans-serif;color:#1e293b;overflow:hidden;border:1px solid #e2e8f0;";
    var rows = out.batches.map(function (b) { return "OFFSET " + b.offset + " → <b>" + (b.returned != null ? b.returned : ("ERR: " + (b.error || b.state))) + "</b>" + (b.firstCol0 != null ? " (first=" + String(b.firstCol0).slice(0, 14) + ")" : ""); }).join("<br>");
    panel.innerHTML =
      "<div style='padding:11px 14px;background:linear-gradient(135deg,#7c3aed,#4338ca);color:#fff;display:flex;align-items:center;justify-content:space-between'>"
      + "<b style='font:700 13px system-ui'>DOM Probe v28 · OFFSET paging</b>"
      + "<button id='dc-probe-x' style='border:none;background:rgba(255,255,255,.2);color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:16px'>&times;</button></div>"
      + "<div style='padding:13px 14px'>"
      + "<div id='dc-probe-status' style='font-weight:700;color:#059669;margin-bottom:8px'>" + (out.batches.length >= 3 ? "✓ Done — copied (" + kb + " KB)" : "Running…") + "</div>"
      + "<div style='font-size:11px;color:#475569;line-height:1.7'>Table: <b>" + (TABLE || "?") + "</b> · ds: <b>" + (dataspace || "?") + "</b><br>Aura token: <b>" + (auraTok ? "yes" : "NO") + "</b> · ctx: <b>" + (auraCtx ? "yes" : "NO") + "</b><br>" + (rows || "(no batches yet)") + "</div>"
      + "<div style='display:flex;gap:7px;margin-top:12px'>"
      + "<button id='dc-probe-copy' style='flex:1;border:none;border-radius:7px;padding:8px;cursor:pointer;font:700 12px system-ui;color:#fff;background:linear-gradient(135deg,#4338ca,#6d28d9)'>Copy</button>"
      + "<button id='dc-probe-dl' style='border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:8px 10px;cursor:pointer;font:600 12px system-ui;color:#334155'>Download</button></div>"
      + "<div style='font-size:11px;color:#94a3b8;margin-top:9px;line-height:1.5'>If OFFSET 0 / 2000 / 4000 return DIFFERENT first-values, paging works → the fix is valid. If they repeat or error, paging is broken on this endpoint.</div>"
      + "</div>";
    if (!panel.parentNode) document.body.appendChild(panel);
    function copyText(t, cb) { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(false); }); else { try { var ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.top = "-1000px"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); cb(true); } catch (e) { cb(false); } } }
    var x = panel.querySelector("#dc-probe-x"); if (x) x.onclick = function () { panel.remove(); };
    var c = panel.querySelector("#dc-probe-copy"); if (c) c.onclick = function () { copyText(json, function () {}); };
    var d = panel.querySelector("#dc-probe-dl"); if (d) d.onclick = function () { try { var b = new Blob([json], { type: "application/json" }); var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "dom-probe-v28-" + out.batches.length + ".json"; a.click(); } catch (e) {} };
    if (out.batches.length >= 3) copyText(json, function () {});
  }

  render();
  if (!TABLE) { out.batches.push({ error: "no table — put a SELECT … FROM <table> in the editor or hardcode TABLE in the probe" }); render(); return; }
  // run the 3 batches sequentially
  runBatch(0, 2000).then(function (b0) { out.batches.push(b0); render(); return runBatch(2000, 2000); })
    .then(function (b1) { out.batches.push(b1); render(); return runBatch(4000, 2000); })
    .then(function (b2) { out.batches.push(b2); render(); });

  console.log("%cDOM PROBE v28 — window.__DOM_PROBE", "font:700 13px system-ui;color:#4338ca", out);
})();
