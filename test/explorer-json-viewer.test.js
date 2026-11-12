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
// --- Data Graph live reload: response unwrapping + the exact request we send (stubbed fetch/session)
const g0 = src.indexOf("  function dcExtractGraphJson"), g1 = src.indexOf("  // >100 rows: the Data Explorer's own query");
ok(g0 > 0 && g1 > g0, "graph helpers found");
const calls = [];
const G = new Function("_auraSniff", "fetch", "var _auraQid=0;" + src.slice(g0, g1) + "; return {dcExtractGraphJson,dcQueryDataGraph};")(
  { context: "CTX", token: "TOK", pageURI: "PG" },
  (url, o) => { calls.push({ url, body: decodeURIComponent(o.body.split("&")[0].slice(8)) }); const n = calls.length;
    const bad = n === 1 && globalThis.__failFirst;
    return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ actions: [bad ? { state: "ERROR", error: [{ message: "no such graph" }] } : { state: "SUCCESS", returnValue: { dataGraphJson: JSON.stringify({ Id__c: "n" + n }) } }] })) }); });
ok(G.dcExtractGraphJson('{"a":1}').a === 1, "string json");
ok(G.dcExtractGraphJson({ x: '{"a":2}' }).a === 2, "json string inside wrapper");
ok(G.dcExtractGraphJson({ jsonBlob: { a: 3 }, other: 1 }).a === 3, "named object property");
ok(G.dcExtractGraphJson({ a: 4 }).a === 4, "object itself");
ok(G.dcExtractGraphJson("nope") === undefined, "non-json string -> undefined");
(async () => {
  const live = { objectName: "TDI_Unified_Profile_SFP_RT__dlm", dataSpace: "TD_Insurance", keyField: "Id__c", keyValue: "abc" };
  let r = await G.dcQueryDataGraph(live, true);
  const act = JSON.parse(calls[0].body).actions[0];
  assert.strictEqual(act.params.noCache, true); n++;
  assert.strictEqual(act.params.lookupKeys, "[Id__c=abc]"); n++;
  assert.strictEqual(act.params.objectName, "TDI_Unified_Profile_SFP_RT"); n++;
  assert.strictEqual(act.params.dataSpaceName, "TD_Insurance"); n++;
  assert(/queryDataGraphWithLookupKeys=1/.test(calls[0].url) && /ACTION\$queryDataGraphWithLookupKeys/.test(act.descriptor)); n++;
  assert.strictEqual(r.Id__c, "n1"); n++;
  await G.dcQueryDataGraph(live, false); assert.strictEqual(JSON.parse(calls[1].body).actions[0].params.noCache, false); n++;
  // trimmed name rejected -> retries with the exact name
  calls.length = 0; globalThis.__failFirst = true;
  r = await G.dcQueryDataGraph(live, false);
  assert.strictEqual(calls.length, 2); assert.strictEqual(JSON.parse(calls[1].body).actions[0].params.objectName, "TDI_Unified_Profile_SFP_RT__dlm"); n++;
  // wrong data space first -> falls through to the next candidate and REMEMBERS the winner
  calls.length = 0; globalThis.__failFirst = true;
  const live2 = { objectName: "G", dataSpace: "wrong", keyField: "Id__c", keyValue: "z" };
  const G2 = new Function("_auraSniff", "fetch", "function dataSpaceCandidates(){return ['TD_Insurance','default']}var _auraQid=0;" + src.slice(g0, g1) + "; return {dcQueryDataGraph};")(
    { context: "C", token: "T" }, (url, o) => { calls.push(decodeURIComponent(o.body.split("&")[0].slice(8))); const ok = calls.length > 1;
      return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ actions: [ok ? { state: "SUCCESS", returnValue: { a: 1 } } : { state: "ERROR", error: [{ message: "bad" }] }] })) }); });
  await G2.dcQueryDataGraph(live2, true);
  assert.strictEqual(JSON.parse(calls[1]).actions[0].params.dataSpaceName, "TD_Insurance"); n++;
  assert.deepStrictEqual(live2._ok, { name: "G", space: "TD_Insurance" }); n++;
  calls.length = 0; await G2.dcQueryDataGraph(live2, false);
  assert.strictEqual(JSON.parse(calls[0]).actions[0].params.dataSpaceName, "TD_Insurance"); n++;   // winner tried first next time
  // all fail -> error lists what was tried
  const G3 = new Function("_auraSniff", "fetch", "var _auraQid=0;" + src.slice(g0, g1) + "; return {dcQueryDataGraph};")({ context: "C", token: "T" },
    () => Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ actions: [{ state: "ERROR", error: [{ message: "bad" }] }] })) }));
  await G3.dcQueryDataGraph({ objectName: "G__dlm", dataSpace: "S", keyField: "Id__c", keyValue: "z" }, true).then(() => assert.fail("should reject"), e => { assert(/bad \[tried G @ S; G__dlm @ S\]/.test(e.message), e.message); n++; });
  console.log("explorer-json-viewer: " + n + " checks passed");
})().catch(e => { console.error(e); process.exit(1); });
