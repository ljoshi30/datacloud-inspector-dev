// NOTE: keep whole run < ~6s (headless Chrome in this harness stops responding after ~7s - env limit, not a code bug).
// Real-Chrome BEHAVIOR test of probe-tool/network-probe.js on a stub page (not live Data 360).
const fs=require("fs"),http=require("http"),cp=require("child_process"),path=require("path");
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if(!fs.existsSync(CHROME)){console.log("SKIP: no Chrome");process.exit(0)}
const probe=fs.readFileSync(path.join(__dirname,"..","probe-tool","network-probe.js"),"utf8");
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n+(c||!x?"":"  -> "+x))};
(async()=>{
const srv=http.createServer((q,s)=>{
  if(q.url.startsWith("/page")){s.setHeader("content-type","text/html; charset=utf-8");return s.end("<!doctype html><body><h1>x</h1>")}
  if(q.url.startsWith("/ssot/data-graphs/data/RT_Profile/abc")){s.setHeader("content-type","application/json");return s.end(JSON.stringify({data:[{json:"{\"Id__c\":\"CONT_1\"}"}],sid:"00Dxx0000000001!AQEAQabcdefghijklmnopqrstuvwxyz0123456789"}))}
  if(q.url.startsWith("/aura")){s.setHeader("content-type","application/json");return s.end('{"actions":[{"id":"1;a","state":"SUCCESS","returnValue":{"returnValue":{"rows":[1,2,3]}}}]}')}
  if(q.url.endsWith(".png")){return s.end("png")}
  s.end("ok")});
await new Promise(r=>srv.listen(0,r));const port=srv.address().port;
const dbg=9900+Math.floor(Math.random()*40),prof=fs.mkdtempSync("/tmp/chr-sm-");
const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"about:blank"],{stdio:"ignore"});
let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,250));try{tgt=(await (await fetch("http://127.0.0.1:"+dbg+"/json/list")).json()).find(t=>t.type==="page")}catch(e){}}
const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async e=>{const r=(await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true})).result;if(r.exceptionDetails)return "EXC:"+JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description);return r.result.value};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await send("Page.enable");await send("Page.navigate",{url:"http://127.0.0.1:"+port+"/page"});await sleep(400);
await ev("window.__nativeFetch = window.fetch.bind(window)");
await ev(probe);
ok("panel appears", await ev("!!document.querySelector('[data-dc-netprobe]')"));
ok("re-running does not double-install", (await ev(probe+";document.querySelectorAll('[data-dc-netprobe]').length"))===1);
// page behaviour must be unchanged
const body=await ev("window.__dcNetProbe.mark('B: toggled Real-time View ON'),fetch('/ssot/data-graphs/data/RT_Profile/abc?live=true',{headers:{Authorization:'Bearer 00Dxx0000000001!AQEAQabcdefghijklmnopqrstuvwxyz0123456789'}}).then(r=>r.json())");
ok("page's own fetch still gets its normal response (probe is transparent)", body&&body.data&&body.data[0].json.includes("CONT_1"), JSON.stringify(body));
// aura XHR with token in the form body
await ev("window.__dcNetProbe.mark('D: pressed Refresh'),new Promise(r=>{const x=new XMLHttpRequest();x.open('POST','/aura?r=1&aura.ApexAction.execute=1');x.onload=()=>r(x.responseText);x.send('message='+encodeURIComponent(JSON.stringify({actions:[{id:'1;a',descriptor:'aura://ApexActionController/ACTION$execute',params:{classname:'DataGraphCtl',method:'getJson',params:{recordId:'abc',live:true,noCache:false}}}]}))+'&aura.token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789tokenvalue')})");
await ev("fetch('/x.png').catch(()=>0)");await sleep(200);
const log=JSON.parse(await ev("JSON.stringify(window.__dcNetProbe.log)"));
const calls=log.filter(r=>r.kind!=="MARK"&&r.kind!=="perf");
ok("both calls recorded, static .png skipped", calls.length===2&&!log.some(r=>/\.png/.test(r.url||"")), JSON.stringify(calls.map(c=>c.url)));
const f=calls.find(c=>/ssot/.test(c.url)),a=calls.find(c=>/aura/.test(c.url));
ok("fetch call: url, method, status, flagged as data-graph related", f&&f.method==="GET"&&f.status===200&&f.flagged===true&&/live=true/.test(f.url));
ok("aura call: decoded the action descriptor + params (the thing we need)", a&&a.aura&&a.aura[0].descriptor==="aura://ApexActionController/ACTION$execute"&&/getJson/.test(a.aura[0].params)&&/noCache/.test(a.aura[0].params), JSON.stringify(a&&a.aura));
ok("aura response decoded (state + returnKeys)", a&&a.auraResp&&a.auraResp[0].state==="SUCCESS");
ok("each call carries the mark that was active when it ran", f.label==="B: toggled Real-time View ON"&&a.label==="D: pressed Refresh");
const all=JSON.stringify(log);
ok("session id in the response body is redacted", !/AQEAQabcdefghijklmnopqrstuvwxyz0123456789/.test(all));
ok("aura.token is redacted", !/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789tokenvalue/.test(all));
ok("count line updates", /2 hooked/.test(await ev("document.querySelector('[data-dc-netprobe]').innerText")));
// the Salesforce case: a fetch captured BEFORE the probe is installed (LWC/LWS) is invisible to hooks but must still be recorded
await ev("window.__dcNetProbe.mark('E: native-captured fetch')");
await ev("window.__nativeFetch(\'/ssot/data-graphs/data/RT_Profile/zzz?live=true&noCache=false\').then(r=>r.text())");await sleep(500);
const log2=JSON.parse(await ev("JSON.stringify(window.__dcNetProbe.log)"));
const perf=log2.filter(r=>r.kind==="perf"&&/RT_Profile\/zzz/.test(r.url));
ok("request made through a pre-captured fetch IS recorded (browser-level)", perf.length===1&&/live=true/.test(perf[0].url)&&/noCache=false/.test(perf[0].url)&&perf[0].label==="E: native-captured fetch", JSON.stringify(perf));
ok("output carries page context (top window / iframes)", (await ev("typeof window.__dcNetProbe.log"))==="object");
ok("MARK entries are in the log in order", log.filter(r=>r.kind==="MARK").length===2);
console.log(fail?"\n❌ "+fail+" failed, "+pass+" passed":"\n✅ ALL PASS: "+pass);
ch.kill();srv.close();process.exit(fail?1:0)})();
