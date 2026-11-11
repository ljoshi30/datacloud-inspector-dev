// Runs the REAL downloadRowsCsv (small-result sync path) and checks the CSV header.
const fs=require("fs"),path=require("path");
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
const a=src.indexOf("function downloadRowsCsv("); const b=src.indexOf("\n  }\n",src.indexOf("doDownload([lines.join",a));
const fnSrc=src.slice(a,src.indexOf("\n  }\n",a+2000)+5);
let pass=0,fail=0;const ok=(n,c)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n)};
function run(cols,rows){let got="";
  const env={Blob:function(p){got=p.join("")},URL:{createObjectURL:()=>"b",revokeObjectURL(){}},document:{createElement:()=>({click(){}})},setTimeout:f=>0,dcExploreToast(){}};
  new Function(...Object.keys(env),fnSrc+"\ndownloadRowsCsv('T',cols,rows);".replace("cols","arguments[arguments.length-2]").replace("rows","arguments[arguments.length-1]"))(...Object.values(env),cols,rows);
  return got.split("\n")[0];}
ok("no phantom Id column",run(["A","B"],[{A:1,B:2}])==="A,B");
ok("Id kept once when rows carry it",run(["A"],[{Id:"x",A:1}])==="Id,A");
ok("no duplicate Id when selected",run(["Id","A"],[{Id:"x",A:1}])==="Id,A");
console.log(fail?"❌ "+fail+" failed":"✅ ALL PASS: "+pass);process.exit(fail?1:0);
