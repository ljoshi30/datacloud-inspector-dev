// DOM-only "Document Activation" export (dev-only, BOOKMARKLET-safe). Behavior + source/strip. Run in Node:
//   node test/activation-doc-export.test.js
//
// The extension is banned by the client org's policy, so this feature reads the activation
// STRAIGHT FROM THE PAGE (no Connect API, no bridge) and exports it — Salesforce-styled, with
// API names inline — to CSV / Excel. It NEVER navigates the Save/Publish-capable wizard: it
// reads the CURRENT step and ACCUMULATES step-specific extras (output names, contact points,
// static values) as the user naturally visits them, labeling honestly what isn't captured yet.
//
// DOM shapes (from live-org probe captures + the live screenshot that corrected the contact-point
// shape — those channel props are OBJECTS, not strings; rendering them raw produced "[object Object]"):
//   runtime_cdp-activation-summary  → the WHOLE activation, IDENTICAL on every step:
//     selectedDataSpace{label,value}  selectedSegment{name,segmentOnLabel,segmentOnDeveloperName,
//       count,segmentPublishType,segmentSchedule}  selectedTarget{name,connectionTypeLabel,
//       platformName,businessUnits[]}  includedAttributes[]{uid,label,attributeName=fieldApi,
//       category,entityName=objectApi}
//   runtime_cdp-activation-attribute-datatable .data[] (ONLY on the Attributes step):
//     {uid,name,defaultOutputName|preferredName,entityName,queryPathString}  + static rows
//     {staticAttributeName,staticAttributeValue,entityName}
//   runtime_cdp-activation-channel-wizard (ONLY on the Contact Points step):
//     {selectedPlatform,targetConnectionType, contactPointEmail/Phone/Push/WhatsApp/Address}
//     where each contactPoint* is EITHER a plain string OR a config object carrying some of
//     {fieldApiName|name, contactPointEntityName|entityName, label, queryPathConfig.configs[]}.
// These tests run a faithful MIRROR of the source functions over that real-shaped data —
// they prove BEHAVIOR (incl. the [object Object] fix), not just that strings exist in the file.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ─────────────────────────────────────────────────────────────────────────────
// MIRROR of the source functions (kept in sync with console-decorate.extension.js).
// segSafeGet mimics the source's try/catch property reader. "Elements" here are plain
// objects with a tagName + the LWC props the real elements expose.
// ─────────────────────────────────────────────────────────────────────────────
function segSafeGet(o, k) { try { return o[k]; } catch (e) { return undefined; } }

function docActParsePath(s) {
  if (!s) return [];
  try { var p = JSON.parse(s); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}
function docActPathText(hops) {
  if (!hops || !hops.length) return "";
  return hops.map(function (h) {
    var o = (h.objectApiName || h.objectName || "").replace(/__dlm$|__cio$|__dll$|__dls$/g, "");
    var f = h.fieldApiName || h.fieldName || "";
    return f ? (o + "." + f) : o;
  }).filter(Boolean).join(" → ");
}
function docActObjKind(api) {
  var a = String(api || "").toLowerCase();
  if (/__dlm$/.test(a)) return "DMO";
  if (/__(dll|dls)$/.test(a)) return "DLO";
  if (/__cio$/.test(a)) return "CI";
  return "";
}

// ── Contact-point normalizer (the [object Object] fix) — mirror of the source. ──
function docActCpStr(v) { return (v == null) ? "" : (typeof v === "object" ? "" : String(v)); }
function docActCpFirst(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var val = obj[keys[i]];
    if (val != null && typeof val !== "object" && String(val).length) return String(val);
  }
  return "";
}
function docActHopsText(qp) {
  if (!qp || !qp.length) return "";
  return qp.map(function (s) {
    if (!s || typeof s !== "object") return "";
    var o = (s.objectApiName || s.objectName || s.entityName || s.objectLabel || "").replace(/__dlm$|__cio$|__dll$|__dls$/g, "");
    var f = s.fieldApiName || s.fieldName || s.fieldLabel || s.name || "";
    return f ? (o + "." + f) : o;
  }).filter(Boolean).join(" → ");
}
function docActLooksLikeHops(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every(function (s) {
    return s && typeof s === "object" && (s.objectApiName || s.objectName || s.entityName || s.fieldApiName || s.fieldName);
  });
}
function docActCpPath(obj) {
  try {
    if (obj.pathComboboxOptions && obj.pathComboboxOptions.length && obj.pathIndex != null) {
      var idx = parseInt(obj.pathIndex, 10);
      var opt = obj.pathComboboxOptions[idx];
      if (opt && opt.label) return opt.label;
    }
    var cfgs = (obj.queryPathConfig && obj.queryPathConfig.configs) || obj.configs;
    if (cfgs && cfgs.length) {
      for (var i = 0; i < cfgs.length; i++) {
        var qp = cfgs[i] && (cfgs[i].queryPath || cfgs[i].path || cfgs[i].hops);
        var t = docActHopsText(qp);
        if (t) return t;
      }
    }
    var direct = obj.queryPath || obj.path || obj.hops || obj.joinPath;
    var dt = docActHopsText(direct);
    if (dt) return dt;
    if (obj.queryPathString) { var st = docActPathText(docActParsePath(obj.queryPathString)); if (st) return st; }
    var found = "";
    (function scan(node, depth) {
      if (found || !node || typeof node !== "object" || depth > 4) return;
      if (docActLooksLikeHops(node)) { found = docActHopsText(node); return; }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length && !found; k++) {
        var v = node[keys[k]];
        if (v && typeof v === "object") scan(v, depth + 1);
      }
    })(obj, 0);
    if (found) return found;
  } catch (e) {}
  return "";
}
var DOCACT_CP_NOISE_KEYS = { disablePathDropdown: 1, pathIndex: 1, disabled: 1, readOnly: 1, isLoading: 1 };
function docActCpDump(obj) {
  try {
    return Object.keys(obj).filter(function (k) {
      var val = obj[k];
      return !DOCACT_CP_NOISE_KEYS[k] && val != null && typeof val !== "object" && typeof val !== "function" && String(val).length;
    }).map(function (k) { return k + ": " + String(obj[k]); }).join(", ");
  } catch (e) { return ""; }
}
function docActCpExtract(v) {
  if (v == null || v === "") return { present: false, value: "", fieldApi: "", entityApi: "", path: "", dump: "" };
  if (typeof v !== "object") return { present: true, value: String(v), fieldApi: String(v), entityApi: "", path: "", dump: "" };
  var fieldApi = docActCpFirst(v, ["fieldApiName", "name", "contactPointFieldName", "fieldName", "developerName"]);
  var entityApi = docActCpFirst(v, ["contactPointEntityName", "entityName", "objectApiName", "objectName", "dmoApiName"]);
  var label = docActCpFirst(v, ["label", "fieldLabel", "masterLabel", "displayName"]);
  if (!fieldApi && v.fieldConfig && v.fieldConfig.contactPointFields && v.fieldConfig.contactPointFields.length) {
    var f0 = v.fieldConfig.contactPointFields[0] || {};
    fieldApi = f0.name || f0.fieldApiName || "";
    label = label || f0.label || "";
  }
  var path = docActCpPath(v);
  var value = label || fieldApi || "";
  var dump = (value || path || entityApi) ? "" : docActCpDump(v);
  if (!value && !path && !entityApi && !dump) return { present: false, value: "", fieldApi: "", entityApi: "", path: "", dump: "" };
  return { present: true, value: value, fieldApi: fieldApi, entityApi: entityApi, path: path, dump: dump };
}
function docActCpText(cpv) {
  if (!cpv || !cpv.present) return "";
  var bits = [];
  if (cpv.value) bits.push(cpv.value);
  if (cpv.fieldApi && cpv.fieldApi !== cpv.value) bits.push(cpv.fieldApi);
  if (cpv.entityApi) bits.push(cpv.entityApi);
  if (cpv.path) bits.push(cpv.path);
  if (!bits.length && cpv.dump) bits.push(cpv.dump);
  if (!bits.length) bits.push("Configured");
  return bits.join(" · ");
}

