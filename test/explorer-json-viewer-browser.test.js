// Real-Chrome test (run manually): drives the actual viewer DOM. Keep < 6s.
const fs = require("fs"), http = require("http"), cp = require("child_process"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../console-decorate.extension.js", "utf8");
const code = src.slice(src.indexOf("  function dcJsonPathStr(path)"), src.indexOf("  // Persisted filter state per object"));
const data = { Id__c: "x1", T: [{ A: "one", Kids: [{ Phone: "+1" }, { Phone: "+2" }] }], Z: [] };
const html = "<!doctype html><meta charset=utf-8><body><script>var makeDraggable=null;window.__copied=[];navigator.clipboard&&0;" + code +
  "\nwindow.open_=function(){showCellValue('f','Label',JSON.stringify(" + JSON.stringify(data) + "))};</script>";
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
  ok(await ev("document.querySelectorAll('.tab').length") === 3, "3 tabs (Z empty)");
  ok(await ev("document.querySelector('.tab.empty .n').textContent") === "0", "empty tab shows 0");
  // search filters rows in Kids tab
  await ev("Array.from(document.querySelectorAll('.tab')).find(function(t){return /^Kids/.test(t.textContent)}).click()");
  ok(await ev("document.querySelectorAll('tbody tr').length") === 2, "2 rows");
  await ev("var q=document.querySelector('.q');q.value='+2';q.dispatchEvent(new Event('input'))");
  ok(await ev("document.querySelectorAll('tbody tr').length") === 1, "search filters rows");
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
  // reopening replaces, never stacks
  await ev("open_();open_()"); ok(await ev("document.querySelectorAll('.dc-jv').length") === 1, "no stacking");
  console.log("explorer-json-viewer-browser: " + n + " checks passed");
  ch.kill(); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
