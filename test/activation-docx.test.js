// Behaviour test: the Doc export is a REAL .docx (zip + OOXML) built by the shipped code, readable by Word-compatible readers.
const fs=require("fs"),path=require("path"),cp=require("child_process"),os=require("os");
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
function grab(name){const i=src.indexOf("function "+name+"(");let d=0,j=src.indexOf("{",i);for(let k=j;k<src.length;k++){if(src[k]=="{")d++;else if(src[k]=="}"){d--;if(!d)return src.slice(i,k+1);}}}
const a=src.indexOf("(function (root) {",src.indexOf("/* ==== mini-xlsx")), b=src.indexOf("})(SEGX_NS);",a)+"})(SEGX_NS);".length;
const mini=src.slice(a,b);
const data={overview:{target:"MCE1",segment:"Seg",segmentApi:"Seg_api",dataSpace:"TDI",segmentCount:26},membership:{label:"Unified Individual TDIR",hasFilter:true},
contactPoints:[{platform:"MC",email:{present:true,value:"Email Address",fieldApi:"Email__c",path:"A.Id > B.Id"}}],
attributes:[{label:"Unified Individual Id",fieldApi:"Id__c",objectApi:"UI__dlm",outputName:"Id"},{label:"Insurance <Policy> & Co",fieldApi:"P__c",objectApi:"Pol__dlm",outputName:"P"}],
groupSection:{"Insurance Policy":"Attributes"},limits:[{owner:"Insurance Policy",maxValues:"4",sortLabel:"Data Source",sortField:"DataSourceId__c",orderLabel:"Descending"}],
filterGroups:[{label:"Insurance Policy",hasFilter:true,conditions:[{text:"Days to Expiration Is Between 83 AND 93"}]}],
pathChoices:[{owner:"Insurance Policy",text:"U.Id > L.Id, L.Ind > I.Id"}],staticRows:[{name:"Campaign",value:"X",objectApi:""}],
provisional:{limit:"200",rank:[{order:"1",attribute:"Birth Date - dlm",sortBy:"ASC"}]}};
const f=new Function("data",`var SEGX_NS={};${mini}\nvar SEGX=SEGX_NS;\n${grab("docActOvRows")}\n${grab("docActObjSettings")}\n${grab("docActDocx")}\nreturn docActDocx(data);`);
let pass=0,fail=0;const ok=(n,c)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n)};
const bytes=f(data);
ok("returns bytes",bytes&&bytes.length>200);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"docx-")),file=path.join(dir,"t.docx");fs.writeFileSync(file,Buffer.from(bytes));
ok("zip magic PK",bytes[0]==0x50&&bytes[1]==0x4b);
const py=cp.spawnSync("python3",["-I","-c","import sys,docx;d=docx.Document(sys.argv[1]);print('\\n'.join(p.text for p in d.paragraphs));print('TABLES',len(d.tables));[print('|'.join(c.text for c in r.cells)) for t in d.tables for r in t.rows]",file],{encoding:"utf8"});
ok("python-docx opens it",py.status===0);if(py.status)console.log(py.stderr);
const out=py.stdout||"";
ok("title + Insurance group",/MCE1/.test(out)&&/Pol__dlm \(1\)/.test(out));
ok("escaped special chars round-trip",/Insurance <Policy> & Co/.test(out));
ok("filter count, no numbering",/Filters\|Filtered · 1 condition/.test(out)&&!/1\.\s*Days/.test(out));
ok("path as Step rows",/Step 1: U\.Id/.test(out)&&/Step 2: L\.Id, L\.Ind/.test(out));
ok("limit fields",/Max\. # of Attribute Values: 4/.test(out)&&/DataSourceId__c/.test(out)&&/Descending/.test(out));
ok("rank + limit",/Limit: 200/.test(out)&&/Birth Date - dlm/.test(out));
ok("no Join Path text",!/Join Path/.test(out));
const tx=cp.spawnSync("textutil",["-convert","txt","-stdout",file],{encoding:"utf8"});
ok("macOS textutil also reads it",tx.status===0&&/Unified Individual Id/.test(tx.stdout));
ok("button wired to .docx",/activation-"[^;]*\.docx", "application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document"/.test(src));
console.log(fail?"❌ FAILURES: "+pass+" passed, "+fail+" failed":"✅ ALL PASS: "+pass+" passed, 0 failed");process.exit(fail?1:0);
