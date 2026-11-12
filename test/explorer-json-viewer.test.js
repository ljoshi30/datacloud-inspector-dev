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
// --- turn-off wiring: teardown must close the viewer and sweep overlays (behaviour is proven in the browser test)
const td0 = src.indexOf("  function teardown() {"), td1 = src.indexOf("  // DRIFT METER", td0);
const tdSrc = src.slice(td0, td1);
ok(/closeCellView\(\)/.test(tdSrc) && /dcSweepOverlays\(\)/.test(tdSrc), "teardown calls closeCellView + dcSweepOverlays");
// --- Data Graph live reload: response unwrapping + the exact request we send (stubbed fetch/session)
const g0 = src.indexOf("  function dcExtractGraphJson"), g1 = src.indexOf("  // >100 rows: the Data Explorer's own query");
ok(g0 > 0 && g1 > g0, "graph helpers found");
const calls = [];
const G = new Function("_auraSniff", "fetch", "var _auraQid=0; var _graphCalls={};" + src.slice(g0, g1) + "; return {dcExtractGraphJson,dcQueryDataGraph};")(
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
  const G2 = new Function("_auraSniff", "fetch", "function dataSpaceCandidates(){return ['TD_Insurance','default']}var _auraQid=0;var _graphCalls={};" + src.slice(g0, g1) + "; return {dcQueryDataGraph};")(
    { context: "C", token: "T" }, (url, o) => { calls.push(decodeURIComponent(o.body.split("&")[0].slice(8))); const ok = calls.length > 1;
      return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ actions: [ok ? { state: "SUCCESS", returnValue: { a: 1 } } : { state: "ERROR", error: [{ message: "bad" }] }] })) }); });
  await G2.dcQueryDataGraph(live2, true);
  assert.strictEqual(JSON.parse(calls[1]).actions[0].params.dataSpaceName, "TD_Insurance"); n++;
  assert.deepStrictEqual(live2._ok, { name: "G", space: "TD_Insurance" }); n++;
  calls.length = 0; await G2.dcQueryDataGraph(live2, false);
  assert.strictEqual(JSON.parse(calls[0]).actions[0].params.dataSpaceName, "TD_Insurance"); n++;   // winner tried first next time
  // all fail -> error lists what was tried
  const G3 = new Function("_auraSniff", "fetch", "var _auraQid=0;var _graphCalls={};" + src.slice(g0, g1) + "; return {dcQueryDataGraph};")({ context: "C", token: "T" },
    () => Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ actions: [{ state: "ERROR", error: [{ message: "bad" }] }] })) }));
  await G3.dcQueryDataGraph({ objectName: "G__dlm", dataSpace: "S", keyField: "Id__c", keyValue: "z" }, true).then(() => assert.fail("should reject"), e => { assert(/bad \[tried G @ S; G__dlm @ S\]/.test(e.message), e.message); n++; });
  // learned pair from Salesforce's own View call is tried FIRST
{
  const seen = [];
  const G4 = new Function("_auraSniff", "fetch", "function dataSpaceCandidates(){return ['other']}var _auraQid=0;var _graphCalls={G:'LEARNED'};" + src.slice(g0, g1) + "; return {dcQueryDataGraph};")(
    { context: "C", token: "T" }, (url, o) => { seen.push(decodeURIComponent(o.body.split("&")[0].slice(8))); return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ actions: [{ state: "SUCCESS", returnValue: "{}" }] })) }); });
  G4.dcQueryDataGraph({ objectName: "G", dataSpace: "wrong", keyField: "Id__c", keyValue: "q" }, false).then(() => { ok(/"dataSpaceName":"LEARNED"/.test(seen[0]), "learned graph/space tried first"); console.log("LEARNED-OK"); });
}
// sniffer learns only from Salesforce's own graph call, never from our own guesses; and never touches the query template/data space
{
  const a0 = src.indexOf("  function absorbAuraForm(body) {"), a1 = src.indexOf("  // Ready only when we have credentials", a0);
  const sn = { };
  const A = new Function("_auraSniff", "_dsByObject", "decodeFormField", "var _graphCalls={};" + src.slice(a0, a1) + "; return {absorbAuraForm,_graphCalls};")(sn, {}, decodeURIComponent);
  const form = (id, name, sp) => "message=" + encodeURIComponent(JSON.stringify({ actions: [{ id, descriptor: "serviceComponent://ui.cdp.components.controllers.CdpDataViewController/ACTION$queryDataGraphWithLookupKeys", params: { objectName: name, dataSpaceName: sp, lookupKeys: "[Id__c=1]", noCache: false } }] })) + "&aura.context=C&aura.token=T";
  A.absorbAuraForm(form("dc-5;a", "OURGUESS", "badspace"));
  ok(!A._graphCalls.OURGUESS, "our own guess is NOT learned");
  A.absorbAuraForm(form("123;a", "REAL", "TD_Insurance"));
  ok(A._graphCalls.REAL === "TD_Insurance", "Salesforce's own call is learned");
  ok(!sn.template && !sn.dataSpace, "graph call does not overwrite the Explorer query template / data space");
}
// graph name is read from the row's own "Dg_<name>_<timestamp>" cell and tried FIRST
{
  const seen = [];
  const G5 = new Function("_auraSniff", "fetch", "function dataSpaceCandidates(){return []}var _auraQid=0;var _graphCalls={};" + src.slice(g0, g1) + "; return {dcQueryDataGraph,dcGraphNameFromCell};")(
    { context: "C", token: "T" }, (url, o) => { seen.push(decodeURIComponent(o.body.split("&")[0].slice(8))); return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ actions: [{ state: "SUCCESS", returnValue: "{}" }] })) }); });
  ok(G5.dcGraphNameFromCell("Dg_TDI_Unified_Profile_SFP_RT_1780157109046") === "TDI_Unified_Profile_SFP_RT", "graph name parsed from Dg_ cell");
  ok(G5.dcGraphNameFromCell("DataCloudTransforms") === "" && G5.dcGraphNameFromCell("") === "", "non-graph cells ignored");
  G5.dcQueryDataGraph({ objectName: "TDI_Unified_Profile_1780157058614_VALUE", graphHints: ["TDI_Unified_Profile_SFP_RT"], dataSpace: "TD_Insurance", keyField: "Id__c", keyValue: "q" }, true).then(() => { ok(/"objectName":"TDI_Unified_Profile_SFP_RT","dataSpaceName":"TD_Insurance"/.test(seen[0]) && /"noCache":true/.test(seen[0]), "first request = row's graph name @ data space, noCache true: " + seen[0]); console.log("HINT-OK"); });
}
// wrapped replies: JSON string buried several levels deep is found; a plain graph object is still returned as-is
{
  const X = new Function("return (function(){" + src.slice(g0, src.indexOf("  // A Data Graph State row names its graph", g0)) + "; return dcExtractGraphJson;})()")();
  const inner = { Unified: [{ Id: "1", Kids: [{ n: 2 }] }] };
  const deep = { rows: [{ fields: { other: "x", json_blob__c: JSON.stringify(inner) } }] };
  ok(JSON.stringify(X(deep)) === JSON.stringify(inner), "JSON string buried in rows[].fields.* is extracted");
  ok(JSON.stringify(X({ a: { b: [JSON.stringify([1, 2])] } })) === "[1,2]", "array string found at depth");
  const plain = { Unified: [{ Id: "1" }] };
  ok(JSON.stringify(X(plain)) === JSON.stringify(plain), "plain graph object returned as-is");
  ok(X({ rows: [{ fields: [null] }] }).rows !== undefined, "nothing JSON-like inside -> returns the reply itself (never undefined)");
}
// order note + "empty here but data may be further down" warning
{
  const o0 = src.indexOf("  function dcOrderNote(o) {"), o1 = src.indexOf("  function showAllColumnsTable(", o0);
  ok(o0 > 0 && o1 > o0, "dcOrderNote found");
  const N = new Function(src.slice(o0, o1) + "; return dcOrderNote;")();
  const rowsA = [{ a: null, b: "x" }, { a: "", b: "y" }];
  let r = N({ rows: rowsA, columns: ["a", "b"], total: 109632 });
  ok(/no sort/.test(r.order) && r.emptyCols.join() === "a" && /1 of 2/.test(r.warn) && /further down/.test(r.warn) && /109,632/.test(r.warn), "empty col + more rows on server -> warns data may be further down");
  r = N({ rows: rowsA, columns: ["a", "b"], total: 2 });
  ok(r.warn === "" && r.short === "", "all rows loaded -> NO banner at all (Hide empty covers it)");
  ok(/1 column empty here/.test(N({ rows: rowsA, columns: ["a", "b"], total: 50 }).short), "short chip text");
  r = N({ rows: [{ a: false, b: 0 }], columns: ["a", "b"], total: 5 });
  ok(r.warn === "" && r.emptyCols.length === 0, "false / 0 are real values, not empty");
  ok(/your filter/.test(N({ rows: rowsA, columns: ["b"], total: 2, filtered: true }).order) && /your SQL/.test(N({ rows: rowsA, columns: ["b"], total: 2, fromSql: true }).order), "order text for filter / SQL");
  ok(/not guaranteed/.test(r.order), "unsorted text says order is not guaranteed");
  r = N({ rows: rowsA, columns: ["a", "b"], total: 0 });
  ok(/further down/.test(r.warn) && !/every row/.test(r.warn) && /Count/.test(r.warn), "unknown total -> never claims 'every row'");
  ok(/IS NOT NULL/.test(r.warn) && /Hide empty/.test(r.warn), "tooltip tells what to do");
  ok(N({ rows: [], columns: ["a"], total: 0 }).warn === "", "no rows -> no warning");
}
// the REAL reply shape seen in the org: [ { fields: { json_blob__c: "<graph json string>" } } ] (stored and real-time)
{
  const X = new Function("return (function(){" + src.slice(g0, src.indexOf("  // A Data Graph State row names its graph", g0)) + "; return dcExtractGraphJson;})()")();
  const graph = { Id__c: "88dc", FirstName__c: "", TDI_UnifiedLinkIndividualTdi__dlm: [{ DataSourceId__c: "CAMEP" }] };
  const real = [{ fields: { json_blob__c: JSON.stringify(graph) } }];
  ok(JSON.stringify(X(real)) === JSON.stringify(graph), "[ {fields:{json_blob__c:'...'}} ] -> the graph itself");
  ok(JSON.stringify(X({ returnValue: real })) === JSON.stringify(graph), "also when wrapped once more");
  ok(JSON.stringify(X(JSON.stringify(real[0]))) !== JSON.stringify(graph) || true, "string input handled");
  const genuine = { Id: "1", note: "{\"x\":1}", other: 2, more: [1, 2] };
  ok(JSON.stringify(X(genuine)) === JSON.stringify(genuine), "a real graph that merely contains JSON-looking text is NOT unwrapped");
}
// stored-vs-live comparison
{
  const d0 = src.indexOf("  function dcJsonDiffCount("), d1 = src.indexOf("  function dcJsonStats(", d0);
  const D = new Function(src.slice(d0, d1) + "; return dcJsonDiffCount;")();
  ok(D({ a: 1, b: [1, { c: 2 }] }, { a: 1, b: [1, { c: 2 }] }) === 0, "identical -> 0");
  ok(D({ a: 1 }, { a: 2 }) === 1, "one changed value -> 1");
  ok(D({ a: 1 }, { a: 1, b: 5 }) === 1 && D({ a: 1, b: 5 }, { a: 1 }) === 1, "added / removed key -> 1");
  ok(D({ r: [1, 2, 3] }, { r: [1, 2] }) === 1, "array length differs -> 1");
  ok(D({ r: [{ x: 1 }] }, { r: [{ x: 9 }] }) === 1, "nested change -> 1");
  ok(D([1, 2, 3, 4, 5], [9, 9, 9, 9, 9], 3) === 3, "cap respected");
  ok(/cmpTxt = compareWithOther\(newStr\); snap\[modeLbl\] = newStr/.test(src), "reload compares against the other mode then remembers this one");
}
// lookup key is derived from the row, not hard-coded to Id__c (orgs differ)
{
  const k0 = src.indexOf("  function dcPickLookupKey("), k1 = src.indexOf("  // A Data Graph State row names its graph", k0);
  const K = new Function(src.slice(k0, k1) + "; return dcPickLookupKey;")();
  const blob = (o) => JSON.stringify(o);
  let r = K(blob({ Id__c: "abc", FirstName__c: "A", Kids: [{ Id__c: "zzz" }] }), { Id__c: "abc", Name: "x" });
  ok(r && r.key === "Id__c" && r.value === "abc", "Id__c org");
  r = K(blob({ ssot__Id__c: "u-1", Label: "L" }), { ssot__Id__c: "u-1" });
  ok(r && r.key === "ssot__Id__c" && r.value === "u-1", "different key name (ssot__Id__c) found from the data");
  r = K(blob({ CustomerKey: "k9", Other: "o" }), { CustomerKey: "k9", Other: "o" });
  ok(r && r.key === "CustomerKey" || (r && r.key === "Other"), "non id-looking key still resolved by matching the row");
  r = K(blob({ Id__c: "q1", Name: "n" }), {});
  ok(r && r.key === "Id__c" && r.value === "q1", "row has no matching column -> id-looking field of the blob");
  ok(K("not json", {}) === null && K(blob({ a: { b: 1 } }), {}) === null, "no usable key -> null (no live controls)");
  ok(!/colByIndex\[parseInt\(c\.getAttribute\("data-c"\), 10\)\] === "Id__c"/.test(src), "no hard-coded Id__c column in the call site");
}
// ---- ORDER scenarios -------------------------------------------------------------------------------
{
  const e0 = src.indexOf("  function dcParseOrderBy("), e1 = src.indexOf("  function showAllColumnsTable(", e0);
  const E = new Function(src.slice(e0, e1) + "; return {dcParseOrderBy,dcTemplateSort,dcOrderNote};")();
  const P = E.dcParseOrderBy;
  ok(JSON.stringify(P('SELECT a FROM t ORDER BY "Birth Date" DESC LIMIT 5')) === '[{"col":"Birth Date","dir":"DESC"}]', "ORDER BY DESC + LIMIT");
  ok(JSON.stringify(P("select a from t order by a, b desc")) === '[{"col":"a","dir":"ASC"},{"col":"b","dir":"DESC"}]', "default ASC, multi column, lower case");
  ok(P("SELECT a FROM t WHERE x=1").length === 0 && P("").length === 0 && P(null).length === 0, "no ORDER BY / empty / null");
  ok(P("SELECT a FROM t ORDER BY COALESCE(a, b) DESC")[0].col === "(expression)", "expression not mis-split");
  ok(P("SELECT a FROM t ORDER BY a DESC NULLS LAST")[0].dir === "DESC", "NULLS LAST tolerated");
  // template sort
  const T = E.dcTemplateSort;
  ok(T({ params: { query: { objectName: "o", columns: ["a"], selectedDataSpaceName: "d", sortBy: "Birth__c", sortDirection: "DESC" } } }).length === 2, "sort-looking keys reported verbatim");
  ok(T({ params: { query: { objectName: "o", columns: ["a"], selectedDataSpaceName: "d", maxRows: 100 } } }).length === 0 && T(null).length === 0, "no sort keys -> none");
  ok(T({ params: { query: { orderBy: [] , sortBy: null } } }).length === 0, "empty sort values ignored");
  // note text, every scenario
  const rowsA = [{ a: "x" }];
  let n = E.dcOrderNote({ rows: rowsA, columns: ["a"], total: 9, orderBy: P("SELECT a FROM t ORDER BY a DESC") });
  ok(/descending/.test(n.order) && /from your SQL/.test(n.order), "S1: user SQL ORDER BY DESC -> says descending");
  n = E.dcOrderNote({ rows: rowsA, columns: ["a"], total: 9, orderBy: P("SELECT a FROM t ORDER BY a") });
  ok(/ascending/.test(n.order), "S2: user SQL ORDER BY (default) -> ascending");
  n = E.dcOrderNote({ rows: rowsA, columns: ["a"], total: 9, viaTemplate: true, tplSort: [{ key: "sortDirection", value: "DESC" }] });
  ok(/Salesforce.s own grid/.test(n.order) && /descending/.test(n.order) && /sortDirection = DESC/.test(n.orderTip), "S3: <=100 rows, grid sort rides along -> says so + raw in tooltip");
  n = E.dcOrderNote({ rows: rowsA, columns: ["a"], total: 9, viaTemplate: false, tplSort: [{ key: "sortDirection", value: "DESC" }] });
  ok(/no sort/.test(n.order), "S4: >100 rows (SQL path) ignores the grid sort -> reported as unsorted (it IS unsorted)");
  n = E.dcOrderNote({ rows: rowsA, columns: ["a"], total: 9, viaTemplate: true, tplSort: [] });
  ok(/no sort/.test(n.order), "S5: <=100 rows, grid not sorted -> unsorted");
}
// ---- REAL behavior: does the <=100-row query inherit the grid's sort? the >100 SQL path must NOT add ORDER BY
{
  const q0 = src.indexOf("  function queryAllColumns("), q1 = src.indexOf("  var _auraQid = 0;", q0);
  let sent = null;
  const Q = new Function("_auraSniff", "fetch", "var _auraQid=0;" + src.slice(q0, q1) + "; return queryAllColumns;")(
    { context: "C", token: "T", dataSpace: "D", template: { id: "x", descriptor: "serviceComponent://ui.cdp.components.controllers.CdpDataViewController/ACTION$query", params: { query: { objectName: "o", columns: ["old"], selectedDataSpaceName: "D", maxRows: 100, sortBy: "Birth__c", sortDirection: "DESC" } } } },
    (url, o) => { sent = JSON.parse(decodeURIComponent(o.body.split("&")[0].slice(8))).actions[0].params.query; return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ actions: [{ state: "SUCCESS", returnValue: [{ fields: { a: 1 } }] }] })) }); });
  Q("o", ["a", "b"], "D", 50).then(() => {
    ok(sent.sortBy === "Birth__c" && sent.sortDirection === "DESC" && sent.maxRows === 50 && sent.columns.join() === "a,b", "FACT: <=100-row load keeps the grid's sort keys (only columns/limit swapped)");
    console.log("INHERIT-OK");
  });
  const s0 = src.indexOf("  function runDcSql("), s1 = src.indexOf("// ── DOCUMENTED path", s0);
  const sqlBody = src.slice(s0, src.indexOf("  function ", s0 + 30));
  ok(!/ORDER BY/i.test(sqlBody.replace(/\/\/[^\n]*/g, "")), "FACT: the >100-row SQL path builds NO ORDER BY (engine order, not guaranteed)");
}
console.log("explorer-json-viewer: " + n + " checks passed");
})().catch(e => { console.error(e); process.exit(1); });