function docActReadFilters(summaryEl, seg) {
  var out = [];
  function pushText(label, raw) {
    if (raw == null) return;
    var t = (typeof raw === "object") ? docActCpDump(raw) : String(raw);
    if (t && t.length) out.push({ label: label, text: t });
  }
  try {
    if (seg) {
      if (seg.filterLabel || seg.filterText || seg.criteriaText) pushText("Segment filter", seg.filterText || seg.criteriaText || seg.filterLabel);
      if (Array.isArray(seg.filters)) seg.filters.forEach(function (f, i) {
        var lbl = (f && (f.label || f.name)) ? (f.label || f.name) : ("Filter " + (i + 1));
        pushText(lbl, f && (f.text || f.filterExpression || f.expression || f.displayText || f));
      });
    }
    ["relatedDmoFilters", "directDmoFilters", "dmoFilters", "activationFilters", "filters"].forEach(function (k) {
      var v = summaryEl && segSafeGet(summaryEl, k);
      if (Array.isArray(v)) v.forEach(function (f, i) {
        var txt = f && (f.filterExpression || f.expression || f.label || f.displayText);
        pushText((f && f.entityName ? f.entityName.replace(/__dlm$/, "") + " filter" : k + " " + (i + 1)), txt || f);
      });
    });
  } catch (e) {}
  return out;
}

// Filter-exists badge, from the attribute-wizard's plain innerText (panel CLOSED):
// "<Group Label> (N)\nAdd Filters" (no filter) or "...\nEdit Filters" (filter applied).
function docActParseFilterBadges(wizardText) {
  var out = {};
  if (!wizardText) return out;
  var re = /([A-Za-z0-9 _.]+?)\s*\((\d+)\)\s*\n\s*(Add Filters|Edit Filters)/g;
  var m;
  while ((m = re.exec(wizardText))) out[m[1].trim()] = { count: parseInt(m[2], 10), hasFilter: m[3] === "Edit Filters" };
  return out;
}
var DOCACT_FILTER_OPS = ["Has Value", "Is Null", "Is Not Null", "Does Not Contain", "Not Equal To",
  "Not Equal", "Starts With", "Ends With", "Greater Than Or Equal", "Less Than Or Equal",
  "Greater Than", "Less Than", "Not In", "Contains", "Equals", "Between", "In"];
