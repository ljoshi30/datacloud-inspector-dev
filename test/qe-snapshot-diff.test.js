// QE activation-history snapshot + diff logic tests — run in Node.
//   node test/qe-snapshot-diff.test.js
//
// Phase 2 of the QE-team ask: retain a query result (snapshot) and compare a later
// run to a previous one — added / removed / changed rows — so day-over-day activation
// changes are visible. INDEPENDENT module (qeSnap*), dev-only. This tests the PURE
// diff + storage-key logic; the localStorage/UI wiring is exercised in-browser.
//
// The crux is ROW IDENTITY: a diff is only meaningful with a key. The user picks the
// key column(s); we must handle missing keys, duplicate keys, and schema drift
// (columns differing between the two runs) without crashing or lying.

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); }
}
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirrors of qeSnap diff logic ────────────────────────────────────────────────
function rowKey(row, keyCols) { return keyCols.map((k) => String(row[k] == null ? "" : row[k])).join(""); }

// diffSnapshots(prev, curr, keyCols) → { added:[], removed:[], changed:[{key,before,after,fields:[]}], unchanged:n, warnings:[] }
function diffSnapshots(prev, curr, keyCols) {
  const warnings = [];
  const prevRows = (prev && prev.rows) || [];
  const currRows = (curr && curr.rows) || [];
  if (!keyCols || !keyCols.length) { warnings.push("no key column selected"); return { added: [], removed: [], changed: [], unchanged: 0, warnings }; }
  // schema drift: columns present in one run but not the other
  const prevCols = (prev && prev.columns) || [], currCols = (curr && curr.columns) || [];
  const addedCols = currCols.filter((c) => prevCols.indexOf(c) < 0);
  const droppedCols = prevCols.filter((c) => currCols.indexOf(c) < 0);
  if (addedCols.length) warnings.push("new columns: " + addedCols.join(", "));
  if (droppedCols.length) warnings.push("removed columns: " + droppedCols.join(", "));

  const prevMap = new Map(), currMap = new Map();
  let dupPrev = 0, dupCurr = 0;
  prevRows.forEach((r) => { const k = rowKey(r, keyCols); if (prevMap.has(k)) dupPrev++; else prevMap.set(k, r); });
  currRows.forEach((r) => { const k = rowKey(r, keyCols); if (currMap.has(k)) dupCurr++; else currMap.set(k, r); });
  if (dupPrev) warnings.push(dupPrev + " duplicate key(s) in previous (first kept)");
  if (dupCurr) warnings.push(dupCurr + " duplicate key(s) in current (first kept)");

  // compare on the UNION of columns (so drift is visible, not hidden)
  const allCols = currCols.slice();
  prevCols.forEach((c) => { if (allCols.indexOf(c) < 0) allCols.push(c); });

  const added = [], removed = [], changed = []; let unchanged = 0;
  for (const [k, cr] of currMap) {
    if (!prevMap.has(k)) { added.push(cr); continue; }
    const pr = prevMap.get(k);
    const diffFields = [];
    allCols.forEach((c) => { const a = pr[c] == null ? "" : String(pr[c]); const b = cr[c] == null ? "" : String(cr[c]); if (a !== b) diffFields.push(c); });
    if (diffFields.length) changed.push({ key: k, before: pr, after: cr, fields: diffFields });
    else unchanged++;
  }
  for (const [k, pr] of prevMap) { if (!currMap.has(k)) removed.push(pr); }
  return { added, removed, changed, unchanged, warnings };
}

const snap = (columns, rows) => ({ columns, rows });

console.log("\n1. added / removed / changed / unchanged");
{
  const prev = snap(["Id", "Status", "Score"], [
    { Id: "1", Status: "Active", Score: "10" },
    { Id: "2", Status: "Active", Score: "20" },
    { Id: "3", Status: "Paused", Score: "30" },
  ]);
  const curr = snap(["Id", "Status", "Score"], [
    { Id: "1", Status: "Active", Score: "10" },     // unchanged
    { Id: "2", Status: "Inactive", Score: "25" },   // changed (2 fields)
    { Id: "4", Status: "Active", Score: "40" },     // added
    // Id 3 removed
  ]);
  const d = diffSnapshots(prev, curr, ["Id"]);
  eq("1 added", d.added.length, 1);
  eq("added is Id 4", d.added[0].Id, "4");
  eq("1 removed", d.removed.length, 1);
  eq("removed is Id 3", d.removed[0].Id, "3");
  eq("1 changed", d.changed.length, 1);
  eq("changed key Id 2", d.changed[0].key, "2");
  eq("2 fields changed", d.changed[0].fields.sort().join(","), "Score,Status");
  eq("1 unchanged", d.unchanged, 1);
}

