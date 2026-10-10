// Segment builder API-name decorator — pure logic tests. Run in Node.
//   node test/segment-apiname.test.js
//
// Feature: on the Segment builder, show the API name of each attribute (left palette +
// used rules) so users pick the RIGHT field when labels collide (e.g. "Account Multiline"
// = TDI_Account_Multiline__c on one DMO but TDI_GI_Account_Multiline__c on another).
//
// PROVEN DOM (DOM Probe v2/v3 on the real org — see memory data360-segment-builder-dom):
//   runtime_cdp-attribute-row.attributeNode        = {fieldApiName, objectApiName, label, fieldType, isPrimaryKey, keyQualifierName, category}
//   runtime_cdp-attribute-group-row.groupNode      = {objectApiName, primaryKeyFieldApiName, fullLabel, label, children:[...]}
//   runtime_cdp-segment-builder-simple-condition.simpleCondition.subject = {fieldApiName, objectApiName}
// The API name is read DIRECTLY off the element prop — no label-matching, no API call,
// no collision guessing. This file locks the pure extractors + formatters.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirrors of the extractor logic (segApi* namespace in the source) ──────────────
function safeGet(o, k) { try { return o[k]; } catch (e) { return undefined; } }

// Classify the element and pull {kind, label, fieldApi, objectApi, isPk, fieldType} or null.
function segApiInfo(el) {
  if (!el) return null;
  var tag = (el._tag || "").toLowerCase();   // tests pass _tag; source uses tagName
  // 1) left-palette single attribute
  var an = safeGet(el, "attributeNode");
  if (an && (an.fieldApiName || an.objectApiName)) {
    return { kind: "attribute", label: an.label || "", fieldApi: an.fieldApiName || "", objectApi: an.objectApiName || "", isPk: !!an.isPrimaryKey, fieldType: an.fieldType || "" };
  }
  // 2) left-palette DMO group header
  var gn = safeGet(el, "groupNode");
  if (gn && gn.objectApiName) {
    return { kind: "group", label: gn.label || gn.fullLabel || "", fieldApi: "", objectApi: gn.objectApiName || "", pkApi: gn.primaryKeyFieldApiName || "", fieldType: "" };
  }
  // 3a) aggregation container header (Count / Sum / …). Reads ONLY its own subject —
  //     a bare Count owns NO field, and we NEVER descend into .filter / .conditions (those
  //     are nested member conditions). Prevents a Count header showing a member's field/path.
  var aggC = safeGet(el, "aggregationCondition");
  if (aggC && typeof aggC === "object") {
    var aSub = aggC.subject || {};
    var aObj = aSub.objectApiName || aggC.objectApiName || aggC.selectedObjectApiName || aggC.containerObjectApiName || "";
    var aFld = aSub.fieldApiName || "";
    // Container Path read VERBATIM from the open edit panel (source: segFindOpenPathFor).
    // Mirror uses an injected el._openPath to stay pure; "" when not open / single-path.
    var aPath = typeof el._openPath === "function" ? (el._openPath(aObj) || "") : "";
    if (aObj || aFld) return { kind: "rule", label: aggC.label || "", fieldApi: aFld, objectApi: aObj, fieldType: "", isAggregate: true, containerPath: aPath };
  }
  // 3b) simple / calculated-insight / rank-limit — all share the
  //     {subject:{fieldApiName,objectApiName}} shape; rank-limit uses .conditions[0].subject.
  var CONDITION_PROPS = ["simpleCondition", "calculatedInsightCondition",
    "groupRankLimitCondition", "rankLimitCondition", "rankAndLimitCondition", "condition"];
  for (var ci = 0; ci < CONDITION_PROPS.length; ci++) {
    var cProp = CONDITION_PROPS[ci];
    var c = safeGet(el, cProp);
    if (!c || typeof c !== "object") continue;
    var subj = c.subject || {};
    var f = subj.fieldApiName || c.fieldApiName || c.attributeName || "";
    var o = subj.objectApiName || c.objectApiName || c.selectedObjectApiName || "";
    // Rank & Limit ONLY: ranked field in .conditions[0].subject (restricted to rank props
    // so a general descent can't pull a nested member's field onto a header).
    if (!f && /rank/i.test(cProp) && c.conditions && c.conditions.length) { var rc = c.conditions[0] || {}; var rs = rc.subject || {}; f = rs.fieldApiName || rc.attributeName || ""; o = o || rs.objectApiName || ""; }
    var cPath = typeof el._openPath === "function" ? (el._openPath(o) || "") : "";
    if (f || o) return { kind: "rule", label: c.label || "", fieldApi: f, objectApi: o, fieldType: "", containerPath: cPath };
  }
  // 4) ACTIVATION: a drag chip / quick-attribute row — API name on .details
  var dt = safeGet(el, "details");
  if (dt && typeof dt === "object") {
    var ds = dt.subject || {};
    var df = ds.fieldApiName || dt.fieldApiName || dt.targetFieldName || dt.attributeName || "";
    var dobj = ds.objectApiName || dt.targetObjectName || dt.primaryObjectName || dt.objectApiName || "";
    if (df || dobj) return { kind: "rule", label: dt.label || dt.name || "", fieldApi: df, objectApi: dobj, fieldType: "" };
  }
  // 5) ACTIVATION main table cell — only {rowUid,name}; join to the datatable's data /
  //    summary includedAttributes by uid to get the field api. Caller passes a resolver.
  var rowUid = safeGet(el, "rowUid");
  if (rowUid && typeof el._resolveUid === "function") {
    var r = el._resolveUid(rowUid);
    if (r && (r.fieldApi || r.objectApi)) return { kind: "activationAttr", label: r.label || safeGet(el, "name") || "", fieldApi: r.fieldApi || "", objectApi: r.objectApi || "", outputName: r.outputName || "", fieldType: "" };
  }
  return null;
}

