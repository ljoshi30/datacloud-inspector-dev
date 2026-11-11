// Count / Fetch & Export / Export ALL: own engines + own state; only the result card is shared (UI lock).
const fs=require("fs");const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
let pass=0,fail=0;const ok=(c,m)=>{c?(pass++,console.log("  ✓",m)):(fail++,console.log("  ✗ FAIL:",m))};
const L=src.split("\n");
const find=(re,from=13000)=>{for(let i=from;i<L.length;i++)if(re.test(L[i]))return i;return -1};
const blk=(s)=>{let e=s+1;while(!/^    };$/.test(L[e]))e++;return L.slice(s,e+1).join("\n")};
const strip=t=>t.split("\n").map(l=>l.replace(/^\s*\/\/.*/,"").replace(/\s\/\/\s.*$/,"")).join("\n");
const count=strip(blk(find(/^    countBtn\.onclick = \(\) =>/))),fetchH=strip(blk(find(/^    runBtn\.onclick = \(\) =>/))),exp=strip(blk(find(/^    streamBtn\.onclick = function/)));
console.log("1. engines: each button calls only its own");
ok(/runQeCount\(/.test(count)&&!/qeStreamFullExport\(/.test(count),"Count: runQeCount (never the Export ALL engine)");
ok(/qeFetchExport\(/.test(fetchH)&&!/runQeCount\(|qeStreamFullExport\(/.test(fetchH),"Fetch & Export: only qeFetchExport");
ok(/qeStreamFullExport\(/.test(exp)&&!/qeFetchExport\(/.test(exp),"Export ALL: only qeStreamFullExport (+ runQeCount for its pre-count)");
console.log("2. state: no button writes another button's state");
ok(!/_lastStreamExport|_streamState\s*=\s*\{|window\.__dcStreamCancel|__dcQueryExportCancelled/.test(count),"Count touches no export/cancel state");
ok(!/_lastStreamExport|_lastCount|window\.__dcStreamCancel/.test(fetchH),"Fetch doesn't touch Export ALL's memo/cancel flag or Count's cache");
ok(!/setLastResult|_lastResult|_lastCount|__dcQueryExportCancelled/.test(exp),"Export ALL doesn't touch Fetch's result or Count's cache");
console.log("3. cancel flags are separate (this was a real cross-wire)");
ok(/window\.__dcQueryExportCancelled = true; cancelBtn\.textContent/.test(src)&&!/__dcQueryExportCancelled = true; window\.__dcStreamCancel/.test(src),"Fetch's Cancel no longer sets Export ALL's flag");
console.log("4. shared result card: one job at a time");
ok((count.match(/lockExportAll\(/g)||[]).length>=4&&(fetchH.match(/lockExportAll\(/g)||[]).length>=4,"Count and Fetch lock Export ALL while running and unlock on every exit");
ok(/function setExportBusy[\s\S]{0,200}\[countBtn, runBtn\]/.test(src),"Export ALL locks Count and Fetch while running");
// behavior: simulate lock/unlock
const i=src.indexOf("function lockExportAll(on)");const fn=src.slice(i,src.indexOf("function setExportBusy",i));
const mk=()=>({disabled:false,style:{}});const sb=mk();
const lock=new Function("streamBtn",fn+";return lockExportAll;")(sb);
lock(true);ok(sb.disabled===true&&sb.style.pointerEvents==="none","lockExportAll(true) disables Export ALL");
lock(false);ok(sb.disabled===false&&sb.style.pointerEvents==="","lockExportAll(false) re-enables it");
console.log(fail?"FAILED "+fail:"✅ ALL PASS: "+pass);process.exit(fail?1:0);
