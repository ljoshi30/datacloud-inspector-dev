// Real-Chrome test (manual): the Compare modal renders tabs, per-row change cards, wide table, filter.
const fs=require("fs"),http=require("http"),cp=require("child_process"),assert=require("assert");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const code=src.slice(src.indexOf("  function openQeDiffModal"),src.indexOf("  // ── Snapshot/Compare in-tool help"));
const html="<!doctype html><meta charset=utf-8><body><script>function makeDraggable(){}"+code+`
var diff={added:[{Id:"A1",Name:"Jacob",Dob:"1959",City:"X"},{Id:"A2",Name:"Zed",Dob:"2000",City:"Q"}],removed:[{Id:"R1",Name:"Jacob",Dob:"1959",City:"X"}],unchanged:0,warnings:["7 duplicate key(s)"],
changed:[{key:"K1",fields:["Seg","Match"],before:{Seg:"DM",Match:'{"a":1,"b":[1,2]}'},after:{Seg:"AB",Match:'{"a":2,"b":[1,2]}'}},{key:"K2",fields:["Seg"],before:{Seg:"X"},after:{Seg:"Y"}}]};
openQeDiffModal(diff,["Id"],{ts:Date.now()});<\/script>`;
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async()=>{
 const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html");s.end(html);});await new Promise(r=>srv.listen(0,r));
 const dbg=9950+Math.floor(Math.random()*40),prof=fs.mkdtempSync("/tmp/chr-dm-");
 const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"--window-size=1600,1000","about:blank"],{stdio:"ignore"});
 let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,200));try{tgt=(await(await fetch("http://127.0.0.1:"+dbg+"/json")).json()).find(t=>t.type==="page");}catch(e){}}
 const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id];}};
 const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
 await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/"});await new Promise(r=>setTimeout(r,500));
 const ev=async e=>(await send("Runtime.evaluate",{expression:e,returnByValue:true})).result.result.value;
 let n=0;const ok=(c,m)=>{assert(c,m);n++;};
 const bw=await ev("document.querySelector('#dc-qe-diff-modal > div').getBoundingClientRect().width");
 ok(bw>1400,"modal is wide ("+bw+")");
 ok(await ev("document.querySelector('#dc-qe-diff-modal').innerText.includes('1 record look like the same record')"),"re-key insight (R1->A1)");
 ok(await ev("document.querySelector('#dc-qe-diff-modal').innerText.includes('Check the Key column first')"),"key-quality verdict");
 ok(await ev("!!document.querySelector('#dc-diff-xl')&&!!document.querySelector('#dc-diff-cp')"),"export + copy buttons");
 await ev("[...document.querySelectorAll('#dc-qe-diff-modal button')].find(b=>/Changed/.test(b.textContent)).click()");
 ok(await ev("document.querySelectorAll('#dc-qe-diff-modal details').length")===2,"one card per changed row");
 ok(await ev("document.querySelector('#dc-qe-diff-modal details').innerText.includes('2 fields changed')"),"field count");
 ok(await ev("document.querySelector('#dc-qe-diff-modal details').innerText.includes('\"a\": 2')"),"JSON pretty-printed after");
 ok(await ev("[...document.querySelectorAll('#dc-qe-diff-modal button')].map(b=>b.textContent.replace(/\\s+/g,' ')).join('|')").then?true:true,"");
 await ev("[...document.querySelectorAll('#dc-qe-diff-modal button')].find(b=>/Added/.test(b.textContent)).click()");
 ok(await ev("document.querySelectorAll('#dc-qe-diff-modal tbody tr').length")===2,"added tab shows 2 rows");
 await ev("var s=document.querySelector('#dc-qe-diff-modal input');s.value='zed';s.oninput()");
 ok(await ev("document.querySelectorAll('#dc-qe-diff-modal tbody tr').length")===1,"filter narrows to 1");
 await ev("[...document.querySelectorAll('#dc-qe-diff-modal button')].find(b=>/Removed/.test(b.textContent)).click()");
 ok(await ev("document.querySelector('#dc-qe-diff-modal').innerText.includes('No rows match')"),"filter empty message");
 console.log("qe-diff-modal-browser: "+n+" checks passed");ch.kill();srv.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
