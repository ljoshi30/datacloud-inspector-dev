// Behavior test: runs the REAL qeStreamFullExport (extracted from source) against in-memory fake
// file/folder handles. Extension-cursor path is used as the data source (deterministic paging).
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : (fail++, console.log("  ✗ FAIL:", m)); if (c) console.log("  ✓", m); };
function grabFn(name) { const i = src.indexOf("    function " + name + "("); if (i < 0) throw new Error("missing " + name); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } } }
const fnSrc = grabFn("qeStreamFullExport");

function mkEnv(totalRows, opts) {
  opts = opts || {};
  const PAGE = 49999;
  const files = {};
  const mkWritable = (name) => { files[name] = { chunks: [], closed: false }; return { write: async (s) => { if (opts.failWriteAt && Object.keys(files).length >= opts.failWriteAt && files[name].chunks.length > 2) throw new Error("disk full"); files[name].chunks.push(s); }, close: async () => { files[name].closed = true; } }; };
  const dir = { getFileHandle: async (name) => ({ createWritable: async () => mkWritable(name) }) };
  const single = { createWritable: async () => mkWritable("SINGLE.csv") };
  const mkRow = (i) => [i, "v" + i];
  const page = (off) => { const n = Math.max(0, Math.min(PAGE, totalRows - off)); const d = []; for (let i = 0; i < n; i++) d.push(mkRow(off + i)); return d; };
  let cancelAfterPages = opts.cancelAfterPages || 0, pages = 0;
  const env = {
    extBridgePresent: () => true, DC_PAGE_SIZE: PAGE,
    runDcSqlViaBridge: async () => ({ metadata: [{ name: "Id" }, { name: "Name" }], data: page(0), rowCount: totalRows, queryId: "q1" }),
    fetchPageViaBridge: async (q, off) => { pages++; return { data: page(off) }; },
  };
  const isCancelled = () => cancelAfterPages > 0 && pages >= cancelAfterPages;
  const run = new Function("env", "with(env){ return (" + fnSrc.replace(/^\s*function qeStreamFullExport/, "function") + "); }")(env);
  return { files, dir, single, run, isCancelled };
}
const text = (f) => f.chunks.join("");
const lines = (f) => text(f).split("\n").filter(Boolean);

