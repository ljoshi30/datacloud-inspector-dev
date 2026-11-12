// NOTE: whole run must stay under ~6s (headless Chrome in this harness stops responding after ~7s - a test-environment limit, not a code bug).
// Real-Chrome BEHAVIOR test of the Data Explorer "sort a column once" guide card.
// Runs the REAL source (eachElement, dcPickHeaderLabel, dcFindVisibleHeader, dcBuildSortGuide) on a stub
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
var exploreModalEl=null;
${trav}
${guide}
// stub SF table inside a SHADOW root: offscreen header, empty, 'Select All', then real ones
const host=document.getElementById('sfhost');host.style.cssText='position:absolute;left:20px;top:80px';const sr=host.attachShadow({mode:'open'});
sr.innerHTML='<style>a{display:inline-block;width:140px;height:30px}</style><a class="slds-th__action" title="Offscreen Col" style="position:fixed;left:-900px;top:80px"></a><a class="slds-th__action" title=""></a><a class="slds-th__action" title="Select All">s</a><a id=a1 class="slds-th__action" title="Account Id  Sorted Ascending">x</a><a id=a2 class="slds-th__action" title="Created Date">y</a>';
window.ready=[];
window.mkBtn=function(){const b=document.createElement('button');b.id='main';b.textContent="Show selected columns' data";b.title='orig tip';document.getElementById('out').appendChild(b);return b};
window.mk=function(opts){const g=dcBuildSortGuide(Object.assign({onReady:()=>ready.push(1)},opts||{}));document.getElementById('out').appendChild(g);return g};
</script>`;
const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html; charset=utf-8");s.end(html)});await new Promise(r=>srv.listen(0,r));
const dbg=9900+Math.floor(Math.random()*40),prof=fs.mkdtempSync("/tmp/chr-sm-");
const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--window-size=900,700","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"about:blank"],{stdio:"ignore"});
let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,250));try{tgt=(await (await fetch("http://127.0.0.1:"+dbg+"/json/list")).json()).find(t=>t.type==="page")}catch(e){}}
const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async e=>{const r=(await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true})).result;if(r.exceptionDetails)return "EXC:"+JSON.stringify(r.exceptionDetails.exception&&r.exceptionDetails.exception.description);return r.result.value};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await send("Page.enable");await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/"});await sleep(450);


const T=()=>ev("document.querySelector('[data-dc-sort-guide]').innerText");
const spots=()=>ev("document.querySelectorAll('[data-dc-guide-spot]').length");
// --- pure label picker
ok("skips empty/'Select All', strips 'Sorted Ascending'", await ev("dcPickHeaderLabel(['','Select All','Account Id  Sorted Ascending','Created'])")==="Account Id");
ok("returns '' when nothing usable", await ev("dcPickHeaderLabel(['Actions','#','"+"x".repeat(60)+"'])")==="");
// --- the named column is REAL: visible, in viewport, not under the panel
ok("picks a header that is visible (skips offscreen/empty/Select All)", await ev("dcFindVisibleHeader().label")==="Account Id");
await ev("window.pn=document.createElement('div');pn.style.cssText='position:fixed;left:290px;top:60px;width:100px;height:200px';document.body.appendChild(pn);exploreModalEl=pn");
ok("a header hidden under our panel is skipped -> next visible one", await ev("dcFindVisibleHeader().label")==="Created Date");
await ev("pn.remove();exploreModalEl=null");
// --- waiting state
await ev("window.btn=mkBtn();window.g1=mk({lockBtn:btn})");await sleep(150);
const t=await T();
ok("card names the real visible column", /Click\s+Account Id\s+to unlock/.test(t), t);
ok("explains why, read-only", /runs a query itself/.test(t)&&/sorting a column makes it run one/.test(t)&&/Read-only/.test(t), t);
ok("stepper present", /Click header/.test(t)&&/Salesforce loads/.test(t)&&/Button unlocks/.test(t));
ok("attention colour (amber)", await ev("getComputedStyle(document.querySelector('[data-dc-sort-guide] > div')).borderLeftColor")==="rgb(245, 158, 11)");
ok("the card has NO button of its own (no duplicate)", await ev("document.querySelectorAll('[data-dc-sort-guide] button').length")===0);
ok("original button is locked with a lock and a tooltip", await ev("btn.disabled")===true && /^🔒/.test(await ev("btn.textContent")) && /unlocks by itself/.test(await ev("btn.title")));
ok("spotlight ring + tag exist (2 overlays)", await spots()===2);
const geo=await ev("(()=>{const a=document.getElementById('sfhost').shadowRoot.getElementById('a1').getBoundingClientRect(),r=document.querySelector('[data-dc-guide-spot]').getBoundingClientRect();return Math.abs(r.left-(a.left-3))<2&&Math.abs(r.top-(a.top-3))<2&&Math.abs(r.width-(a.width+6))<2})()");
ok("ring sits exactly on that header", geo===true);
ok("ring does not block clicks (pointer-events:none)", await ev("getComputedStyle(document.querySelector('[data-dc-guide-spot]')).pointerEvents")==="none");
await sleep(450);
ok("no false 'ready' with no sort", await ev("ready.length===0 && btn.disabled===true"));
// --- user clicks the header -> stepper advances immediately, ring removed
await ev("document.getElementById('sfhost').shadowRoot.getElementById('a1').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}))");await sleep(60);
const tc=await T();
ok("clicking the header advances to 'Salesforce is loading'", /loading/i.test(tc), tc);
ok("ring removed after the click", await spots()===0);
ok("button still locked until Salesforce's query is seen", await ev("btn.disabled")===true);
// --- Salesforce's own query lands
await ev("_auraSniff.querySeq++");await sleep(420);
const t2=await T();
ok("turns green: Connected, press the button below", /Connected/.test(t2)&&/Press the button below/i.test(t2), t2);
ok("green colour", await ev("getComputedStyle(document.querySelector('[data-dc-sort-guide] > div')).borderLeftColor")==="rgb(22, 163, 74)");
ok("still no second button in the card", await ev("document.querySelectorAll('[data-dc-sort-guide] button').length")===0);
ok("original button UNLOCKED with its original text, tooltip and a pulse", await ev("btn.disabled")===false && (await ev("btn.textContent"))==="Show selected columns' data" && (await ev("btn.title"))==="orig tip" && /dc-guide-bpulse/.test(await ev("btn.style.animation")));
ok("onReady fired exactly once", await ev("ready.length")===1);
// --- session mode: ready by isReady()
await ev("document.getElementById('out').innerHTML='';window.ready=[];window.sess=false;window.btn=mkBtn();window.g2=mk({lockBtn:btn,isReady:()=>sess})");await sleep(420);
ok("session mode waits (button locked)", await ev("btn.disabled")===true);
await ev("sess=true");await sleep(420);
ok("session mode unlocks when isReady()", await ev("btn.disabled")===false && await ev("ready.length")===1);
// --- earlier query must not count
await ev("document.getElementById('out').innerHTML='';window.ready=[];_auraSniff.querySeq=5;window.btn=mkBtn();window.g3=mk({lockBtn:btn})");await sleep(420);
ok("a query from before the card does not unlock", await ev("btn.disabled")===true && await ev("ready.length")===0);
// --- dcStop restores everything (no leaked lock / overlay) -- used when guide is replaced
await ev("g3.dcStop()");
ok("dcStop restores the button and removes overlays", await ev("btn.disabled")===false && (await ev("btn.textContent"))==="Show selected columns' data" && (await spots())===0);
// --- panel closed: watcher stops, button released, ring removed, no late onReady
await ev("document.getElementById('out').innerHTML='';window.ready=[];window.btn=mkBtn();window.g4=mk({lockBtn:btn})");await sleep(350);
await ev("g4.remove()");await sleep(450);
ok("closing the panel releases the button and ring", await ev("btn.disabled")===false && (await spots())===0);
await ev("_auraSniff.querySeq++");await sleep(420);
ok("no late onReady after close", await ev("ready.length")===0);
// --- no visible header -> generic wording, no ring
await ev("document.getElementById('sfhost').remove();document.getElementById('out').innerHTML='';window.btn=mkBtn();window.g5=mk({lockBtn:btn})");await sleep(150);
const t5=await T();
ok("no header found -> 'any column header', no ring", /any column header/.test(t5) && (await spots())===0, t5);
console.log(fail?"\n❌ "+fail+" failed, "+pass+" passed":"\n✅ ALL PASS: "+pass);
ch.kill();srv.close();process.exit(fail?1:0)})();
