const fs=require("fs");
const src=fs.readFileSync(require("path").join(__dirname,"..","console-decorate.extension.js"),"utf8");
function grab(name){const i=src.indexOf("function "+name+"(");let d=0,j=src.indexOf("{",i);for(let k=j;k<src.length;k++){if(src[k]=="{")d++;else if(src[k]=="}"){d--;if(!d)return src.slice(i,k+1);}}}
const names=["docActObjSettings","docActWordHtml","docActOvTable","docActOvRows","docActEsc","docActApiChip","docActObjKind","docActInfoIcon","docActCpHtml","docActCsv","docActPathText","docActDownload","docActShowModal"].filter(n=>src.includes("function "+n+"("));
const code=names.map(grab).join("\n");
let bodyHtml="";
function el(){const o={style:{},children:[],classList:{add(){}},_l:{},appendChild(c){o.children.push(c)},insertBefore(c){o.children.push(c)},addEventListener(){},remove(){},closest(){return null},set innerHTML(v){o._h=v;if(o.__body)bodyHtml=v},get innerHTML(){return o._h},offsetWidth:1000,offsetHeight:700};return o}
const data={found:true,provisional:{limit:"5000",rank:[{order:"1",attribute:"Birth Date - dlm",sortBy:"ASC"},{order:"2",attribute:"Birth Date Year - dlm",sortBy:"DESC"}]},membership:{label:"Unified Individual TDI",hasFilter:false},overview:{target:"Mkt Cloud",segment:"S",filters:[]},captured:{attributes:true,outputNames:true,contactPoints:true,limits:true,paths:true,staticValues:true},
attributes:[
{label:"SubSegmentId",objectApi:"",source:"SYSTEM",category:"System"},
{label:"First Name",fieldApi:"FirstName__c",objectApi:"UnifiedIndividual__dlm",outputName:"FirstName",category:"Profile"},
{label:"State Province",fieldApi:"StateProvinceId__c",objectApi:"TDI_UnifiedContactPointAddressTdi__dlm",outputName:"StateProvinceId"},
{label:"Control_05_Random",fieldApi:"Control_05_Random__c",objectApi:"TDI_MultiRand_RandomControl_5to50Pct__cio",outputName:"Control_05_Random"},
{label:"Global Exclusion In",fieldApi:"G__c",objectApi:"TDI_Individual_Additional__dlm",outputName:"TDI_G",path:"A.B > C.D"}],
contactPoints:[],groupSection:{"Contact Point Email":"Contact Point","TDI Individual Additional":"Attributes","Unified Individual":"Attributes","Unified Indv Contact Point Address TDI":"Attributes"},staticRows:[{name:"journey",value:"16 sep",objectApi:""}],waterfall:[],
limits:[{owner:"Unified Indv Contact Point Address TDI",maxValues:"1",sortField:"LastModifiedDate__c",sortLabel:"Last Modified Date",orderLabel:"Most Recent",fixed:false},{owner:"TDI Individual Additional",maxValues:"1",sortField:"LastModifiedDate__c",sortLabel:"Last Modified Date",orderLabel:"Most Recent",fixed:false},{owner:"Contact Point Email",maxValues:"1",sortField:"Id__c",sortLabel:"Contact Point Email Id",orderLabel:"Ascending",fixed:true}],
pathChoices:[{owner:"TDI Individual Additional",text:"A.Id > B.Id, C.Id > TDI.Info"}],
filterGroups:[{label:"Contact Point Email",hasFilter:true,conditions:[]},{label:"TDI Individual Additional",hasFilter:true,conditions:[{field:"Global Exclusion In",operator:"Equals"},{field:"Segment Code",operator:"Has Value"}]},{label:"Unified Indv Contact Point Address TDI",hasFilter:false,conditions:[]}]};
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
must("TDI group like Salesforce: Max. # of Attribute Values / Sort By / Order fields ABOVE the table; Filters + Path BELOW it", grp.indexOf("Max. # of Attribute Values")>-1 && grp.indexOf("Max. # of Attribute Values")<grp.indexOf("Global Exclusion In") && grp.indexOf("Sort By")<grp.indexOf("Global Exclusion In") && grp.indexOf("Filters")>grp.indexOf("Global Exclusion In") && grp.indexOf(">Path<")>grp.indexOf("Global Exclusion In"));
must("limit fields are label-over-value (not a 'Limit' chip row)", !/>Limit<\/th>/.test(grp.slice(0,3000)));
must("TDI group shows its Path and its Filtered badge", (grp.indexOf("A.Id")>-1 && grp.indexOf("TDI.Info")>-1) && grp.indexOf("Filtered")>-1);
must("no Other-settings card (all attached)", !/Other related-object settings/.test(html));
must("Contact Point limit lives in Contact Point section, ordered before Attributes", html.indexOf("Contact Point Email")>-1 && html.indexOf(">Contact Point<")<html.indexOf(">Attributes"));
must("Unified Individual group has NO limit line", !/UnifiedIndividual[\s\S]{0,200}Max # of Attribute Values[\s\S]{0,50}FirstName/.test(html.slice(0,html.indexOf("Global Exclusion In"))) );
must("SubSegmentId is a plain row of the first Attributes group (no separate System section)", !/System fields|unspecified|Added automatically/.test(html) && html.indexOf("SubSegmentId")>-1 && html.indexOf("SubSegmentId")<html.indexOf("Global Exclusion In") && html.indexOf("SubSegmentId")>html.indexOf(">Attributes<"));
must("Campaign Data after attributes", html.lastIndexOf("Campaign Data")>html.indexOf("Global Exclusion In"));

must("Provisional Audience Limiting is its OWN section after Campaign Data, with Limit", html.indexOf(">Provisional Audience Limiting")>html.lastIndexOf("Campaign Data") && /Limit<\/span> <b[^>]*>5,000/.test(html));
must("info icon is 'i' (not '?') and every section has a tooltip", !/dc-info-ic'[^>]*>\?/.test(html) && (html.match(/dc-info-ic' tabindex='0'>i/g)||[]).length>=5 && /fixed-size campaigns/.test(html) && /one value is sent per contact point channel/.test(html));
must("Doc exported with .doc name + msword type", !!globalThis.__dl && /\.doc$/.test(globalThis.__dl.n) && /msword/.test(globalThis.__dl.m));
must("Doc has NO tooltip text / bubbles", docOut.length>500 && !/dc-info-tip|dc-info-ic|fixed-size campaigns|one value is sent per contact point/.test(docOut));
must("Doc has NO flex/grid layout (Word ignores them)", !/display:flex|display:grid|grid-template/.test(docOut));
const di=(s)=>docOut.indexOf(s);
must("Doc keeps UI section order: Overview, Membership, Contact Point, Attributes, Campaign Data, Provisional", di(">Overview<")>-1 && di(">Overview<")<di("Activation Membership") && di("Activation Membership")<di(">Contact Point") && di(">Contact Point")<di(">Attributes") && di(">Attributes")<di("Campaign Data") && di("Campaign Data")<docOut.lastIndexOf("Provisional Audience Limiting"));
must("Doc Overview lists Membership + Provisional Limit rows", /Activation Membership<\/th>/.test(docOut) && /Provisional Audience Limiting — Limit<\/th><td>5000/.test(docOut));
must("Doc keeps API chips and per-object limit line", /FirstName__c/.test(docOut) && /Max\. # of Attribute Values/.test(docOut));
const ovr=(typeof docActOvRowsFn==="function")?docActOvRowsFn(data):null;
must("shared Overview rows (used by Excel + Doc) include Membership and Provisional Limit", !!ovr && ovr.some(r=>r[0]==="Activation Membership"&&/Unified Individual TDI — No filter/.test(r[1])) && ovr.some(r=>r[0]==="Provisional Audience Limiting — Limit"&&r[1]==="5000"));
const ci=html.indexOf(">Contact Point<"), ai=html.indexOf(">Attributes<");
must("Contact Point Email group (no attribute rows captured) still renders in Contact Point section", html.indexOf(">Contact Point Email<")>ci && html.indexOf(">Contact Point Email<")<ai);
must("no separate channel table", !/Contact Point field \/ object/.test(html));
must("SF label (not API-ish name) used as group title", html.indexOf(">Contact Point Email<")>-1);
console.log(process.exitCode?"❌ FAILURES":"✅ ALL PASS");

must("no standalone Filters card when every filter belongs to a rendered group", !/>Filters <span/.test(html));
const cpStart=html.indexOf(">Contact Point Email<");
must("Contact Point Email Filtered badge sits inside its own group, before the Attributes section", html.slice(cpStart,html.indexOf(">Attributes<")).indexOf("Filtered")>-1);
must("CI row is a numbered row of the main Attributes table (no separate CI group)", !/>CI<\/span>/.test(html) && html.indexOf("Control_05_Random")>html.indexOf("First Name") && html.indexOf("Control_05_Random")<html.indexOf("Global Exclusion In"));
must("primary table titled with the segment object (SF label), not the first API name", /Unified Individual TDI<\/span>/.test(html.slice(html.indexOf(">Attributes<"))));
must("rows are numbered 1..n in the primary table", /<td[^>]*>1<\/td><td[^>]*>SubSegmentId/.test(html) && /<td[^>]*>3<\/td><td[^>]*>Control_05_Random/.test(html));
if(process.env.DBG){const i=html.indexOf(">Filters <span");console.log(html.slice(i,i+900).replace(/<[^>]+>/g," ").replace(/\s+/g," "));}
if(process.env.DBG){const a=html.indexOf(">Attributes<");console.log(html.slice(a,a+3500).replace(/<[^>]+>/g,"|").replace(/\|+/g,"|"));}


const tdiPanel=grp.slice(grp.indexOf("Global Exclusion In"), grp.indexOf("Global Exclusion In")+6000);
must("each filter condition is its own numbered chip (2 conditions → 2 chips, field + operator separated)", /Global Exclusion In<\/b> <span[^>]*>Equals<\/span>/.test(tdiPanel) && /Segment Code<\/b> <span[^>]*>Has Value<\/span>/.test(tdiPanel));
must("path hops are separate numbered steps joined by an arrow", /&rarr;/.test(tdiPanel) && /A\.Id/.test(tdiPanel) && /TDI\.Info/.test(tdiPanel));
must("Doc carries the same panel with the table before it", docOut.indexOf("Equals")>docOut.indexOf("Global Exclusion In"));

const osFn=new Function(grab("docActObjSettings")+"\nreturn docActObjSettings;")();
const osr=osFn(Object.assign({},data,{contactPoints:[{email:{path:"CPE.Party > Ind.Id"}}]}));
const byObj=(n)=>osr.filter(r=>r.object===n)[0]||{};
must("Excel Object Settings: Contact Point Email = Contact Point section, Filtered, fixed limit, path from Contact Points step", byObj("Contact Point Email").section==="Contact Point" && byObj("Contact Point Email").filter==="Filtered" && /fixed/.test(byObj("Contact Point Email").max) && byObj("Contact Point Email").path==="CPE.Party > Ind.Id");
must("Excel Object Settings: TDI Individual Additional carries limit + 2 numbered conditions + path", byObj("TDI Individual Additional").sortBy==="Last Modified Date" && /1\. Global Exclusion In Equals; 2\. Segment Code Has Value/.test(byObj("TDI Individual Additional").cond) && /A\.Id/.test(byObj("TDI Individual Additional").path));
must("Excel Object Settings ordered like the wizard (Membership, Contact Point, Attributes)", osr.map(r=>r.section).join(",").indexOf("Activation Membership")<osr.map(r=>r.section).join(",").indexOf("Contact Point") && osr.map(r=>r.section).join(",").indexOf("Contact Point")<osr.map(r=>r.section).join(",").indexOf("Attributes"));

must("Provisional section lists Rank Attributes rows (Rank Order / Attribute / Sort By), no pop-up note", /Birth Date - dlm/.test(html) && /Birth Date Year - dlm/.test(html) && />ASC</.test(html) && />DESC</.test(html) && !/pop-up/.test(html));
must("Doc carries the Rank Attributes table too", /Birth Date - dlm/.test(docOut) && /Rank Order/.test(docOut));
