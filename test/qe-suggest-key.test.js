// Behavior: auto-detect picks the stable unique column, not the regenerated hash / constant / JSON column.
const fs=require("fs"),assert=require("assert");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const a=src.indexOf("  function qeSuggestKeys"),b=src.indexOf("  function qeDiffSnapshots");
const f=new Function(src.slice(a,b)+";return qeSuggestKeys;")();
const mk=(n,hash)=>Array.from({length:n},(_,i)=>({Id__c:hash+i+"x".repeat(20),SourceRecordId__c:"src"+i,Seg:i%2?"A":"B",Match:'{"k":'+i+'}',Created:hash+"t"+i}));
const prev={columns:["Id__c","SourceRecordId__c","Seg","Match","Created"],rows:mk(50,"p")};
const curr={columns:prev.columns,rows:mk(50,"c").slice(2).concat([{Id__c:"cnew",SourceRecordId__c:"srcNEW",Seg:"A",Match:"{}",Created:"z"}])};
const r=f(prev,curr,prev.columns);
assert.strictEqual(r[0].col,"SourceRecordId__c","best key = stable unique column");
assert(r[0].score>0.9,"high score "+r[0].score);
assert(!r.some(x=>x.col==="Match"),"JSON column excluded");
const hashScore=(r.find(x=>x.col==="Id__c")||{score:0}).score; assert(hashScore<0.1,"regenerated hash scores low "+hashScore);
const segScore=(r.find(x=>x.col==="Seg")||{score:0}).score; assert(segScore<0.1,"low-cardinality col scores low");
assert.deepStrictEqual(f({rows:[]},curr,["a"]),[],"empty prev -> no suggestion");
console.log("qe-suggest-key: 6 checks passed");
