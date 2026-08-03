// Diagnose why "Couldn't reach the query service" happens.
// Run on the Data Explorer page (tool loaded). Then SORT a column once. Watch output.
(function () {
  var seen = { fetch: 0, xhr: 0, auraFetch: 0, auraXhr: 0, ctx: false, tok: false, tmpl: false };

  // Wrap AGAIN on top of whatever's there, purely to observe (does the page even
  // route Data Cloud queries through window.fetch / XHR that a late patch can see?).
  var of = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = (typeof input === "string") ? input : (input && input.url) || "";
      seen.fetch++;
      if (/\/aura/i.test(url)) {
        seen.auraFetch++;
        var body = init && init.body;
        if (typeof body === "string") {
          if (/aura\.context/.test(body)) seen.ctx = true;
          if (/aura\.token/.test(body))   seen.tok = true;
          if (/CdpDataView|ACTION\$query/i.test(body)) seen.tmpl = true;
        }
        console.log("%c[aura-probe] FETCH /aura", "color:#0a0", url.slice(0, 80), "hasBody:", !!(init && init.body), "type:", init && init.body && init.body.constructor && init.body.constructor.name);
      }
    } catch (e) {}
    return of.apply(this, arguments);
  };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__pu = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) {
    try {
      seen.xhr++;
      if (/\/aura/i.test(String(this.__pu || ""))) {
        seen.auraXhr++;
        if (typeof b === "string") {
          if (/aura\.context/.test(b)) seen.ctx = true;
          if (/aura\.token/.test(b))   seen.tok = true;
          if (/CdpDataView|ACTION\$query/i.test(b)) seen.tmpl = true;
        }
        console.log("%c[aura-probe] XHR /aura", "color:#06c", String(this.__pu).slice(0, 80), "bodyType:", b && b.constructor && b.constructor.name);
      }
    } catch (e) {}
    return os.apply(this, arguments);
  };

  console.log("%c[aura-probe] installed. Now SORT a column once, then wait 3s…", "font-weight:bold;color:#a00");
  setTimeout(function () {
    console.group("%c[aura-probe] RESULTS after 3s", "font-weight:bold");
    console.log("total fetch calls seen:", seen.fetch, "| /aura via fetch:", seen.auraFetch);
    console.log("total XHR   calls seen:", seen.xhr,   "| /aura via XHR:  ", seen.auraXhr);
    console.log("captured aura.context:", seen.ctx, "| aura.token:", seen.tok, "| CdpDataView template:", seen.tmpl);
    if (!seen.auraFetch && !seen.auraXhr) {
      console.warn("❌ NO /aura traffic seen via fetch OR XHR. The page routes Data Cloud queries some other way (worker/beacon/pre-captured reference). The sniffer CAN'T work as written.");
    } else if (!seen.ctx || !seen.tok) {
      console.warn("⚠ Saw /aura traffic but missed context/token — body may be Blob/FormData, not a string. Sniffer needs to read those types.");
    } else {
      console.log("✅ Credentials ARE visible here. If the tool still fails, its sniffer installs too late or the body type check misses this one.");
    }
    console.groupEnd();
  }, 3000);
})();
