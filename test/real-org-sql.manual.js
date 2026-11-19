const fs=require("fs"),cp=require("child_process");
const src=fs.readFileSync("/Users/ljoshi/datacloud-mapping-inspector/console-decorate.extension.js","utf8");
const a=src.indexOf("var QG = (function"),b=src.indexOf("// @@GUIDED-END");
const QG=new Function(src.slice(a,b)+";return QG;")();
const org=process.argv[2];
function run(sql){fs.writeFileSync("/tmp/q.json",JSON.stringify({sql}));
 const r=cp.spawnSync("sf",["api","request","rest","/services/data/v64.0/ssot/query-sql","-o",org,"-X","POST","-b","@/tmp/q.json"],{encoding:"utf8"});
 const o=r.stdout+r.stderr; try{const j=JSON.parse(o.slice(o.indexOf("{")));return (j.data||j.metadata)?{ok:1,rows:(j.data||[]).length,cols:(j.metadata||[]).map(m=>m.name),first:j.data[0]}:{err:o.slice(0,300)}}catch(e){return {err:o.slice(0,300)}}}
const cols=t=>{const r=run('SELECT * FROM "'+t+'" LIMIT 1');return r.cols||[]};
const tests=JSON.parse(process.argv[3]);
for(const t of tests){const c=QG.checks.find(x=>x.id===t.id);const p=Object.assign({cols:[]},t.p);
 for(const k of ["summary","rows"]){ if(!c[k])continue; const sql=c[k](p); const r=run(sql);
  console.log((r.ok?"OK  ":"FAIL")+" "+t.id+"."+k+" "+(r.ok?"rows="+r.rows+" "+JSON.stringify(r.first):r.err)); if(!r.ok)console.log("   SQL: "+sql); } }
