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

// ── 6e. Nav ⧉ gate (NEW DC nav): dcNavAnchorToItem matches real nav anchors only ──────
// Driven by DOM Probe v30 on the live new Data Cloud nav: every nav destination is an <a> with
// class slds-context-bar__label-action (real href) or slds-nav-vertical__action (left nav; href
// resolved by label). Non-nav links (a "Created By" user link, a lookup) must get NOTHING.
// We run the ACTUAL shipped dcNavAnchorToItem (extracted) against fake anchors — behavior, not
// a re-implementation. dcRouteForLabel/dcNavLabelOf are stubbed so the test is self-contained.
console.log("\n6e. nav ⧉ gate: dcNavAnchorToItem (new DC nav markup from probe v30)");
{
  const fs6e = require("fs"), path6e = require("path");
  const src6e = fs6e.readFileSync(path6e.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  function grab(name) { var m = src6e.match(new RegExp("function " + name + "\\s*\\([^)]*\\)\\s*\\{")); if (!m) return ""; var s = src6e.indexOf(m[0]), i = src6e.indexOf("{", s), d = 0, e = i; for (; i < src6e.length; i++) { var c = src6e[i]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { e = i; break; } } } return src6e.slice(s, e + 1); }
  const vm6e = require("vm");
  var sb = {
    // stubs the gate depends on:
    dcNavLabelOf: function (el) { return (el._attrs["aria-label"] || el._attrs.title || el._text || ""); },
    dcRouteForLabel: function (lbl) { return ({ "Segments": "/lightning/o/MarketSegment/home", "Data Streams": "/lightning/o/DataStream/home" })[lbl] || ""; },
    location: { origin: "https://x.my.salesforce.com" }
  };
  vm6e.runInNewContext(grab("dcNavAnchorToItem") + "\nthis.dcNavAnchorToItem = dcNavAnchorToItem;", sb);
  ok("extracted dcNavAnchorToItem from source", typeof sb.dcNavAnchorToItem === "function");
  function a(cls, attrs, text) { return { nodeType: 1, tagName: "A", _attrs: Object.assign({ class: cls || "" }, attrs || {}), _text: text || "", getAttribute: function (n) { return n === "class" ? this._attrs.class : (n in this._attrs ? this._attrs[n] : null); } }; }

  // top-bar label-action with a REAL href (Segments — one of the "new" items) → resolves
  var seg = sb.dcNavAnchorToItem(a("slds-context-bar__label-action dndItem", { href: "/lightning/o/MarketSegment/home", title: "Segments" }));
  ok("Segments top-bar anchor → route /o/MarketSegment/home", seg && seg.route === "/lightning/o/MarketSegment/home");
  // left-nav action anchor with EMPTY href → resolved by label via dcRouteForLabel
  var ds = sb.dcNavAnchorToItem(a("slds-nav-vertical__action", { href: "", "aria-label": "Data Streams" }));
  ok("left-nav empty-href anchor → resolved by label", ds && ds.route === "/lightning/o/DataStream/home");
  // the "More / Show more navigation items" overflow toggle → NOT a destination
  ok("'More' overflow toggle → null", sb.dcNavAnchorToItem(a("slds-button slds-context-bar__label-action", { href: "" }, "MoreShow more navigation items")) === null);
  // category/group header → null (expandable, not a page)
  ok("category-header group → null", sb.dcNavAnchorToItem(a("slds-context-bar__label-action category-header", { href: "/x", title: "Segment & Act" })) === null);
  // a NON-nav link (user record link, table lookup) → null (no nav class → ignored)
  ok("'Created By' user link (no nav class) → null", sb.dcNavAnchorToItem(a("someLinkClass", { href: "/lightning/r/User/005.../view", title: "Jane" })) === null);
  ok("table lookup link (no nav class) → null", sb.dcNavAnchorToItem(a("outputLookupLink", { href: "/lightning/r/Account/001.../view", title: "Acme" })) === null);
  // a non-anchor element → null
  ok("non-anchor element → null", sb.dcNavAnchorToItem({ nodeType: 1, tagName: "DIV", _attrs: {}, getAttribute: function () { return null; } }) === null);
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
  // LIST ⧉ now covers ALL Data Cloud lists (DLO, Data Stream, CI, Segment, …), not just DMO —
  // WITHOUT guessing: per row it reads the row's OWN real <a href> (dcRowRealHref), falling
  // back to the proven DMO template only on the Data Model list (the one list with no link).
  ok("LIST ⧉ reads each row's OWN real href (covers all lists, never fabricated)", /function dcRowRealHref\s*\(/.test(src) && /var href = dcRowRealHref\(node\)/.test(src));
  // DMO list: the KEY→template is AUTHORITATIVE (checked FIRST), and the row's own <a> links are
  // IGNORED for DMO rows — those are related-object columns (Data Streams / DLOs) that link to
  // OTHER records. Reading them opened a Data Stream when the user clicked a DMO (reported).
  ok("LIST ⧉ DMO row uses the key→template FIRST and ignores related-object links", /if \(type && type\.isDmoList && \/__\(\?:dlm\|dll\|c\)\$\/i\.test\(k\)\) \{\s*var tHref = dcDmoListUrl\(k\);/.test(src));
  ok("LIST active-type check is cheap/URL-only (no per-mouseover DOM scan — VDI-safe)", /CHEAP, URL-ONLY check/.test(src) && !/dcHasKeyedRow/.test(src));
  ok("LIST ⧉ handler uses the row's resolved href (hit.href), not a per-type url()", /var href = hit\.href \|\| "";/.test(src) && !/type\.url\(/.test(src));
  ok("nav capture poll is once-per-document (no stacked pollers on re-run)", /window\.__dcNavCapturePoll/.test(src));
  ok("NAV route resolve order href-first → learned → seed (zero-maintenance)", /function dcRouteForLabel\s*\(/.test(src) && /dc_nav_routes_learned_v1/.test(src) && /function dcCaptureCurrentNavRoute\s*\(/.test(src));
  ok("NAV harvests label→href LIVE from top nav (covers 28+ incl. future; left-nav empty-href items resolve via this)", /function dcHarvestNavRoutes\s*\(/.test(src) && /slds-context-bar__label-action/.test(src) && /dcRouteForLabel[\s\S]{0,400}dcHarvestNavRoutes\(\)/.test(src));
  ok("NAV skips category-header groups (Segment & Act etc. get no ⧉)", /category-header\/\.test\(cls\)\)\s*return null/.test(src) && /!\/category-header\/\.test\(cls\)/.test(src));
  ok("WELCOME toast announces page features + globals (once per SESSION, auto-dismiss)", /function dcWelcomeToast\s*\(/.test(src) && /__dcWelcomeShown\b/.test(src) && /On this page/.test(src) && /Everywhere/.test(src));
  ok("WELCOME shows once per session (not per page) + faster delay", /if \(!window\.__dcWelcomeShown\) setTimeout\(dcWelcomeToast, 600\)/.test(src));
  // BUG FIX: the one-shot flag must be set ONLY when the toast actually RENDERS, not eagerly at
  // schedule time. The old eager set meant a page with "nothing to announce" burned the one-shot
  // and the popup never came back for the whole tab session (reported: "not seeing the popup").
  ok("WELCOME flag set on real render, not eagerly (so a quiet page doesn't burn the one-shot)",
    /document\.body\.appendChild\(toast\);[\s\S]{0,800}window\.__dcWelcomeShown = true;/.test(src) &&
    /if \(window\.__dcWelcomeShown\) return;\s*\/\/ already shown this tab session/.test(src));
  // WELCOME toast appears on the OPPOSITE side from the launcher (QE launcher = bottom-left →
  // toast right; all other launchers = bottom-right → toast left) so they never overlap. Side
  // is read from the launcher's LIVE position (#dc-bar getBoundingClientRect), so a dragged
  // launcher still flips the toast correctly. Defaults to right when no launcher is present.
  ok("WELCOME toast positions on the opposite side from the launcher (no overlap)", /var side = "right";/.test(src) && /document\.getElementById\("dc-bar"\)[\s\S]{0,220}side = \(br\.left \+ br\.width \/ 2\) < \(window\.innerWidth \/ 2\) \? "right" : "left"/.test(src));
  ok("WELCOME toast CSS uses the dynamic side (not a hardcoded right)", /"position:fixed;bottom:24px;" \+ side \+ ":24px;/.test(src));
  // New DC nav (probe v30): match the anchor DIRECTLY by its nav class — no parentElement climb
  // (left nav is nested several shadow roots deep; a climb dies at each boundary → hit-or-miss).
  ok("NAV ⧉ matches the anchor directly by nav class (dcNavAnchorToItem)", /function dcNavAnchorToItem\s*\(/.test(src) && /slds-context-bar__label-action\|slds-nav-vertical__action/.test(src));
  ok("NAV hover PREFERS composedPath (flattened across shadow) then falls back to climb", /if \(e\.composedPath\) \{ var p = e\.composedPath\(\);[\s\S]{0,140}dcNavAnchorToItem\(p\[i\]\)/.test(src) && /if \(!hit\) hit = dcNavItemFrom\(e\.target\)/.test(src));
  ok("NAV climb fallback crosses shadow boundaries (getRootNode().host hop)", /function dcNavItemFrom\(node\)[\s\S]{0,400}getRootNode && node\.getRootNode\(\)[\s\S]{0,60}rt\.host\) \? rt\.host : null/.test(src));
  ok("NAV skips the 'More' overflow toggle + category headers", /show more navigation\|more\$/i.test(src) && /category-header/.test(src));
  ok("ACTIVATION API-names gated to the WIZARD page only (/view detail has no attrs; Export still works there)", /function isActivationWizardPage\s*\(/.test(src) && /detailPageType === "Activation" && isActivationWizardPage\(\)/.test(src) && /__dcToggleSegApi === "function" && isActivationWizardPage\(\)/.test(src));
  ok("TOGGLE-OFF truly stops the persistent ⧉ overlays (both handlers gate on dcNewTabEnabled; __dcOff set on off, cleared on activate)", /window\.__dcOff = true/.test(src) && /window\.__dcOff = false/.test(src) && (src.match(/if \(!dcNewTabEnabled\(\)\)/g) || []).length >= 2);
  // The per-launcher "Remove" rows were replaced by a non-destructive menu-close ×; the tool is
  // removed by re-clicking the bookmark, whose guard sets window.__dcOff = true directly. The
  // dcFullOff helper is retained as the canonical teardown+__dcOff, and the ⧉ overlays still bail
  // on __dcOff.
  ok("FULL off: re-click guard sets __dcOff directly; dcFullOff retained", /function dcFullOff\s*\(/.test(src) && /window\.__dcOff = true/.test(src));
  ok("no destructive 'Remove' dismissRow remains in any launcher", !/dismissRow/.test(src));
  ok("⧉ menu On/Off ROW removed from ALL launchers (was clutter; ⧉ is hover-only, Remove still silences it)", !/dcMakeNewTabRow/.test(src));
  // The ⧉ no longer PERSISTS an enable flag: reading an old saved "0" (from the long-gone Off
  // toggle) would hide the ⧉ forever with no way to re-enable it — the "⧉ gone everywhere" bug.
  // Now dcNewTabEnabled is purely !__dcOff, and any stale saved flag is cleared on load.
  ok("⧉ gate is simply !__dcOff (no stale-localStorage suppression)", /function dcNewTabEnabled\(\) \{ return !window\.__dcOff; \}/.test(src));
  ok("⧉ does NOT read the old persisted flag (no getItem gate that could stick it off)", !/localStorage\.getItem\(DC_NEWTAB_LS\)/.test(src));
  ok("stale ⧉ enable flag is cleared on load (so a past Off can't keep it hidden)", /localStorage\.removeItem\(DC_NEWTAB_LS\)/.test(src));
  ok("SEGMENT DOM-fallback gated to /cmp/ builder routes (stale wizard no longer misclassifies Home/list as Segment)", /looksLikeBuilderRoute = \/\\\/lightning\\\/cmp\\\//.test(src) && /\\\/lightning\\\/page\\\/\|\\\/lightning\\\/o\\\/\[A-Za-z\]\+\\\/home/.test(src) && /looksLikeBuilderRoute[\s\S]{0,160}runtime_cdp-segment-wizard/.test(src));
}

// ── 6f. BEHAVIOR (not presence): the welcome one-shot survives a "quiet" page ────────
// This EXECUTES the actual guard logic (not a regex). It models the exact bug the user hit:
// land on a page with nothing to announce (quiet), then a page that DOES have something. The
// popup must still appear on the second page. The old eager-flag code failed this.
console.log("\n6f. welcome one-shot behavior: a quiet page must not burn the popup");
{
  // Faithful model of the fixed control flow:
  //   trigger: if (!win.__dcWelcomeShown) schedule(toast)
  //   toast(): if (win.__dcWelcomeShown) return; ...decide content...; if nothing → return
  //            (flag NOT set); else append + set win.__dcWelcomeShown = true.
  function makeWelcome() {
    var win = {};                 // fresh "tab session"
    var rendered = 0;
    function toast(hasContent) {
      if (win.__dcWelcomeShown) return;          // self-guard
      if (!hasContent) return;                   // "nothing to announce" → must NOT set the flag
      rendered++;
      win.__dcWelcomeShown = true;               // set ONLY on real render
    }
    function visitPage(hasContent) {
      if (!win.__dcWelcomeShown) toast(hasContent);   // trigger (no eager set)
    }
    return { visitPage: visitPage, shown: function () { return rendered; }, win: win };
  }

  var w = makeWelcome();
  w.visitPage(false);  // quiet page (e.g. a route with no detected feature)
  eq("quiet page renders nothing", w.shown(), 0);
  ok("quiet page did NOT burn the one-shot (flag still false)", w.win.__dcWelcomeShown !== true);
  w.visitPage(true);   // next page has something to announce
  eq("next page WITH content shows the popup (the reported bug is fixed)", w.shown(), 1);
  w.visitPage(true);   // and again elsewhere
  eq("stays once-per-session after it has shown (no repeat)", w.shown(), 1);

  // Opposite order sanity: an active page first shows once, then never again.
  var w2 = makeWelcome();
  w2.visitPage(true); w2.visitPage(true); w2.visitPage(false);
  eq("active-first: shows exactly once across the session", w2.shown(), 1);
}

// ── 6g. BEHAVIOR: list ⧉ activates on real list pages, NOT a DMO detail Fields tab ───
// Runs the ACTUAL shipped dcActiveListType + dcIsDmoListPage (extracted from source via vm),
// against real URLs. Reproduces the reported bug: on a DMO DETAIL page (…?c__objectApiName=X)
// the Fields tab is a sub-table of field rows — the ⧉ must NOT activate there.
console.log("\n6g. list ⧉ page-gate behavior (DMO detail Fields tab must NOT activate)");
{
  const vm = require("vm");
  const fs = require("fs"), path = require("path");
  const srcG = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  // pull the two functions verbatim from source and evaluate them in a sandbox
  function extract(fnName) {
    var m = srcG.match(new RegExp("function " + fnName + "\\s*\\([^)]*\\)\\s*\\{"));
    if (!m) return null;
    var start = srcG.indexOf(m[0]);
    var i = srcG.indexOf("{", start), depth = 0, end = i;
    for (; i < srcG.length; i++) { var c = srcG[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) { end = i; break; } } }
    return srcG.slice(start, end + 1);
  }
  var code = extract("dcIsDmoListPage") + "\n" + extract("dcActiveListType");
  ok("extracted dcActiveListType + dcIsDmoListPage from source", /function dcActiveListType/.test(code) && /function dcIsDmoListPage/.test(code));
  // sandbox with a settable location.href
  var sb = { location: { href: "", origin: "https://x.my.salesforce.com" }, window: {} };
  vm.runInNewContext(code + "\nthis.dcActiveListType = dcActiveListType;", sb);
  function typeAt(href) { sb.location.href = href; try { return sb.dcActiveListType(); } catch (e) { return { error: String(e) }; } }

  var O = "https://x.lightning.force.com";
  // THE BUG: DMO detail page (Fields tab lives here) — must be null (no ⧉ on fields)
  ok("DMO DETAIL (?c__objectApiName=…) → NOT a list (the reported field-row ⧉ bug)",
    typeAt(O + "/lightning/n/standard-DataModel?c__objectApiName=ssot__EmailEngagement__dlm") === null);
  // DMO LIST (no param) → the one case that NEEDS our ⧉
  var dmo = typeAt(O + "/lightning/n/standard-DataModel");
  ok("DMO LIST (no param) → activates as the DMO list", dmo && dmo.id === "dmo" && dmo.isDmoList === true);
  // a real record detail page → null
  ok("record detail (/r/<Obj>/<id>/view) → not a list", typeAt(O + "/lightning/r/DataStream/1dsHQ0000000A2b/view") === null);
  // the ERD graph → null (handled by its own launcher)
  ok("ERD graph (displayType=graph) → not a list", typeAt(O + "/lightning/n/standard-DataModel?displayType=graph") === null);
  // Object list routes → generic candidate (the PER-ROW link check gates the actual ⧉). Covers
  // ALL object lists, not just /o/*/home, since DC lists live under assorted routes.
  var gen = typeAt(O + "/lightning/o/DataStream/home");
  ok("object list route (/o/<Obj>/home) → generic candidate", gen && gen.id === "generic" && gen.isDmoList === false);
  var genN = typeAt(O + "/lightning/n/Segment");
  ok("nav list route (/n/<...>) → generic candidate", genN && genN.id === "generic");
  // Record detail + workspaces are still explicitly excluded (never a list)
  ok("record detail (/r/<id>/view) → not a list", typeAt(O + "/lightning/r/1dsHQ0000000A2b/view") === null);
  ok("Query Editor workspace → not a generic list", typeAt(O + "/lightning/r/DataQueryWorkspace/20mDQ0/view") === null);

  // THE FIX: extract the SHIPPED record-link regex and verify it accepts BOTH link forms —
  // including the Data Cloud form WITHOUT an <Object> segment (/lightning/r/<id>/view), which
  // was the reason the ⧉ never appeared on any DC object list.
  var reM = srcG.match(/var DC_RECORD_LINK_RE = (\/[^\n]+\/i);/);
  ok("extracted DC_RECORD_LINK_RE from source", !!reM);
  if (reM) {
    var DC_RECORD_LINK_RE = eval(reM[1]);   // the real shipped regex
    ok("accepts DC link WITHOUT object segment (/r/<id>/view) — the reported bug", DC_RECORD_LINK_RE.test("/lightning/r/1dsKh000000TOcwIAG/view"));
    ok("accepts classic link WITH object segment (/r/<Obj>/<id>/view)", DC_RECORD_LINK_RE.test("/lightning/r/DataStream/1dsHQ0000000A2bQAE/view"));
    ok("REJECTS a field/app link (no bogus ⧉ on fields)", !DC_RECORD_LINK_RE.test("/lightning/n/standard-DataModel?c__objectApiName=ssot__Subject__c"));
    ok("REJECTS /o/ and /n/ app routes (not per-record)", !DC_RECORD_LINK_RE.test("/lightning/o/DataStream/home") && !DC_RECORD_LINK_RE.test("/lightning/n/Segment"));
  }
}

// ── 6h. BEHAVIOR: dcRowKeyFrom resolves BOTH row shapes (standard list + custom DMO) ──
// Runs the ACTUAL shipped dcRowKeyFrom + dcRowRealHref + dcDmoListUrl against fake rows. Proves
// the new coverage: a STANDARD Lightning list row (Data Stream/DLO — no data-row-key-value but a
// real /r/ link) now resolves, a DMO custom row (keyed, no link) resolves via the template, and a
// FIELD row (no key, no /r/ link) still resolves to NOTHING (no bogus ⧉).
console.log("\n6h. list ⧉ row resolution behavior (standard list rows now covered)");
{
  const vm = require("vm");
  const fs2 = require("fs"), path2 = require("path");
  const srcH = fs2.readFileSync(path2.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  function extractFn(name) {
    var m = srcH.match(new RegExp("function " + name + "\\s*\\([^)]*\\)\\s*\\{"));
    if (!m) return "";
    var s = srcH.indexOf(m[0]), i = srcH.indexOf("{", s), d = 0, e = i;
    for (; i < srcH.length; i++) { var c = srcH[i]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { e = i; break; } } }
    return srcH.slice(s, e + 1);
  }
  // dcRowRealHref references module-level DC_RECORD_LINK_RE + DC_RECORD_LINK_OBJ_RE + dcListObject.
  var reLine = (srcH.match(/var DC_RECORD_LINK_RE = \/[^\n]+\/i;/) || [""])[0];
  var reObjLine = (srcH.match(/var DC_RECORD_LINK_OBJ_RE = \/[^\n]+\/i;/) || [""])[0];
  var code = reLine + "\n" + reObjLine + "\n" + extractFn("dcListObject") + "\n" + extractFn("dcDmoListUrl") + "\n" + extractFn("dcRowRealHref") + "\n" + extractFn("dcRowKeyFrom");
  ok("extracted dcRowKeyFrom + dcRowRealHref + DC_RECORD_LINK_RE from source", /function dcRowKeyFrom/.test(code) && /function dcRowRealHref/.test(code) && /DC_RECORD_LINK_RE/.test(code));

  // Minimal fake DOM: an element has tagName, getAttribute, parentElement, querySelectorAll,
  // shadowRoot, href. We model the hovered cell → its <tr>.
  function el(tag, attrs, kids) {
    var e = {
      tagName: tag, nodeType: 1, _attrs: attrs || {}, children: kids || [], parentElement: null, shadowRoot: null,
      href: (attrs && attrs.href != null) ? ("https://x.lightning.force.com" + attrs.href) : undefined,
      // geometry: an anchor can carry _x (its left X) so the left-most-link picker can be tested.
      getBoundingClientRect: function () { var x = (this._attrs && this._attrs._x != null) ? this._attrs._x : 0; return { left: x, width: 10, height: 10, top: 0, right: x + 10, bottom: 10 }; },
      getAttribute: function (k) { return (k in this._attrs) ? this._attrs[k] : null; },
      matches: function (sel) {
        if (sel === "a[href]") return this.tagName === "a" && this._attrs.href != null;
        if (sel === "th") return this.tagName === "th";
        if (sel === "td") return this.tagName === "td";
        if (sel === '[role="rowheader"]') return this._attrs.role === "rowheader";
        return false;
      },
      querySelector: function (sel) { var all = this.querySelectorAll(sel); return all.length ? all[0] : null; },
      querySelectorAll: function (sel) {
        var self = this, out = [];
        (function walk(n) { for (var i = 0; i < n.children.length; i++) { var c = n.children[i]; if (sel === "*" || c.matches(sel)) out.push(c); walk(c); } })(self);
        return out;
      }
    };
    for (var i = 0; i < e.children.length; i++) e.children[i].parentElement = e;
    return e;
  }
  var sb = { location: { origin: "https://x.my.salesforce.com", href: "https://x.lightning.force.com/lightning/o/DataStream/home" }, window: {} };
  vm.runInNewContext(code + "\nthis.dcRowKeyFrom = dcRowKeyFrom;", sb);

  // (B) STANDARD list row: no data-row-key-value, name cell has a real /r/ link.
  var link = el("a", { href: "/lightning/r/DataStream/1dsHQ0000000A2bQAE/view" }, []);
  var nameCell = el("th", {}, [link]);
  var stdRow = el("tr", {}, [nameCell]);
  var hitStd = sb.dcRowKeyFrom(nameCell, { id: "generic", isDmoList: false });
  ok("STANDARD list row (classic /r/<Obj>/<id>/view) resolves", !!hitStd && /\/lightning\/r\/DataStream\/1dsHQ0000000A2bQAE\/view$/.test(hitStd.href));

  // THE REPORTED BUG: Data Cloud list rows use /lightning/r/<id>/view (NO object segment).
  var linkDC = el("a", { href: "/lightning/r/1dsKh000000TOcwIAG/view" }, []);
  var nameCellDC = el("th", {}, [linkDC]);
  var stdRowDC = el("tr", {}, [nameCellDC]);
  var hitDC = sb.dcRowKeyFrom(nameCellDC, { id: "generic", isDmoList: false });
  ok("DC list row (/r/<id>/view, NO object segment) now resolves (was the bug)", !!hitDC && /\/lightning\/r\/1dsKh000000TOcwIAG\/view$/.test(hitDC.href));

  // THE REPORTED BUG (Calculated Insights), fixed by OBJECT-MATCHING (proven from the live DOM):
  // list route = /lightning/o/MktCalculatedInsight/list; the row has a "Data Space" lookup column
  // → /r/DataSpace/<id>/view AND the row's own CI → /r/MktCalculatedInsight/<id>/view. The ⧉ must
  // open the CI (object matches the list), NOT the DataSpace. We make the DataSpace link the
  // LEFT-MOST (smaller x) to prove object-matching WINS over geometry (the hardest case).
  var ciEnv = { location: { origin: "https://x.my.salesforce.com", href: "https://x.lightning.force.com/lightning/o/MktCalculatedInsight/list?filterName=__Recent" }, window: {} };
  vm.runInNewContext(code + "\nthis.dcRowKeyFrom = dcRowKeyFrom; this.dcListObject = dcListObject;", ciEnv);
  eq("dcListObject reads MktCalculatedInsight from the list URL", ciEnv.dcListObject(), "MktCalculatedInsight");
  var dsLink  = el("a", { href: "/lightning/r/DataSpace/0vhKh000000TOjwIAG/view", _x: 300 }, []);        // lookup col, LEFT
  var ciLink  = el("a", { href: "/lightning/r/MktCalculatedInsight/1ciKh000000TOjwIAG/view", _x: 760 }, []); // own record, RIGHT
  var multiRow = el("tr", {}, [ el("td", {}, [dsLink]), el("th", {}, [ciLink]) ]);
  var hitMulti = ciEnv.dcRowKeyFrom(multiRow.children[0], { id: "generic", isDmoList: false });
  ok("CI row opens the Calculated Insight (object match), NOT the Data Space lookup — even though DS is left-most",
    !!hitMulti && /\/r\/MktCalculatedInsight\/1ciKh000000TOjwIAG\/view$/.test(hitMulti.href) && !/DataSpace/.test(hitMulti.href));

  // THE HARDER / ACTUAL case: the CI's OWN link is SHORT-FORM (/r/<id>/view, NO object segment —
  // Data Cloud does this), so there's no exact object match. The ONLY object-named link is the
  // Data Space LOOKUP. Must EXCLUDE the other-object lookup and open the short-form CI link —
  // NOT fall back to left-most and grab the Data Space (the still-reported bug).
  var dsLink2 = el("a", { href: "/lightning/r/DataSpace/0vhKh000000TOjwIAG/view", _x: 300 }, []);  // lookup, LEFT, named object
  var ciShort = el("a", { href: "/lightning/r/1ciKh000000TOjwIAG/view", _x: 760 }, []);            // CI own record, short-form, RIGHT
  var multiRow2 = el("tr", {}, [ el("td", {}, [dsLink2]), el("th", {}, [ciShort]) ]);
  var hitMulti2 = ciEnv.dcRowKeyFrom(multiRow2.children[0], { id: "generic", isDmoList: false });
  ok("CI row with SHORT-FORM own link + Data Space lookup → opens the CI, excludes the lookup",
    !!hitMulti2 && /\/lightning\/r\/1ciKh000000TOjwIAG\/view$/.test(hitMulti2.href) && !/DataSpace/.test(hitMulti2.href));

  // And if ONLY a wrong-object lookup exists (row's own record not linked) → open NOTHING.
  var onlyDs = el("tr", {}, [ el("td", {}, [ el("a", { href: "/lightning/r/DataSpace/0vhKh000000TOjwIAG/view", _x: 300 }, []) ]) ]);
  var hitOnlyDs = ciEnv.dcRowKeyFrom(onlyDs.children[0], { id: "generic", isDmoList: false });
  ok("CI row with ONLY a Data Space lookup → opens nothing (never the wrong object)", !hitOnlyDs);

  // DATA GRAPH (proven live): the row CARRIES its own record id in data-row-key-value
  // (0g7Kh000000sXuFIAU — the DataGraph id, NOT the Data Space 0vh…), the name is void(0), and
  // the only <a> is a Data Space lookup (class 'slds-truncate', no outputLookup marker → link
  // scraping grabbed it). The KEY is authoritative: build /lightning/r/DataGraph/<key>/view and
  // IGNORE the row's links. This is the still-opening-Data-Space-on-Data-Graph fix.
  var dgEnv = { location: { origin: "https://x.my.salesforce.com", href: "https://x.lightning.force.com/lightning/o/DataGraph/home" }, window: {} };
  vm.runInNewContext(code + "\nthis.dcRowKeyFrom = dcRowKeyFrom; this.dcListObject = dcListObject;", dgEnv);
  var dgName = el("a", { href: "javascript:void(0);", _x: 117 }, []);
  var dgLookup = el("a", { href: "/lightning/r/0vhKh000000TOjwIAG/view", "class": "slds-truncate", _x: 779 }, []);
  var dgRow = el("tr", { "data-row-key-value": "0g7Kh000000sXuFIAU", "role": "row" }, [ el("th", {}, [dgName]), el("td", {}, [dgLookup]) ]);
  var hitDg = dgEnv.dcRowKeyFrom(dgRow.children[0], { id: "generic", isDmoList: false });
  ok("Data Graph keyed row → opens /r/DataGraph/<key>/view from the KEY, NOT the Data Space lookup",
    !!hitDg && /\/lightning\/r\/DataGraph\/0g7Kh000000sXuFIAU\/view$/.test(hitDg.href) && !/0vhKh000000TOjwIAG/.test(hitDg.href));

  // THE ACTUAL LIVE CI ROW (from the in-tool ⧉ diagnostic): name = <a href='javascript:void(0)'
  // class='text-wrapper'> (NOT a /r/ link), and the ONLY /lightning/r/ link is the Data Space
  // LOOKUP rendered as <a class='...outputLookupLink...' href='/lightning/r/<id>/view'> (SHORT-
  // form, so object-exclusion can't catch it). The lookup must be EXCLUDED by its class → no
  // openable link remains → the ⧉ opens NOTHING (correct: the CI name has no URL in this old
  // Aura list; opening the Data Space was the bug).
  var ciName = el("a", { href: "javascript:void(0);", "class": "text-wrapper", _x: 125 }, []);
  var dsLookup = el("a", { href: "/lightning/r/0vhKh000000TOjwIAG/view", "class": "slds-truncate outputLookupLink", _x: 413 }, []);
  var ciRealRow = el("tr", {}, [ el("th", {}, [ciName]), el("td", {}, [dsLookup]) ]);
  var hitCiReal = ciEnv.dcRowKeyFrom(ciRealRow.children[0], { id: "generic", isDmoList: false });
  ok("LIVE CI row (name=void(0), only link=outputLookupLink Data Space) → ⧉ opens nothing, NOT the Data Space",
    !hitCiReal || !/0vhKh000000TOjwIAG/.test(hitCiReal.href || ""));

  // A GENUINE name link (NOT a lookup class) must STILL resolve (don't over-exclude). Data
  // Streams list: name cell has a real record link with no outputLookup class → opens it.
  var dsEnv = { location: { origin: "https://x.my.salesforce.com", href: "https://x.lightning.force.com/lightning/o/DataStream/home" }, window: {} };
  vm.runInNewContext(code + "\nthis.dcRowKeyFrom = dcRowKeyFrom;", dsEnv);
  var realName = el("a", { href: "/lightning/r/1dsKh000000TOcwIAG/view", "class": "slds-truncate", _x: 125 }, []);
  var dsNameRow = el("tr", {}, [ el("th", {}, [realName]) ]);
  var hitRealName = dsEnv.dcRowKeyFrom(dsNameRow.children[0], { id: "generic", isDmoList: false });
  ok("genuine name link (no outputLookup class) still resolves — lookup-skip doesn't over-exclude",
    !!hitRealName && /1dsKh000000TOcwIAG/.test(hitRealName.href));

  // (A) DMO custom row: keyed, NO link → DMO template URL from the key.
  var dmoCell = el("th", {}, []);
  var dmoRow = el("tr", { "data-row-key-value": "ssot__EmailEngagement__dlm" }, [dmoCell]);
  var hitDmo = sb.dcRowKeyFrom(dmoCell, { id: "dmo", isDmoList: true });
  ok("DMO custom row resolves via the proven c__objectApiName template", !!hitDmo && /c__objectApiName=ssot__EmailEngagement__dlm$/.test(hitDmo.href));

  // THE REPORTED BUG: a DMO row ALSO has RELATED-object links (Data Streams / Data Lake Objects
  // columns → /r/<DataStream id>/view). The DMO template MUST win — we must NOT open the related
  // Data Stream record. Here the row has a Data Stream link but the key is a DMO.
  var dsRelLink = el("a", { href: "/lightning/r/1dsKh0000010xVZIAY/view", _x: 900 }, []);   // related Data Stream col
  var dmoNameCell = el("th", {}, []);                                                         // DMO name = javascript:void(0), no real link
  var dmoRow2 = el("tr", { "data-row-key-value": "ssot__BulkEmailMessage__dlm" }, [dmoNameCell, el("td", {}, [dsRelLink])]);
  var hitDmo2 = sb.dcRowKeyFrom(dmoNameCell, { id: "dmo", isDmoList: true });
  ok("DMO row with a related Data Stream link → opens the DMO (template), NOT the Data Stream",
    !!hitDmo2 && /c__objectApiName=ssot__BulkEmailMessage__dlm$/.test(hitDmo2.href) && !/1dsKh0000010xVZIAY/.test(hitDmo2.href));

  // FIELD row (DMO detail Fields tab): no key, NO /r/ link → must resolve to nothing.
  var fieldCell = el("th", {}, [el("span", {}, [])]);   // just text, no anchor
  var fieldRow = el("tr", {}, [fieldCell]);
  var hitField = sb.dcRowKeyFrom(fieldCell, { id: "generic", isDmoList: false });
  ok("FIELD row (no key, no record link) → NO ⧉ (resolves to null)", hitField === null);

  // HEADER row of a custom datatable must be skipped.
  var hdrRow = el("tr", { "data-row-key-value": "HEADER" }, [el("th", {}, [])]);
  var hitHdr = sb.dcRowKeyFrom(hdrRow.children[0], { id: "dmo", isDmoList: true });
  ok("HEADER row skipped (no ⧉ on the column header)", hitHdr === null);
}

// ── 6i. BEHAVIOR: new-tab hint shows ONCE in bookmarklet mode, NEVER in extension mode ──
// A bookmarklet can't auto-run in a new tab, so clicking a ⧉ shows a one-time heads-up. In
// EXTENSION mode the new tab auto-loads (background injects), so the hint must NOT appear.
console.log("\n6i. new-tab hint: once in bookmarklet mode, never in extension mode");
{
  const vm6i = require("vm");
  const fs6i = require("fs"), path6i = require("path");
  const src6i = fs6i.readFileSync(path6i.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  function grab6i(name) { var m = src6i.match(new RegExp("function " + name + "\\s*\\([^)]*\\)\\s*\\{")); if (!m) return ""; var s = src6i.indexOf(m[0]), i = src6i.indexOf("{", s), d = 0, e = i; for (; i < src6i.length; i++) { var c = src6i[i]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { e = i; break; } } } return src6i.slice(s, e + 1); }
  function run(extMode) {
    var created = 0;
    var fakeEl = { style: {}, innerHTML: "", remove: function () {}, };
    var win = { __dcNewTabHintShown: false, requestAnimationFrame: function (f) {} };
    var sb = {
      extBridgePresent: function () { return extMode; },
      window: win,
      document: { createElement: function () { created++; return fakeEl; }, body: { appendChild: function () {} } },
      requestAnimationFrame: function (f) {}, setTimeout: function () {},
    };
    vm6i.runInNewContext(grab6i("dcNewTabHint") + "\nthis.dcNewTabHint = dcNewTabHint;", sb);
    sb.dcNewTabHint(); sb.dcNewTabHint(); sb.dcNewTabHint();   // 3 clicks
    return created;
  }
  eq("bookmarklet mode: hint shows exactly ONCE across 3 clicks", run(false), 1);
  eq("extension mode: hint NEVER shows (new tab auto-loads)", run(true), 0);
  // wired into BOTH ⧉ click handlers + synced to bookmarklet build
  ok("both ⧉ click handlers call dcNewTabHint()", (src6i.match(/ev\.stopPropagation\(\); dcNewTabHint\(\);/g) || []).length >= 2);
  var bm6i = fs6i.readFileSync(path6i.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");
  ok("new-tab hint synced into bookmarklet build", /function dcNewTabHint\(\)/.test(bm6i));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
