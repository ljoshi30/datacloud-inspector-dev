// Behavior: the streaming .xlsx writer produces a structurally valid, multi-sheet workbook.
// We read the bytes back with an independent zip reader (central directory + zlib inflate + CRC check).
const fs = require("fs"), zlib = require("zlib"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../console-decorate.extension.js", "utf8");
const i = src.indexOf("    function dcXlsxStream("), j = src.indexOf("    function qeCanXlsx");
const dcXlsxStream = new Function(src.slice(i, j) + ";return dcXlsxStream;")();
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
function crc32(b) { let c = ~0; for (let k = 0; k < b.length; k++) { c ^= b[k]; for (let m = 0; m < 8; m++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), cnt = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const files = {}; let p = cdOff;
  for (let e = 0; e < cnt; e++) {
    assert(buf.readUInt32LE(p) === 0x02014b50, "central header sig");
    const crc = buf.readUInt32LE(p + 16), cs = buf.readUInt32LE(p + 20), us = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString();
    assert(buf.readUInt32LE(off) === 0x04034b50, "local header sig");
    const lnl = buf.readUInt16LE(off + 26), lex = buf.readUInt16LE(off + 28), ds = off + 30 + lnl + lex;
    const data = zlib.inflateRawSync(buf.slice(ds, ds + cs));
    assert(data.length === us && crc32(data) === crc, "size+crc match for " + name);
    files[name] = data.toString("utf8"); p += 46 + nl;
  }
  return files;
}
(async () => {
  const chunks = []; let closed = 0;
  const out = { write: b => { chunks.push(Buffer.from(b)); return Promise.resolve(); }, close: () => { closed++; return Promise.resolve(); } };
  const x = dcXlsxStream(out, 3); x.setCols(["Id", "Name", "Amt"]);
  await x.addRows([["001", "a&b <x>", 5], [null, "tab\there", 1.5]]);
  await x.addRows([["3", "line\nbreak", true], ["4", "é中", 0], ["5", "x", 7], ["6", "y", 8], ["7", "z", 9]]);
  await x.close();
  const z = readZip(Buffer.concat(chunks));
  ok(closed === 1, "file closed once");
  ok(Object.keys(z).filter(k => /worksheets\/sheet\d+\.xml$/.test(k)).length === 3, "7 rows at 3 per sheet -> 3 sheets");
  ok(/Rows 1-3/.test(z["xl/workbook.xml"]) && /Rows 4-6/.test(z["xl/workbook.xml"]) && /Rows 7-7/.test(z["xl/workbook.xml"]), "sheet names carry the row range");
  const s1 = z["xl/worksheets/sheet1.xml"];
  ok((s1.match(/<row>/g) || []).length === 4, "header + 3 data rows on sheet 1");
  ok(/a&amp;b &lt;x&gt;/.test(s1), "XML-escaped text");
  ok(/<c s='2' t='inlineStr'><is><t xml:space='preserve'>001<\/t><\/is><\/c>/.test(s1), "leading-zero id stays text");
  ok(/<c><v>5<\/v><\/c>/.test(s1) && /<c><v>1.5<\/v><\/c>/.test(s1), "real numbers are numeric cells");
  ok(/<row><c\/>/.test(s1) || /<c\/><c s='2' t='inlineStr'>/.test(s1), "null keeps its column position (empty cell)");
  ok(/<c t='b'><v>1<\/v><\/c>/.test(s1), "boolean cell");
  ok(/<pane ySplit='1'/.test(z["xl/worksheets/sheet2.xml"]) && /Id/.test(z["xl/worksheets/sheet2.xml"]), "header repeated + frozen on every sheet");
  ok(/autoFilter ref='A1:C4'/.test(s1) && /autoFilter ref='A1:C2'/.test(z["xl/worksheets/sheet3.xml"]), "filter range matches each sheet's rows");
  ok(/sheet3\.xml/.test(z["[Content_Types].xml"]) && /sheet3\.xml/.test(z["xl/_rels/workbook.xml.rels"]), "all sheets registered");
  // cancel before any row: still a valid single-sheet workbook
  const c2 = []; const y = dcXlsxStream({ write: b => { c2.push(Buffer.from(b)); return Promise.resolve(); }, close: () => Promise.resolve() }, 5); y.setCols(["A"]); await y.close();
  const z2 = readZip(Buffer.concat(c2));
  ok(Object.keys(z2).some(k => /sheet1\.xml$/.test(k)) && /sheetId='1'/.test(z2["xl/workbook.xml"]), "zero rows -> one empty sheet, still valid");
  // long text is clipped to Excel's cell limit
  const c3 = []; const w = dcXlsxStream({ write: b => { c3.push(Buffer.from(b)); return Promise.resolve(); }, close: () => Promise.resolve() }, 5); w.setCols(["A"]);
  await w.addRows([["x".repeat(40000)]]); await w.close();
  ok(/x{32767}<\/t>/.test(readZip(Buffer.concat(c3))["xl/worksheets/sheet1.xml"]) && !/x{32768}/.test(readZip(Buffer.concat(c3))["xl/worksheets/sheet1.xml"]), "cell text clipped to 32,767 chars");

  // END-TO-END through the real export engine (extension-cursor path stubbed): 2,500 rows, 1,000 per sheet
  {
    const a = src.indexOf("    function dcXlsxStream("), a2 = src.indexOf("    function qeCanXlsx"), b = src.indexOf("    // DEBUG (dev-only"), e0 = src.indexOf("    function qeCanStream");
    const eng = src.slice(a, a2) + src.slice(e0, b);
    const bytes = []; const handle = { createWritable: () => Promise.resolve({ write: v => { bytes.push(Buffer.from(v)); return Promise.resolve(); }, close: () => Promise.resolve() }) };
    const rowsAll = []; for (let r = 0; r < 2500; r++) rowsAll.push(["id" + r, r]);
    const env = { extBridgePresent: () => true, DC_PAGE_SIZE: 1000, window: {}, _auraSniff: {}, dataSpaceCandidates: () => [], dcLearnSpace: () => {},
      runDcSqlViaBridge: () => Promise.resolve({ metadata: [{ name: "Id" }, { name: "N" }], data: rowsAll.slice(0, 1000), rowCount: 2500, queryId: "q" }),
      fetchPageViaBridge: (q, off) => Promise.resolve({ data: rowsAll.slice(off, off + 1000) }) };
    const fn = new Function(...Object.keys(env), eng + "; return qeStreamFullExport;")(...Object.values(env));
    let prog = 0;
    const res = await fn("SELECT * FROM t", "default", handle, () => { prog++; }, () => false, null, 2500, { sheetRows: 1000 });
    ok(res.totalRows === 2500 && res.sheets === 3 && !res.incomplete, "engine: 2500 rows at 1000/sheet -> 3 sheets, complete");
    const zz = readZip(Buffer.concat(bytes));
    const cnt = k => (zz["xl/worksheets/sheet" + k + ".xml"].match(/<row>/g) || []).length - 1;
    ok(cnt(1) === 1000 && cnt(2) === 1000 && cnt(3) === 500, "engine: rows continue across sheets 1000/1000/500 (no loss, no duplicate)");
    ok(/id2499/.test(zz["xl/worksheets/sheet3.xml"]) && /id1000</.test(zz["xl/worksheets/sheet2.xml"]) && !/id999</.test(zz["xl/worksheets/sheet2.xml"]), "engine: row order preserved across sheets");
    // user cancel mid-way still leaves a readable workbook
    const bytes2 = []; const h2 = { createWritable: () => Promise.resolve({ write: v => { bytes2.push(Buffer.from(v)); return Promise.resolve(); }, close: () => Promise.resolve() }) };
    let calls = 0; const res2 = await fn("SELECT * FROM t", "default", h2, () => {}, () => ++calls > 2, null, 2500, { sheetRows: 1000 });
    ok(res2.cancelled && Object.keys(readZip(Buffer.concat(bytes2))).length > 3, "engine: cancelled export is still a valid workbook");
  }
  // wiring
  ok(/function qeStreamFullExport\([^)]*expected, xl\)/.test(src) && /if \(xl\) \{ xw\.setCols\(cols\)/.test(src) && /startExportStream\(\{ xlsx: true/.test(src), "export engine + UI wired to the workbook option");
  console.log("qe-xlsx-stream: " + n + " checks passed");
})().catch(e => { console.error(e); process.exit(1); });
