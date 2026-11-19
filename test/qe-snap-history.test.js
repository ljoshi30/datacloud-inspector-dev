// Behavior: history lists runs newest-first with row delta and added/removed/changed vs the previous run.
const fs=require("fs"),assert=require("assert");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const a0=src.indexOf("  function qeRowKey"),a=src.indexOf("  function qeSuggestKeys"),b=src.indexOf("  // Render the diff (added/removed/changed)");
const h0=src.indexOf("  function openQeSnapHistory"),h1=src.indexOf("  // ── Snapshot/Compare in-tool help");
let html="";
const doc={getElementById:()=>null,createElement:()=>({style:{},set innerHTML(v){html=v;},get innerHTML(){return html;},appendChild(){},addEventListener(){},querySelector:()=>({}),remove(){}}),body:{appendChild(){}}};
const f=new Function("document",src.slice(Math.min(a0,a),b)+src.slice(h0,h1)+";return openQeSnapHistory;")(doc);
const mk=(ids,v)=>({columns:["Id","V"],rows:ids.map(i=>({Id:i,V:v}))});
f([{label:"day2",ts:2,...mk(["1","2","3"],"x")},{label:"day1",ts:1,...mk(["1","2"],"x")}],mk(["1","3","4"],"y"),["Id"]);
assert(/Current result/.test(html),"current row"); assert(/day2/.test(html)&&/day1/.test(html),"saved runs listed");
assert(/\+1 new/.test(html)&&/&minus;1 gone/.test(html),"day2->current: +1 new (4), -1 gone (2): "+html.replace(/<[^>]+>/g," ").slice(0,300));
assert(/first run/.test(html),"oldest has no previous");
console.log("qe-snap-history: 4 checks passed");
