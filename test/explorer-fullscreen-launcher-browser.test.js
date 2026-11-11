// Real-Chrome behavior test of (1) the REAL Data Explorer full-screen code, (2) the REAL __dcPaintOn launcher fix.
const fs=require("fs"),http=require("http"),cp=require("child_process"),path=require("path");
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if(!fs.existsSync(CHROME)){console.log("SKIP: no Chrome");process.exit(0)}
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
const a=src.indexOf("    const fsBtn = document.createElement"),b=src.indexOf("    hdr.appendChild(sqlBtn); hdr.appendChild(csvBtn); hdr.appendChild(exportAllBtn); hdr.appendChild(fsBtn)");
const fsCode=src.slice(a,b);
const pa=src.indexOf("  window.__dcPaintOn = function"),pb=src.indexOf("  // ── \"Open in new tab\"",pa);
const paint=src.slice(pa,pb);
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n+(c||!x?"":"  -> "+x))};
(async()=>{
const html=`<!doctype html><body style="margin:0;background:#fff"><button id=row style="background:#111827"><span>API names</span><span>sub</span></button>
<div id=panel style="position:fixed;top:5vh;left:50%;transform:translateX(-50%);width:min(1400px,96vw);height:min(86vh,900px);border-radius:12px;background:#eee"></div>
<script>const panel=document.getElementById('panel');const hdr=document.createElement('div');panel.appendChild(hdr);
const sqlBtn=document.createElement('b'),csvBtn=document.createElement('b'),exportAllBtn=document.createElement('b'),closeBtn=document.createElement('b');
${fsCode}
hdr.appendChild(fsBtn);window.__fs=fsBtn;
${paint}
</script>`;
const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html");s.end(html)});await new Promise(r=>srv.listen(0,r));
const dbg=9950+Math.floor(Math.random()*40),prof=fs.mkdtempSync("/tmp/chr-sm-");
const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--window-size=1300,800","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"about:blank"],{stdio:"ignore"});
let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,250));try{tgt=(await (await fetch("http://127.0.0.1:"+dbg+"/json/list")).json()).find(t=>t.type==="page")}catch(e){}}
const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async e=>(await send("Runtime.evaluate",{expression:e,returnByValue:true})).result.result.value;
await send("Page.enable");await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/"});await new Promise(r=>setTimeout(r,800));
const rect=()=>ev("(()=>{const r=document.getElementById('panel').getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round).join(',')})()");
const vp=await ev("innerWidth+','+innerHeight");const r0=await rect();
await ev("__fs.click()");const r1=await rect();
ok("full screen fills the viewport ("+vp+")",r1===`0,0,${vp}`,r1);
ok("button switches to restore",(await ev("__fs.textContent"))!=="⛶");
await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");const r2=await rect();
ok("Esc restores the exact previous size/position",r2===r0,r0+" vs "+r2);
await ev("__fs.click()");await ev("__fs.click()");const r3=await rect();
ok("click toggle twice restores exactly",r3===r0,r3);
await ev("document.getElementById('panel').style.setProperty('left','200px','important');document.getElementById('panel').style.setProperty('top','50px','important');");
const rm=await rect();await ev("__fs.click()");await ev("__fs.click()");
ok("restores a user-moved position (after drag) too",(await rect())===rm,rm+" vs "+(await rect()));
ok("Esc when NOT full screen does nothing",await ev("(()=>{const b=document.getElementById('panel').style.width;document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return b===document.getElementById('panel').style.width})()"));
// launcher background
const col=()=>ev("getComputedStyle(document.getElementById('row')).backgroundColor");
await ev("__dcPaintOn(document.getElementById('row'),false)");
ok("OFF paint keeps dark launcher colour (was: white)",(await col())==="rgb(17, 24, 39)",await col());
await ev("__dcPaintOn(document.getElementById('row'),true)");
ok("ON paint = green tint",/52, 211, 153/.test(await col()),await col());
await ev("document.getElementById('row').dispatchEvent(new MouseEvent('mouseleave'))");
ok("ON tint survives mouse leave",/52, 211, 153/.test(await col()),await col());
await ev("__dcPaintOn(document.getElementById('row'),false);document.getElementById('row').dispatchEvent(new MouseEvent('mouseleave'))");
ok("back to OFF → dark again after mouse leave",(await col())==="rgb(17, 24, 39)",await col());
console.log(fail?"\n❌ "+fail+" failed, "+pass+" passed":"\n✅ ALL PASS: "+pass);
ch.kill();srv.close();process.exit(fail?1:0)})();
