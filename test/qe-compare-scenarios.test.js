// Regression: key matching honours trim/case options; added/dropped columns don't mark every row changed.
const fs=require("fs"),path=require("path");
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
const code=src.slice(src.indexOf("  function qeCsvParse"),src.indexOf("function openQeDiffModal"));
const F=new Function(code+";return{qeCsvToSnapshot,qeDiffSnapshots}")();
let bad=0;const chk=(n,c)=>{console.log((c?"ok  ":"FAIL ")+n);if(!c)bad++};
const a=F.qeCsvToSnapshot("Email,Opt\np1@x.com,Y\np2@x.com,Y\np3@x.com,Y\n"),b=F.qeCsvToSnapshot("Email,Opt\n  P1@X.COM ,N\np2@x.com,Y\nnew@x.com,Y\n");
let d=F.qeDiffSnapshots(a,b,["Email"],{});
chk("raw: case/space key variants are add+remove",d.added.length===2&&d.removed.length===2&&d.changed.length===0);
d=F.qeDiffSnapshots(a,b,["Email"],{trim:true,ci:true});
chk("trim+ci: key matches, Opt edit detected",d.added.length===1&&d.removed.length===1&&d.changed.length===1&&d.changed[0].fields.join()==="Opt");
const c=F.qeCsvToSnapshot("Id,Name,Region\n1,A,EU\n2,B,EU\n"),e=F.qeCsvToSnapshot("Id,Name,Tier\n1,A,T1\n2,B2,T1\n");
d=F.qeDiffSnapshots(c,e,["Id"],{});
chk("schema drift: only the real edit is 'changed'",d.changed.length===1&&d.changed[0].fields.join()==="Name"&&d.unchanged===1);
chk("schema drift reported separately",d.addedCols.join()==="Tier"&&d.droppedCols.join()==="Region");
process.exit(bad?1:0);
