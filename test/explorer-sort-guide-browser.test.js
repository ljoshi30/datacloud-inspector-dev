// NOTE: whole run must stay under ~6s (headless Chrome in this harness stops responding after ~7s - a test-environment limit, not a code bug).
// Real-Chrome BEHAVIOR test of the Data Explorer "sort a column once" guide card.
// Runs the REAL source (eachElement, dcPickHeaderLabel, dcReadSortableHeaderLabels, dcBuildSortGuide) on a stub
// Salesforce-like table (incl. a header inside a shadow root). Stub page = not live Data 360.
const fs=require("fs"),http=require("http"),cp=require("child_process"),path=require("path");
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if(!fs.existsSync(CHROME)){console.log("SKIP: no Chrome");process.exit(0)}
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
const cut=(a,b,from)=>{const i=src.indexOf(a,from||0),j=src.indexOf(b,i);if(i<0||j<=i)throw new Error("marker missing: "+a);return src.slice(i,j)};
const trav=cut("  function eachElement(root, fn) {","  // Guards against Lightning's OLD-page");
const guide=cut("  function dcPickHeaderLabel(texts) {","  var _connectingInProgress = false;");
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n+(c||!x?"":"  -> "+x))};
(async()=>{
const html=`<!doctype html><body>
<div id=sfhost></div><div id=out></div>
<script>
var _auraSniff={querySeq:0,context:null,token:null};
function findRecordListEl(){return window.__rl||null}
${trav}
${guide}
// stub SF table: row-select header (empty) + a header inside a SHADOW root, like the real grid
const host=document.getElementById('sfhost');const sr=host.attachShadow({mode:'open'});
sr.innerHTML='<a class="slds-th__action" title=""></a><a class="slds-th__action" title="Select All"></a><a class="slds-th__action" title="Account Id  Sorted Ascending">x</a><a class="slds-th__action" title="Created Date">y</a>';
window.fired=[];window.ready=[];
window.mk=function(opts){const g=dcBuildSortGuide(Object.assign({actionLabel:"Show selected columns' data",onAction:()=>fired.push(1),onReady:()=>ready.push(1)},opts||{}));document.getElementById('out').appendChild(g);return g};
</script>`;
const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html");s.end(html)});await new Promise(r=>srv.listen(0,r));
const dbg=9900+Math.floor(Math.random()*40),prof=fs.mkdtempSync("/tmp/chr-sm-");
const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--window-size=900,700","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"about:blank"],{stdio:"ignore"});
let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,250));try{tgt=(await (await fetch("http://127.0.0.1:"+dbg+"/json/list")).json()).find(t=>t.type==="page")}catch(e){}}
const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async e=>{const r=(await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true})).result;if(r.exceptionDetails)return "EXC:"+JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description);return r.result.value};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await send("Page.enable");await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/"});await sleep(450);

// --- pure label picker
ok("skips empty/'Select All', strips 'Sorted Ascending'", await ev("dcPickHeaderLabel(['','Select All','Account Id  Sorted Ascending','Created'])")==="Account Id");
ok("skips over-long / junk, returns '' when nothing usable", await ev("dcPickHeaderLabel(['Actions','#','"+"x".repeat(60)+"'])")==="");
// --- waiting state
await ev("window.g1=mk()");
const t=await ev("document.querySelector('[data-dc-sort-guide]').innerText");
ok("shows a real header name from the table (shadow DOM) in the card", /Account Id/.test(t), t);
ok("does not show the junk 'Select All' header as the example", !/click the Select All/i.test(t));
ok("explains WHY", /Why\?/.test(t) && /read-only/.test(t) && /Salesforce has run one query/.test(t), t);
ok("says it will notice automatically", /notices it automatically/.test(t));
ok("attention colour (amber border)", await ev("getComputedStyle(document.querySelector('[data-dc-sort-guide] > div')).borderLeftColor")==="rgb(245, 158, 11)");
ok("no action button while waiting", await ev("!document.querySelector('.dc-guide-go')"));
await sleep(450);
ok("still waiting after 0.9s with no sort (no false 'ready')", await ev("!document.querySelector('.dc-guide-go') && ready.length===0"));
// --- user sorts: sniffer sees the page's own query
await ev("_auraSniff.querySeq++");await sleep(420);
const t2=await ev("document.querySelector('[data-dc-sort-guide]').innerText");
ok("turns green and reveals the button once the sort is detected", /Sort detected/.test(t2) && await ev("!!document.querySelector('.dc-guide-go')"), t2);
ok("green colour", await ev("getComputedStyle(document.querySelector('[data-dc-sort-guide] > div')).borderLeftColor")==="rgb(22, 163, 74)");
ok("onReady fired exactly once", await ev("ready.length")===1);
ok("button label is the real action", (await ev("document.querySelector('.dc-guide-go').textContent"))==="Show selected columns' data");
await ev("document.querySelector('.dc-guide-go').click()");
ok("clicking the button runs the action once and removes the card", await ev("fired.length")===1 && await ev("!document.querySelector('[data-dc-sort-guide]')"));
// --- session mode: ready by isReady() (credentials captured) instead of querySeq
await ev("window.fired=[];window.ready=[];window.sess=false;window.g2=mk({isReady:()=>sess})");await sleep(420);
ok("session mode waits until isReady()", await ev("!document.querySelector('.dc-guide-go')"));
await ev("sess=true");await sleep(420);
ok("session mode becomes ready when isReady() turns true", !!(await ev("document.querySelector('.dc-guide-go')")));
await ev("document.getElementById('out').innerHTML=''");
// --- a query that happened BEFORE the card appeared must not count
await ev("window.ready=[];_auraSniff.querySeq=5;window.g3=mk()");await sleep(420);
ok("an older query (before the card) does not trigger ready", await ev("ready.length===0 && !document.querySelector('.dc-guide-go')"));
// --- panel closed: stops watching, never fires onReady
await ev("document.getElementById('out').innerHTML='';window.ready=[]");
await ev("window.g4=mk();");await sleep(350);
await ev("document.getElementById('out').innerHTML=''");await sleep(420);
await ev("_auraSniff.querySeq++");await sleep(420);
ok("closing the panel stops the watcher (no late onReady)", await ev("ready.length")===0);
// --- no headers anywhere -> generic wording, no broken chip
await ev("document.getElementById('sfhost').remove();document.getElementById('out').innerHTML=''");
await ev("window.g5=mk()");
const t5=await ev("document.querySelector('[data-dc-sort-guide]').innerText");
ok("no header found -> says 'any column'", /any column/.test(t5), t5);
// --- label is escaped
await ev("window.__rl={columns:[{fieldName:'a',label:'<img src=x onerror=window.__pwn=1>'}]};document.getElementById('out').innerHTML='';mk()");await sleep(200);
ok("header text is HTML-escaped (no injection)", await ev("!window.__pwn && !document.querySelector('[data-dc-sort-guide] img')"));
console.log(fail?"\n❌ "+fail+" failed, "+pass+" passed":"\n✅ ALL PASS: "+pass);
ch.kill();srv.close();process.exit(fail?1:0)})();
