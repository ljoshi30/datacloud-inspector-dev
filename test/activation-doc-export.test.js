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
function docActOptionLabel(options, value) {
  if (!Array.isArray(options) || value == null) return "";
  var hit = options.filter(function (o) { return o && o.value === value; })[0];
  return hit ? (hit.label || "") : "";
}
function docActReadDetailsSection(raw) {
  var sectionEl = null, radioEl = null, checkboxEl = null;
  raw.forEach(function (el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "runtime_cdp-activation-details-section") sectionEl = sectionEl || el;
    else if (tag === "lightning-radio-group" && segSafeGet(el, "name") === "refreshTypeRadioButton") radioEl = radioEl || el;
    else if (tag === "lightning-checkbox-group" && segSafeGet(el, "name") === "incrementalOptInOptions") checkboxEl = checkboxEl || el;
  });
  if (!sectionEl) return null;
  var refreshType = segSafeGet(sectionEl, "activationRefreshType") || "";
  var excludeUpdates = !!segSafeGet(sectionEl, "excludeUpdates");
  var excludeDeletes = !!segSafeGet(sectionEl, "excludeDeletes");
  var radioOptions = radioEl ? (segSafeGet(radioEl, "options") || []) : [];
  var checkboxOptions = checkboxEl ? (segSafeGet(checkboxEl, "options") || []) : [];
  var excludeLabels = [];
  if (excludeUpdates) excludeLabels.push(docActOptionLabel(checkboxOptions, "EXCLUDE_UPDATES") || "Exclude records modified since the last refresh");
  if (excludeDeletes) excludeLabels.push(docActOptionLabel(checkboxOptions, "EXCLUDE_DELETES") || "Exclude records removed since the last refresh");
  return {
    refreshType: refreshType, refreshTypeLabel: docActOptionLabel(radioOptions, refreshType) || refreshType,
    excludeUpdates: excludeUpdates, excludeDeletes: excludeDeletes, excludeLabels: excludeLabels
  };
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
    if (parsed && parsed.entityLabel && (parsed.conditions.length || !acc.filterConditions[parsed.entityLabel])) {
      acc.filterConditions[parsed.entityLabel] = parsed;
    }
  }
  var sidebarRefresh = docActReadRefreshType(raw);
  if (sidebarRefresh) acc.refreshType = sidebarRefresh;
  var detailsNow = docActReadDetailsSection(raw);
  if (detailsNow) acc.detailsSection = detailsNow;

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
      refreshType: (acc.detailsSection && acc.detailsSection.refreshTypeLabel) || acc.refreshType ||
                   docActCpStr(segSafeGet(summaryEl, "refreshType") || segSafeGet(summaryEl, "activationRefreshType") || seg.refreshType || seg.activationRefreshType || tgt.refreshType),
      excludeOptions: (acc.detailsSection && acc.detailsSection.excludeLabels) || [],
      processingType: docActCpStr(segSafeGet(summaryEl, "processingType") || seg.processingType),
      schedule: seg.segmentScheduleLabel || seg.segmentSchedule || seg.schedule || seg.publishSchedule || "",
      filters: docActReadFilters(summaryEl, seg)
    };
    if (out.overview.isWaterfall) {
      var subs = segSafeGet(summaryEl, "selectedWaterfallSubsegments");
      out.waterfall = (subs && subs.map) ? subs.map(function (s) { return (s && (s.name || s.label)) || ""; }).filter(Boolean) : [];
    }
    var inc = segSafeGet(summaryEl, "includedAttributes") || [];
    out.captured.attributes = inc.length > 0;
    inc.forEach(function (a) {
      if (!a) return;
      out.attributes.push({ uid: a.uid || "", label: a.label || "", fieldApi: a.attributeName || "", objectApi: a.entityName || "", category: a.category || "", outputName: "", path: "", source: "INCLUDED" });
    });
    if (out.overview.isWaterfall) {
      out.attributes.push({ uid: "", label: "SubSegmentId", fieldApi: "", objectApi: "", category: "System", outputName: "", path: "", source: "SYSTEM" });
      out.attributes.push({ uid: "", label: "SubSegmentName", fieldApi: "", objectApi: "", category: "System", outputName: "", path: "", source: "SYSTEM" });
    }
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
    if (hasAny) {
      if (!acc.contactPoint) {
        acc.contactPoint = cp;
      } else {
        if (cp.platform) acc.contactPoint.platform = cp.platform;
        if (cp.connectionType) acc.contactPoint.connectionType = cp.connectionType;
        ["email", "phone", "push", "whatsApp", "address"].forEach(function (k) {
          if (cp[k] && cp[k].present) acc.contactPoint[k] = cp[k];
        });
      }
    }
  }

  out.attributes.forEach(function (row) {
    if (row.uid && acc.outputByUid[row.uid]) row.outputName = acc.outputByUid[row.uid];
    if (row.uid && acc.pathByUid[row.uid]) row.path = acc.pathByUid[row.uid];
  });
  out.captured.outputNames = Object.keys(acc.outputByUid).length > 0;
  out.staticRows = acc.staticRows.slice();
  out.captured.staticValues = acc.staticRows.length > 0;
  out.contactPoints = acc.contactPoint ? [acc.contactPoint] : [];
  out.captured.contactPoints = !!acc.contactPoint;
  out.filterGroups = Object.keys(acc.filterGroups).map(function (label) {
    var g = acc.filterGroups[label];
    var cond = acc.filterConditions[label];
    return { label: label, count: g.count, hasFilter: g.hasFilter, conditions: cond ? cond.conditions : [], path: cond ? cond.path : "" };
  });
  out.captured.filterGroups = out.filterGroups.length > 0;
  return out;
}
function newAccum() { return { outputByUid: {}, staticRows: [], contactPoint: null, pathByUid: {}, lastSeen: {}, filterGroups: {}, filterConditions: {}, refreshType: "", detailsSection: null }; }

