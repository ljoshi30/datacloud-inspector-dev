// REAL-BROWSER behaviour test for the Data Stream formula popup (headless Chrome).
// Extracts the shipped dcDsFormulaModule from the source and drives it with real DOM events:
// hover, gap-crossing, press/select, Esc, outside click, copy exactness, toggle-off.
const fs = require("fs"), http = require("http"), cp = require("child_process"), path = require("path");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(CHROME)) { console.log("SKIP: Chrome not installed (test needs a real browser)"); process.exit(0); }
const src = fs.readFileSync(process.env.FM_SRC || path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");
const a = src.indexOf("(function dcDsFormulaModule() {");
const b = src.indexOf("\n  })();", a) + 8;
if (a < 0 || b < a) { console.log("FAIL: module not found"); process.exit(1); }
const mod = src.slice(a, b);
const FORMULAS = {
  short: "'UploadedFiles'",
  multi: "if(ISEMPTY(formulaField['dateTime__c'])) {\n  null;\n} else {\n  DAYPRECISION(formulaField['dateTime__c']);\n}",
  special: "a < b && c > d || \"q\" == 'r' ; `tick` ${x} \\n <script>alert(1)</script> &amp; ünï",
  long: Array.from({ length: 400 }, (_, i) => "term" + i + " + ").join("") + "0",
};
const html = `<!doctype html><meta charset=utf8><body><pre id=out></pre><script>
var R=[],F=${JSON.stringify(FORMULAS).replace(/<\//g, "<\\/")};
window.R=R;window.onerror=function(m){R.push("FAIL page error: "+m)};function ok(n,c,x){R.push((c?"PASS ":"FAIL ")+n+(c?"":"  -> "+x));}
window.findVisibleByTag=function(){return []};
var clip=null; Object.defineProperty(navigator,"clipboard",{value:{writeText:function(t){clip=t;return Promise.resolve()}},configurable:true});
${mod}
var dt=document.createElement("runtime_cdp-custom-datatable");
dt.keyField="id"; dt.columns=[{fieldName:"headerLabel"},{fieldName:"fieldLabel"}];
var keys=Object.keys(F); dt.data=keys.map(function(k,i){return {id:"r"+i,fieldLabel:"F_"+k,isFormulaField:"true",formula:F[k]}}).concat([{id:"rp",fieldLabel:"Plain",isFormulaField:"false",formula:""}]);
var tb=document.createElement("tbody"); var cells={};
dt.data.forEach(function(r){var tr=document.createElement("tr");tr.setAttribute("data-row-key-value",r.id);
  var td=document.createElement("td");td.setAttribute("data-label","Formula Field");td.textContent="\\u2713";td.style.cssText="padding:20px";tr.appendChild(td);
  var t2=document.createElement("td");t2.setAttribute("data-label","Name");t2.textContent=r.fieldLabel;tr.appendChild(t2);tb.appendChild(tr);cells[r.id]=td;});
var tbl=document.createElement("table");tbl.appendChild(tb);dt.appendChild(tbl);document.body.appendChild(dt);
function ev(t,type,o){t.dispatchEvent(new PointerEvent(type,Object.assign({bubbles:true,composed:true,cancelable:true},o||{})));}
var pop=function(){return document.getElementById("dc-fm-pop")};
var vis=function(){var p=pop();return !!p&&p.style.display!=="none"};
var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
(async function(){
 window.__dcToggleDsFormula();
 // 1 hover each formula kind -> popover text is the EXACT formula
 for(var i=0;i<keys.length;i++){ev(cells["r"+i],"pointerover");
  ok("hover "+keys[i]+": shown",vis(),"hidden");
  ok("hover "+keys[i]+": body text exact",pop().querySelector("#dc-fm-body").textContent===F[keys[i]]);
  clip=null; pop().querySelector("#dc-fm-copy").click(); await sleep(20);
  ok("copy "+keys[i]+": clipboard === formula byte-for-byte",clip===F[keys[i]],JSON.stringify(clip&&clip.slice(0,60)));
  ev(cells["r"+i],"pointerout"); await sleep(450); ok("leave "+keys[i]+": hides after delay",!vis());}
 // 2 non-formula cell does nothing
 ev(cells.rp,"pointerover"); ok("plain field: no popover",!vis());
 // 3 gap crossing: leave cell, enter popover within the delay -> stays open
 ev(cells.r1,"pointerover"); ev(cells.r1,"pointerout"); await sleep(120); ev(pop(),"pointerenter"); await sleep(500);
 ok("pointer reaches popover across the gap: stays open",vis());
 ev(pop(),"pointerleave"); await sleep(450); ok("leaving popover: closes",!vis());
 // 4 bridge present and bridging the gap
 ev(cells.r1,"pointerover"); var br=document.getElementById("dc-fm-bridge");
 ok("hover bridge exists, 10px, transparent",!!br&&br.style.height==="10px"&&br.style.background==="transparent");
 // 5 press inside = selecting: pointer leaving must NOT close
 ev(pop().querySelector("#dc-fm-body"),"pointerdown"); ev(pop(),"pointerleave"); ev(cells.r1,"pointerout"); await sleep(700);
 ok("mid-selection (button held) with pointer outside: stays open",vis());
 ev(document.body,"pointerup"); await sleep(450); ok("after release outside: closes",!vis());
 // 6 Esc closes
 ev(cells.r1,"pointerover"); ok("reopen",vis()); document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); ok("Esc closes immediately",!vis());
 // 7 outside click closes; click on own cell does not
 ev(cells.r1,"pointerover"); ev(cells.r1,"pointerdown"); ok("press on the same cell: stays open",vis());
 ev(document.body,"pointerdown"); ok("press outside: closes",!vis());
 // 8 toggle off hides
 ev(cells.r1,"pointerover"); window.__dcToggleDsFormula(); ok("toggle off: hides",!vis()); ev(cells.r1,"pointerover"); ok("toggled off: hover does nothing",!vis());
 // 9 re-toggle on works
 window.__dcToggleDsFormula(); ev(cells.r1,"pointerover"); ok("toggle back on: works",vis());
 document.getElementById("out").textContent=R.join("\\n");
})();
</script>`;
const srv = http.createServer((q, s) => { s.setHeader("content-type", "text/html"); s.end(html); }).listen(0, async () => {
  const port = srv.address().port, dbg = 9400 + Math.floor(Math.random() * 400);
  const prof = fs.mkdtempSync("/tmp/chr-fm-");
  const ch = cp.spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--remote-debugging-port=" + dbg, "--user-data-dir=" + prof, "about:blank"], { stdio: "ignore" });
  let _send = null; setTimeout(async () => { let part = ""; try { const r = await Promise.race([_send("Runtime.evaluate", { expression: "(window.R||[]).join(String.fromCharCode(10))", returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error("page main thread unresponsive (likely infinite loop)")), 3000))]); part = r.result.result.value; } catch (e) { part = "(could not read: " + e.message + ")"; } console.log("FAIL: hard timeout. Partial results:\n" + part); try { ch.kill(); } catch (e) {} process.exit(1); }, 45000);
  const done = (code, msg) => { if (msg) console.log(msg); try { ch.kill(); } catch (e) {} srv.close(); process.exit(code); };
  try {
    let tgt = null;
    for (let i = 0; i < 40 && !tgt; i++) { await new Promise(r => setTimeout(r, 250)); try { const t = await (await fetch("http://127.0.0.1:" + dbg + "/json/list")).json(); tgt = t.find(x => x.type === "page"); } catch (e) {} }
    if (!tgt) return done(1, "FAIL: Chrome did not start");
    const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
    let id = 0; const pend = {};
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; } };
    const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    _send = send; await send("Page.enable"); await send("Runtime.enable");
    const errs = []; const _om = ws.onmessage;
    ws.onmessage = m => { _om(m); const d = JSON.parse(m.data); if (d.method === "Runtime.exceptionThrown") errs.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text).slice(0, 300)); };
    await send("Page.navigate", { url: "http://127.0.0.1:" + port + "/lightning/r/DataStream/1234567890abcde/view" });
    let txt = "";
    for (let i = 0; i < 40 && !txt; i++) { await new Promise(r => setTimeout(r, 250)); const r = await send("Runtime.evaluate", { expression: "(document.getElementById('out')||{}).textContent||''", returnByValue: true }); txt = (r.result && r.result.result && r.result.result.value) || ""; }
    if (!txt) return done(1, "FAIL: harness produced no results" + (errs.length ? "\n  page errors: " + errs.join(" | ") : ""));
    const lines = txt.split("\n").filter(Boolean);
    lines.forEach(l => console.log("  " + (l.startsWith("PASS") ? "✓ " : "✗ ") + l.slice(5)));
    const f = lines.filter(l => l.startsWith("FAIL")).length;
    done(f ? 1 : 0, f ? "\n❌ FAILURES: " + (lines.length - f) + " passed, " + f + " failed" : "\n✅ ALL PASS: " + lines.length + " passed, 0 failed");
  } catch (e) { done(1, "FAIL: " + e.message); }
});
