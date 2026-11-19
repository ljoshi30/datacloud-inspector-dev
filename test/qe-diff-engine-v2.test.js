// Behavior: ignore/normalize options, dropped-duplicate rows, composite-key suggestion, JSON path diff.
const fs=require("fs"),assert=require("assert");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const a0=src.indexOf("  function qeRowKey"),a=src.indexOf("  function qeSuggestKeys"),b=src.indexOf("  // Render the diff (added/removed/changed)");
const api=new Function(src.slice(Math.min(a0,a),b)+";return {qeSuggestKeys,qeDiffSnapshots,qeJsonPathDiff};")();
const {qeDiffSnapshots:diff,qeSuggestKeys:sug,qeJsonPathDiff:jd}=api;
const P={columns:["Id","Name","Mod","N"],rows:[{Id:"1",Name:"Ann",Mod:"t1",N:"1"},{Id:"2",Name:"Bob",Mod:"t1",N:"2.0"},{Id:"2",Name:"Bob DUP",Mod:"t1",N:"2"}]};
const C={columns:["Id","Name","Mod","N"],rows:[{Id:"1",Name:" ann ",Mod:"t2",N:"1"},{Id:"2",Name:"Bob",Mod:"t2",N:"2"}]};
let d=diff(P,C,["Id"]); assert.strictEqual(d.changed.length,2,"raw: both rows differ"); assert.strictEqual(d.dupRows.length,1,"dropped dup row reported"); assert.strictEqual(d.dupRows[0].row.Name,"Bob DUP");
d=diff(P,C,["Id"],{ignore:["Mod"],ci:true,trim:true,num:true}); assert.strictEqual(d.changed.length,0,"ignoring Mod + normalizing -> 0 changes"); assert.strictEqual(d.unchanged,2);
d=diff(P,C,["Id"],{ignore:["Mod"]}); assert.strictEqual(d.changed.length,2,"ignore only: Ann vs ' ann ' and 2.0 vs 2 still differ"); assert.strictEqual(d.changed.map(c=>c.fields.join()).join("|"),"Name|N");
// composite key: neither column unique alone, the pair is
const mk=(m)=>{const r=[];for(const acc of ["A","B","C"])for(const mo of ["jan","feb","mar"])r.push({Acc:acc,Month:mo,V:acc+mo+m});return {columns:["Acc","Month","V"],rows:r};};
const s=sug(mk(1),mk(2),["Acc","Month","V"]);
assert.deepStrictEqual(s[0].cols,["Acc","Month"],"composite key found "+JSON.stringify(s.map(x=>x.col)));
// json path diff
const j=jd('{"a":{"e":"x@1","k":1},"l":[1,2]}','{"a":{"e":"x@2","k":1},"l":[1,2,3]}');
assert.strictEqual(j.total,2); assert(j.rows.some(r=>r.path==="a.e"&&r.before==="x@1"&&r.after==="x@2")); assert(j.rows.some(r=>r.path==="l[2]"&&r.before===null&&r.after==="3"));
assert.strictEqual(jd("abc","def"),null,"non-JSON -> null");
console.log("qe-diff-engine-v2: 11 checks passed");
