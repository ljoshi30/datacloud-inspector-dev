// PROBE 11 (Data Explorer) — DECISIVE token/context source + passive-capture check.
//
// Probe 10 showed the standard $A accessors are undefined on this org. Two things to
// settle so we can make credential capture DETERMINISTIC (no hit-and-trial):
//   (A) What are the REAL keys/methods on $A.clientService and $A.getContext()? The
//       token+context live there (the framework posts them on every request) — we just
//       need the actual accessor names on THIS Aura version.
//   (B) With NO user action, does background traffic (telemetry/o11y) to /aura fire on
//       its own — via fetch, XHR, or sendBeacon — carrying aura.context + aura.token?
//       If yes, a passive sniffer (incl. sendBeacon) captures creds with zero clicks.
//
// READ-ONLY: inspects globals + watches request METADATA for 6s. Sends nothing.
(function () {
  var log = console.log.bind(console);
  log("%c=== PROBE 11: deep aura token/context + passive capture ===", "color:#0b5cab;font-weight:bold;font-size:13px");
  function safe(fn){try{return fn();}catch(e){return undefined;}}

  // ── (A) enumerate the real shape of clientService + context ────────────────
  function keysDeep(obj, depth) {
    var out = {}; var o = obj;
    for (var d = 0; d < (depth || 4) && o; d++) {
      safe(function(){ Object.getOwnPropertyNames(o).forEach(function(k){ if(!(k in out)){ var t; try{t=typeof obj[k];}catch(e){t="?";} out[k]=t; } }); });
      o = Object.getPrototypeOf(o);
    }
    return out;
  }
  var cs = safe(function(){return window.$A.clientService;});
  var ctx = safe(function(){return window.$A.getContext();});
  log("\n-- $A.clientService keys (name:type) --");
  if (cs) { var ck=keysDeep(cs); Object.keys(ck).sort().forEach(function(k){ if(/token|csrf|context|host|fwuid|auth|nonce/i.test(k)) log("  ★ "+k+": "+ck[k]); });
            log("  (all:", Object.keys(ck).filter(function(k){return typeof cs[k]!=="function"||/token|context|csrf|host/i.test(k);}).slice(0,60).join(", "), ")"); }
  else log("  (no clientService)");
  log("\n-- $A.getContext() keys (name:type) --");
  if (ctx) { var xk=keysDeep(ctx); Object.keys(xk).sort().forEach(function(k){ if(/token|csrf|context|fwuid|encode|server|mode|app|loaded/i.test(k)) log("  ★ "+k+": "+xk[k]); }); }
  else log("  (no context)");

  // probe values on the starred method/prop names we found
  log("\n-- try calling context server-ish methods --");
  ["getContextForServer","encodeForServer","getEncodedContext","getCsrfToken","serialize"].forEach(function(m){
    var v = safe(function(){ return typeof ctx[m]==="function" ? ctx[m]() : ctx[m]; });
    if (v !== undefined) log("  ctx."+m+"() →", (typeof v==="string"?v.slice(0,80):JSON.stringify(v).slice(0,80)));
  });
  ["_token","token","auraToken","_csrfToken","getToken"].forEach(function(m){
    var v = safe(function(){ return typeof cs[m]==="function" ? cs[m]() : cs[m]; });
    if (v !== undefined && v !== null) log("  clientService."+m+" →", String(v).slice(0,60));
  });

  // ── (B) passive capture: watch fetch/XHR/sendBeacon for 6s, NO user action ──
  log("\n-- (B) watching background /aura traffic for 6s (do NOTHING) --");
  var seen = { fetch:0, xhr:0, beacon:0, withToken:0, sample:null };
  var of = window.fetch, oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send, ob = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  function note(kind, url, body){
    if (!/\/aura/i.test(String(url||""))) return;
    seen[kind]++;
    var s=String(body||"");
    if (/aura\.token=/.test(s)) { seen.withToken++; if(!seen.sample){ var m=s.match(/aura\.token=([^&]{10,})/); seen.sample = m?("token len "+decodeURIComponent(m[1]).length):"present"; } }
  }
  window.fetch = function(input,init){ try{ note("fetch",(typeof input==="string"?input:input&&input.url),init&&init.body);}catch(e){} return of.apply(this,arguments); };
  XMLHttpRequest.prototype.open = function(m,u){ this.__u=u; return oo.apply(this,arguments); };
  XMLHttpRequest.prototype.send = function(b){ try{ note("xhr",this.__u,b);}catch(e){} return os.apply(this,arguments); };
  if (navigator.sendBeacon) navigator.sendBeacon = function(u,d){ try{ note("beacon",u,typeof d==="string"?d:"");}catch(e){} return ob(u,d); };

  setTimeout(function(){
    window.fetch = of; XMLHttpRequest.prototype.open = oo; XMLHttpRequest.prototype.send = os; if (ob) navigator.sendBeacon = ob;
    log("  /aura requests in 6s — fetch:"+seen.fetch+" xhr:"+seen.xhr+" beacon:"+seen.beacon+"  (with aura.token: "+seen.withToken+")");
    log("  token sample:", seen.sample || "none");
    log("%c\nVERDICT:", "color:#0b5cab;font-weight:bold");
    if (seen.withToken>0) log("%c  ✅ background traffic carries aura.token — a passive sniffer (incl. sendBeacon) captures creds with ZERO user action. Fix = broaden sniffer + warm patience.", "color:#0a6b2d;font-weight:bold");
    else log("%c  ⚠️ no token seen passively in 6s — creds only come with a real user-triggered query; we must force one reliably (or use an accessor found in section A).", "color:#b8860b;font-weight:bold");
    log("%c=== copy ALL output ===", "color:#0b5cab;font-weight:bold");
  }, 6000);
})();