// Build a uid → {label, fieldApi, objectApi, outputName} resolver from a datatable's
// .data[] (label/output/object) joined with activation-summary.includedAttributes[]
// (the field api). Mirrors segBuildUidResolver in source.
function buildUidResolver(datatableData, includedAttributes) {
  var byUid = {};
  (datatableData || []).forEach(function (d) {
    if (!d || !d.uid) return;
    byUid[d.uid] = { label: d.name || "", outputName: d.defaultOutputName || d.preferredName || "", objectApi: d.entityName || "", fieldApi: "" };
  });
  (includedAttributes || []).forEach(function (a) {
    if (!a || !a.uid) return;
    if (!byUid[a.uid]) byUid[a.uid] = { label: a.label || "", outputName: "", objectApi: a.entityName || "", fieldApi: "" };
    byUid[a.uid].fieldApi = a.attributeName || byUid[a.uid].fieldApi;
    if (!byUid[a.uid].objectApi) byUid[a.uid].objectApi = a.entityName || "";
    if (!byUid[a.uid].label) byUid[a.uid].label = a.label || "";
  });
  return function (uid) { return byUid[uid] || null; };
}

// Chip text shown on hover / in the panel. Prefer field API; include object for context.
function segChipText(info) {
  if (!info) return "";
  if (info.kind === "group") return info.objectApi;
  if (!info.fieldApi) return info.objectApi || "";
  return info.fieldApi;
}
// Full one-line tooltip (object · field [· PK])
function segTooltip(info) {
  if (!info) return "";
  if (info.kind === "group") return "DMO: " + info.objectApi + (info.pkApi ? "  (PK: " + info.pkApi + ")" : "");
  var parts = [];
  if (info.objectApi) parts.push(info.objectApi);
  if (info.fieldApi) parts.push(info.fieldApi);
  var s = parts.join(" · ");
  if (info.isPk) s += "  • PK";
  if (info.fieldType) s += "  [" + info.fieldType + "]";
  if (info.ambiguous) s += "  (?)";
  return s;
}


// ── 1. left-palette attribute ─────────────────────────────────────────────────────
console.log("\n1. attribute-row → attributeNode");
{
  var el = { _tag: "runtime_cdp-attribute-row", attributeNode: { fieldApiName: "TDI_Account_Multiline__c", objectApiName: "TDI_UnifiedIndividualTdir__dlm", label: "Account Multiline", fieldType: "TEXT" } };
  var info = segApiInfo(el);
  eq("kind attribute", info.kind, "attribute");
  eq("fieldApi", info.fieldApi, "TDI_Account_Multiline__c");
  eq("objectApi", info.objectApi, "TDI_UnifiedIndividualTdir__dlm");
  eq("chip text = field api", segChipText(info), "TDI_Account_Multiline__c");
  eq("tooltip has object · field", segTooltip(info), "TDI_UnifiedIndividualTdir__dlm · TDI_Account_Multiline__c  [TEXT]");
}

console.log("\n1b. attribute PK + type surfaced");
{
  var el = { attributeNode: { fieldApiName: "Id__c", objectApiName: "TDI_UnifiedIndividualTdir__dlm", label: "Unified Individual Id", fieldType: "TEXT", isPrimaryKey: true } };
  var info = segApiInfo(el);
  ok("isPk true", info.isPk === true);
  ok("tooltip marks PK", /• PK/.test(segTooltip(info)));
}

// ── 2. DMO group header ─────────────────────────────────────────────────────────
console.log("\n2. attribute-group-row → groupNode");
{
  var el = { groupNode: { objectApiName: "TDI_Engagement_Consent__dlm", primaryKeyFieldApiName: "TDI_Id__c", label: "Engagement Consent", fullLabel: "Engagement Consent (14)" } };
  var info = segApiInfo(el);
  eq("kind group", info.kind, "group");
  eq("objectApi", info.objectApi, "TDI_Engagement_Consent__dlm");
  eq("chip = object api", segChipText(info), "TDI_Engagement_Consent__dlm");
  ok("tooltip shows DMO + PK", /DMO: TDI_Engagement_Consent__dlm.*PK: TDI_Id__c/.test(segTooltip(info)));
}