(async () => {
  console.log("1. split: 2,500,000-style rotation at exact boundaries (small partRows for speed)");
  { const e = mkEnv(250000); const prog = [];
    const r = await e.run("SELECT * FROM t", "", null, (n, i) => prog.push([n, i]), () => false, { dirHandle: e.dir, partRows: 100000, baseName: "T_2026", folderName: "F" });
    const names = Object.keys(e.files).sort();
    ok(names.join() === "T_2026_part001.csv,T_2026_part002.csv,T_2026_part003.csv", "3 parts named part001..003 (got " + names + ")");
    ok(r.totalRows === 250000 && r.parts.length === 3, "result reports 250,000 rows / 3 parts");
    ok(lines(e.files[names[0]]).length === 100001 && lines(e.files[names[1]]).length === 100001 && lines(e.files[names[2]]).length === 50001, "100k+header, 100k+header, 50k+header");
    ok(names.every(n => lines(e.files[n])[0] === "Id,Name"), "every part has its own header");
    ok(names.every(n => e.files[n].closed), "every part closed (flushed)");
    const all = names.flatMap(n => lines(e.files[n]).slice(1)); const ids = all.map(l => +l.split(",")[0]);
    ok(ids.length === 250000 && ids.every((v, i) => v === i), "continuous: no gap, no duplicate, in order across parts");
    ok(prog.length > 0 && prog[prog.length - 1][0] === 250000, "progress reaches total"); }

  console.log("2. exact multiple: no empty trailing file");
  { const e = mkEnv(200000);
    const r = await e.run("SELECT * FROM t", "", null, null, () => false, { dirHandle: e.dir, partRows: 100000, baseName: "B", folderName: "F" });
    ok(Object.keys(e.files).length === 2 && r.parts.length === 2, "exactly 2 files for exactly 200,000 rows (got " + Object.keys(e.files).length + ")"); }

  console.log("3. one row over a boundary → 2nd file holds just that row");
  { const e = mkEnv(100001);
    await e.run("SELECT * FROM t", "", null, null, () => false, { dirHandle: e.dir, partRows: 100000, baseName: "B", folderName: "F" });
    const n = Object.keys(e.files).sort();
    ok(n.length === 2 && lines(e.files[n[1]]).length === 2 && lines(e.files[n[1]])[1].startsWith("100000,"), "part002 = header + the single remaining row"); }

  console.log("4. smaller than one part → single part file");
  { const e = mkEnv(500);
    const r = await e.run("SELECT * FROM t", "", null, null, () => false, { dirHandle: e.dir, partRows: 100000, baseName: "B", folderName: "F" });
    ok(Object.keys(e.files).length === 1 && r.totalRows === 500, "1 file, 500 rows"); }

  console.log("5. user LIMIT is respected across parts");
  { const e = mkEnv(300000);
    const r = await e.run("SELECT * FROM t LIMIT 150000", "", null, null, () => false, { dirHandle: e.dir, partRows: 100000, baseName: "B", folderName: "F" });
    ok(r.totalRows === 150000 && Object.keys(e.files).length === 2, "150,000 rows over 2 files"); }

  console.log("6. cancel mid-run: earlier parts complete & closed, result flagged cancelled");
  { const e = mkEnv(400000, { cancelAfterPages: 3 });
    const r = await e.run("SELECT * FROM t", "", null, null, e.isCancelled, { dirHandle: e.dir, partRows: 100000, baseName: "B", folderName: "F" });
    ok(r.cancelled === true && r.totalRows > 0 && r.totalRows < 400000, "cancelled partial (" + r.totalRows + " rows)");
    ok(Object.values(e.files).every(f => f.closed), "all files closed on cancel (nothing left locked)");
    const n = Object.keys(e.files).sort();
    ok(n.slice(0, -1).every(k => lines(e.files[k]).length === 100001), "all but the last part are full"); }

  console.log("7. mid-run failure (disk full): error carries completed parts + rows written");
  { const e = mkEnv(400000, { failWriteAt: 2 });
    let err = null; try { await e.run("SELECT * FROM t", "", null, null, () => false, { dirHandle: e.dir, partRows: 100000, baseName: "B", folderName: "F" }); } catch (x) { err = x; }
    ok(err && /disk full/.test(err.message), "rejects with the real error");
    ok(err && Array.isArray(err.partsDone) && err.partsDone.length >= 1 && err.rowsWritten > 0, "error lists parts already saved (" + (err && err.partsDone) + ")"); }

  console.log("8. REGRESSION: normal single-file export unchanged (no split arg)");
  { const e = mkEnv(120000);
    const r = await e.run("SELECT * FROM t", "", e.single, null, () => false);
    ok(lines(e.files["SINGLE.csv"]).length === 120001 && lines(e.files["SINGLE.csv"])[0] === "Id,Name" && e.files["SINGLE.csv"].closed, "one file, one header, all rows, closed");
    ok(r.parts.length === 0, "no parts reported in single mode"); }


  console.log("9. BOOKMARKLET path (LIMIT/OFFSET via /aura) with split — the path real users run");
  { const TOTAL = 230000, PAGE = 49999; const files = {};
    const mkW = (n) => { files[n] = { chunks: [], closed: false }; return { write: async (x) => { files[n].chunks.push(x); }, close: async () => { files[n].closed = true; } }; };
    const dir = { getFileHandle: async (n) => ({ createWritable: async () => mkW(n) }) };
    const offsets = [];
    const env = { extBridgePresent: () => false, _auraSniff: { context: "c", token: "t", pageURI: "/p" }, _auraQid: 0, dataSpaceCandidates: () => ["default"], DC_PAGE_SIZE: PAGE,
      fetch: async (url, o) => { const msg = JSON.parse(decodeURIComponent(/message=([^&]*)/.exec(o.body)[1])); const sql = msg.actions[0].params.sql;
        const lim = +/LIMIT (\d+)/.exec(sql)[1], off = (/OFFSET (\d+)/.exec(sql) || [0, 0])[1] | 0; offsets.push(off);
        const n = Math.max(0, Math.min(lim, TOTAL - off, PAGE)); const rows = []; for (let i = 0; i < n; i++) rows.push([off + i, "v"]);
        return { text: async () => JSON.stringify({ actions: [{ state: "SUCCESS", returnValue: { metadata: [{ name: "Id" }, { name: "Name" }], dataRows: rows, status: { completionStatus: "Finished", rowsProcessed: TOTAL } } }] }) }; } };
    const run = new Function("env", "with(env){ return (" + fnSrc.replace(/^\s*function qeStreamFullExport/, "function") + "); }")(env);
    const r = await run("SELECT * FROM t", "default", null, null, () => false, { dirHandle: dir, partRows: 100000, baseName: "BM", folderName: "F" });
    const n = Object.keys(files).sort();
    ok(r.totalRows === TOTAL && n.length === 3, "230,000 rows over 3 parts via OFFSET paging (got " + r.totalRows + " / " + n.length + ")");
    const ids = n.flatMap(k => files[k].chunks.join("").split("\n").filter(Boolean).slice(1)).map(l => +l.split(",")[0]);
    ok(ids.length === TOTAL && ids.every((v, i) => v === i), "bookmarklet path: continuous, no gap/dup across part boundaries");
    ok(n.every(k => files[k].closed && files[k].chunks.join("").startsWith("Id,Name\n")), "bookmarklet path: each part has header and is closed"); }

  console.log("\n" + (fail ? "✗ FAILED: " + fail : "✅ ALL PASS: " + pass));
  process.exit(fail ? 1 : 0);
})();
