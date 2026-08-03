// PROBE 10 (Data Explorer) — find a DETERMINISTIC source for aura token + context.
//
// The reliability bug ("Couldn't reach the query service"): today the tool SNIFFS an
// /aura request to steal token+context. That only works if a request happens to fire
// after the tool loaded — hence the hit-and-trial. The robust fix is to READ the
// token+context directly from the page's own Aura framework so it's available INSTANTLY,
// every time. This probe checks which global accessor yields a usable token+context.
//
// READ-ONLY: it only inspects window globals + does ONE test replay of the read-only
// CdpDataView.query using whatever token/context it finds (to prove they actually work).
// Run on the Data Explorer page; paste ALL output.
(function () {
  var log = console.log.bind(console);
  var ok = (m) => log("%c" + m, "color:#0a6b2d;font-weight:bold");
  var bad = (m) => log("%c" + m, "color:#c00");
  log("%c=== PROBE 10: direct aura token/context source ===", "color:#0b5cab;font-weight:bold;font-size:13px");

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function typeOf(v) { return v === undefined ? "undefined" : (v === null ? "null" : typeof v); }
  function preview(v) { try { var s = typeof v === "string" ? v : JSON.stringify(v); return (s || "").slice(0, 60); } catch (e) { return "(unprintable)"; } }

  // ── 1) Is the Aura framework present? ──────────────────────────────────────
  log("\n-- Aura framework --");
  log("  window.$A:", typeOf(window.$A));
  log("  $A.getContext:", typeOf(safe(() => window.$A.getContext)));
  log("  $A.clientService:", typeOf(safe(() => window.$A.clientService)));

  // ── 2) Candidate TOKEN accessors ───────────────────────────────────────────
  log("\n-- candidate TOKEN sources --");
  var tokenCandidates = {
    "$A.clientService._token": safe(() => window.$A.clientService._token),
    "$A.clientService.token": safe(() => window.$A.clientService.token),
    "$A.clientService._csrfToken": safe(() => window.$A.clientService._csrfToken),
    "$A.getContext().getCsrfToken?.()": safe(() => window.$A.getContext().getCsrfToken && window.$A.getContext().getCsrfToken()),
    "window.aura && aura.token": safe(() => window.aura && window.aura.token),
    "window.__AURA_TOKEN__": safe(() => window.__AURA_TOKEN__),
  };
  Object.keys(tokenCandidates).forEach(k => {
    var v = tokenCandidates[k];
    log("  " + k + ":", typeOf(v), v ? "→ " + preview(v) : "");
  });
  // scan inline scripts for a "token":"..." that looks like the aura token (JWT-ish)
  var scriptToken = "";
  safe(() => {
    var scripts = document.querySelectorAll("script:not([src])");
    for (var i = 0; i < scripts.length; i++) {
      var m = (scripts[i].textContent || "").match(/"token"\s*:\s*"([^"]{20,})"/);
      if (m) { scriptToken = m[1]; break; }
    }
  });
  log("  inline <script> \"token\":", scriptToken ? "found → " + scriptToken.slice(0, 40) + "…" : "none");

  // ── 3) Candidate CONTEXT accessors ─────────────────────────────────────────
  log("\n-- candidate CONTEXT sources --");
  var ctxCandidates = {
    "$A.getContext().encodeForServer?.()": safe(() => window.$A.getContext().encodeForServer && window.$A.getContext().encodeForServer()),
    "$A.getContext().getContextForServer?.()": safe(() => window.$A.getContext().getContextForServer && JSON.stringify(window.$A.getContext().getContextForServer())),
    "$A.clientService._host (fwuid via)": safe(() => window.$A.clientService && window.$A.clientService._host),
  };
  Object.keys(ctxCandidates).forEach(k => {
    var v = ctxCandidates[k];
    log("  " + k + ":", typeOf(v), v ? "→ " + preview(v) : "");
  });
  // fwuid + app markup are in the aura config bootstrap; scan for them
  var fwuid = "", app = "";
  safe(() => { var m = document.documentElement.innerHTML.match(/"fwuid"\s*:\s*"([^"]+)"/); if (m) fwuid = m[1]; });
  safe(() => { var m = document.documentElement.innerHTML.match(/"APPLICATION@markup:\/\/([^"]+)"/); if (m) app = m[1]; });
  log("  fwuid (from page):", fwuid ? fwuid.slice(0, 30) + "…" : "none");
  log("  app markup (from page):", app || "none");

  // ── 4) PROVE it: build a context+token and replay the read-only query ───────
  // Try the most promising combo: script token + a minimal context we assemble.
  log("\n-- test replay (read-only CdpDataView.query) --");
  function eachElement(root, fn){var els;try{els=root.querySelectorAll("*");}catch(e){return;}for(var i=0;i<els.length;i++){var el=els[i];fn(el);var sr;try{sr=el.shadowRoot;}catch(e){}if(sr)eachElement(sr,fn);}}
  function tagOf(el){try{return (el.tagName||"").toLowerCase();}catch(e){return"";}}
  var rl=null; eachElement(document,function(el){if(!rl&&tagOf(el)==="runtime_cdp-data-view-record-list")rl=el;});
  var objectName = rl && rl.objectName || "";
  var col=""; try{(rl.columns||[]).forEach(function(c){if(!col&&c.fieldName&&c.fieldName!=="recordPageUrl")col=c.fieldName;});}catch(e){}
  if (!objectName || !col) { bad("  (no record-list/columns to test with — open a Data Explorer object)"); log("\n%c=== copy ALL ===","color:#0b5cab;font-weight:bold"); return; }

  var token = scriptToken || tokenCandidates["window.aura && aura.token"] || "";
  var ctxObj = safe(() => window.$A.getContext().getContextForServer && window.$A.getContext().getContextForServer());
  if (!token) { bad("  no token found in globals/scripts — replay skipped. The accessor table above is what I need."); log("\n%c=== copy ALL ===","color:#0b5cab;font-weight:bold"); return; }
  if (!ctxObj) {
    // assemble a minimal context if the framework didn't give one
    ctxObj = { mode: "PROD", fwuid: fwuid, app: "one:one", loaded: {}, dn: [], globals: {}, uad: true };
    if (app) ctxObj.loaded["APPLICATION@markup://one:one"] = "";
  }
  var msg = { actions: [{ id: "p10;a", descriptor: "serviceComponent://ui.cdp.components.controllers.CdpDataViewController/ACTION$query", callingDescriptor: "UNKNOWN", params: { query: { objectName: objectName, columns: [col], selectedDataSpaceName: (rl.dataSpace || "") } } }] };
  var form = "message=" + encodeURIComponent(JSON.stringify(msg)) +
             "&aura.context=" + encodeURIComponent(typeof ctxObj === "string" ? ctxObj : JSON.stringify(ctxObj)) +
             "&aura.token=" + encodeURIComponent(token);
  fetch("/aura?r=1&ui-cdp-components-controllers.CdpDataView.query=1", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"}, body: form, credentials:"include" })
    .then(function(r){ return r.text().then(function(t){ return {s:r.status,t:t}; }); })
    .then(function(res){
      log("  replay HTTP:", res.status);
      var okState=false; try{ var j=JSON.parse(res.t); okState = j.actions && j.actions[0] && j.actions[0].state==="SUCCESS"; }catch(e){}
      if (okState) ok("  ✅ DIRECT token+context WORKS — replay returned SUCCESS. We can read creds from globals, no sniffing.");
      else { bad("  ✗ replay did not SUCCEED with assembled creds. head:"); log("    " + res.t.slice(0,300)); }
      log("\n%c=== copy ALL output ===","color:#0b5cab;font-weight:bold");
    })
    .catch(function(e){ bad("  replay fetch error: " + e); log("\n%c=== copy ALL ===","color:#0b5cab;font-weight:bold"); });
})();