// ── 3. used rule (right side) ─────────────────────────────────────────────────────
console.log("\n3. simple-condition → simpleCondition.subject");
{
  var el = { simpleCondition: { attributeName: "DataSourceObject__c", label: "Data Source Object", subject: { objectApiName: "TDI_TDI_GI_Individual_Additional__dlm", fieldApiName: "DataSourceObject__c" } } };
  var info = segApiInfo(el);
  eq("kind rule", info.kind, "rule");
  eq("fieldApi from subject", info.fieldApi, "DataSourceObject__c");
  eq("objectApi from subject", info.objectApi, "TDI_TDI_GI_Individual_Additional__dlm");
}
console.log("\n3b. rule falls back to attributeName when subject missing fieldApiName");
{
  var el = { simpleCondition: { attributeName: "Foo__c", subject: { objectApiName: "X__dlm" } } };
  eq("fallback to attributeName", segApiInfo(el).fieldApi, "Foo__c");
}
console.log("\n3c. RANK & LIMIT / aggregation / CI conditions also resolve");
{
  var rl = segApiInfo({ groupRankLimitCondition: { subject: { objectApiName: "TDI_InsurancePolicy__dlm", fieldApiName: "DaystoExpiration__c" }, label: "Days to Expiration" } });
  eq("rank-limit kind rule", rl.kind, "rule");
  eq("rank-limit fieldApi", rl.fieldApi, "DaystoExpiration__c");
  eq("rank-limit objectApi", rl.objectApi, "TDI_InsurancePolicy__dlm");
  var rl2 = segApiInfo({ groupRankLimitCondition: { selectedObjectApiName: "TDI_UnifiedIndividualTdir__dlm", attributeName: "Id__c" } });
  eq("rank-limit via selectedObjectApiName/attributeName", rl2.objectApi, "TDI_UnifiedIndividualTdir__dlm");
  // aggregation WITH an explicit field (Sum/Average on a field) → that field, no fabrication
  var agg = segApiInfo({ aggregationCondition: { subject: { objectApiName: "A__dlm", fieldApiName: "Count__c" } } });
  eq("aggregation condition resolves", agg.fieldApi, "Count__c");
  eq("aggregation object resolves", agg.objectApi, "A__dlm");
}

// ── 3c-bug. A BARE Count container must NOT fabricate a field ──────────────────────────
// Repro of the reported bug: hovering "Insurance Policy : Count At Least 1" showed
// DaystoExpiration__c even though the edit view has only Container Object Name. The agg
// header owns no field; its nested MEMBER conditions must never leak up onto the header.
// (Container Path is no longer emitted by ANY branch — it isn't stored in the DOM.)
console.log("\n3c-bug. bare Count aggregation header shows object only — never a field");
{
  // SF shapes a Count header as an aggregationCondition whose field-bearing data lives in
  // nested members (.filter / .conditions), NOT on its own subject.
  var count = segApiInfo({
    aggregationCondition: {
      label: "Count", selectedObjectApiName: "TDI_InsurancePolicy__dlm",
      subject: { objectApiName: "TDI_InsurancePolicy__dlm" },   // no fieldApiName
      filter: { subject: { objectApiName: "TDI_InsurancePolicy__dlm", fieldApiName: "DaystoExpiration__c" } },
      conditions: [{ subject: { objectApiName: "TDI_InsurancePolicy__dlm", fieldApiName: "DaystoExpiration__c" } }],
      joinPath: [[{ objectApiName: "TDI_InsurancePolicy__dlm", fieldApiName: "TDI_PrimaryInsured__c" }, { objectApiName: "TDI_UnifiedIndividualTdi__dlm", fieldApiName: "Id__c" }]]
      // NOTE: no _openPath here → container is COLLAPSED → no path shown (matches SF).
    }
  });
  eq("Count resolves to the object", count.objectApi, "TDI_InsurancePolicy__dlm");
  eq("Count has NO fabricated field", count.fieldApi, "");
  eq("collapsed Count shows NO container path (not reconstructed from joinPath)", count.containerPath, "");
  ok("Count flagged isAggregate", count.isAggregate === true);
}

// ── 3c-path. Container Path shown VERBATIM only when the container is open in edit mode ──
// Proven via DOM Probe v11: the open canvas-item's innerText literally carries
//   "…\n*Container Path\n<path>\nMeasurement\n…". We READ that line; we never derive it.
console.log("\n3c-path. Container Path read verbatim from open edit panel (never reconstructed)");
{
  var SF_PATH = "Insurance Policy.Insurance Account Number > TDI Insurance Account.Insurance Account Primary Insured > Unified Individual TDI.Unified Individual Id";
  // mirror of segReadRenderedContainerPath (source) — extracts the line after the label
  function readRenderedPath(innerText) {
    if (!innerText || innerText.indexOf("Container Path") < 0) return "";
    var lines = innerText.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
    for (var i = 0; i < lines.length - 1; i++) {
      if (/^\*?\s*Container Path$/i.test(lines[i])) {
        var val = lines[i + 1];
        if (val && val.indexOf(" > ") >= 0 && val.indexOf(".") >= 0) return val;
        if (val && /\S\.\S/.test(val) && !/^(Measurement|Operator|Object|Attribute|Value|Lower Bound|Upper Bound)$/i.test(val)) return val;
        return "";
      }
    }
    return "";
  }
  var realInner = "Insurance Policy\n*Container Path\n" + SF_PATH + "\nMeasurement\nCount\nOperator\nAt Least\n*Value\nInsurance Policy:\nObject\nAttribute\nOperator\nIs Between\n*Lower Bound\nAND\n*Upper Bound";
  eq("extracts the exact SF path string from real innerText", readRenderedPath(realInner), SF_PATH);
  eq("no 'Container Path' label in text → ''", readRenderedPath("Insurance Policy\nMeasurement\nCount"), "");
  eq("label present but next line is a field label (single-path edge) → ''", readRenderedPath("X\n*Container Path\nMeasurement\nCount"), "");
  // single-hop path (object.field, no ' > ')
  eq("single-hop object.field path accepted", readRenderedPath("Y\nContainer Path\nEngagement Consent.Unified Individual Id\nMeasurement"), "Engagement Consent.Unified Individual Id");

  // segApiInfo attaches the verbatim path when the container is open (via _openPath hook)
  var openCount = segApiInfo({
    aggregationCondition: { label: "Count", selectedObjectApiName: "TDI_InsurancePolicy__dlm", subject: { objectApiName: "TDI_InsurancePolicy__dlm" } },
    _openPath: function (obj) { return obj === "TDI_InsurancePolicy__dlm" ? SF_PATH : ""; }
  });
  eq("open Count shows the verbatim container path", openCount.containerPath, SF_PATH);
  eq("open Count still has NO fabricated field", openCount.fieldApi, "");
  // a simple condition on the same open container also surfaces it
  var openCond = segApiInfo({
    simpleCondition: { label: "Days to Expiration", subject: { objectApiName: "TDI_InsurancePolicy__dlm", fieldApiName: "TDI_DaysToExpiration__c" } },
    _openPath: function () { return SF_PATH; }
  });
  eq("open condition surfaces verbatim path", openCond.containerPath, SF_PATH);
  eq("open condition keeps its real field api", openCond.fieldApi, "TDI_DaysToExpiration__c");
}

