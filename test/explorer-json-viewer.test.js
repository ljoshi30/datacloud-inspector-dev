// Behaviour tests for the Explorer JSON viewer's pure helpers (extracted from the real source and executed).
const fs = require("fs"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../console-decorate.extension.js", "utf8");
const a = src.indexOf("  function dcJsonPathStr(path)"), b = src.indexOf("  var _cellViewEl = null");
assert(a > 0 && b > a, "helpers found");
const H = new Function(src.slice(a, b) + "; return {dcJsonPathStr,dcJsonStats,dcJsonSearch,dcJsonTablePlan,dcJsonColorLine,dcJsonBytes};")();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const data = { Id: "1", Ok: true, N: null, L: [{ A: 1, Kids: [{ Phone: "+1", Deep: [{ X: 9 }] }, { Phone: "+2" }] }], E: [] };
const snap = JSON.stringify(data);
// path strings
ok(H.dcJsonPathStr(["L", 0, "A"]) === "$.L[0].A", "dot/index path");
ok(H.dcJsonPathStr(["a b", 1]) === '$["a b"][1]', "bracket path for odd keys");
// stats
const st = H.dcJsonStats(data); ok(st.depth === 7 && st.arrays === 4 && st.objects === 5, "stats " + JSON.stringify(st));
// table plan: nested found at ANY depth, merged, never mutates input, scalars split off
const plan = H.dcJsonTablePlan(data);
ok(JSON.stringify(data) === snap, "input not mutated");
ok(plan.scalars.map(s => s.k).join() === "Id,Ok,N", "scalars");
ok(plan.tabs.map(t => t.name).join() === "L,E,Kids,Deep", "tabs at every depth: " + plan.tabs.map(t => t.name));
const kids = plan.tabs.find(t => t.name === "Kids"); ok(kids.rows.length === 2 && kids.parent === "L" && kids.cols.join() === "Phone", "Kids tab");
ok(plan.tabs.find(t => t.name === "Deep").parent === "Kids", "Deep parent");
ok(plan.tabs.find(t => t.name === "E").rows.length === 0, "empty tab kept");
ok(H.dcJsonTablePlan([{ a: 1 }, { b: 2 }]).tabs[0].cols.join() === "a,b", "root array = one table, union columns");
ok(H.dcJsonTablePlan([1, 2]).tabs[0].cols.join() === "value", "scalar array");
// search opens ancestors only, case-insensitive, capped
const s = H.dcJsonSearch(data, "PHONE"); ok(s.hits === 2 && s.open["[]"] && s.open['["L"]'] && s.open['["L",0]'] && s.open['["L",0,"Kids"]'], "search opens path " + JSON.stringify(s));
ok(!s.open['["E"]'], "unrelated branch stays closed");
ok(H.dcJsonSearch(data, "").hits === 0, "empty query");
const big = { v: Array.from({ length: 5000 }, () => "aa") }; const sc = H.dcJsonSearch(big, "a", 300); ok(sc.hits === 300 && sc.capped, "cap");
// colouring: keys/strings/numbers/bool/null, escaped
const c = (l) => H.dcJsonColorLine(l, esc);
ok(c('  "k": "v<",') === "  <span class='k'>&quot;k&quot;</span>: <span class='s'>&quot;v&lt;&quot;</span>,", "string line " + c('  "k": "v<",'));
ok(/class='n'>-1.5e3/.test(c('"a": -1.5e3')) && /class='b'>true/.test(c('"a": true,')) && /class='z'>null/.test(c('"a": null')), "num/bool/null");
ok(/class='p'>\{/.test(c("{")) && /class='s'>&quot;x&quot;/.test(c('  "x"')), "brackets and array strings");
ok(H.dcJsonBytes(2048) === "2.0 KB", "bytes");
console.log("explorer-json-viewer: " + n + " checks passed");
