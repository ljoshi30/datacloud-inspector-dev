// Runs the REAL pill() from the Activation panel: green pills explain what was captured,
// non-green pills explain WHY (and optional ones are neutral, not a warning).
const fs=require("fs"),path=require("path");
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
const a=src.indexOf("          function pill(ok, label, tipOk, tipNo, optional) {");
const b=src.indexOf("\n          }\n",a)+14;
const pill=new Function("e","docActInfoIcon",src.slice(a,b)+"\nreturn pill;")(x=>String(x),t=>t?"[i:"+t+"]":"");
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n+(c||!x?"":" -> "+x))};
const g=pill(true,"Campaign Data","GREEN TIP","NOT TIP",true);
ok("green: ✓, green colour, shows the green tip",/✓/.test(g)&&/#e3f6ec/.test(g)&&/GREEN TIP/.test(g)&&!/NOT TIP/.test(g));
const o=pill(false,"Campaign Data","GREEN TIP","NOT TIP",true);
ok("optional not-captured: ○, neutral grey (not warning yellow), explains why",/○/.test(o)&&/#f1f5f9/.test(o)&&!/#fef6dd/.test(o)&&/NOT TIP/.test(o)&&!/GREEN TIP/.test(o));
const w=pill(false,"Output names","G","N",false);
ok("required not-captured: ○, warning yellow, explains why",/○/.test(w)&&/#fef6dd/.test(w)&&/\[i:N\]/.test(w));
const block=src.slice(src.indexOf('+ pill(caps.attributes'),src.indexOf('+ pill(caps.paths')+700);
ok("all 6 pills pass a tooltip for both states",(block.match(/\+ pill\(caps\./g)||[]).length===6&&(block.match(/"Green:/g)||[]).length===6&&(block.match(/"Not green/g)||[]).length===6);
ok("Campaign Data / limits / paths marked optional (never a false alarm)",(block.match(/, true\)/g)||[]).length===3);
ok("no claim that a missing optional item is an error",/does not mean an error/.test(block));
console.log(fail?"\n❌ "+fail+" failed":"\n✅ ALL PASS: "+pass);process.exit(fail?1:0);
