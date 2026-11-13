// Behavior: with Wrap on, JSON cells render as indented, colour-coded blocks (runs the real functions).
const fs=require("fs"),assert=require("assert");
const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const code=cut("  function dcJsonColorLine","  function dcJsonBytes")+"\n"+cut("  function qeJsonDetect","  function qeJsonIsPlainObj")+"\n"+cut("      var wrapOn = false;","      // Detect empty columns");
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const env={esc,_jsonCellStore:[],dcParseJsonLoose:s=>{try{return{value:JSON.parse(s)};}catch(e){return null;}}};
const f=new Function(...Object.keys(env),code+";return {cell:qeCellHtml,on:function(v){wrapOn=v}};")(...Object.values(env));
const j='{"Id":"x1","N":5,"Ok":true,"Kids":[{"A":null}]}';
const off=f.cell(j); assert(!/dc-pj/.test(off),"no pretty block when wrap is off");
f.on(true);
const on=f.cell(j);
assert(/<pre class='dc-pj'>/.test(on),"pretty block when wrap on");
assert(/<span class='k'>&quot;|<span class='k'>"Id"/.test(on),"keys coloured");
assert(on.split("\n").length>6,"indented over multiple lines");
assert(/data-copy='\{"Id"/.test(on),"click-to-copy keeps compact JSON");
assert(!/dc-pj/.test(f.cell("plain text")),"non-JSON cell unchanged");
console.log("qe-wrap-pretty: 5 checks passed");
