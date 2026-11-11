const fs=require("fs");const src=fs.readFileSync(__dirname+"/../console-decorate.extension.js","utf8");
let pass=0,fail=0;const ok=(c,m)=>{c?pass++:(fail++,console.log("FAIL",m))};
const i=src.indexOf("var DC_A11Y_NOISE");ok(i>0,"cleaner exists in source");
const j=src.indexOf("function shadowEls",i);
const clean=new Function(src.slice(i,j)+"; return dcCleanUiText;")();
const N="Press Spacebar to start reordering this filter, then use the Up and Down arrow keys to move it.";
ok(clean(N+" : Unified Indv Contact Point Email TDI:Count At Least 1")===": Unified Indv Contact Point Email TDI:Count At Least 1","container header");
ok(clean(N+" • Unified Indv Contact Point Email TDIEmail Address  Has Value  EmailAddress__c")==="• Unified Indv Contact Point Email TDIEmail Address Has Value EmailAddress__c","member row");
ok(clean("Email Address Has Value")==="Email Address Has Value","clean text untouched");
ok(clean("")===""&&clean(null)==="","empty");
ok(clean("A "+N+" B "+N+" C")==="A B C","multiple");
// the cleaner is applied in the readers
ok(/shadowEls\(el\)\.map\(e => dcCleanUiText/.test(src),"shadowTexts uses cleaner");
ok(/const t = dcCleanUiText\(/.test(src),"leafShadowTexts uses cleaner");
ok(clean("Press Space to start dragging this row, then use the Up and Down arrow keys to move it. Email")==="Email","variant wording");
ok(clean("Drag and drop Email Address then use the Up and Down arrow keys to move it. Has Value")==="Drag and drop Email Address Has Value","drag variant");
ok(clean("Press Spacebar to begin reordering this attribute; use arrow keys to move it. Phone")==="Phone","begin variant");
// every reader of drag-row text routes through the cleaner
for (const [name,re] of [["segLabel hover",/t = dcCleanUiText\(\(le\.textContent/],["activation section header",/docActStripCount\(dcCleanUiText\(/],["activation path combobox",/txt = c \? dcCleanUiText\(/],["activation wizard text",/wizText = dcCleanUiText\(/],["data space AND/OR",/t = dcCleanUiText\(el\.textContent/],["deepText",/return dcCleanUiText\(out\)/]]) ok(re.test(src),name+" uses cleaner");
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