console.log("\n2. no key column -> warn, no crash");
{
  const d = diffSnapshots(snap(["a"], [{ a: 1 }]), snap(["a"], [{ a: 2 }]), []);
  ok("warns about missing key", d.warnings.some((w) => /no key/.test(w)));
  eq("no diff produced", d.added.length + d.removed.length + d.changed.length, 0);
}

console.log("\n3. composite key (multi-column identity)");
{
  const prev = snap(["Src", "Id", "V"], [{ Src: "A", Id: "1", V: "x" }, { Src: "B", Id: "1", V: "y" }]);
  const curr = snap(["Src", "Id", "V"], [{ Src: "A", Id: "1", V: "x" }, { Src: "B", Id: "1", V: "z" }]);
  const d = diffSnapshots(prev, curr, ["Src", "Id"]);
  eq("composite key: 0 added", d.added.length, 0);
  eq("composite key: 1 changed (B/1)", d.changed.length, 1);
  eq("changed field V", d.changed[0].fields.join(","), "V");
}

console.log("\n4. schema drift (columns differ) is reported, not hidden");
{
  const prev = snap(["Id", "Old"], [{ Id: "1", Old: "a" }]);
  const curr = snap(["Id", "New"], [{ Id: "1", New: "b" }]);
  const d = diffSnapshots(prev, curr, ["Id"]);
  ok("warns new column", d.warnings.some((w) => /new columns: New/.test(w)));
  ok("warns removed column", d.warnings.some((w) => /removed columns: Old/.test(w)));
  // Id 1 differs because Old->'' and New appears → counts as changed on union cols
  eq("row flagged changed due to drift", d.changed.length, 1);
}

console.log("\n5. duplicate keys are flagged (first kept, no crash)");
{
  const prev = snap(["Id", "V"], [{ Id: "1", V: "a" }, { Id: "1", V: "b" }]);
  const curr = snap(["Id", "V"], [{ Id: "1", V: "a" }]);
  const d = diffSnapshots(prev, curr, ["Id"]);
  ok("warns duplicate key in previous", d.warnings.some((w) => /duplicate key/.test(w)));
  ok("did not crash, produced a result", !!d);
}

console.log("\n6. empty / first-run cases");
{
  const d1 = diffSnapshots(snap(["Id"], []), snap(["Id"], [{ Id: "1" }]), ["Id"]);
  eq("empty prev -> all added", d1.added.length, 1);
  const d2 = diffSnapshots(snap(["Id"], [{ Id: "1" }]), snap(["Id"], []), ["Id"]);
  eq("empty curr -> all removed", d2.removed.length, 1);
  const d3 = diffSnapshots(null, snap(["Id"], [{ Id: "1" }]), ["Id"]);
  eq("null prev handled -> all added", d3.added.length, 1);
}

console.log("\n7. null/blank key values don't crash (grouped as empty-key)");
{
  const prev = snap(["Id", "V"], [{ Id: null, V: "a" }]);
  const curr = snap(["Id", "V"], [{ Id: null, V: "b" }]);
  const d = diffSnapshots(prev, curr, ["Id"]);
  eq("null key matched as same row", d.changed.length, 1);
}

