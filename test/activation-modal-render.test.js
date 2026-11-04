const fs=require("fs");
const src=fs.readFileSync(require("path").join(__dirname,"..","console-decorate.extension.js"),"utf8");
function grab(name){const i=src.indexOf("function "+name+"(");let d=0,j=src.indexOf("{",i);for(let k=j;k<src.length;k++){if(src[k]=="{")d++;else if(src[k]=="}"){d--;if(!d)return src.slice(i,k+1);}}}
const names=["docActEsc","docActApiChip","docActObjKind","docActInfoIcon","docActCpHtml","docActCsv","docActPathText","docActDownload","docActShowModal"].filter(n=>src.includes("function "+n+"("));
const code=names.map(grab).join("\n");
let bodyHtml="";
function el(){const o={style:{},children:[],classList:{add(){}},_l:{},appendChild(c){o.children.push(c)},insertBefore(c){o.children.push(c)},addEventListener(){},remove(){},closest(){return null},set innerHTML(v){o._h=v;if(o.__body)bodyHtml=v},get innerHTML(){return o._h},offsetWidth:1000,offsetHeight:700};return o}
const data={found:true,membership:{label:"Unified Individual TDI",hasFilter:false},overview:{target:"Mkt Cloud",segment:"S",filters:[]},captured:{attributes:true,outputNames:true,contactPoints:true,limits:true,paths:true,staticValues:true},
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
const document={getElementById(){return null},createElement(t){const o=el();return o},body:{appendChild(m){mod=m},contains(){return true}},addEventListener(){},removeEventListener(){}};
const window={innerWidth:1200,innerHeight:800,addEventListener(){},removeEventListener(){}};
const localStorage={getItem(){return null},setItem(){}};
const docActScrape=()=>data;
// capture body.innerHTML: body is the 2nd createElement'd div after hdr? simplest: intercept via proxy setter
const created=[];
document.createElement=function(){const o=el();created.push(o);return o};
const f=new Function("document","window","localStorage","docActScrape","segToast",code+"\nreturn docActShowModal;")(document,window,localStorage,docActScrape,()=>{});
f();
const html=created.map(c=>c._h||"").join("");
const must=(n,c)=>{console.log((c?"✓ ":"✗ ")+n);if(!c)process.exitCode=1};

must("Activation Membership section shown first (before Contact Point)", html.indexOf("Activation Membership")>-1 && html.indexOf("Activation Membership")<html.indexOf(">Contact Point<"));
must("rendered", html.length>500);
must("no standalone Provisional Audience Limiting heading", !/Provisional Audience Limiting/.test(html));
const gi=html.indexOf("TDI_Individual_Additional");const grp=html.slice(gi);
must("TDI group has Max # / Sort By inside it, before its first attribute row", grp.indexOf("Max # of Attribute Values")>-1 && grp.indexOf("Max # of Attribute Values")<grp.indexOf("Global Exclusion In"));
must("TDI group shows its Path and Filtered badge", grp.indexOf("U.Id &gt; TDI.Info")>-1 && grp.indexOf("Filtered")>-1);
must("no Other-settings card (all attached)", !/Other related-object settings/.test(html));
must("Contact Point limit lives in Contact Point section, ordered before Attributes", html.indexOf("Contact Point Email")>-1 && html.indexOf(">Contact Point<")<html.indexOf(">Attributes"));
must("Unified Individual group has NO limit line", !/UnifiedIndividual[\s\S]{0,200}Max # of Attribute Values[\s\S]{0,50}FirstName/.test(html.slice(0,html.indexOf("Global Exclusion In"))) );
must("SubSegmentId is a plain row of the first Attributes group (no separate System section)", !/System fields|unspecified|Added automatically/.test(html) && html.indexOf("SubSegmentId")>-1 && html.indexOf("SubSegmentId")<html.indexOf("Global Exclusion In") && html.indexOf("SubSegmentId")>html.indexOf(">Attributes<"));
must("Campaign Data after attributes", html.lastIndexOf("Campaign Data")>html.indexOf("Global Exclusion In"));

const ci=html.indexOf(">Contact Point<"), ai=html.indexOf(">Attributes<");
must("Contact Point section contains Email Address attribute, before Attributes section", html.indexOf("EmailAddress__c")>ci && html.indexOf("EmailAddress__c")<ai);
must("no separate channel table", !/Contact Point field \/ object/.test(html));
must("SF label (not API-ish name) used as group title", html.indexOf(">Contact Point Email<")>-1);
console.log(process.exitCode?"❌ FAILURES":"✅ ALL PASS");