// The open "Edit/Add Filters" dialog's plain innerText → {entityLabel, path, conditions[]}.
function docActParseFilterDialog(dialogText) {
  if (!dialogText) return null;
  var flat = dialogText.replace(/\s+/g, " ").trim();
  var titleM = /Filter "([^"]+)" Attributes/.exec(flat);
  var pathM = /\bPath\s+(.+?)\s+Attributes\s*\(\d+\)/.exec(flat);
  var spanM = /Drag and drop\s+(.+?)\s+Add another Attribute here/.exec(flat);
  var conditions = [];
  if (spanM && spanM[1]) {
    var span = spanM[1].trim();
    var opAlt = DOCACT_FILTER_OPS.map(function (o) { return o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|");
    var condRe = new RegExp("([A-Za-z0-9 _.]+?)\\s+(" + opAlt + ")(?=\\s+[A-Z]|$)", "g");
    var cm;
    while ((cm = condRe.exec(span))) conditions.push({ field: cm[1].trim(), operator: cm[2].trim() });
    if (!conditions.length) conditions.push({ field: "", operator: "", text: span });
  }
  if (!titleM && !conditions.length) return null;
  return { entityLabel: titleM ? titleM[1] : "", path: pathM ? pathM[1].trim() : "", conditions: conditions };
}

// scrape over a provided list of "elements" + a persistent accumulator (the source keeps one
// per recordId in _docActAccum; here we pass it in so we can simulate visiting two steps).
function docActReadRefreshType(raw) {
  var best = "";
  for (var i = 0; i < raw.length; i++) {
    var el = raw[i];
    var txt = "";
    try { txt = (el.children && el.children.length <= 2) ? (el.textContent || "").trim() : ""; } catch (e) {}
    if (/^Activation Refresh Type\S/.test(txt) && txt.length < 60 && (!best || txt.length < best.length)) best = txt;
  }
  return best ? best.replace(/^Activation Refresh Type\s*/i, "").trim() : "";
}
function docActScrapeOver(raw, acc) {
  var summaryEl = null, attrTables = [], channelEl = null, attrWizardEl = null, filterDialogEl = null;
  raw.forEach(function (el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "runtime_cdp-activation-summary") summaryEl = summaryEl || el;
    else if (tag === "runtime_cdp-activation-attribute-datatable") attrTables.push(el);
    else if (tag === "runtime_cdp-activation-channel-wizard") channelEl = channelEl || el;
    else if (tag === "runtime_cdp-activation-attribute-wizard") attrWizardEl = attrWizardEl || el;
    else if (tag === "runtime_cdp-activation-related-attributes-filter-dialog") filterDialogEl = filterDialogEl || el;
  });

  if (attrWizardEl) {
    var badges = docActParseFilterBadges(attrWizardEl.innerText || attrWizardEl.textContent || "");
    Object.keys(badges).forEach(function (k) { acc.filterGroups[k] = badges[k]; });
  }
  if (filterDialogEl) {
    var parsed = docActParseFilterDialog(filterDialogEl.innerText || filterDialogEl.textContent || "");
    if (parsed && parsed.entityLabel) acc.filterConditions[parsed.entityLabel] = parsed;
  }
  var sidebarRefresh = docActReadRefreshType(raw);
  if (sidebarRefresh) acc.refreshType = sidebarRefresh;

  var out = {
    found: !!summaryEl, overview: {}, attributes: [], contactPoints: [], staticRows: [], waterfall: null,
    filterGroups: [], filterConditions: [],
    captured: { attributes: false, outputNames: false, contactPoints: false, staticValues: false, filterGroups: false }
  };

  if (summaryEl) {
    var ds = segSafeGet(summaryEl, "selectedDataSpace") || {};
    var seg = segSafeGet(summaryEl, "selectedSegment") || {};
    var tgt = segSafeGet(summaryEl, "selectedTarget") || {};
    out.overview = {
      dataSpace: ds.label || ds.value || "", dataSpaceApi: ds.value || "",
      segment: seg.name || "", segmentApi: seg.segmentOnDeveloperName || seg.segmentApiName || "",
      segmentOn: seg.segmentOnLabel || "", segmentOnApi: seg.segmentOnDeveloperName || "",
      segmentCount: (seg.count != null ? seg.count : ""),
      publishType: seg.segmentPublishType || "",
      target: tgt.name || "", connectionType: tgt.connectionTypeLabel || tgt.connectionType || "",
      platform: tgt.platformName || segSafeGet(summaryEl, "selectedPlatformName") || "",
      businessUnits: (tgt.businessUnits && tgt.businessUnits.slice ? tgt.businessUnits.slice() : []),
      eventType: segSafeGet(summaryEl, "selectedEventType") || "",
      isWaterfall: !!segSafeGet(summaryEl, "isSelectedSegmentWaterfall"),
      refreshType: acc.refreshType || docActCpStr(segSafeGet(summaryEl, "refreshType") || segSafeGet(summaryEl, "activationRefreshType") || seg.refreshType || seg.activationRefreshType || tgt.refreshType),
      processingType: docActCpStr(segSafeGet(summaryEl, "processingType") || seg.processingType),
      schedule: seg.segmentSchedule || seg.schedule || seg.publishSchedule || "",
      filters: docActReadFilters(summaryEl, seg)
    };
    if (out.overview.isWaterfall) { var subs = segSafeGet(summaryEl, "selectedWaterfallSubsegments"); out.waterfall = (subs && subs.slice) ? subs.slice() : []; }
    var inc = segSafeGet(summaryEl, "includedAttributes") || [];
    out.captured.attributes = inc.length > 0;
    inc.forEach(function (a) {
      if (!a) return;
      out.attributes.push({ uid: a.uid || "", label: a.label || "", fieldApi: a.attributeName || "", objectApi: a.entityName || "", category: a.category || "", outputName: "", path: "", source: "INCLUDED" });
    });
  }

  attrTables.forEach(function (el) {
    var data = segSafeGet(el, "data");
    if (!data || !data.length) return;
    data.forEach(function (d) {
      if (!d) return;
      if (d.staticAttributeName != null || d.staticAttributeValue != null) {
        var srow = { name: d.staticAttributeName || d.name || "", value: (d.staticAttributeValue != null ? String(d.staticAttributeValue) : ""), objectApi: d.entityName || "" };
        var sKey = srow.name + "" + srow.value + "" + srow.objectApi;
        if (!acc.staticRows.some(function (x) { return (x.name + "" + x.value + "" + x.objectApi) === sKey; })) acc.staticRows.push(srow);
        return;
      }
      if (!d.uid) return;
      var outName = d.defaultOutputName || d.preferredName || "";
      if (outName) acc.outputByUid[d.uid] = outName;
      var hops = docActParsePath(d.queryPathString);
      if (hops.length) acc.pathByUid[d.uid] = docActPathText(hops);
    });
  });

  if (channelEl) {
    var cp = {
      platform: docActCpStr(segSafeGet(channelEl, "selectedPlatform")), connectionType: docActCpStr(segSafeGet(channelEl, "targetConnectionType")),
      email: docActCpExtract(segSafeGet(channelEl, "contactPointEmail")), phone: docActCpExtract(segSafeGet(channelEl, "contactPointPhone")),
      push: docActCpExtract(segSafeGet(channelEl, "contactPointPush")), whatsApp: docActCpExtract(segSafeGet(channelEl, "contactPointWhatsApp")),
      address: docActCpExtract(segSafeGet(channelEl, "contactPointAddress"))
    };
    var hasAny = ["email", "phone", "push", "whatsApp", "address"].some(function (k) { return cp[k] && cp[k].present; });
    if (hasAny) { var key = JSON.stringify(cp); if (!acc.contactPoints.some(function (x) { return JSON.stringify(x) === key; })) acc.contactPoints.push(cp); }
  }

  out.attributes.forEach(function (row) {
    if (row.uid && acc.outputByUid[row.uid]) row.outputName = acc.outputByUid[row.uid];
    if (row.uid && acc.pathByUid[row.uid]) row.path = acc.pathByUid[row.uid];
  });
  out.captured.outputNames = Object.keys(acc.outputByUid).length > 0;
  out.staticRows = acc.staticRows.slice();
  out.captured.staticValues = acc.staticRows.length > 0;
  out.contactPoints = acc.contactPoints.slice();
  out.captured.contactPoints = acc.contactPoints.length > 0;
  out.filterGroups = Object.keys(acc.filterGroups).map(function (label) {
    var g = acc.filterGroups[label];
    var cond = acc.filterConditions[label];
    return { label: label, count: g.count, hasFilter: g.hasFilter, conditions: cond ? cond.conditions : [], path: cond ? cond.path : "" };
  });
  out.captured.filterGroups = out.filterGroups.length > 0;
  return out;
}
function newAccum() { return { outputByUid: {}, staticRows: [], contactPoints: [], pathByUid: {}, lastSeen: {}, filterGroups: {}, filterConditions: {}, refreshType: "" }; }

