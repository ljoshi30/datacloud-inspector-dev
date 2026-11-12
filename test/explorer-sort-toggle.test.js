// BEHAVIOR test: the A→Z / Z→A toggle must reorder the SELECTED columns too (not only the unselected list).
// Runs the REAL dcSortByLabel and the REAL sortBtn.onclick body from the source.
const fs=require("fs"),path=require("path");
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
let n=0;const ok=(c,m)=>{n++;if(!c){console.error("FAIL: "+m);process.exit(1)}};
const i=src.indexOf("  function dcSortByLabel("),j=src.indexOf("  // Pure helper (unit-tested): choose a header label",i);
ok(i>0&&j>i,"helper found");
const sortBy=new Function(src.slice(i,j)+"; return dcSortByLabel;")();
const L=x=>x;
ok(JSON.stringify(sortBy(["b","A","c","B"],true,L))==='["A","b","B","c"]',"case-insensitive, stable A→Z");
ok(JSON.stringify(sortBy(["b","A","c"],false,L))==='["c","b","A"]',"Z→A");
ok(JSON.stringify(sortBy(["col10","col2","col1"],true,L))==='["col1","col2","col10"]',"numeric-aware (col2 before col10)");
ok(JSON.stringify(sortBy([],true,L))==="[]"&&JSON.stringify(sortBy(null,true,L))==="[]","empty/null safe");
const a=["x"];sortBy(a,true,L);ok(a.length===1,"does not mutate input");
// real onclick body
const s0=src.indexOf("    sortBtn.onclick = () => {"),s1=src.indexOf("    };",s0)+7;
ok(s0>0&&s1>s0,"onclick found");
const body=src.slice(s0,s1);
ok(/orderedSelected = dcSortByLabel\(orderedSelected\.filter\(fn => checked\.has\(fn\)\), sortAsc/.test(body),"click sorts the SELECTED columns");
ok(/persistSelection\(\)/.test(body)&&/renderActiveTab\(\)/.test(body),"persists and re-renders");
// execute it with stubs
const all=[{fieldName:"b__c",label:"Beta"},{fieldName:"a__c",label:"alpha"},{fieldName:"c__c",label:"Gamma"},{fieldName:"d__c",label:"Delta"}];
const env={sortAsc:true,all,checked:new Set(["b__c","a__c","c__c"]),orderedSelected:["c__c","b__c","a__c"],saved:0,rendered:0,labels:[]};
const run=new Function("dcSortByLabel","E","sortBtn","updateSortLabel",
  "var sortAsc=E.sortAsc,all=E.all,checked=E.checked,orderedSelected=E.orderedSelected;function persistSelection(){E.saved++}function renderActiveTab(){E.rendered++}\n"+
  body.replace("sortBtn.onclick =","var click =")+"\nclick();E.sortAsc=sortAsc;E.orderedSelected=orderedSelected;E.click=click;E.again=function(){click();E.sortAsc=sortAsc;E.orderedSelected=orderedSelected};");
run(sortBy,env,{},()=>{});
ok(env.sortAsc===false,"first click flips to Z→A");
ok(JSON.stringify(env.orderedSelected)==='["c__c","b__c","a__c"]',"selected reordered Z→A by label: Gamma, Beta, alpha");
ok(!env.orderedSelected.includes("d__c"),"unselected column not pulled into the selection");
ok(env.saved===1&&env.rendered===1,"saved + re-rendered once");
env.again();
ok(env.sortAsc===true&&JSON.stringify(env.orderedSelected)==='["a__c","b__c","c__c"]',"second click: A→Z = alpha, Beta, Gamma");
console.log("explorer-sort-toggle: "+n+" checks passed");
