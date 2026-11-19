// Guided Checks (Helpful Queries redesign): pure catalog tests — SQL builders + verdicts run for real.
//   node test/qe-guided-checks.test.js
const fs = require("fs"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../console-decorate.extension.js", "utf8");
const a = src.indexOf("var QG = (function"), b = src.indexOf("// @@GUIDED-END");
assert(a > 0 && b > a, "guided block markers present");
const QG = new Function(src.slice(a, b) + "; return QG;")();
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? " → " + x : "")); } };
const B = (id, k, p) => QG.build(id, k, p);
const V = (id, row, p, now) => QG.checks.find(c => c.id === id).verdict(row, p || {}, now);

// every check: summary SQL builds with sample params, quotes identifiers, no undefined/NaN leaks
const P = { t: "My Tbl", t2: "Other", c: 'Col"X', c2: "K2", s1: "Src", s2: "SrcObj", n: "5", period: "day", type: "INTEGER", cType: "VARCHAR",
  from: "DATE '2026-01-01'", to: "DATE '2026-02-01'", cols: [{ name: "Id__c", type: "VARCHAR" }, { name: "When", type: "TIMESTAMP" }] };
QG.checks.forEach(c => {
  const s = c.summary(P);
  ok(c.id + ": summary builds clean", /^SELECT /.test(s) && !/undefined|NaN|\bnull\b/.test(s), s);
  ok(c.id + ": identifiers quoted/escaped", /"My Tbl"/.test(s) || c.id === "idrHealth" || /"My Tbl"/.test(s), s);
  if (c.rows) { const r = c.rows(P); ok(c.id + ": rows SQL builds clean", /^SELECT /.test(r) && !/undefined|NaN/.test(r), r); }
  ok(c.id + ": has plain text, goal, fields", !!c.plain && c.goals.length > 0 && c.fields.length > 0);
});
ok("embedded quote in column is doubled", B("blank", "summary", P).includes('"Col""X"'));
ok("goal cards all reference real checks", QG.goals.every(g => QG.checks.some(c => c.goals.includes(g.id))));

