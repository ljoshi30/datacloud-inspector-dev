// Runs the REAL docActParseFilterDialog from source on dialog texts (old layout + the layout in the user's screenshot).
const fs=require("fs"),path=require("path");
const src=fs.readFileSync(path.join(__dirname,"..","console-decorate.extension.js"),"utf8");
const ops=src.slice(src.indexOf("var DOCACT_FILTER_OPS"),src.indexOf("];",src.indexOf("var DOCACT_FILTER_OPS"))+2);
const a=src.indexOf("function docActParseFilterDialog(dialogText) {");
const b=src.indexOf("\n      }\n",a)+9;
const parse=new Function(ops+"\n"+src.slice(a,b)+"\nreturn docActParseFilterDialog;")();
let pass=0,fail=0;const ok=(n,c,x)=>{c?pass++:fail++;console.log((c?"  ✓ ":"  ✗ ")+n+(c||!x?"":" -> "+x))};
const P='Filter "Contact Point Email" Attributes\nCancel\nSave\nAttributes\nTo determine which contact points are chosen for a member, select attributes to filter the contact points.\nPath\nUnified Individual TDI.Unified Individual Id > Individual.Individual Id > Contact Point Email.Party\nAttributes (1)\nEmail Address\n';
// old layout (has "Drag and drop")
let r=parse(P+'Contact Point Email:\nDrag and drop\nEmail Address\nHas Value\nAdd another Attribute here');
ok("old layout: condition captured",r&&r.conditions.length===1&&r.conditions[0].field==="Email Address"&&r.conditions[0].operator==="Has Value",JSON.stringify(r));
// screenshot layout: no "Drag and drop"
r=parse(P+'Contact Point Email:\nEmail Address\nHas Value\nAdd another Attribute here');
ok("screenshot layout (no 'Drag and drop'): condition captured",r&&r.conditions.length===1&&r.conditions[0].field==="Email Address"&&r.conditions[0].operator==="Has Value",JSON.stringify(r));
ok("entity label + path still read",r&&r.entityLabel==="Contact Point Email"&&/Unified Individual/.test(r.path));
// two conditions
r=parse(P+'Contact Point Email:\nEmail Address\nHas Value\nParty\nIs Not Null\nAdd another Attribute here');
ok("two conditions captured",r&&r.conditions.length===2,JSON.stringify(r&&r.conditions));
// closing-animation frame (no span) must not invent a condition
r=parse('Filter "Contact Point Email" Attributes\nPath\nX.Id > Y.Id\nAttributes (1)');
ok("transition frame: no invented condition",r&&r.conditions.length===0,JSON.stringify(r));
ok("empty text → null",parse("")===null);
console.log(fail?"\n❌ "+fail+" failed":"\n✅ ALL PASS: "+pass);process.exit(fail?1:0);
