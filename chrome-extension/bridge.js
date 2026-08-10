/* bridge.js — extension content script (ISOLATED world).
 *
 * The tool (console-decorate.js) runs in the page's MAIN world, where it CAN'T read the
 * HttpOnly sid cookie or make cross-origin calls. This bridge relays a query request
 * from the page → background (which reads the cookie + calls the DOCUMENTED Data Cloud
 * query API) → back to the page.
 *
 * AUTO-DETECT: we stamp <html data-dc-ext="1"> so the MAIN-world tool knows the
 * documented path is available (extension mode). Absent = bookmarklet → tool uses its
 * existing same-origin /aura fallback. Only READ queries are relayed.
 */
(function () {
  var api = (typeof browser !== "undefined") ? browser : chrome;

  // 1) advertise extension presence to the MAIN-world tool (shared DOM attribute)
  try { document.documentElement.setAttribute("data-dc-ext", "1"); } catch (e) {}

  // 2) relay page → background → page, correlated by a request id
  window.addEventListener("message", function (ev) {
    try {
      if (ev.source !== window) return;
      var d = ev.data; if (!d || !d.id) return;
      // (a) SQL query relay — passes the FULL response (incl. queryId/rowCount for pagination)
      if (d.__dcReq === "dc-sql-query") {
        api.runtime.sendMessage(
          { type: "dcSqlQuery", sql: d.sql, rowLimit: d.rowLimit, dataspace: d.dataspace, host: location.host },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-sql-query", id: d.id, ok: !err && resp && resp.ok, resp: resp, error: err || (resp && resp.error) }, "*");
          }
        );
        return;
      }
      // (b) Paginated-query page fetch relay (GET /ssot/query-sql/{queryId}/rows)
      if (d.__dcReq === "dc-fetch-page") {
        api.runtime.sendMessage(
          { type: "dcFetchPage", queryId: d.queryId, offset: d.offset, rowLimit: d.rowLimit, dataspace: d.dataspace, host: location.host },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-fetch-page", id: d.id, ok: !err && resp && resp.ok, resp: resp, error: err || (resp && resp.error) }, "*");
          }
        );
        return;
      }
      // (c) AI Explain relay — sends transform JSON to Anthropic via background
      if (d.__dcReq === "dc-ai-explain") {
        api.runtime.sendMessage(
          { type: "dcAiExplain", transformJson: d.transformJson },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-ai-explain", id: d.id, ok: !err && resp && resp.ok, explanation: resp && resp.explanation, error: err || (resp && resp.error) }, "*");
          }
        );
        return;
      }
      // (d) Save/Get AI settings relay
      if (d.__dcReq === "dc-save-ai-settings") {
        api.runtime.sendMessage({ type: "dcSaveAiSettings", settings: d.settings }, function (resp) {
          var err = api.runtime.lastError ? api.runtime.lastError.message : null;
          window.postMessage({ __dcRes: "dc-save-ai-settings", id: d.id, ok: !err && resp && resp.ok, error: err }, "*");
        });
        return;
      }
      if (d.__dcReq === "dc-get-ai-settings") {
        api.runtime.sendMessage({ type: "dcGetAiSettings" }, function (resp) {
          var err = api.runtime.lastError ? api.runtime.lastError.message : null;
          window.postMessage({ __dcRes: "dc-get-ai-settings", id: d.id, ok: !err, provider: resp && resp.provider, hasAnthropicKey: resp && resp.hasAnthropicKey, hasOpenaiKey: resp && resp.hasOpenaiKey, error: err }, "*");
        });
        return;
      }
      // (e) Data Transform read relay (GET /ssot/data-transforms/{nameOrId})
      if (d.__dcReq === "dc-transform") {
        api.runtime.sendMessage(
          { type: "dcTransform", nameOrId: d.nameOrId, host: location.host },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-transform", id: d.id, ok: !err && resp && resp.ok, resp: resp && resp.data, error: err || (resp && resp.error) }, "*");
          }
        );
        return;
      }
    } catch (e) {
      try { window.postMessage({ __dcRes: (ev.data && ev.data.__dcReq === "dc-transform") ? "dc-transform" : "dc-sql-query", id: ev && ev.data && ev.data.id, ok: false, error: String(e) }, "*"); } catch (_) {}
    }
  }, false);
})();
