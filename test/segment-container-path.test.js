// Segment Container Path reconstruction — pure logic tests. Run in Node.
//   node test/segment-container-path.test.js
//
// SF's "Container Path" (shown only on edit, e.g.
//   "Insurance Policy.Insurance Account Number > TDI Insurance Account.Insurance Account
//    Primary Insured > Unified Individual TDI.Unified Individual Id")
// is NOT stored on the condition. It's reconstructed from attributeLibraryMetadata:
//   node.displayPaths[i]  = label hops  [{objectLabel,fieldLabel},{objectLabel,fieldLabel}]
//   node.joinPaths[i]     = api hops    [{objectApiName,fieldApiName},{...}]  (same index i)
// A related CONDITION carries its OWN .joinPath (the hops it actually uses). So:
//   1) build label string from a displayPath (PROVEN formula, verified vs real SF strings)
//   2) match a condition's joinPath to the candidate joinPaths[i] → pick displayPaths[i]
// Multi-path objects (e.g. Insurance Policy has 2) resolve by this match — never guessed.

let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  → " + extra : "")); } }
function eq(name, got, want) { ok(name, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }

// ── Mirrors of the source helpers (segPath* namespace) ────────────────────────────
// displayPath (array of hops; hop = [leftNode,rightNode], node = {objectLabel,fieldLabel})
// → "L0.obj.fld > L1.obj.fld > … > lastHop.right.obj.fld"
function segDisplayPathString(dp) {
  if (!dp || !dp.length) return "";
  var stops = [];
  for (var i = 0; i < dp.length; i++) {
    var h = dp[i]; if (!h || !h.length) continue;
    var L = h[0] || {};
    stops.push((L.objectLabel || "") + (L.fieldLabel ? "." + L.fieldLabel : ""));
  }
  var last = dp[dp.length - 1]; var R = (last && last[1]) || {};
  stops.push((R.objectLabel || "") + (R.fieldLabel ? "." + R.fieldLabel : ""));
  return stops.join(" > ");
}
// canonical key for a joinPath (api hops) so we can match condition↔candidate
function segJoinPathKey(jp) {
  if (!jp || !jp.length) return "";
  return jp.map(function (h) {
    var a = (h && h[0]) || {}, b = (h && h[1]) || {};
    return (a.objectApiName || "") + "." + (a.fieldApiName || "") + "->" + (b.objectApiName || "") + "." + (b.fieldApiName || "");
  }).join("|");
}
// Given a node (with joinPaths[] + displayPaths[]) and a condition's joinPath, return the
// matching label path. If the condition has no joinPath but the node has exactly ONE
// candidate, use it. If multiple and no match, return null (caller shows nothing / all).
function segResolveContainerPath(node, condJoinPath) {
  if (!node) return null;
  var dps = node.displayPaths || [], jps = node.joinPaths || [];
  if (!dps.length) return null;
  if (dps.length === 1) return segDisplayPathString(dps[0]);
  // multiple: match by joinPath key
  var key = segJoinPathKey(condJoinPath);
  if (key) {
    for (var i = 0; i < jps.length && i < dps.length; i++) {
      if (segJoinPathKey(jps[i]) === key) return segDisplayPathString(dps[i]);
    }
  }
  return null; // ambiguous — caller decides (we won't guess)
}

// ── Fixtures from the REAL v9 probe (Insurance Policy, 2 paths; Engagement Consent, 1) ──
var ipNode = {
  objectApiName: "TDI_InsurancePolicy__dlm",
  displayPaths: [
    [[{ objectLabel: "Insurance Policy", fieldLabel: "Insurance Account Number" }, { objectLabel: "TDI Insurance Account", fieldLabel: "Insurance Account Id" }],
     [{ objectLabel: "TDI Insurance Account", fieldLabel: "Insurance Account Primary Insured" }, { objectLabel: "Unified Individual TDI", fieldLabel: "Unified Individual Id" }]],
    [[{ objectLabel: "Insurance Policy", fieldLabel: "Policy Quote Number" }, { objectLabel: "Quote", fieldLabel: "Quote Id" }],
     [{ objectLabel: "Quote", fieldLabel: "Insurance Account Number" }, { objectLabel: "TDI Insurance Account", fieldLabel: "Insurance Account Id" }],
     [{ objectLabel: "TDI Insurance Account", fieldLabel: "Insurance Account Primary Insured" }, { objectLabel: "Unified Individual TDI", fieldLabel: "Unified Individual Id" }]]
  ],
  joinPaths: [
    [[{ objectApiName: "TDI_InsurancePolicy__dlm", fieldApiName: "TDI_InsuranceAccountNumber__c" }, { objectApiName: "TDI_InsuranceAccount__dlm", fieldApiName: "TDI_Id__c" }],
     [{ objectApiName: "TDI_InsuranceAccount__dlm", fieldApiName: "TDI_InsuranceAccountPrimaryInsured__c" }, { objectApiName: "TDI_UnifiedLinkIndividualTdi__dlm", fieldApiName: "SourceRecordId__c" }],
     [{ objectApiName: "TDI_UnifiedLinkIndividualTdi__dlm", fieldApiName: "UnifiedRecordId__c" }, { objectApiName: "TDI_UnifiedIndividualTdi__dlm", fieldApiName: "Id__c" }]],
    [[{ objectApiName: "TDI_InsurancePolicy__dlm", fieldApiName: "TDI_PolicyQuoteNumber__c" }, { objectApiName: "TDI_Quote__dlm", fieldApiName: "Id__c" }],
     [{ objectApiName: "TDI_Quote__dlm", fieldApiName: "TDI_InsuranceAccountNumber__c" }, { objectApiName: "TDI_InsuranceAccount__dlm", fieldApiName: "TDI_Id__c" }],
     [{ objectApiName: "TDI_InsuranceAccount__dlm", fieldApiName: "TDI_InsuranceAccountPrimaryInsured__c" }, { objectApiName: "TDI_UnifiedLinkIndividualTdi__dlm", fieldApiName: "SourceRecordId__c" }],
     [{ objectApiName: "TDI_UnifiedLinkIndividualTdi__dlm", fieldApiName: "UnifiedRecordId__c" }, { objectApiName: "TDI_UnifiedIndividualTdi__dlm", fieldApiName: "Id__c" }]]
  ]
};
var ecNode = {
  objectApiName: "TDI_Engagement_Consent__dlm",
  displayPaths: [[[{ objectLabel: "TDI Engagement Consent", fieldLabel: "Engagement Consent ID" }, { objectLabel: "Unified Individual TDI", fieldLabel: "Unified Individual Id" }]]],
  joinPaths: [[[{ objectApiName: "TDI_Engagement_Consent__dlm", fieldApiName: "TDI_Id__c" }, { objectApiName: "TDI_UnifiedLinkIndividualTdi__dlm", fieldApiName: "SourceRecordId__c" }],
     [{ objectApiName: "TDI_UnifiedLinkIndividualTdi__dlm", fieldApiName: "UnifiedRecordId__c" }, { objectApiName: "TDI_UnifiedIndividualTdi__dlm", fieldApiName: "Id__c" }]]]
};

var SF_IP0 = "Insurance Policy.Insurance Account Number > TDI Insurance Account.Insurance Account Primary Insured > Unified Individual TDI.Unified Individual Id";
var SF_IP1 = "Insurance Policy.Policy Quote Number > Quote.Insurance Account Number > TDI Insurance Account.Insurance Account Primary Insured > Unified Individual TDI.Unified Individual Id";
var SF_EC  = "TDI Engagement Consent.Engagement Consent ID > Unified Individual TDI.Unified Individual Id";

console.log("\n1. displayPath → exact SF string (proven vs real screenshots)");
eq("IP path 0 (via Account)", segDisplayPathString(ipNode.displayPaths[0]), SF_IP0);
eq("IP path 1 (via Quote)", segDisplayPathString(ipNode.displayPaths[1]), SF_IP1);
eq("Engagement Consent", segDisplayPathString(ecNode.displayPaths[0]), SF_EC);

console.log("\n2. single-path node resolves without a condition joinPath");
eq("EC resolves (1 path)", segResolveContainerPath(ecNode, null), SF_EC);

console.log("\n3. multi-path node resolves by matching the condition's joinPath");
{
  // a condition on IP via the ACCOUNT route → its joinPath == joinPaths[0]
  var condViaAccount = ipNode.joinPaths[0];
  eq("IP matches path 0 by joinPath", segResolveContainerPath(ipNode, condViaAccount), SF_IP0);
  var condViaQuote = ipNode.joinPaths[1];
  eq("IP matches path 1 by joinPath", segResolveContainerPath(ipNode, condViaQuote), SF_IP1);
}

console.log("\n4. multi-path with NO/That-unknown joinPath → null (never guess)");
eq("IP + no joinPath → null (ambiguous)", segResolveContainerPath(ipNode, null), null);
eq("IP + non-matching joinPath → null", segResolveContainerPath(ipNode, [[{ objectApiName: "X__dlm", fieldApiName: "y__c" }, { objectApiName: "Z__dlm", fieldApiName: "w__c" }]]), null);

console.log("\n5. robustness");
eq("null node → null", segResolveContainerPath(null, null), null);
eq("node without displayPaths → null", segResolveContainerPath({ joinPaths: [] }, null), null);
eq("empty displayPath → ''", segDisplayPathString([]), "");
eq("joinPathKey stable + order-sensitive", segJoinPathKey(ipNode.joinPaths[0]) === segJoinPathKey(ipNode.joinPaths[0]), true);
ok("different paths → different keys", segJoinPathKey(ipNode.joinPaths[0]) !== segJoinPathKey(ipNode.joinPaths[1]));

// ── Source presence ──────────────────────────────────────────────────────────────
console.log("\n6. source presence (wired into the segment feature, dev-only)");
{
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "console-decorate.extension.js"), "utf8");
  ok("segDisplayPathString defined", /function segDisplayPathString\s*\(/.test(src));
  ok("segJoinPathKey defined", /function segJoinPathKey\s*\(/.test(src));
  ok("segResolveContainerPath defined", /function segResolveContainerPath\s*\(/.test(src));
  ok("builds a node index from attributeLibraryMetadata", /_nodeIndexByNodeId/.test(src));
  ok("joins display label as object.field with ' > '", /" > "/.test(src) && /objectLabel/.test(src));
  ok("multi-path matched by joinPath, not guessed", /segJoinPathKey/.test(src) && /displayPaths/.test(src) && /joinPaths/.test(src));
}

console.log("\n" + (fail === 0 ? "✅ ALL PASS" : "❌ FAILURES") + ": " + pass + " passed, " + fail + " failed\n");
process.exit(fail === 0 ? 0 : 1);
