// Real-Chrome behavior test of the REAL makeDraggable (extracted from source) using real mouse input.
const fs=require("fs"),http=require("http"),cp=require("child_process"),path=require("path");
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if(!fs.existsSync(CHROME)){console.log("SKIP: no Chrome");process.exit(0)}
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
const a=src.indexOf("  function makeDraggable(el, handle) {"),b=src.indexOf("  function addResizeHandle(");
const fn=src.slice(a,b);
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n+(c||!x?"":"  -> "+x))};
(async()=>{
const html=`<!doctype html><body style="margin:0"><div id=p style="position:fixed;left:100px;top:100px;width:600px;height:300px;background:#eee">
<div id=h style="display:flex;gap:8px;padding:10px;background:#cde"><div id=t style="flex:1;user-select:text;cursor:move">Title text here <span id=sub class=dc-ac-sub>sub info</span></div><input id=i style="width:60px"><button id=b>Btn</button></div></div>
<script>${fn};makeDraggable(document.getElementById('p'),document.getElementById('h'));</script>`;
const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html");s.end(html)});await new Promise(r=>srv.listen(0,r));
const dbg=9800+Math.floor(Math.random()*150),prof=fs.mkdtempSync("/tmp/chr-sm-");
const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"about:blank"],{stdio:"ignore"});
let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,250));try{tgt=(await (await fetch("http://127.0.0.1:"+dbg+"/json/list")).json()).find(t=>t.type==="page")}catch(e){}}
const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id]}};
const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async e=>(await send("Runtime.evaluate",{expression:e,returnByValue:true})).result.result.value;
await send("Page.enable");await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/"});await new Promise(r=>setTimeout(r,800));
const pos=()=>ev("(()=>{const r=document.getElementById('p').getBoundingClientRect();return r.left+','+r.top})()");
const center=async sel=>JSON.parse(await ev(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return JSON.stringify([r.left+r.width/2,r.top+r.height/2])})()`));
const mouse=(type,x,y,extra)=>send("Input.dispatchMouseEvent",Object.assign({type,x,y,button:"left",buttons:type==="mouseReleased"?0:1,clickCount:1},extra||{}));
async function drag(x,y,dx,dy){await mouse("mouseMoved",x,y);await mouse("mousePressed",x,y);for(let i=1;i<=6;i++)await mouse("mouseMoved",x+dx*i/6,y+dy*i/6);await mouse("mouseReleased",x+dx,y+dy)}
const num=s=>s.split(",").map(Number);
let p0=num(await pos());
// 1 drag from empty header padding
let [x,y]=[130,104];await drag(x,y,80,50);let p1=num(await pos());
ok("drag from header padding moves panel",Math.abs(p1[0]-p0[0]-80)<2&&Math.abs(p1[1]-p0[1]-50)<2,p0+" -> "+p1);
// 2 drag starting ON title text (previously blocked)
[x,y]=await center("#t");let q0=p1;await drag(x-60,y,-40,30);let p2=num(await pos());
ok("drag from title text moves panel",Math.abs(p2[0]-q0[0]+40)<2&&Math.abs(p2[1]-q0[1]-30)<2,q0+" -> "+p2);
// 3 drag from sub info text
[x,y]=await center("#sub");let q1=p2;await drag(x,y,30,20);let p3=num(await pos());
ok("drag from sub-info text moves panel",Math.abs(p3[0]-q1[0]-30)<2&&Math.abs(p3[1]-q1[1]-20)<2,q1+" -> "+p3);
// 4 plain click on title does NOT move
[x,y]=await center("#t");await mouse("mouseMoved",x-60,y);await mouse("mousePressed",x-60,y);await mouse("mouseReleased",x-60,y);let p4=num(await pos());
ok("plain click does not move panel",p4[0]===p3[0]&&p4[1]===p3[1]);
// 5 dragging from a button / input does NOT move panel
[x,y]=await center("#b");let q2=p4;await drag(x,y,60,40);let p5=num(await pos());
ok("drag starting on button does not move panel",p5[0]===q2[0]&&p5[1]===q2[1],q2+" -> "+p5);
[x,y]=await center("#i");await drag(x,y,60,40);let p6=num(await pos());
ok("drag starting on input does not move panel",p6[0]===q2[0]&&p6[1]===q2[1]);
// 6 clamped on screen
[x,y]=await center("#h");await drag(x,y,-5000,-5000);let p7=num(await pos());
ok("panel stays on screen (clamped)",p7[0]>=4&&p7[1]>=4,p7+"");
// 7 text selection not left behind / page user-select restored
ok("page text selection restored after drag",(await ev("document.documentElement.style.userSelect"))==="");
console.log(fail?"\n❌ "+fail+" failed, "+pass+" passed":"\n✅ ALL PASS: "+pass);
ch.kill();srv.close();process.exit(fail?1:0)})();
