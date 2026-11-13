// Behavior: qeToTsv keeps every value in ONE cell for Sheets/Excel; QE results modal wiring.
const fs = require("fs"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../console-decorate.extension.js", "utf8");
const i = src.indexOf("  function qeToTsv(cols, rows)"), j = src.indexOf("  function openQeJsonModal");
const qeToTsv = new Function(src.slice(i, j) + "; return qeToTsv;")();
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const t = qeToTsv(["A", "B"], [{ A: "x", B: null }, { A: "a\tb", B: 'say "hi"\nnow' }, { A: 5, B: { k: 1 } }]);
const lines = t.split("\n");
ok(lines[0] === "A\tB", "header row");
ok(lines[1] === "x\t", "null -> empty cell");
ok(t.indexOf('"a\tb"\t"say ""hi""\nnow"') > 0, "tab/quote/newline values quoted, quotes doubled");
ok(t.endsWith('5\t"{""k"":1}"'), "numbers plain, objects as quoted JSON (stays one cell)");
ok(qeToTsv(["A"], []) === "A", "empty rows -> header only");
const k = src.indexOf("function openQeJsonModal");
ok(/showCellValue\(colName \|\| "value"/.test(src.slice(k, k + 600)), "QE JSON button opens the shared readable viewer");
ok(/Copy for Sheets/.test(src) && /Full screen \/ back/.test(src.slice(src.indexOf("dc-qe-results-modal") - 200)), "results modal has Copy for Sheets + full screen");
console.log("qe-sheets-copy: " + n + " checks passed");