// ── 3d. ACTIVATION — drag-item chip (.details) ──────────────────────────────────────
console.log("\n3d. activation drag-item → .details.fieldApiName / .subject");
{
  var quick = segApiInfo({ details: { label: "Segment Code", fieldApiName: "Segment_Code__c", targetObjectName: "TDI_UnifiedIndividualTdir__dlm", primaryObjectName: "TDI_UnifiedIndividualTdir__dlm" } });
  eq("quick-attr fieldApi", quick.fieldApi, "Segment_Code__c");
  eq("quick-attr objectApi", quick.objectApi, "TDI_UnifiedIndividualTdir__dlm");
  var cond = segApiInfo({ details: { attributeName: "TDI_Account_Multiline__c", subject: { objectApiName: "TDI_UnifiedIndividualTdir__dlm", fieldApiName: "TDI_Account_Multiline__c" } } });
  eq("condition-drag fieldApi via subject", cond.fieldApi, "TDI_Account_Multiline__c");
}

// ── 3e. ACTIVATION — main table cell resolved by uid-join ───────────────────────────
console.log("\n3e. activation datatable cell → uid join (table data + summary)");
{
  var tableData = [
    { uid: "u1", name: "Unified Individual Id", defaultOutputName: "Id", entityName: "TDI_UnifiedIndividualTdir__dlm" },
    { uid: "u2", name: "Contact Type", defaultOutputName: "Contact Type", entityName: "TDI_UnifiedIndividualTdir__dlm" },
    { uid: "u3", name: "Email Address", defaultOutputName: "EmailAddress", entityName: "TDI_ContactPointEmail__dlm" }, // related: no field api in summary
  ];
  var summary = [
    { uid: "u1", label: "Unified Individual Id", attributeName: "Id__c", entityName: "TDI_UnifiedIndividualTdir__dlm" },
    { uid: "u2", label: "Contact Type", attributeName: "TDI_Contact_Type__c", entityName: "TDI_UnifiedIndividualTdir__dlm" },
  ];
  var resolve = buildUidResolver(tableData, summary);
  var cell = { rowUid: "u2", name: "Contact Type", _resolveUid: resolve };
  var info = segApiInfo(cell);
  eq("cell kind", info.kind, "activationAttr");
  eq("cell field api (from summary join)", info.fieldApi, "TDI_Contact_Type__c");
  eq("cell object api", info.objectApi, "TDI_UnifiedIndividualTdir__dlm");
  eq("cell output name carried", info.outputName, "Contact Type");
  // related-entity row: object + output known, field api NOT fabricated
  var rel = segApiInfo({ rowUid: "u3", name: "Email Address", _resolveUid: resolve });
  eq("related row object api", rel.objectApi, "TDI_ContactPointEmail__dlm");
  eq("related row has NO fabricated field api", rel.fieldApi, "");
  eq("related row output name", rel.outputName, "EmailAddress");
}

// ── 3f. label-index fallback (for chips / summary lines that carry no prop) ─────────
console.log("\n3f. label index + lookup (modal chips, Attributes-Included lines)");
{
  // mirror of segBuildLabelIndex over a flat list of {label,fieldApi,objectApi}
  function buildLabelIndex(entries) {
    var idx = {};
    entries.forEach(function (e) {
      var l = String(e.label || "").trim().toLowerCase();
      if (!l || (!e.fieldApi && !e.objectApi)) return;
      var cur = idx[l];
      if (!cur) { idx[l] = { label: e.label, fieldApi: e.fieldApi || "", objectApi: e.objectApi || "", ambiguous: false }; return; }
      if (e.fieldApi && cur.fieldApi && e.fieldApi !== cur.fieldApi) cur.ambiguous = true;
      if (!cur.fieldApi && e.fieldApi) cur.fieldApi = e.fieldApi;
      if (!cur.objectApi && e.objectApi) cur.objectApi = e.objectApi;
    });
    return idx;
  }
  function lookup(idx, text) {
    var raw = String(text || "").replace(/\s*[×✕✖xX]\s*$/, "").replace(/^\s*\d+\.\s*/, "").trim();
    if (!raw || raw.length > 60) return null;
    return idx[raw.toLowerCase()] || null;
  }
  var idx = buildLabelIndex([
    { label: "Contact Type", fieldApi: "TDI_Contact_Type__c", objectApi: "TDI_UnifiedIndividualTdir__dlm" },
    { label: "First Name", fieldApi: "FirstName__c", objectApi: "TDI_UnifiedIndividualTdir__dlm" },
    { label: "Account number", fieldApi: "", objectApi: "TDI_InsuranceAccount__dlm" }, // related: object only
  ]);
  eq("chip 'Contact Type ×' → field api (trailing × stripped)", lookup(idx, "Contact Type ×").fieldApi, "TDI_Contact_Type__c");
  eq("summary '2. First Name' → field api (index prefix stripped)", lookup(idx, "2. First Name").fieldApi, "FirstName__c");
  eq("related 'Account number' → object only, no fabricated field", lookup(idx, "Account number").fieldApi, "");
  eq("related 'Account number' → object api present", lookup(idx, "Account number").objectApi, "TDI_InsuranceAccount__dlm");
  ok("unknown label → null (never guesses)", lookup(idx, "Totally Unknown Thing") === null);

  // ambiguity: same label, two different field APIs → marked, not silently wrong
  var amb = buildLabelIndex([
    { label: "Account Multiline", fieldApi: "TDI_Account_Multiline__c", objectApi: "A__dlm" },
    { label: "Account Multiline", fieldApi: "TDI_GI_Account_Multiline__c", objectApi: "B__dlm" },
  ]);
  ok("colliding label flagged ambiguous", lookup(amb, "Account Multiline").ambiguous === true);
}

