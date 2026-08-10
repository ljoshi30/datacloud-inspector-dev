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

// ── AI Explain: call LLM API to explain a Data Transform ────────────────────
var AI_PROMPT = "You are a Salesforce Data Cloud expert. Analyze this Data Transform definition JSON and explain it in plain English.\n\nProvide:\n1. A one-paragraph overview of what this transform does (business purpose)\n2. For each output branch, explain the data flow: source → transformations → filters → output\n3. Highlight key business logic (rankings, calculated fields, joins, deduplication)\n4. Mention the write mode and any important field mappings\n\nKeep it concise but thorough. Use bullet points for branch breakdowns. Don't list every field — focus on what the transform DOES.\n\nTransform JSON:\n";

async function aiExplainTransform(req) {
  try {
    var rawSettings = {};
    try { rawSettings = await api.storage.local.get(["dc_ai_provider", "dc_anthropic_key", "dc_openai_key"]) || {}; } catch (e) {}
    var settings = {
      dc_ai_provider: rawSettings.dc_ai_provider || _aiSettingsCache.dc_ai_provider,
      dc_anthropic_key: rawSettings.dc_anthropic_key || _aiSettingsCache.dc_anthropic_key,
      dc_openai_key: rawSettings.dc_openai_key || _aiSettingsCache.dc_openai_key,
      dc_gemini_key: rawSettings.dc_gemini_key || _aiSettingsCache.dc_gemini_key,
      dc_sfgateway_key: rawSettings.dc_sfgateway_key || _aiSettingsCache.dc_sfgateway_key,
      dc_sfgateway_url: rawSettings.dc_sfgateway_url || _aiSettingsCache.dc_sfgateway_url
    };
    var provider = settings.dc_ai_provider || "anthropic";
    var transformJson = req.transformJson || "";
    if (!transformJson) return { ok: false, error: "No transform data to explain." };
    var prompt = AI_PROMPT + transformJson;

    if (provider === "gemini") {
      var gKey = settings.dc_gemini_key;
      if (!gKey) return { ok: false, error: "NO_KEY" };
      var gUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + gKey;
      var r = await fetch(gUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2000 } })
      });
      var txt = await r.text();
      var j = null; try { j = JSON.parse(txt); } catch (e) {}
      if (r.status !== 200) {
        var em = (j && j.error && j.error.message) || "HTTP " + r.status;
        if (r.status === 400 && /API_KEY/i.test(txt)) em = "Invalid Gemini API key.";
        return { ok: false, error: em };
      }
      var content = (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text) || "";
      return { ok: true, explanation: content, provider: "gemini" };
    }

    if (provider === "sf-gateway") {
      var sfKey = settings.dc_sfgateway_key;
      if (!sfKey) return { ok: false, error: "NO_KEY" };
      var sfUrl = (settings.dc_sfgateway_url || "https://eng-ai-model-gateway.sfproxy.devx-preprod.aws-esvc1-useast2.aws.sfdc.cl") + "/v1/chat/completions";
      console.log("[DC-MI] AI: calling sf-gateway →", sfUrl);
      var r = await fetch(sfUrl, {
        method: "POST",
        headers: { "Authorization": "Bearer " + sfKey, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4096, messages: [{ role: "user", content: prompt }] })
      });
      var txt = await r.text();
      console.log("[DC-MI] AI: response status:", r.status, "body length:", txt.length, "first 200:", txt.slice(0, 200));
      var j = null; try { j = JSON.parse(txt); } catch (e) {}
      if (r.status !== 200) {
        var em = (j && j.error && j.error.message) || (j && j.message) || "HTTP " + r.status + " - " + txt.slice(0, 200);
        return { ok: false, error: em };
      }
      // Try OpenAI format first, then Anthropic format
      var content = "";
      if (j && j.choices && j.choices[0] && j.choices[0].message) {
        content = j.choices[0].message.content || "";
      } else if (j && j.content && j.content[0]) {
        content = j.content[0].text || "";
      } else if (j && j.completion) {
        content = j.completion;
      }
      if (!content && j) content = "Response received but could not extract text. Raw keys: " + Object.keys(j).join(", ");
      console.log("[DC-MI] AI: extracted content length:", content.length);
      return { ok: true, explanation: content || "Empty response from gateway", provider: "sf-gateway" };
    }

    if (provider === "openai") {
      var oKey = settings.dc_openai_key;
      if (!oKey) return { ok: false, error: "NO_KEY" };
      var r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + oKey, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
      });
      var txt = await r.text();
      var j = null; try { j = JSON.parse(txt); } catch (e) {}
      if (r.status !== 200) {
        var em = (j && j.error && j.error.message) || "HTTP " + r.status;
        if (r.status === 401) em = "Invalid OpenAI API key.";
        return { ok: false, error: em };
      }
      var content = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
      return { ok: true, explanation: content, provider: "openai" };
    }

    // Default: Anthropic
    var aKey = settings.dc_anthropic_key;
    if (!aKey) return { ok: false, error: "NO_KEY" };
    var r2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": aKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
    });
    var txt2 = await r2.text();
    var j2 = null; try { j2 = JSON.parse(txt2); } catch (e) {}
    if (r2.status !== 200) {
      var em2 = (j2 && j2.error && j2.error.message) || "HTTP " + r2.status;
      if (r2.status === 401) em2 = "Invalid Anthropic API key.";
      return { ok: false, error: em2 };
    }
    var content2 = (j2 && j2.content && j2.content[0] && j2.content[0].text) || "";
    return { ok: true, explanation: content2, provider: "anthropic" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ── Save/get AI settings (with fallback for temporary extensions) ────────────
var _aiSettingsCache = {};
async function saveAiSettings(settings) {
  var toSave = {};
  if (settings.provider) toSave.dc_ai_provider = settings.provider;
  if (settings.anthropicKey) toSave.dc_anthropic_key = settings.anthropicKey;
  if (settings.openaiKey) toSave.dc_openai_key = settings.openaiKey;
  if (settings.geminiKey) toSave.dc_gemini_key = settings.geminiKey;
  if (settings.sfGatewayKey) toSave.dc_sfgateway_key = settings.sfGatewayKey;
  if (settings.sfGatewayUrl) toSave.dc_sfgateway_url = settings.sfGatewayUrl;
  Object.assign(_aiSettingsCache, toSave);
  try { await api.storage.local.set(toSave); } catch (e) { console.warn("[DC-MI] storage.local.set failed, using in-memory cache:", e); }
  return { ok: true };
}
async function getAiSettings() {
  var data = {};
  try { data = await api.storage.local.get(["dc_ai_provider", "dc_anthropic_key", "dc_openai_key", "dc_gemini_key", "dc_sfgateway_key", "dc_sfgateway_url"]) || {}; } catch (e) {}
  var provider = (data.dc_ai_provider || _aiSettingsCache.dc_ai_provider || "gemini");
  var aKey = data.dc_anthropic_key || _aiSettingsCache.dc_anthropic_key || "";
  var oKey = data.dc_openai_key || _aiSettingsCache.dc_openai_key || "";
  var gKey = data.dc_gemini_key || _aiSettingsCache.dc_gemini_key || "";
  var sfKey = data.dc_sfgateway_key || _aiSettingsCache.dc_sfgateway_key || "";
  return { ok: true, provider: provider, hasAnthropicKey: !!aKey, hasOpenaiKey: !!oKey, hasGeminiKey: !!gKey, hasSfGatewayKey: !!sfKey };
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
  if (msg && msg.type === "dcSaveAiSettings") {
    saveAiSettings(msg.settings || {}).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "dcGetAiSettings") {
    getAiSettings().then(sendResponse);
    return true;
  }
});

// (The auto-install-bookmark feature was removed for store compliance: the
//  `bookmarks` permission is sensitive + the feature is redundant with the
//  toolbar-icon click. Users add the bookmarklet manually from install.html if
//  they want it. The extension needs no bookmarks/web_accessible_resources.)