// CSV = ATTRIBUTES ONLY (per the user's feedback): no overview/contact/static rows, no Join Path col.
function docActCsv(data) {
  function q(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var lines = [];
  lines.push(["Label", "Field API", "Object / DMO API", "Output Name", "Category"].map(q).join(","));
  data.attributes.forEach(function (a) { lines.push([a.label, a.fieldApi, a.objectApi, a.outputName, a.category].map(q).join(",")); });
  return lines.join("\r\n");
}

// ── Real-shaped fixtures (names/shape straight from the live-org probe captures) ──
// STEP 1 = the review step that appears after clicking Edit: ONLY the summary is present.
function summaryEl() {
  return {
    tagName: "runtime_cdp-activation-summary",
    selectedDataSpace: { label: "TD Insurance", value: "TD_Insurance__dls" },
    selectedSegment: { name: "SF_EM_GI_VIF__All-Subs", segmentOnLabel: "Individual", segmentOnDeveloperName: "IndividualG__dlm", count: 51878, segmentPublishType: "DAILY", segmentSchedule: "Daily at 2:00 AM" },
    selectedTarget: { name: "Marketing Cloud – TD Bank Insurance", connectionTypeLabel: "Marketing Cloud", platformName: "MarketingCloud", businessUnits: ["TDI GI - SIT_520005329"] },
    selectedPlatformName: "MarketingCloud",
    isSelectedSegmentWaterfall: false,
    includedAttributes: [
      { uid: "u1", label: "Email Address", attributeName: "ssot__EmailAddress__c", entityName: "ssot__ContactPointEmail__dlm", category: "Profile" },
      { uid: "u2", label: "First Name", attributeName: "FirstName__c", entityName: "IndividualG__dlm", category: "Profile" },
      { uid: "u3", label: "Loyalty Tier", attributeName: "Tier__c", entityName: "IndividualG__dlm", category: "Profile" }
    ]
  };
}
// STEP 2 = the Attributes step: summary + the datatable with output names, a join path, and one static row.
function attrDatatableEl() {
  return {
    tagName: "runtime_cdp-activation-attribute-datatable",
    data: [
      { uid: "u1", name: "Email Address", defaultOutputName: "email", entityName: "ssot__ContactPointEmail__dlm", queryPathString: JSON.stringify([{ objectApiName: "IndividualG__dlm", fieldApiName: "Id" }, { objectApiName: "ssot__ContactPointEmail__dlm", fieldApiName: "ssot__PartyId__c" }]) },
      { uid: "u2", name: "First Name", preferredName: "first_name", entityName: "IndividualG__dlm", queryPathString: "" },
      { uid: "u3", name: "Loyalty Tier", defaultOutputName: "tier", entityName: "IndividualG__dlm" },
      { staticAttributeName: "campaign_id", staticAttributeValue: "VIF-2026-Q1", entityName: "IndividualG__dlm" }
    ]
  };
}
// STEP 3 = the Contact Points step. The channel props are OBJECTS (the live screenshot proved this —
// rendering them raw produced "[object Object]"). Email carries a nested path config; Address is a
// bare object with NO known keys (exercises the key:value dump fallback).
function channelEl() {
  return {
    tagName: "runtime_cdp-activation-channel-wizard",
    selectedPlatform: "MarketingCloud", targetConnectionType: "Marketing Cloud",
    contactPointEmail: {
      fieldApiName: "ssot__EmailAddress__c", contactPointEntityName: "ssot__ContactPointEmail__dlm", label: "Email Address",
      queryPathConfig: { configs: [{ queryPath: [{ objectApiName: "IndividualG__dlm", fieldApiName: "Id" }, { objectApiName: "ssot__ContactPointEmail__dlm", fieldApiName: "ssot__EmailAddress__c" }] }] }
    },
    contactPointPhone: "", contactPointPush: "", contactPointWhatsApp: "",
    contactPointAddress: { mysteryKeyA: "Primary Mailing", mysteryKeyB: 2 }   // no known keys → dump fallback
  };
}

console.log("\n1. path parsing + text: queryPathString (JSON hop pairs) → readable DMO.field → … chain");
{
  var hops = docActParsePath(JSON.stringify([{ objectApiName: "IndividualG__dlm", fieldApiName: "Id" }, { objectApiName: "ssot__ContactPointEmail__dlm", fieldApiName: "ssot__PartyId__c" }]));
  eq("parses the JSON array of hops", hops.length, 2);
  eq("renders the join path, __dlm suffix stripped on object names", docActPathText(hops), "IndividualG.Id → ssot__ContactPointEmail.ssot__PartyId__c");
  eq("empty/garbage string → no hops (never throws)", docActParsePath("").length + docActParsePath("{not json").length, 0);
  eq("empty hops → empty path text", docActPathText([]), "");
}

console.log("\n2. object-kind from API suffix (no guessing — blank when unknown)");
{
  eq("__dlm → DMO", docActObjKind("IndividualG__dlm"), "DMO");
  eq("__dll → DLO", docActObjKind("Foo__dll"), "DLO");
  eq("__cio → CI", docActObjKind("Metric__cio"), "CI");
  eq("unknown suffix → blank (don't mislabel)", docActObjKind("Account"), "");
  eq("blank in → blank out", docActObjKind(""), "");
}

console.log("\n3. ONE summary element = the whole core doc (no step traversal needed)");
{
  var out = docActScrapeOver([summaryEl()], newAccum());
  ok("found the activation from summary alone", out.found === true);
  eq("data space label", out.overview.dataSpace, "TD Insurance");
  eq("data space API captured", out.overview.dataSpaceApi, "TD_Insurance__dls");
  eq("segment name", out.overview.segment, "SF_EM_GI_VIF__All-Subs");
  eq("segment-on API name", out.overview.segmentOnApi, "IndividualG__dlm");
  eq("target", out.overview.target, "Marketing Cloud – TD Bank Insurance");
  eq("connection type label preferred", out.overview.connectionType, "Marketing Cloud");
  eq("platform", out.overview.platform, "MarketingCloud");
  eq("business units carried through", out.overview.businessUnits.join(","), "TDI GI - SIT_520005329");
  eq("schedule read from segment", out.overview.schedule, "Daily at 2:00 AM");
  eq("membership captured verbatim (labeled 'as shown' elsewhere)", out.overview.segmentCount, 51878);
  eq("all 3 included attributes read", out.attributes.length, 3);
  eq("each attribute carries its real field API", out.attributes[0].fieldApi, "ssot__EmailAddress__c");
  eq("each attribute carries its object API", out.attributes[0].objectApi, "ssot__ContactPointEmail__dlm");
  ok("captured flag: attributes TRUE, step-only extras FALSE (honest)", out.captured.attributes === true && out.captured.outputNames === false && out.captured.contactPoints === false && out.captured.staticValues === false);
  ok("on summary-only step, NO output names yet (don't fabricate)", out.attributes.every(function (a) { return a.outputName === ""; }));
}

console.log("\n4. accumulation across steps: output names + path + static + contact points FOLD IN as the user visits");
{
  var acc = newAccum();
  var s1 = docActScrapeOver([summaryEl()], acc);
  ok("step 1: attributes yes, extras no", s1.captured.attributes && !s1.captured.outputNames && !s1.captured.contactPoints && !s1.captured.staticValues);
  var s2 = docActScrapeOver([summaryEl(), attrDatatableEl()], acc);
  eq("step 2: output name merged by uid (u1 → 'email')", s2.attributes[0].outputName, "email");
  eq("step 2: preferredName used when defaultOutputName absent (u2 → 'first_name')", s2.attributes[1].outputName, "first_name");
  eq("step 2: join path merged by uid", s2.attributes[0].path, "IndividualG.Id → ssot__ContactPointEmail.ssot__PartyId__c");
  eq("step 2: static value captured", s2.staticRows.length, 1);
  eq("step 2: static name/value right", s2.staticRows[0].name + "=" + s2.staticRows[0].value, "campaign_id=VIF-2026-Q1");
  ok("step 2 captured flags flip on for output names + static", s2.captured.outputNames && s2.captured.staticValues && !s2.captured.contactPoints);
  var s3 = docActScrapeOver([summaryEl(), channelEl()], acc);
  eq("step 3: one contact point captured", s3.contactPoints.length, 1);
  ok("step 3: earlier extras STILL present (accumulator persists across steps)", s3.captured.outputNames && s3.captured.staticValues && s3.captured.contactPoints);
  eq("step 3: output name still merged (not lost when datatable left the DOM)", s3.attributes[0].outputName, "email");
}

console.log("\n5. [object Object] FIX: object-shaped contact-point props are extracted, never rendered as [object Object]");
{
  var out = docActScrapeOver([summaryEl(), channelEl()], newAccum());
  var cp = out.contactPoints[0];
  // Email channel = object with known keys → value/field/entity/path all extracted.
  eq("email value = human label", cp.email.value, "Email Address");
  eq("email field API extracted from object", cp.email.fieldApi, "ssot__EmailAddress__c");
  eq("email entity API extracted from object", cp.email.entityApi, "ssot__ContactPointEmail__dlm");
  eq("email path built from nested queryPathConfig", cp.email.path, "IndividualG.Id → ssot__ContactPointEmail.ssot__EmailAddress__c");
  ok("email present flag true", cp.email.present === true);
  // Address channel = object with NO known keys → readable key:value dump, NOT [object Object].
  ok("address present flag true (object is a configured channel)", cp.address.present === true);
  eq("address falls back to readable key:value dump", cp.address.dump, "mysteryKeyA: Primary Mailing, mysteryKeyB: 2");
  // The flattened text used by CSV/Excel must never contain the JS object toString.
  var emailText = docActCpText(cp.email), addrText = docActCpText(cp.address);
  ok("email flattened text has value + field api", /Email Address/.test(emailText) && /ssot__EmailAddress__c/.test(emailText));
  ok("NO '[object Object]' anywhere in flattened contact-point text", emailText.indexOf("[object Object]") === -1 && addrText.indexOf("[object Object]") === -1);
  eq("address flattened text = its dump", addrText, "mysteryKeyA: Primary Mailing, mysteryKeyB: 2");
  // empty channels normalize to not-present (no phantom rows)
  ok("empty string channel → not present", cp.phone.present === false && cp.push.present === false && cp.whatsApp.present === false);
  // A plain-string channel (older DOM shape) still works (backward compatible).
  var strCp = docActCpExtract("ssot__MobilePhone__c");
  ok("string-form channel stays supported", strCp.present === true && strCp.value === "ssot__MobilePhone__c");
  // REGRESSION (user-reported from a live screenshot): an UNCONFIGURED channel (user never set
  // up Push/WhatsApp/Address) is an object carrying only combobox UI-state plumbing, no real
  // config. Must normalize to not-present — must NOT render "disablePathDropdown: true, pathIndex: -1".
  var unconfigured = docActCpExtract({ disablePathDropdown: true, pathIndex: -1 });
  eq("unconfigured channel (only UI-state keys) → not present", unconfigured.present, false);
  eq("unconfigured channel → no noise dump", unconfigured.dump, "");
}

console.log("\n6. contact points de-dupe (revisiting the step must not pile up copies)");
{
  var acc = newAccum();
  docActScrapeOver([summaryEl(), channelEl()], acc);
  docActScrapeOver([summaryEl(), channelEl()], acc);   // revisit same step, identical content
  var out = docActScrapeOver([summaryEl(), channelEl()], acc);
  eq("still exactly one contact point after 3 visits", out.contactPoints.length, 1);
}

console.log("\n6b. PERSISTENCE: a capture from one step SURVIVES navigating to a step that no longer has that element");
{
  // The source persists the accumulator on window.__dcDocActAccum, so re-running the bookmarklet
  // on a later step (where the channel element is GONE) must still show the earlier capture.
  // The mirror models that by reusing the SAME acc across calls (= the window store).
  var acc = newAccum();
  // Step: Contact Points — channel present → email captured.
  var atContact = docActScrapeOver([summaryEl(), channelEl()], acc);
  eq("contact point captured while on the Contact Points step", atContact.contactPoints.length, 1);
  ok("email value present at capture time", atContact.contactPoints[0].email.present === true);
  // User moves to the NEXT step → bookmarklet re-runs; summary is still there but NO channel element.
  var atNextStep = docActScrapeOver([summaryEl()], acc);
  eq("contact point STILL present after moving to a step without the channel (not wiped)", atNextStep.contactPoints.length, 1);
  ok("the persisted email is intact (regression guard for the 'removes contact point' bug)", atNextStep.contactPoints[0].email.present === true && atNextStep.contactPoints[0].email.fieldApi === "ssot__EmailAddress__c");
  // And output names captured on the Attributes step earlier also persist here.
  docActScrapeOver([summaryEl(), attrDatatableEl()], acc);          // visit Attributes
  var afterAll = docActScrapeOver([summaryEl()], acc);              // land somewhere with neither
  ok("output names + static + contact points ALL persist on a bare step", afterAll.captured.outputNames && afterAll.captured.staticValues && afterAll.captured.contactPoints);
}

console.log("\n6c. CONTACT-POINT PATH capture, incl. deep-scan when the hop array hides under an unknown key");
{
  // Known nested config path.
  var cp1 = docActCpExtract(channelEl().contactPointEmail);
  eq("path from known queryPathConfig.configs[].queryPath", cp1.path, "IndividualG.Id → ssot__ContactPointEmail.ssot__EmailAddress__c");
  // Path hidden under an UNKNOWN wrapper key → the bounded deep-scan must still find the hop array.
  var weird = { fieldApiName: "ssot__Mobile__c", somethingUnexpected: { nestedWrapper: { theHops: [
    { objectApiName: "IndividualG__dlm", fieldApiName: "Id" },
    { objectApiName: "ssot__ContactPointPhone__dlm", fieldApiName: "ssot__PhoneNumber__c" }
  ] } } };
  var cp2 = docActCpExtract(weird);
  eq("deep-scan finds the hop array under an unknown key", cp2.path, "IndividualG.Id → ssot__ContactPointPhone.ssot__PhoneNumber__c");
  eq("field api still extracted alongside the deep-scanned path", cp2.fieldApi, "ssot__Mobile__c");
  // A non-path nested object must NOT be mistaken for a path.
  var noPath = docActCpExtract({ fieldApiName: "x__c", meta: { createdBy: "someone", count: 3 } });
  eq("no false-positive path from a non-hop nested object", noPath.path, "");
}

console.log("\n6d. STATIC VALUES de-dupe across re-runs (the 'Static Values (12)' = 3 unique × 4 re-runs bug)");
{
  // A multi-static-row datatable, mirroring the live capture (Campaign Name / Waver Number / Segment Name).
  function multiStaticEl() {
    return { tagName: "runtime_cdp-activation-attribute-datatable", data: [
      { staticAttributeName: "Campaign Name", staticAttributeValue: "Multiline adhoc giftcard", entityName: "IndividualG__dlm" },
      { staticAttributeName: "Waver Number",  staticAttributeValue: "1",                        entityName: "IndividualG__dlm" },
      { staticAttributeName: "Segment Name",  staticAttributeValue: "1234_64598_Gift_Card_Auto__95T_W1_1-1_T", entityName: "IndividualG__dlm" }
    ]};
  }
  var acc = newAccum();
  docActScrapeOver([summaryEl(), multiStaticEl()], acc);   // 1st visit
  docActScrapeOver([summaryEl(), multiStaticEl()], acc);   // re-run (step revisited / bookmarklet re-ran)
  docActScrapeOver([summaryEl(), multiStaticEl()], acc);   // re-run
  var out = docActScrapeOver([summaryEl(), multiStaticEl()], acc);   // 4th scrape — the screenshot had 4×
  eq("exactly 3 unique static rows after 4 scrapes (was 12 before the de-dupe fix)", out.staticRows.length, 3);
  var names = out.staticRows.map(function (s) { return s.name; }).sort().join(",");
  eq("the 3 distinct names kept once each", names, "Campaign Name,Segment Name,Waver Number");
  // A genuinely different value for the same name is NOT collapsed (de-dupe is by name+value+object, not name alone).
  var acc2 = newAccum();
  docActScrapeOver([summaryEl(), { tagName: "runtime_cdp-activation-attribute-datatable", data: [
    { staticAttributeName: "Waver Number", staticAttributeValue: "1", entityName: "IndividualG__dlm" },
    { staticAttributeName: "Waver Number", staticAttributeValue: "2", entityName: "IndividualG__dlm" }
  ] }], acc2);
  eq("same name, different value → both kept (not over-collapsed)", acc2.staticRows.length, 2);
}

console.log("\n6e. EMAIL ADDRESS PATH: pathComboboxOptions[pathIndex].label is the readable path text");
{
  // Real shape from the live-org probe: contactPointEmail carries pathComboboxOptions[] + pathIndex,
  // and the combobox's visible text is pathComboboxOptions[pathIndex].label verbatim.
  var cpEmail = {
    fieldApiName: "EmailAddress__c", contactPointEntityName: "TDI_ContactPointEmail__dlm", label: "Email Address",
    pathIndex: "0",
    pathComboboxOptions: [
      { label: "Contact Point Email.Party > Individual.Individual Id, Individual.Individual Id > Unified Link Individual TDIR.Individual Id, Unified Link Individual TDIR.Unified Individual Id > Unified Individual TDIR.Unified Individual Id", value: "0" },
      { label: "Contact Point Email.Contact Point Email Id > Unified Link Contact Point Email TDIR.Contact Point Email Id, ...", value: "1" }
    ]
  };
  var cp = docActCpExtract(cpEmail);
  eq("path = pathComboboxOptions[pathIndex].label, read directly off the live-confirmed shape",
     cp.path, "Contact Point Email.Party > Individual.Individual Id, Individual.Individual Id > Unified Link Individual TDIR.Individual Id, Unified Link Individual TDIR.Unified Individual Id > Unified Individual TDIR.Unified Individual Id");
  // pathIndex selects a DIFFERENT option when the user picked a non-default path.
  var cp2 = docActCpExtract(Object.assign({}, cpEmail, { pathIndex: "1" }));
  ok("a non-zero pathIndex selects the matching option, not always index 0", /Contact Point Email Id > Unified Link/.test(cp2.path));
  // No pathComboboxOptions at all → falls through to the other known shapes / deep-scan (no crash).
  var cp3 = docActCpExtract({ fieldApiName: "x__c" });
  eq("absent pathComboboxOptions → empty path, no throw", cp3.path, "");
}

console.log("\n6f. FILTER-EXISTS BADGE: 'Edit Filters' vs 'Add Filters' readable per group, panel CLOSED");
{
  // Real innerText shape from the live-org probe (Attributes step, filter panel closed).
  var wizardText = "Add Attributes and Filters to Your Activation\nHelp\nAdd Attributes\nActivation Membership\n" +
    "Unified Individual TDIR\nAdd Filters\nAdd filters to refine the activation membership.\nContact Point\n" +
    "Contact Point Email (1)\nEdit Filters\nMax. # of Attribute Values\n*\n1\nSort By\n*\nContact Point Email Id\n" +
    "*\nAscending\nAttributes\nUnified Individual TDIR (8)\nNavigation Mode\n \nAttribute\n" +
    "Insurance Account (1)\nAdd Filters\nMax. # of Attribute Values\n*\n1\nSort By\n*\nData Source\n*\nDescending\n" +
    "Insurance Policy (3)\nAdd Filters\nMax. # of Attribute Values\n*\n1\nSort By\n*\nData Source\n*\nDescending";
  var badges = docActParseFilterBadges(wizardText);
  ok("Contact Point Email group detected as FILTERED (Edit Filters)", badges["Contact Point Email"] && badges["Contact Point Email"].hasFilter === true);
  eq("Contact Point Email count parsed", badges["Contact Point Email"].count, 1);
  ok("Insurance Account group detected as NOT filtered (Add Filters)", badges["Insurance Account"] && badges["Insurance Account"].hasFilter === false);
  ok("Insurance Policy group detected as NOT filtered (Add Filters)", badges["Insurance Policy"] && badges["Insurance Policy"].hasFilter === false);
  // Unified Individual TDIR (8) is a group WITHOUT an Add/Edit Filters line directly after it in this
  // text (its line is "Navigation Mode" next) → must NOT be misreported as either state.
  ok("a group header with no immediately-following Add/Edit Filters line is simply absent (never guessed)", !badges["Unified Individual TDIR"]);
  // No wizard text at all → empty map, never throws.
  eq("empty text → no badges", Object.keys(docActParseFilterBadges("")).length, 0);
}

console.log("\n6g. APPLIED FILTER CONTENT: parsed from the open filter dialog's plain innerText");
{
  // Real innerText shape from the live-org probe (Attributes step, "Edit Filters" dialog OPEN).
  // REGRESSION (user-reported, live probe v9): the REAL DOM renders a newline between every
  // short text node, not a space. "." in the match patterns does not span newlines by
  // default — a single-line fixture (old test) passed while the real multi-line text failed
  // silently in production. This fixture uses real \n's to catch that class of bug.
  var dialogText = 'Filter "Contact Point Email" Attributes\nCancelSave\nAttributes\nPress Enter to add to canvas\n' +
    'Contact Point Email Id\nTEXT\nPress Enter to add to canvas\nEmail Address\nTEXT\n' +
    'To determine which contact points are chosen for a member, select attributes to filter the contact points.\n' +
    'Path\nUnified Individual TDIR.Unified Individual Id > Unified Link Individual TDIR.Unified Individual Id, ' +
    'Unified Link Individual TDIR.Individual Id > Individual.Individual Id, Individual.Individual Id > Contact Point Email.Party\n' +
    'Attributes (1)\nEmail Address\nContact Point Email:\nEdit Filter\nRemove Filter\nDrag and drop\nEmail Address\nHas Value\nAdd another Attribute here';
  var parsed = docActParseFilterDialog(dialogText);
  ok("dialog parsed (entityLabel found)", !!parsed);
  eq("entity label from the dialog title", parsed.entityLabel, "Contact Point Email");
  eq("join path captured from the dialog's 'Path' line", parsed.path,
     "Unified Individual TDIR.Unified Individual Id > Unified Link Individual TDIR.Unified Individual Id, Unified Link Individual TDIR.Individual Id > Individual.Individual Id, Individual.Individual Id > Contact Point Email.Party");
  eq("exactly one applied condition parsed", parsed.conditions.length, 1);
  eq("condition field", parsed.conditions[0].field, "Email Address");
  eq("condition operator (multi-word phrase 'Has Value' kept whole, not split)", parsed.conditions[0].operator, "Has Value");
  // A dialog with NO applied condition yet (freshly opened "Add Filters") must not fabricate one.
  var emptyDialog = 'Filter "Insurance Account" Attributes\nCancelSave\nAttributes\nPath\nUnified Individual TDIR.Id > Insurance Account.PrimaryInsuredId\n' +
    'Attributes (0)\nDrag and drop\nAdd another Attribute here';
  var parsedEmpty = docActParseFilterDialog(emptyDialog);
  eq("no conditions in an unfiltered dialog → empty conditions array, never a fabricated one", parsedEmpty.conditions.length, 0);
  // Not the filter dialog at all → null, never throws.
  ok("unrelated text → null (no false match)", docActParseFilterDialog("some random page text") === null);
  ok("empty text → null", docActParseFilterDialog("") === null);
}

console.log("\n6h. filterGroups MERGE: badge (closed) + condition text (only if the dialog was opened once) join by label");
{
  var acc = newAccum();
  var wizardEl = { tagName: "runtime_cdp-activation-attribute-wizard",
    innerText: "Contact Point Email (1)\nEdit Filters\nInsurance Account (1)\nAdd Filters" };
  docActScrapeOver([summaryEl(), wizardEl], acc);
  var afterBadgeOnly = docActScrapeOver([summaryEl()], acc);
  var cpe = afterBadgeOnly.filterGroups.filter(function (g) { return g.label === "Contact Point Email"; })[0];
  ok("badge alone (dialog never opened): hasFilter true, but NO condition text yet (honest, not fabricated)",
     cpe && cpe.hasFilter === true && cpe.conditions.length === 0);
  var ia = afterBadgeOnly.filterGroups.filter(function (g) { return g.label === "Insurance Account"; })[0];
  ok("Insurance Account badge: not filtered", ia && ia.hasFilter === false);
  // Now the user opens "Edit Filters" on Contact Point Email once → condition text folds in,
  // and it SURVIVES after the dialog closes (accumulator persists, same pattern as contact points).
  var dialogEl = { tagName: "runtime_cdp-activation-related-attributes-filter-dialog",
    innerText: 'Filter "Contact Point Email" Attributes\nPath\nX.Id > Y.Id\nAttributes (1)\nDrag and drop\nEmail Address\nHas Value\nAdd another Attribute here' };
  docActScrapeOver([summaryEl(), wizardEl, dialogEl], acc);
  var afterOpen = docActScrapeOver([summaryEl(), wizardEl], acc);   // dialog closed again
  var cpe2 = afterOpen.filterGroups.filter(function (g) { return g.label === "Contact Point Email"; })[0];
  ok("condition text persists after the dialog is closed (window-accumulator pattern)",
     cpe2 && cpe2.conditions.length === 1 && cpe2.conditions[0].field === "Email Address" && cpe2.conditions[0].operator === "Has Value");
  eq("captured.filterGroups flips true once any badge is seen", afterBadgeOnly.captured.filterGroups, true);
}

console.log("\n6i. REFRESH TYPE: the activation's own 'Activation Refresh Type' field (not the segment's Publish Schedule)");
{
  // CORRECTION (user-reported, live probe v9, real org): the PRIOR approach read "Publish
  // Schedule:Don't refresh" on the Contact Points step — but that is the SEGMENT's publish
  // schedule, a different field, and gave a WRONG value. The activation's actual Refresh Type
  // is its own record-detail field, rendered label-then-value with no separator at all:
  // "Activation Refresh TypeFull Refresh" on a small leaf (label immediately followed by value).
  var refreshLeaf = { tagName: "div", children: [], textContent: "Activation Refresh TypeFull Refresh" };
  var acc = newAccum();
  var out = docActScrapeOver([summaryEl(), refreshLeaf], acc);
  eq("refresh type read from the activation's own record-detail field", out.overview.refreshType, "Full Refresh");
  // Persists once seen, same as output names / contact points / static values.
  var afterNextStep = docActScrapeOver([summaryEl()], acc);
  eq("refresh type persists after navigating away from the step where it was seen", afterNextStep.overview.refreshType, "Full Refresh");
  // The segment's "Publish Schedule:" text (Contact Points step) must NOT be read as Refresh Type.
  var scheduleLeaf = { tagName: "div", children: [], textContent: "Publish Schedule:Don't refresh" };
  var acc2 = newAccum();
  var out2 = docActScrapeOver([summaryEl(), scheduleLeaf], acc2);
  eq("segment Publish Schedule text is NOT mistaken for the activation's Refresh Type", out2.overview.refreshType, "");
  // A larger wrapper (children.length>2, e.g. the whole record-detail <ul> that also contains
  // this exact label+value as a substring further down its nested structure) must not be
  // mistaken for the small 1-2-child leaf that actually renders the label+value pair.
  var bigWrapper = { tagName: "ul", children: [1, 2, 3, 4, 5, 6], textContent:
    "Activation DataspaceTDIActivation TargetMCE1SegmentGift_Card_Auto__95TData Model ObjectTDI_UnifiedIndividualTdirActivation StatusActiveActivation Refresh TypeFull Refresh" };
  var acc3 = newAccum();
  var out3 = docActScrapeOver([summaryEl(), bigWrapper, refreshLeaf], acc3);
  eq("the small label+value leaf wins; the big multi-child wrapper is never read as the value", out3.overview.refreshType, "Full Refresh");
  var acc4 = newAccum();
  var out4 = docActScrapeOver([summaryEl(), bigWrapper], acc4);
  eq("without the small leaf present, the big wrapper alone yields nothing (never misread)", out4.overview.refreshType, "");
}

console.log("\n7. no summary on the page → found=false, nothing fabricated");
{
  var out = docActScrapeOver([{ tagName: "div" }, { tagName: "runtime_cdp-activation-attribute-datatable", data: [] }], newAccum());
  ok("found=false when no summary element", out.found === false);
  eq("no attributes invented", out.attributes.length, 0);
}

console.log("\n8. CSV is ATTRIBUTES-ONLY now (per user): 5 columns, one row per attribute, no overview/contact/static, no Join Path");
{
  var acc = newAccum();
  docActScrapeOver([summaryEl(), attrDatatableEl()], acc);
  var out = docActScrapeOver([summaryEl(), channelEl()], acc);   // full picture
  var csv = docActCsv(out);
  var rows = csv.split("\r\n");
  eq("header is the 5 attribute columns (Join Path removed)", rows[0], "Label,Field API,Object / DMO API,Output Name,Category");
  ok("CRLF line endings (Excel-friendly)", csv.indexOf("\r\n") !== -1);
  eq("exactly header + one row per attribute (3 attrs → 4 lines)", rows.length, 4);
  ok("no Overview/Contact Point/Static Value rows in the CSV", !/Overview|Contact Point|Static Value/.test(csv));
  ok("field API name present in CSV", csv.indexOf("ssot__EmailAddress__c") !== -1);
  ok("output name present in CSV", /,email,/.test(csv));
  ok("NO Join Path column / arrow in CSV", csv.indexOf("→") === -1);
  // a value containing a comma must still be quoted
  var out2 = { attributes: [{ label: "A, B, C", fieldApi: "X__c", objectApi: "Y__dlm", outputName: "", category: "" }] };
  ok("comma-bearing value is CSV-quoted", docActCsv(out2).indexOf('"A, B, C"') !== -1);
}

console.log("\n9. applied filters read ONLY when present (never fabricated)");
{
  var noFilter = docActScrapeOver([summaryEl()], newAccum());
  eq("no filters in DOM → empty array (section hidden)", noFilter.overview.filters.length, 0);
  var wf = summaryEl();
  wf.relatedDmoFilters = [{ entityName: "IndividualG__dlm", filterExpression: "Tier__c = 'Gold'" }];
  wf.selectedSegment.filters = [{ label: "Active only", text: "IsActive__c = true" }];
  var withFilter = docActScrapeOver([wf], newAccum());
  ok("segment-level filter captured", withFilter.overview.filters.some(function (f) { return /IsActive__c = true/.test(f.text); }));
  ok("activation DMO filter captured + labeled by entity", withFilter.overview.filters.some(function (f) { return f.label === "IndividualG filter" && /Tier__c = 'Gold'/.test(f.text); }));
}

console.log("\n10. waterfall segments captured when present");
{
  var wf = summaryEl(); wf.isSelectedSegmentWaterfall = true; wf.selectedWaterfallSubsegments = ["TDI_Sub_A", "TDI_Sub_B"];
  var out = docActScrapeOver([wf], newAccum());
  ok("isWaterfall true", out.overview.isWaterfall === true);
  eq("subsegments captured", (out.waterfall || []).join(","), "TDI_Sub_A,TDI_Sub_B");
}

// ── Source & strip presence (the feature is wired + lives DEV-ONLY) ──
console.log("\n11. SOURCE wiring: DOM-only exporter defined, launcher row added, DEV-ONLY, and present in the bookmarklet");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("exporter fn defined and exposed on window", /function docActShowModal/.test(src) && /window\.__dcDocActivation\s*=\s*docActShowModal/.test(src));
  ok("reads the summary element by its real tag", /runtime_cdp-activation-summary/.test(src));
  ok("merges datatable output names + path (Attributes step) and channel contact points", /runtime_cdp-activation-attribute-datatable/.test(src) && /runtime_cdp-activation-channel-wizard/.test(src));
  ok("reuses collectRaw + segSafeGet (no new shadow walker, no new prop reader)", /collectRaw\(\)/.test(src) && /segSafeGet\(/.test(src));
  // The [object Object] fix lives in the source: a contact-point extractor with a dump fallback.
  ok("contact-point extractor present (the [object Object] fix)", /function docActCpExtract/.test(src) && /function docActCpDump/.test(src) && /docActCpExtract\(segSafeGet\(channelEl/.test(src));
  ok("filters + refresh type read conditionally (not fabricated)", /function docActReadFilters/.test(src) && /refreshType:/.test(src));
  // NEVER auto-navigates the Save/Publish-capable wizard. Isolate the doc-export code region
  // (from its first fn to where it's exposed on window) and assert it contains no wizard-step
  // navigation — no setCurrentStep/goToStep/nextStep, and its only .click() is the download anchor.
  (function () {
    var m = src.match(/var _docActAccum[\s\S]*?window\.__dcDocActivation\s*=\s*docActShowModal/);
    var region = m ? m[0] : "";
    ok("doc-export region isolated for the no-auto-nav check", region.length > 1000);
    ok("no wizard step navigation (setCurrentStep/goToStep/next-back)", !/setCurrentStep|goToStep|nextStep|\.next\(\)|\.back\(\)|handleNext|handleBack/i.test(region));
    var clicks = region.match(/\.click\(\)/g) || [];
    var anchorClicks = (region.match(/a\.click\(\)/g) || []).length;
    ok("the only .click() is the download anchor (never a wizard control)", clicks.length === anchorClicks);
  })();
  ok("launcher offers a 'Document Activation' row, gated on the exporter fn", /dc-act-doc-row/.test(src) && /typeof window\.__dcDocActivation === "function"/.test(src));
  ok("launcher is rebuild-aware so the dev row appears after the dev block registers the fn", /function ensureActivationLauncher\(rebuild\)/.test(src) && /ensureActivationLauncher\(true\)/.test(src));
  ok("CSV + Excel (MiniXLSX) exports wired", /function docActCsv/.test(src) && /function docActExcel/.test(src) && /SEGX\.MiniXLSX/.test(src));
  ok("Copy-table button REMOVED per feedback", !/Copy table/.test(src));
  ok("CSV header is the attributes-only 5 columns (Join Path removed) in source", /\["Label", "Field API", "Object \/ DMO API", "Output Name", "Category"\]/.test(src));
  ok("honest 'captured vs not yet visited' status in the modal", /not yet visited|captured|Visit the/.test(src) && /captured\.outputNames/.test(src));
  ok("static-values explanatory tooltip present", /fixed constant value sent on every activated record/.test(src));
  // PERSISTENCE: the accumulator must live on window, not in an IIFE-local that the per-step re-run wipes.
  ok("accumulator persisted on window.__dcDocActAccum (survives per-step bookmarklet re-runs)", /window\.__dcDocActAccum/.test(src));
  // STATIC DE-DUPE: because the accumulator persists, static rows must be de-duped on push (or re-runs pile up copies).
  ok("static rows de-duped by content before push (no 'Static Values (12)' = 3×4 duplication)", /acc\.staticRows\.some\(function \(x\) \{ return \(x\.name/.test(src));
  // LAUNCHER GATE: the exporter launcher must register on ANY activation page (wizard OR /view), not wizard-only.
  (function () {
    // The exporter branch must be reachable for detailPageType === "Activation" without an AND on isActivationWizardPage().
    var m = src.match(/detailPageType === "Segment"[\s\S]{0,160}?detailPageType === "Activation"[^\n]*\{/);
    ok("launcher branch entered on any Activation page (no wizard-only AND on the exporter gate)",
       !!m && !/detailPageType === "Activation"\s*&&\s*isActivationWizardPage\(\)\s*\)\s*\{/.test(m[0]));
  })();
  // PATH: deep-scan path extraction is wired (finds the hop array even under an unknown wrapper key).
  ok("contact-point path deep-scan wired (docActLooksLikeHops + bounded scan)", /function docActLooksLikeHops/.test(src) && /function docActHopsText/.test(src));
  // EMAIL PATH / FILTER BADGE / FILTER DIALOG: the three new capture mechanisms are wired in source.
  ok("Email Address Path read via pathComboboxOptions[pathIndex] (live-confirmed shape)", /pathComboboxOptions/.test(src) && /pathIndex/.test(src));
  ok("filter-exists badge parser present and reads the attribute-wizard tag", /function docActParseFilterBadges/.test(src) && /runtime_cdp-activation-attribute-wizard/.test(src));
  ok("applied-filter-dialog parser present and reads the filter-dialog tag (read-only, never auto-opened)", /function docActParseFilterDialog/.test(src) && /runtime_cdp-activation-related-attributes-filter-dialog/.test(src));
  ok("filterGroups merged into scrape output and rendered in the modal", /out\.filterGroups\s*=/.test(src) && /Attribute Filters/.test(src));
  // PASSIVE FILTER CAPTURE: docActScrape() must ALSO run on a background poll while the Edit
  // Filters dialog is on screen, not only at the instant the user clicks "Document Activation"
  // (user-reported bug: by click time the dialog is usually already closed, so the condition
  // text was never seen). Guarded on window so it survives the bookmarklet's per-step re-runs
  // without stacking a new interval each time.
  ok("passive filter-dialog capture poll wired (window-guarded, no stacking)", /__dcDocActFilterPoll/.test(src) && /function docActPassiveScan/.test(src) && /docActScrape\(\)/.test(src.match(/function docActPassiveScan[\s\S]{0,300}/)[0]));
  // CAMPAIGN DATA RENAME: "Static Values" was an invented label — Salesforce's own Attributes
  // step renders this field group as "Campaign Data" / "Campaign Attributes (N)" (confirmed via
  // live DOM probe). The modal/Excel must use SF's real wording, not our own.
  ok("user-facing label renamed to SF's real 'Campaign Data' wording (modal + Excel sheet)", /Campaign Data/.test(src) && !/>Static Values</.test(src) && !/addWorksheet\("Static Values"\)/.test(src));
  // REFRESH TYPE: no getter property exists for it at all; reads the activation's own
  // "Activation Refresh Type" record-detail label+value text (NOT the segment's unrelated
  // "Publish Schedule:" text, which was the prior approach's bug — it read the wrong field).
  ok("refresh type read via the activation's own 'Activation Refresh Type' field text", /function docActReadRefreshType/.test(src) && /Activation Refresh Type/.test(src));

  // DEV-ONLY: the whole feature definition must be stripped from the PUBLIC build.
  const pub = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, "");
  ok("DEV-ONLY: exporter definition stripped from the public bookmarklet", !/function docActShowModal/.test(pub));
  ok("DEV-ONLY: public build never DEFINES __dcDocActivation (only the guarded launcher reference may remain)", !/window\.__dcDocActivation\s*=/.test(pub));
  ok("DEV-ONLY: the 'Document Activation' launcher ROW is inside a strip block (not in public menu)", !/dc-act-doc-row/.test(pub));
  ok("DEV-ONLY: contact-point extractor stripped from public build", !/function docActCpExtract/.test(pub));
  ok("DEV-ONLY: filter badge/dialog parsers stripped from public build", !/function docActParseFilterBadges/.test(pub) && !/function docActParseFilterDialog/.test(pub));

  // present in the FULL (dev) bookmarklet build — this is the artifact the client actually runs.
  ok("present in the FULL bookmarklet (synced from ext)", /function docActShowModal/.test(bm) && /dc-act-doc-row/.test(bm) && /function docActCpExtract/.test(bm));
  ok("filter badge/dialog parsers present in the FULL bookmarklet (synced from ext)", /function docActParseFilterBadges/.test(bm) && /function docActParseFilterDialog/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
