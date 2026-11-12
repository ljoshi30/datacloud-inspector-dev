// Behavior test (Node): the "sort detected" signal and the wiring of the new sort guide.
// Runs the REAL absorbAuraForm from the source against fake /aura POST bodies.
const fs=require("fs"),path=require("path"),assert=require("assert");
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
let n=0;const ok=(c,m)=>{assert(c,m);n++};
const a=src.indexOf("  var _auraSniff = {"),b=src.indexOf("  // Ready only when we have credentials AND a real captured query template");
assert(a>0&&b>a,"markers");
const mk=()=>new Function(src.slice(a,b)+";return {sn:_auraSniff,ds:_dsByObject,absorb:absorbAuraForm};")();
const body=(actions)=>"message="+encodeURIComponent(JSON.stringify({actions}))+"&aura.context=CTX&aura.token=TOK&aura.pageURI=%2Fx";
const q={params:{query:{objectName:"Acct__dlm",selectedDataSpaceName:"default"}}};
let m=mk();
ok(m.sn.querySeq===0,"starts at 0");
m.absorb(body([{descriptor:"serviceComponent://ui.x.TelemetryController",params:{}}]));
ok(m.sn.querySeq===0,"a telemetry/other aura POST does NOT count as 'the page ran a query'");
ok(m.sn.context==="CTX"&&m.sn.token==="TOK","credentials are still captured from any POST");
m.absorb(body([{descriptor:"CdpDataView.query",params:q.params}]));
ok(m.sn.querySeq===1,"the page's own CdpDataView.query counts once");
ok(m.ds["Acct__dlm"]==="default"&&m.sn.dataSpace==="default","data space still captured (unchanged behaviour)");
m.absorb(body([{descriptor:"CdpDataView.query",params:q.params},{descriptor:"CdpDataView.query",params:q.params}]));
ok(m.sn.querySeq===3,"each query is counted");
// ---- wiring: both old plain messages are gone and both surfaces use the guide
ok(!/One quick step to load your data/.test(src),"old grey 'One quick step' callout removed");
ok(!/<b>One-time setup:<\/b>/.test(src),"old blue 'One-time setup' hint removed");
ok(/function showSortHelp\(again\)\s*\{[\s\S]{0,500}dcBuildSortGuide\(/.test(src),"data-space error path uses the guide");
ok(/lockBtn: again === "Restore saved" \? restoreBtn : viewAllBtn/.test(src),"guide locks the ORIGINAL button (no duplicate)");
ok(!/dc-guide-go/.test(src),"no guide-owned action button anywhere");
ok(/_sortGuide\.dcStop\(\)/.test(src),"a new guide stops the old one (no stacked locks)");
ok(/_connHint = dcBuildSortGuide\(/.test(src),"no-session path uses the guide");
ok(/if \(!ready\) \{ hideSpinner\(\); showSortHelp\("Restore saved"\); return; \}/.test(src),"Restore without a session uses the guide");
ok(/querySeq: 0/.test(src),"counter declared");
console.log("explorer-sort-guide-wiring: "+n+" checks passed");