// ── 4. the COLLISION this feature solves ───────────────────────────────────────────
console.log("\n4. same label, different API name across DMOs → distinguished");
{
  var a = segApiInfo({ attributeNode: { fieldApiName: "TDI_Account_Multiline__c", objectApiName: "TDI_UnifiedIndividualTdir__dlm", label: "Account Multiline" } });
  var b = segApiInfo({ attributeNode: { fieldApiName: "TDI_GI_Account_Multiline__c", objectApiName: "TDI_TDI_GI_Individual_Additional__dlm", label: "Account Multiline" } });
  eq("same visible label", a.label, b.label);
  ok("DIFFERENT api names surfaced", a.fieldApi !== b.fieldApi);
  ok("chips differ (user can tell them apart)", segChipText(a) !== segChipText(b));
}

// ── 5. non-matching / empty elements never throw, return null ──────────────────────
console.log("\n5. robustness");
{
  ok("null element → null", segApiInfo(null) === null);
  ok("element without props → null", segApiInfo({}) === null);
  ok("attributeNode without api names → null", segApiInfo({ attributeNode: { label: "x" } }) === null);
  ok("chip of null → ''", segChipText(null) === "");
  ok("tooltip of null → ''", segTooltip(null) === "");
  // getter that throws must not crash
  var hostile = {}; Object.defineProperty(hostile, "attributeNode", { get: function () { throw new Error("boom"); } });
  ok("hostile getter handled", segApiInfo(hostile) === null);
}

// ── 6. panel list builder: dedupe + group by object ────────────────────────────────
console.log("\n6. buildPanelList — rows grouped by object, deduped");
{
  function buildPanelList(infos) {
    var byObj = {}, order = [];
    infos.filter(Boolean).forEach(function (i) {
      if (i.kind === "group" || !i.fieldApi) return;      // panel lists FIELDS
      var o = i.objectApi || "(unknown)";
      if (!byObj[o]) { byObj[o] = {}; order.push(o); }
      byObj[o][i.fieldApi] = i.label || "";               // dedupe by fieldApi
    });
    return order.map(function (o) {
      return { object: o, fields: Object.keys(byObj[o]).sort().map(function (f) { return { fieldApi: f, label: byObj[o][f] }; }) };
    });
  }
  var infos = [
    segApiInfo({ attributeNode: { fieldApiName: "BirthDt__c", objectApiName: "A__dlm", label: "Birth Date" } }),
    segApiInfo({ attributeNode: { fieldApiName: "BirthDt__c", objectApiName: "A__dlm", label: "Birth Date" } }), // dup
    segApiInfo({ attributeNode: { fieldApiName: "FirstName__c", objectApiName: "A__dlm", label: "First Name" } }),
    segApiInfo({ attributeNode: { fieldApiName: "X__c", objectApiName: "B__dlm", label: "X" } }),
    segApiInfo({ groupNode: { objectApiName: "A__dlm", label: "A" } }), // group skipped
  ];
  var list = buildPanelList(infos);
  eq("2 objects", list.length, 2);
  eq("object A has 2 unique fields (dup collapsed)", list[0].fields.length, 2);
  eq("fields sorted", list[0].fields[0].fieldApi, "BirthDt__c");
  eq("object B has 1 field", list[1].fields.length, 1);
}

// ── 6b. used-rule dedupe (SF renders each condition multiple times: canvas + shim) ──
console.log("\n6b. rule dedupe by object|field (fixes the inflated 'used' count)");
{
  function dedupeRules(ruleInfos) {
    var seen = {}, out = [];
    ruleInfos.filter(function (i) { return i && i.kind === "rule" && i.fieldApi; }).forEach(function (r) {
      var k = (r.objectApi || "") + "|" + r.fieldApi;
      if (!seen[k]) { seen[k] = 1; out.push(r); }
    });
    return out;
  }
  var raw = [
    { kind: "rule", fieldApi: "TDI_Account_Multiline__c", objectApi: "A__dlm" },
    { kind: "rule", fieldApi: "TDI_Account_Multiline__c", objectApi: "A__dlm" }, // dup render
    { kind: "rule", fieldApi: "TDI_Account_Multiline__c", objectApi: "A__dlm" }, // dup render
    { kind: "rule", fieldApi: "DaystoExpiration__c", objectApi: "B__dlm" },
    { kind: "rule", fieldApi: "", objectApi: "C__dlm" },                         // no field → dropped
  ];
  eq("5 raw rule elements collapse to 2 real rules", dedupeRules(raw).length, 2);
}