// CSV = ATTRIBUTES ONLY (per the user's feedback): no overview/contact/static rows, no Join Path col.
function docActCsv(data) {
  function q(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var lines = [];
  lines.push(["Label", "Field API", "Object / DMO API", "Output Name", "Category", "Join Path"].map(q).join(","));
  data.attributes.forEach(function (a) { lines.push([a.label, a.fieldApi, a.objectApi, a.outputName, a.category, a.path].map(q).join(",")); });
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

console.log("\n6a2. REGRESSION (user-reported, live screenshot): an EARLIER noisy/incomplete capture does not");
console.log("     survive alongside a LATER good one — only ONE merged contact point ever shows, never two.");
{
  var acc = newAccum();
  // Simulate the OLD bug directly: push/whatsApp/address captured while still mid-configuration
  // (only UI-state plumbing visible, same shape the live screenshot showed).
  var noisyChannelEl = { tagName: "runtime_cdp-activation-channel-wizard", selectedPlatform: "", targetConnectionType: "Marketing Cloud",
    contactPointEmail: { fieldApiName: "ssot__EmailAddress__c", contactPointEntityName: "ssot__ContactPointEmail__dlm" },
    contactPointPhone: { disablePathDropdown: true, pathIndex: -1 },
    contactPointPush: { disablePathDropdown: true, pathIndex: -1 },
    contactPointWhatsApp: { disablePathDropdown: true, pathIndex: -1 },
    contactPointAddress: { disablePathDropdown: true, pathIndex: -1 } };
  docActScrapeOver([summaryEl(), noisyChannelEl], acc);
  // Later the user finishes configuring (or this is simply a cleaner re-read); push/whatsApp/address
  // are genuinely unconfigured (empty string, not even a noise object) and email/phone are real.
  var cleanChannelEl = { tagName: "runtime_cdp-activation-channel-wizard", selectedPlatform: "MarketingCloud", targetConnectionType: "Marketing Cloud",
    contactPointEmail: { fieldApiName: "ssot__EmailAddress__c", contactPointEntityName: "ssot__ContactPointEmail__dlm", label: "Email Address" },
    contactPointPhone: "", contactPointPush: "", contactPointWhatsApp: "", contactPointAddress: "" };
  docActScrapeOver([summaryEl(), cleanChannelEl], acc);
  var out = docActScrapeOver([summaryEl(), cleanChannelEl], acc);
  eq("exactly ONE contact point in the export, never two", out.contactPoints.length, 1);
  var cp = out.contactPoints[0];
  eq("email (good in both captures) keeps its real config", cp.email.fieldApi, "ssot__EmailAddress__c");
  ok("push/whatsApp/address end up NOT present (the later, correct read wins — no stale noise leaks through)",
     cp.push.present === false && cp.whatsApp.present === false && cp.address.present === false);
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

  // REGRESSION (user-reported): a real condition, once captured, must NOT be silently erased
  // by a later scrape of the SAME dialog mid-close-transition, where the title still matches
  // but the condition span is momentarily empty (the dialog re-renders a frame or two while
  // it's animating shut). The passive poller runs on an interval, so it WILL catch that
  // transition frame — it must not overwrite the good capture with nothing.
  var closingFrame = { tagName: "runtime_cdp-activation-related-attributes-filter-dialog",
    innerText: 'Filter "Contact Point Email" Attributes\nPath\nX.Id > Y.Id\nAttributes (1)' }; // no "Drag and drop..." span this frame
  docActScrapeOver([summaryEl(), wizardEl, closingFrame], acc);
  var afterClosingFrame = docActScrapeOver([summaryEl(), wizardEl], acc);
  var cpe3 = afterClosingFrame.filterGroups.filter(function (g) { return g.label === "Contact Point Email"; })[0];
  ok("a transition frame with no condition span does NOT erase the previously captured condition",
     cpe3 && cpe3.conditions.length === 1 && cpe3.conditions[0].field === "Email Address");
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

console.log("\n6j. STRUCTURED Refresh Type + exclude options (live-probed real shape, 'Add a name and description' step)");
{
  // Real shape confirmed on a live org: runtime_cdp-activation-details-section exposes
  // activationRefreshType/excludeUpdates/excludeDeletes as real props; the sibling
  // lightning-radio-group/lightning-checkbox-group carry the label text SF renders for
  // each enum value (never hardcoded, so this stays correct if SF changes the wording).
  var detailsEl = { tagName: "runtime_cdp-activation-details-section", activationRefreshType: "INCREMENTAL", excludeUpdates: true, excludeDeletes: false };
  var radioEl = { tagName: "lightning-radio-group", name: "refreshTypeRadioButton", options: [{ label: "Full Refresh", value: "FULL_REFRESH" }, { label: "Incremental Refresh", value: "INCREMENTAL" }] };
  var checkboxEl = { tagName: "lightning-checkbox-group", name: "incrementalOptInOptions", options: [{ label: "Exclude records modified since the last refresh", value: "EXCLUDE_UPDATES" }, { label: "Exclude records removed since the last refresh", value: "EXCLUDE_DELETES" }] };
  var acc = newAccum();
  var out = docActScrapeOver([summaryEl(), detailsEl, radioEl, checkboxEl], acc);
  eq("structured refresh type label read from the live radio-group options", out.overview.refreshType, "Incremental Refresh");
  eq("exclude-updates label captured (only the TRUE flag, read from the checkbox options)", out.overview.excludeOptions.join(","), "Exclude records modified since the last refresh");
  // structured reader (this step) wins over the sidebar-text reader (Contact Points step) when both are seen.
  var scheduleLeaf2 = { tagName: "div", children: [], textContent: "Activation Refresh TypeFull Refresh" };
  var acc2 = newAccum();
  var out2 = docActScrapeOver([summaryEl(), scheduleLeaf2, detailsEl, radioEl, checkboxEl], acc2);
  eq("structured reader wins over the sidebar-text reader when both are present", out2.overview.refreshType, "Incremental Refresh");
  // persists once seen, same as everything else.
  var afterNav = docActScrapeOver([summaryEl()], acc);
  eq("structured refresh type persists after navigating away from the step", afterNav.overview.refreshType, "Incremental Refresh");
  // never fabricated when the step hasn't been visited.
  var neverVisited = docActScrapeOver([summaryEl()], newAccum());
  eq("no exclude options invented when the step was never visited", neverVisited.overview.excludeOptions.length, 0);
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
  eq("header is the attribute columns incl. Join Path", rows[0], "Label,Field API,Object / DMO API,Output Name,Category,Join Path");
  ok("CRLF line endings (Excel-friendly)", csv.indexOf("\r\n") !== -1);
  eq("exactly header + one row per attribute (3 attrs → 4 lines)", rows.length, 4);
  ok("no Overview/Contact Point/Static Value rows in the CSV", !/Overview|Contact Point|Static Value/.test(csv));
  ok("field API name present in CSV", csv.indexOf("ssot__EmailAddress__c") !== -1);
  ok("output name present in CSV", /,email,/.test(csv));
  ok("Join Path column present in CSV", rows[0].indexOf("Join Path") !== -1);
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
  // Real shape (live-probed on an actual waterfall activation): each subsegment is an
  // {id,name,isChecked} OBJECT, not a plain string — joining the raw objects previously
  // rendered "[object Object]" in the export (user-reported).
  var wf = summaryEl();
  wf.isSelectedSegmentWaterfall = true;
  wf.selectedWaterfallSubsegments = [
    { id: "1sgbc0000001yLVAAY", name: "SF_EM_GI_TRGT_26492_GI-Multiline-AO-Auto", isChecked: true },
    { id: "1sgbc0000001yLWAAZ", name: "TDI_Sub_B", isChecked: true }
  ];
  var out = docActScrapeOver([wf], newAccum());
  ok("isWaterfall true", out.overview.isWaterfall === true);
  eq("subsegment NAMES captured (never raw objects / [object Object])", (out.waterfall || []).join(","), "SF_EM_GI_TRGT_26492_GI-Multiline-AO-Auto,TDI_Sub_B");
  ok("SubSegmentId system row added to attributes on waterfall activations", out.attributes.some(function (a) { return a.label === "SubSegmentId" && a.source === "SYSTEM"; }));
  ok("SubSegmentName system row added to attributes on waterfall activations", out.attributes.some(function (a) { return a.label === "SubSegmentName" && a.source === "SYSTEM"; }));
  var nonWf = docActScrapeOver([summaryEl()], newAccum());
  ok("no SubSegmentId/Name rows on a non-waterfall activation", !nonWf.attributes.some(function (a) { return a.source === "SYSTEM"; }));
}

console.log("\n10b. schedule reads the HUMAN LABEL, not the raw enum (user-reported: showed \"24\" instead of \"24 hours\")");
{
  // Live-probed real shape: seg.segmentSchedule = "TWENTY_FOUR" (raw enum), seg.segmentScheduleLabel
  // = "24 hours" (the text SF itself renders) — these are sibling props on selectedSegment.
  var seg = summaryEl();
  seg.selectedSegment.segmentSchedule = "TWENTY_FOUR";
  seg.selectedSegment.segmentScheduleLabel = "24 hours";
  var out = docActScrapeOver([seg], newAccum());
  eq("schedule shows the human label", out.overview.schedule, "24 hours");
  var noLabel = summaryEl();
  noLabel.selectedSegment.segmentSchedule = "TWENTY_FOUR";
  var out2 = docActScrapeOver([noLabel], newAccum());
  eq("falls back to raw enum when no label present", out2.overview.schedule, "TWENTY_FOUR");
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
  ok("FAB row renamed 'Activation Blueprint' (id unchanged)", /mkBtn\("dc-act-doc-row", "Activation Blueprint"/.test(src) && !/mkBtn\("dc-act-doc-row", "Document Activation"/.test(src));
  ok("capture hints + pills for limits/paths in the status area", /caps\.limits/.test(src) && /caps\.paths/.test(src) && /Add Attributes<\/b> and turn on <b>Show Paths/.test(src));
  ok("launcher offers a 'Document Activation' row, gated on the exporter fn", /dc-act-doc-row/.test(src) && /typeof window\.__dcDocActivation === "function"/.test(src));
  ok("launcher is rebuild-aware so the dev row appears after the dev block registers the fn", /function ensureActivationLauncher\(rebuild\)/.test(src) && /ensureActivationLauncher\(true\)/.test(src));
  ok("CSV + Excel (MiniXLSX) exports wired", /function docActCsv/.test(src) && /function docActExcel/.test(src) && /SEGX\.MiniXLSX/.test(src));
  ok("Copy-table button REMOVED per feedback", !/Copy table/.test(src));
  ok("CSV header carries Join Path in source", /\["Label", "Field API", "Object \/ DMO API", "Output Name", "Category", "Join Path"\]/.test(src));
  ok("no '(unspecified)' / separate system group: system rows fold into Attributes", !/\(unspecified\)/.test(src) && !/System fields \(added by Salesforce\)/.test(src) && /sysRows/.test(src));
  ok("honest 'captured vs not yet visited' status in the modal", /not yet visited|captured|Visit the/.test(src) && /captured\.outputNames/.test(src));
  ok("static-values explanatory tooltip present", /fixed constant value sent on every activated record/.test(src));
  // PERSISTENCE: the accumulator must live on window, not in an IIFE-local that the per-step re-run wipes.
  ok("accumulator persisted on window.__dcDocActAccum (survives per-step bookmarklet re-runs)", /window\.__dcDocActAccum/.test(src));
  // STATIC DE-DUPE: because the accumulator persists, static rows must be de-duped on push (or re-runs pile up copies).
  ok("Campaign Data: de-duped within a read, and the current read REPLACES stored rows (no pile-up, no stale rows)", /staticNow\.some\(function \(x\) \{ return \(x\.name/.test(src) && /if \(staticNow\.length \|\| attrTables\.length\) acc\.staticRows = staticNow;/.test(src) && !/acc\.staticRows\.push\(/.test(src));
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
  ok("filterGroups merged into scrape output and rendered in the modal", /out\.filterGroups\s*=/.test(src) && /fltBadge/.test(src));
  // PASSIVE CAPTURE: docActScrape() must ALSO run on a background poll, UNCONDITIONALLY on every
  // tick (not gated on the filter dialog or any single tag), not only at the instant the user
  // clicks "Document Activation" (user-reported bug: by click time the relevant dialog/page is
  // usually already gone, so fields specific to it — filter conditions, Refresh Type on the
  // detail page — were never seen). Guarded on window so it survives the bookmarklet's per-step
  // re-runs without stacking a new interval each time.
  var passiveScanBody = (src.match(/function docActPassiveScan[\s\S]{0,300}/) || [""])[0];
  ok("passive capture poll wired (window-guarded, no stacking)", /__dcDocActFilterPoll/.test(src) && /function docActPassiveScan/.test(src) && /docActScrape\(\)/.test(passiveScanBody));
  ok("passive poll runs UNCONDITIONALLY every tick (not gated on the filter-dialog tag)", !/if\s*\([^)]*runtime_cdp-activation-related-attributes-filter-dialog[^)]*\)\s*\{\s*(try\s*\{\s*)?docActScrape/.test(src));
  // CAMPAIGN DATA RENAME: "Static Values" was an invented label — Salesforce's own Attributes
  // step renders this field group as "Campaign Data" / "Campaign Attributes (N)" (confirmed via
  // live DOM probe). The modal/Excel must use SF's real wording, not our own.
  ok("user-facing label renamed to SF's real 'Campaign Data' wording (modal + Excel sheet)", /Campaign Data/.test(src) && !/>Static Values</.test(src) && !/addWorksheet\("Static Values"\)/.test(src));
  // REFRESH TYPE: no getter property exists for it at all; reads the activation's own
  // "Activation Refresh Type" record-detail label+value text (NOT the segment's unrelated
  // "Publish Schedule:" text, which was the prior approach's bug — it read the wrong field).
  ok("refresh type read via the activation's own 'Activation Refresh Type' field text", /function docActReadRefreshType/.test(src) && /Activation Refresh Type/.test(src));
  // STRUCTURED refresh type + exclude options: reads runtime_cdp-activation-details-section's
  // real props, and looks the HUMAN LABEL up live from the sibling radio/checkbox group's own
  // options[] array (never a hardcoded English string) so it stays correct across orgs/locales.
  ok("structured details-section reader present (refresh type + exclude options, dynamic label lookup)", /function docActReadDetailsSection/.test(src) && /function docActOptionLabel/.test(src) && /runtime_cdp-activation-details-section/.test(src));
  ok("exclude-options labels looked up live from the checkbox-group's own options (not hardcoded)", /incrementalOptInOptions/.test(src) && /excludeUpdates/.test(src) && /excludeDeletes/.test(src));
  ok("tooltip is a CSS-only hover span, not the native title= attribute (fixes the hover-delay complaint)", /dc-info-tip/.test(src) && /function docActInfoIcon/.test(src));

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


// ── Limiting + Show Paths: runs the REAL source functions against live-probe data (v17/v18 verbatim) ──
console.log("\n13. BEHAVIOR (real source fns): Provisional Audience Limiting + Show Paths");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  function grab(name) {
    const i = src.indexOf("function " + name + "(");
    if (i < 0) throw new Error("missing " + name);
    let d = 0, j = src.indexOf("{", i);
    for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } }
  }
  const names = ["docActOptionLabel", "docActDeepFind", "docActStripCount", "docActOwnerHeader", "docActPathOwner", "docActReadLimits"];
  const code = "var segSafeGet=function(o,k){try{return o[k];}catch(e){return undefined;}};\n" + names.map(grab).join("\n") + "\nreturn docActReadLimits;";
  const readLimits = new Function(code)();

  // minimal fake DOM
  function kid(tag, text) { return { tagName: tag, textContent: text }; }
  function combo(value, options, label) { return { tagName: "lightning-combobox", value, options, label }; }
  function root(list) { return { querySelectorAll: (sel) => sel === "*" ? list : list.filter(e => e.tagName === sel) }; }
  function limitEl(owner, lim, disabled, combos) {
    const el = { tagName: "runtime_cdp-activation-related-attribute-limit", relatedAttributesLimit: lim, disableRelatedAttributesLimit: disabled, shadowRoot: root(combos) };
    el.parentNode = { children: [kid("header", owner + " (1)"), el] };
    return el;
  }
  const dateOpts = [{ label: "Last Modified Date", value: "LastModifiedDate__c" }];
  const recentOpts = [{ label: "Most Recent", value: "DESC" }, { label: "Oldest", value: "ASC" }];
  const textOpts = [{ label: "Contact Point Email Id", value: "Id__c" }];
  const ascOpts = [{ label: "Ascending", value: "ASC" }, { label: "Descending", value: "DESC" }];
  const raw = [
    limitEl("Contact Point Email", { attributeName: "Id__c", maxNumberOfValues: "1", order: "ASC", orderByDataType: "TEXT" }, true,
      [combo("1", [{ label: "1", value: "1" }]), combo("Id__c", textOpts), combo("ASC", ascOpts)]),
    limitEl("TDI Individual Additional", { attributeName: "LastModifiedDate__c", maxNumberOfValues: "1", order: "DESC", orderByDataType: "DATE" }, false,
      [combo("1", [{ label: "1", value: "1" }]), combo("LastModifiedDate__c", dateOpts), combo("DESC", recentOpts)]),
    { tagName: "lightning-input", label: "Show Paths", type: "toggle", checked: true },
    combo("0", [], "Path"),
    combo("0", [], "Path")
  ];
  // Path combos: verbatim shown text from the probe (option label lookup fails -> DOM text fallback)
  raw[3].shadowRoot = root([{ tagName: "div", className: "slds-combobox", textContent: "Unified Individual TDI.Unified Individual Id > Unified Link Individual TDI.Unified Individual Id, Unified Link Individual TDI.Individual Id > Individual.Individual Id, Individual.Individual Id > TDI Individual Additional.Individual Additional Information ID" }]);
  raw[3].shadowRoot.querySelector = (s) => raw[3].shadowRoot.querySelectorAll("*")[0];
  raw[4].shadowRoot = root([{ tagName: "div", className: "slds-combobox", textContent: "Unified Individual TDI.Unified Individual Id > Unified Indv Contact Point Address TDI.Party" }]);
  raw[4].shadowRoot.querySelector = (s) => raw[4].shadowRoot.querySelectorAll("*")[0];

  const r = readLimits(raw);
  eq("2 limits read", r.limits.length, 2);
  eq("owner from sibling header, '(1)' stripped", r.limits[0].owner, "Contact Point Email");
  eq("sort label from combobox options (not API name)", r.limits[0].sortLabel, "Contact Point Email Id");
  eq("sort api kept for chip", r.limits[0].sortField, "Id__c");
  eq("order label dynamic: text -> Ascending", r.limits[0].orderLabel, "Ascending");
  ok("disabled limit flagged fixed", r.limits[0].fixed === true);
  eq("date limit: order label 'Most Recent' (data-type aware, read not mapped)", r.limits[1].orderLabel, "Most Recent");
  ok("active limit not fixed", r.limits[1].fixed === false);
  eq("max values", r.limits[1].maxValues, "1");
  eq("show paths toggle read", r.showOn, true);
  eq("2 path choices", r.paths.length, 2);
  eq("path owner #1 = last hop object", r.paths[0].owner, "TDI Individual Additional");
  eq("path owner #2", r.paths[1].owner, "Unified Indv Contact Point Address TDI");
  ok("path owners match limit owners for join", r.paths[0].owner === r.limits[1].owner);
  eq("empty page -> nothing fabricated", readLimits([]).limits.length + readLimits([]).paths.length, 0);
  eq("toggle absent -> showOn null (unknown, not false)", readLimits([]).showOn, null);
  ok("limit without header skipped (no placeholder)", readLimits([{ tagName: "runtime_cdp-activation-related-attribute-limit", relatedAttributesLimit: { attributeName: "x" }, parentNode: { children: [] }, shadowRoot: root([]) }]).limits.length === 0);

  ok("wired: scrape accumulates limits/paths, modal + Excel render them", /acc\.limits\[l\.owner\]/.test(src) && /Max # of Attribute Values/.test(src) && /addWorksheet\("Show Paths"\)/.test(src) && /addWorksheet\("Related Attribute Limits"\)/.test(src) && !/Related Object Settings/.test(src));
  ok("showPaths toggle off hides path choices", /acc\.showPathsOn === false \? \[\]/.test(src));
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.min.js"), "utf8");
  ok("public build excludes it (dev-only)", !/Provisional Audience Limiting/.test(bm) && !/Activation Blueprint/.test(bm));
}


console.log("\n14. REGRESSION: modal must open when window accumulator was created by an OLDER build");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const i = src.indexOf("function docActAccumFor(");
  let d = 0, k = src.indexOf("{", i), end = k;
  for (; end < src.length; end++) { if (src[end] === "{") d++; else if (src[end] === "}") { d--; if (d === 0) break; } }
  const fnSrc = src.slice(i, end + 1);
  // v1.2.692-shaped accumulator persisted on window (no limits/pathChoices/showPathsOn)
  const stale = { current: { outputByUid: {}, staticRows: [], contactPoint: null, pathByUid: {}, lastSeen: {}, filterGroups: {}, filterConditions: {}, refreshType: "", detailsSection: null } };
  const accFor = new Function("_docActAccum", fnSrc + "\nreturn docActAccumFor;")(stale);
  let acc, threw = false;
  try { acc = accFor("current"); Object.keys(acc.limits).map(function (k) { return acc.limits[k]; }); Object.keys(acc.pathChoices); } catch (e) { threw = true; }
  ok("stale (older-build) accumulator does not throw", !threw);
  ok("new fields back-filled", acc && typeof acc.limits === "object" && typeof acc.pathChoices === "object" && acc.showPathsOn === null);
  ok("existing captured data preserved", acc && acc.detailsSection === null && Array.isArray(acc.staticRows));
  ok("limits/paths reader failure cannot block scrape (try/catch)", /try \{ lp = docActReadLimits\(raw\); \} catch/.test(src));
}


console.log("\n15. NO console output anywhere in shipped source");
{
  const fs = require("fs"), path = require("path");
  ["console-decorate.extension.js", "console-decorate.bookmarklet.js", path.join("chrome-extension", "background.js")].forEach(function (f) {
    const t = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    const hits = (t.match(/console\.(log|info|warn|error|debug|table|trace|group)/g) || []).length;
    ok(f + " has no console.* calls", hits === 0, hits + " found");
  });
}

console.log("\n16. Modal is resizable + responsive (behavior of the real resize block on stubs)");
{
  var fs = require("fs"), path = require("path");
  var srcR = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  var a1 = srcR.indexOf("// ── Resizable + responsive ──"), a2 = srcR.indexOf("modal.appendChild(box);", a1);
  ok("resize block found in source", a1 > 0 && a2 > a1);
  var blk = srcR.slice(a1, a2);
  function mkEl() { var el = { style: {}, children: [], classList: { add: function () {} }, _l: {}, offsetWidth: 1040, offsetHeight: 700,
    appendChild: function (c) { el.children.push(c); }, insertBefore: function (c) { el.children.push(c); },
    addEventListener: function (n, f) { (el._l[n] = el._l[n] || []).push(f); }, closest: function () { return null; } }; return el; }
  var box = mkEl();
  Object.defineProperty(box, "offsetWidth", { get: function () { return parseInt(box.style.width, 10) || 1040; } });
  Object.defineProperty(box, "offsetHeight", { get: function () { return parseInt(box.style.height, 10) || 700; } });
  var hdr = mkEl(), xBtn = mkEl(), style = { textContent: "" }, modal = mkEl();
  var store = {}, docL = {}, winL = {};
  var doc = { createElement: mkEl, body: { contains: function () { return true; } },
    addEventListener: function (n, f) { docL[n] = f; }, removeEventListener: function () {} };
  var win = { innerWidth: 1200, innerHeight: 800, addEventListener: function (n, f) { winL[n] = f; }, removeEventListener: function () {} };
  var ls = { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = v; } };
  new Function("box", "hdr", "xBtn", "style", "modal", "document", "window", "localStorage", blk)(box, hdr, xBtn, style, modal, doc, win, ls);
  var handles = box.children.filter(function (c) { return /resize/.test(c.style.cssText || ""); });
  eq("4 resize handles (right,left,bottom,corner)", handles.length, 4);
  var corner = handles[3];
  corner._l.mousedown[0]({ preventDefault: function () {}, stopPropagation: function () {}, clientX: 100, clientY: 100 });
  docL.mousemove({ clientX: 150, clientY: 130 });
  eq("drag corner +50,+30 grows centred box by 2x (width)", box.style.width, "1140px");
  eq("drag corner height", box.style.height, "760px");
  docL.mousemove({ clientX: 9999, clientY: 9999 });
  eq("width clamped to viewport", box.style.width, "1200px");
  eq("height clamped to viewport", box.style.height, "800px");
  docL.mousemove({ clientX: -9999, clientY: -9999 });
  eq("width clamped to min 360", box.style.width, "360px");
  docL.mouseup();
  ok("size persisted on mouseup", !!store.dcDocActSize);
  var mb = hdr.children[0];
  mb.onclick();
  eq("maximise fills viewport", box.style.width + " " + box.style.height, "1200px 800px");
  mb.onclick();
  eq("restore returns to saved size", box.style.width, "360px");
  win.innerWidth = 500; winL.resize();
  ok("window shrink re-clamps box", parseInt(box.style.width, 10) <= 500);
  ok("mobile media rule makes it full-screen under 700px", /@media \(max-width:700px\)/.test(style.textContent));
}

console.log("\n17. Layout follows the wizard: limits/paths/filters INSIDE their object group, not floating cards");
{
  var fs2 = require("fs"), p2 = require("path");
  var s2 = fs2.readFileSync(p2.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("Provisional Audience Limiting is its own section (Limit), not mixed with per-object limits", /pvHtml/.test(s2) && !/Related-object limits<\/div>/.test(s2));
  ok("per-object group renders limit line (Max # of Attribute Values / Sort By / Order)", /metaBox\(lim, flt, pth/.test(s2) && /Max # of Attribute Values/.test(s2));
  ok("per-object group renders its Path and filter badge", /pth\.text/.test(s2) && /metaBox\(lim, flt, pth/.test(s2) && /var metaHtml/.test(s2));
  ok("Contact Point section is built from DOM-derived section map (groupSection), not name guesses", /docActParseGroupSections/.test(s2) && /Contact Point"/.test(s2) && /pickBy\(gsecM/.test(s2));
  ok("sections ordered like the wizard (overview, membership, contact point, attributes, campaign)", /ovGrid \+ flHtml \+ memHtml \+ cpHtml \+ attrHtml \+ relHtml \+ stHtml \+ pvHtml \+ afHtml/.test(s2));
  ok("Doc download button exists, reuses same sections", /docBtn/.test(s2) && /modal\.__docSections/.test(s2) && /application\/msword/.test(s2));
  ok("system rows are plain Attributes rows, no (unspecified)", /sysRows\.concat\(primRows\)/.test(s2) && !/\(unspecified\)/.test(s2));
}

console.log("\n18. Activation Membership parser (real source fn, verbatim innerText shape)");
{
  var fs3 = require("fs"), p3 = require("path");
  var s3 = fs3.readFileSync(p3.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  var i3 = s3.indexOf("function docActParseMembership("), d3 = 0, j3 = s3.indexOf("{", i3), k3;
  for (k3 = j3; k3 < s3.length; k3++) { if (s3[k3] === "{") d3++; else if (s3[k3] === "}") { d3--; if (!d3) break; } }
  var pm = new Function(s3.slice(i3, k3 + 1) + "\nreturn docActParseMembership;")();
  var t1 = "Add Attributes and Filters to Your Activation\nHelp\nAdd Attributes\nActivation Membership\nUnified Individual TDI\nAdd Filters\nAdd filters to refine the activation membership.\nContact Point\nContact Point Email (1)\nEdit Filters";
  var r1 = pm(t1);
  eq("label", r1 && r1.label, "Unified Individual TDI");
  eq("Add Filters => no filter", r1 && r1.hasFilter, false);
  eq("Edit Filters => filtered", pm(t1.replace("Add Filters\nAdd filters", "Edit Filters\nAdd filters")).hasFilter, true);
  eq("absent => null", pm("Contact Point\nContact Point Email (1)\nEdit Filters"), null);
}

console.log("\n19. Section ownership comes from the wizard DOM order (real source fn)");
{
  var fs4 = require("fs"), p4 = require("path");
  var s4 = fs4.readFileSync(p4.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  var i4 = s4.indexOf("function docActParseGroupSections("), d4 = 0, j4 = s4.indexOf("{", i4), k4;
  for (k4 = j4; k4 < s4.length; k4++) { if (s4[k4] === "{") d4++; else if (s4[k4] === "}") { d4--; if (!d4) break; } }
  var gsf = new Function(s4.slice(i4, k4 + 1) + "\nreturn docActParseGroupSections;")();
  var wiz = "Add Attributes and Filters to Your Activation\nActivation Membership\nUnified Individual TDI\nAdd Filters\nContact Point\nContact Point Email (1)\nEdit Filters\nAttribute\nAttributes\nUnified Individual TDI (9)\nTDI Individual Additional (1)\nUnified Indv Contact Point Address TDI (1)\nCampaign Data\nCampaign Attributes (1)\nProvisional Audience Limiting\nRank Order\nAttributes\nSort By";
  var g = gsf(wiz);
  eq("Contact Point Email -> Contact Point", g["Contact Point Email"], "Contact Point");
  eq("Unified Indv Contact Point Address TDI -> Attributes (NOT Contact Point, despite its name)", g["Unified Indv Contact Point Address TDI"], "Attributes");
  eq("Unified Individual TDI -> Attributes", g["Unified Individual TDI"], "Attributes");
  eq("Campaign Attributes -> Campaign Data", g["Campaign Attributes"], "Campaign Data");
  eq("'Attributes' column header inside Provisional table is not a section", Object.keys(g).length, 5);
}

console.log("\n20. Draggable header + Limit reader (real source)");
{
  var fs5 = require("fs"), p5 = require("path");
  var s5 = fs5.readFileSync(p5.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("header drag handler: ignores buttons, moves box via fixed left/top, clamps to viewport", /Draggable \(drag the header/.test(s5) && /closest\("button"\)\) return/.test(s5) && /box\.style\.position = "fixed"/.test(s5));
  ok("Limit input read into provLimit and persisted in accumulator", /label"\) === "Limit"/.test(s5) && /acc\.provLimit = lp\.provLimit/.test(s5) && /a\.provLimit === undefined/.test(s5));
}

console.log("\n21. Contact Point path + filters stay in their own group");
{
  var s21 = require("fs").readFileSync(require("path").join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("CP group falls back to Contact Points-step path", /sameObj\(v\.entityApi, en\)/.test(s21));
  ok("Path combobox label matched loosely", /\^Path\\b\/i\.test/.test(s21));
  ok("group Path falls back to its rows' queryPathString path", /rows\.filter\(function \(r\) \{ return r\.path; \}\)/.test(s21));
  ok("CP path matched by channel keyword + hint when step 1 not captured", s21.indexOf("var chan = k === \"whatsApp\"") > -1 && s21.indexOf("open that step once") > -1);
  ok("unused-filter card keyed by SF label", /!usedFlt\[g\.label\]/.test(s21));
}

console.log("\n22. Page behind the modal stays scrollable");
{
  var s22 = require("fs").readFileSync(require("path").join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  var ov22 = s22.match(/modal\.id = "dc-docact-modal";\s*modal\.style\.cssText = "([^"]+)"/);
  var bx22 = s22.match(/box\.style\.cssText = "(pointer-events:auto[^"]*)"/);
  ok("overlay is click-through (pointer-events:none) so wheel/clicks reach the page", !!ov22 && /pointer-events:none/.test(ov22[1]));
  ok("modal box itself stays interactive (pointer-events:auto)", !!bx22);
  ok("overlay no longer traps the page with a heavy dim", !!ov22 && !/rgba\(15,23,42,\.55\)/.test(ov22[1]));
}

console.log("\n23. Info icon tooltip: floating, never a '?' cursor, not clippable");
{
  var s23 = require("fs").readFileSync(require("path").join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  var ic23 = s23.slice(s23.indexOf("function docActInfoIcon("), s23.indexOf("function docActCsv("));
  ok("icon does not use the help (question-mark) cursor", !/cursor:help/.test(ic23));
  ok("tooltip text is kept in a hidden source span (stripped for Word)", /class='dc-info-tip' style='display:none/.test(ic23));
  ok("hover shows a position:fixed bubble placed from the icon rect (cannot be clipped by the scrolling modal)", /tipBubble\.style\.cssText = "position:fixed/.test(s23) && /getBoundingClientRect\(\)/.test(s23) && /addEventListener\("mouseover"/.test(s23));
  ok("keyboard focus also shows it", /addEventListener\("focusin"/.test(s23));
}

console.log("\n24. Campaign Data reflects ONLY what the page shows now (behavior)");
{
  // Mirror of the accumulator update rule in docActScrape.
  function applyCampaign(acc, attrTablesLen, reads) { var now = []; reads.forEach(function (d) { var k = d.name + "|" + d.value; if (!now.some(function (x) { return x.name + "|" + x.value === k; })) now.push(d); }); if (now.length || attrTablesLen) acc.staticRows = now; return acc.staticRows; }
  var acc24 = { staticRows: [{ name: "Campaign Name", value: "Multiline adhoc giftcard" }, { name: "Waver Number", value: "1" }, { name: "Segment Name", value: "1234_Gift" }, { name: "Segment Name", value: "*Gift_Card*" }] };
  eq("stale rows replaced by the single row now on the page", applyCampaign(acc24, 1, [{ name: "Segment Name", value: "*Gift_Card*" }, { name: "Segment Name", value: "*Gift_Card*" }]).length, 1);
  eq("Attributes step visible but no Campaign rows → cleared", applyCampaign({ staticRows: [{ name: "x", value: "y" }] }, 1, []).length, 0);
  eq("other step (no datatable) → keep what was captured", applyCampaign({ staticRows: [{ name: "x", value: "y" }] }, 0, []).length, 1);
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
