// Behavior: Explorer "Excel" download builds a valid workbook with JSON expanded (runs the real code).
const fs=require("fs"),zlib=require("zlib");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b));
const code=cut("  function qePrepResults","  // Tab-separated text")+cut("    function dcXlsxStream(","    function qeCanXlsx")+cut("  function downloadRowsXlsx","  function downloadRowsCsv");
let blobParts=null,name=null,toast=null;
const env={Blob:function(p){blobParts=p;},URL:{createObjectURL:()=>"u",revokeObjectURL(){}},CompressionStream,
 document:{createElement:()=>({click(){name=this.download;},remove(){}}),body:{appendChild(){}}},setTimeout:f=>f(),dcExploreToast:m=>toast=m};
const fn=new Function(...Object.keys(env),code+";return downloadRowsXlsx;")(...Object.values(env));
(async()=>{
 let ok=0;const t=(c,m)=>{if(!c){console.error("FAIL",m);process.exit(1);}ok++;};
 fn("Obj",["Id","Rec"],[]);t(/0 rows/.test(toast),"empty toast");
 fn("Obj",["Id","Rec"],[{Id:"1",Rec:'{"LastName":"Flynn","N":5}'},{Id:"2",Rec:'{"LastName":"Ray","N":7}'}],null);
 await new Promise(r=>setTimeout(r,300));
 t(name==="Obj.xlsx","filename");
 const buf=Buffer.concat(blobParts.map(b=>Buffer.from(b)));
 // find sheet1 via central-dir-free scan of local headers
 let txt=""; for(let i=0;i<buf.length-30;i++){ if(buf.readUInt32LE(i)===0x04034b50){ const nl=buf.readUInt16LE(i+26),el=buf.readUInt16LE(i+28),nm=buf.toString("utf8",i+30,i+30+nl); if(nm==="xl/worksheets/sheet1.xml"){ const st=i+30+nl+el; for(let e=st;e<buf.length;e++){ try{ txt=zlib.inflateRawSync(buf.subarray(st,e+1)).toString(); if(txt.includes("</worksheet>"))break; }catch(x){} } break; } } }
 t(/Rec\.LastName/.test(txt)&&/Flynn/.test(txt),"JSON expanded into Rec.LastName column");
 t(/<v>7<\/v>/.test(txt),"numeric stays numeric");
 console.log("explorer-xlsx: "+ok+" checks passed");
})();
// styled clipboard HTML
(()=>{const f=require("fs").readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
 const c=f.slice(f.indexOf("  function qeToHtmlTable"),f.indexOf("  // Formatted Excel (.xlsx) of the loaded rows"));
 const h=new Function(c+";return qeToHtmlTable;")()(["A","B<"],[{A:"x&y",B:{k:1}}],[10,20]);
 const bad=!/font-weight:bold/.test(h)||!/background:#1e293b/.test(h)||!/x&amp;y/.test(h)||!/B&lt;/.test(h)||!/<col width="70">/.test(h)||!/white-space:normal/.test(h);
 if(bad){console.error("FAIL html table",h);process.exit(1);} console.log("explorer-xlsx: html table styled+escaped ok");})();
