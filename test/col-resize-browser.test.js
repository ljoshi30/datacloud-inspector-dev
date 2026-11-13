// Real-Chrome test (run manually): drag-resize of table columns via dcMakeColsResizable.
const fs=require("fs"),http=require("http"),cp=require("child_process"),assert=require("assert");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const code=src.slice(src.indexOf("  function dcMakeColsResizable"),src.indexOf("  // Formatted Excel (.xlsx) of the loaded rows:"));
const html="<!doctype html><meta charset=utf-8><body><div id=w><table style='width:100%;border-collapse:collapse'><thead><tr><th>Alpha</th><th>Beta</th><th>Gamma</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table></div><script>"+code+";dcMakeColsResizable(document.getElementById('w'));</script>";
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async()=>{
 const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html");s.end(html);});await new Promise(r=>srv.listen(0,r));
 const dbg=9950+Math.floor(Math.random()*40),prof=fs.mkdtempSync("/tmp/chr-sm-");
 const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"about:blank"],{stdio:"ignore"});
 let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,200));try{tgt=(await(await fetch("http://127.0.0.1:"+dbg+"/json")).json()).find(t=>t.type==="page");}catch(e){}}
 const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id];}};
 const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
 await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/"});await new Promise(r=>setTimeout(r,400));
 const ev=async e=>(await send("Runtime.evaluate",{expression:e,returnByValue:true})).result.result.value;
 let n=0;const ok=(c,m)=>{assert(c,m);n++;};
 ok(await ev("document.querySelectorAll('.dc-col-grip').length")===3,"grip on every header");
 const w0=await ev("document.querySelectorAll('th')[1].getBoundingClientRect().width");
 const gx=await ev("(function(){var r=document.querySelectorAll('.dc-col-grip')[1].getBoundingClientRect();return r.left+r.width/2})()");
 const gy=await ev("(function(){var r=document.querySelectorAll('.dc-col-grip')[1].getBoundingClientRect();return r.top+r.height/2})()");
 await send("Input.dispatchMouseEvent",{type:"mousePressed",x:gx,y:gy,button:"left",clickCount:1});
 await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:gx+120,y:gy,button:"left"});
 await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:gx+120,y:gy,button:"left",clickCount:1});
 const w1=await ev("document.querySelectorAll('th')[1].getBoundingClientRect().width");
 ok(Math.abs(w1-(w0+120))<3,"column widened by drag ("+w0+"→"+w1+")");
 ok(await ev("document.querySelector('table').style.tableLayout")==="fixed","fixed layout after first drag");
 const gx2=await ev("(function(){var r=document.querySelectorAll('.dc-col-grip')[1].getBoundingClientRect();return r.left+r.width/2})()");
 await send("Input.dispatchMouseEvent",{type:"mousePressed",x:gx2,y:gy,button:"left",clickCount:1});
 await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:gx2-60,y:gy,button:"left"});
 await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:gx2-60,y:gy,button:"left",clickCount:1});
 const w2=await ev("document.querySelectorAll('th')[1].getBoundingClientRect().width");
 ok(Math.abs(w2-(w1-60))<3,"column narrowed by drag");
 await ev("document.querySelectorAll('.dc-col-grip')[1].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
 ok(await ev("document.querySelector('table').style.tableLayout")==="","double-click restores auto-fit");
 console.log("col-resize-browser: "+n+" checks passed");
 ch.kill();srv.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
