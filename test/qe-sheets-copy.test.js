// Behavior: qeToTsv keeps every value in ONE cell for Sheets/Excel; QE results modal wiring.
const fs = require("fs"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../console-decorate.extension.js", "utf8");
const pi = src.indexOf("  function qePrepResults("), i = src.indexOf("  function qeToTsv(cols, rows)"), j = src.indexOf("  function openQeJsonModal");
const qeToTsv = new Function(src.slice(i, j) + "; return qeToTsv;")();
const qePrep = new Function(src.slice(pi, i) + "; return qePrepResults;")();
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
// ---- readable spreadsheet prep (the real-world shape: JSON activation record in one column)
const data = [
  { Segmented_Entity_Id__c: "6c496f58", Activation_Record__c: '{"Id":"6c49","LastName":"Flynn","TDI_Is_Active_Customer":true,"nested":{"a":1}}', Amount: "12.50", Zip: "02134" },
  { Segmented_Entity_Id__c: "34b98563", Activation_Record__c: '{"Id":"34b9","LastName":"Rodriguez","Extra":"x"}', Amount: "7", Zip: "10001" },
  { Segmented_Entity_Id__c: "x", Activation_Record__c: null, Amount: "", Zip: "90210" }];
const pp = qePrep(["Segmented_Entity_Id__c", "Activation_Record__c", "Amount", "Zip"], data, true);
ok(pp.cols.join("|") === "Segmented_Entity_Id__c|Activation_Record__c.Id|Activation_Record__c.LastName|Activation_Record__c.TDI_Is_Active_Customer|Activation_Record__c.nested|Activation_Record__c.Extra|Amount|Zip", "JSON column expanded into one column per key (union, original order)");
ok(pp.rows[0]["Activation_Record__c.LastName"] === "Flynn" && pp.rows[1]["Activation_Record__c.LastName"] === "Rodriguez" && pp.rows[2]["Activation_Record__c.Id"] == null, "values land in the right rows; null JSON stays empty");
ok(pp.rows[0]["Activation_Record__c.nested"] === '{"a":1}', "nested object stays JSON text in its cell");
ok(pp.rows[0].Amount === 12.5 && pp.rows[1].Amount === 7, "all-numeric column becomes real numbers");
ok(pp.rows[0].Zip === "02134", "zip with leading zero stays text (column mixes leading-zero values)");
ok(pp.widths.length === pp.cols.length && pp.widths.every(w => w >= 10 && w <= 60), "a sensible width per column");
const off = qePrep(["Activation_Record__c"], data, false);
ok(off.cols.length === 1 && typeof off.rows[0].Activation_Record__c === "string", "expand off leaves the JSON column alone");
const mixed = qePrep(["C"], [{ C: '{"a":1}' }, { C: "plain text" }], true);
ok(mixed.cols.join() === "C", "a column that is only SOMETIMES a JSON object is not split");
console.log("qe-sheets-copy: " + n + " checks passed");
