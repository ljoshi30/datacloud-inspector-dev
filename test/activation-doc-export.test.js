// DOM-only "Document Activation" export (dev-only, BOOKMARKLET-safe). Behavior + source/strip. Run in Node:
//   node test/activation-doc-export.test.js
//
// The extension is banned by the client org's policy, so this feature reads the activation
// STRAIGHT FROM THE PAGE (no Connect API, no bridge) and exports it — Salesforce-styled, with
// API names inline — to CSV / Excel. It NEVER navigates the Save/Publish-capable wizard: it
// reads the CURRENT step and ACCUMULATES step-specific extras (output names, contact points,
// static values) as the user naturally visits them, labeling honestly what isn't captured yet.
//
// PROVEN DOM (DOM Probe v56, two captures on different wizard steps of the live org):
//   runtime_cdp-activation-summary  → the WHOLE activation, IDENTICAL on every step:
//     selectedDataSpace{label,value}  selectedSegment{name,segmentOnLabel,segmentOnDeveloperName,
//       count,segmentPublishType,segmentSchedule}  selectedTarget{name,connectionTypeLabel,
//       platformName,businessUnits[]}  includedAttributes[]{uid,label,attributeName=fieldApi,
//       category,entityName=objectApi}
//   runtime_cdp-activation-attribute-datatable .data[] (ONLY on the Attributes step):
//     {uid,name,defaultOutputName|preferredName,entityName,queryPathString}  + static rows
//     {staticAttributeName,staticAttributeValue,entityName}
//   runtime_cdp-activation-channel-wizard (ONLY on the Contact Points step):
//     {selectedPlatform,targetConnectionType,contactPointEmail/Phone/Push/WhatsApp/Address}
// These tests run a faithful MIRROR of the source functions over that real-shaped data —
// they prove BEHAVIOR, not just that strings exist in the file.

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

// scrape over a provided list of "elements" + a persistent accumulator (the source keeps one
// per recordId in _docActAccum; here we pass it in so we can simulate visiting two steps).
function docActScrapeOver(raw, acc) {
  var summaryEl = null, attrTables = [], channelEl = null;
  raw.forEach(function (el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "runtime_cdp-activation-summary") summaryEl = summaryEl || el;
    else if (tag === "runtime_cdp-activation-attribute-datatable") attrTables.push(el);
    else if (tag === "runtime_cdp-activation-channel-wizard") channelEl = channelEl || el;
  });

  var out = {
    found: !!summaryEl, overview: {}, attributes: [], contactPoints: [], staticRows: [], waterfall: null,
    captured: { attributes: false, outputNames: false, contactPoints: false, staticValues: false }
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
      publishType: seg.segmentPublishType || "", schedule: seg.segmentSchedule || "",
      target: tgt.name || "", connectionType: tgt.connectionTypeLabel || tgt.connectionType || "",
      platform: tgt.platformName || segSafeGet(summaryEl, "selectedPlatformName") || "",
      businessUnits: (tgt.businessUnits && tgt.businessUnits.slice ? tgt.businessUnits.slice() : []),
      eventType: segSafeGet(summaryEl, "selectedEventType") || "",
      isWaterfall: !!segSafeGet(summaryEl, "isSelectedSegmentWaterfall")
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
        acc.staticRows.push({ name: d.staticAttributeName || d.name || "", value: (d.staticAttributeValue != null ? String(d.staticAttributeValue) : ""), objectApi: d.entityName || "" });
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
      platform: segSafeGet(channelEl, "selectedPlatform") || "", connectionType: segSafeGet(channelEl, "targetConnectionType") || "",
      email: segSafeGet(channelEl, "contactPointEmail") || "", phone: segSafeGet(channelEl, "contactPointPhone") || "",
      push: segSafeGet(channelEl, "contactPointPush") || "", whatsApp: segSafeGet(channelEl, "contactPointWhatsApp") || "",
      address: segSafeGet(channelEl, "contactPointAddress") || ""
    };
    var hasAny = cp.email || cp.phone || cp.push || cp.whatsApp || cp.address;
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
  return out;
}
function newAccum() { return { outputByUid: {}, staticRows: [], contactPoints: [], pathByUid: {} }; }

