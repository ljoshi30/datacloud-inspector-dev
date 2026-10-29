/* ═══════════════════════════════════════════════════════════════════════════
 * DOM PROBE v47 — Data Space object list: how is "Edit Filters" triggered per row?
 * We want a one-click "open this object's filters" from the list. SF exposes it as a
 * row action (the ▾ caret menu). This dumps the list datatable's ROW ACTION config +
 * each row's identity fields, so we can find a RELIABLE way to open a given object's
 * Edit Filters — rather than blindly synthesizing menu clicks.
 *
 * RUN on the Data Space object list (the "N Filters applied" table visible). Also, if
 * you can, open ONE row's ▾ menu BEFORE clicking the probe so any menu items render.
 * Read-only; copies JSON.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function DomProbe47() {
  "use strict";
  var PANEL_ID = "dc-dom-probe-panel";
  var ex = document.getElementById(PANEL_ID); if (ex) { ex.remove(); return; }

  var out = { probe: "v47", href: location.href, datatables: [], menuItems: [], actionHandlerSeen: false, notes: [] };

  function eachEl(root, d, fn) { if (!root || d > 26) return; var q; try { q = root.querySelectorAll("*"); } catch (e) { return; } for (var i = 0; i < q.length; i++) { fn(q[i], d); var sr = null; try { sr = q[i].shadowRoot; } catch (e) {} if (sr) eachEl(sr, d + 1, fn); } }
  function tag(el) { return (el.tagName || "").toLowerCase(); }
  function txt(el) { try { return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50); } catch (e) { return ""; } }

  function shape(o, depth) {
    if (o == null || depth > 3) return typeof o;
    if (typeof o !== "object") return (typeof o === "string" ? JSON.stringify(o).slice(0, 80) : (typeof o === "function" ? "fn" : String(o)));
    if (Array.isArray(o)) return "[" + o.length + "]" + (o.length ? " " + shape(o[0], depth + 1) : "");
    var r = {}, n = 0;
    for (var k in o) { if (n++ > 40) { r["…"] = "(more)"; break; } var v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === "object" && (v.nodeType || v === window)) { r[k] = "[DOM]"; continue; } r[k] = shape(v, depth + 1); }
    return r;
  }

  // 1) the list datatable(s): columns (look for an "action" column + its rowActions), first row's
  //    identity fields (so we know how to name/target a specific object), and any onrowaction prop.
  eachEl(document, 0, function (el) {
    if (tag(el) !== "runtime_cdp-custom-datatable") return;
    if (out.datatables.length >= 3) return;
    var cols = null, data = null;
    try { cols = el.columns; } catch (e) {}
    try { data = el.data; } catch (e) {}
    var actionCol = null;
    try { if (Array.isArray(cols)) actionCol = cols.filter(function (c) { return c && (c.type === "action" || c.typeAttributes && c.typeAttributes.rowActions); }).map(function (c) { return shape(c, 0); }); } catch (e) {}
    var handlers = {};
    ["onrowaction", "handleRowAction", "onRowAction"].forEach(function (k) { try { if (typeof el[k] === "function") { handlers[k] = "fn"; out.actionHandlerSeen = true; } } catch (e) {} });
    out.datatables.push({
      columns: Array.isArray(cols) ? cols.map(function (c) { return c && (c.fieldName || c.label || c.type); }) : null,
      actionColumn: actionCol,
      firstRow: (Array.isArray(data) && data.length) ? shape(data[0], 0) : "(no data)",
      rowActionHandlers: handlers
    });
  });

  // 2) any open row-action menu items (if the user opened a ▾ before probing) — capture their text
  //    + any value/name so we can see if "Edit Filters" is an addressable action.
  eachEl(document, 0, function (el) {
    var role = ""; try { role = (el.getAttribute && el.getAttribute("role")) || ""; } catch (e) {}
    var t = tag(el);
    if (role === "menuitem" || t === "lightning-menu-item" || (t === "a" && /menu/i.test((function () { try { return el.className + ""; } catch (e) { return ""; } })()))) {
      var label = txt(el); if (!label) return;
      var val = ""; try { val = el.value || el.getAttribute("data-value") || el.getAttribute("name") || ""; } catch (e) {}
      out.menuItems.push({ tag: t, label: label, value: val });
    }
  });
  if (out.menuItems.length > 20) out.menuItems = out.menuItems.slice(0, 20);

  out.notes.push("datatables: " + out.datatables.length + " · open menu items: " + out.menuItems.length);
  out.notes.push(out.actionHandlerSeen ? "a row-action handler exists on the datatable (actions dispatch through it)." : "no onrowaction handler found directly — action may be bound in the column config / a child cell.");
  if (!out.menuItems.length) out.notes.push("No menu items captured — open a row's ▾ menu, THEN run the probe, to see if 'Edit Filters' is an addressable action.");

  var p = document.createElement("div");
  p.id = PANEL_ID;
  p.style.cssText = "position:fixed;top:12px;left:12px;z-index:2147483647;width:min(840px,96vw);max-height:88vh;overflow:auto;background:#0b1020;color:#d7e0f5;border:1px solid #334;border-radius:10px;padding:14px 16px;font:11px/1.5 'SF Mono',Menlo,monospace;white-space:pre-wrap;box-shadow:0 20px 60px rgba(0,0,0,.6);";
  var json = JSON.stringify(out, null, 2);
  p.textContent = "DOM PROBE v47 — Data Space list row actions (open Edit Filters)\n(copied to clipboard — paste it back)\n\n" + json;
  var x = document.createElement("button"); x.textContent = "×"; x.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#9fb0c6;font-size:18px;cursor:pointer;"; x.onclick = function () { p.remove(); }; p.appendChild(x);
  document.body.appendChild(p);
  try { navigator.clipboard.writeText(json); } catch (e) {}
})();
