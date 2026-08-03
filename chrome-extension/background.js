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
async function runDcSqlQuery(req) {
  try {
    const host = (req && req.host) || "";
    if (!host) return { ok: false, error: "no host" };
    const got = await readSid(host);
    if (!got) return { ok: false, error: "No Salesforce session cookie found (are you logged in?)" };
    const apiV = "v63.0";
    const url = "https://" + got.coreHost + "/services/data/" + apiV + "/ssot/query-sql";
    const body = JSON.stringify({ sql: String(req.sql || ""), rowLimit: req.rowLimit || 2000 });
    const r = await fetch(url, {
      method: "POST",
      headers: { "Authorization": "Bearer " + got.sid, "Content-Type": "application/json", "Accept": "application/json" },
      body: body,
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (r.status !== 200 && r.status !== 201) {
      let em = "HTTP " + r.status;
      try { em = (j && (j[0] ? j[0].message : (j.error_description || j.message))) || em; } catch (e) {}
      return { ok: false, error: em, status: r.status };
    }
    // Response shape: { data:[[...]], metadata:[{name,type,nullable}], returnedRows }
    return { ok: true, data: (j && j.data) || [], metadata: (j && j.metadata) || [], returnedRows: (j && j.returnedRows) || 0 };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "dcSqlQuery") {
    // prefer the sender tab's actual host when available (more reliable than page-reported)
    const req = { sql: msg.sql, rowLimit: msg.rowLimit, host: (sender && sender.tab && sender.tab.url ? (function () { try { return new URL(sender.tab.url).host; } catch (e) { return msg.host; } })() : msg.host) };
    runDcSqlQuery(req).then(sendResponse);
    return true; // async
  }
});

// (The auto-install-bookmark feature was removed for store compliance: the
//  `bookmarks` permission is sensitive + the feature is redundant with the
//  toolbar-icon click. Users add the bookmarklet manually from install.html if
//  they want it. The extension needs no bookmarks/web_accessible_resources.)