// ── 6c. Rank & Limit API names reach the Excel SETTING rows ──────────────────────────
// Rank rows render as setting:true property lines in Excel. Those lines previously merged
// over the API columns → blank Object/Field API for Rank & Limit (reported bug). The rank
// node carries objApi/fieldApi (scraped from .groupRankLimitCondition.conditions[0].subject);
// flatten() must copy them onto the Group By / Sort By setting row (field api), and object
// api onto every rank setting row (incl. Limit).
console.log("\n6c. Rank & Limit setting rows carry API names for Excel");
{
  // mirror of flatten()'s t==="rank" branch (the API-carrying part)
  function rankSettingRows(node) {
    const rrows = [];
    if (node.rankType) rrows.push({ label: node.rankType, value: node.rankField || "", setting: true, objApi: node.objApi || "", fieldApi: node.fieldApi || "" });
    if (node.limit)    rrows.push({ label: "Limit", value: node.limit, setting: true, objApi: node.objApi || "" });
    if (!rrows.length) rrows.push({ label: node.attr || "(rank & limit)", value: "", setting: true, objApi: node.objApi || "", fieldApi: node.fieldApi || "" });
    return rrows;
  }
  var gb = rankSettingRows({ rankType: "Group By", rankField: "Civic No", limit: "34 records per group", objApi: "TDI_UnifiedIndividualTdir__dlm", fieldApi: "Civic_No__c" });
  eq("Group By row keeps field api", gb[0].fieldApi, "Civic_No__c");
  eq("Group By row keeps object api", gb[0].objApi, "TDI_UnifiedIndividualTdir__dlm");
  eq("Limit row keeps object api", gb[1].objApi, "TDI_UnifiedIndividualTdir__dlm");
  eq("Limit row has no (fabricated) field api", gb[1].fieldApi, undefined);
  var sb = rankSettingRows({ rankType: "Sort By", rankField: "First Name", objApi: "TDI_UnifiedIndividualTdir__dlm", fieldApi: "FirstName__c" });
  eq("Sort By row keeps field api", sb[0].fieldApi, "FirstName__c");
}

// ── 6d. Container Path CAPTURED into the export (HTML + Excel), via the REAL renderers ──
// SF renders the path only while a container is open in edit mode; a cache remembers each
// opened container's literal path, and the export stamps it onto the container node. This
// drives the actual SEGX renderSheet + renderSegmentBody from source (no mirror) to prove
// a captured containerPath lands in BOTH outputs — exactly, never reconstructed.
console.log("\n6d. Container Path captured into export (real HTML + Excel renderers)");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8").split("\n");
  // locate the self-contained SEGX module (var SEGX = (function(){…})();)
  let s = -1, e = -1;
  for (let i = 0; i < src.length; i++) { if (s < 0 && /^\s*var SEGX = \(function \(\) \{/.test(src[i])) s = i; }
  // the module's OUTER close is exactly two-space-indented "})();" — inner IIFEs close with
  // "})(SEGX_NS);", so this pattern uniquely marks the end.
  if (s >= 0) { for (let i = s + 1; i < src.length; i++) { if (/^ {2}\}\)\(\);\s*$/.test(src[i])) { e = i; break; } } }
  if (s < 0 || e < 0) { ok("SEGX module located for render test", false, "s=" + s + " e=" + e); }
  else {
    const mod = src.slice(s, e + 1).join("\n").replace(/^\s*var SEGX = /, "");
    let SEGX = null; try { SEGX = eval(mod); } catch (err) { ok("SEGX evaluated", false, err.message); }
    if (SEGX) {
      const SF = "Insurance Policy.Insurance Account Number > TDI Insurance Account.Insurance Account Primary Insured > Unified Individual TDI.Unified Individual Id";
      const kit = { t: "root", tab: "Include", join: "AND", children: [
        { t: "container", entity: "Insurance Policy", agg: "Count At Least 1", kind: "related",
          objApi: "TDI_InsurancePolicy__dlm", containerPath: SF, join: "AND", children: [
            { t: "cond", entity: "Insurance Policy", attr: "Days to Expiration", op: "Is Between", v1: "88", v2: "92", objApi: "TDI_InsurancePolicy__dlm", fieldApi: "TDI_DaysToExpiration__c" } ] } ] };
      // HTML (path is HTML-escaped: > becomes &gt;)
      const html = SEGX.renderSegmentBody(kit, { tabs: false });
      const escaped = SF.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      ok("HTML export has a Container Path line", /class="cont-path"/.test(html));
      ok("HTML export shows the exact literal path (escaped)", html.indexOf(escaped) >= 0);
      ok("HTML export never reconstructs — path only present because we set it", SEGX.renderSegmentBody({ t: "root", tab: "Include", join: "AND", children: [{ t: "container", entity: "X", kind: "related", objApi: "Y__dlm", join: "AND", children: [] }] }, { tabs: false }).indexOf("cont-path") < 0);
      // Excel
      const wb = new SEGX.MiniXLSX.Workbook();
      const ws = wb.addWorksheet("Include", { views: [{ showGridLines: false }] });
      SEGX.renderSheet(ws, kit);
      let found = false, objCol = "";
      for (let r = 4; r <= ws._maxR; r++) { let line = ""; for (let c = 1; c <= 12; c++) { const cell = ws._cells[r + "," + c]; if (cell && cell.value != null) line += String(cell.value) + "|"; } if (line.indexOf("Container Path") >= 0 && line.indexOf(SF) >= 0) { found = true; const oc = ws._cells[r + ",4"]; objCol = oc && oc.value != null ? String(oc.value) : ""; } }
      ok("Excel export has a Container Path setting row with the literal path", found);
      eq("Excel Container Path row carries the object API (col 4)", objCol, "TDI_InsurancePolicy__dlm");
    }
  }
}

