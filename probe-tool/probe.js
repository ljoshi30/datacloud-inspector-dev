/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v31 — the ⧉ opens the WRONG record on a standard DC list (e.g. Calculated
 * Insights row → opens the Data Space, because the row has MULTIPLE /r/<id>/view links
 * and we grab the first one instead of the NAME-cell one).
 *
 * RUN on a Data Cloud LIST that has a secondary record link in a column (Calculated Insights:
 * the "Data Space / TDI" column links to a DataSpace). Read-only. Copies JSON + shows panel.
 * For the FIRST data row it reports, IN DOM ORDER (crossing shadow), EVERY /r/<id>/view anchor
 * with: the href, the anchor text, and which CELL (column index / data-label / role) it sits in.
 * This tells us how to pick the NAME-cell link (col 0) vs the Data Space link reliably.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe31() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }
  var REC = /\/lightning\/r\/(?:[A-Za-z0-9_]+\/)?[A-Za-z0-9]{15,18}\/view/i;
  var out = { href: location.href, firstRowLinks: [], notes: [] };

  function eachEl(root, d, fn) {
    if (d > 16) return;
    var q; try { q = root.querySelectorAll("*"); } catch (e) { return; }
    for (var i = 0; i < q.length; i++) { fn(q[i]); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); }
  }
  function attr(el, a) { try { return el.getAttribute(a) || ""; } catch (e) { return ""; } }

  // find rows (tr with data-row-key-value, OR any tr that contains a /r/ link)
  var rows = [];
  eachEl(document, 0, function (el) {
    if ((el.tagName || "").toLowerCase() !== "tr") return;
    var hasLink = false;
    eachEl(el, 0, function (a) { if (hasLink) return; if ((a.tagName || "").toLowerCase() === "a" && REC.test(attr(a, "href"))) hasLink = true; });
    if (hasLink) rows.push(el);
  });
  out.notes.push("rows with a record link: " + rows.length);

  if (rows.length) {
    var tr = rows[0];
    // enumerate the cells of this row (crossing shadow) in DOM order
    var cells = [];
    eachEl(tr, 0, function (el) {
      var tg = (el.tagName || "").toLowerCase(), role = attr(el, "role");
      if (tg === "td" || tg === "th" || role === "gridcell" || role === "rowheader") cells.push(el);
    });
    // for each record link in the row, find which cell index + label it belongs to
    var order = 0;
    eachEl(tr, 0, function (a) {
      if ((a.tagName || "").toLowerCase() !== "a") return;
      var hv = attr(a, "href"); if (!REC.test(hv)) return;
      // which cell contains this anchor?
      var cellIdx = -1, cellLabel = "", cellRole = "";
      for (var ci = 0; ci < cells.length; ci++) {
        var inside = false; eachEl(cells[ci], 0, function (x) { if (x === a) inside = true; });
        // also check direct containment via contains (same root) as a fallback
        try { if (!inside && cells[ci].contains && cells[ci].contains(a)) inside = true; } catch (e) {}
        if (inside) { cellIdx = ci; cellLabel = attr(cells[ci], "data-label") || attr(cells[ci], "aria-label"); cellRole = attr(cells[ci], "role"); break; }
      }
      out.firstRowLinks.push({
        domOrder: order++,
        href: hv,
        text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
        cellIndex: cellIdx,
        cellLabel: cellLabel,
        cellRole: cellRole,
        anchorClass: attr(a, "class").slice(0, 60)
      });
    });
    out.notes.push("cells in first row: " + cells.length);
    out.notes.push("record links in first row: " + out.firstRowLinks.length + "  (if >1, the ⧉ must pick the NAME cell = lowest cellIndex / rowheader, NOT domOrder 0)");
    // what does the current code pick? first /r/ link anywhere in the row (domOrder 0)
    if (out.firstRowLinks.length) out.notes.push("current code would open: domOrder 0 → " + out.firstRowLinks[0].href + " (cellIndex " + out.firstRowLinks[0].cellIndex + ", label '" + out.firstRowLinks[0].cellLabel + "')");
  }

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(720px,95vw);max-height:86vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11.5px/1.5 'SF Mono',Menlo,monospace;box-shadow:0 20px 60px rgba(0,0,0,.6);white-space:pre-wrap;";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v31 — ⧉ wrong-record on standard list\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
