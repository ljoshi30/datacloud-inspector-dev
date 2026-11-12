// Behavior test: Explorer "Export All" must never promise "everything" when the table is bigger than the cap.
// Runs the REAL dcExportCapInfo source (extracted from console-decorate.extension.js), not a copy.
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
function grab(startMarker, endMarker) {
  const a = src.indexOf(startMarker); assert(a >= 0, "missing " + startMarker);
  const b = src.indexOf(endMarker, a); assert(b > a, "missing " + endMarker);
  return src.slice(a, b);
}
const block = grab("  var DC_MAX_TOTAL_EXPORT = 500000;", "  // Paginated CSV export:");
function load(devBuild) {
  let code = block;
  if (!devBuild) code = code.replace(/\/\* @strip:start dev \*\/[\s\S]*?\/\* @strip:end \*\//, "");
  return new Function(code + "; return {cap: DC_MAX_TOTAL_EXPORT, info: dcExportCapInfo};")();
}
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
for (const dev of [false, true]) {
  const { cap, info } = load(dev);
  ok(cap === 500000, "cap is 500,000");
  // Table bigger than the cap
  const big = info(1961698);
  ok(big.capped, "1.96M is over the cap");
  ok(/first 500,000 of 1,961,698/.test(big.label), "label states the cap and the real total: " + big.label);
  ok(!/Export All/.test(big.label), "label must not say 'Export All' for a capped table");
  ok(/at most the first 500,000/.test(big.confirmMsg) && /1,961,698/.test(big.confirmMsg), "confirm warns before downloading");
  ok(!/Download all 1,961,698/.test(big.confirmMsg), "confirm must not promise all rows");
  ok(/first 500,000 rows per export/.test(big.tip), "tooltip states limit");
  ok(/first 500,000 rows of 1,961,698/.test(big.doneLabel(500000)), "done label says partial: " + big.doneLabel(500000));
  ok(/500,000 rows only/.test(big.infoSuffix) && !/download everything/.test(big.infoSuffix), "info line says first 500,000 only");
  ok(/slices using a filter/.test(big.confirmMsg), "tells the user how to get the rest");
  ok(/Query Editor/.test(big.confirmMsg) === dev, "Query Editor hint appears only in the dev build (dev=" + dev + ")");
  // Boundary: exactly the cap is NOT capped; one more row IS
  ok(!info(500000).capped && info(500000).label === "⬇ Export All (500,000 rows)", "exactly 500,000 is a full export");
  ok(info(500001).capped, "500,001 is capped");
  // Small table keeps the original wording
  const small = info(12345);
  ok(small.label === "⬇ Export All (12,345 rows)" && /Download all 12,345 rows/.test(small.confirmMsg), "small table unchanged");
  ok(small.doneLabel(12345) === "✓ Exported 12,345 rows", "small done label: " + small.doneLabel(12345));
  // Unknown total (no Count yet): must not claim "all"
  const unk = info(0);
  ok(unk.label === "⬇ Export All" && /up to 500,000 rows/.test(unk.confirmMsg) && !/ALL records/.test(unk.confirmMsg), "unknown total says 'up to 500,000'");
}
// Wiring: the old misleading strings are gone from the source
ok(!/Download EVERY row of this object/.test(src), "old 'EVERY row' tooltip removed");
ok(!/to download everything as CSV";/.test(src.replace(block, "")), "old 'download everything' info removed outside the helper");
ok(!/Export All downloads the whole table/.test(src), "old 'whole table' tooltip removed");
ok(!/use Export All for every row/.test(src), "old 'every row' hint removed");
ok(/exportAllBtn\.textContent = capInfo\.doneLabel\(res\.totalRows\)/.test(src), "done label wired");
ok(/var confirmMsg = capInfo\.confirmMsg/.test(src), "confirm wired");
console.log("explorer-export-cap-label: " + n + " checks passed");