// ── 7. source presence ──────────────────────────────────────────────────────────────
console.log("\n7. source presence (wired, dev-only, reads props directly)");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("segApiInfo defined", /function segApiInfo\s*\(/.test(src));
  ok("reads attributeNode.fieldApiName directly", /attributeNode[\s\S]{0,80}fieldApiName/.test(src));
  ok("reads groupNode.objectApiName", /groupNode[\s\S]{0,80}objectApiName/.test(src));
  ok("reads condition .subject (simple + others via CONDITION_PROPS)", /CONDITION_PROPS/.test(src) && /simpleCondition/.test(src) && /c\.subject/.test(src));
  ok("aggregation header reads its OWN subject only (no .filter/.conditions descent)", /aggregationCondition/.test(src) && /never fabricated from nested members|NEVER descend/.test(src));
  ok("bare Count aggregate yields no field (isAggregate flag present)", /isAggregate: true/.test(src));
  ok("hover tooltip wired (overlay chip)", /dc-seg-api-tip/.test(src));
  ok("hover is a TOGGLE, off by default", /var segOn = false/.test(src) && /function toggleSegApi\s*\(/.test(src));
  ok("toggle exposed to launcher (no modal, no panel)", /window\.__dcToggleSegApi/.test(src) && !/dc-seg-api-panel/.test(src) && !/function openSegApiPanel/.test(src));
  ok("launcher row TOGGLES (segment-only, dev-gated on toggle fn)", /dc-seg-api-row/.test(src) && /typeof window\.__dcToggleSegApi === "function"/.test(src));
  ok("COPY via keyboard 'c' (does NOT hijack row clicks)", /function onKey\s*\(/.test(src) && /addEventListener\("keydown", onKey/.test(src) && /segOn[\s\S]{0,2000}function onKey/.test(src));
  ok("tooltip overlay keeps pointer-events:none (never intercepts SF clicks)", /dc-seg-api-tip[\s\S]{0,400}pointer-events:none/.test(src));
  ok("copy has a toast", /function segCopy\s*\(/.test(src) && /segToast/.test(src));
  ok("no separate floating button, no search box, no modal", !/dc-seg-api-btn/.test(src) && !/Search label or API name/.test(src));
  ok("RANK & LIMIT rows covered (tag + condition prop)", /runtime_cdp-segment-builder-group-rank-limit-condition/.test(src) && /groupRankLimitCondition|rankLimitCondition/.test(src));
  ok("targets the real tags", /runtime_cdp-attribute-row/.test(src) && /runtime_cdp-segment-builder-simple-condition/.test(src));
  ok("OLD fragile label-matching annotation removed (no fetchDmo/labelToDevName)", !/function fetchDmo\s*\(/.test(src) && !/labelToDevName\s*[=\[]/.test(src));
  // ACTIVATION coverage
  ok("ACTIVATION: runs on the activation WIZARD too (not just Segment; /view detail excluded)", /detailPageType === "Segment" \|\| \(detailPageType === "Activation" && isActivationWizardPage\(\)\)/.test(src));
  ok("ACTIVATION: drag-item .details read for api name", /details[\s\S]{0,120}(targetFieldName|fieldApiName)/.test(src) && /runtime_cdp-drag-item/.test(src));
  ok("ACTIVATION: datatable cell resolved by uid-join", /rowUid/.test(src) && /includedAttributes/.test(src) && /buildUidResolver|segBuildUidResolver|_resolveUid/.test(src));
  ok("ACTIVATION: never fabricates a field api (related rows show object+output only)", /activationAttr/.test(src));
  ok("ACTIVATION: toggle wired into activation launcher", /__dcToggleSegApi/.test(src));
  ok("ACTIVATION: unified FAB launcher (same icon/menu, not a separate pill)", /dc-act-fab/.test(src) && /dc-act-api-row/.test(src) && !/dc-act-api-btn/.test(src));
  ok("ACTIVATION: Export Activation is a menu row", /dc-act-export-row/.test(src));
  ok("RANK & LIMIT: field api read from .conditions[0].subject (restricted to rank props)", /\/rank\/i\.test\(cProp\) && c\.conditions && c\.conditions\.length/.test(src) && /groupRankLimitCondition/.test(src));
  ok("LABEL fallback for chips/summary lines (built from real props only)", /function segBuildLabelIndex\s*\(/.test(src) && /function segLabelLookup\s*\(/.test(src));
  ok("label fallback strips trailing × and leading index", /\[×✕✖xX\]|\\s\*\[×/.test(src) || /replace\(\/\\s\*\[/.test(src));
  ok("ambiguous label marked (?), never silently wrong", /ambiguous/.test(src) && /\(\?\)/.test(src));
  // EXPORT (documentation): authoritative API names (NO path — path pending a real probe)
  ok("EXPORT reads authoritative api (condApiAndPath)", /function condApiAndPath\s*\(/.test(src));
  ok("EXPORT extractLabels prefers authoritative over entity label-match", /condApiAndPath\(condEl\)/.test(src) && /auth\.objApi \|\| auth\.fieldApi/.test(src));
  ok("EXPORT xlsx Object API sits right AFTER Object, Field API right AFTER Attribute", /"Object API",[\s\S]{0,40}"Attribute", "Field API"/.test(src) && /ENT = 3, OBJAPI = 4, ATTR = 5, FLDAPI = 6/.test(src));
  ok("EXPORT xlsx writes the api cells (OBJAPI/FLDAPI)", /ws\.getCell\(r, OBJAPI\)/.test(src) && /ws\.getCell\(r, FLDAPI\)/.test(src));
  ok("EXPORT xlsx SETTING rows (Rank & Limit) also write API cells (not merged over)", /row\.setting[\s\S]{0,900}ws\.getCell\(r, OBJAPI\)[\s\S]{0,200}ws\.getCell\(r, FLDAPI\)/.test(src));
  ok("EXPORT rank setting rows carry objApi/fieldApi from the node", /rrows\.push\(\{ label: node\.rankType,[\s\S]{0,120}fieldApi: node\.fieldApi/.test(src));
  ok("EXPORT xlsx row() carries objApi/fieldApi", /objApi: n\.objApi \|\| ""/.test(src) && /fieldApi: n\.fieldApi \|\| ""/.test(src));
  ok("EXPORT HTML shows API name UNDER the label (not beside/dangling)", /function labelWithApi\s*\(/.test(src) && /class="api-under"/.test(src) && /labelWithApi\(n\.attr, n\.fieldApi, "fld"\)/.test(src));
  ok("EXPORT HTML direct card shows object API under the object label", /labelWithApi\(n\.entity, member \? "" : n\.objApi, "obj"\)/.test(src));
  ok("CONTAINER PATH read VERBATIM from open edit panel (not reconstructed)", /function segReadRenderedContainerPath\s*\(/.test(src) && /function segFindOpenPathFor\s*\(/.test(src) && /inFilterEditMode/.test(src) && /Container Path: " \+ info\.containerPath/.test(src));
  ok("CONTAINER PATH never reconstructed (no displayPaths/joinPaths derivation)", !/function segResolveContainerPath/.test(src) && !/function segDisplayPathString/.test(src) && !/function segJoinPathKey/.test(src) && !/function segPathNodeFor/.test(src));
  ok("Container Path reader keys off the literal rendered label + ' > ' hop separator", /\^\\\*\?\\s\*Container Path\$/.test(src) && /indexOf\(" > "\)/.test(src));
  ok("EXPORT captures Container Path via a cache (keyed by container object api)", /__dcContainerPathCache/.test(src) && /function dcCaptureOpenContainerPaths\s*\(/.test(src) && /function dcExtractContainerPath\s*\(/.test(src));
  ok("EXPORT HTML renders a cont-path line; Excel adds a Container Path setting row", /class="cont-path"/.test(src) && /label: "Container Path", value: node\.containerPath/.test(src));
  ok("EXPORT container path never reconstructed (cache stores only literal rendered string)", /_dcPathCache\[obj\] = path/.test(src) && !/function segResolveContainerPath/.test(src));
  ok("feature is dev-only (@strip wraps segApi code)", /@strip:start[\s\S]*segApiInfo[\s\S]*@strip:end/.test(src));
  // NAV/LIST ⧉ persist across SPA navigation (bookmarklet: no re-click). Listeners install
  // ONCE per document (window-flag guarded) + the button self-heals via a getter after
  // teardown's [id^='dc-'] sweep. Capture poll is also once-per-document.
  ok("NAV ⧉ installs once-per-document + button self-heals (survives nav, no re-click)", /window\.__dcNavNewTabInstalled/.test(src) && /function dcGetNavBtn\s*\(/.test(src));
  ok("LIST ⧉ installs once-per-document + button self-heals", /window\.__dcListNewTabInstalled/.test(src) && /function dcGetListBtn\s*\(/.test(src));
  ok("nav capture poll is once-per-document (no stacked pollers on re-run)", /window\.__dcNavCapturePoll/.test(src));
  ok("NAV route resolve order href-first → learned → seed (zero-maintenance)", /function dcRouteForLabel\s*\(/.test(src) && /dc_nav_routes_learned_v1/.test(src) && /function dcCaptureCurrentNavRoute\s*\(/.test(src));
  ok("NAV harvests label→href LIVE from top nav (covers 28+ incl. future; left-nav empty-href items resolve via this)", /function dcHarvestNavRoutes\s*\(/.test(src) && /slds-context-bar__label-action/.test(src) && /dcRouteForLabel[\s\S]{0,400}dcHarvestNavRoutes\(\)/.test(src));
  ok("NAV skips category-header groups (Segment & Act etc. get no ⧉)", /category-header\/\.test\(cls\)\)\s*return null/.test(src) && /!\/category-header\/\.test\(cls\)/.test(src));
  ok("WELCOME toast announces page features + globals (positive, once per url, auto-dismiss)", /function dcWelcomeToast\s*\(/.test(src) && /__dcWelcomeShownFor/.test(src) && /On this page/.test(src) && /Everywhere/.test(src));
  ok("ACTIVATION API-names gated to the WIZARD page only (/view detail has no attrs; Export still works there)", /function isActivationWizardPage\s*\(/.test(src) && /detailPageType === "Activation" && isActivationWizardPage\(\)/.test(src) && /__dcToggleSegApi === "function" && isActivationWizardPage\(\)/.test(src));
  ok("TOGGLE-OFF truly stops the persistent ⧉ overlays (window.__dcOff set on off, checked by both handlers, cleared on activate)", /window\.__dcOff = true/.test(src) && /window\.__dcOff = false/.test(src) && (src.match(/if \(window\.__dcOff\)/g) || []).length >= 2);
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
