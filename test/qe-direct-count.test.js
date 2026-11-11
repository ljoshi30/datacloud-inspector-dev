const fs=require("fs");const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
let pass=0,fail=0;const ok=(c,m)=>{c?(pass++,console.log("  ✓",m)):(fail++,console.log("  ✗ FAIL:",m))};
const i=src.indexOf("function qeDirectCountSql(");let d=0,j=src.indexOf("{",i),k;for(k=j;k<src.length;k++){if(src[k]==="{")d++;else if(src[k]==="}"){d--;if(!d)break}}
const f=new Function(src.slice(i,k+1)+";return qeDirectCountSql;")();
ok(f('SELECT * FROM "CAMEP_SFP_TDI_Behavioral_Events_F643EC3D__dll"')==='SELECT COUNT(*) AS TotalRows FROM "CAMEP_SFP_TDI_Behavioral_Events_F643EC3D__dll"',"the exact query from the screenshot → direct COUNT(*), no subquery");
ok(f("select * from Foo__dlm where a = 1 and b='x'")==="SELECT COUNT(*) AS TotalRows FROM Foo__dlm where a = 1 and b='x'","simple WHERE kept");
for(const q of ['SELECT * FROM a JOIN b ON a.x=b.x','SELECT * FROM a ORDER BY x','SELECT a, b FROM t','SELECT * FROM t WHERE x IN (SELECT y FROM z)','SELECT * FROM t GROUP BY x','SELECT * FROM t WHERE a=1 ORDER BY b','SELECT DISTINCT x FROM t','SELECT * FROM a UNION SELECT * FROM b',''])ok(f(q)===null,"keeps safe wrapper for: "+(q||"(empty)"));
ok(/qeDirectCountSql\(innerSql\)/.test(src)&&/qeDirectCountSql\(_innerForCount\)/.test(src),"used by both Count and Export ALL pre-count");
ok(/var MAX_POLL = 4;\s+\/\/ a few retries/.test(src),"count retry window widened");
// --- save-dialog user-gesture guard (behavior: run the real branch logic against a fake navigator) ---
const g=src.indexOf("var gestureLive = true;");const ge=src.indexOf("if (!gestureLive)",g);
const snippet=src.slice(g,ge);
const run=(nav)=>new Function("navigator",snippet+";return gestureLive;")(nav);
ok(run({userActivation:{isActive:false}})===false,"expired click → NOT live → ask for a fresh click (no failing picker call)");
ok(run({userActivation:{isActive:true}})===true,"fresh click → open picker straight away");
ok(run({})===true,"browser without userActivation API → old behaviour (try picker)");
ok(/showReadyToSave\(pc && pc\.ok \? pc\.count : 0\)/.test(src)&&/user gesture\|user activation/.test(src),"ready card + friendly error wired");
console.log(fail?"FAILED "+fail:"✅ ALL PASS: "+pass);process.exit(fail?1:0);