console.log("\n7b. save/list/delete/clear round-trip (mock localStorage) + name + row count");
{
  // minimal localStorage mock
  var store = {};
  var LS = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  var PREFIX = "dc_qe_snap_", MAX = 5;
  function key(sql) { var s = String(sql || "").replace(/\s+/g, " ").trim().toLowerCase(); var h = 0; for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return PREFIX + (h >>> 0).toString(36); }
  function list(sql) { try { var r = LS.getItem(key(sql)); return r ? JSON.parse(r) : []; } catch (e) { return []; } }
  function save(sql, cols, rows, label, ts) { var l = list(sql); l.unshift({ ts: ts, label: label || "", columns: cols, rows: rows }); while (l.length > MAX) l.pop(); LS.setItem(key(sql), JSON.stringify(l)); return { ok: true, count: l.length, rows: rows.length }; }
  function del(sql, idx) { var l = list(sql); if (idx < 0 || idx >= l.length) return false; l.splice(idx, 1); if (l.length) LS.setItem(key(sql), JSON.stringify(l)); else LS.removeItem(key(sql)); return true; }
  function clear(sql) { LS.removeItem(key(sql)); return true; }

  var SQL = "SELECT * FROM Audience__dlm";
  var r1 = save(SQL, ["Id"], [{ Id: "1" }, { Id: "2" }], "day1", 1000);
  eq("save returns row count", r1.rows, 2);
  eq("1 snapshot", list(SQL).length, 1);
  eq("name retained", list(SQL)[0].label, "day1");
  save(SQL, ["Id"], [{ Id: "1" }], "day2", 2000);
  eq("2 snapshots, newest first", list(SQL)[0].label, "day2");
  // keep only MAX
  for (var i = 0; i < 10; i++) save(SQL, ["Id"], [{ Id: String(i) }], "x" + i, 3000 + i);
  eq("capped at MAX=5", list(SQL).length, 5);
  // delete one
  del(SQL, 0);
  eq("after delete -> 4", list(SQL).length, 4);
  // clear all
  clear(SQL);
  eq("after clear -> 0", list(SQL).length, 0);
  // isolated per query key
  save("SELECT a", ["Id"], [{ Id: "9" }], "other", 5000);
  eq("different query -> own bucket unaffected by clear", list("SELECT a").length, 1);
}

// ── 7c. Key-quality assessment (powers the inline "bad key" warning) ──────────────
// Mirror of qeKeyQuality: flag a key column that is non-unique (dups), JSON/hash-like
// (jsonish — changes on edit → remove+add instead of changed), or blank.
console.log("\n7c. qeKeyQuality — guides the user to a safe key");
{
  function qeKeyQuality(rows, keyCol) {
    var seen = Object.create(null), dups = 0, jsonish = 0, blanks = 0, total = (rows || []).length;
    (rows || []).forEach(function (r) {
      var v = r ? r[keyCol] : null;
      var s = v == null ? "" : String(v);
      if (s === "") blanks++;
      if (seen[s]) dups++; else seen[s] = 1;
      var t = s.trim();
      if (t.charAt(0) === "{" || t.charAt(0) === "[") jsonish++;
    });
    return { dups: dups, total: total, jsonish: jsonish, blanks: blanks };
  }
  const unique = [{ Id: "1" }, { Id: "2" }, { Id: "3" }];
  eq("unique id -> 0 dups", qeKeyQuality(unique, "Id").dups, 0);
  const dupKey = [{ Delta: "I" }, { Delta: "D" }, { Delta: "I" }, { Delta: "I" }];
  // 4 rows, 2 distinct values (I, D) -> 2 rows collapse onto an already-seen key
  eq("non-unique Delta -> 2 collapse onto seen keys", qeKeyQuality(dupKey, "Delta").dups, 2);
  const jsonKey = [{ H: '{"a":1}' }, { H: '[1,2]' }, { H: "plain" }];
  eq("json/hash values flagged", qeKeyQuality(jsonKey, "H").jsonish, 2);
  eq("plain value not json-flagged", qeKeyQuality([{ H: "abc" }], "H").jsonish, 0);
  const blankKey = [{ Id: "" }, { Id: null }, { Id: "x" }];
  eq("blank/null keys counted", qeKeyQuality(blankKey, "Id").blanks, 2);
  eq("empty rows -> 0 total (no crash)", qeKeyQuality([], "Id").total, 0);
}

