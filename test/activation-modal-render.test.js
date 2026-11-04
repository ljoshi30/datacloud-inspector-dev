const fs=require("fs");
const src=fs.readFileSync(require("path").join(__dirname,"..","console-decorate.extension.js"),"utf8");
function grab(name){const i=src.indexOf("function "+name+"(");let d=0,j=src.indexOf("{",i);for(let k=j;k<src.length;k++){if(src[k]=="{")d++;else if(src[k]=="}"){d--;if(!d)return src.slice(i,k+1);}}}
const names=["docActWordHtml","docActOvTable","docActOvRows","docActEsc","docActApiChip","docActObjKind","docActInfoIcon","docActCpHtml","docActCsv","docActPathText","docActDownload","docActShowModal"].filter(n=>src.includes("function "+n+"("));
const code=names.map(grab).join("\n");
let bodyHtml="";
function el(){const o={style:{},children:[],classList:{add(){}},_l:{},appendChild(c){o.children.push(c)},insertBefore(c){o.children.push(c)},addEventListener(){},remove(){},closest(){return null},set innerHTML(v){o._h=v;if(o.__body)bodyHtml=v},get innerHTML(){return o._h},offsetWidth:1000,offsetHeight:700};return o}
const data={found:true,provisional:{limit:"5000"},membership:{label:"Unified Individual TDI",hasFilter:false},overview:{target:"Mkt Cloud",segment:"S",filters:[]},captured:{attributes:true,outputNames:true,contactPoints:true,limits:true,paths:true,staticValues:true},
attributes:[
{label:"SubSegmentId",objectApi:"",source:"SYSTEM",category:"System"},
{label:"Email Address",fieldApi:"EmailAddress__c",objectApi:"TDI_ContactPointEmail__dlm",outputName:"EmailAddress"},
{label:"First Name",fieldApi:"FirstName__c",objectApi:"UnifiedIndividual__dlm",outputName:"FirstName",category:"Profile"},
{label:"Global Exclusion In",fieldApi:"G__c",objectApi:"TDI_Individual_Additional__dlm",outputName:"TDI_G",path:"A.B > C.D"}],
contactPoints:[],groupSection:{"Contact Point Email":"Contact Point","TDI Individual Additional":"Attributes","Unified Individual":"Attributes"},staticRows:[{name:"journey",value:"16 sep",objectApi:""}],waterfall:[],
limits:[{owner:"TDI Individual Additional",maxValues:"1",sortField:"LastModifiedDate__c",sortLabel:"Last Modified Date",orderLabel:"Most Recent",fixed:false},{owner:"Contact Point Email",maxValues:"1",sortField:"Id__c",sortLabel:"Contact Point Email Id",orderLabel:"Ascending",fixed:true}],
pathChoices:[{owner:"TDI Individual Additional",text:"U.Id > TDI.Info"}],
filterGroups:[{label:"TDI Individual Additional",hasFilter:true,conditions:[]}]};
let mod;
const docActOvRowsFn=new Function(grab('docActOvRows')+'\nreturn docActOvRows;')();
const document={getElementById(){return null},createElement(t){const o=el();return o},body:{appendChild(m){mod=m},contains(){return true}},addEventListener(){},removeEventListener(){}};
const window={innerWidth:1200,innerHeight:800,addEventListener(){},removeEventListener(){}};
const localStorage={getItem(){return null},setItem(){}};
const docActScrape=()=>data;
// capture body.innerHTML: body is the 2nd createElement'd div after hdr? simplest: intercept via proxy setter
const created=[];
document.createElement=function(){const o=el();created.push(o);return o};
let dl=null; const f=new Function("document","window","localStorage","docActScrape","segToast",code.replace("function docActDownload(","function __origDl(")+"\nfunction docActDownload(n,m,parts){ globalThis.__dl={n:n,m:m,parts:parts}; }\nreturn docActShowModal;")(document,window,localStorage,docActScrape,()=>{});
f();
const htmlBtn=created.filter(c=>c.textContent==="⬇ Doc")[0];
if(htmlBtn&&htmlBtn.onclick)htmlBtn.onclick();
const docOut=(globalThis.__dl&&globalThis.__dl.parts||[""]).join("");
const html=created.map(c=>c._h||"").join("");
const must=(n,c)=>{console.log((c?"✓ ":"✗ ")+n);if(!c)process.exitCode=1};