function docActCsv(data) {
  function q(v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var lines = [];
  lines.push(["Section", "Label", "Field API", "Object / DMO API", "Output Name", "Category", "Join Path", "Value"].map(q).join(","));
  var ov = data.overview;
  [["Overview", "Data Space", "", ov.dataSpaceApi, "", "", "", ov.dataSpace],
   ["Overview", "Segment", ov.segmentApi, "", "", "", "", ov.segment],
   ["Overview", "Segment Membership (as shown)", "", "", "", "", "", ov.segmentCount],
   ["Overview", "Target", "", "", "", "", "", ov.target],
   ["Overview", "Platform", "", "", "", "", "", ov.platform],
   ["Overview", "Connection Type", "", "", "", "", "", ov.connectionType],
   ["Overview", "Business Units", "", "", "", "", "", (ov.businessUnits || []).join("; ")],
   ["Overview", "Publish Type", "", "", "", "", "", ov.publishType],
   ["Overview", "Schedule", "", "", "", "", "", ov.schedule]
  ].forEach(function (r) { if (r[7] !== "" && r[7] != null && String(r[7]).length) lines.push(r.map(q).join(",")); });
  data.attributes.forEach(function (a) { lines.push(["Attribute", a.label, a.fieldApi, a.objectApi, a.outputName, a.category, a.path, ""].map(q).join(",")); });
  data.contactPoints.forEach(function (cp) {
    [["email", cp.email], ["phone", cp.phone], ["push", cp.push], ["whatsApp", cp.whatsApp], ["address", cp.address]].forEach(function (p) {
      if (p[1]) lines.push(["Contact Point", p[0], "", "", "", "", "", p[1]].map(q).join(","));
    });
  });
  data.staticRows.forEach(function (s) { lines.push(["Static Value", s.name, "", s.objectApi, "", "", "", s.value].map(q).join(",")); });
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
// STEP 3 = the Contact Points step.
function channelEl() {
  return { tagName: "runtime_cdp-activation-channel-wizard", selectedPlatform: "MarketingCloud", targetConnectionType: "Marketing Cloud", contactPointEmail: "ssot__EmailAddress__c", contactPointPhone: "", contactPointPush: "", contactPointWhatsApp: "", contactPointAddress: "" };
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
  // user opens on the summary/review step
  var s1 = docActScrapeOver([summaryEl()], acc);
  ok("step 1: attributes yes, extras no", s1.captured.attributes && !s1.captured.outputNames && !s1.captured.contactPoints && !s1.captured.staticValues);
  // user clicks into the Attributes step → datatable now present (summary still present too)
  var s2 = docActScrapeOver([summaryEl(), attrDatatableEl()], acc);
  eq("step 2: output name merged by uid (u1 → 'email')", s2.attributes[0].outputName, "email");
  eq("step 2: preferredName used when defaultOutputName absent (u2 → 'first_name')", s2.attributes[1].outputName, "first_name");
  eq("step 2: join path merged by uid", s2.attributes[0].path, "IndividualG.Id → ssot__ContactPointEmail.ssot__PartyId__c");
  eq("step 2: static value captured", s2.staticRows.length, 1);
  eq("step 2: static name/value right", s2.staticRows[0].name + "=" + s2.staticRows[0].value, "campaign_id=VIF-2026-Q1");
  ok("step 2 captured flags flip on for output names + static", s2.captured.outputNames && s2.captured.staticValues && !s2.captured.contactPoints);
  // user clicks into the Contact Points step
  var s3 = docActScrapeOver([summaryEl(), channelEl()], acc);
  eq("step 3: one contact point captured", s3.contactPoints.length, 1);
  eq("step 3: email contact point API name", s3.contactPoints[0].email, "ssot__EmailAddress__c");
  ok("step 3: earlier extras STILL present (accumulator persists across steps)", s3.captured.outputNames && s3.captured.staticValues && s3.captured.contactPoints);
  eq("step 3: output name still merged (not lost when datatable left the DOM)", s3.attributes[0].outputName, "email");
}

console.log("\n5. contact points de-dupe (revisiting the step must not pile up copies)");
{
  var acc = newAccum();
  docActScrapeOver([summaryEl(), channelEl()], acc);
  docActScrapeOver([summaryEl(), channelEl()], acc);   // revisit same step, identical content
  var out = docActScrapeOver([summaryEl(), channelEl()], acc);
  eq("still exactly one contact point after 3 visits", out.contactPoints.length, 1);
}

console.log("\n6. no summary on the page → found=false, nothing fabricated");
{
  var out = docActScrapeOver([{ tagName: "div" }, { tagName: "runtime_cdp-activation-attribute-datatable", data: [] }], newAccum());
  ok("found=false when no summary element", out.found === false);
  eq("no attributes invented", out.attributes.length, 0);
}

console.log("\n7. CSV is well-formed: header + overview rows + one row per attribute + contact points + static");
{
  var acc = newAccum();
  docActScrapeOver([summaryEl(), attrDatatableEl()], acc);
  var out = docActScrapeOver([summaryEl(), channelEl()], acc);   // full picture
  var csv = docActCsv(out);
  var rows = csv.split("\r\n");
  eq("header is the 8 documentation columns", rows[0], "Section,Label,Field API,Object / DMO API,Output Name,Category,Join Path,Value");
  ok("CRLF line endings (Excel-friendly)", csv.indexOf("\r\n") !== -1);
  ok("every included attribute appears as an Attribute row", out.attributes.every(function (a) { return csv.indexOf("Attribute," + a.label + ",") !== -1; }));
  ok("field API name present in CSV", csv.indexOf("ssot__EmailAddress__c") !== -1);
  ok("output name present in CSV", /,email,/.test(csv));
  ok("join path (with the → arrow) present in CSV", csv.indexOf("IndividualG.Id → ssot__ContactPointEmail.ssot__PartyId__c") !== -1);
  ok("contact point row present", csv.indexOf("Contact Point,email,") !== -1);
  ok("static value row present", csv.indexOf("Static Value,campaign_id,") !== -1);
  // a value containing a comma must be quoted
  var out2 = docActScrapeOver([{ tagName: "runtime_cdp-activation-summary", selectedDataSpace: {}, selectedSegment: {}, selectedTarget: { name: "A, B, C", businessUnits: [] }, includedAttributes: [] }], newAccum());
  ok("comma-bearing value is CSV-quoted", docActCsv(out2).indexOf('"A, B, C"') !== -1);
}

console.log("\n8. waterfall segments captured when present");
{
  var wf = summaryEl(); wf.isSelectedSegmentWaterfall = true; wf.selectedWaterfallSubsegments = ["TDI_Sub_A", "TDI_Sub_B"];
  var out = docActScrapeOver([wf], newAccum());
  ok("isWaterfall true", out.overview.isWaterfall === true);
  eq("subsegments captured", (out.waterfall || []).join(","), "TDI_Sub_A,TDI_Sub_B");
}

// ── Source & strip presence (the feature is wired + lives DEV-ONLY) ──
console.log("\n9. SOURCE wiring: DOM-only exporter defined, launcher row added, DEV-ONLY, and present in the bookmarklet");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  const bm = fs.readFileSync(path.join(__dirname, "..", "console-decorate.bookmarklet.js"), "utf8");

  ok("exporter fn defined and exposed on window", /function docActShowModal/.test(src) && /window\.__dcDocActivation\s*=\s*docActShowModal/.test(src));
  ok("reads the summary element by its real tag", /runtime_cdp-activation-summary/.test(src));
  ok("merges datatable output names + path (Attributes step) and channel contact points", /runtime_cdp-activation-attribute-datatable/.test(src) && /runtime_cdp-activation-channel-wizard/.test(src));
  ok("reuses collectRaw + segSafeGet (no new shadow walker, no new prop reader)", /collectRaw\(\)/.test(src) && /segSafeGet\(/.test(src));
  // NEVER auto-navigates the Save/Publish-capable wizard. Isolate the doc-export code region
  // (from its first fn to where it's exposed on window) and assert it contains no wizard-step
  // navigation — no setCurrentStep/goToStep/nextStep, and its only .click() is the download
  // anchor (a.click()), never a click on a wizard Next/Back/step control.
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
  ok("CSV + Excel (MiniXLSX) + Copy-table exports wired", /function docActCsv/.test(src) && /function docActExcel/.test(src) && /SEGX\.MiniXLSX/.test(src) && /Copy table/.test(src));
  ok("honest 'captured vs not yet visited' status in the modal", /not yet visited|captured|Visit the/.test(src) && /captured\.outputNames/.test(src));

  // DEV-ONLY: the whole feature definition must be stripped from the PUBLIC build. The launcher's
  // typeof-guarded reference lives in the shared launcher (survives, like seg/formula rows), so the
  // correct dev-only assertion is: the definition is absent from the public build.
  const pub = bm.replace(/\/\* @strip:start[\s\S]*?@strip:end \*\//g, "");
  ok("DEV-ONLY: exporter definition stripped from the public bookmarklet", !/function docActShowModal/.test(pub));
  ok("DEV-ONLY: public build never DEFINES __dcDocActivation (only the guarded launcher reference may remain)", !/window\.__dcDocActivation\s*=/.test(pub));
  ok("DEV-ONLY: the 'Document Activation' launcher ROW is inside a strip block (not in public menu)", !/dc-act-doc-row/.test(pub));

  // present in the FULL (dev) bookmarklet build — this is the artifact the client actually runs.
  ok("present in the FULL bookmarklet (synced from ext)", /function docActShowModal/.test(bm) && /dc-act-doc-row/.test(bm));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