// ── 7d. Other-bucket detection (the "my snapshot disappeared" hint) ───────────────
// Mirror of qeSnapOtherBucketCount over a mock localStorage: counts snapshot buckets
// saved under a DIFFERENT normalized query than the current one.
console.log("\n7d. qeSnapOtherBucketCount — explains LIMIT 1 vs LIMIT 2 buckets");
{
  var store = {};
  var LS = {
    get length() { return Object.keys(store).length; },
    key: function (i) { return Object.keys(store)[i]; },
    getItem: function (k) { return (k in store) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
  };
  var PREFIX = "dc_qe_snap_";
  function qeSnapKey(sql) { var s = String(sql || "").replace(/\s+/g, " ").trim().toLowerCase(); var h = 0; for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return PREFIX + (h >>> 0).toString(36); }
  function otherBuckets(sql) {
    var cur = qeSnapKey(sql), n = 0;
    for (var i = 0; i < LS.length; i++) {
      var k = LS.key(i);
      if (k && k.indexOf(PREFIX) === 0 && k !== cur) {
        try { var arr = JSON.parse(LS.getItem(k)); if (Array.isArray(arr) && arr.length) n++; } catch (e) {}
      }
    }
    return n;
  }
  var q1 = 'SELECT * FROM "T__dlm" LIMIT 1';
  var q2 = 'SELECT * FROM "T__dlm" LIMIT 2';
  LS.setItem(qeSnapKey(q1), JSON.stringify([{ ts: 1, rows: [{ Id: "1" }] }]));
  eq("q1 and q2 land in different buckets", qeSnapKey(q1) === qeSnapKey(q2), false);
  eq("from q2's view, 1 other bucket exists (the q1 snapshot)", otherBuckets(q2), 1);
  eq("from q1's view, 0 others (its own bucket excluded)", otherBuckets(q1), 0);
  LS.setItem("unrelated_key", "x"); // non-snapshot keys ignored
  eq("non-snapshot keys ignored", otherBuckets(q2), 1);
  LS.setItem(qeSnapKey(q2), JSON.stringify([])); // empty bucket doesn't count
  eq("empty bucket not counted", otherBuckets(q2), 1);
}

// ── 7e. CSV parsing + shape conversion (powers "Compare two CSV files") ───────────
// The diff engine is reused as-is; only the SOURCE differs (a parsed CSV vs a snapshot).
// So we lock the parser (quotes/commas/newlines/CRLF/BOM) and the {columns,rows} shape.
console.log("\n7e. qeCsvParse + qeCsvToSnapshot");
{
  function qeCsvParse(text) {
    var rows = [], row = [], field = "", i = 0, inQ = false;
    var s = String(text == null ? "" : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    for (i = 0; i < s.length; i++) {
      var c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (c === "\r") { }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") rows.pop();
    return rows;
  }
  function qeCsvToSnapshot(text) {
    var cells = qeCsvParse(text);
    if (!cells.length) return { columns: [], rows: [] };
    var header = cells[0].map(function (h, i) { return String(h || "").trim() || ("col" + (i + 1)); });
    var seen = Object.create(null), columns = header.map(function (h) { if (seen[h]) { seen[h]++; return h + "_" + seen[h]; } seen[h] = 1; return h; });
    var rows = [];
    for (var r = 1; r < cells.length; r++) { var o = {}, cr = cells[r]; for (var c = 0; c < columns.length; c++) o[columns[c]] = cr[c] == null ? "" : cr[c]; rows.push(o); }
    return { columns: columns, rows: rows };
  }

  // basic
  var basic = qeCsvParse("a,b,c\n1,2,3\n4,5,6");
  eq("basic: 3 rows (header + 2)", basic.length, 3);
  eq("basic: 3 cols", basic[0].length, 3);
  eq("basic: cell value", basic[1][2], "3");
  // trailing newline ignored
  eq("trailing newline doesn't add a blank row", qeCsvParse("a,b\n1,2\n").length, 2);
  // CRLF
  eq("CRLF handled", qeCsvParse("a,b\r\n1,2\r\n").length, 2);
  // quoted comma
  var qc = qeCsvParse('a,b\n"x,y",z');
  eq("quoted comma kept in one field", qc[1][0], "x,y");
  eq("quoted comma: 2 fields", qc[1].length, 2);
  // escaped quote
  var eq2 = qeCsvParse('a\n"she said ""hi"""');
  eq("escaped double-quote -> single quote", eq2[1][0], 'she said "hi"');
  // newline inside quotes
  var nl = qeCsvParse('a,b\n"line1\nline2",z');
  eq("newline inside quotes stays one row", nl.length, 2);
  eq("newline inside quotes stays one field", nl[1][0], "line1\nline2");
  // BOM
  eq("UTF-8 BOM stripped from first header", qeCsvParse("﻿a,b\n1,2")[0][0], "a");
  // empty
  eq("empty text -> 0 rows", qeCsvParse("").length, 0);

  // shape conversion
  var csvSnap = qeCsvToSnapshot('Id,Status\n1,Active\n2,Paused');
  eq("snapshot columns", csvSnap.columns.join(","), "Id,Status");
  eq("snapshot row count (excludes header)", csvSnap.rows.length, 2);
  eq("snapshot row as object", csvSnap.rows[0].Status, "Active");
  // blank + duplicate headers
  var dup = qeCsvToSnapshot(',Name,Name\nx,a,b');
  eq("blank header named col1", dup.columns[0], "col1");
  eq("duplicate header suffixed", dup.columns[2], "Name_2");

  // end-to-end: two CSVs through the SAME diff engine
  var oldSnap = qeCsvToSnapshot('Id,Status\n1,Active\n2,Active\n3,Paused');
  var newSnap = qeCsvToSnapshot('Id,Status\n1,Active\n2,Inactive\n4,Active'); // 2 changed, 3 removed, 4 added
  var d = diffSnapshots(oldSnap, newSnap, ["Id"]);
  eq("csv diff: 1 added (Id 4)", d.added.length, 1);
  eq("csv diff: 1 removed (Id 3)", d.removed.length, 1);
  eq("csv diff: 1 changed (Id 2)", d.changed.length, 1);
  eq("csv diff: changed field is Status", d.changed[0].fields.join(","), "Status");
}

// ── Source presence ──────────────────────────────────────────────────────────────
console.log("\n8. Source presence (independent qeSnap module wired)");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("diffSnapshots defined", /function qeDiffSnapshots\s*\(|diffSnapshots\s*[:=]\s*function|function diffSnapshots/.test(src));
  ok("saves snapshots (localStorage key)", /dc_qe_snap|qeSnapSave|dc-qe-snap/.test(src));
  ok("has Save snapshot + Compare UI", /Save snapshot/.test(src) && /Compare/.test(src));
  ok("has a key-column picker (row identity)", /key column|keyCols|rowKey/.test(src));
  ok("snapshots can be named on save (prompt)", /Name this snapshot/.test(src));
  ok("can delete + clear snapshots", /qeSnapDelete/.test(src) && /qeSnapClear/.test(src));
  ok("save confirms the row count saved", /saved \" \+ res\.rows|res\.rows\.toLocaleString/.test(src));
  ok("handles too-big result honestly (5MB cap msg)", /too big to save|tooBig/.test(src));
  // in-tool help + inline smart warnings
  ok("key-quality helper defined", /function qeKeyQuality\s*\(/.test(src));
  ok("other-bucket helper defined", /function qeSnapOtherBucketCount\s*\(/.test(src));
  ok("in-tool help modal defined", /function openQeSnapHelp\s*\(/.test(src));
  ok("help button wired into toolbar", /helpBtn/.test(src) && /openQeSnapHelp\(\)/.test(src));
  ok("help covers the Key + JSON/hash trap in plain words", /JSON or hash|removed \+ added|removed and then added/i.test(src) && /unique value for each row/i.test(src));
  ok("help explains same-query rule generically (no LIMIT jargon)", /query you ran when you saved it/i.test(src) && /run the same query/i.test(src));
  ok("no me-specific LIMIT 1 vs LIMIT 2 example in user-facing help", !/LIMIT 1<\/code>|code\("LIMIT 1"\)|code\("… LIMIT/.test(src));
  ok("help leads with WHY (purpose, not just mechanics)", /Why use this\?/i.test(src) && /what changed/i.test(src));
  ok("help states it works for ANY query (not activation-specific)", /any query/i.test(src) && /any object or table/i.test(src));
  ok("no user-facing 'activation'-only framing in the snapshot help/tooltip", !/activation history\)\.?";/.test(src));
  ok("help has a quick 3-step test", /Test in 3 steps/.test(src));
  ok("long detail is collapsed behind <details> (scannable by default)", /<details/.test(src) && /<summary/.test(src));
  ok("inline hint warns about other buckets", /other quer/i.test(src));
  ok("inline hint warns non-unique key", /not unique/i.test(src));
  // Compare-two-CSV-files feature
  ok("CSV parser defined", /function qeCsvParse\s*\(/.test(src));
  ok("CSV->snapshot shape converter defined", /function qeCsvToSnapshot\s*\(/.test(src));
  ok("Compare-CSVs modal defined", /function openQeCsvCompare\s*\(/.test(src));
  ok("Compare CSVs button wired into toolbar", /csvCmpBtn/.test(src) && /openQeCsvCompare\(\)/.test(src));
  ok("CSV compare reuses the SAME diff engine (qeDiffSnapshots)", /openQeCsvCompare[\s\S]{0,7000}qeDiffSnapshots\(/.test(src));
  ok("CSV compare reuses the SAME results modal (openQeDiffModal)", /openQeCsvCompare[\s\S]{0,7000}openQeDiffModal\(/.test(src));
  ok("uses a file input to read CSV from disk", /openQeCsvCompare[\s\S]{0,3000}type='file'/.test(src) && /readAsText/.test(src));
  ok("help mentions Compare CSVs for large results", /Compare CSVs/.test(src) && /2,000 rows/.test(src));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
