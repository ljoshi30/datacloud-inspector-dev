// Real-Chrome test (manual): Guided Checks panel — goal cards, table/column dropdowns, run, verdict, rows, distinct, between, classic link.
//   node test/qe-guided-browser.test.js
const fs=require("fs"),http=require("http"),cp=require("child_process"),assert=require("assert");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const pure=src.slice(src.indexOf("var QG = (function"),src.indexOf("// @@GUIDED-END"));
const harv=src.slice(src.indexOf("  var _dcObjSeen = {}"),src.indexOf("  function decodeFormField"));
const ui=src.slice(src.indexOf("    var guidedPanelEl = null;"),src.indexOf("    function openTemplatesPanel"));
const html="<!doctype html><meta charset=utf-8><body>Tables: Policy__dlm and Other__dll here<script>"+`
var _dsByObject={Confirmed__dlm:"TD Insurance",Other_space__dlm:"Other"},_dsGuess={};function qeResolveDs(){return "TD Insurance";}
window.__sqls=[];window.__classic=0;
function makeDraggable(){}function addResizeHandle(){}function todayStr(){return "2026-11-19"}
function qeValidIdent(s){return !!s&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(s).trim());}
function qeDsForSql(){return "TD"}
var qeTemplates={fieldsProbe:function(t){return 'SELECT * FROM "'+t+'" LIMIT 1';}};
function setLastResult(r){window.__last=r;}
function openTemplatesPanel(){window.__classic++;}
function ensureQueryContext(cb){cb(true);}
function toHome(){var b=document.querySelector('#dc-g-back2');if(b)b.click();b=document.querySelector('#dc-g-back');if(b)b.click();}
function qeFetchExport(sql){window.__sqls.push(sql);
 var m=sql.indexOf("Missing__dlm")>=0&&/LIMIT 1$/.test(sql);
 if(m)return Promise.reject(new Error('table "Missing__dlm" does not exist'));
 if(/LIMIT 1$/.test(sql))return Promise.resolve({columns:["Id__c","Email__c","CreatedDate__c"],columnTypes:{Id__c:"VARCHAR",Email__c:"VARCHAR",CreatedDate__c:"TIMESTAMP"},rowData:[],totalRows:0,blobUrl:"blob:x"});
 if(/AS dup_values/.test(sql))return Promise.resolve({columns:["dup_values","dup_rows"],rowData:[{dup_values:"3",dup_rows:"7"}],totalRows:1,blobUrl:"blob:x"});
 if(/COUNT\\(DISTINCT "Email__c"\\) AS distinct_values/.test(sql))return Promise.resolve({columns:["total"],rowData:[{total:"10",non_null:"9",distinct_values:"4"}],totalRows:1,blobUrl:"blob:x"});
 if(/GROUP BY "Email__c" ORDER BY/.test(sql))return Promise.resolve({columns:["value","value_count"],rowData:[{value:"a@x.com",value_count:"5"},{value:"b@x.com",value_count:"2"}],totalRows:2,blobUrl:"blob:x"});
 if(/AS inside/.test(sql))return Promise.resolve({columns:["total"],rowData:[{total:"100",inside:"25"}],totalRows:1,blobUrl:"blob:x"});
 if(/SELECT \\* FROM "Policy__dlm" WHERE "CreatedDate__c" BETWEEN/.test(sql))return Promise.resolve({columns:["Id__c"],rowData:[{Id__c:"r1"},{Id__c:"r2"}],totalRows:2,blobUrl:"blob:x"});
 return Promise.resolve({columns:["total"],rowData:[{total:"0"}],totalRows:1,blobUrl:"blob:x"});}
`+harv+";"+pure+";"+ui+`
dcHarvestObjects('{"a":[{"name":"Harvested_Obj__dlm"},{"x":"My_Ci__cio"},{"junk":"notanobject__c"}]}');
openGuidedChecks();<\/script>`;
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async()=>{
 const srv=http.createServer((q,s)=>{s.setHeader("content-type","text/html");s.end(html);});await new Promise(r=>srv.listen(0,r));
 const dbg=9950+Math.floor(Math.random()*40),prof=fs.mkdtempSync("/tmp/chr-gd-");
 const ch=cp.spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--remote-debugging-port="+dbg,"--user-data-dir="+prof,"--window-size=1200,900","about:blank"],{stdio:"ignore"});
 let tgt=null;for(let i=0;i<40&&!tgt;i++){await new Promise(r=>setTimeout(r,200));try{tgt=(await(await fetch("http://127.0.0.1:"+dbg+"/json")).json()).find(t=>t.type==="page");}catch(e){}}
 const ws=new WebSocket(tgt.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pend={};ws.onmessage=m=>{const d=JSON.parse(m.data);if(d.id&&pend[d.id]){pend[d.id](d);delete pend[d.id];}};
 const send=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
 await send("Page.navigate",{url:"http://127.0.0.1:"+srv.address().port+"/"});await new Promise(r=>setTimeout(r,600));
 const ev=async e=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true});if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));return r.result.result.value;};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const P="document.querySelector('#dc-qe-guided-panel')";
 let n=0;const ok=(c,m)=>{assert(c,m);n++;console.log("  ✓ "+m);};
 ok(await ev(P+".querySelectorAll('[data-goal]').length")===6,"home shows 6 goal cards");
 ok(await ev(P+".innerText.includes('Is my data loaded?')&&"+P+".innerText.includes('Did identity resolution work?')"),"goal titles in plain English");
 // table suggestions scraped from the page
 await ev(P+".querySelector('[data-goal=explore]').click()");
 ok(await ev(P+".innerText.includes('Distinct values in a field')&&"+P+".innerText.includes('Table health scan')"),"explore goal lists distinct values + health scan");
 await ev(P+".querySelector('[data-chk=distinct]').click()");
 ok(await ev("[...document.querySelectorAll('#dc-g-tables option')].some(o=>o.value==='Policy__dlm')&&[...document.querySelectorAll('#dc-g-tables option')].some(o=>o.value==='Other__dll')"),"table list picked up names visible on the page");
 ok(await ev("[...document.querySelectorAll('#dc-g-tables option')].map(o=>o.value).slice(0,2).join()")==="Confirmed__dlm,Other_space__dlm"||await ev("document.querySelector('#dc-g-tables option').value")==="Confirmed__dlm","objects with confirmed CURRENT data space are suggested first");
 ok(await ev("document.querySelector('#dc-g-tables option').label.includes('data space: TD Insurance')"),"suggestion shows its data space");
 ok(await ev("[...document.querySelectorAll('#dc-g-tables option')].some(o=>o.value==='Harvested_Obj__dlm')&&[...document.querySelectorAll('#dc-g-tables option')].some(o=>o.value==='My_Ci__cio')"),"names harvested from Salesforce responses are suggested");
 ok(await ev("![...document.querySelectorAll('#dc-g-tables option')].some(o=>o.value==='notanobject__c')"),"non-DLO/DMO names are not harvested");
 ok(await ev("document.querySelector('.dc-g-refresh')!==null&&document.querySelector('#dc-qe-guided-panel').innerText.includes('objects known from this session')"),"refresh button + object count shown");
 // empty submit -> validation message
 await ev("document.querySelector('#dc-g-run').click()");
 ok(await ev("document.querySelector('#dc-g-msg').textContent.includes('Fill in')"),"empty form gives a clear message, runs nothing");
 ok(await ev("window.__sqls.length")===0,"no query fired for an invalid form");
 // pick a table -> columns dropdown appears with a sensible default
 await ev("var t=document.querySelector('#dc-g-f-t');t.value='Policy__dlm';t.onchange()");await wait(200);
 ok(await ev("document.querySelector('#dc-g-f-c').tagName")==="SELECT","column is a dropdown after choosing a table");
 ok(await ev("[...document.querySelectorAll('#dc-g-f-c option')].map(o=>o.value).join()")==="Id__c,Email__c,CreatedDate__c","dropdown lists the real columns");
 await ev("var c=document.querySelector('#dc-g-f-c');c.value='Email__c';c.onchange()");
 await ev("document.querySelector('#dc-g-run').click()");await wait(300);
 ok(await ev("document.querySelector('#dc-g-verdict').innerText.includes('4 different values across 10 rows')"),"distinct: verdict says 4 different values / 10 rows");
 ok(await ev("document.querySelector('#dc-g-rows').innerText.includes('a@x.com')&&document.querySelector('#dc-g-rows').innerText.includes('value_count')"),"distinct values list shown inline automatically");
 ok(await ev("window.__last&&window.__last.rowCount===2"),"result registered for View Results / Download");
 // not-found table -> friendly message
 // duplicates verdict
 await ev("toHome()");
 await ev(P+".querySelector('[data-goal=loaded]').click()");await ev(P+".querySelector('[data-chk=dupes]').click()");
 ok(await ev("document.querySelector('#dc-g-f-t').value")==="Policy__dlm","table choice carried between checks");
 await ev("document.querySelector('#dc-g-run').click()");await wait(300);
 ok(await ev("document.querySelector('#dc-g-verdict').innerText.includes('3 values repeat')&&document.querySelector('#dc-g-verdict').innerText.includes('7 rows')"),"duplicates: warning with counts");
 ok(await ev("document.querySelector('#dc-g-verdict').style.background")!=="","verdict is colour coded");
 ok(await ev("!!document.querySelector('#dc-g-see')&&!!document.querySelector('#dc-g-copy')"),"See rows + Copy SQL offered");
 // between dates
 await ev("toHome()");await ev(P+".querySelector('[data-goal=dates]').click()");await ev(P+".querySelector('[data-chk=between]').click()");
 ok(await ev("document.querySelector('#dc-g-f-c').value")==="CreatedDate__c","date column preselected (only date columns offered)");
 await ev("document.querySelector('#dc-g-run').click()");
 ok(await ev("document.querySelector('#dc-g-msg').textContent.includes('start date')"),"between: asks for both dates");
 await ev("document.querySelector('#dc-g-d1').value='2026-11-01';document.querySelector('#dc-g-d1').onchange();document.querySelector('#dc-g-d2').value='2026-11-05';document.querySelector('#dc-g-d2').onchange()");
 await ev("document.querySelector('#dc-g-run').click()");await wait(300);
 ok(await ev("document.querySelector('#dc-g-verdict').innerText.includes('25 of 100 rows (25%)')"),"between: 25 of 100 rows");
 ok(await ev("window.__sqls.some(s=>/BETWEEN TIMESTAMP '2026-11-01 00:00:00' AND TIMESTAMP '2026-11-05 23:59:59'/.test(s))"),"timestamp column: end date includes the whole day");
 await ev("document.querySelector('#dc-g-see').click()");await wait(300);
 ok(await ev("document.querySelector('#dc-g-rows').innerText.includes('r1')&&document.querySelector('#dc-g-rows').innerText.includes('Download CSV')"),"See the rows shows rows + CSV link");
 // missing table
 await ev("toHome()");await ev(P+".querySelector('[data-goal=loaded]').click()");await ev(P+".querySelector('[data-chk=rowcount]').click()");
 await ev("var t=document.querySelector('#dc-g-f-t');t.value='Missing__dlm';t.onchange()");await wait(200);
 ok(await ev("document.querySelector('#dc-g-msg').textContent.includes('not found in this data space')"),"missing table: explains data space");
 // classic link
 await ev("toHome();document.querySelector('#dc-g-classic').click()");
 ok(await ev("window.__classic")===1&&await ev("!document.querySelector('#dc-qe-guided-panel')"),"classic SQL templates still reachable");
 console.log("\n"+n+" checks passed");ws.close();ch.kill();srv.close();process.exit(0);
})().catch(e=>{console.error("FAIL",e.message);process.exit(1);});
