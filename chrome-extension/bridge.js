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
 *
 * ── SECURITY ──────────────────────────────────────────────────────────────────
 * 1. Message source is validated: ev.source === window (same frame only).
 * 2. Only messages with a recognized __dcReq type are forwarded — an allowlist
 *    prevents a malicious page from triggering arbitrary runtime messages.
 * 3. No sid/cookie values ever pass through this script; the background service
 *    worker reads cookies directly via the cookies API.
 * 4. Responses are posted back via postMessage with a correlation id; no
 *    sensitive data (sid, keys) is included in any response payload.
 */
(function () {
  var api = (typeof browser !== "undefined") ? browser : chrome;

  // 1) advertise extension presence to the MAIN-world tool (shared DOM attribute)
  try { document.documentElement.setAttribute("data-dc-ext", "1"); } catch (e) {}

  // Allowlist of recognized request types — only these are forwarded to the
  // background service worker. Prevents a malicious page from abusing the bridge.
  var ALLOWED_REQ_TYPES = {
    "dc-sql-query": 1, "dc-fetch-page": 1, "dc-ai-explain": 1,
    "dc-save-ai-settings": 1, "dc-get-ai-settings": 1,
    "dc-transform": 1, "dc-activation": 1, "dc-dmo-list": 1, "dc-dmo-fields": 1
  };

  // 2) relay page → background → page, correlated by a request id
  window.addEventListener("message", function (ev) {
    try {
      if (ev.source !== window) return;
      var d = ev.data; if (!d || !d.id) return;
      // Reject unknown message types early
      if (!d.__dcReq || !ALLOWED_REQ_TYPES[d.__dcReq]) return;
      // (a) SQL query relay — passes the FULL response (incl. queryId/rowCount for pagination)
      if (d.__dcReq === "dc-sql-query") {
        api.runtime.sendMessage(
          { type: "dcSqlQuery", sql: d.sql, rowLimit: d.rowLimit, dataspace: d.dataspace, host: location.host },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-sql-query", id: d.id, ok: !err && resp && resp.ok, resp: resp, error: err || (resp && resp.error) }, location.origin);
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
            window.postMessage({ __dcRes: "dc-fetch-page", id: d.id, ok: !err && resp && resp.ok, resp: resp, error: err || (resp && resp.error) }, location.origin);
          }
        );
        return;
      }
      // (c) AI Explain relay — sends transform JSON to Anthropic via background
      if (d.__dcReq === "dc-ai-explain") {
        var aiId = d.id;
        var aiJson = d.transformJson;
        try {
          var p = api.runtime.sendMessage({ type: "dcAiExplain", transformJson: aiJson });
          if (p && p.then) {
            p.then(function (resp) {
              window.postMessage({ __dcRes: "dc-ai-explain", id: aiId, ok: resp && resp.ok, explanation: resp && resp.explanation, error: resp && resp.error }, location.origin);
            }).catch(function (e) {
              window.postMessage({ __dcRes: "dc-ai-explain", id: aiId, ok: false, error: String(e) }, location.origin);
            });
          } else {
            // Chrome callback style
            var err2 = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-ai-explain", id: aiId, ok: !err2 && p && p.ok, explanation: p && p.explanation, error: err2 || (p && p.error) }, location.origin);
          }
        } catch (e) {
          window.postMessage({ __dcRes: "dc-ai-explain", id: aiId, ok: false, error: String(e) }, location.origin);
        }
        return;
      }
      // (d) Save/Get AI settings relay
      if (d.__dcReq === "dc-save-ai-settings") {
        api.runtime.sendMessage({ type: "dcSaveAiSettings", settings: d.settings }, function (resp) {
          var err = api.runtime.lastError ? api.runtime.lastError.message : null;
          window.postMessage({ __dcRes: "dc-save-ai-settings", id: d.id, ok: !err && resp && resp.ok, error: err }, location.origin);
        });
        return;
      }
      if (d.__dcReq === "dc-get-ai-settings") {
        api.runtime.sendMessage({ type: "dcGetAiSettings" }, function (resp) {
          var err = api.runtime.lastError ? api.runtime.lastError.message : null;
          window.postMessage({ __dcRes: "dc-get-ai-settings", id: d.id, ok: !err, provider: resp && resp.provider, hasAnthropicKey: resp && resp.hasAnthropicKey, hasOpenaiKey: resp && resp.hasOpenaiKey, error: err }, location.origin);
        });
        return;
      }
      // (e) Data Transform read relay (GET /ssot/data-transforms/{nameOrId})
      if (d.__dcReq === "dc-transform") {
        api.runtime.sendMessage(
          { type: "dcTransform", nameOrId: d.nameOrId, host: location.host },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-transform", id: d.id, ok: !err && resp && resp.ok, resp: resp && resp.data, error: err || (resp && resp.error) }, location.origin);
          }
        );
        return;
      }
      // (f) Activation read relay (GET /ssot/activations/{activationId})
      if (d.__dcReq === "dc-activation") {
        api.runtime.sendMessage(
          { type: "dcActivation", activationId: d.activationId, host: location.host },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-activation", id: d.id, ok: !err && resp && resp.ok, resp: resp && resp.data, error: err || (resp && resp.error) }, location.origin);
          }
        );
        return;
      }
      if (d.__dcReq === "dc-dmo-list") {
        api.runtime.sendMessage(
          { type: "dcDmoList", dataspace: d.dataspace, host: location.host },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-dmo-list", id: d.id, ok: !err && resp && resp.ok, resp: resp && resp.data, error: err || (resp && resp.error) }, location.origin);
          }
        );
        return;
      }
      if (d.__dcReq === "dc-dmo-fields") {
        api.runtime.sendMessage(
          { type: "dcDmoFields", dmoName: d.dmoName, dataspace: d.dataspace, host: location.host },
          function (resp) {
            var err = api.runtime.lastError ? api.runtime.lastError.message : null;
            window.postMessage({ __dcRes: "dc-dmo-fields", id: d.id, ok: !err && resp && resp.ok, resp: resp && resp.data, error: err || (resp && resp.error) }, location.origin);
          }
        );
        return;
      }
    } catch (e) {
      try { window.postMessage({ __dcRes: (ev.data && ev.data.__dcReq === "dc-transform") ? "dc-transform" : "dc-sql-query", id: ev && ev.data && ev.data.id, ok: false, error: String(e) }, location.origin); } catch (_) {}
    }
  }, false);
})();
