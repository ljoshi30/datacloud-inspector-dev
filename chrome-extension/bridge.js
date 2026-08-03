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
      var d = ev.data;
      if (!d || d.__dcReq !== "dc-sql-query" || !d.id) return;
      // forward to background; it reads the sid cookie for THIS tab and runs the query
      api.runtime.sendMessage(
        { type: "dcSqlQuery", sql: d.sql, rowLimit: d.rowLimit, host: location.host },
        function (resp) {
          var err = api.runtime.lastError ? api.runtime.lastError.message : null;
          window.postMessage({ __dcRes: "dc-sql-query", id: d.id, ok: !err && resp && resp.ok, resp: resp, error: err || (resp && resp.error) }, "*");
        }
      );
    } catch (e) {
      try { window.postMessage({ __dcRes: "dc-sql-query", id: ev && ev.data && ev.data.id, ok: false, error: String(e) }, "*"); } catch (_) {}
    }
  }, false);
})();
