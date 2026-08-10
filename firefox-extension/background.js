/*
 * Toolbar-icon click -> inject the inspector into the page's MAIN world.
 *
 * MAIN world is REQUIRED: the tool reads LWC JS properties (el.entity.fields[])
 * that only exist in the page's own context. A default (isolated) content
 * script would see `undefined` and show nothing.
 *
 * inject.js is the exact same source as the bookmarklet/console build and
 * self-guards: first run creates the tool, a second run tears it down. So
 * clicking the icon again removes it — a clean toggle.
 *
 * CROSS-BROWSER: this same file ships to BOTH the Chrome and Firefox builds.
 *  - API namespace: Chrome exposes `chrome`, Firefox exposes `browser` (promise-
 *    based). We alias to `api` so one code path works on both.
 *  - MAIN-world scripting.executeScript is Chrome MV3 + Firefox 128+ (the FF
 *    manifest sets strict_min_version 128).
 *  - Bookmarks bar id differs (Chrome "1" vs Firefox "toolbar_____"), so we
 *    DISCOVER it from the tree instead of hardcoding.
 */
var api = (typeof browser !== "undefined") ? browser : chrome;

api.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await api.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      world: "MAIN",
      files: ["inject.js"],
    });
  } catch (e) {
    console.warn("[DC-MI] injection failed:", e && e.message);
  }
});

// ── Data Cloud SQL query relay (the documented, extension-only path) ──────────
// The tool (MAIN world) can't read the HttpOnly sid or make cross-origin calls, so
// bridge.js forwards a {sql,rowLimit,host} request here. We read the sid cookie from
// the my.salesforce.com host (NOT lightning — different cookie; probe-proven) and POST
// to the DOCUMENTED endpoint /services/data/v63.0/ssot/query-sql. READ-only (SELECT).
// Returns { ok, data, metadata, returnedRows } or { ok:false, error }.
function pget(fn, arg) {
  return new Promise((res) => {
    try { const m = fn(arg, (r) => res(r)); if (m && m.then) m.then(res, () => res(undefined)); }
    catch (e) { res(undefined); }
  });
}
async function readSid(host) {
  // Prefer the my.salesforce.com sid (valid for /services/data); fall back to the
  // lightning-host sid only if the other isn't present.
  const coreHost = host.replace(/\.lightning\.force\.com$/, ".my.salesforce.com");
  const my = await pget((d, cb) => api.cookies.get(d, cb), { url: "https://" + coreHost, name: "sid" });
  if (my && my.value) return { sid: my.value, coreHost };
  const lt = await pget((d, cb) => api.cookies.get(d, cb), { url: "https://" + host, name: "sid" });
  if (lt && lt.value) return { sid: lt.value, coreHost };
  return null;
}
async function pollQueryUntilFinished(coreHost, sid, queryId, dataspace, apiV) {
  var maxPolls = 60;
  for (var i = 0; i < maxPolls; i++) {
    var url = "https://" + coreHost + "/services/data/" + apiV + "/ssot/query-sql/" + encodeURIComponent(queryId) + "?waitTimeMs=10000";
    if (dataspace) url += "&dataspace=" + encodeURIComponent(dataspace);
    var r = await fetch(url, { headers: { "Authorization": "Bearer " + sid, "Accept": "application/json" } });
    var txt = await r.text();
    var st = null; try { st = JSON.parse(txt); } catch (e) {}
    if (!st) break;
    console.log("[DC-MI] poll status:", st.completionStatus, "rowCount:", st.rowCount, "progress:", st.progress);
    if (st.completionStatus === "Finished" || st.completionStatus === "ResultsProduced") {
      return { queryId: st.queryId || queryId, rowCount: st.rowCount || 0, completionStatus: st.completionStatus };
    }
    if (r.status !== 200) break;
  }
  return null;
}

