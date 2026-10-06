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
  // 3) used rule (right side)
  var sc = safeGet(el, "simpleCondition");
  if (sc) {
    var subj = sc.subject || {};
    return { kind: "rule", label: sc.label || "", fieldApi: (subj.fieldApiName || sc.attributeName || ""), objectApi: subj.objectApiName || "", fieldType: "" };
  }
  return null;
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

// ── 7. source presence ──────────────────────────────────────────────────────────────
console.log("\n7. source presence (wired, dev-only, reads props directly)");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("segApiInfo defined", /function segApiInfo\s*\(/.test(src));
  ok("reads attributeNode.fieldApiName directly", /attributeNode[\s\S]{0,80}fieldApiName/.test(src));
  ok("reads groupNode.objectApiName", /groupNode[\s\S]{0,80}objectApiName/.test(src));
  ok("reads simpleCondition.subject", /simpleCondition[\s\S]{0,120}subject/.test(src));
  ok("hover tooltip wired (segApiTooltip or title set)", /segApiTooltip|dc-seg-api-tip/.test(src));
  ok("panel wired", /dc-seg-api-panel|openSegApiPanel/.test(src));
  ok("panel opened FROM existing launcher (no separate floating button)", /__dcOpenSegApiPanel/.test(src) && !/dc-seg-api-btn/.test(src));
  ok("launcher has an 'API names' menu row (segment-only, dev-gated)", /dc-seg-api-row/.test(src) && /typeof window\.__dcOpenSegApiPanel === "function"/.test(src));
  ok("panel rows are click-to-copy with a toast", /dc-seg-copy/.test(src) && /function segCopy\s*\(/.test(src) && /segToast/.test(src));
  ok("targets the real tags", /runtime_cdp-attribute-row/.test(src) && /runtime_cdp-segment-builder-simple-condition/.test(src));
  ok("OLD fragile label-matching annotation removed (no fetchDmo/labelToDevName)", !/function fetchDmo\s*\(/.test(src) && !/labelToDevName\s*[=\[]/.test(src));
  ok("feature is dev-only (@strip wraps segApi code)", /@strip:start[\s\S]*segApiInfo[\s\S]*@strip:end/.test(src));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
