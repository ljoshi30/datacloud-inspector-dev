// The "Data 360 Inspector turned off" toast must sit on the LEFT so it never covers the FAB launcher (bottom-right).
const fs=require("fs");let f=0;
for(const file of ["console-decorate.extension.js","console-decorate.bookmarklet.js"]){
  const s=fs.readFileSync(__dirname+"/../"+file,"utf8");
  const m=s.match(/_offT\.style\.cssText = "([^"]+)"/);
  const css=m&&m[1];
  const ok=css&&/bottom:24px/.test(css)&&/left:24px/.test(css)&&!/right:\s*\d/.test(css);
  console.log((ok?"  ✓ ":"  ✗ ")+file+" off-toast is bottom-left, not right");if(!ok)f++;
}
process.exit(f?1:0);
