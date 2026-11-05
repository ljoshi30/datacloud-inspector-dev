// Real-Chrome: clicking the FAB launcher must fire ONE usage ping, tagged with the right build
// (public bookmarklet => "public", full/dev => "dev"), page-type only, throttled once/feature/day,
// and NOT fire when the user opted out.
const fs=require("fs"),http=require("http"),cp=require("child_process"),path=require("path");
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if(!fs.existsSync(CHROME)){console.log("SKIP: no Chrome");process.exit(0)}
const root=path.join(__dirname,"..");
const T=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(()=>r(null),ms))]);
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n+(c||!x?"":"  -> "+x))};
const HOOK=`window.__pings=[];var _f=window.fetch;window.fetch=function(u,o){try{window.__pings.push({k:"fetch",u:String(u&&u.url||u),b:String(o&&o.body||"")})}catch(e){}return Promise.resolve(new Response("{}",{status:200}))};var _o=window.open;window.open=function(u){window.__pings.push({k:"open",u:String(u),b:""});return null};var _sb=navigator.sendBeacon;navigator.sendBeacon=function(u,b){window.__pings.push({k:"beacon",u:String(u),b:String(b)});return true};var _x=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(b){window.__pings.push({k:"xhr",u:"",b:String(b)});};`;
async function run(file,optOut){
  const bm=fs.readFileSync(path.join(root,file),"utf8").trim().replace(/^javascript:/,"");
  const expr=decodeURIComponent(bm);
  const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html");s.end("<!doctype html><body><h1>x</h1>")});
  await new Promise(r=>srv.listen(0,r));
  const dbg=9300+Math.floor(Math.random()*150),prof=fs.mkdtempSync("/tmp/chr-sm-");
  const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","--disable-features=CalculateNativeWinOcclusion","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"about:blank"],{stdio:"ignore"});
  let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,250));try{tgt=(await (await fetch("http://127.0.0.1:"+dbg+"/json/list")).json()).find(x=>x.type==="page")}catch(e){}}
  const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
  const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
  const ev=async e=>{const r=await T(send("Runtime.evaluate",{expression:e,returnByValue:true}),8000);return r&&r.result&&r.result.result&&r.result.result.value};
  await send("Page.enable");await send("Runtime.enable");await send("Page.bringToFront");
  await send("Page.addScriptToEvaluateOnNewDocument",{source:HOOK});
  await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/lightning/r/DataStream/1234567890abcde/view"});
  await new Promise(r=>setTimeout(r,500));
  if(optOut)await ev("localStorage.setItem('dc_usage_optout','1');typeof __dcUsageOptOut==='function'");
  await T(send("Runtime.evaluate",{expression:expr}),20000);await new Promise(r=>setTimeout(r,700));
  if(optOut)await ev("typeof window.__dcUsageOptOut==='function'&&window.__dcUsageOptOut()");
  const before=JSON.parse(await ev("JSON.stringify(window.__pings)")||"[]").length;
  const click="(function(){var f=document.getElementById('dc-fab');if(!f)return 'nofab';f.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));return 'clicked'})()";
  const c1=await ev(click);await new Promise(r=>setTimeout(r,500));
  const p1=JSON.parse(await ev("JSON.stringify(window.__pings)")||"[]");
  const c2=await ev('typeof __dcReportUsageOnFabOpen==="function"&&__dcReportUsageOnFabOpen()');await new Promise(r=>setTimeout(r,400));
  const raw2=await ev("JSON.stringify(window.__pings)");const hung=(raw2===null||raw2===undefined);console.log("  second read:",hung?"NULL (page did not answer)":"ok");const p2=JSON.parse(raw2||"[]");
  try{ch.kill()}catch(e){};srv.close();
  return {c1,before,p1,p2,hung};
}
(async()=>{
  for(const [file,want] of [["bookmarklet.txt","public"],["bookmarklet-full.txt","dev"]]){
    console.log("\n== "+file+" (expect build="+want+")");
    const r=await run(file,false);
    ok("FAB found + clicked",r.c1==="clicked",r.c1);
    ok("no ping fired before the click",r.before===0,r.before);
    const mine=r.p1.map(p=>p.u+" "+p.b).join(" | ");
    ok("click fires a ping",r.p1.length>=1,mine);
    ok("ping tagged build="+want,new RegExp('build["=:\\s]*'+want).test(mine)||new RegExp('"stringValue":\\s*"'+want+'"').test(mine)||mine.includes(want),mine.slice(0,300));
    ok("2nd FAB-open the same day does NOT ping again (throttle, same code path as the click)",!r.hung&&r.p2.length===r.p1.length,r.p1.length+" -> "+r.p2.length);
    ok("payload carries no field/object names (page-type only)",!/TDI_|__c|__dlm|__dll/.test(mine));
  }
  console.log("\n== opt-out");
  const o=await run("bookmarklet.txt",true);
  ok("opted-out user: click fires NO ping",o.p1.length===0,JSON.stringify(o.p1).slice(0,200));
  console.log(fail?"\n❌ "+pass+" passed, "+fail+" failed":"\n✅ ALL PASS: "+pass);process.exit(fail?1:0);
})();