// SQL shape for the user's asks
ok("distinct values: group by + order by count", /GROUP BY "Col""X" ORDER BY COUNT\(\*\) DESC/.test(B("distinct", "rows", P)));
ok("between: BETWEEN with both bounds", /BETWEEN DATE '2026-01-01' AND DATE '2026-02-01'/.test(B("between", "rows", P)));
ok("blank: text column uses TRIM, non-text does not", /TRIM/.test(B("blank", "rows", P)) && !/TRIM/.test(B("blank", "rows", { ...P, cType: "INTEGER" })));
ok("trend: period whitelisted (injection-safe)", /DATE_TRUNC\('day'/.test(B("trend", "rows", { ...P, period: "x'); DROP" })));
ok("trend with no range has no WHERE", !/WHERE/.test(B("trend", "rows", { ...P, from: null, to: null })));
ok("health: 2 columns -> counts + min/max only for date col", /COUNT\("Id__c"\) AS nn_0/.test(B("health", "summary", P)) && /MIN\("When"\)/.test(B("health", "summary", P)) && !/MIN\("Id__c"\)/.test(B("health", "summary", P)));
ok("health caps at 60 columns", (B("health", "summary", { ...P, cols: Array.from({ length: 90 }, (_, i) => ({ name: "c" + i, type: "VARCHAR" })) }).match(/AS nn_/g) || []).length === 60);
ok("orphan: LEFT JOIN with IS NULL", /LEFT JOIN "Other" b ON a\."Col""X" = b\."K2"/.test(B("mapMissing", "rows", P)) && /b\."K2" IS NULL/.test(B("mapMissing", "rows", P)));
ok("idr source-missing preset targets link table", QG.checks.find(c => c.id === "idrSourceMissing").fields.some(f => f.def === "SourceRecordId__c"));

// range bounds
ok("bound: date col, no time -> DATE", QG.bound("2026-03-01", "", "DATE", false) === "DATE '2026-03-01'");
ok("bound: timestamp start blank time -> 00:00:00", QG.bound("2026-03-01", "", "TIMESTAMP", false) === "TIMESTAMP '2026-03-01 00:00:00'");
ok("bound: timestamp END blank time -> 23:59:59 (whole day included)", QG.bound("2026-03-05", "", "TIMESTAMP_NTZ", true) === "TIMESTAMP '2026-03-05 23:59:59'");
ok("bound: explicit time kept", QG.bound("2026-03-05", "14:30", "TIMESTAMP", true) === "TIMESTAMP '2026-03-05 14:30:00'");
ok("bound: empty date -> null", QG.bound("", "10:00", "DATE", false) === null);

// verdicts
ok("redundant checks are gone (rowcount, lastn, notdate)", !["rowcount", "lastn", "notdate"].some(id => QG.checks.some(c => c.id === id)));
ok("every check lives under exactly ONE goal", QG.checks.every(c => c.goals.length === 1));
ok("every goal has at least one check", QG.goals.every(g => QG.checks.some(c => c.goals[0] === g.id)));
ok("consolidation SQL uses decimal math + per-source group", /\* 1\.0 \/ COUNT\("K2"\)/.test(B("idrBySource", "rows", P)) && /GROUP BY "Src", "SrcObj"/.test(B("idrBySource", "rows", P)));
ok("consolidation verdict computes overall %", /50% consolidation/.test(V("idrBySource", { source_records: 100, unified_profiles: 50 }).text));
ok("source summary: no optional tables -> no joins", !/LEFT JOIN/.test(B("dqBySource", "rows", P)));
const P2 = { ...P, te: "ssot__ContactPointEmail__dlm", tp: "", ta: "", tpi: "" };
ok("source summary: chosen optional table is joined on PartyId, blank ones skipped", /LEFT JOIN "ssot__ContactPointEmail__dlm" e ON e\."ssot__PartyId__c" = i\."Col""X"/.test(B("dqBySource", "rows", P2)) && !/phone_cps/.test(B("dqBySource", "rows", P2)));
ok("source verdict: a contact point at 0 -> warn, names it", (v => v.level === "warn" && /email_cps/.test(v.text))(V("dqBySource", { sources: 2, individuals: 50, email_cps: 0 }, P2)));
ok("per-individual: orders by the summed contact points", /ORDER BY email_cps DESC/.test(B("dqPerIndividual", "rows", P2)));
ok("outlier SQL: HAVING > N and optional unified CP join", /HAVING COUNT\(DISTINCT l\."K2"\) > 5/.test(B("idrOverMerge", "rows", { ...P, te: "UnifiedContactPointEmail__dlm" })) && /unique_emails/.test(B("idrOverMerge", "rows", { ...P, te: "UnifiedContactPointEmail__dlm" })));
ok("dupes none = ok / some = warn", V("dupes", { dup_values: "0" }).level === "ok" && V("dupes", { dup_values: "3", dup_rows: "7" }).level === "warn");
ok("blank all-empty = bad, some = warn, none = ok", V("blank", { total: 10, bad: 10 }).level === "bad" && V("blank", { total: 10, bad: 2 }).level === "warn" && V("blank", { total: 10, bad: 0 }).level === "ok");
ok("orphan pct text", /20%/.test(V("mapMissing", { total: 100, missing: 20 }).text) && V("mapMissing", { total: 100, missing: 20 }).level === "bad");
const now = Date.parse("2026-11-19T12:00:00Z");
ok("fresh: 1 day old within 2 = ok", V("fresh", { total: 5, latest: "2026-11-18 12:00:00" }, { n: "2" }, now).level === "ok");
ok("fresh: 4 days old, limit 2 = warn", V("fresh", { total: 5, latest: "2026-11-15 12:00:00" }, { n: "2" }, now).level === "warn");
ok("fresh: 30 days old = bad", V("fresh", { total: 5, latest: "2026-10-20" }, { n: "2" }, now).level === "bad");
ok("fresh: unreadable date = warn not crash", V("fresh", { total: 5, latest: "garbage" }, { n: "2" }, now).level === "warn");
ok("idr: 0 merged = warn", V("idrHealth", { source_records: 100, unified_profiles: 100 }).level === "warn");
ok("idr: 40% merged = ok", V("idrHealth", { source_records: 100, unified_profiles: 60 }).level === "ok" && /40%/.test(V("idrHealth", { source_records: 100, unified_profiles: 60 }).text));
ok("idr: 95% merged = warn (over-merge)", V("idrHealth", { source_records: 1000, unified_profiles: 50 }).level === "warn");
ok("idr: empty link = bad", V("idrHealth", { source_records: 0, unified_profiles: 0 }).level === "bad");
ok("over-merge >0 = bad", V("idrOverMerge", { big_profiles: 2, largest: 40 }, { n: "10" }).level === "bad");
ok("datesanity: clean ok / dirty warn", V("datesanity", { future: 0, ancient: 0 }).level === "ok" && V("datesanity", { future: 1, ancient: 0 }).level === "warn");
const hv = V("health", { total_rows: 100, nn_0: 100, dd_0: 90, nn_1: 0, dd_1: 0, nn_2: 100, dd_2: 1, mn_2: "2020", mx_2: "2026" }, { cols: [{ name: "Record_Id__c", type: "VARCHAR" }, { name: "Empty__c", type: "VARCHAR" }, { name: "Created", type: "TIMESTAMP" }] });
ok("health: flags empty column + repeated id, builds table", hv.level === "warn" && /Empty__c/.test(hv.text) && /Record_Id__c/.test(hv.text) && hv.table.length === 3 && hv.table[2].Earliest === "2020" && hv.table[0]["Has a value"] === "100%");
ok("health: empty table = bad", V("health", { total_rows: 0 }, { cols: [] }).level === "bad");

// trend gap detection
const tr = QG.checks.find(c => c.id === "trend");
const g = tr.post([{ period: "2026-01-01 00:00:00" }, { period: "2026-01-02" }, { period: "2026-01-05" }], { period: "day" });
ok("trend gaps: finds Jan 3 and Jan 4", g.level === "warn" && /2 days/.test(g.text) && /2026-01-03/.test(g.text) && /2026-01-04/.test(g.text), g && g.text);
ok("trend gaps: continuous = ok", tr.post([{ period: "2026-01-01" }, { period: "2026-01-02" }], { period: "day" }).level === "ok");
ok("trend gaps: week period skipped", tr.post([{ period: "2026-01-01" }, { period: "2026-01-20" }], { period: "week" }) === null);

// default column pick
const cols = [{ name: "Name", type: "VARCHAR" }, { name: "Email__c", type: "VARCHAR" }, { name: "Created_Date__c", type: "TIMESTAMP" }, { name: "ssot__Id__c", type: "VARCHAR" }];
ok("pick id", QG.pickDefault(cols, "id") === "ssot__Id__c");
ok("pick date only", QG.pickDefault(cols, "date", "date") === "Created_Date__c");
ok("pick text prefers email-ish", QG.pickDefault(cols, "text") === "Email__c");
ok("pick on empty list", QG.pickDefault([], "id") === "");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
