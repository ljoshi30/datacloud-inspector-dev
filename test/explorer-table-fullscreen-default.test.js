// BEHAVIOR test: the Explorer result table opens full screen by default, and Esc/⛶ still restore it.
// Runs the REAL setFullScreen body from the source against a stub panel (style map with important flags).
const fs=require("fs"),path=require("path");
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
let n=0;const ok=(c,m)=>{n++;if(!c){console.error("FAIL: "+m);process.exit(1)}};
const a=src.indexOf("    var _fsOn = false, _fsSaved = null;"),b=src.indexOf("    fsBtn.onclick = function () { setFullScreen(!_fsOn); };",a);
ok(a>0&&b>a,"setFullScreen found");
const mkStyle=init=>{const m={...init},pr={};return{m,pr,getPropertyValue:k=>m[k]||"",getPropertyPriority:k=>pr[k]||"",setProperty(k,v,p){m[k]=v;pr[k]=p||""},removeProperty(k){delete m[k];delete pr[k]}}};
const panel={style:mkStyle({left:"50%",top:"5vh",width:"min(1400px,96vw)",height:"min(86vh,900px)",transform:"translateX(-50%)","border-radius":"12px"})};
const fsBtn={textContent:"⛶",title:""};
const api=new Function("panel","fsBtn",src.slice(a,b)+"; return {on:function(){setFullScreen(true)},off:function(){setFullScreen(false)},st:function(){return _fsOn}};")(panel,fsBtn);
api.on();
ok(panel.style.m.width==="100vw"&&panel.style.m.height==="100vh"&&panel.style.m.left==="0","fills the window");
ok(panel.style.pr.width==="important","uses !important (beats the panel's own inline sizes)");
ok(fsBtn.textContent==="🗗","button flips to the restore icon");
api.off();
ok(panel.style.m.width==="min(1400px,96vw)"&&panel.style.m.height==="min(86vh,900px)"&&panel.style.m.left==="50%","restore returns the exact previous size/position");
ok(fsBtn.textContent==="⛶","button flips back");
// wiring: NOT auto-fullscreen (it covered Salesforce's own page + column headers)
const f0=src.indexOf("  function showAllColumnsTable("),f1=src.indexOf("document.body.appendChild(panel);",f0);
ok(f1>f0&&!/document\.body\.appendChild\(panel\);\s*(\/\/[^\n]*\n\s*)*try \{ setFullScreen\(true\); \} catch/.test(src.slice(f1,f1+400)),"table opens at its NORMAL size (not forced full screen); the \u26F6 button still toggles");
console.log("explorer-table-fullscreen-default: "+n+" checks passed");
