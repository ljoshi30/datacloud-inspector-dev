// Real-Chrome behavior test: re-injection (race), host-page isolation, no stray globals/errors.
// Runs the PUBLIC bookmarklet.txt (and bookmarklet-gzip.txt if present) on a stub page.
const fs=require("fs"),http=require("http"),cp=require("child_process"),path=require("path");
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if(!fs.existsSync(CHROME)){console.log("SKIP: no Chrome");process.exit(0)}
const root=path.join(__dirname,"..");
const T=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(()=>r(null),ms))]);
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n+(c||!x?"":"  -> "+x))};
async function run(file){
  const bm=fs.readFileSync(path.join(root,file),"utf8").trim().replace(/^javascript:/,"");
  const expr=file.includes("gzip")?bm:decodeURIComponent(bm);
  const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html");s.end("<!doctype html><body><h1 id=host>host</h1><style>#host{color:red}</style>")});
  await new Promise(r=>srv.listen(0,r));
  const dbg=9600+Math.floor(Math.random()*150),prof=fs.mkdtempSync("/tmp/chr-sm-");
  const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--disable-features=CalculateNativeWinOcclusion","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"about:blank"],{stdio:"ignore"});
  let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,250));try{tgt=(await (await fetch("http://127.0.0.1:"+dbg+"/json/list")).json()).find(x=>x.type==="page")}catch(e){}}
  const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const pend={},errs=[];
  ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}if(d.method==="Runtime.exceptionThrown")errs.push((d.params.exceptionDetails.exception&&d.params.exceptionDetails.exception.description||d.params.exceptionDetails.text).slice(0,200))};
  const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
  const ev=async e=>{const r=await T(send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true}),15000);return r&&r.result&&r.result.result&&r.result.result.value};
  await send("Page.enable");await send("Runtime.enable");
  await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/lightning/r/DataStream/1234567890abcde/view"});
  await new Promise(r=>setTimeout(r,1200));
  const before=await ev("JSON.stringify(Object.getOwnPropertyNames(window))");
  const hostBefore=await ev("getComputedStyle(document.getElementById('host')).color+'|'+document.getElementById('host').outerHTML");
  const ids=()=>ev("JSON.stringify([...document.querySelectorAll('[id^=dc-]')].map(e=>e.id).sort())");
  const sty=()=>ev("document.querySelectorAll('style[id^=dc-],style[data-dc]').length");
  // run 1: inject
  await T(send("Runtime.evaluate",{expression:expr,awaitPromise:true}),20000);await new Promise(r=>setTimeout(r,2500));
  const ids1=await ids(),sty1=await sty();
  const hostMid=await ev("getComputedStyle(document.getElementById('host')).color+'|'+document.getElementById('host').outerHTML");
  const rawAfter=await ev("JSON.stringify(Object.getOwnPropertyNames(window))");
  const after=JSON.parse(rawAfter||"[]"),b=JSON.parse(before);
  const added=after.filter(k=>!b.includes(k));
  // re-click = toggle OFF: everything we added must go, host must be untouched
  await T(send("Runtime.evaluate",{expression:expr,awaitPromise:true}),20000);await new Promise(r=>setTimeout(r,800));
  const ids2=JSON.parse(await ids()||"null")||["HUNG"];
  const hostAfter=await ev("getComputedStyle(document.getElementById('host')).color+'|'+document.getElementById('host').outerHTML");
  console.log("\n== "+file);
  ok("injects UI (dc-* elements present)",JSON.parse(ids1).length>0,ids1);
  ok("host element markup + computed style untouched while active",hostBefore===hostMid,hostBefore+" / "+hostMid);
  ok("toggle OFF removes every dc-* element (only the off-toast may remain)",ids2.every(i=>i==="dc-off-toast"),ids2.join(","));
  ok("host untouched after toggle off",hostBefore===hostAfter,hostBefore+" / "+hostAfter);
  const stray=added.filter(k=>!/^__dc/i.test(k));ok("every new window global is __dc-namespaced (no collision with host page): "+added.length+" added",stray.length===0,"un-namespaced: "+stray.join(","));
  ok("no uncaught errors",errs.length===0,errs.join(" | "));
  try{ch.kill()}catch(e){};srv.close();
}
(async()=>{
  await run("bookmarklet.txt");
  if(fs.existsSync(path.join(root,"bookmarklet-gzip.txt")))await run("bookmarklet-gzip.txt");
  console.log(fail?"\n❌ "+pass+" passed, "+fail+" failed":"\n✅ ALL PASS: "+pass);process.exit(fail?1:0);
})();
