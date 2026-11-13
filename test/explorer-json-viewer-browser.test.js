// Real-Chrome test (run manually): drives the actual viewer DOM. Keep < 6s.
const fs = require("fs"), http = require("http"), cp = require("child_process"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../console-decorate.extension.js", "utf8");
const code = src.slice(src.indexOf("  function dcJsonPathStr(path)"), src.indexOf("  // Persisted filter state per object"));
const data = { Id__c: "x1", T: [{ A: "one", Kids: [{ Phone: "+1" }, { Phone: "+2" }] }], Z: [] };
const html = "<!doctype html><meta charset=utf-8><body><script>var makeDraggable=null;window.__copied=[];navigator.clipboard&&0;" + code +
  "\nwindow.stubCalls=[];window.stubFail=false;window.dcQueryDataGraph=function(l,rt){stubCalls.push(rt);return new Promise(function(res,rej){setTimeout(function(){stubFail?rej(new Error('boom')):res({Id__c:'LIVE',Items:[{a:1},{a:2},{a:3}]})},60)})};window.openLive=function(){showCellValue('f','Label',JSON.stringify({Id__c:'old',Items:[{a:1}]}),{objectName:'X',dataSpace:'d',keyField:'Id__c',keyValue:'k'})};window.open_=function(){showCellValue('f','Label',JSON.stringify(" + JSON.stringify(data) + "))};</script>";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  const srv = http.createServer((q, s) => { s.setHeader("content-type", "text/html; charset=utf-8"); s.end(html); }); await new Promise(r => srv.listen(0, r));
  const dbg = 9900 + Math.floor(Math.random() * 40), prof = fs.mkdtempSync("/tmp/chr-sm-");
  const ch = cp.spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=" + dbg, "--user-data-dir=" + prof, "about:blank"], { stdio: "ignore" });
  let tgt = null; for (let i = 0; i < 40 && !tgt; i++) { await new Promise(r => setTimeout(r, 200)); try { tgt = (await (await fetch("http://127.0.0.1:" + dbg + "/json/list")).json()).find(t => t.type === "page"); } catch (e) {} }
  const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.navigate", { url: "http://127.0.0.1:" + srv.address().port + "/" }); await new Promise(r => setTimeout(r, 400));
  const ev = async e => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.result.value;
  let n = 0; const ok = (c, m) => { assert(c, m); n++; };
  await ev("open_()");
  ok(await ev("document.querySelectorAll('.dc-jv').length") === 1, "opens");
  ok(await ev("Array.from(document.querySelectorAll('.seg button.on')).map(function(b){return b.textContent}).join()") === "Table", "opens on the Table tab by default");
  ok(await ev("document.querySelectorAll('.ri').length") === 3, "3 tabs (Z empty)");
  ok(await ev("document.querySelector('.ri.empty .n').textContent") === "0", "empty tab shows 0");
  // search filters rows in Kids tab
  await ev("Array.from(document.querySelectorAll('.ri')).find(function(t){return /Kids/.test(t.textContent)}).click()");
  ok(await ev("document.querySelectorAll('tbody tr').length") === 2, "2 rows");
  await ev("var q=document.querySelector('.q');q.value='+2';q.dispatchEvent(new Event('input'))");
  ok(await ev("document.querySelectorAll('tbody tr').length") === 1, "search filters rows");
  // searching a table NAME selects all its rows; rail shows match counts
  await ev("var q2=document.querySelector('.q');q2.value='kids';q2.dispatchEvent(new Event('input'))");
  ok(await ev("document.querySelectorAll('tbody tr').length") === 2, "name search keeps all rows of the matching table");
  ok(/^2\/2$/.test(await ev("Array.from(document.querySelectorAll('.ri')).find(function(t){return /Kids/.test(t.textContent)}).querySelector('.n').textContent")), "rail shows 2/2");
  ok(await ev("document.querySelector('.ri.on').style.paddingLeft") !== await ev("document.querySelectorAll('.ri')[0].style.paddingLeft"), "nested table indented");
  // fullscreen toggle, and view switches don't shrink it
  await ev("document.querySelector('.dc-cv-fs').click()");
  ok(await ev("document.querySelector('.dc-jv').style.width") === "100vw", "fullscreen on");
  await ev("document.querySelector(\".seg button[data-v='raw']\").click()");
  ok(await ev("document.querySelector('.dc-jv').style.width") === "100vw", "view switch keeps fullscreen");
  await ev("document.querySelector('.dc-cv-fs').click();document.querySelector(\".seg button[data-v='table']\").click()");
  ok(await ev("document.querySelector('.dc-jv').style.width") !== "100vw", "fullscreen off");
  await ev("var q3=document.querySelector('.q');q3.value='';q3.dispatchEvent(new Event('input'))");
  // Tree: collapsed branches are not built until opened (lazy)
  await ev("document.querySelector(\".seg button[data-v='tree']\").click()");
  const rows0 = await ev("document.querySelectorAll('.tree .row').length");
  await ev("document.querySelector('[data-a=exp]').click()");
  ok(await ev("document.querySelectorAll('.tree .row').length") > rows0, "expand all builds more");
  await ev("document.querySelector('[data-a=col]').click()");
  ok(await ev("document.querySelectorAll('.tree .row').length") === rows0, "collapse back to default");
  // Raw shows the ORIGINAL data (Table view must not have injected promoted keys)
  await ev("document.querySelector(\".seg button[data-v='raw']\").click()");
  const rawTxt = await ev("document.querySelector('.raw .c').textContent");
  ok(Object.keys(JSON.parse(rawTxt)).join() === "Id__c,T,Z", "raw has no promoted keys: " + Object.keys(JSON.parse(rawTxt)));
  ok(await ev("document.querySelector('.raw .g').textContent.split('\\n').length") === rawTxt.split("\n").length, "line numbers match");
  ok(await ev("document.querySelector('.q').style.display") === "none", "search hidden in raw");
  // Esc closes and removes listener
  await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  ok(await ev("document.querySelectorAll('.dc-jv').length") === 0, "Esc closes");
  // non-JSON text value
  await ev("showCellValue('f','L','just some text <b>')");
  ok(await ev("document.querySelector('.dc-jv pre').textContent") === "just some text <b>" && await ev("document.querySelectorAll('.dc-jv b').length") === 0, "plain text escaped");
  ok(await ev("document.querySelectorAll('.seg').length") === 0, "no view switch for text");
  // ---- Data Graph live controls
  ok(await ev("document.querySelectorAll('.sw').length") === 0, "no live controls for ordinary JSON");
  await ev("openLive()");
  ok(await ev("document.querySelector('.sw').getAttribute('aria-checked')") === "false" && /Stored/.test(await ev("document.querySelector('.st').textContent")), "starts Stored / off");
  await ev("document.querySelector('.sw').click()");
  ok(await ev("document.querySelector('.sw').disabled") === true, "controls disabled while loading");
  await new Promise(r => setTimeout(r, 250));
  ok(await ev("stubCalls.join()") === "true", "toggle ON asks for real-time (noCache true)");
  ok(/Live/.test(await ev("document.querySelector('.st').textContent")) && await ev("document.querySelector('.sw').getAttribute('aria-checked')") === "true", "status Live, switch on");
  ok(/LIVE/.test(await ev("document.querySelector('.cards').textContent")) && await ev("document.querySelectorAll('tbody tr').length") === 3, "view re-rendered with fresh data");
  ok(/3 rows|2 tables|1 table/.test(await ev("document.querySelector('.info').textContent")), "info line refreshed");
  await ev("document.querySelector('.rf').click()"); await new Promise(r => setTimeout(r, 250));
  ok(await ev("stubCalls.join()") === "true,true", "Refresh keeps the current mode");
  await ev("document.querySelector('.sw').click()"); await new Promise(r => setTimeout(r, 250));
  ok(await ev("stubCalls.join()") === "true,true,false", "toggle OFF -> stored");
  await ev("stubFail=true;document.querySelector('.rf').click()"); await new Promise(r => setTimeout(r, 250));
  ok(/Could not load/.test(await ev("document.querySelector('.st').textContent")) && /boom/.test(await ev("document.querySelector('.st').title")) && /LIVE/.test(await ev("document.querySelector('.cards').textContent")), "failure keeps previous data; detail in tooltip");
  ok(await ev("document.querySelector('.rf').disabled") === false, "controls re-enabled after failure");
  // reopening replaces, never stacks
  await ev("open_();open_()"); ok(await ev("document.querySelectorAll('.dc-jv').length") === 1, "no stacking");
  // ---- tool turned OFF: no dc- id needed. Stray floating overlays + the viewer must all go; page content must stay.
  await ev(`document.body.insertAdjacentHTML('beforeend',
    "<div id='keep-app' style='position:absolute'>SF app root</div>" +
    "<div class='dc-popup' style='position:fixed;top:0'>x</div>" +
    "<div data-dc-guide-spot='1' style='position:fixed'>ring</div>" +
    "<div data-dc-sort-guide style='position:absolute'>tag</div>" +
    "<div class='dc-static-but-not-floating' style='position:static'>safe</div>" +
    "<div class='other' style='position:fixed'>not ours</div>");
    openLive();`);
  ok(await ev("document.getElementById('dc-jv-modal') != null"), "viewer has a dc- id now");
  await ev("closeCellView();dcSweepOverlays()");
  ok(await ev("document.querySelector('.dc-jv')") === null, "viewer closed on off");
  ok(await ev("document.querySelectorAll('.dc-popup,[data-dc-guide-spot],[data-dc-sort-guide]').length") === 0, "floating dc overlays removed");
  ok(await ev("!!document.getElementById('keep-app') && !!document.querySelector('.other') && !!document.querySelector('.dc-static-but-not-floating')"), "page content and non-floating elements untouched");
  await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");   // listener removed -> no error
  ok(await ev("typeof _cellViewEsc") !== "undefined" && await ev("_cellViewEsc === null"), "Esc listener released");
  console.log("explorer-json-viewer-browser: " + n + " checks passed");
  ch.kill(); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