async function runDcSqlQuery(req) {
  try {
    const host = (req && req.host) || "";
    if (!host) return { ok: false, error: "no host" };
    const got = await readSid(host);
    if (!got) return { ok: false, error: "No Salesforce session cookie found (are you logged in?)" };
    const apiV = "v63.0";
    // dataspace is REQUIRED as a query param (probe-proven: none → 400, "TDI" → 201).
    let url = "https://" + got.coreHost + "/services/data/" + apiV + "/ssot/query-sql";
    if (req.dataspace) url += "?dataspace=" + encodeURIComponent(req.dataspace);
    const body = JSON.stringify({ sql: String(req.sql || ""), rowLimit: req.rowLimit || 2000 });
    // DIAGNOSTIC: log exactly what we send so a failure is debuggable (open the
    // extension's background console via about:debugging → Inspect).
    console.log("[DC-MI] query-sql →", url, "| dataspace:", JSON.stringify(req.dataspace), "| sql:", String(req.sql || "").slice(0, 160));
    const r = await fetch(url, {
      method: "POST",
      headers: { "Authorization": "Bearer " + got.sid, "Content-Type": "application/json", "Accept": "application/json" },
      body: body,
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (r.status !== 200 && r.status !== 201) {
      let em = "HTTP " + r.status;
      try { em = (j && (j[0] ? j[0].message : (j.errorMessage || j.error_description || j.message))) || em; } catch (e) {}
      var sessionDead = r.status === 401 || /INVALID_SESSION_ID|session expired|Session expired/i.test(txt);
      if (sessionDead) {
        return { ok: false, sessionExpired: true, status: r.status,
                 error: "Your Salesforce session has expired — refresh the Salesforce tab (log in again), then retry." };
      }
      if (/denied authorization|not authorized/i.test(em)) {
        return { ok: false, error: "Access denied — the dataspace \"" + (req.dataspace || "") + "\" may be incorrect. Run a query in SF's Query Editor first to let the tool detect the correct dataspace, then retry.", status: r.status };
      }
      return { ok: false, error: em + "  [dataspace=" + JSON.stringify(req.dataspace) + "]", status: r.status };
    }
    // Response shape: { data, metadata, returnedRows, status:{queryId, rowCount, completionStatus, ...} }
    const st = (j && j.status) || {};
    var queryId = st.queryId || "";
    var rowCount = st.rowCount || 0;

    // ASYNC QUERY HANDLING: if the query is still running, poll until finished to get
    // the true rowCount. Without this, large tables return partial rowCount and pagination
    // stops early (e.g. 38k rows instead of 117k).
    if (queryId && st.completionStatus && st.completionStatus !== "Finished" && st.completionStatus !== "ResultsProduced") {
      console.log("[DC-MI] query is async (status=" + st.completionStatus + "), polling until finished...");
      var finalStatus = await pollQueryUntilFinished(got.coreHost, got.sid, queryId, req.dataspace, apiV);
      if (finalStatus) {
        rowCount = finalStatus.rowCount || rowCount;
        console.log("[DC-MI] query finished, final rowCount:", rowCount);
      }
    }

    return { ok: true, data: (j && j.data) || [], metadata: (j && j.metadata) || [], returnedRows: (j && j.returnedRows) || 0,
             queryId: queryId, rowCount: rowCount };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Fetch a SINGLE page of rows from a previously-executed query (the pagination endpoint).
// GET /ssot/query-sql/{queryId}/rows?dataspace=X&offset=N&rowLimit=N
async function fetchQueryPage(req) {
  try {
    const host = (req && req.host) || "";
    if (!host) return { ok: false, error: "no host" };
    const got = await readSid(host);
    if (!got) return { ok: false, error: "No session cookie" };
    const apiV = "v63.0";
    let url = "https://" + got.coreHost + "/services/data/" + apiV + "/ssot/query-sql/" + encodeURIComponent(req.queryId) + "/rows";
    const params = ["offset=" + (req.offset || 0), "rowLimit=" + (req.rowLimit || 49999)];
    if (req.dataspace) params.push("dataspace=" + encodeURIComponent(req.dataspace));
    url += "?" + params.join("&");
    const r = await fetch(url, { headers: { "Authorization": "Bearer " + got.sid, "Accept": "application/json" } });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (r.status !== 200) {
      let em = "HTTP " + r.status; try { em = (j && (j[0] ? j[0].message : (j.errorMessage || j.message))) || em; } catch (e) {}
      return { ok: false, error: em, status: r.status };
    }
    return { ok: true, data: (j && j.data) || [], metadata: (j && j.metadata) || [], returnedRows: (j && j.returnedRows) || 0 };
  } catch (e) { return { ok: false, error: String(e) }; }
}
// Read a Data Transform definition (documented GET, sid-cookie auth). READ-only.
async function runDcTransform(req) {
  try {
    const host = (req && req.host) || "";
    if (!host) return { ok: false, error: "no host" };
    const got = await readSid(host);
    if (!got) return { ok: false, error: "No Salesforce session cookie found (are you logged in?)" };
    const url = "https://" + got.coreHost + "/services/data/v63.0/ssot/data-transforms/" + encodeURIComponent(req.nameOrId || "");
    const r = await fetch(url, { headers: { "Authorization": "Bearer " + got.sid, "Accept": "application/json" } });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (r.status !== 200) {
      if (r.status === 401 || /INVALID_SESSION_ID|session expired/i.test(txt))
        return { ok: false, sessionExpired: true, error: "Your Salesforce session has expired — refresh the Salesforce tab, then retry." };
      let em = "HTTP " + r.status; try { em = (j && (j[0] ? j[0].message : (j.message || j.errorMessage))) || em; } catch (e) {}
      return { ok: false, error: em, status: r.status };
    }
    return { ok: true, data: j };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// ── AI Explain: call Anthropic Claude API to explain a Data Transform ────────
async function aiExplainTransform(req) {
  try {
    var keyData = await api.storage.local.get("dc_anthropic_key");
    var apiKey = keyData && keyData.dc_anthropic_key;
    if (!apiKey) return { ok: false, error: "No API key configured. Click the extension icon → Settings → enter your Anthropic API key." };
    var transformJson = req.transformJson || "";
    if (!transformJson) return { ok: false, error: "No transform data to explain." };
    var prompt = "You are a Salesforce Data Cloud expert. Analyze this Data Transform definition JSON and explain it in plain English.\n\nProvide:\n1. A one-paragraph overview of what this transform does (business purpose)\n2. For each output branch, explain the data flow: source → transformations → filters → output\n3. Highlight key business logic (rankings, calculated fields, joins, deduplication)\n4. Mention the write mode and any important field mappings\n\nKeep it concise but thorough. Use bullet points for branch breakdowns. Don't list every field — focus on what the transform DOES.\n\nTransform JSON:\n" + transformJson;
    var r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    var txt = await r.text();
    var j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (r.status !== 200) {
      var em = (j && j.error && j.error.message) || "HTTP " + r.status;
      if (r.status === 401) em = "Invalid API key. Check your Anthropic API key in extension settings.";
      return { ok: false, error: em };
    }
    var content = (j && j.content && j.content[0] && j.content[0].text) || "";
    return { ok: true, explanation: content };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── Save/get API key ────────────────────────────────────────────────────────
async function saveApiKey(key) {
  await api.storage.local.set({ dc_anthropic_key: key });
  return { ok: true };
}
async function getApiKey() {
  var data = await api.storage.local.get("dc_anthropic_key");
  return { ok: true, hasKey: !!(data && data.dc_anthropic_key) };
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabHost = (sender && sender.tab && sender.tab.url) ? (function () { try { return new URL(sender.tab.url).host; } catch (e) { return null; } })() : null;
  if (msg && msg.type === "dcSqlQuery") {
    const req = { sql: msg.sql, rowLimit: msg.rowLimit, dataspace: msg.dataspace, host: tabHost || msg.host };
    runDcSqlQuery(req).then(sendResponse);
    return true; // async
  }
  if (msg && msg.type === "dcTransform") {
    runDcTransform({ nameOrId: msg.nameOrId, host: tabHost || msg.host }).then(sendResponse);
    return true; // async
  }
  if (msg && msg.type === "dcFetchPage") {
    fetchQueryPage({ queryId: msg.queryId, offset: msg.offset, rowLimit: msg.rowLimit, dataspace: msg.dataspace, host: tabHost || msg.host }).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "dcAiExplain") {
    aiExplainTransform({ transformJson: msg.transformJson }).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "dcSaveApiKey") {
    saveApiKey(msg.key).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "dcGetApiKey") {
    getApiKey().then(sendResponse);
    return true;
  }
});

// (The auto-install-bookmark feature was removed for store compliance: the
//  `bookmarks` permission is sensitive + the feature is redundant with the
//  toolbar-icon click. Users add the bookmarklet manually from install.html if
//  they want it. The extension needs no bookmarks/web_accessible_resources.)