must("Activation Membership section shown first (before Contact Point)", html.indexOf("Activation Membership")>-1 && html.indexOf("Activation Membership")<html.indexOf(">Contact Point<"));
must("rendered", html.length>500);
const gi=html.indexOf("TDI_Individual_Additional");const grp=html.slice(gi);
must("TDI group has Max # / Sort By inside it, before its first attribute row", grp.indexOf("Max # of Attribute Values")>-1 && grp.indexOf("Max # of Attribute Values")<grp.indexOf("Global Exclusion In"));
must("TDI group shows its Path and Filtered badge", grp.indexOf("U.Id &gt; TDI.Info")>-1 && grp.indexOf("Filtered")>-1);
must("no Other-settings card (all attached)", !/Other related-object settings/.test(html));
must("Contact Point limit lives in Contact Point section, ordered before Attributes", html.indexOf("Contact Point Email")>-1 && html.indexOf(">Contact Point<")<html.indexOf(">Attributes"));
must("Unified Individual group has NO limit line", !/UnifiedIndividual[\s\S]{0,200}Max # of Attribute Values[\s\S]{0,50}FirstName/.test(html.slice(0,html.indexOf("Global Exclusion In"))) );
must("SubSegmentId is a plain row of the first Attributes group (no separate System section)", !/System fields|unspecified|Added automatically/.test(html) && html.indexOf("SubSegmentId")>-1 && html.indexOf("SubSegmentId")<html.indexOf("Global Exclusion In") && html.indexOf("SubSegmentId")>html.indexOf(">Attributes<"));
must("Campaign Data after attributes", html.lastIndexOf("Campaign Data")>html.indexOf("Global Exclusion In"));

must("Provisional Audience Limiting is its OWN section after Campaign Data, with Limit", html.indexOf(">Provisional Audience Limiting")>html.lastIndexOf("Campaign Data") && /Limit<\/span> <b[^>]*>5,000/.test(html));
must("info icon is 'i' (not '?') and every section has a tooltip", !/dc-info-ic'>\?/.test(html) && (html.match(/dc-info-ic'>i/g)||[]).length>=5 && /fixed-size campaigns/.test(html) && /one value is sent per contact point channel/.test(html));
must("Doc exported with .doc name + msword type", !!globalThis.__dl && /\.doc$/.test(globalThis.__dl.n) && /msword/.test(globalThis.__dl.m));
must("Doc has NO tooltip text / bubbles", docOut.length>500 && !/dc-info-tip|dc-info-ic|fixed-size campaigns|one value is sent per contact point/.test(docOut));
must("Doc has NO flex/grid layout (Word ignores them)", !/display:flex|display:grid|grid-template/.test(docOut));
const di=(s)=>docOut.indexOf(s);
must("Doc keeps UI section order: Overview, Membership, Contact Point, Attributes, Campaign Data, Provisional", di(">Overview<")>-1 && di(">Overview<")<di("Activation Membership") && di("Activation Membership")<di(">Contact Point") && di(">Contact Point")<di(">Attributes") && di(">Attributes")<di("Campaign Data") && di("Campaign Data")<docOut.lastIndexOf("Provisional Audience Limiting"));
must("Doc Overview lists Membership + Provisional Limit rows", /Activation Membership<\/th>/.test(docOut) && /Provisional Audience Limiting — Limit<\/th><td>5000/.test(docOut));
must("Doc keeps API chips and per-object limit line", /FirstName__c/.test(docOut) && /Max # of Attribute Values/.test(docOut));
const ovr=(typeof docActOvRowsFn==="function")?docActOvRowsFn(data):null;
must("shared Overview rows (used by Excel + Doc) include Membership and Provisional Limit", !!ovr && ovr.some(r=>r[0]==="Activation Membership"&&/Unified Individual TDI — No filter/.test(r[1])) && ovr.some(r=>r[0]==="Provisional Audience Limiting — Limit"&&r[1]==="5000"));
const ci=html.indexOf(">Contact Point<"), ai=html.indexOf(">Attributes<");
must("Contact Point section contains Email Address attribute, before Attributes section", html.indexOf("EmailAddress__c")>ci && html.indexOf("EmailAddress__c")<ai);
must("no separate channel table", !/Contact Point field \/ object/.test(html));
must("SF label (not API-ish name) used as group title", html.indexOf(">Contact Point Email<")>-1);
console.log(process.exitCode?"❌ FAILURES":"✅ ALL PASS");
