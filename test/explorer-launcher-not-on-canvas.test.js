// Regression: the Data Explorer launcher must NOT appear on the Mapping Canvas (or any other
// one.app hash page) just because a stale Explorer record-list component is still mounted.
// Runs the REAL isDataExplorePage / decodeHashRoute / urlDefinitePageType from the source.
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");
let pass = 0, fail = 0;
function ok(n, c, x) { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  -> " + x : "")); } }
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("missing " + name);
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } }
}
const b64 = o => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const CANVAS = "https://x.lightning.force.com/one/one.app#" + b64({ componentDef: "c:cdpMappingCanvas", attributes: { recordId: "1dFxx0000000001" }, state: {} });
const EXPLORER = "https://x.lightning.force.com/one/one.app#" + b64({ componentDef: "one:alohaPage", attributes: { address: "/lightning/o/x?c__dataViewTab=1" }, dataViewTab: "x" });
function build(state) {
  const body = ["decodeHashRoute", "urlDefinitePageType", "urlIsOtherDetailPage", "isDataExplorePage"].map(grab).join("\n");
  return new Function("state", `
    const location = { get href() { return state.href; } };
    const TAGGING_CMP = "runtime_cdp-data-stream-tagging-container";
    function isVisible(el) { return !!el.visible; }
    function findRecordListEl() { return state.recordList || null; }
    function findVisibleByTag(t) { return (state.visibleTags || []).includes(t) ? [{}] : []; }
    function eachElement() {}
    ${body}
    return isDataExplorePage;`)(state);
}
const t = (state) => build(state)();
console.log("\n1. Mapping Canvas with a STALE Explorer record list still mounted");
ok("canvas hash + stale (hidden) record list → NOT Explorer", t({ href: CANVAS, recordList: { visible: false } }) === false);
ok("canvas hash + stale record list that still reports visible → NOT Explorer (URL is authoritative)", t({ href: CANVAS, recordList: { visible: true } }) === false);
ok("canvas hash + visible canvas component → NOT Explorer", t({ href: CANVAS, recordList: { visible: true }, visibleTags: ["runtime_cdp-data-stream-tagging-container"] }) === false);
console.log("\n2. Real Data Explorer still works");
ok("Explorer hash (dataViewTab) → Explorer", t({ href: EXPLORER, recordList: { visible: true } }) === true);
ok("non-hash URL + VISIBLE record list → Explorer (fallback unchanged)", t({ href: "https://x.lightning.force.com/lightning/n/Foo", recordList: { visible: true } }) === true);
console.log("\n3. Fallback is stricter");
ok("non-hash URL + HIDDEN record list → NOT Explorer", t({ href: "https://x.lightning.force.com/lightning/n/Foo", recordList: { visible: false } }) === false);
ok("non-hash URL + visible record list but Mapping Canvas visible → NOT Explorer", t({ href: "https://x.lightning.force.com/lightning/n/Foo", recordList: { visible: true }, visibleTags: ["runtime_cdp-data-stream-tagging-container"] }) === false);
ok("no record list at all → NOT Explorer", t({ href: "https://x.lightning.force.com/lightning/n/Foo" }) === false);
console.log("\n4. Pre-existing exclusions still hold");
ok("/o/<Obj>/list → NOT Explorer", t({ href: "https://x.lightning.force.com/lightning/o/Account/list", recordList: { visible: true } }) === false);
ok("DataStream record page → NOT Explorer", t({ href: "https://x.lightning.force.com/lightning/r/DataStream/1234567890abcde/view", recordList: { visible: true } }) === false);
ok("garbage hash that fails to decode falls back to DOM, no throw", (function () { try { return typeof t({ href: "https://x/one.app#!!!notbase64!!!", recordList: { visible: false } }) === "boolean"; } catch (e) { return false; } })());
console.log(fail ? "\n❌ FAILURES: " + pass + " passed, " + fail + " failed" : "\n✅ ALL PASS: " + pass + " passed, 0 failed");
process.exit(fail ? 1 : 0);
