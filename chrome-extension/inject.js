/* ============================================================================
 * Data 360 Mapping Inspector — INLINE DECORATOR
 * ----------------------------------------------------------------------------
 * Renders each field's API (developer) name in grey directly UNDER its label,
 * inside the real mapping canvas — no separate panel.
 *
 * What we confirmed via recon:
 *  - Canvas is deep LWC shadow DOM.
 *  - SOURCE (DLO) API names live on <runtime_cdp-data-stream-attribute-list>
 *    as ATTRIBUTE NAMES, in the same order the rows render. -> decorate by
 *    order-zip, zero network.
 *  - TARGET (DMO) API names are NOT in the DOM as attributes. We attempt to
 *    read them from the list-item LWC properties; if that's blocked, source is
 *    still decorated and we dump the first target item's property shape to the
 *    console + on-page box so the target side can be finished.
 *
 * Injection is LWC-safe: we set a data-dc-api attribute on the row container
 * and add ONE <style> per shadow root that renders it via ::after. We do NOT
 * insert element nodes into LWC-managed trees (which would trip reconciliation).
 * A debounced MutationObserver re-applies after re-renders / scrolling.
 *
 * Paste whole file into DevTools Console, Enter. Re-paste to toggle off/on.
 * Read-only w.r.t. data; only adds attributes + <style> nodes. Safe.
 * ==========================================================================*/
(function () {
  "use strict";
  // Re-running the bookmarklet acts as a TOGGLE for the whole tool: if it's
  // already loaded, remove it entirely (bar, tooltip, tags, modal, timers).
  if (window.__DC_DECOR__) { try { window.__DC_DECOR__.teardown(); } catch (e) {} return; }

  const API_ATTR = /^[A-Za-z0-9_]+__(c|dll|dlm)$/;      // attribute-name is an API name
  const API_VAL = /^[A-Za-z0-9_]+__(c|dll|dlm)$/;       // a value that is a bare API name
  const HEADER = /\(\d+\)\s*$/;                          // "Is Mapped (15)" / "Unmapped (25)"
  const SRC_LIST = "runtime_cdp-data-stream-attribute-list";
  const SRC_CONTAINER = "runtime_cdp-data-stream-source-entity-list";
  const TGT_CONTAINER = "runtime_cdp-data-stream-target-entity-list";
  const ITEM = "runtime_cdp-data-stream-attribute-list-item";
  const TABLE_CMP = "runtime_cdp-data-mapper-table";
  const TAGGING_CMP = "runtime_cdp-data-stream-tagging-container";

  // ---------- shadow-aware traversal ----------
  function eachElement(root, fn) {
    let els;
    try { els = root.querySelectorAll("*"); } catch (e) { return; }
    for (const el of els) {
      fn(el);
      let sr = null; try { sr = el.shadowRoot; } catch (e) {}
      if (sr) eachElement(sr, fn);
    }
  }
  function tagOf(el) { try { return el.tagName.toLowerCase(); } catch (e) { return ""; } }
  // Guards against Lightning's OLD-page components after in-app navigation:
  // they can stay in the DOM (isConnected true) but HIDDEN. So we check actual
  // visibility (has a layout box) — a hidden cached view has zero size. This is
  // what makes Refresh reflect the CURRENT mapping, not the previous one.
  function isLive(el) { try { return el.isConnected !== false; } catch (e) { return true; } }
  function isVisible(el) {
    try {
      if (el.isConnected === false) return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width > 0 && r.height > 0;
    } catch (e) { return true; }
  }
  function findByTag(tag) {
    const out = [];
    eachElement(document, (el) => { if (tagOf(el) === tag && isLive(el)) out.push(el); });
    return out;
  }
  // Same as findByTag but keeps only currently-VISIBLE matches (used for the
  // export/list build so stale hidden pages are excluded).
  function findVisibleByTag(tag) { return findByTag(tag).filter(isVisible); }
  // items scoped under a given ancestor element (crossing shadow).
  // NOTE: we must collect items GLOBALLY (findByTag descends into every
  // element's shadowRoot from document), then keep only those whose
  // shadow-ancestry passes through `ancestor`. Walking from `ancestor` alone
  // misses rows that live inside ancestor's OWN shadowRoot.
  function itemsUnder(ancestor) {
    if (!ancestor) return [];
    return findByTag(ITEM).filter((it) => isDescendant(it, ancestor));
  }
  // True if `node` sits anywhere under `ancestor`, crossing shadow boundaries.
  // At a shadow-root boundary parentNode is null, so we hop to the root's host.
  function isDescendant(node, ancestor) {
    let cur = node;
    let guard = 0;
    while (cur && guard++ < 400) {
      if (cur === ancestor) return true;
      if (cur.parentNode) { cur = cur.parentNode; continue; }
      let host = null;
      try { const r = cur.getRootNode && cur.getRootNode(); host = r && r.host; } catch (e) {}
      cur = host || null;
    }
    return false;
  }

  // API (developer) names in DOM order from an attribute-list element's
  // attribute NAMES (source side stores them there).
  function attrApiNames(listEl) {
    let names = [];
    try { names = Array.from(listEl.attributes).map((a) => a.name); } catch (e) {}
    return names.filter((n) => API_ATTR.test(n));
  }

  // Walk up (crossing shadow boundaries) to the nearest ancestor of a tag.
  function ancestorOfTag(node, tag) {
    let cur = node, guard = 0;
    while (cur && guard++ < 400) {
      if (tagOf(cur) === tag) return cur;
      if (cur.parentNode) { cur = cur.parentNode; continue; }
      let host = null; try { const r = cur.getRootNode && cur.getRootNode(); host = r && r.host; } catch (e) {}
      cur = host || null;
    }
    return null;
  }

  function labelOf(item) {
    try { return item.getAttribute("data-tid") || ""; } catch (e) { return ""; }
  }

  // ---------- LWC property introspection (for target API names) ----------
  function scanVal(k, v, found) {
    if (typeof v === "string") { if (API_VAL.test(v)) found[k] = v; return; }
    if (v && typeof v === "object") {
      try { const j = JSON.stringify(v); if (j && /__(c|dll|dlm)\b/.test(j)) found[k] = j.slice(0, 240); } catch (e) {}
    }
  }
  function introspect(el) {
    const found = {};
    try { for (const k of Object.keys(el)) scanVal(k, safeGet(el, k), found); } catch (e) {}
    let proto = Object.getPrototypeOf(el), depth = 0;
    while (proto && depth++ < 8) {
      let ks = [];
      try { ks = Object.getOwnPropertyNames(proto); } catch (e) {}
      for (const k of ks) {
        if (k === "constructor" || found[k]) continue;
        let d; try { d = Object.getOwnPropertyDescriptor(proto, k); } catch (e) { continue; }
        if (d && typeof d.get === "function") scanVal(k, safeGet(el, k), found);
      }
      proto = Object.getPrototypeOf(proto);
    }
    return found;
  }
  function safeGet(el, k) { try { return el[k]; } catch (e) { return undefined; } }

  // Build a label->apiName map from an element's LWC `.entity.fields[]` (each
  // field has `.label` + `.name`). Works for any list element that exposes it.
  // Matching BY LABEL is inherently section-order-proof — a row is looked up by
  // its label, so how the UI groups rows (Is Mapped / Unmapped) never matters.
  function entityFieldMap(el) {
    const map = new Map();      // label -> api name (FIRST field per label; unchanged)
    const typeMap = new Map();  // label -> data type (e.g. Text, DateTime, Number)
    const labelNames = new Map(); // label -> [ALL api names with that label, in field order]
    let entityName = null;
    try {
      const entity = safeGet(el, "entity");
      if (entity) {
        entityName = safeGet(entity, "name") || null;
        const fields = safeGet(entity, "fields");
        if (fields && typeof fields.length === "number") {
          for (let i = 0; i < fields.length; i++) {
            const f = safeGet(fields, i);
            if (!f) continue;
            const label = safeGet(f, "label");
            const name = safeGet(f, "name");
            if (label != null && typeof name === "string" && name) {
              // labelNames keeps EVERY field (used to disambiguate colliding labels)
              const arr = labelNames.get(label); if (arr) arr.push(name); else labelNames.set(label, [name]);
              if (!map.has(label)) {
                map.set(label, name);
                const ty = safeGet(f, "type");
                if (ty != null) typeMap.set(label, String(ty));
              }
            }
          }
        }
      }
    } catch (e) {}
    return { map, typeMap, labelNames, entityName };
  }

  // TARGET side: each <runtime_cdp-data-stream-target-entity-list> carries the
  // field map. Scoped PER LIST — labels collide across DMOs, so scoping to each
  // DMO's own list is what disambiguates them.
  function targetLists() {
    return findByTag(TGT_CONTAINER).map((listEl) => {
      const { map, entityName } = entityFieldMap(listEl);
      return { listEl, map, entityName };
    });
  }

  // Resolve a row's api name from a label->name map, tolerating whitespace
  // differences (DOM labels can be truncated/renormalized vs entity.fields).
  function lookupByLabel(map, label) {
    let name = map.get(label);
    if (name) return name;
    const norm = String(label).replace(/\s+/g, " ").trim();
    for (const [k, v] of map) { if (String(k).replace(/\s+/g, " ").trim() === norm) return v; }
    return null;
  }

  // ---------- decoration ----------
  // We render the api name as a REAL <span> child (not a CSS ::after) so the
  // text is selectable & copyable. One <style> per shadow root makes the row
  // wrap so the span sits on its own line BELOW the label. Inserting a node
  // into the LWC-managed row can be undone by a re-render, but the debounced
  // MutationObserver re-runs redraw() and self-heals; decorate() is idempotent.
  // ---------- HOVER TOOLTIP (zero canvas impact) ----------
  // We insert NOTHING into the mapping rows — that is the only way to guarantee
  // the connector SVG lines never move. Instead we tag each field/header host
  // with the api name via a JS property (dcApiName) + a data attribute, and a
  // single body-level tooltip shows it on hover. No row reflow, ever.
  let tipEl = null, tipHideT = null;
  function ensureTip() {
    if (tipEl && tipEl.isConnected) return tipEl;
    tipEl = document.createElement("div");
    tipEl.id = "dc-tip";
    tipEl.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;display:none;" +
      "background:#16325c;color:#fff;font:12px/1.3 'SF Mono',Menlo,Consolas,monospace;" +
      "padding:5px 9px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:60vw;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function showTip(text, x, y, hint) {
    const t = ensureTip();
    if (tipHideT) { clearTimeout(tipHideT); tipHideT = null; }
    // main name + a dim "click to copy" hint line
    t.innerHTML = "";
    const nameLine = document.createElement("div");
    nameLine.textContent = text;
    nameLine.style.cssText = "white-space:nowrap";
    t.appendChild(nameLine);
    const hintLine = document.createElement("div");
    hintLine.textContent = hint || "click field to copy";
    hintLine.style.cssText = "margin-top:2px;font-size:10px;opacity:.7";
    t.appendChild(hintLine);
    t.style.display = "block";
    let nx = x + 12, ny = y + 14;
    const w = t.offsetWidth || 200, h = t.offsetHeight || 34;
    if (nx + w > window.innerWidth - 6) nx = Math.max(6, window.innerWidth - w - 6);
    if (ny + h > window.innerHeight - 6) ny = y - h - 10;
    t.style.left = nx + "px"; t.style.top = ny + "px";
  }
  function hideTip() { if (tipEl) { tipEl.style.display = "none"; } }
  // Fully remove the tooltip element from the DOM (used when turning OFF).
  function removeTip() {
    if (tipHideT) { clearTimeout(tipHideT); tipHideT = null; }
    if (tipEl) { try { tipEl.remove(); } catch (e) {} tipEl = null; }
  }

  // One delegated hover handler on the document catches mouseover for any
  // tagged host (crossing shadow via composedPath). Registered once.
  let hoverBound = false;
  function bindHover() {
    if (hoverBound) return; hoverBound = true;
    const onOver = (e) => {
      if (!state.on) return;
      let name = null;
      const path = (e.composedPath && e.composedPath()) || [];
      for (const n of path) {
        if (n && n.nodeType === 1) {
          const v = n.dcApiName || (n.getAttribute && n.getAttribute("data-dc-api-name"));
          if (v) { name = v; break; }
        }
      }
      if (name) showTip(name, e.clientX, e.clientY);
      else hideTip();
    };
    const onMove = (e) => {
      if (!state.on || !tipEl || tipEl.style.display === "none") return;
      // keep following the cursor while over a tagged element
      const path = (e.composedPath && e.composedPath()) || [];
      let name = null;
      for (const n of path) { if (n && n.nodeType === 1) { const v = n.dcApiName || (n.getAttribute && n.getAttribute("data-dc-api-name")); if (v) { name = v; break; } } }
      if (name) showTip(name, e.clientX, e.clientY); else hideTip();
    };
    // Click the field label/name to COPY its api name. We only act when the
    // click path contains a tagged host AND does NOT contain the mapping dot /
    // a button — so we never hijack Salesforce's own row controls.
    const onClick = (e) => {
      if (!state.on) return;
      const path = (e.composedPath && e.composedPath()) || [];
      let name = null, onControl = false;
      for (const n of path) {
        if (!n || n.nodeType !== 1) continue;
        const tag = (n.tagName || "").toLowerCase();
        if (tag === "button" || tag === "a" || tag === "input" || tag === "lightning-icon" || tag === "lightning-primitive-icon") onControl = true;
        let cls = ""; try { cls = (n.getAttribute && n.getAttribute("class")) || ""; } catch (e) {}
        if (/socket|toggle|checkbox|slds-icon|dot|handle/i.test(cls)) onControl = true;
        let v = null; try { v = n.dcApiName || (n.getAttribute && n.getAttribute("data-dc-api-name")); } catch (e) {}
        if (v && !name) name = v;
      }
      if (name && !onControl) {
        try {
          navigator.clipboard.writeText(name).then(() => {
            showTip(name, e.clientX, e.clientY, "✓ Copied!");
            if (tipHideT) clearTimeout(tipHideT);
            tipHideT = setTimeout(hideTip, 900);
          }).catch(() => {});
        } catch (err) {}
        // don't preventDefault/stop — let Salesforce still do its thing on the
        // label if it wants; copying is a side benefit, not a hijack.
      }
    };
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseout", (e) => { if (tipHideT) clearTimeout(tipHideT); tipHideT = setTimeout(hideTip, 60); }, true);
    document.addEventListener("click", onClick, true);
  }

  // Tag a field row's host with its api name (no visible node inserted).
  function decorate(item, apiName) {
    if (!apiName) return false;
    let sr = null; try { sr = item.shadowRoot; } catch (e) {}
    if (!sr) return false;
    let host = null;
    try { host = sr.querySelector("h4.name, h4, .root, [data-tid='main-container']"); } catch (e) {}
    if (!host) host = item; // fall back to the row host itself
    try {
      host.dcApiName = apiName;
      if (host.setAttribute) host.setAttribute("data-dc-api-name", apiName);
      // also tag the item host so hovering anywhere on the row works
      item.dcApiName = apiName;
      if (item.setAttribute) item.setAttribute("data-dc-api-name", apiName);
      if (host.style && host.style.setProperty) host.style.setProperty("cursor", "help", "important");
    } catch (e) { return false; }
    return true;
  }
  // Tag an entity header (<h3>) with its api name.
  function decorateHeader(listEl, apiName) {
    if (!apiName) return false;
    let sr = null; try { sr = listEl.shadowRoot; } catch (e) {}
    if (!sr) return false;
    let h = null;
    try { h = sr.querySelector("h3.entity-label, h3.slds-text-title_bold"); } catch (e) {}
    if (!h) return false;
    try {
      h.dcApiName = apiName;
      if (h.setAttribute) h.setAttribute("data-dc-api-name", apiName);
      if (h.style && h.style.setProperty) h.style.setProperty("cursor", "help", "important");
    } catch (e) { return false; }
    return true;
  }
  // Remove all tags (used when toggled off).
  function clearTags() {
    eachElement(document, (el) => {
      try {
        if (el.dcApiName != null) { try { delete el.dcApiName; } catch (e) { el.dcApiName = null; } }
        if (el.hasAttribute && el.hasAttribute("data-dc-api-name")) el.removeAttribute("data-dc-api-name");
      } catch (e) {}
    });
    removeTip(); // fully remove the tooltip element (Hide API names)
  }

  // Remove ALL decoration (hover tags + inline spans). Used by teardown.
  function undecorateAll() { clearTags(); clearInline(); }

  // ---------- INLINE MODE (visible + Ctrl+F searchable) ----------
  // Separate from hover: injects a small selectable <span> AFTER the field
  // label so the api name is visible in the DOM (findable via browser search).
  // FIELDS ONLY — never headers (header decoration reflowed a different wrapper
  // and distorted the canvas). Pure inline + small explicit line-height keeps
  // the row's line-box height unchanged, so ◉ anchors / connector lines don't
  // move. Idempotent; a MutationObserver-driven redraw re-applies after renders.
  function inlineDecorate(item, apiName) {
    if (!apiName) return false;
    let sr = null; try { sr = item.shadowRoot; } catch (e) {}
    if (!sr) return false;
    let labelEl = null;
    try { labelEl = sr.querySelector("h4.name, h4"); } catch (e) {}
    if (!labelEl) return false; // fields-only anchor
    // Anchor to .root (the row wrapper), NOT the h4 label. probeRow() proved the
    // ◉ dot (span.mappingTargetIconContainer) is position:absolute anchored to
    // .root (already position:relative). Setting position:relative on the h4
    // STOLE that anchor → the dot shifted (worst on Primary Key). By appending an
    // OUT-OF-FLOW span to .root and NEVER touching the h4 or .root's own styles,
    // the dot's anchor and the row height are both untouched → nothing moves on
    // any row. We do NOT resize the label (shrinking it collapsed rows: 2000px+
    // drift). Placed by MEASUREMENT at 9px into the ~9px gap below the label.
    let root = null;
    try { root = sr.querySelector(".root, .normal-border"); } catch (e) {}
    if (!root) { try { root = labelEl.parentElement; } catch (e) {} }
    if (!root) return false;
    try {
      let span = root.querySelector(":scope > .dc-api-inline");
      if (span && span.textContent === apiName) return true;
      if (!span) {
        span = document.createElement("span");
        span.className = "dc-api-inline";
        span.addEventListener("mousedown", (e) => e.stopPropagation());
        span.addEventListener("click", (e) => e.stopPropagation());
        root.appendChild(span);
      }
      span.textContent = apiName;
      const set = (p, v) => { try { span.style.setProperty(p, v, "important"); } catch (e) {} };
      set("position", "absolute"); set("display", "block"); set("line-height", "1");
      set("font-family", "'SF Mono',Menlo,Consolas,monospace"); set("font-size", "9px");
      set("color", "#4a6fa5"); set("padding", "0"); set("margin", "0");
      set("white-space", "nowrap"); set("pointer-events", "auto"); set("z-index", "2");
      set("user-select", "text"); set("-webkit-user-select", "text");
      // Place by MEASUREMENT: sit the name just under the label text, aligned to
      // the label's left, 2px lifted so it clears the row divider.
      try {
        const rr = root.getBoundingClientRect();
        const lr = labelEl.getBoundingClientRect();
        const top = Math.max(0, Math.round(lr.bottom - rr.top) - 2);
        const left = Math.max(0, Math.round(lr.left - rr.left));
        set("top", top + "px"); set("left", left + "px");
      } catch (e) { set("top", "22px"); set("left", "14px"); } // measured fallbacks
      try { span.setAttribute("title", apiName); } catch (e) {}
    } catch (e) { return false; }
    return true;
  }
  function clearInline() {
    eachElement(document, (el) => {
      try {
        if (el.classList && (el.classList.contains("dc-api-inline") ||
            el.classList.contains("dc-tapi-inline") || el.classList.contains("dc-sapi-inline")))
          el.remove();
      } catch (e) {}
    });
    // also clear table hover tags
    const tableCmp = findByTag(TABLE_CMP)[0];
    if (tableCmp) {
      let tsr = null; try { tsr = tableCmp.shadowRoot; } catch (e) {}
      if (tsr) {
        try {
          for (const el of Array.from(tsr.querySelectorAll("[data-dc-api-name]"))) {
            try { el.removeAttribute("data-dc-api-name"); el.dcApiName = null; el.style.removeProperty("cursor"); } catch (e) {}
          }
        } catch (e) {}
      }
    }
  }

  // ===== TABLE VIEW (runtime_cdp-data-mapper-table) =====
  // Source API names are shown natively in <span class="source-field"> inside <th>.
  // Target side shows only a label via lightning-grouped-combobox — no API name.
  // Data source: container.mapping[] → source.fieldName, target.entityName, target.fieldName.
  //
  // DMO detection order:
  //   1. entity selector combobox inputText (set when user picks from dropdown)
  //   2. entity selector .value prop (sometimes holds selected value)
  //   3. "Data Model: X" header span inside table shadow root (pre-selected / default)
  //   4. only one unique target entity in mapping[] (unambiguous)
  //
  // DLO change (Search Data Lake Objects bar): container.mapping[] reloads automatically;
  // the 1.2s poll re-reads it and re-decorates.

  function tableEntitySelectorInfo() {
    let inputText = "", value = "", items = [];
    eachElement(document, (el) => {
      if (tagOf(el) !== "lightning-grouped-combobox") return;
      let id = ""; try { id = el.getAttribute("id") || ""; } catch (e) {}
      if (!/target-entity-selector/i.test(id)) return;
      const it = safeGet(el, "inputText"); if (it && String(it).trim()) inputText = String(it).trim();
      const v  = safeGet(el, "value");     if (v  && typeof v === "string" && v.trim()) value = String(v).trim();
      const it2 = safeGet(el, "items"); if (Array.isArray(it2)) items = it2;
    });
    // Build label→apiName and apiName set from items
    const labelToApi = new Map();
    const apiSet = new Set();
    for (const item of items) {
      if (!item) continue;
      const t = safeGet(item, "text"); const v = safeGet(item, "value");
      if (t && v) { labelToApi.set(String(t).trim(), String(v)); apiSet.add(String(v)); }
    }
    return { inputText, value, labelToApi, apiSet };
  }

  // Returns the current DMO entityName (API name) to filter on, or null.
  function tableSelectedDmo() {
    const { inputText, value, labelToApi, apiSet } = tableEntitySelectorInfo();

    // 1. inputText set by user interaction
    if (inputText) {
      if (apiSet.has(inputText)) return inputText;
      const a = labelToApi.get(inputText); if (a) return a;
    }
    // 2. .value prop directly
    if (value) {
      if (apiSet.has(value)) return value;
      const a = labelToApi.get(value); if (a) return a;
    }

    // 3. "Data Model: X" header span inside table shadow root
    const tableCmp = findByTag(TABLE_CMP).find(isVisible);
    if (tableCmp) {
      let tsr = null; try { tsr = tableCmp.shadowRoot; } catch (e) {}
      if (tsr) {
        let spans; try { spans = Array.from(tsr.querySelectorAll("span")); } catch (e) { spans = []; }
        for (const sp of spans) {
          const t = (sp.textContent || "").trim();
          if (!t.startsWith("Data Model:")) continue;
          const label = t.replace(/^Data Model:\s*/, "").trim();
          if (!label) continue;
          const a = labelToApi.get(label); if (a) return a;
          // items not loaded yet — match by label text directly as partial key
          // try fuzzy: find apiSet member whose last segment matches label
          for (const api of apiSet) {
            const seg = api.replace(/__dlm$/, "").replace(/^ssot__/, "").replace(/__/g, " ");
            if (seg.toLowerCase() === label.toLowerCase()) return api;
          }
          // store label as-is so export can use it even without API name
          return "__LABEL__:" + label;
        }
      }
    }

    // 4. If only one unique target entity in mapping, use that
    const container = findByTag(TAGGING_CMP).find(isVisible) || findByTag(TAGGING_CMP)[0];
    if (container) {
      const raw = safeGet(container, "mapping");
      if (Array.isArray(raw)) {
        const entities = new Set();
        for (const item of raw) { const t = safeGet(item, "target"); const e = t && safeGet(t, "entityName"); if (e) entities.add(e); }
        if (entities.size === 1) return Array.from(entities)[0];
      }
    }
    return null;
  }

  // Build srcNorm → [{dmo, tgt, srcFull}] from container.mapping[].
  // srcNorm = fieldName with __c suffix stripped (matches text in span.source-field).
  function buildTableMap() {
    const container = findByTag(TAGGING_CMP).find(isVisible) || findByTag(TAGGING_CMP)[0];
    if (!container) return new Map();
    const raw = safeGet(container, "mapping");
    if (!Array.isArray(raw)) return new Map();
    const map = new Map();
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const src = safeGet(item, "source"); const tgt = safeGet(item, "target");
      if (!src || !tgt) continue;
      const srcName = safeGet(src, "fieldName"); const dmoName = safeGet(tgt, "entityName"); const tgtName = safeGet(tgt, "fieldName");
      if (!srcName || !dmoName || !tgtName) continue;
      const norm = String(srcName).replace(/__c$/, "");
      if (!map.has(norm)) map.set(norm, []);
      map.get(norm).push({ dmo: dmoName, tgt: tgtName, srcFull: String(srcName) });
    }
    return map;
  }

  // Inject source + target API names into table rows.
  // Called for both inline and hover modes. Clears all stale spans first so
  // a DMO or DLO switch always shows fresh data.
  function tableRedraw() {
    const tableCmp = findByTag(TABLE_CMP).find(isVisible);
    if (!tableCmp) return;
    let sr = null; try { sr = tableCmp.shadowRoot; } catch (e) {}
    if (!sr) return;

    // Always clear first so DMO/DLO changes show fresh data
    try {
      for (const old of Array.from(sr.querySelectorAll(".dc-sapi-inline,.dc-tapi-inline"))) { try { old.remove(); } catch (e) {} }
    } catch (e) {}

    const tableMap = buildTableMap();
    if (!tableMap.size) return;
    const rawDmo = tableSelectedDmo();
    // resolve "__LABEL__:X" placeholder — means we detected the label but couldn't
    // map to an API name; filter loosely by checking entry dmo contains the label
    const selectedDmo = (rawDmo && rawDmo.startsWith("__LABEL__:")) ? null : rawDmo;
    const selectedDmoLabel = (rawDmo && rawDmo.startsWith("__LABEL__:")) ? rawDmo.slice(10) : null;

    let rows; try { rows = Array.from(sr.querySelectorAll("tr")); } catch (e) { return; }
    for (const row of rows) {
      // source span lives inside <th>
      let srcSpan = null; try { srcSpan = row.querySelector("span.source-field"); } catch (e) {}
      if (!srcSpan) continue;
      const srcNorm = (srcSpan.textContent || "").trim();
      if (!srcNorm) continue;

      const allEntries = tableMap.get(srcNorm) || [];
      // filter to current DMO for the TARGET side
      let entries;
      if (selectedDmo) {
        entries = allEntries.filter((e) => e.dmo === selectedDmo);
      } else if (selectedDmoLabel) {
        const ll = selectedDmoLabel.toLowerCase().replace(/\s+/g, "");
        entries = allEntries.filter((e) => e.dmo.toLowerCase().replace(/_/g, "").indexOf(ll) >= 0);
      } else {
        entries = allEntries;
      }

      // SOURCE API name: use full fieldName from mapping if available,
      // otherwise the span text is already the field name base — show it as-is.
      // This means ALL rows get a source annotation, not just mapped ones.
      const srcFull = entries.length ? entries[0].srcFull
                    : allEntries.length ? allEntries[0].srcFull
                    : srcNorm;  // span text is best-effort for unmapped fields

      // TARGET API name: only for rows mapped under current DMO
      const tgtNames = entries.length ? Array.from(new Set(entries.map((e) => e.tgt))) : [];
      const tgtText  = tgtNames.join(" | ");

      let th = null; try { th = row.querySelector("th"); } catch (e) {}
      let tds; try { tds = Array.from(row.querySelectorAll("td")); } catch (e) { tds = []; }
      const lastTd = tds.length ? tds[tds.length - 1] : null;

      // ── hover mode: always tag th; only tag lastTd when mapped ──
      if (state.on) {
        if (th) {
          th.dcApiName = srcFull;
          try { th.setAttribute("data-dc-api-name", srcFull); th.style.setProperty("cursor", "help", "important"); } catch (e) {}
        }
        if (lastTd && tgtText) {
          lastTd.dcApiName = tgtText;
          try { lastTd.setAttribute("data-dc-api-name", tgtText); lastTd.style.setProperty("cursor", "help", "important"); } catch (e) {}
        }
      }

      // ── inline mode: always inject source span; only inject target when mapped ──
      if (state.inline) {
        const mkSpan = (cls, text, color) => {
          const sp = document.createElement("span");
          sp.className = cls; sp.textContent = text;
          const s = (p, v) => { try { sp.style.setProperty(p, v, "important"); } catch (e) {} };
          s("display", "block"); s("font-family", "'SF Mono',Menlo,Consolas,monospace");
          s("font-size", "10px"); s("color", color); s("margin-top", "3px");
          s("white-space", "nowrap"); s("overflow", "hidden"); s("text-overflow", "ellipsis");
          s("max-width", "100%"); s("user-select", "text"); s("-webkit-user-select", "text");
          try { sp.setAttribute("title", text); } catch (e) {}
          return sp;
        };
        // source API name below the field name in <th> — ALL rows
        if (th) th.appendChild(mkSpan("dc-sapi-inline", srcFull, "#4a6fa5"));
        // target API name below combobox in last <td> — mapped rows only
        if (lastTd && tgtText) lastTd.appendChild(mkSpan("dc-tapi-inline", tgtText, "#4a6fa5"));
      }
    }
  }

  // Build export rows from container.mapping[] for the table view.
  // Honours the currently selected DMO (same filter as tableRedraw).
  function buildTableViewRows() {
    const container = findByTag(TAGGING_CMP).find(isVisible) || findByTag(TAGGING_CMP)[0];
    if (!container) return [];
    const raw = safeGet(container, "mapping");
    if (!Array.isArray(raw)) return [];

    const rawDmo = tableSelectedDmo();
    const selectedDmo = (rawDmo && rawDmo.startsWith("__LABEL__:")) ? null : rawDmo;
    const selectedDmoLabel = (rawDmo && rawDmo.startsWith("__LABEL__:")) ? rawDmo.slice(10) : null;

    // Build DMO label map from entity selector items
    const { labelToApi } = tableEntitySelectorInfo();
    const dmoLabels = new Map();
    for (const [label, api] of labelToApi) dmoLabels.set(api, label);

    // DLO label from source-list <th>
    let dloLabel = "";
    const tableCmp = findByTag(TABLE_CMP).find(isVisible);
    if (tableCmp) {
      let tsr = null; try { tsr = tableCmp.shadowRoot; } catch (e) {}
      if (tsr) {
        let srcTh = null; try { srcTh = tsr.querySelector("th.source-list"); } catch (e) {}
        if (srcTh) dloLabel = (srcTh.textContent || "").trim().replace(/\s*\(\d+\)\s*$/, "");
      }
    }

    const rows = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const src = safeGet(item, "source"); const tgt = safeGet(item, "target");
      if (!src || !tgt) continue;
      const srcEntity = safeGet(src, "entityName") || "";
      const srcField  = safeGet(src, "fieldName")  || "";
      const tgtEntity = safeGet(tgt, "entityName") || "";
      const tgtField  = safeGet(tgt, "fieldName")  || "";
      if (!srcField || !tgtField) continue;
      // DMO filter
      if (selectedDmo && tgtEntity !== selectedDmo) continue;
      if (selectedDmoLabel) {
        const ll = selectedDmoLabel.toLowerCase().replace(/\s+/g, "");
        if (tgtEntity.toLowerCase().replace(/_/g, "").indexOf(ll) < 0) continue;
      }
      rows.push({
        srcObj: srcEntity, srcObjLabel: dloLabel || srcEntity,
        sourceLabel: srcField, sourceApi: srcField, sourceType: "",
        dmo: tgtEntity, dmoLabel: dmoLabels.get(tgtEntity) || tgtEntity,
        targetLabel: tgtField, targetApi: tgtField, targetType: "",
      });
    }
    return rows;
  }

  // Returns true when the TABLE view is active and visible.
  // Canvas has visible ITEM rows; table view has TABLE_CMP but no visible ITEMs.
  // Using both conditions makes this reliable even when Lightning keeps cached
  // hidden views in the DOM alongside the active one.
  function isTableView() {
    if (findByTag(ITEM).some(isVisible)) return false;  // canvas is active
    const t = findByTag(TABLE_CMP);
    for (const el of t) {
      try {
        if (el.isConnected === false) continue;
        const r = el.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) return true;
      } catch (e) {}  // no fallback-true — if rect throws, treat as not visible
    }
    return false;
  }

  // ---------- main redraw ----------
  // `on` starts FALSE: inline names are opt-in (user clicks "Show API names").
  // This keeps a freshly-loaded / newly-navigated page clean until requested.
  const state = { on: false, inline: false, srcDone: 0, tgtDone: 0, tgtMiss: 0 };

  function redraw() {
    if (!state.on && !state.inline) return;
    // SOURCE: there can be MULTIPLE source entities (each its own
    // <runtime_cdp-data-stream-attribute-list>), each possibly with multiple
    // sections (Is Mapped / Unmapped). Handle EACH list independently, scoping
    // rows to it. For EACH list, prefer matching BY LABEL via that list's
    // `.entity.fields[]` (section-order-proof, same as the DMO side); fall back
    // to order-zipping the attribute-name API names only if that data is absent.
    let sd = 0, srcCount = 0, apiTotal = 0;
    const pairs = [];
    const NON_FIELD_S = /^(Add New Field|Unmapped|Is Mapped|Mapped|Show more|Show less)\b/i;
    const NON_FIELD_TID_S = /^(add-new-field-btn|.*-btn|entity-list|search-input|main-container)$/i;
    for (const listEl of findByTag(SRC_LIST)) {
      const { map, labelNames } = entityFieldMap(listEl); // label -> apiName + label -> [all apis]
      const attrApis = attrApiNames(listEl);           // ordered fallback
      apiTotal += (map.size || attrApis.length);
      // rows that belong to THIS list (nearest attribute-list ancestor is it)
      const rows = findByTag(ITEM).filter((it) => {
        if (ancestorOfTag(it, SRC_LIST) !== listEl) return false;
        const t = labelOf(it);
        return t && !HEADER.test(t) && !NON_FIELD_S.test(t) && !NON_FIELD_TID_S.test(t);
      });
      const useLabels = map.size > 0;
      // Per-label cursor: when a label maps to MULTIPLE fields (e.g. three
      // "Account Number"), hand each rendered row the NEXT distinct API for that
      // label in field order, instead of all rows getting the first (old bug).
      // For a UNIQUE label this is identical to lookupByLabel(map,label).
      const labelCursor = new Map();
      const nextForLabel = (label) => {
        // exact, then whitespace-normalised match against labelNames keys
        let arr = labelNames.get(label);
        if (!arr) {
          const norm = String(label).replace(/\s+/g, " ").trim();
          for (const [k, v] of labelNames) { if (String(k).replace(/\s+/g, " ").trim() === norm) { arr = v; label = k; break; } }
        }
        if (!arr || !arr.length) return null;
        const used = labelCursor.get(label) || 0;
        const idx = used < arr.length ? used : arr.length - 1; // clamp; never overrun
        labelCursor.set(label, used + 1);
        return arr[idx];
      };
      for (let i = 0; i < rows.length; i++) {
        const label = labelOf(rows[i]);
        // by label (robust, collision-aware) if available, else positional attribute name
        const name = useLabels ? nextForLabel(label) : attrApis[i];
        if (!name) continue;
        srcCount++;
        if (pairs.length < 300) pairs.push([label, name]);
        if (state.on && decorate(rows[i], name)) sd++;
        if (state.inline) inlineDecorate(rows[i], name);
      }
    }
    state.srcDone = sd;
    state.srcCount = srcCount; state.apiCount = apiTotal;
    state.srcPairs = pairs; // [label, apiName] for verifying alignment

    // ENTITY HEADERS (source DLOs): only for HOVER mode. Inline mode is
    // fields-only (header decoration reflows a different wrapper and distorts
    // the canvas), so we never inject inline text into headers.
    let hdrDone = 0;
    if (state.on) {
      for (const listEl of findByTag(SRC_CONTAINER)) {
        const { entityName } = entityFieldMap(listEl);
        if (entityName && decorateHeader(listEl, entityName)) hdrDone++;
      }
    }

    // TARGET: per DMO list, read entity.fields[] (label->name) and decorate
    // each rendered row by matching its label WITHIN THAT SAME LIST. Scoping
    // per list is what disambiguates same-label fields across different DMOs.
    let td = 0, miss = 0, tgtCount = 0;
    const tgtPairs = [];
    const tgtMissLabels = [];
    // Rows that are UI affordances, not fields — they have no API name and
    // should not count as misses. Matches both display labels ("Add New Field",
    // "Unmapped (n)") AND internal data-tid ids ("add-new-field-btn").
    const NON_FIELD = /^(Add New Field|Unmapped|Is Mapped|Mapped|Show more|Show less)\b/i;
    const NON_FIELD_TID = /^(add-new-field-btn|.*-btn|entity-list|search-input|main-container)$/i;
    for (const { listEl, map, entityName } of targetLists()) {
      // entity header (DMO title) -> hover mode only (fields-only for inline)
      if (state.on && entityName && decorateHeader(listEl, entityName)) hdrDone++;
      const items = itemsUnder(listEl).filter((it) => {
        const t = labelOf(it);
        return t && !HEADER.test(t) && !NON_FIELD.test(t) && !NON_FIELD_TID.test(t);
      });
      for (const it of items) {
        tgtCount++;
        const label = labelOf(it);
        const name = lookupByLabel(map, label);
        if (name) {
          if (state.on && decorate(it, name)) td++;
          if (state.inline) inlineDecorate(it, name);
          if (tgtPairs.length < 300) tgtPairs.push([entityName, label, name]);
        } else {
          miss++;
          if (tgtMissLabels.length < 40) tgtMissLabels.push([entityName, label]);
        }
      }
    }
    state.tgtDone = td; state.tgtMiss = miss; state.tgtCount = tgtCount;
    state.tgtPairs = tgtPairs;
    state.tgtMissLabels = tgtMissLabels;
    state.hdrDone = hdrDone;

    // TABLE VIEW: decorate rows with source + target API names.
    // Only runs when the table component is actually visible; canvas is unaffected.
    if (isTableView()) tableRedraw();

    updateBadge();
    // Inline names are ABSOLUTELY POSITIONED (out of flow): they don't change
    // row height, so the ◉ dots don't move and the canvas connector lines are
    // unaffected — no resize/reflow nudge needed.
  }

  // ---------- observe for re-renders ----------
  // A MutationObserver on documentElement does NOT see changes inside shadow
  // roots (the boundary blocks observation), and LWC renders these rows inside
  // shadow DOM. So expanding "Unmapped (n)" / scrolling adds rows the observer
  // never catches. We therefore ALSO poll: redraw() is idempotent (skips
  // already-correct rows), so a light periodic re-scan picks up any newly
  // rendered rows — mapped or unmapped — reliably.
  const anyOn = () => state.on || state.inline;
  let timer = null;
  function schedule() { if (timer) return; timer = setTimeout(() => { timer = null; if (anyOn()) redraw(); }, 250); }
  const mo = new MutationObserver(schedule);
  let poll = null;
  function observe() {
    try { mo.observe(document.documentElement, { subtree: true, childList: true, attributes: false }); } catch (e) {}
    if (!poll) poll = setInterval(() => { if (anyOn()) redraw(); }, 1200);
  }
  function unobserve() {
    if (anyOn()) return; // keep observing while EITHER mode is active
    try { mo.disconnect(); } catch (e) {}
    if (poll) { clearInterval(poll); poll = null; }
  }

  // Detect in-app navigation (SPA route change) and turn BOTH modes off so a
  // newly-opened data stream loads clean — the user re-enables when they want.
  let lastUrl = "";
  try { lastUrl = location.href; } catch (e) {}
  let navPoll = null;
  function watchNavigation() {
    navPoll = setInterval(() => {
      let u = ""; try { u = location.href; } catch (e) {}
      if (u !== lastUrl) {
        lastUrl = u;
        if (anyOn()) { state.on = false; state.inline = false; clearTags(); clearInline(); unobserve(); updateBadge(); }
        // On detail pages the launcher must disappear when the user navigates away.
        teardown();
      }
    }, 800);
  }

  // Reflects current state onto both toggle buttons (if present).
  function updateBadge() {
    state.summary = "hover:" + (state.on ? "on" : "off") + " inline:" + (state.inline ? "on" : "off");
    const tooltipIcon = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor'><circle cx='8' cy='8' r='3'/><path d='M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41'/></svg>";
    const pinIcon    = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor'><rect x='1' y='3' width='14' height='2' rx='1'/><rect x='1' y='7' width='10' height='2' rx='1'/><rect x='1' y='11' width='12' height='2' rx='1'/></svg>";
    const t = document.getElementById("dc-toggle-btn");
    if (t) {
      const on = state.on;
      t.dataset.active = on ? "1" : "";
      const lbl = t.querySelector(".dc-lbl");
      if (lbl) lbl.textContent = on ? "Tooltip: ON" : "API Tooltip";
      t.style.setProperty("background", on ? "#0d6efd" : "#111827", "important");
      t.style.setProperty("color", on ? "#fff" : "#fff", "important");
      t.style.setProperty("box-shadow", on ? "0 2px 10px rgba(13,110,253,.35)" : "none", "important");
      t.style.setProperty("opacity", "1", "important");   // clear any "busy" dim
    }
    const i = document.getElementById("dc-inline-btn");
    if (i) {
      const on = state.inline;
      i.dataset.active = on ? "1" : "";
      const lbl = i.querySelector(".dc-lbl");
      if (lbl) lbl.textContent = on ? "Unpin names" : "Pin API names";
      i.style.setProperty("background", on ? "#0d6efd" : "#111827", "important");
      i.style.setProperty("color", on ? "#fff" : "#fff", "important");
      i.style.setProperty("box-shadow", on ? "0 2px 10px rgba(13,110,253,.35)" : "none", "important");
      i.style.setProperty("opacity", "1", "important");   // clear any "busy" dim
    }
  }

  // Busy guard: the heavy work is redraw() (walks shadow DOM + decorates many rows),
  // which blocks the main thread. Without this, a user who doesn't see instant feedback
  // clicks AGAIN — and the second click toggles the mode back OFF (the reported bug).
  // While busy we ignore re-clicks and show a "working…" label; the button reflects the
  // new state BEFORE the heavy work by deferring redraw to the next frame (so it paints).
  let _busyToggle = false;
  function afterPaint(fn) {
    // double-rAF (or timeout fallback) guarantees the label repaint lands first.
    try { requestAnimationFrame(function () { requestAnimationFrame(fn); }); }
    catch (e) { setTimeout(fn, 16); }
  }
  function setBtnBusy(id, msg) {
    const b = document.getElementById(id); if (!b) return;
    const lbl = b.querySelector(".dc-lbl"); if (lbl) lbl.textContent = msg;
    b.style.setProperty("opacity", "0.75", "important");
  }

  // The two modes are MUTUALLY EXCLUSIVE — only one active at a time.
  function toggle() {  // hover mode
    if (_busyToggle) return;                       // ignore rapid re-clicks while working
    state.on = !state.on;
    updateBadge();                                 // reflect new state immediately
    if (state.on) {
      if (state.inline) { state.inline = false; clearInline(); }
      _busyToggle = true; setBtnBusy("dc-toggle-btn", "Working…");
      afterPaint(function () {
        try { bindHover(); redraw(); observe(); } catch (e) {}
        _busyToggle = false; updateBadge();
      });
    } else { clearTags(); unobserve(); }
  }
  function toggleInline() {  // visible + searchable inline "Pin API names" mode
    if (_busyToggle) return;                       // ignore rapid re-clicks while working
    state.inline = !state.inline;
    updateBadge();                                 // button flips to "Unpin names" NOW
    if (state.inline) {
      if (state.on) { state.on = false; clearTags(); }
      _busyToggle = true; setBtnBusy("dc-inline-btn", "Pinning…");
      // Defer the heavy pin pass so the button visibly changes first (no "did it work?"
      // confusion), then re-label with a brief count so the user knows it finished.
      afterPaint(function () {
        try { redraw(); observe(); } catch (e) {}
        _busyToggle = false; updateBadge();
        const b = document.getElementById("dc-inline-btn");
        const lbl = b && b.querySelector(".dc-lbl");
        if (lbl) {
          const n = (state.srcDone || 0) + (state.tgtDone || 0);
          lbl.textContent = n > 0 ? ("Pinned " + n) : "Unpin names";
          if (n > 0) setTimeout(function () { if (state.inline && lbl) lbl.textContent = "Unpin names"; }, 1400);
        }
      });
    } else { clearInline(); unobserve(); }
  }

  // ---------- report target-side diagnosis to an on-page box ----------
  function showDiag() {
    const rep = {
      source: { apiNamesInDom: state.apiCount, fieldRows: state.srcCount, decorated: state.srcDone },
      sourcePairs: state.srcPairs || [],
      target: { fieldRows: state.tgtCount, decorated: state.tgtDone, missing: state.tgtMiss },
      targetPairs: (state.tgtPairs || []).slice(0, 40),
      targetMissLabels: state.tgtMissLabels || [],
    };
    // Only surface a small hint box if NOTHING decorated (likely not on the
    // mapping canvas). Silent otherwise — no console output.
    if (state.srcDone === 0 && state.tgtDone === 0) {
      try {
        const old = document.getElementById("dc-decor-diag"); if (old) old.remove();
        const wrap = document.createElement("div");
        wrap.id = "dc-decor-diag";
        wrap.style.cssText = "position:fixed;inset:auto 16px 60px auto;z-index:2147483647;width:560px;max-width:94vw;background:#fff;border:2px solid #6b1f9a;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.3);font:12px -apple-system,sans-serif";
        const bar = document.createElement("div");
        bar.style.cssText = "display:flex;align-items:center;padding:8px 10px;background:#6b1f9a;color:#fff;border-radius:6px 6px 0 0";
        bar.innerHTML = "<strong style='flex:1'>No fields found — open a DLO&rarr;DMO mapping page.</strong>";
        const close = document.createElement("button"); close.textContent = "✕";
        close.style.cssText = "border:none;background:transparent;color:#fff;font-size:16px;cursor:pointer"; close.onclick = () => wrap.remove();
        bar.appendChild(close);
        const ta = document.createElement("textarea");
        ta.value = JSON.stringify(rep, null, 2);
        ta.style.cssText = "width:100%;height:300px;border:none;padding:8px;font:11px 'SF Mono',Menlo,monospace;box-sizing:border-box;resize:vertical";
        ta.onclick = () => ta.select();
        wrap.appendChild(bar); wrap.appendChild(ta); document.body.appendChild(wrap); ta.select();
      } catch (e) {}
    }
  }

  // ================= EXPORT / LIST VIEW =================
  // Returns rows: { srcObj, srcObjLabel, sourceLabel, sourceApi, dmo, dmoLabel, targetLabel, targetApi }
  // In canvas view: reads TGT_CONTAINER entity.fields[] (label+api, isMapped filter).
  // In table view:  reads container.mapping[] directly (already has API names).
  function buildMappingRows() {
    if (isTableView()) return buildTableViewRows();

    // ── Authoritative source-API resolver (fixes label-collision bug) ──────────
    // The target field only exposes sourceLabel, so resolving the source API by
    // LABEL breaks when a DLO has several fields sharing one label (e.g. three
    // "Account Number" fields). The tagging container's mapping[] array carries
    // the EXACT source.fieldName -> target.fieldName pairing (same data the table
    // view uses), so we key on it FIRST and fall back to label only if absent.
    //   key: dmoApi + "::" + targetApi  ->  { srcObj, sourceApi }
    const exactByTarget = new Map();
    try {
      const cont = findVisibleByTag(TAGGING_CMP)[0] || findByTag(TAGGING_CMP)[0];
      const rawMap = cont && safeGet(cont, "mapping");
      if (Array.isArray(rawMap)) {
        for (const it of rawMap) {
          if (!it || typeof it !== "object") continue;
          const src = safeGet(it, "source"), tgt = safeGet(it, "target");
          if (!src || !tgt) continue;
          const tEnt = safeGet(tgt, "entityName") || "", tFld = safeGet(tgt, "fieldName") || "";
          const sEnt = safeGet(src, "entityName") || "", sFld = safeGet(src, "fieldName") || "";
          if (tFld && sFld) exactByTarget.set(tEnt + "::" + tFld, { srcObj: sEnt, sourceApi: sFld });
        }
      }
    } catch (e) {}

    // label -> {api, dlo, dloLabel}, across all source entities. Also keep the
    // set of source object labels so we can attribute nested labels like
    // "cartItem.currency" (prefix "cartItem" = the source object).
    // labelCounts tracks colliding labels so the fallback can flag ambiguity
    // instead of silently returning the first match (the old bug).
    const byLabel = new Map();
    const labelCounts = new Map();
    const objByLabel = new Map(); // source-object label -> {name,label}
    for (const listEl of findVisibleByTag(SRC_CONTAINER)) {
      let ent = null; try { ent = listEl.entity; } catch (e) {}
      const dlo = (ent && safeGet(ent, "name")) || "";
      const dloLabel = (ent && safeGet(ent, "label")) || "";
      if (dloLabel) objByLabel.set(dloLabel, { name: dlo, label: dloLabel });
      const { map, typeMap } = entityFieldMap(listEl);
      for (const [label, name] of map) {
        labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
        if (!byLabel.has(label)) byLabel.set(label, { api: name, dlo: dlo, dloLabel: dloLabel, type: typeMap.get(label) || "" });
      }
    }
    // resolve -> {sourceApi, srcObj, srcObjLabel, sourceType}
    // Prefer the EXACT mapping[] pairing (keyed by DMO+target field). Only if the
    // container didn't expose mapping[] do we fall back to matching by label.
    function resolveSource(sourceLabel, dmoApi, targetApi) {
      // 1) authoritative: exact source.fieldName for this target field
      const exact = (dmoApi && targetApi) ? exactByTarget.get(dmoApi + "::" + targetApi) : null;
      if (exact) {
        const dloLabel = objByLabel.get(exact.srcObj) ? exact.srcObj : "";
        // find the source object's display label if we have it
        let srcObjLabel = exact.srcObj;
        for (const [lbl, o] of objByLabel) { if (o.name === exact.srcObj) { srcObjLabel = o.label; break; } }
        // recover type from byLabel if the label is unique
        const meta = byLabel.get(sourceLabel);
        const type = (meta && labelCounts.get(sourceLabel) === 1) ? meta.type : "";
        return { sourceApi: exact.sourceApi, srcObj: exact.srcObj, srcObjLabel: srcObjLabel, sourceType: type };
      }
      // 2) fallback: match by label (only reached if mapping[] wasn't exposed)
      const hit = byLabel.get(sourceLabel);
      if (hit) {
        return { sourceApi: hit.api, srcObj: hit.dlo, srcObjLabel: hit.dloLabel, sourceType: hit.type };
      }
      // nested "obj.field" — attribute to the object by its prefix
      const dot = sourceLabel.indexOf(".");
      if (dot > 0) {
        const prefix = sourceLabel.slice(0, dot);
        const obj = objByLabel.get(prefix);
        if (obj) return { sourceApi: "", srcObj: obj.name, srcObjLabel: obj.label, sourceType: "" };
      }
      return { sourceApi: "", srcObj: "", srcObjLabel: "", sourceType: "" };
    }
    const rows = [];
    for (const listEl of findVisibleByTag(TGT_CONTAINER)) {
      let entity = null; try { entity = listEl.entity; } catch (e) {}
      if (!entity) continue;
      const dmo = safeGet(entity, "name") || "";
      const dmoLabel = safeGet(entity, "label") || "";
      const fields = safeGet(entity, "fields");
      if (!fields || typeof fields.length !== "number") continue;
      for (let i = 0; i < fields.length; i++) {
        const f = safeGet(fields, i); if (!f) continue;
        const mapped = !!safeGet(f, "isMapped") || !!safeGet(f, "isMappedFromDb") || !!safeGet(f, "isMappedFromAgent");
        if (!mapped) continue;
        const sourceLabel = safeGet(f, "sourceLabel") || "";
        const targetApi = safeGet(f, "name") || "";
        const s = resolveSource(sourceLabel, dmo, targetApi);
        rows.push({
          srcObj: s.srcObj, srcObjLabel: s.srcObjLabel,
          sourceLabel: sourceLabel, sourceApi: s.sourceApi, sourceType: s.sourceType || "",
          dmo, dmoLabel,
          targetLabel: safeGet(f, "label") || "",
          targetApi: targetApi,
          targetType: (function () { const t = safeGet(f, "type"); return t == null ? "" : String(t); })(),
        });
      }
    }
    return rows;
  }

  // Ordered SOURCE (DLO) -> TARGET (DMO), the way data flows.
  const EXPORT_COLS = [
    ["srcObj", "Source Object (DLO)"],
    ["sourceLabel", "Source Field (label)"], ["sourceApi", "Source Field API"], ["sourceType", "Source Type"],
    ["dmo", "Target Object (DMO)"],
    ["targetLabel", "Target Field (label)"], ["targetApi", "Target Field API"], ["targetType", "Target Type"],
  ];
  function rowsToTable(rows, sep) {
    const esc = sep === "," ? (s) => (/[",\n]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s) : (s) => String(s).replace(/\t/g, " ");
    const head = EXPORT_COLS.map((c) => c[1]).join(sep);
    const body = rows.map((r) => EXPORT_COLS.map((c) => esc(r[c[0]] == null ? "" : r[c[0]])).join(sep)).join("\n");
    return head + "\n" + body;
  }

  // Make an element draggable by a handle (pointer-based; sets left/top).
  function makeDraggable(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    const down = (e) => {
      // ignore drags that start on interactive controls or selectable text
      const tg = e.target;
      if (tg && tg.closest && tg.closest("button,select,input,textarea,a,[style*='user-select:text'],.dc-ac-sub")) return;
      if (tg && window.getComputedStyle(tg).userSelect === "text") return;
      dragging = true;
      const r = el.getBoundingClientRect();
      // pin to left/top and drop any centering transform
      el.style.setProperty("left", r.left + "px", "important");
      el.style.setProperty("top", r.top + "px", "important");
      el.style.setProperty("right", "auto", "important");
      el.style.setProperty("bottom", "auto", "important");
      el.style.setProperty("transform", "none", "important");
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };
    const move = (e) => {
      if (!dragging) return;
      let nx = ox + (e.clientX - sx), ny = oy + (e.clientY - sy);
      // keep on-screen
      const w = el.offsetWidth || 200, h = 40;
      nx = Math.max(4, Math.min(nx, window.innerWidth - Math.min(w, 120)));
      ny = Math.max(4, Math.min(ny, window.innerHeight - h));
      el.style.setProperty("left", nx + "px", "important");
      el.style.setProperty("top", ny + "px", "important");
    };
    const up = () => { dragging = false; window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); };
    handle.style.cursor = "move";
    handle.addEventListener("pointerdown", down, true);
  }

  function addResizeHandle(el, minW, minH) {
    minW = minW || 340; minH = minH || 240;
    const rsz = document.createElement("div");
    rsz.style.cssText = "position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:se-resize;z-index:10;background:transparent";
    rsz.innerHTML = "<svg width='12' height='12' viewBox='0 0 12 12' style='position:absolute;right:3px;bottom:3px;opacity:.35'><path d='M2 10h8M6 6h4M10 2v8' stroke='#5c6b8a' stroke-width='1.5' stroke-linecap='round'/></svg>";
    el.appendChild(rsz);
    let rsx=0, rsy=0, rw=0, rh=0, resizing=false;
    rsz.addEventListener("pointerdown", (e) => {
      e.stopPropagation(); e.preventDefault();
      resizing=true; rsz.setPointerCapture(e.pointerId);
      const r2 = el.getBoundingClientRect();
      rsx=e.clientX; rsy=e.clientY; rw=r2.width; rh=r2.height;
      el.style.transform="none";
      el.style.left = r2.left+"px"; el.style.top = r2.top+"px";
    });
    rsz.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      const nw = Math.max(minW, rw + (e.clientX - rsx));
      const nh = Math.max(minH, rh + (e.clientY - rsy));
      el.style.width  = Math.min(nw, window.innerWidth  - 20) + "px";
      el.style.height = Math.min(nh, window.innerHeight - 20) + "px";
    });
    rsz.addEventListener("pointerup", () => { resizing=false; });
  }

  let exportEl = null;
  let onDocDown = null, onKey = null;
  function closeExport() {
    if (exportEl) { exportEl.remove(); exportEl = null; }
    if (onDocDown) { document.removeEventListener("pointerdown", onDocDown, true); onDocDown = null; }
    if (onKey) { document.removeEventListener("keydown", onKey, true); onKey = null; }
    hideBackdrop();
  }
  function openExport() {
    // Rebuild fresh from the CURRENT (visible) page each time it opens.
    let allRows = buildMappingRows();
    let dmos = Array.from(new Set(allRows.map((r) => r.dmo))).sort();
    let filter = "__ALL__";

    if (!exportEl) { exportEl = document.createElement("div"); document.body.appendChild(exportEl); }
    exportEl.id = "dc-export";
    exportEl.style.cssText = "position:fixed;top:5vh;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(1000px,94vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;color:#16325c;border:1px solid #c9cede;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.5);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden";

    // Close on click OUTSIDE the modal (ignore clicks on the launcher button so
    // it doesn't immediately reopen/close), and on Escape.
    if (!onDocDown) {
      onDocDown = (e) => {
        if (!exportEl) return;
        const t = e.target;
        if (exportEl.contains(t)) return;
        if (t && t.closest && t.closest("#dc-export-btn")) return;
        closeExport();
      };
      document.addEventListener("pointerdown", onDocDown, true);
    }
    if (!onKey) {
      onKey = (e) => { if (e.key === "Escape") closeExport(); };
      document.addEventListener("keydown", onKey, true);
    }

    function render() {
      const rows = filter === "__ALL__" ? allRows : allRows.filter((r) => r.dmo === filter);
      const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      const opts = ['<option value="__ALL__">All DMOs (' + allRows.length + ")</option>"]
        .concat(dmos.map((d) => '<option value="' + esc(d) + '"' + (d === filter ? " selected" : "") + ">" + esc(d) + " (" + allRows.filter((r) => r.dmo === d).length + ")</option>")).join("");
      const ty = (t) => t ? "<span class='ty'>" + esc(t) + "</span>" : "";
      const trs = rows.map((r) =>
        "<tr>" +
        "<td>" + (esc(r.srcObjLabel) || "<span class='muted'>system</span>") + (r.srcObj ? "<div class='api'>" + esc(r.srcObj) + "</div>" : "") + "</td>" +
        "<td>" + esc(r.sourceLabel) + (r.sourceApi ? "<div class='api'>" + esc(r.sourceApi) + ty(r.sourceType) + "</div>" : "") + "</td>" +
        "<td class='arrow'>&rarr;</td>" +
        "<td>" + esc(r.dmoLabel) + "<div class='api'>" + esc(r.dmo) + "</div></td>" +
        "<td>" + esc(r.targetLabel) + "<div class='api tgt'>" + esc(r.targetApi) + ty(r.targetType) + "</div></td>" +
        "</tr>").join("");
      exportEl.innerHTML =
        "<style>" +
        "#dc-export .hd{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#f3f6fb;border-bottom:1px solid #e0e5ee;flex-shrink:0;flex-wrap:wrap}" +
        "#dc-export .hd strong{font-size:15px;flex-shrink:0}#dc-export select{padding:5px 8px;border:1px solid #c9cede;border-radius:6px;font-size:12px;min-width:0;flex:1 1 120px;max-width:340px}" +
        "#dc-export .sp{flex:1 1 0}#dc-export button{flex-shrink:0;border:1px solid #0b5cab;background:#0b5cab;color:#fff;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer;font-size:12px;white-space:nowrap}" +
        "#dc-export button.sec{background:#fff;color:#0b5cab}#dc-export .x{flex-shrink:0;border:none;background:transparent;color:#5c6b8a;font-size:20px;padding:0 4px;cursor:pointer;line-height:1;margin-left:4px}" +
        "#dc-export .bd{overflow:auto;padding:0;flex:1;min-height:0}" +
        "#dc-export table{border-collapse:collapse;width:100%;font-size:12px}" +
        "#dc-export th{position:sticky;top:0;background:#fff;text-align:left;padding:8px 12px;border-bottom:2px solid #e0e5ee;color:#5c6b8a;font-size:11px;text-transform:uppercase;letter-spacing:.03em}" +
        "#dc-export td{padding:7px 12px;border-bottom:1px solid #eef1f6;vertical-align:top}" +
        "#dc-export td .api{font:11px 'SF Mono',Menlo,monospace;color:#0b5cab;margin-top:1px;word-break:break-all}" +
        "#dc-export td .api.tgt{color:#6b1f9a}" +
        "#dc-export td .ty{display:inline-block;margin-left:6px;padding:0 5px;border-radius:8px;background:#eef1f6;color:#5c6b8a;font:10px/1.6 -apple-system,sans-serif}" +
        "#dc-export td.arrow{color:#8a94ab;text-align:center;font-size:14px;width:20px}" +
        "#dc-export .muted{color:#b0b7c6;font-style:italic}" +
        "#dc-export .ft{padding:8px 16px;border-top:1px solid #e0e5ee;color:#8a94ab;font-size:11px;background:#f9fafc}" +
        "</style>" +
        "<div class='hd'><strong>Mappings: DLO&nbsp;&rarr;&nbsp;DMO</strong>" +
        "<select id='dc-x-dmo'>" + opts + "</select>" +
        "<span class='sp'></span>" +
        "<button id='dc-x-copy'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy for Sheets</button>" +
        "<button class='sec' id='dc-x-csv'>Download CSV</button>" +
        "<button class='x' id='dc-x-close'>&times;</button></div>" +
        "<div class='bd'><table><thead><tr><th>Source object (DLO)</th><th>Source field</th><th></th><th>Target object (DMO)</th><th>Target field</th></tr></thead><tbody>" +
        (trs || "<tr><td colspan='5' style='padding:24px;text-align:center;color:#8a94ab'>No mapped fields found.</td></tr>") +
        "</tbody></table></div>" +
        "<div class='ft'>" + rows.length + " mapping(s)" + (filter === "__ALL__" ? " across " + dmos.length + " DMO(s)" : "") + " · reads DLO&rarr;DMO · source API/object blank = system field (Data Source, Key Qualifier, etc.)</div>";
      exportEl.querySelector("#dc-x-close").onclick = closeExport;
      exportEl.querySelector("#dc-x-dmo").onchange = (e) => { filter = e.target.value; render(); };
      // header is the drag handle (buttons/select inside are ignored by makeDraggable)
      const hd = exportEl.querySelector(".hd"); if (hd) makeDraggable(exportEl, hd);
      addResizeHandle(exportEl, 480, 300);
      exportEl.querySelector("#dc-x-copy").onclick = (e) => {
        navigator.clipboard.writeText(rowsToTable(rows, "\t")).then(() => { e.target.textContent = "✓ Copied!"; setTimeout(() => (e.target.innerHTML = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy for Sheets"), 1200); }).catch(() => {});
      };
      exportEl.querySelector("#dc-x-csv").onclick = () => {
        try {
          const blob = new Blob([rowsToTable(rows, ",")], { type: "text/csv" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          // Name the file after the actual DLO/DMO(s) in view, e.g.
          //   one DLO → one DMO : "<DLO>_to_<DMO>_DLO-to-DMO-mapping.csv"
          //   many DLOs → one DMO: "<DMO>_DLO-to-DMO-mapping.csv"
          //   one DLO → many DMOs: "<DLO>_DLO-to-DMO-mapping.csv"
          //   otherwise          : "DLO-to-DMO-mapping.csv"
          const clean = (s) => String(s == null ? "" : s).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
          const srcObjs = Array.from(new Set(rows.map(r => r.srcObjLabel || r.srcObj).filter(Boolean)));
          const tgtObjs = Array.from(new Set(rows.map(r => r.dmoLabel || r.dmo).filter(Boolean)));
          let namePart;
          if (srcObjs.length === 1 && tgtObjs.length === 1) namePart = clean(srcObjs[0]) + "_to_" + clean(tgtObjs[0]);
          else if (tgtObjs.length === 1) namePart = clean(tgtObjs[0]);
          else if (srcObjs.length === 1) namePart = clean(srcObjs[0]);
          else namePart = "";
          a.download = (namePart ? namePart + "_" : "") + "DLO-to-DMO-mapping.csv";
          document.body.appendChild(a); a.click(); a.remove();
        } catch (e) {}
      };
    }
    render();
  }

  // Fully remove the tool from the page: inline names off, tooltip + tags gone,
  // export modal closed, control bar removed, timers stopped. Re-running the
  // bookmarklet/snippet re-creates everything.
  function teardown() {
    try { state.on = false; state.inline = false; unobserve(); } catch (e) {}
    try { clearTags(); clearInline(); } catch (e) {}  // tooltip + tags + inline spans
    try { closeExport(); } catch (e) {}    // closes mapping/segment modal + its listeners
    // Close in-dev Data Explorer surfaces too (guarded — stripped from public build).
    try { if (typeof closeExploreModal === "function") closeExploreModal(); } catch (e) {}
    try { if (typeof closeAllColumnsTable === "function") closeAllColumnsTable(); } catch (e) {}
    try { if (typeof closeSoqlEditor === "function") closeSoqlEditor(); } catch (e) {}
    // Backstop: remove any of our modal roots by id, in case a close handle went stale.
    try {
      ["dc-explore-modal", "dc-allcols-table", "dc-export", "dc-detail-export", "dc-hide-overlay"].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.remove();
      });
    } catch (e) {}
    try { if (navPoll) { clearInterval(navPoll); navPoll = null; } } catch (e) {}
    try { const bar = document.getElementById("dc-bar"); if (bar) bar.remove(); } catch (e) {}
    try { delete window.__DC_DECOR__; } catch (e) { window.__DC_DECOR__ = null; }
  }

  // DRIFT METER: proves whether inline names move the ◉ connector anchors.
  // Measures every field row's dot position with inline OFF, turns it ON,
  // re-measures, and returns the max vertical drift. 0px = names don't move
  // anything → any perceived "break" is line crossing, not our decoration.
  // Usage in console:  __DC_DECOR__.driftMeter()
  function dotRects() {
    // The ◉ dot is the row's mapping socket; measure the row item host's rect
    // top (the dot is vertically centered on the row, so row-top drift == dot drift).
    const out = [];
    const push = (it) => {
      try {
        const label = labelOf(it);
        if (!label || HEADER.test(label)) return;
        const r = it.getBoundingClientRect();
        if (r && (r.width > 0 || r.height > 0)) out.push({ label, top: r.top, mid: r.top + r.height / 2 });
      } catch (e) {}
    };
    findByTag(ITEM).forEach(push);
    return out;
  }
  function driftMeter() {
    const wasInline = state.inline, wasOn = state.on;
    // baseline with EVERYTHING off
    if (state.inline) { state.inline = false; clearInline(); }
    if (state.on) { state.on = false; clearTags(); }
    const before = dotRects();
    const beforeMap = {}; before.forEach((r) => { beforeMap[r.label] = r.mid; });
    // turn inline ON and re-measure
    state.inline = true; redraw();
    const after = dotRects();
    let max = 0, moved = 0; const worst = [];
    after.forEach((r) => {
      if (!(r.label in beforeMap)) return;
      const d = Math.abs(r.mid - beforeMap[r.label]);
      if (d > 0.5) { moved++; worst.push({ label: r.label, drift: Math.round(d * 10) / 10 }); }
      if (d > max) max = d;
    });
    worst.sort((a, b) => b.drift - a.drift);
    // restore prior state
    if (!wasInline) { state.inline = false; clearInline(); }
    if (wasOn) { state.on = true; bindHover(); redraw(); }
    const summary = { rowsMeasured: after.length, rowsMoved: moved, maxDriftPx: Math.round(max * 10) / 10, worst: worst.slice(0, 8) };
    try { console.log("%c[drift-meter] max dot drift: " + summary.maxDriftPx + "px across " + summary.rowsMeasured + " rows (" + moved + " moved)", "color:#0b5cab;font-weight:bold"); if (worst.length) console.table(summary.worst); } catch (e) {}
    return summary;
  }

  // PROBE: dump the REAL structure + computed layout of a field row's label,
  // piercing shadow DOM (plain document.querySelector can't). Used to fix
  // below-label placement precisely instead of guessing. Pass a substring of
  // the field label (e.g. "eventId" for the Primary Key row). Returns the
  // label's tag, its computed display/flex, and each child's tag/text/display.
  //   __DC_DECOR__.probeRow("eventId")
  function probeRow(labelSubstr) {
    const gcs = (el) => { try { return (window.getComputedStyle ? window.getComputedStyle(el) : {}) || {}; } catch (e) { return {}; } };
    const describe = (el) => {
      if (!el) return null;
      const s = gcs(el);
      let cls = ""; try { cls = el.getAttribute && (el.getAttribute("class") || ""); } catch (e) {}
      let txt = ""; try { txt = (el.textContent || "").trim().slice(0, 40); } catch (e) {}
      return { tag: tagOf(el), class: cls, text: txt, display: s.display, flexDir: s.flexDirection, flexWrap: s.flexWrap, position: s.position };
    };
    const matches = findByTag(ITEM).filter((it) => {
      const l = labelOf(it); return l && (!labelSubstr || l.toLowerCase().indexOf(String(labelSubstr).toLowerCase()) >= 0);
    });
    const report = matches.slice(0, 3).map((it) => {
      let sr = null; try { sr = it.shadowRoot; } catch (e) {}
      let labelEl = null; try { labelEl = sr && sr.querySelector("h4.name, h4"); } catch (e) {}
      const kids = [];
      if (labelEl) { try { for (const c of labelEl.children) kids.push(describe(c)); } catch (e) {} }
      let parent = null; try { parent = labelEl && labelEl.parentElement; } catch (e) {}
      return {
        rowLabel: labelOf(it),
        label: describe(labelEl),
        labelChildCount: kids.length,
        labelChildren: kids,
        labelParent: describe(parent),
      };
    });
    try { console.log("%c[probeRow] " + (labelSubstr || "(all)"), "color:#0b5cab;font-weight:bold"); console.log(JSON.stringify(report, null, 2)); } catch (e) {}
    return report;
  }

  // GEOMETRY PROBE: measures the REAL pixel geometry of a row so placement is
  // computed, not guessed. For each matching row it reports the row (.root)
  // rect, the h4 label rect, the label's TEXT rect (via a Range over the text
  // node), and the ◉ dot rect. The key output is `gapBelowTextPx` = how much
  // empty vertical space exists between the bottom of the label text and the
  // bottom of the row — i.e. whether a below-label line can fit WITHOUT growing
  // the row. Run: __DC_DECOR__.probeGeom("eventId")
  function probeGeom(labelSubstr) {
    const R = (el) => { try { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), h: Math.round(r.height), w: Math.round(r.width) }; } catch (e) { return null; } };
    // rect of the actual rendered text inside an element (first text-bearing node)
    const textRect = (el) => {
      try {
        const rng = document.createRange();
        // select the element's text content; if it has child spans, this still
        // bounds the visible glyphs.
        rng.selectNodeContents(el);
        const r = rng.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
      } catch (e) { return null; }
    };
    const matches = findByTag(ITEM).filter((it) => {
      const l = labelOf(it); return l && (!labelSubstr || l.toLowerCase().indexOf(String(labelSubstr).toLowerCase()) >= 0);
    });
    const report = matches.slice(0, 4).map((it) => {
      let sr = null; try { sr = it.shadowRoot; } catch (e) {}
      let root = null, h4 = null, dot = null;
      try { root = sr && sr.querySelector(".root, .normal-border"); } catch (e) {}
      try { h4 = sr && sr.querySelector("h4.name, h4"); } catch (e) {}
      try { dot = sr && sr.querySelector(".mappingTargetIconContainer, [class*='mappingTargetIcon']"); } catch (e) {}
      const rootR = root && R(root), h4R = h4 && R(h4), txtR = h4 && textRect(h4), dotR = dot && R(dot);
      // gap between bottom of the label TEXT and bottom of the ROW
      let gap = null;
      if (rootR && txtR) gap = rootR.bottom - txtR.bottom;
      return {
        rowLabel: labelOf(it),
        rowRect: rootR, rowHeight: rootR && rootR.h,
        labelRect: h4R,
        labelTextRect: txtR,
        dotRect: dotR, dotCenterY: dotR ? Math.round(dotR.top + dotR.h / 2) : null,
        gapBelowTextPx: gap,   // >~12 means a 10px line fits below WITHOUT growing the row
      };
    });
    try { console.log("%c[probeGeom] " + (labelSubstr || "(all)"), "color:#0b5cab;font-weight:bold"); console.table(report.map((r) => ({ row: r.rowLabel, rowH: r.rowHeight, textBottomToRowBottom: r.gapBelowTextPx, dotCenterY: r.dotCenterY }))); console.log(JSON.stringify(report, null, 2)); } catch (e) {}
    return report;
  }

  window.__DC_DECOR__ = { toggle, toggleInline, teardown, redraw, state, targetLists, buildMappingRows, openExport, driftMeter, probeRow, probeGeom, _diag: showDiag,
    tableRedraw, buildTableMap,
    _test: { API_ATTR, HEADER } };

  // Keeps a dragged FAB within the visible viewport when the window resizes
  // (e.g. DevTools opens/closes). Only active after the first drag switches the
  // wrap from right/bottom to left/top positioning.
  function addFabResizeGuard(wrap) {
    window.addEventListener("resize", () => {
      // Only clamp if already in left/top mode (i.e. has been dragged)
      if (wrap.style.right === "auto" || wrap.style.bottom === "auto") {
        const x = parseFloat(wrap.style.left) || 0;
        const y = parseFloat(wrap.style.top)  || 0;
        wrap.style.left = Math.max(4, Math.min(x, window.innerWidth  - 54)) + "px";
        wrap.style.top  = Math.max(4, Math.min(y, window.innerHeight - 54)) + "px";
      }
    });
  }

  // Compact FAB (Floating Action Button) launcher — 44px circle, bottom-right.
  // Click the FAB to expand/collapse the action menu above it.
  // No drag needed: bottom-right never overlaps SF navigation.
  function ensureLauncher() {
    if (document.getElementById("dc-bar")) return;
    const wrap = document.createElement("div");
    wrap.id = "dc-bar";
    wrap.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none";

    // --- action menu (hidden by default, shown above FAB) ---
    const menu = document.createElement("div");
    menu.id = "dc-fab-menu";
    menu.style.cssText = "position:relative;width:220px;background:#111827;border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);overflow:hidden;padding:8px;pointer-events:none;transition:opacity .2s cubic-bezier(.34,1.56,.64,1),transform .2s cubic-bezier(.34,1.56,.64,1);opacity:0;transform:translateY(12px) scale(.95);";
    menu.setAttribute("aria-hidden", "true");

    const tooltipIconSvg = "<svg width='14' height='14' viewBox='0 0 16 16' fill='white'><circle cx='8' cy='8' r='3'/><path d='M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41'/></svg>";
    const pinIconSvg     = "<svg width='14' height='14' viewBox='0 0 16 16' fill='white'><path d='M9.5 2l.5 3.5L12 7v1H9v4l-1 2-1-2V8H4V7l2-1.5L6.5 2h3z'/></svg>";
    const exportIconSvg  = "<svg width='14' height='14' viewBox='0 0 16 16' fill='white'><path d='M8 1v9M4 6l4 4 4-4'/><rect x='2' y='13' width='12' height='2' rx='1'/></svg>";

    const mkBtn = (id, label, title, iconGrad, iconSvg, subtitle) => {
      const b = document.createElement("button");
      b.id = id;
      b.title = title;
      b.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:10px;cursor:pointer;border:none;background:#111827;color:#fff;text-align:left;transition:background .12s;";
      b.onmouseenter = () => { b.style.background = "rgba(255,255,255,.07)"; };
      b.onmouseleave = () => { b.style.background = "#111827"; };
      const iconBox = "<div style='flex-shrink:0;width:32px;height:32px;border-radius:10px;background:" + iconGrad + ";display:flex;align-items:center;justify-content:center;'>" + iconSvg + "</div>";
      const textCol = "<div style='display:flex;flex-direction:column;gap:1px;'><span style='font:600 13px/1.2 -apple-system,sans-serif;color:#fff;'>" + label + "</span><span style='font:400 11px/1.3 -apple-system,sans-serif;color:#94a3b8;'>" + subtitle + "</span></div>";
      b.innerHTML = iconBox + textCol;
      return b;
    };

    const tog = mkBtn("dc-toggle-btn", "API Tooltip",  "Show API name on hover",  "linear-gradient(135deg,#3b82f6,#2563eb)", tooltipIconSvg, "Hover to see API names");
    const inl = mkBtn("dc-inline-btn", "Pin API names","Pin API names on canvas",  "linear-gradient(135deg,#ec4899,#db2777)", pinIconSvg,     "Pin all on canvas");
    const exp = mkBtn("dc-export-btn", "Export",       "Export mappings",          "linear-gradient(135deg,#f59e0b,#d97706)", exportIconSvg,  "All fields with types");

    const separator = document.createElement("div");
    separator.style.cssText = "height:1px;background:rgba(255,255,255,.08);margin:4px 0;";

    const dismissRow = document.createElement("button");
    dismissRow.title = "Remove Data 360 Inspector";
    dismissRow.innerHTML = "<span style='font:500 12px/1 -apple-system,sans-serif;color:#ef4444;display:flex;align-items:center;gap:6px;padding:2px 0;'><span style='font-size:14px;line-height:1;'>×</span>Remove</span>";
    dismissRow.style.cssText = "display:flex;align-items:center;width:100%;padding:8px 10px;border-radius:10px;cursor:pointer;border:none;background:#111827;transition:background .12s;";
    dismissRow.onmouseenter = () => (dismissRow.style.background = "rgba(239,68,68,.08)");
    dismissRow.onmouseleave = () => (dismissRow.style.background = "#111827");
    dismissRow.onclick = (e) => { e.stopPropagation(); teardown(); };

    tog.onclick = (e) => { e.stopPropagation(); toggle(); };
    inl.onclick = (e) => { e.stopPropagation(); toggleInline(); };
    exp.onclick = (e) => { e.stopPropagation(); openExport(); };

    menu.appendChild(tog);
    menu.appendChild(inl);
    menu.appendChild(exp);
    menu.appendChild(separator);
    menu.appendChild(dismissRow);

    // --- FAB circle button ---
    const fab = document.createElement("button");
    fab.id = "dc-fab";
    fab.title = "Data 360 Inspector";
    fab.innerHTML = "<svg width='22' height='22' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='10' stroke='#fff' stroke-width='1.5'/><circle cx='12' cy='4' r='1.2' fill='#fff'/><circle cx='17.7' cy='6.3' r='1.2' fill='#fff'/><circle cx='20' cy='12' r='1.2' fill='#fff'/><circle cx='17.7' cy='17.7' r='1.2' fill='#fff'/><circle cx='12' cy='20' r='1.2' fill='#fff'/><circle cx='6.3' cy='17.7' r='1.2' fill='#fff'/><circle cx='4' cy='12' r='1.2' fill='#fff'/><circle cx='6.3' cy='6.3' r='1.2' fill='#fff'/><circle cx='12' cy='9.5' r='2.5' fill='#fff'/><path d='M8 16.5c0-2.2 1.8-4 4-4s4 1.8 4 4' stroke='#fff' stroke-width='1.5' stroke-linecap='round'/></svg>";
    fab.style.cssText = "width:44px;height:44px;border-radius:50%;border:none;cursor:pointer;pointer-events:auto;background:linear-gradient(135deg,#2d2b55 0%,#5b4f9e 100%);box-shadow:0 4px 18px rgba(91,79,158,.5);display:flex;align-items:center;justify-content:center;transition:box-shadow .15s,transform .12s;flex-shrink:0;";
    fab.onmouseenter = () => { fab.style.boxShadow = "0 6px 24px rgba(91,79,158,.65)"; fab.style.transform = "scale(1.07)"; };
    fab.onmouseleave = () => { fab.style.boxShadow = "0 4px 18px rgba(91,79,158,.5)"; fab.style.transform = "scale(1)"; };

    let menuOpen = false;
    const openMenu = () => {
      menuOpen = true;
      menu.style.opacity = "1";
      menu.style.transform = "translateY(0) scale(1)";
      menu.setAttribute("aria-hidden", "false");
      menu.style.pointerEvents = "auto";
    };
    const closeMenu = () => {
      menuOpen = false;
      menu.style.opacity = "0";
      menu.style.transform = "translateY(12px) scale(.95)";
      menu.setAttribute("aria-hidden", "true");
      menu.style.pointerEvents = "none";
    };
    fab.onclick = (e) => { e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); };

    // close menu when clicking outside
    document.addEventListener("pointerdown", (e) => {
      if (menuOpen && !wrap.contains(e.target)) closeMenu();
    }, true);

    // Drag the FAB to reposition. Distinguish tap (< 6px move) from drag.
    // Uses right/bottom so the menu always stays above/left of the FAB.
    let fabDragMoved = false;
    fab.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      fabDragMoved = false;
      const r0 = wrap.getBoundingClientRect();
      let ox = r0.left, oy = r0.top;
      const mv = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!fabDragMoved && Math.sqrt(dx*dx+dy*dy) > 5) {
          fabDragMoved = true; fab.releasePointerCapture(e.pointerId);
          wrap.style.right = "auto"; wrap.style.bottom = "auto";
          wrap.style.left = ox + "px"; wrap.style.top = oy + "px";
        }
        if (!fabDragMoved) return;
        let nx = Math.max(4, Math.min(ox + dx, window.innerWidth  - 54));
        let ny = Math.max(4, Math.min(oy + dy, window.innerHeight - 54));
        wrap.style.left = nx + "px"; wrap.style.top = ny + "px";
      };
      const up = () => {
        window.removeEventListener("pointermove", mv, true);
        window.removeEventListener("pointerup",   up, true);
        if (fabDragMoved) { setTimeout(() => { fabDragMoved = false; }, 10); }
      };
      window.addEventListener("pointermove", mv, true);
      window.addEventListener("pointerup",   up, true);
    }, true);
    // Suppress toggle-click after a drag
    fab.addEventListener("click", (e) => { if (fabDragMoved) { e.stopImmediatePropagation(); fabDragMoved = false; } }, true);

    wrap.appendChild(menu);
    wrap.appendChild(fab);
    addFabResizeGuard(wrap);
    document.body.appendChild(wrap);
  }

  // ===== DETAIL PAGE — FIELD / RELATIONSHIP CSV EXPORT =====
  // DMO: two-tab modal (Fields + Relationships) with full metadata header.
  // DataStream: single-tab field list (Field Name, Label, API, Type, Used As,
  //             Formula Field, Formula Expression, Status, Creation Type, PK).
  // DLO: discussed separately.

  function detectDetailPageType() {
    try {
      const h = location.href;
      if (/\/r\/DataStream\/[a-zA-Z0-9]{15,18}\//i.test(h)) return "DataStream";
      if (/\/r\/DataLakeObjectInstance\/[a-zA-Z0-9]{15,18}\//i.test(h)) return "DLO";
      if (/c__objectApiName=[a-zA-Z0-9_]+/i.test(h)) return "DMO";
      /* @strip:start dev */
      if (/standard-Segment|\/r\/Segment\/[a-zA-Z0-9]{15,18}|segmentWizard/i.test(h) || findByTag("runtime_cdp-segment-wizard").length > 0 || findByTag("runtime_cdp-segment-wizard-landing").length > 0) return "Segment";
      /* @strip:end */
    } catch (e) {}
    return null;
  }

  // Scans all label→value pairs from record detail layouts.
  // Handles three DOM patterns used across DS / DLO / DMO pages:
  //   1. slds-form-element  (standard Lightning layout)
  //   2. test-id__field-label-container + test-id__field-value  (record detail panels)
  //   3. item-field / item-label / item-value  (DS/DLO sidebar stacked layout)
  function readAllFormPairs() {
    const pairs = new Map();
    const clean = (v) => v.replace(/^(.+?)\1\1$/, "$1").replace(/^(.+?)\1$/, "$1");

    // Pattern 1 & 2: slds-form-element__label and test-id__field-label variants
    eachElement(document, (el) => {
      let c = ""; try { c = el.getAttribute("class") || ""; } catch (e) {}
      const isLabel = c.includes("test-id__field-label") || c.includes("slds-form-element__label");
      if (!isLabel) return;
      const label = (el.textContent || "").trim();
      if (!label || pairs.has(label)) return;
      let valEl = null;
      try {
        const form = el.closest(".slds-form-element") || el.parentElement;
        if (form) valEl = form.querySelector(".test-id__field-value,.slds-form-element__static,.slds-form-element__control .slds-truncate");
      } catch (e) {}
      if (!valEl) {
        try {
          let s = el.nextElementSibling;
          if (!s && el.parentElement) s = el.parentElement.nextElementSibling;
          if (s) { const sc = (s.getAttribute && s.getAttribute("class")) || ""; if (!/label/i.test(sc)) valEl = s; }
        } catch (e) {}
      }
      const rawVal = valEl ? (valEl.textContent || "").trim() : "";
      if (rawVal.length > 300) return;
      pairs.set(label, clean(rawVal));
    });

    // Pattern 3 removed — item-field elements are standalone value cells with no paired item-value sibling.

    return pairs;
  }

  // Read the record name from page h1. The h1 concatenates type prefix + name, e.g.
  // "Data StreamGoods Product" or "Data Lake ObjectPeronalization-identity 42AD987F".
  // Strip known prefixes to get just the record name.
  function readRecordTitle(prefix) {
    const SKIP = ["Data Cloud", "Home", "Data Streams", "Data Lake Objects", "Data Model Objects",
      "Data StreamsRecently Viewed", "Data Lake ObjectsRecently Viewed", "Data Model ObjectsRecently Viewed"];
    const prefixes = prefix ? [prefix] : ["Data Stream", "Data Lake Object", "Data Model Object"];
    const candidates = [];
    eachElement(document, (el) => {
      try {
        if ((el.tagName || "").toLowerCase() !== "h1") return;
        const txt = (el.textContent || "").trim();
        if (!txt || txt.length > 200) return;
        if (SKIP.includes(txt)) return;
        // Strip known type prefixes that get concatenated
        for (const p of prefixes) {
          if (txt.startsWith(p)) { candidates.push(txt.slice(p.length).trim()); return; }
        }
        candidates.push(txt);
      } catch (e) {}
    });
    // Last h1 is usually the most specific (deepest shadow)
    return candidates[candidates.length - 1] || candidates[0] || "";
  }

  // Collect all standalone item-field text values (used on DS/DLO sidebar — values are NOT paired).
  function readItemFieldValues() {
    const vals = [];
    eachElement(document, (el) => {
      let c = ""; try { c = el.getAttribute("class") || ""; } catch (e) {}
      if (!c.includes("item-field")) return;
      const txt = (el.textContent || "").trim();
      if (txt) vals.push(txt);
    });
    return vals;
  }

  // ── DataStream data readers ───────────────────────────────────────────────

  function readDsMetadata() {
    const pairs = readAllFormPairs();
    const get = (...keys) => {
      for (const k of keys) { const v = pairs.get(k); if (v) return v; } return "";
    };
    // item-field values: standalone sidebar values in order: category, name, apiName, connector, status, date, objectApiName...
    // Confirmed from probe: [Other, Goods Product, Goods_Product__dll, UploadedFiles, Active, ...]
    const ifVals = readItemFieldValues();
    // objectApiName ends in __dll/__dlm/__c/__ds — pick first match
    const ifApiName = ifVals.find(v => /__(dll|dlm|c|ds)$/i.test(v)) || "";
    // category is one of the known SF Data Cloud categories
    const KNOWN_CATS = /^(Other|Profile|Engagement|Behavioral|Identity|Unified|Contact\s|Order|Product|Account|Lead|Case|Event)$/i;
    const ifCategory = ifVals.find(v => KNOWN_CATS.test(v)) || "";
    // connector: matches known types
    const CONNECTORS = /^(UploadedFiles|Salesforce|S3|Azure|GCS|Marketing Cloud|MuleSoft|Heroku)/i;
    const ifConnector = ifVals.find(v => CONNECTORS.test(v)) || "";

    return {
      name:          get("Data Stream Name") || readRecordTitle("Data Stream"),
      objectApiName: ifApiName || get("Object API Name", "API Name"),
      streamType:    get("Stream Type", "Type", "Data Stream Type"),
      connectorType: ifConnector || get("Data Connector Type", "Connector Type", "Connector"),
      status:        get("Data Stream Status") || get("Status"),
      refreshMode:   get("Refresh Mode"),
      category:      ifCategory || get("Category", "Object Category"),
    };
  }

  // Identifies the field datatable by having headerLabel + fieldLabel columns
  // (not the refresh-history datatable which has startExecutionTime).
  function readDsFields() {
    const tables = findByTag("runtime_cdp-custom-datatable");
    const pick = tables.find(t => {
      const cols = safeGet(t, "columns");
      if (!Array.isArray(cols)) return false;
      const names = cols.map(c => safeGet(c, "fieldName") || "");
      return names.includes("headerLabel") && names.includes("fieldLabel");
    });
    if (!pick) return [];
    const data = safeGet(pick, "data");
    if (!Array.isArray(data)) return [];
    const boolStr = (v) => String(v || "false").toLowerCase() === "true" ? "Yes" : "No";
    return data.map(item => {
      if (!item || typeof item !== "object") return null;
      const isFormula = String(safeGet(item, "isFormulaField") || "false").toLowerCase() === "true";
      return {
        fieldName:       safeGet(item, "headerLabel")       || "",
        fieldLabel:      safeGet(item, "fieldLabel")        || safeGet(item, "label") || "",
        fieldApiName:    safeGet(item, "fieldName")         || "",
        type:            safeGet(item, "type")              || "",
        fieldUsedAs:     safeGet(item, "fieldUsedAs")       || "",
        isFormulaField:  boolStr(isFormula),
        formulaExpr:     isFormula ? (safeGet(item, "formula") || "") : "",
        status:          safeGet(item, "dataLakeFieldStatus") || "",
        creationType:    safeGet(item, "creationType")      || "",
        isPrimaryKey:    boolStr(safeGet(item, "primaryKey")),
        isEventDate:     boolStr(safeGet(item, "isEventDate")),
        isOrgUnit:       boolStr(safeGet(item, "isOrgUnit")),
        keyQualifierName: safeGet(item, "keyQualifierName") || "",
        usageTag:        safeGet(item, "usageTag")          || "",
      };
    }).filter(Boolean);
  }

  // ── DataStream export modal ───────────────────────────────────────────────

  let detailExportEl = null;
  let dcBackdropEl   = null;

  function showBackdrop(onClickClose) {
    if (dcBackdropEl) return;
    dcBackdropEl = document.createElement("div");
    dcBackdropEl.style.cssText = "position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.45);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);";
    dcBackdropEl.onclick = onClickClose;
    document.body.appendChild(dcBackdropEl);
  }
  function hideBackdrop() {
    if (dcBackdropEl) { dcBackdropEl.remove(); dcBackdropEl = null; }
  }

  function openDsExport() {
    const meta   = readDsMetadata();
    const fields = readDsFields();

    const DS_COLS = [
      ["fieldName",       "Field Name"],
      ["fieldLabel",      "Field Label"],
      ["fieldApiName",    "Field API Name"],
      ["type",            "Data Type"],
      ["fieldUsedAs",     "Field Used As"],
      ["isFormulaField",  "Formula Field"],
      ["formulaExpr",     "Formula Expression"],
      ["status",          "Status"],
      ["creationType",    "Creation Type"],
      ["isPrimaryKey",    "Primary Key"],
      ["isEventDate",     "Is Event Date"],
      ["isOrgUnit",       "Is Org Unit"],
      ["keyQualifierName","Key Qualifier Name"],
      ["usageTag",        "Usage Tag"],
    ];
    const csvEsc = (s) => { const t = String(s==null?"":s); return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; };
    const tsvEsc = (s) => String(s==null?"":s).replace(/\t/g," ");
    const buildMetaStr = () => {
      const parts = [];
      if (meta.name)          parts.push("Data Stream: " + meta.name);
      if (meta.objectApiName) parts.push("API Name: " + meta.objectApiName);
      if (meta.streamType)    parts.push("Type: " + meta.streamType);
      if (meta.connectorType) parts.push("Connector: " + meta.connectorType);
      if (meta.status)        parts.push("Status: " + meta.status);
      if (meta.refreshMode)   parts.push("Refresh Mode: " + meta.refreshMode);
      if (meta.category)      parts.push("Category: " + meta.category);
      return parts.join("\n");
    };
    const toText = (rows, cols, sep) => {
      const e = sep === "," ? csvEsc : tsvEsc;
      const dataRows = cols.map(c=>c[1]).join(sep)+"\n"+rows.map(r=>cols.map(c=>e(r[c[0]])).join(sep)).join("\n");
      return dataRows + "\n\n" + e(buildMetaStr());
    };
    const buildMetaXlsxRow = () => [buildMetaStr()];
    const download = (text, filename) => {
      try {
        const b=new Blob([text],{type:"text/csv"});
        const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=filename;
        document.body.appendChild(a); a.click(); a.remove();
      } catch(e){}
    };
    const esc = (s) => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const chip = (text, color) => text ? "<span style='display:inline-block;padding:1px 8px;border-radius:10px;background:" + color + ";color:#fff;font-size:11px;margin:0 2px'>" + esc(text) + "</span>" : "";
    const safeFilename = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g,"_");

    if (!detailExportEl) { detailExportEl=document.createElement("div"); document.body.appendChild(detailExportEl); }
    detailExportEl.id="dc-detail-export";
    detailExportEl.style.cssText="position:fixed;top:4vh;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(1200px,97vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;color:#16325c;border:1px solid #c9cede;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.5);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden";

    const fieldTrs = fields.map(r =>
      "<tr>" +
      "<td>" + esc(r.fieldName) + "</td>" +
      "<td>" + esc(r.fieldLabel) + "</td>" +
      "<td class='api'>" + esc(r.fieldApiName) + "</td>" +
      "<td>" + esc(r.type) + "</td>" +
      "<td>" + esc(r.fieldUsedAs) + "</td>" +
      "<td class='center'>" + esc(r.isFormulaField) + "</td>" +
      "<td class='mono small'>" + esc(r.formulaExpr) + "</td>" +
      "<td><span class='badge " + (r.status==="ACTIVE"?"active":"inactive") + "'>" + esc(r.status) + "</span></td>" +
      "<td>" + esc(r.creationType) + "</td>" +
      "<td class='center'>" + esc(r.isPrimaryKey) + "</td>" +
      "</tr>"
    ).join("") || "<tr><td colspan='10' class='empty'>No fields found. Make sure the Fields tab is active.</td></tr>";

    detailExportEl.innerHTML =
      "<style>" +
      "#dc-detail-export .hd{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#f3f6fb;border-bottom:1px solid #e0e5ee;flex-shrink:0;flex-wrap:wrap}" +
      "#dc-detail-export .hd strong{font-size:15px;flex-shrink:0}" +
      "#dc-detail-export .toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e0e5ee;background:#fff;flex-shrink:0}" +
      "#dc-detail-export .sp{flex:1 1 0}" +
      "#dc-detail-export button{flex:1;min-width:0;white-space:nowrap;border:1px solid #0b5cab;background:#0b5cab;color:#fff;border-radius:6px;padding:7px 10px;font-weight:600;cursor:pointer;font-size:12px;text-align:center}" +
      "#dc-detail-export button.sec{background:#fff;color:#0b5cab}" +
      "#dc-detail-export .x{flex:0 0 auto;min-width:auto;border:none;background:transparent;color:#5c6b8a;font-size:20px;padding:0 4px;cursor:pointer;line-height:1;margin-left:4px}" +
      "#dc-detail-export .bd{overflow:auto;flex:1;min-height:0}" +
      "#dc-detail-export table{border-collapse:collapse;width:100%;font-size:12px}" +
      "#dc-detail-export th{position:sticky;top:0;background:#fff;text-align:left;padding:7px 10px;border-bottom:2px solid #e0e5ee;color:#5c6b8a;font-size:11px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}" +
      "#dc-detail-export td{padding:5px 10px;border-bottom:1px solid #eef1f6;vertical-align:top}" +
      "#dc-detail-export td.api{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#0b5cab}" +
      "#dc-detail-export td.mono{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#6b1f9a;word-break:break-all;max-width:280px}" +
      "#dc-detail-export td.small{font-size:10px}" +
      "#dc-detail-export td.center{text-align:center;color:#5c6b8a}" +
      "#dc-detail-export .badge{display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600}" +
      "#dc-detail-export .badge.active{background:#d4f0db;color:#0a6b2d}" +
      "#dc-detail-export .badge.inactive{background:#f0d4d4;color:#6b0a0a}" +
      "#dc-detail-export .empty{padding:24px;text-align:center;color:#8a94ab}" +
      "#dc-detail-export .meta-bar{display:flex;flex-wrap:wrap;gap:4px 18px;padding:7px 16px;background:#f9fafc;border-bottom:1px solid #e0e5ee;font-size:11px;color:#5c6b8a;flex-shrink:0}" +
      "#dc-detail-export .meta-bar b{color:#16325c}" +
      "#dc-detail-export .ft{padding:6px 16px;border-top:1px solid #e0e5ee;color:#8a94ab;font-size:11px;background:#f9fafc;flex-shrink:0}" +
      "</style>" +
      "<div class='hd'>" +
        "<strong>" + esc(meta.name || "Data Stream") + "</strong>" +
        (meta.streamType    ? chip(meta.streamType,    "#0b5cab") : "") +
        (meta.connectorType ? chip(meta.connectorType, "#6b1f9a") : "") +
        (meta.status        ? chip(meta.status.replace(/active/i,"Active").replace(/inactive/i,"Inactive"), meta.status.toLowerCase().includes("active")?"#0a6b2d":"#8a94ab") : "") +
        (meta.refreshMode   ? chip(meta.refreshMode,   "#5c6b8a") : "") +
        "<span class='sp'></span><button class='x' id='dc-d-close'>&times;</button>" +
      "</div>" +
      "<div class='meta-bar'>" +
        (meta.name          ? "<span><b>Name:</b> " + esc(meta.name)              + "</span>" : "") +
        (meta.objectApiName ? "<span><b>API Name:</b> <span style='font-family:SF Mono,Menlo,monospace'>" + esc(meta.objectApiName) + "</span></span>" : "") +
        (meta.category      ? "<span><b>Category:</b> " + esc(meta.category)      + "</span>" : "") +
        (meta.streamType    ? "<span><b>Stream Type:</b> " + esc(meta.streamType)    + "</span>" : "") +
        (meta.connectorType ? "<span><b>Connector:</b> " + esc(meta.connectorType) + "</span>" : "") +
        (meta.refreshMode   ? "<span><b>Refresh Mode:</b> " + esc(meta.refreshMode)  + "</span>" : "") +
        (meta.status        ? "<span><b>Status:</b> " + esc(meta.status)           + "</span>" : "") +
      "</div>" +
      "<div class='toolbar'>" +
        "<button id='dc-d-copy'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy for Sheets</button>" +
        "<button class='sec' id='dc-d-csv'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><path d='M3 2h7l3 3v9H3z' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M10 2v3h3'/><path d='M6 9l2 2 2-2M8 7v4'/></svg>Download CSV</button>" +
      "</div>" +
      "<div class='bd'><table><thead><tr>" +
        "<th>Field Name</th><th>Field Label</th><th>Field API Name</th><th>Data Type</th>" +
        "<th>Field Used As</th><th>Formula</th><th>Formula Expression</th><th>Status</th>" +
        "<th>Creation Type</th><th>PK</th>" +
      "</tr></thead><tbody>" + fieldTrs + "</tbody></table></div>" +
      "<div class='ft'>" + fields.length + " field(s)" +
        (meta.name          ? " · " + esc(meta.name)          : "") +
        (meta.streamType    ? " · " + esc(meta.streamType)    : "") +
        (meta.connectorType ? " · " + esc(meta.connectorType) : "") +
      "</div>";

    const closeDetail = () => { if (detailExportEl) { detailExportEl.remove(); detailExportEl=null; } hideBackdrop(); };
    detailExportEl.querySelector("#dc-d-close").onclick = closeDetail;
    detailExportEl.querySelector("#dc-d-copy").onclick = (e) => {
      navigator.clipboard.writeText(toText(fields, DS_COLS, "\t")).then(() => {
        e.target.textContent = "✓ Copied!"; setTimeout(() => (e.target.innerHTML = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy for Sheets"), 1200);
      }).catch(()=>{});
    };
    detailExportEl.querySelector("#dc-d-csv").onclick = () => {
      download(toText(fields, DS_COLS, ","), safeFilename(meta.name||"datastream")+"-fields.csv");
    };
    const hd=detailExportEl.querySelector(".hd"); if(hd) makeDraggable(detailExportEl,hd);
    addResizeHandle(detailExportEl, 480, 300);
    const onEsc=(e)=>{ if(e.key==="Escape"){closeDetail();document.removeEventListener("keydown",onEsc,true);} };
    document.addEventListener("keydown",onEsc,true);
    const onOut=(e)=>{ if(detailExportEl&&!detailExportEl.contains(e.target)){closeDetail();document.removeEventListener("pointerdown",onOut,true);} };
    setTimeout(()=>document.addEventListener("pointerdown",onOut,true),100);
  }

  // ── DLO data readers ─────────────────────────────────────────────────────

  function readDloMetadata() {
    const pairs = readAllFormPairs();
    const get = (...keys) => { for (const k of keys) { const v = pairs.get(k); if (v) return v; } return ""; };

    // item-field standalone values (no paired item-value — confirmed by probe).
    // Order from probe: [category, name, apiName(__dll), connector, status, date, objectApiName, ...]
    const ifVals = readItemFieldValues();

    // API name: first item-field value ending in __dll/__dlm/__c
    const apiName = ifVals.find(v => /__(dll|dlm|c)$/i.test(v)) || get("API Name", "Object API Name");

    // DLO name: item-field value that is NOT an apiName, category, connector, date, status, or blank
    // From probe: e.g. "Peronalization-identity 42AD987F", "Goods Product"
    const KNOWN_CATS = /^(Other|Profile|Engagement|Behavioral|Identity|Unified|Contact\s|Order|Product|Account|Lead|Case|Event)$/i;
    const CONNECTORS = /^(UploadedFiles|Salesforce|S3|Azure|GCS|Marketing Cloud|MuleSoft|Heroku)/i;
    const STATUS_RE  = /^(Active|Inactive|Draft|Deprecated)$/i;
    const DATE_RE    = /^\d{1,2}\/\d{1,2}\/\d{4}/;
    const dloName = ifVals.find(v =>
      v.length > 2 &&
      !KNOWN_CATS.test(v) &&
      !CONNECTORS.test(v) &&
      !STATUS_RE.test(v) &&
      !DATE_RE.test(v) &&
      !/__(dll|dlm|c)$/i.test(v) &&
      !/^[A-Z0-9_]+$/.test(v)   // skip all-caps identifiers
    ) || get("Name", "Data Lake Object Name") || readRecordTitle("Data Lake Object");

    const category = ifVals.find(v => KNOWN_CATS.test(v)) || get("Category", "Object Category");
    const status   = ifVals.find(v => STATUS_RE.test(v))  || get("Data Lake Object Status", "Status");

    return { apiName, name: dloName, category, status };
  }

  // DLO field table: identified by columns having "fieldLabel" + "keyQualifier" fieldNames.
  function readDloFields() {
    const tables = findByTag("runtime_cdp-custom-datatable");
    const pick = tables.find(t => {
      const cols = safeGet(t, "columns");
      if (!Array.isArray(cols)) return false;
      const names = cols.map(c => safeGet(c, "fieldName") || "");
      return names.includes("fieldLabel") && names.includes("keyQualifier");
    });
    if (!pick) return [];
    const data = safeGet(pick, "data");
    if (!Array.isArray(data)) return [];

    const extractMulti = (v) => {
      if (!v) return "";
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(x => x && (safeGet(x, "label") || safeGet(x, "name") || String(x))).filter(Boolean).join("; ");
      return "";
    };
    const boolStr = (v) => String(v || "false").toLowerCase() === "true" ? "Yes" : "No";

    return data.map(item => {
      if (!item || typeof item !== "object") return null;
      const kq = safeGet(item, "keyQualifier");
      const keyQualifier = kq ? (typeof kq === "object" ? (safeGet(kq, "label") || safeGet(kq, "name") || "") : String(kq)) : "";
      return {
        fieldLabel:           safeGet(item, "fieldLabel") || safeGet(item, "label") || "",
        fieldApiName:         safeGet(item, "fieldName")  || "",
        type:                 safeGet(item, "type")       || "",
        fieldUsedAs:          safeGet(item, "fieldUsedAs") || "",
        keyQualifier,
        keyQualifierName:     safeGet(item, "keyQualifierName") || "",
        assignedTags:         extractMulti(safeGet(item, "assignedTags")),
        assignedClassifications: extractMulti(safeGet(item, "assignedClassifications")),
        status:               safeGet(item, "dataLakeFieldStatus") || "",
        creationType:         safeGet(item, "creationType") || "",
        isPrimaryKey:         boolStr(safeGet(item, "primaryKey")),
        isEventDate:          boolStr(safeGet(item, "isEventDate")),
        isOrgUnit:            boolStr(safeGet(item, "isOrgUnit")),
        usageTag:             safeGet(item, "usageTag") || "",
      };
    }).filter(Boolean);
  }

  // ── DLO export modal ──────────────────────────────────────────────────────

  function openDloExport() {
    const meta   = readDloMetadata();
    const fields = readDloFields();

    const DLO_COLS = [
      ["fieldLabel",            "Field Label"],
      ["fieldApiName",          "Field API Name"],
      ["type",                  "Data Type"],
      ["fieldUsedAs",           "Field Used As"],
      ["keyQualifier",          "Key Qualifier"],
      ["keyQualifierName",      "Key Qualifier Name"],
      ["assignedTags",          "Tags"],
      ["assignedClassifications","Classifications"],
      ["status",                "Status"],
      ["creationType",          "Creation Type"],
      ["isPrimaryKey",          "Primary Key"],
      ["isEventDate",           "Is Event Date"],
      ["isOrgUnit",             "Is Org Unit"],
      ["usageTag",              "Usage Tag"],
    ];
    const csvEsc = (s) => { const t=String(s==null?"":s); return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; };
    const tsvEsc = (s) => String(s==null?"":s).replace(/\t/g," ");
    const buildMetaStr = () => {
      const parts = [];
      if (meta.name)     parts.push("DLO: " + meta.name);
      if (meta.apiName)  parts.push("API Name: " + meta.apiName);
      if (meta.category) parts.push("Category: " + meta.category);
      if (meta.status)   parts.push("Status: " + meta.status);
      return parts.join("\n");
    };
    const toText = (rows, cols, sep) => {
      const e = sep===","?csvEsc:tsvEsc;
      const dataRows = cols.map(c=>c[1]).join(sep)+"\n"+rows.map(r=>cols.map(c=>e(r[c[0]])).join(sep)).join("\n");
      return dataRows + "\n\n" + e(buildMetaStr());
    };
    const buildMetaXlsxRow = () => [buildMetaStr()];
    const download = (text, fn) => {
      try { const b=new Blob([text],{type:"text/csv"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download=fn; document.body.appendChild(a); a.click(); a.remove(); } catch(e){}
    };
    const esc = (s) => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const chip = (text, color) => text ? "<span style='display:inline-block;padding:1px 8px;border-radius:10px;background:"+color+";color:#fff;font-size:11px;margin:0 2px'>"+esc(text)+"</span>" : "";
    const safeFilename = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g,"_");

    if (!detailExportEl) { detailExportEl=document.createElement("div"); document.body.appendChild(detailExportEl); }
    detailExportEl.id="dc-detail-export";
    detailExportEl.style.cssText="position:fixed;top:4vh;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(1100px,97vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;color:#16325c;border:1px solid #c9cede;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.5);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden";

    const fieldTrs = fields.map(r =>
      "<tr>" +
      "<td>" + esc(r.fieldLabel) + "</td>" +
      "<td class='api'>" + esc(r.fieldApiName) + "</td>" +
      "<td>" + esc(r.type) + "</td>" +
      "<td>" + esc(r.fieldUsedAs) + "</td>" +
      "<td class='mono'>" + esc(r.keyQualifier) + "</td>" +
      "<td>" + esc(r.assignedTags) + "</td>" +
      "<td>" + esc(r.assignedClassifications) + "</td>" +
      "<td><span class='badge " + (r.status==="ACTIVE"?"active":"inactive") + "'>" + esc(r.status) + "</span></td>" +
      "<td class='center'>" + esc(r.isPrimaryKey) + "</td>" +
      "</tr>"
    ).join("") || "<tr><td colspan='9' class='empty'>No fields found. Make sure the Fields tab is active.</td></tr>";

    detailExportEl.innerHTML =
      "<style>" +
      "#dc-detail-export .hd{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f3f6fb;border-bottom:1px solid #e0e5ee;flex-shrink:0;flex-wrap:wrap}" +
      "#dc-detail-export .hd strong{font-size:15px;flex-shrink:0}" +
      "#dc-detail-export .hd .sub{font:11px 'SF Mono',Menlo,monospace;color:#5c6b8a;min-width:0}" +
      "#dc-detail-export .toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e0e5ee;background:#fff;flex-shrink:0}" +
      "#dc-detail-export .sp{flex:1 1 0}" +
      "#dc-detail-export button{flex:1;min-width:0;white-space:nowrap;border:1px solid #0b5cab;background:#0b5cab;color:#fff;border-radius:6px;padding:7px 10px;font-weight:600;cursor:pointer;font-size:12px;text-align:center}" +
      "#dc-detail-export button.sec{background:#fff;color:#0b5cab}" +
      "#dc-detail-export .x{flex:0 0 auto;min-width:auto;border:none;background:transparent;color:#5c6b8a;font-size:20px;padding:0 4px;cursor:pointer;line-height:1;margin-left:4px}" +
      "#dc-detail-export .bd{overflow:auto;flex:1;min-height:0}" +
      "#dc-detail-export table{border-collapse:collapse;width:100%;font-size:12px}" +
      "#dc-detail-export th{position:sticky;top:0;background:#fff;text-align:left;padding:7px 10px;border-bottom:2px solid #e0e5ee;color:#5c6b8a;font-size:11px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}" +
      "#dc-detail-export td{padding:5px 10px;border-bottom:1px solid #eef1f6;vertical-align:top}" +
      "#dc-detail-export td.api{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#0b5cab}" +
      "#dc-detail-export td.mono{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#6b1f9a}" +
      "#dc-detail-export td.center{text-align:center;color:#5c6b8a}" +
      "#dc-detail-export .badge{display:inline-block;padding:1px 7px;border-radius:8px;font-size:10px;font-weight:600}" +
      "#dc-detail-export .badge.active{background:#d4f0db;color:#0a6b2d}" +
      "#dc-detail-export .badge.inactive{background:#f0d4d4;color:#6b0a0a}" +
      "#dc-detail-export .empty{padding:24px;text-align:center;color:#8a94ab}" +
      "#dc-detail-export .meta-bar{display:flex;flex-wrap:wrap;gap:4px 18px;padding:7px 16px;background:#f9fafc;border-bottom:1px solid #e0e5ee;font-size:11px;color:#5c6b8a;flex-shrink:0}" +
      "#dc-detail-export .meta-bar b{color:#16325c}" +
      "#dc-detail-export .ft{padding:6px 16px;border-top:1px solid #e0e5ee;color:#8a94ab;font-size:11px;background:#f9fafc;flex-shrink:0}" +
      "</style>" +
      "<div class='hd'>" +
        "<strong>" + esc(meta.name || meta.apiName || "Data Lake Object") + "</strong>" +
        "<span class='sub'>" + esc(meta.apiName) + "</span>" +
        (meta.category ? chip(meta.category, "#0b5cab") : "") +
        (meta.status   ? chip(meta.status, meta.status.toLowerCase()==="active"?"#0a6b2d":"#8a94ab") : "") +
        "<span class='sp'></span><button class='x' id='dc-d-close'>&times;</button>" +
      "</div>" +
      "<div class='meta-bar'>" +
        (meta.name     ? "<span><b>DLO Name:</b> " + esc(meta.name)     + "</span>" : "") +
        (meta.apiName  ? "<span><b>API Name:</b> <span style='font-family:SF Mono,Menlo,monospace'>" + esc(meta.apiName) + "</span></span>" : "") +
        (meta.category ? "<span><b>Category:</b> " + esc(meta.category) + "</span>" : "") +
        (meta.status   ? "<span><b>Status:</b> "   + esc(meta.status)   + "</span>" : "") +
      "</div>" +
      "<div class='toolbar'>" +
        "<button id='dc-d-copy'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy for Sheets</button>" +
        "<button class='sec' id='dc-d-csv'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><path d='M3 2h7l3 3v9H3z' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M10 2v3h3'/><path d='M6 9l2 2 2-2M8 7v4'/></svg>Download CSV</button>" +
      "</div>" +
      "<div class='bd'><table><thead><tr>" +
        "<th>Field Label</th><th>Field API Name</th><th>Data Type</th><th>Field Used As</th>" +
        "<th>Key Qualifier</th><th>Tags</th><th>Classifications</th><th>Status</th><th>PK</th>" +
      "</tr></thead><tbody>" + fieldTrs + "</tbody></table></div>" +
      "<div class='ft'>" + fields.length + " field(s)" +
        (meta.name     ? " · " + esc(meta.name)     : "") +
        (meta.apiName  ? " · " + esc(meta.apiName)  : "") +
        (meta.category ? " · " + esc(meta.category) : "") +
      "</div>";

    const closeDetail = () => { if (detailExportEl) { detailExportEl.remove(); detailExportEl=null; } hideBackdrop(); };
    detailExportEl.querySelector("#dc-d-close").onclick = closeDetail;
    detailExportEl.querySelector("#dc-d-copy").onclick = (e) => {
      navigator.clipboard.writeText(toText(fields, DLO_COLS, "\t")).then(() => {
        e.target.textContent = "✓ Copied!"; setTimeout(() => (e.target.innerHTML = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy for Sheets"), 1200);
      }).catch(()=>{});
    };
    detailExportEl.querySelector("#dc-d-csv").onclick = () => {
      download(toText(fields, DLO_COLS, ","), safeFilename(meta.apiName||meta.name||"dlo")+"-fields.csv");
    };
    const hd=detailExportEl.querySelector(".hd"); if(hd) makeDraggable(detailExportEl,hd);
    addResizeHandle(detailExportEl, 480, 300);
    const onEsc=(e)=>{ if(e.key==="Escape"){closeDetail();document.removeEventListener("keydown",onEsc,true);} };
    document.addEventListener("keydown",onEsc,true);
    const onOut=(e)=>{ if(detailExportEl&&!detailExportEl.contains(e.target)){closeDetail();document.removeEventListener("pointerdown",onOut,true);} };
    setTimeout(()=>document.addEventListener("pointerdown",onOut,true),100);
  }

  // ── DMO data readers ──────────────────────────────────────────────────────

  // Read DMO metadata from runtime_cdp-data-model-tab-object-details-dialog-fields.objectDetails
  function readDmoMetadata() {
    const els = findByTag("runtime_cdp-data-model-tab-object-details-dialog-fields");
    for (const el of els) {
      const od = safeGet(el, "objectDetails");
      if (!od || typeof od !== "object") continue;
      const dataStreams   = Array.isArray(safeGet(od, "dataStream"))   ? safeGet(od, "dataStream")   : [];
      const dataLakeObjs  = Array.isArray(safeGet(od, "dataLakeObject")) ? safeGet(od, "dataLakeObject") : [];
      return {
        name:           safeGet(od, "name")     || "",
        label:          safeGet(od, "label")    || "",
        category:       safeGet(od, "category") || "",
        description:    safeGet(od, "description") || "",
        dataStreams,
        dataLakeObjects: dataLakeObjs,
      };
    }
    // URL fallback
    let apiName = "";
    try {
      const m = location.href.match(/[?&]c__objectApiName=([^&]+)/i);
      if (m) apiName = decodeURIComponent(m[1]);
    } catch (e) {}
    return { name: apiName, label: "", category: "", description: "", dataStreams: [], dataLakeObjects: [] };
  }

  // Read all field rows from the DMO datatable (runtime_cdp-custom-datatable with isMapped col).
  function readDmoFields() {
    const tables = findByTag("runtime_cdp-custom-datatable");
    // DMO table has isMapped column; prefer visible but fall back if hidden (tab not active)
    const pick = tables.find(t => {
      const cols = safeGet(t, "columns");
      return Array.isArray(cols) && cols.some(c => safeGet(c, "fieldName") === "isMapped");
    });
    if (!pick) return [];
    const data = safeGet(pick, "data");
    if (!Array.isArray(data)) return [];

    const extractMulti = (v) => {
      if (!v) return "";
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.map(x => (x && (safeGet(x, "label") || safeGet(x, "name") || String(x)))).filter(Boolean).join("; ");
      return "";
    };
    const boolStr = (v) => { const s = String(v || "false").toLowerCase(); return s === "true" ? "True" : "False"; };

    return data.map(item => {
      if (!item || typeof item !== "object") return null;
      const pf = safeGet(item, "parentField");
      const keyQualifier = pf ? (typeof pf === "object" ? (safeGet(pf, "label") || safeGet(pf, "name") || "") : String(pf)) : "";
      return {
        label:                  safeGet(item, "label")    || "",
        name:                   safeGet(item, "name")     || "",
        type:                   safeGet(item, "type")     || "",
        isMapped:               boolStr(safeGet(item, "isMapped")),
        isDistinct:             boolStr(safeGet(item, "isDistinct")),
        keyQualifier,
        assignedTags:           extractMulti(safeGet(item, "assignedTags")),
        assignedClassifications: extractMulti(safeGet(item, "assignedClassifications")),
        isPrimaryKey:           boolStr(safeGet(item, "isPrimaryKey")),
        creationType:           safeGet(item, "creationType") || "",
        usageTag:               safeGet(item, "UsageTag")     || "",
      };
    }).filter(Boolean);
  }

  // Read relationships — include all rows (isActive can be boolean true or string "true")
  function readDmoRelationships() {
    const els = findByTag("runtime_cdp-data-model-tab-object-details-dialog-relationships");
    for (const el of els) {
      const raw = safeGet(el, "relationships");
      if (!Array.isArray(raw) || !raw.length) continue;
      const isActiveVal = (r) => {
        const v = safeGet(r, "isActive");
        return v === true || v === "true";
      };
      // Use all rows if none have isActive=true (field may not exist), otherwise filter
      const filtered = raw.filter(r => r && isActiveVal(r));
      const rows = filtered.length ? filtered : raw.filter(Boolean);
      return rows.map(r => ({
        sourceEntityLabel:  safeGet(r, "sourceEntityLabel")  || safeGet(r, "objectLabel")  || "",
        sourceEntity:       safeGet(r, "sourceEntity")       || safeGet(r, "objectApiName") || "",
        sourceFieldLabel:   safeGet(r, "sourceFieldLabel")   || safeGet(r, "fieldLabel")   || "",
        sourceField:        safeGet(r, "sourceField")        || safeGet(r, "fieldApiName") || "",
        keyQualifierSource: safeGet(r, "keyQualifierSource") || safeGet(r, "keyQualifier") || "",
        cardinality:        safeGet(r, "cardinality")        || "",
        cardinalityLabel:   safeGet(r, "cardinalityLabel")   || safeGet(r, "cardinality")  || "",
        targetEntityLabel:  safeGet(r, "targetEntityLabel")  || safeGet(r, "relatedObjectLabel")  || "",
        targetEntity:       safeGet(r, "targetEntity")       || safeGet(r, "relatedObjectApiName") || "",
        targetFieldLabel:   safeGet(r, "targetFieldLabel")   || safeGet(r, "relatedFieldLabel")   || "",
        targetField:        safeGet(r, "targetField")        || safeGet(r, "relatedFieldApiName") || "",
        keyQualifierTarget: safeGet(r, "keyQualifierTarget") || "",
      }));
    }
    return [];
  }

  // ── DMO export modal ──────────────────────────────────────────────────────

  // Minimal XLSX builder — produces a real .xlsx (Office Open XML) with multiple sheets.
  // No external library needed; uses only base64 + Blob.
  // buildXlsx(sheets, opts)
  // sheets: [{name, rows, headerRow?}]
  //   rows: array of arrays of cell values (string/number/null)
  //   headerRow: 1-based row index to bold (default 1)
  // opts.wrapLastRow: if true, last row's first cell gets wrapText (for multi-line meta cell)
  function buildXlsx(sheets, opts) {
    opts = opts || {};
    const xmlEsc = (s) => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const colLetter = (n) => { let s=""; n++; while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-(n%26?0:26))/26);} return s; };

    // Style IDs: 0=normal, 1=bold, 2=wrap (for meta cell)
    const stylesXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
      "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
      "<fonts count=\"2\"><font><sz val=\"11\"/></font><font><b/><sz val=\"11\"/></font></fonts>" +
      "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>" +
      "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>" +
      "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
      "<cellXfs count=\"3\">" +
        "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +           // 0: normal
        "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +           // 1: bold
        "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"><alignment wrapText=\"1\"/></xf>" + // 2: wrap
      "</cellXfs>" +
      "</styleSheet>";

    const sharedStrings = []; const ssIndex = {};
    const si = (v) => { const s=String(v==null?"":v); if(s in ssIndex) return ssIndex[s]; const i=sharedStrings.length; sharedStrings.push(s); ssIndex[s]=i; return i; };

    const sheetXmls = sheets.map(({name, rows, headerRow}) => {
      const hRow = (headerRow != null ? headerRow : 1); // which row is bold (1-based)
      const totalRows = rows.length;
      const cells = rows.map((row, ri) => {
        const rowNum = ri + 1;
        const isBoldRow = rowNum === hRow;
        const isLastRow = rowNum === totalRows;
        return row.map((val, ci) => {
          const ref = colLetter(ci) + rowNum;
          let sAttr = "";
          if (isBoldRow) sAttr = " s=\"1\"";
          else if (isLastRow && ci === 0 && opts.wrapLastRow) sAttr = " s=\"2\"";
          if (typeof val === "number" && isFinite(val)) return "<c r=\""+ref+"\""+sAttr+" t=\"n\"><v>"+val+"</v></c>";
          // For strings with newlines, use inline string <is> instead of shared string
          const str = String(val==null?"":val);
          if (str.includes("\n")) {
            const parts = str.split("\n").map(p=>"<r><t xml:space=\"preserve\">"+xmlEsc(p)+"</t></r>").join("");
            return "<c r=\""+ref+"\""+sAttr+" t=\"inlineStr\"><is>"+parts+"</is></c>";
          }
          return "<c r=\""+ref+"\""+sAttr+" t=\"s\"><v>"+si(val)+"</v></c>";
        }).join("");
      }).map((rowCells, ri) => "<row r=\""+(ri+1)+"\">"+rowCells+"</row>").join("");
      return "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>"+cells+"</sheetData></worksheet>";
    });

    const ssXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\""+sharedStrings.length+"\" uniqueCount=\""+sharedStrings.length+"\">"+
      sharedStrings.map(s=>"<si><t xml:space=\"preserve\">"+xmlEsc(s)+"</t></si>").join("")+"</sst>";

    const sheetNames = sheets.map(s=>s.name);
    const wbXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>"+
      sheetNames.map((n,i)=>"<sheet name=\""+xmlEsc(n)+"\" sheetId=\""+(i+1)+"\" r:id=\"rId"+(i+1)+"\"/>").join("")+"</sheets></workbook>";

    const relsXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"+
      sheetNames.map((_,i)=>"<Relationship Id=\"rId"+(i+1)+"\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet"+(i+1)+".xml\"/>").join("")+
      "<Relationship Id=\"rId"+(sheetNames.length+1)+"\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings\" Target=\"sharedStrings.xml\"/>"+
      "<Relationship Id=\"rId"+(sheetNames.length+2)+"\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>";

    const pkgRels = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>";
    const ct = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>"+
      sheetNames.map((_,i)=>"<Override PartName=\"/xl/worksheets/sheet"+(i+1)+".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>").join("")+"</Types>";

    const enc = new TextEncoder();
    const files = [
      ["[Content_Types].xml",        enc.encode(ct)],
      ["_rels/.rels",                enc.encode(pkgRels)],
      ["xl/workbook.xml",            enc.encode(wbXml)],
      ["xl/_rels/workbook.xml.rels", enc.encode(relsXml)],
      ["xl/sharedStrings.xml",       enc.encode(ssXml)],
      ["xl/styles.xml",              enc.encode(stylesXml)],
      ...sheetXmls.map((xml, i) => ["xl/worksheets/sheet"+(i+1)+".xml", enc.encode(xml)]),
    ];
    const u32 = (n) => { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n,true); return b; };
    const u16 = (n) => { const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,n,true); return b; };
    const crc32 = (data) => {
      let c = 0xFFFFFFFF;
      const t = new Uint32Array(256); for(let i=0;i<256;i++){let x=i;for(let j=0;j<8;j++) x=x&1?(x>>>1)^0xEDB88320:(x>>>1);t[i]=x;}
      for(const b of data) c=t[(c^b)&0xff]^(c>>>8);
      return (c^0xFFFFFFFF)>>>0;
    };
    const chunks = []; const centralDir = []; let offset = 0;
    for (const [name, data] of files) {
      const nameBytes = enc.encode(name);
      const crc = crc32(data);
      const local = new Uint8Array([0x50,0x4B,0x03,0x04,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0),...nameBytes,...data]);
      centralDir.push({nameBytes, crc, size: data.length, offset});
      chunks.push(local);
      offset += local.length;
    }
    const cdStart = offset;
    for (const {nameBytes, crc, size, offset: off} of centralDir) {
      chunks.push(new Uint8Array([0x50,0x4B,0x01,0x02,20,0,20,0,0,0,0,0,0,0,0,0,...u32(crc),...u32(size),...u32(size),...u16(nameBytes.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(off),...nameBytes]));
    }
    const cdSize = chunks.reduce((a,c)=>a+c.length,0) - cdStart;
    chunks.push(new Uint8Array([0x50,0x4B,0x05,0x06,0,0,0,0,...u16(centralDir.length),...u16(centralDir.length),...u32(cdSize),...u32(cdStart),0,0]));
    const total = chunks.reduce((a,c)=>a+c.length,0);
    const buf = new Uint8Array(total); let pos=0;
    for(const c of chunks){buf.set(c,pos);pos+=c.length;}
    return buf;
  }

  function openDmoExport() {
    const meta  = readDmoMetadata();
    const fields = readDmoFields();
    const rels   = readDmoRelationships();

    const FIELD_COLS = [
      ["label",                   "Field Label"],
      ["name",                    "Field API Name"],
      ["type",                    "Data Type"],
      ["isMapped",                "Is Mapped"],
      ["isDistinct",              "Enable Value Suggestion"],
      ["keyQualifier",            "Key Qualifier"],
      ["assignedTags",            "Tags"],
      ["assignedClassifications", "Classifications"],
      ["isPrimaryKey",            "Is Primary Key"],
      ["creationType",            "Creation Type"],
      ["usageTag",                "Usage Tag"],
    ];
    const REL_COLS = [
      ["sourceEntityLabel",  "Object"],
      ["sourceFieldLabel",   "Field"],
      ["keyQualifierSource", "Key Qualifier (Field)"],
      ["cardinality",        "Cardinality"],
      ["targetEntityLabel",  "Related Object"],
      ["targetFieldLabel",   "Related Field"],
      ["keyQualifierTarget", "Key Qualifier (Related Field)"],
    ];

    const csvEsc = (s) => { const t = String(s == null ? "" : s); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const tsvEsc = (s) => String(s == null ? "" : s).replace(/\t/g, " ");
    const metaLines = (sep) => {
      const e = sep === "," ? csvEsc : tsvEsc;
      const dsList  = meta.dataStreams.map(d => d.label || d.name).join("; ");
      const dloList = meta.dataLakeObjects.map(d => d.label || d.name).join("; ");
      return [
        [e("DMO Label"),        e(meta.label)],
        [e("DMO API Name"),     e(meta.name)],
        [e("Category"),         e(meta.category)],
        [e("Mapped Data Streams"), e(dsList)],
        [e("Mapped DLOs"),      e(dloList)],
        ["",""],
      ].map(r => r.join(sep)).join("\n");
    };
    const toText = (rows, cols, sep) => {
      const e = sep === "," ? csvEsc : tsvEsc;
      return metaLines(sep) + cols.map(c => c[1]).join(sep) + "\n" +
             rows.map(r => cols.map(c => e(r[c[0]])).join(sep)).join("\n");
    };
    const download = (text, filename) => {
      try {
        const b = new Blob([text], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) {}
    };

    const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const safeFilename = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");

    if (!detailExportEl) { detailExportEl = document.createElement("div"); document.body.appendChild(detailExportEl); }
    detailExportEl.id = "dc-detail-export";
    detailExportEl.style.cssText = "position:fixed;top:4vh;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(1100px,96vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;color:#16325c;border:1px solid #c9cede;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.5);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden";

    // Build field rows HTML
    const fieldTrs = fields.map(r =>
      "<tr>" +
      "<td>" + esc(r.label) + "</td>" +
      "<td class='api'>" + esc(r.name) + "</td>" +
      "<td>" + esc(r.type) + "</td>" +
      "<td class='bool'>" + esc(r.isMapped) + "</td>" +
      "<td class='bool'>" + esc(r.isDistinct) + "</td>" +
      "<td class='mono'>" + esc(r.keyQualifier) + "</td>" +
      "<td>" + esc(r.assignedTags) + "</td>" +
      "<td>" + esc(r.assignedClassifications) + "</td>" +
      "</tr>"
    ).join("") || "<tr><td colspan='8' class='empty'>No fields found — make sure the Fields tab was opened at least once.</td></tr>";

    // Build relationship rows HTML
    const relTrs = rels.map(r =>
      "<tr>" +
      "<td>" + esc(r.sourceEntityLabel) + "<div class='sub'>" + esc(r.sourceEntity) + "</div></td>" +
      "<td>" + esc(r.sourceFieldLabel)  + "<div class='sub'>" + esc(r.sourceField)  + "</div></td>" +
      "<td class='mono'>" + esc(r.keyQualifierSource) + "</td>" +
      "<td><span class='card'>" + esc(r.cardinalityLabel || r.cardinality) + "</span> " + esc(r.cardinality) + "</td>" +
      "<td>" + esc(r.targetEntityLabel) + "<div class='sub'>" + esc(r.targetEntity) + "</div></td>" +
      "<td>" + esc(r.targetFieldLabel)  + "<div class='sub'>" + esc(r.targetField)  + "</div></td>" +
      "<td class='mono'>" + esc(r.keyQualifierTarget) + "</td>" +
      "</tr>"
    ).join("") || "<tr><td colspan='7' class='empty'>No active relationships found — switch to Relationships tab first if this is empty.</td></tr>";

    // Metadata chips
    const dsList  = meta.dataStreams.map(d   => "<span class='chip'>" + esc(d.label || d.name) + "</span>").join("") || "<span class='muted'>—</span>";
    const dloList = meta.dataLakeObjects.map(d => "<span class='chip'>" + esc(d.label || d.name) + "</span>").join("") || "<span class='muted'>—</span>";

    detailExportEl.innerHTML =
      "<style>" +
      "#dc-detail-export .hd{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#f3f6fb;border-bottom:1px solid #e0e5ee;flex-shrink:0;flex-wrap:wrap}" +
      "#dc-detail-export .hd strong{font-size:15px;flex-shrink:0}" +
      "#dc-detail-export .meta-bar{display:flex;flex-wrap:wrap;gap:6px 20px;padding:8px 16px;background:#f9fafc;border-bottom:1px solid #e0e5ee;font-size:11px;color:#5c6b8a;flex-shrink:0}" +
      "#dc-detail-export .meta-bar b{color:#16325c}" +
      "#dc-detail-export .chip{display:inline-block;padding:1px 7px;border-radius:10px;background:#e8edf6;color:#16325c;margin:1px 2px;font-size:11px}" +
      "#dc-detail-export .muted{color:#b0b7c6;font-style:italic}" +
      "#dc-detail-export .tabs{display:flex;gap:0;padding:0 16px;border-bottom:1px solid #e0e5ee;background:#fff;flex-shrink:0;flex-wrap:wrap;align-items:flex-end}" +
      "#dc-detail-export .tab{padding:9px 18px;cursor:pointer;font:600 12px -apple-system,sans-serif;color:#5c6b8a;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}" +
      "#dc-detail-export .tab.active{color:#0b5cab;border-bottom-color:#0b5cab}" +
      "#dc-detail-export .tab-actions{display:none}" +
      "#dc-detail-export .toolbar{display:flex;flex-wrap:wrap;gap:8px;padding:8px 12px;border-bottom:1px solid #e0e5ee;background:#fff;flex-shrink:0}" +
      "#dc-detail-export button{flex:1 1 120px;min-width:110px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid #0b5cab;background:#0b5cab;color:#fff;border-radius:6px;padding:7px 8px;font-weight:600;cursor:pointer;font-size:12px;text-align:center}" +
      "#dc-detail-export button.sec{background:#fff;color:#0b5cab}" +
      "#dc-detail-export button svg{flex-shrink:0}" +
      "#dc-detail-export .x{flex:0 0 auto;min-width:auto;border:none;background:transparent;color:#5c6b8a;font-size:20px;padding:0 4px;cursor:pointer;line-height:1;margin-left:4px}" +
      "#dc-detail-export .bd{overflow:auto;flex:1;min-height:0}" +
      "#dc-detail-export table{border-collapse:collapse;width:100%;font-size:12px}" +
      "#dc-detail-export th{position:sticky;top:0;background:#fff;text-align:left;padding:8px 12px;border-bottom:2px solid #e0e5ee;color:#5c6b8a;font-size:11px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}" +
      "#dc-detail-export td{padding:6px 12px;border-bottom:1px solid #eef1f6;vertical-align:top}" +
      "#dc-detail-export td.api{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#0b5cab}" +
      "#dc-detail-export td.mono{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:#6b1f9a}" +
      "#dc-detail-export td.bool{text-align:center;color:#5c6b8a}" +
      "#dc-detail-export .sub{font-family:'SF Mono',Menlo,monospace;font-size:10px;color:#8a94ab;margin-top:1px}" +
      "#dc-detail-export .card{display:inline-block;padding:1px 6px;border-radius:8px;background:#eef1f6;color:#5c6b8a;font-size:10px;margin-right:4px}" +
      "#dc-detail-export .empty{padding:24px;text-align:center;color:#8a94ab}" +
      "#dc-detail-export .sp{flex:1}" +
      "#dc-detail-export .ft{padding:6px 16px;border-top:1px solid #e0e5ee;color:#8a94ab;font-size:11px;background:#f9fafc;flex-shrink:0}" +
      "#dc-detail-export .pane{display:none}#dc-detail-export .pane.active{display:block}" +
      "</style>" +
      "<div class='hd'>" +
        "<strong>" + esc(meta.label || meta.name) + "</strong>" +
        "<span class='muted' style='font-size:11px;font-family:SF Mono,Menlo,monospace'>" + esc(meta.name) + "</span>" +
        "<span class='chip'>" + esc(meta.category || "—") + "</span>" +
        "<span class='sp'></span>" +
        "<button class='x' id='dc-d-close'>&times;</button>" +
      "</div>" +
      "<div class='meta-bar'>" +
        "<span><b>Data Stream:</b> " + dsList  + "</span>" +
        "<span><b>Data Lake Object:</b> " + dloList + "</span>" +
        (meta.description ? "<span><b>Description:</b> " + esc(meta.description) + "</span>" : "") +
      "</div>" +
      "<div class='tabs'>" +
        "<div class='tab active' id='dc-tab-fields'>Fields (" + fields.length + ")</div>" +
        "<div class='tab' id='dc-tab-rels'>Relationships (" + rels.length + ")</div>" +
      "</div>" +
      "<div class='toolbar'>" +
        "<button id='dc-d-copy'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy for Sheets</button>" +
        "<button class='sec' id='dc-d-csv'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><path d='M3 2h7l3 3v9H3z' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M10 2v3h3'/><path d='M6 9l2 2 2-2M8 7v4'/></svg>Download XLS</button>" +
      "</div>" +
      "<div class='bd'>" +
        "<div class='pane active' id='dc-pane-fields'><table><thead><tr>" +
          "<th>Field Label</th><th>Field API Name</th><th>Data Type</th><th>Is Mapped</th><th>Value Suggestion</th><th>Key Qualifier</th><th>Tags</th><th>Classifications</th>" +
        "</tr></thead><tbody>" + fieldTrs + "</tbody></table></div>" +
        "<div class='pane' id='dc-pane-rels'><table><thead><tr>" +
          "<th>Object</th><th>Field</th><th>Key Qualifier (Field)</th><th>Cardinality</th><th>Related Object</th><th>Related Field</th><th>Key Qualifier (Related)</th>" +
        "</tr></thead><tbody>" + relTrs + "</tbody></table></div>" +
      "</div>" +
      "<div class='ft' id='dc-d-ft'>" + fields.length + " field(s)</div>";

    const closeDetail = () => { if (detailExportEl) { detailExportEl.remove(); detailExportEl = null; } hideBackdrop(); };
    detailExportEl.querySelector("#dc-d-close").onclick = closeDetail;

    // Tab switching
    let activeTab = "fields";
    const tabFields = detailExportEl.querySelector("#dc-tab-fields");
    const tabRels   = detailExportEl.querySelector("#dc-tab-rels");
    const paneFields = detailExportEl.querySelector("#dc-pane-fields");
    const paneRels   = detailExportEl.querySelector("#dc-pane-rels");
    const ftEl       = detailExportEl.querySelector("#dc-d-ft");
    tabFields.onclick = () => {
      activeTab = "fields";
      tabFields.classList.add("active"); tabRels.classList.remove("active");
      paneFields.classList.add("active"); paneRels.classList.remove("active");
      ftEl.textContent = fields.length + " field(s)";
    };
    function renderRels() {
      const tbody = paneRels.querySelector("tbody");
      if (tbody) tbody.innerHTML = rels.map(r =>
        "<tr>" +
        "<td>" + esc(r.sourceEntityLabel) + "<div class='sub'>" + esc(r.sourceEntity) + "</div></td>" +
        "<td>" + esc(r.sourceFieldLabel)  + "<div class='sub'>" + esc(r.sourceField)  + "</div></td>" +
        "<td class='mono'>" + esc(r.keyQualifierSource) + "</td>" +
        "<td><span class='card'>" + esc(r.cardinalityLabel || r.cardinality) + "</span> " + esc(r.cardinality) + "</td>" +
        "<td>" + esc(r.targetEntityLabel) + "<div class='sub'>" + esc(r.targetEntity) + "</div></td>" +
        "<td>" + esc(r.targetFieldLabel)  + "<div class='sub'>" + esc(r.targetField)  + "</div></td>" +
        "<td class='mono'>" + esc(r.keyQualifierTarget) + "</td>" +
        "</tr>"
      ).join("") || "<tr><td colspan='7' class='empty'>No relationships found.</td></tr>";
    }

    // Pre-load relationships in background so the tab is ready when clicked
    let relsLoaded = false;
    setTimeout(() => {
      if (!detailExportEl) return;
      const freshRels = readDmoRelationships();
      if (freshRels.length) {
        rels.length = 0; freshRels.forEach(r => rels.push(r));
        tabRels.textContent = "Relationships (" + rels.length + ")";
        renderRels();
        relsLoaded = true;
      }
    }, 300);

    tabRels.onclick = () => {
      activeTab = "rels";
      tabRels.classList.add("active"); tabFields.classList.remove("active");
      paneRels.classList.add("active"); paneFields.classList.remove("active");
      if (!relsLoaded) {
        // Fallback: try reading again if background load got nothing
        const freshRels = readDmoRelationships();
        rels.length = 0; freshRels.forEach(r => rels.push(r));
        tabRels.textContent = "Relationships (" + rels.length + ")";
        renderRels();
        relsLoaded = true;
      }
      ftEl.textContent = rels.length + " relationship(s)";
    };

    detailExportEl.querySelector("#dc-d-copy").onclick = (e) => {
      const text = activeTab === "fields" ? toText(fields, FIELD_COLS, "\t") : toText(rels, REL_COLS, "\t");
      navigator.clipboard.writeText(text).then(() => {
        e.target.textContent = "✓ Copied!"; setTimeout(() => (e.target.innerHTML = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy for Sheets"), 1200);
      }).catch(() => {});
    };
    detailExportEl.querySelector("#dc-d-csv").onclick = () => {
      const fn = safeFilename(meta.name || meta.label || "dmo");
      const dsList  = meta.dataStreams.map(d => d.label || d.name).join("; ");
      const dloList = meta.dataLakeObjects.map(d => d.label || d.name).join("; ");
      const fieldHeader = FIELD_COLS.map(c => c[1]);
      const fieldRows   = fields.map(r => FIELD_COLS.map(c => r[c[0]] || ""));
      const relHeader = REL_COLS.map(c => c[1]);
      const relRows   = rels.map(r => REL_COLS.map(c => r[c[0]] || ""));
      // Meta as paragraph (\n) in last row A, headers bold in row 1
      const fMetaParts = [];
      if (meta.label || meta.name) fMetaParts.push("DMO: " + (meta.label || meta.name));
      if (meta.name)    fMetaParts.push("API Name: " + meta.name);
      if (meta.category) fMetaParts.push("Category: " + meta.category);
      if (dsList)       fMetaParts.push("Data Streams: " + dsList);
      if (dloList)      fMetaParts.push("DLOs: " + dloList);
      const fieldMetaRow = [fMetaParts.join("\n")];
      const relMetaRow   = [["DMO: "+(meta.label||meta.name), "API Name: "+meta.name].filter(Boolean).join("\n")];
      try {
        const xlsx = buildXlsx([
          { name: "Fields",        rows: [fieldHeader, ...fieldRows, [], fieldMetaRow], headerRow: 1 },
          { name: "Relationships", rows: [relHeader,   ...relRows,   [], relMetaRow],   headerRow: 1 },
        ], { wrapLastRow: true });
        const blob = new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fn + "-export.xlsx";
        document.body.appendChild(a); a.click(); a.remove();
      } catch(e) {
        // Fallback to CSV if XLSX builder fails
        download(toText(fields, FIELD_COLS, ","), fn + "-fields.csv");
      }
    };

    const hd = detailExportEl.querySelector(".hd"); if (hd) makeDraggable(detailExportEl, hd);
    addResizeHandle(detailExportEl, 480, 300);
    const onEsc = (e) => { if (e.key === "Escape") { closeDetail(); document.removeEventListener("keydown", onEsc, true); } };
    document.addEventListener("keydown", onEsc, true);
    const onOut = (e) => { if (detailExportEl && !detailExportEl.contains(e.target)) { closeDetail(); document.removeEventListener("pointerdown", onOut, true); } };
    setTimeout(() => document.addEventListener("pointerdown", onOut, true), 100);
  }

  // Inline names start OFF — show the control bar and wait for the user to
  // click "Show API names". Export works independently, on demand.
  // On detail pages, show a single "Download fields CSV" button instead.
  // ── Segment rules readers ─────────────────────────────────────────────────

  /* @strip:start dev
   * IN-DEVELOPMENT FEATURES — Segment rule export + Data Explorer column tooling.
   * Physically removed from the public build by build.js (@strip markers). The
   * full source keeps them so we can keep iterating; do not remove the markers. */
  function shadowEls(el) {
    try { const sr = el.shadowRoot; if (!sr) return []; return Array.from(sr.querySelectorAll("*")); } catch (e) { return []; }
  }
  function shadowTexts(el) {
    return shadowEls(el).map(e => (e.textContent || "").trim().replace(/\s+/g, " ")).filter(Boolean);
  }
  // Leaf-only shadow text tokens (childless elements), shadow-piercing, de-duped
  // in DOM order. Avoids the concatenated container blobs shadowTexts() returns.
  function leafShadowTexts(el) {
    const out = [];
    const sr = el.shadowRoot; if (!sr) return out;
    eachElement(sr, ch => {
      try {
        if (ch.shadowRoot) return;
        if ((ch.childElementCount || 0) > 0) return;
        const t = (ch.textContent || "").trim().replace(/\s+/g, " ");
        if (t && t.length < 160 && out[out.length - 1] !== t) out.push(t);
      } catch (e) {}
    });
    return out;
  }
  // Deep rendered text of an element, piercing shadow roots and INCLUDING text
  // nodes (which leafShadowTexts skips). Walks in DOM order so "Label: value"
  // stays contiguous. Used to recover bare-text-node values (e.g. the schedule
  // text after a bold "Publish Schedule:" label).
  function deepText(el) {
    let out = "";
    (function walk(node) {
      const kids = [];
      let sr = null; try { sr = node.shadowRoot; } catch (e) {}
      if (sr) for (const c of sr.childNodes) kids.push(c);
      for (const c of node.childNodes || []) kids.push(c);
      for (const c of kids) {
        if (c.nodeType === 3) { const t = c.textContent; if (t && t.trim()) out += t.replace(/\s+/g, " "); }
        else if (c.nodeType === 1) { out += " "; walk(c); }
      }
    })(el);
    return out.replace(/\s+/g, " ").trim();
  }
  // Parse a runtime_cdp-segment-builder-base-segment-item (a nested segment, and
  // the tier content of a waterfall). Confirmed via probe10 across 4 real segments:
  //   tokens: [..., "base-segment-chart-icon", <SEGMENT NAME>, "base-segment-link", ...,
  //            "Nested Publish Behavior:", <PUBLISH BEHAVIOR>, ...]
  // Name = token between the chart-icon and the link. Publish = token after the
  // "Nested Publish Behavior:" label (absent on waterfall tiers → "").
  function readBaseSegmentItem(el) {
    const toks = leafShadowTexts(el);
    const NOISE = /^(drag and drop|base-segment-chart-icon|base-segment-link|population:?|pending|remove filter|edit filter|publish schedule:?|nested publish behavior:?|info)$/i;
    let name = "";
    const iIcon = toks.findIndex(t => /base-segment-chart-icon/i.test(t));
    const iLink = toks.findIndex(t => /^base-segment-link$/i.test(t));
    if (iIcon >= 0 && toks[iIcon + 1] && !/^base-segment-link$/i.test(toks[iIcon + 1])) name = toks[iIcon + 1];
    else if (iLink > 0 && !NOISE.test(toks[iLink - 1])) name = toks[iLink - 1];
    if (!name) name = toks.find(t => !NOISE.test(t)) || "";

    // SF renders values as bare TEXT NODES next to a bold label
    // (<b>Publish Schedule:</b> Do not refresh), which leafShadowTexts (elements
    // only) misses. So read the element's deep rendered text and regex the value
    // between each label and the next known marker. Robust to how SF splits nodes.
    const full = deepText(el);
    const STOPS = ["Publish Schedule", "Nested Publish Behavior", "Edit Filter", "Remove Filter", "Calculate Population", "Add another"];
    function between(startRe) {
      const m = full.match(startRe);
      if (!m) return "";
      let rest = full.slice(m.index + m[0].length).replace(/^[:\s]+/, "");
      let cut = rest.length;
      STOPS.forEach(function (w) { const i = rest.indexOf(w); if (i >= 0 && i < cut) cut = i; });
      return rest.slice(0, cut).trim();
    }
    let schedule = between(/Publish Schedule:?/i);
    let pub = between(/Nested Publish Behavior:?/i);
    if (!pub) pub = (toks.find(t => /use (segment criteria|last published)|independent/i.test(t)) || "");
    return { name: name, publishBehavior: pub, publishSchedule: schedule };
  }

  function readSegmentName() {
    // PRIMARY (evidence-based, probe10): the segment name lives in the segment
    // wizard page header, as the leaf token right after "Segment"/"Waterfall
    // Segment" and before "Segment On". This is unambiguous — unlike scanning all
    // <h1>s, which can pick up a list-view picker overlay ("…Select a List View").
    const HEADER_TAGS = ["runtime_cdp-segment-wizard-page-header", "runtime_cdp-segment-wizard"];
    for (const tag of HEADER_TAGS) {
      let hit = null;
      eachElement(document, (el) => { if (!hit && (el.tagName || "").toLowerCase() === tag && isVisible(el)) hit = el; });
      if (!hit) continue;
      const toks = leafShadowTexts(hit);
      const iLabel = toks.findIndex(t => /^(waterfall segment|segment)$/i.test(t));
      if (iLabel >= 0 && toks[iLabel + 1] && !/^segment on$/i.test(toks[iLabel + 1])) {
        return toks[iLabel + 1].trim();
      }
      // fallback: token just before "Segment On"
      const iOn = toks.findIndex(t => /^segment on:?$/i.test(t));
      if (iOn > 0 && toks[iOn - 1] && !/^(waterfall segment|segment)$/i.test(toks[iOn - 1])) return toks[iOn - 1].trim();
    }

    // FALLBACK: scan <h1>s but reject list-view / picker noise, and prefer the
    // one inside a segment wizard host.
    const SKIP = new Set(["Data Cloud","Segments","SegmentsRecently Viewed",
      "Status","Active","Inactive","Draft","Include","Exclude","Rules","Filter","Criteria",
      "Segment On","Publish Schedule","Population"]);
    const NOISE = /(recently viewed|select a list view|list view)/i;
    const candidates = [];
    eachElement(document, (el) => {
      try {
        if ((el.tagName || "").toLowerCase() !== "h1") return;
        const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
        if (!txt || txt.length > 200 || SKIP.has(txt) || NOISE.test(txt)) return;
        if (/^(Status|Active|Inactive|Draft|Include|Exclude|Rules|Population|Filter)$/i.test(txt)) return;
        if (txt.startsWith("Segment")) candidates.push(txt.replace(/^Segment\s*/,"").trim());
        else candidates.push(txt);
      } catch (e) {}
    });
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  }

  // Determine the KIND of segment from real DOM signals only (no guessing):
  //   • "Waterfall Segment" — the wizard header shows the "Waterfall Segment" label
  //     token, OR the canvas contains a runtime_cdp-segment-builder-waterfall-container.
  //   • Otherwise use the labeled "Segment Type" form value if SF exposes one
  //     (e.g. "Dynamic"); else the header's own label token ("Segment").
  // Returns "" only if nothing is detectable — never fabricated.
  function readSegmentType() {
    // 1) structural: a waterfall container is unambiguous.
    let hasWaterfall = false;
    eachElement(document, (el) => {
      if (hasWaterfall) return;
      const t = (el.tagName || "").toLowerCase();
      if (t === "runtime_cdp-segment-builder-waterfall-container" && isVisible(el)) hasWaterfall = true;
    });
    // 2) header label token: "Waterfall Segment" or "Segment".
    let headerLabel = "";
    const HEADER_TAGS = ["runtime_cdp-segment-wizard-page-header", "runtime_cdp-segment-wizard"];
    for (const tag of HEADER_TAGS) {
      let hit = null;
      eachElement(document, (el) => { if (!hit && (el.tagName || "").toLowerCase() === tag && isVisible(el)) hit = el; });
      if (!hit) continue;
      const toks = leafShadowTexts(hit);
      const m = toks.find(t => /^(waterfall segment|dynamic segment|segment)$/i.test(t));
      if (m) { headerLabel = m.replace(/\b\w/g, c => c.toUpperCase()); break; }
    }
    if (hasWaterfall || /waterfall/i.test(headerLabel)) return "Waterfall Segment";
    // 3) a labeled "Segment Type" value, if SF renders one (e.g. Dynamic).
    const pairs = readAllFormPairs();
    const typed = (pairs.get("Segment Type") || pairs.get("Membership Type") || "").trim();
    if (typed && !/share an update|share this/i.test(typed)) return typed + (/(segment)$/i.test(typed) ? "" : " Segment");
    if (headerLabel) return headerLabel;
    return "";
  }

  function readSegmentMeta() {
    const result = { segmentOn: "", segmentType: "", publishSchedule: "", publishType: "", refreshMode: "", status: "", population: "", dataSpace: "", description: "" };
    result.segmentType = readSegmentType();
    // Read ONLY from real SF label->value form structures (slds-form-element /
    // test-id__field-label). We deliberately do NOT do fuzzy CSS-class substring
    // matching (e.g. class contains "publish") — that used to grab the Chatter
    // publisher's "Share an update…Share this" as the Publish Schedule. Every value
    // below is keyed by the literal on-screen label, so it's what SF actually shows.
    const pairs = readAllFormPairs();
    // A labeled value is only trustworthy if it isn't itself another known label and
    // isn't obvious publisher/chatter noise — guards against a mislabeled pairing.
    const NOISE = /share an update|share this|write something|post|poll|question|announcement/i;
    const val = (...keys) => {
      for (const k of keys) {
        const v = (pairs.get(k) || "").trim();
        if (v && !NOISE.test(v)) return v;
      }
      return "";
    };
    result.segmentOn       = val("Segment On", "Segmented On", "Segment on");
    result.publishSchedule = val("Publish Schedule", "Publishing Schedule", "Refresh Schedule");
    result.publishType     = val("Publish Type", "Segment Type", "Type");
    result.refreshMode     = val("Refresh Mode", "Refresh");
    result.status          = val("Segment Status", "Status");
    result.dataSpace       = val("Data Space", "Dataspace", "Data space");
    result.description     = val("Description");

    // Population: SF renders it as a big number + "N% of M total population" in the
    // population summary. Read the whole summary text and extract the count phrase.
    // (Confirmed present via probe: "89% of 96353 total population".)
    try {
      let popText = "";
      eachElement(document, (el) => {
        if (popText) return;
        const tag = (el.tagName || "").toLowerCase();
        if (tag === "runtime_cdp-population-count-summary" || tag === "runtime_cdp-segment-population-with-segment-status") {
          const t = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (/population/i.test(t)) popText = t;
        }
      });
      if (popText) {
        // pull the leading count and the "N% of M total population" if present
        const pct = popText.match(/(\d[\d,]*)\s*%\s*of\s*([\d,]+)\s*total population/i);
        const lead = popText.match(/([\d,]{2,})/);
        if (pct) result.population = (lead ? lead[1] + " — " : "") + pct[1] + "% of " + pct[2] + " total population";
        else if (lead) result.population = lead[1];
      }
    } catch (e) {}
    return result;
  }

  // SF segment tab names we know about
  const SEG_TAB_NAMES = ["Include", "Exclude", "Rank and Limit"];
  // SF may render the tab as "Rank and Limit" or "Rank and Limit" depending on version
  function normaliseTabName(t) {
    if (/rank/i.test(t)) return "Rank and Limit";
    return t;
  }

  // Returns all SF segment tab elements (role=tab with known names)
  function findSegmentTabEls() {
    const found = {};
    eachElement(document, (el) => {
      try {
        if ((el.getAttribute("role") || "") !== "tab") return;
        const raw = (el.textContent || "").trim().replace(/\s+/g, " ");
        const t = normaliseTabName(raw);
        for (const name of SEG_TAB_NAMES) {
          if (t === name || raw === name || raw.startsWith(name)) found[name] = el;
        }
      } catch (e) {}
    });
    return found;
  }

  // Which tab is currently selected
  function readActiveSegmentTab() {
    let active = "Include";
    eachElement(document, (el) => {
      try {
        if ((el.getAttribute("role") || "") !== "tab") return;
        const raw = (el.textContent || "").trim().replace(/\s+/g, " ");
        const t = normaliseTabName(raw);
        for (const name of SEG_TAB_NAMES) {
          if ((t === name || raw === name || raw.startsWith(name)) && el.getAttribute("aria-selected") === "true") active = name;
        }
      } catch (e) {}
    });
    return active;
  }

  // Click a SF tab by name and wait for SF to re-render the canvas.
  // Guards against tabs that change the URL (navigation tabs vs. panel-swap tabs).
  function switchToSegmentTab(tabName) {
    return new Promise((resolve) => {
      const tabs = findSegmentTabEls();
      const el = tabs[tabName];
      if (!el) { resolve(false); return; }
      // Already selected — no click needed
      if (el.getAttribute("aria-selected") === "true") { resolve(true); return; }
      const urlBefore = location.href;
      try { el.click(); } catch(e) { resolve(false); return; }
      // Wait for LWC re-render. 700ms is more reliable than 350ms for slow orgs.
      setTimeout(() => {
        if (location.href !== urlBefore) {
          history.back();
          resolve(false);
          return;
        }
        resolve(true);
      }, 700);
    });
  }

  // Read conditions for a specific tab: switch SF to that tab, read DOM, return {tree, flat}.
  // After reading, switches back to originalTab so the user's view is restored.
  // Returns empty tree if the tab doesn't exist or switching failed.
  async function readConditionsForTab(tabName, originalTab) {
    const switched = await switchToSegmentTab(tabName);
    if (!switched) return { tree: { type: "set", join: "AND", items: [] }, flat: [] };
    let result;
    if (tabName === "Rank and Limit") {
      // Rank/Limit panel takes longer to render than condition-sets — extra wait
      await new Promise(r => setTimeout(r, 600));
      result = readRankLimitFromDOM();
    } else {
      result = readConditionsFromDOM();
    }
    if (originalTab && originalTab !== tabName) await switchToSegmentTab(originalTab);
    return result;
  }

  function readRankLimitFromDOM() {
    // SF renders each rank/limit block as runtime_cdp-segment-builder-group-rank-limit-condition.
    // Each block contains: object label, Group By / Sort By field, Limit + count.
    const rows = [];
    const condEls = [];
    eachElement(document, el => {
      if (tagOf(el) === "runtime_cdp-segment-builder-group-rank-limit-condition" && isVisible(el))
        condEls.push(el);
    });

    condEls.forEach((condEl, ci) => {
      // Collect only LEAF text nodes from this condition's shadow tree.
      // condEl is a custom element — its content is in its shadowRoot.
      // We skip container elements (childElementCount > 0) so we never pick up
      // the entire card's concatenated textContent as a single token.
      // We also skip the inter-ruleset connector badge ("Where X is in the results of").
      const CONNECTOR_RE = /^where .+ is in the results of$/i;
      const NOISE_RE = /^(edit|delete|add|add ruleset|remove|to add a new|group your audience)$/i;
      const texts = [];
      const sr = condEl.shadowRoot;
      if (sr) {
        eachElement(sr, el => {
          try {
            if (el.shadowRoot) return;                    // has own shadow — eachElement recurses into it
            if ((el.childElementCount || 0) > 0) return; // container — skip, collect its leaf children instead
            const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
            if (!txt || txt.length < 2 || txt.length >= 120) return;
            if (CONNECTOR_RE.test(txt)) return;           // inter-ruleset connector badge
            if (NOISE_RE.test(txt)) return;               // UI chrome
            if (!isVisible(el)) return;
            texts.push(txt);
          } catch(e) {}
        });
      }
      // Deduplicate while preserving order
      const seen = new Set();
      const uniq = texts.filter(t => { if (seen.has(t)) return false; seen.add(t); return true; });

      // Token structure emitted by SF for each rank/limit block:
      //   <ObjectLabel>
      //   "Group By" | "Sort By"
      //   "<Object>.<Field>"           ← the ranked/sorted field
      //   "in Ascending order" | "in Descending order"   ← only for Sort By
      //   "Limit"
      //   "<N> <ObjectLabel> records [per group]"
      let objectLabel = "", rankType = "", rankField = "", limitVal = "";

      for (let i = 0; i < uniq.length; i++) {
        const t = uniq[i];
        if (/^(group by|sort by)$/i.test(t)) {
          rankType = t;
          // next token is the field
          if (uniq[i + 1] && !/^(limit)$/i.test(uniq[i + 1])) {
            rankField = uniq[i + 1]; i++;
            // for Sort By, stitch on optional direction token if present
            if (rankType.toLowerCase() === "sort by" && uniq[i + 1] && /^in (ascending|descending) order$/i.test(uniq[i + 1])) {
              rankField += " " + uniq[i + 1]; i++;
            }
          }
          continue;
        }
        if (/^limit$/i.test(t)) {
          if (uniq[i + 1]) { limitVal = uniq[i + 1]; i++; }
          continue;
        }
        // First remaining token is the object/DMO label
        if (!objectLabel) objectLabel = t;
      }

      // Emit one structured row per block:
      //   objectLabel = DMO name, fieldLabel = rank type, operator = rank field, values = "Limit: N ..."
      if (rankType || rankField || limitVal || objectLabel) {
        rows.push({
          objectLabel: objectLabel,
          fieldLabel:  rankType  || "",
          operator:    rankField || "",
          values:      limitVal  ? "Limit: " + limitVal : "",
        });
      } else if (uniq.length) {
        // Fallback: emit a single row with whatever text we found
        rows.push({ objectLabel: uniq[0] || "", fieldLabel: uniq.slice(1).join(" · "), operator: "", values: "" });
      }
    });

    const items = rows.map(r => ({ type: "simple", ...r, subFilters: [] }));
    const flat  = items.map((item, i) => ({
      num: i + 1,
      objectLabel: item.objectLabel,
      fieldLabel:  item.fieldLabel,
      operator:    item.operator,
      values:      item.values,
    }));
    return { tree: { type: "set", join: "AND", items }, flat };
  }

  // Returns a tree mirroring the SF canvas DOM structure.
  // Each node is one of:
  //   { type:"simple"|"aggregation"|"ci", objectLabel, fieldLabel, operator, values, subFilters:[] }
  //   { type:"set", join:"AND"|"OR", items:[] }   ← condition-set container
  function readConditionsFromDOM() {

    function getCompSummary(condEl) {
      try {
        if (condEl.shadowRoot) {
          const cs = condEl.shadowRoot.querySelector("runtime_cdp-segment-builder-comparison-summary");
          if (cs) return cs;
        }
      } catch (e) {}
      return null;
    }

    const OP_RE = /^(is equal to|is not equal to|contains|does not contain|starts with|ends with|is between|is not between|has value|has no value|is true|is false|is null|is not null|at least|at most|exactly|greater than|less than|is greater than|is less than|is in|is not in)$/i;
    const NO_VAL_RE = /^(has value|has no value|is true|is false|is null|is not null)$/i;
    // Noise tokens that appear in shadow text but are not labels/operators/values
    const NOISE_RE = /^(and|or|drag and drop|edit|delete|add|remove|filter|condition)$/i;

    function parseComparison(cs) {
      if (!cs) return { operator: "", values: "" };
      const ct = shadowTexts(cs);
      const opIdx = ct.findIndex(t => OP_RE.test(t));
      const operator = opIdx >= 0 ? ct[opIdx] : (ct[1] || ct[0] || "");
      if (NO_VAL_RE.test(operator)) return { operator, values: "" };
      const valStart = opIdx >= 0 ? opIdx + 1 : 2;
      const valParts = ct.slice(valStart).filter(t => !NOISE_RE.test(t) && t.trim());
      return { operator, values: valParts.join(", ") };
    }

    // Extract object + field labels from a condition element's shadow texts.
    // allTexts[0] is always the concatenated "ObjectField" string (confirmed by probe5).
    // Find the two separate tokens in allTexts whose concatenation equals allTexts[0].
    // That pair is guaranteed to be the object and field labels regardless of position.
    // Best-effort API names from the LWC props on/near the condition element.
    // DEFENSIVE: if `.entity.fields[]` isn't exposed, returns blanks — never
    // fabricates. Reuses the same shape entityFieldMap reads elsewhere.
    function apiNamesFor(condEl, objectLabel, fieldLabel) {
      const out = { objApi: "", fieldApi: "" };
      try {
        // walk up a few shadow hosts looking for an element exposing `.entity`
        let node = condEl;
        for (let i = 0; i < 6 && node; i++) {
          const entity = safeGet(node, "entity");
          if (entity) {
            const en = safeGet(entity, "name");
            if (typeof en === "string" && en) out.objApi = en;
            const fields = safeGet(entity, "fields");
            if (fields && typeof fields.length === "number") {
              for (let j = 0; j < fields.length; j++) {
                const f = safeGet(fields, j); if (!f) continue;
                if (safeGet(f, "label") === fieldLabel) { const nm = safeGet(f, "name"); if (typeof nm === "string") out.fieldApi = nm; break; }
              }
            }
            if (out.objApi || out.fieldApi) break;
          }
          try { const rn = node.getRootNode(); node = (rn && rn.host) ? rn.host : node.parentElement; } catch (e) { node = null; }
        }
      } catch (e) {}
      return out;
    }
    function extractLabels(condEl) {
      const allTexts = shadowTexts(condEl);
      if (!allTexts.length) return { objectLabel: "", fieldLabel: "" };
      const concat = allTexts[0]; // e.g. "Unified Individual TDIRAccount Multiline"
      // Look for pair (a, b) where a + b === concat and neither is concat itself
      for (let i = 1; i < allTexts.length; i++) {
        const a = allTexts[i];
        if (a === concat) continue;
        if (!concat.startsWith(a)) continue;
        const b = concat.slice(a.length);
        if (b && allTexts.includes(b)) {
          const objectLabel = a.replace(/:$/, "").trim(), fieldLabel = b.trim();
          const api = apiNamesFor(condEl, objectLabel, fieldLabel);
          return { objectLabel, fieldLabel, objApi: api.objApi, fieldApi: api.fieldApi };
        }
      }
      // Fallback: return empty (condition will be skipped)
      return { objectLabel: "", fieldLabel: "" };
    }

    // Get direct child condition elements of a condition-set (one level only).
    // Uses data-tid="condition-set-filter" li items in the set's shadowRoot —
    // this selector cannot cross into child custom-element shadow roots, so it's
    // guaranteed to return only direct items.
    const COND_TAGS = new Set([
      "runtime_cdp-segment-builder-simple-condition",
      "runtime_cdp-segment-builder-aggregation-condition",
      "runtime_cdp-segment-builder-calculated-insight-condition",
      "runtime_cdp-segment-builder-base-segment-item",
      "runtime_cdp-segment-builder-condition-set",
    ]);

    // Wrapper tags that may contain the real condition inside their shadowRoot
    const WRAPPER_TAGS = new Set([
      "runtime_cdp-canvas-item",
      "runtime_cdp-drag-item",
      "runtime_cdp-segment-builder-target-shim",
    ]);

    // Shadow-piercing parent (light DOM, else shadow host).
    function deepParentEl(node) {
      let p = node.parentElement;
      if (!p) { try { const rn = node.getRootNode(); if (rn && rn.host) p = rn.host; } catch (e) {} }
      return p;
    }
    // True if `el` has a COND_TAGS ancestor at or above it, but still within `li`.
    // Used to keep only the OUTERMOST condition element of each filter item.
    function hasCondAncestorWithin(el, li) {
      let node = deepParentEl(el);
      for (let i = 0; i < 40 && node && node !== li; i++) {
        if (COND_TAGS.has((node.tagName || "").toLowerCase())) return true;
        node = deepParentEl(node);
      }
      return false;
    }
    function getDirectChildren(setEl) {
      const out = [];
      const sr = setEl.shadowRoot;
      if (!sr) return out;
      let lis;
      try { lis = sr.querySelectorAll("[data-tid='condition-set-filter']"); } catch(e) { return out; }
      for (const li of lis) {
        // Collect EVERY condition element in this filter item, then keep only the
        // OUTERMOST one(s) — those with no condition ancestor inside the same li.
        // This is the fix for nested condition-sets: previously the code returned
        // the first tag in COND_TAGS order (a deep simple-condition), which threw
        // away the wrapping set and everything else in it (agg / CI / OR group).
        const all = [];
        eachElement(li, (el) => { if (COND_TAGS.has((el.tagName || "").toLowerCase())) all.push(el); });
        const outer = all.filter((el) => !hasCondAncestorWithin(el, li));
        let found = outer[0] || null;
        // Last resort: target-shim may use a slot; check its light-DOM children directly
        if (!found) {
          for (const child of li.children) {
            for (const inner of child.children) {
              if (COND_TAGS.has((inner.tagName || "").toLowerCase())) { found = inner; break; }
            }
            if (found) break;
          }
        }
        if (found) out.push(found);
      }
      return out;
    }

    // Get sub-filter conditions inside an aggregation-condition.
    // SF wraps multiple sub-filters in a condition-set, but a single sub-filter
    // may live directly in the agg's shadow without a condition-set wrapper.
    function getSubFilters(aggEl) {
      // Case 1: sub-filters wrapped in a nested condition-set (multiple filters)
      let nestedSet = null;
      eachElement(aggEl.shadowRoot || aggEl, (el) => {
        if (!nestedSet && (el.tagName || "").toLowerCase() === "runtime_cdp-segment-builder-condition-set") nestedSet = el;
      });
      if (nestedSet) {
        const joinTexts = shadowTexts(nestedSet);
        const join = (joinTexts.find(t => /^(and|or)$/i.test(t)) || "AND").toUpperCase();
        const items = [];
        for (const el of getDirectChildren(nestedSet)) {
          if ((el.tagName || "").toLowerCase() !== "runtime_cdp-segment-builder-simple-condition") continue;
          const { objectLabel, fieldLabel } = extractLabels(el);
          if (!objectLabel && !fieldLabel) continue;
          const { operator, values } = parseComparison(getCompSummary(el));
          items.push({ objectLabel, fieldLabel, operator, values });
        }
        return { items, join };
      }
      // Case 2: single sub-filter lives directly in the agg shadow (no wrapping condition-set)
      // Detect by: agg's allTexts[0] ends with the object name but the shadow also contains
      // a second "ObjectField" concatenated token that is different from the agg header.
      const aggTexts = shadowTexts(aggEl);
      // aggTexts[0] = "Object:AggFunc" (the agg header concat)
      // Look for any simple-condition elements directly inside the agg's shadow
      const items = [];
      eachElement(aggEl.shadowRoot || aggEl, (el) => {
        if ((el.tagName || "").toLowerCase() !== "runtime_cdp-segment-builder-simple-condition") return;
        const { objectLabel, fieldLabel } = extractLabels(el);
        if (!objectLabel && !fieldLabel) return;
        const { operator, values } = parseComparison(getCompSummary(el));
        items.push({ objectLabel, fieldLabel, operator, values });
      });
      return { items, join: "AND" };
    }

    // Recursively build a tree node for a condition-set element
    function buildSetNode(setEl) {
      const joinTexts = shadowTexts(setEl);
      const join = (joinTexts.find(t => /^(and|or)$/i.test(t)) || "AND").toUpperCase();
      const items = [];
      for (const el of getDirectChildren(setEl)) {
        const tag = (el.tagName || "").toLowerCase();
        if (tag === "runtime_cdp-segment-builder-condition-set") {
          items.push(buildSetNode(el));
        } else if (tag === "runtime_cdp-segment-builder-simple-condition") {
          const { objectLabel, fieldLabel, objApi, fieldApi } = extractLabels(el);
          if (!objectLabel && !fieldLabel) continue;
          const { operator, values } = parseComparison(getCompSummary(el));
          items.push({ type: "simple", objectLabel, fieldLabel, operator, values, objApi, fieldApi });
        } else if (tag === "runtime_cdp-segment-builder-aggregation-condition") {
          const { objectLabel, fieldLabel: aggFunc, objApi } = extractLabels(el);
          const { operator, values } = parseComparison(getCompSummary(el));
          const sf = getSubFilters(el);
          items.push({ type: "aggregation", objectLabel, fieldLabel: aggFunc, operator, values, subFilters: sf.items, subJoin: sf.join, objApi });
        } else if (tag === "runtime_cdp-segment-builder-calculated-insight-condition") {
          const { objectLabel, fieldLabel, objApi, fieldApi } = extractLabels(el);
          const { operator, values } = parseComparison(getCompSummary(el));
          items.push({ type: "ci", objectLabel, fieldLabel, operator, values, objApi, fieldApi });
        } else if (tag === "runtime_cdp-segment-builder-base-segment-item") {
          const bs = readBaseSegmentItem(el);
          if (bs.name) items.push({ type: "nested-segment", objectLabel: bs.name, fieldLabel: bs.publishBehavior, operator: "", values: "", publishSchedule: bs.publishSchedule });
        }
      }
      return { type: "set", join, items };
    }

    // Find the root condition-set (direct child of runtime_cdp-canvas)
    // Find the root condition-set: the one that is not contained inside any other condition-set.
    // Walk up the shadow-host chain from each set; if we hit another condition-set before
    // hitting the canvas/builder root, this set is nested — skip it.
    function isNestedInsideOtherSet(setEl) {
      let node = setEl;
      for (let i = 0; i < 30 && node; i++) {
        try {
          const rn = node.getRootNode();
          if (rn && rn !== document && rn.host) {
            node = rn.host;
            const t = (node.tagName || "").toLowerCase();
            if (t === "runtime_cdp-segment-builder-condition-set") return true;
            if (t === "runtime_cdp-segment-builder" || t === "runtime_cdp-canvas") return false;
            continue;
          }
        } catch(e) {}
        if (!node.parentElement) return false;
        node = node.parentElement;
      }
      return false;
    }
    // Scan full document (shadow-piercing) for condition-sets, then keep only
    // visible ones. SF keeps hidden tab panels in the DOM — elements inside a
    // display:none ancestor return getBoundingClientRect() of {width:0,height:0}.
    const allSets = findByTag("runtime_cdp-segment-builder-condition-set").filter(isVisible);

    // Root set = visible + not nested inside any other condition-set
    const rootCandidates = allSets.filter(s => !isNestedInsideOtherSet(s));
    const canvasSet = rootCandidates.reduce((best, s) => {
      const sr = s.shadowRoot;
      if (!sr) return best;
      let count = 0;
      try { count = sr.querySelectorAll("[data-tid='condition-set-filter']").length; } catch(e) {}
      const bestCount = best ? (() => { const bsr = best.shadowRoot; if (!bsr) return 0; try { return bsr.querySelectorAll("[data-tid='condition-set-filter']").length; } catch(e) { return 0; } })() : -1;
      return count >= bestCount ? s : best;
    }, null);

    // Fallback for segments with no condition-set (waterfall, flat nested-segment).
    // Scans full document but filters to visible elements only so hidden tab
    // canvases (Include panel when Exclude is active, etc.) are excluded.
    function buildFlatCanvasTree() {
      const FLAT_COND_TAGS = new Set([
        "runtime_cdp-segment-builder-simple-condition",
        "runtime_cdp-segment-builder-aggregation-condition",
        "runtime_cdp-segment-builder-calculated-insight-condition",
        "runtime_cdp-segment-builder-base-segment-item",
      ]);

      const allConds = [];
      eachElement(document, el => {
        if (FLAT_COND_TAGS.has((el.tagName || "").toLowerCase()) && isVisible(el)) allConds.push(el);
      });

      // Sub-filters inside an aggregation-condition are NOT top-level items — skip them
      function isInsideAgg(el) {
        let node = el;
        for (let i = 0; i < 25 && node; i++) {
          try {
            const rn = node.getRootNode();
            if (rn && rn !== document && rn.host) {
              node = rn.host;
              if ((node.tagName || "").toLowerCase() === "runtime_cdp-segment-builder-aggregation-condition") return true;
              continue;
            }
          } catch(e) {}
          node = node.parentElement;
        }
        return false;
      }

      // Waterfall? The canvas holds runtime_cdp-segment-builder-waterfall-container(s).
      // Each base-segment-item inside is one ranked tier, in DOM order = hierarchy.
      let isWaterfall = false;
      eachElement(document, el => {
        if ((el.tagName || "").toLowerCase() === "runtime_cdp-segment-builder-waterfall-container" && isVisible(el)) isWaterfall = true;
      });

      const items = [];
      let tierNum = 0;
      for (const found of allConds) {
        if (isInsideAgg(found)) continue;
        const tag = (found.tagName || "").toLowerCase();
        if (tag === "runtime_cdp-segment-builder-base-segment-item") {
          const bs = readBaseSegmentItem(found);
          if (!bs.name) continue;
          if (isWaterfall) {
            // Per SF docs (Create a Waterfall Segment): waterfall members are
            // SEGMENTS processed in PRIORITY order — NOT "nested segments" (docs
            // state nested segments can't be in a waterfall). Mark them as
            // priority segments so the renderer labels them SF's way.
            tierNum++;
            items.push({ type: "nested-segment", waterfallPriority: true, objectLabel: bs.name,
              fieldLabel: bs.publishBehavior, operator: "Priority " + tierNum, values: "", publishSchedule: bs.publishSchedule });
          } else {
            // A segment reused as a condition inside criteria = a true nested segment.
            items.push({ type: "nested-segment", objectLabel: bs.name, fieldLabel: bs.publishBehavior, operator: "", values: "", publishSchedule: bs.publishSchedule });
          }
        } else if (tag === "runtime_cdp-segment-builder-simple-condition") {
          const { objectLabel, fieldLabel } = extractLabels(found);
          if (!objectLabel && !fieldLabel) continue;
          const { operator, values } = parseComparison(getCompSummary(found));
          items.push({ type: "simple", objectLabel, fieldLabel, operator, values });
        } else if (tag === "runtime_cdp-segment-builder-aggregation-condition") {
          const { objectLabel, fieldLabel: aggFunc } = extractLabels(found);
          const { operator, values } = parseComparison(getCompSummary(found));
          const sf = getSubFilters(found);
          items.push({ type: "aggregation", objectLabel, fieldLabel: aggFunc, operator, values, subFilters: sf.items, subJoin: sf.join });
        } else if (tag === "runtime_cdp-segment-builder-calculated-insight-condition") {
          const { objectLabel, fieldLabel } = extractLabels(found);
          const { operator, values } = parseComparison(getCompSummary(found));
          items.push({ type: "ci", objectLabel, fieldLabel, operator, values });
        }
      }

      // Get join from the visible canvas. Waterfall tiers are prioritised in order
      // (not AND/OR'd) — label the set THEN so the view reads as a ranked hierarchy.
      let canvas = null;
      eachElement(document, el => { if (!canvas && (el.tagName || "").toLowerCase() === "runtime_cdp-canvas" && isVisible(el)) canvas = el; });
      const canvasTexts = canvas ? shadowTexts(canvas) : [];
      const join = isWaterfall ? "THEN" : (canvasTexts.find(t => /^(and|or)$/i.test(t)) || "AND").toUpperCase();
      return { type: "set", join, items, waterfall: isWaterfall };
    }

    let tree = canvasSet ? buildSetNode(canvasSet) : buildFlatCanvasTree();

    // ── AUTOMATIC completeness self-heal (invisible to the user) ──────────────
    // The end user trusts this blindly, so correctness is OUR job, not theirs.
    // We count the leaf conditions VISIBLE in the live canvas and compare to what
    // the structured walk captured. If the structured tree missed any (e.g. an
    // unusual nesting the set-walker didn't traverse), we silently fall back to
    // the flat full-DOM sweep, which physically cannot skip a visible element —
    // guaranteeing every condition shown in SF is in the export. No prompts, no
    // buttons, no "go check it yourself".
    function countCaptured(node, acc) {
      if (!node) return acc;
      if (node.type === "set") { (node.items || []).forEach(n => countCaptured(n, acc)); return acc; }
      if (node.type === "aggregation") { acc.n++; (node.subFilters || []).forEach(() => acc.n++); return acc; }
      acc.n++; return acc;
    }
    function countVisibleLeaves() {
      const LEAF = {
        "runtime_cdp-segment-builder-simple-condition": 1,
        "runtime_cdp-segment-builder-aggregation-condition": 1,
        "runtime_cdp-segment-builder-calculated-insight-condition": 1,
        "runtime_cdp-segment-builder-base-segment-item": 1,
      };
      let n = 0;
      eachElement(document, el => { if (LEAF[(el.tagName || "").toLowerCase()] && isVisible(el)) n++; });
      return n;
    }
    try {
      const captured = countCaptured(tree, { n: 0 }).n;
      const visible = countVisibleLeaves();
      // Only heal when the structured walk under-captured (never when it's equal
      // or when SF shows hidden dupes that inflate `visible` beyond real content).
      if (captured < visible) {
        const flatTree = buildFlatCanvasTree();
        const flatCount = countCaptured(flatTree, { n: 0 }).n;
        if (flatCount > captured) { tree = flatTree; }   // adopt the more complete result
      }
    } catch (e) { /* never let the safety net break the export */ }

    // Also produce flat rows for TSV copy (for Sheets)
    function flattenTree(node, rows, groupNum) {
      if (node.type === "set") {
        node.items.forEach((item, i) => {
          const isLast = i === node.items.length - 1;
          if (item.type === "set") {
            flattenTree(item, rows, groupNum);
          } else {
            const joinWithNext = isLast ? "" : node.join;
            rows.push({ objectLabel: item.objectLabel, fieldLabel: item.fieldLabel, operator: item.operator, values: item.values, joinWithNext });
            if (item.type === "aggregation" && item.subFilters.length) {
              item.subFilters.forEach((sf, si) => {
                rows.push({ objectLabel: "  └ " + sf.objectLabel, fieldLabel: sf.fieldLabel, operator: sf.operator, values: sf.values, joinWithNext: si < item.subFilters.length - 1 ? "AND" : "" });
              });
            }
          }
        });
      }
    }
    const flat = [];
    flattenTree(tree, flat, 1);
    return { tree, flat };
  }

  function readSegmentRules() {
    const activeTab = readActiveSegmentTab();
    const sfTabs = Object.keys(findSegmentTabEls()); // e.g. ["Include","Exclude","Rank and Limit"]
    // Waterfall / nested-segment types have no Include/Exclude tabs — default to single "Include" pane
    const availableTabs = sfTabs.length ? sfTabs : ["Include"];
    const { tree, flat } = activeTab === "Rank and Limit" ? readRankLimitFromDOM() : readConditionsFromDOM();
    return { activeTab, availableTabs, tree, flat };
  }

  // ── Segment blueprint export (MiniXLSX + kit renderer + adapter) ──────────
  // Self-contained: no CDN, no deps (Salesforce CSP blocks external scripts).
  // Produces the multi-sheet .xlsx blueprint (container bars + AND/OR rails).
  var SEGX = (function () {
    var SEGX_NS = {};
    // Classify a related object as a DLO / DMO / Calculated-Insight object PURELY
    // from the scraped API-name suffix Salesforce assigns — no guessing:
    //   __dlm = Data Model Object (DMO)   __dll/__dls = Data Lake Object (DLO)
    //   __cio = Calculated Insight object   __c/__e/(none) = leave unclassified.
    // Returns "" when the API name wasn't exposed or the suffix is unknown, so we
    // never mislabel. `label` is shown only for CI where the caller already knows.
    function objectKindFromApi(objApi) {
      var a = String(objApi || "").toLowerCase();
      if (/__dlm$/.test(a)) return "DMO";
      if (/__(dll|dls)$/.test(a)) return "DLO";
      if (/__cio$/.test(a)) return "CI";
      return "";
    }
    /* ==== mini-xlsx (dependency-free .xlsx writer) ==== */
  /* mini-xlsx.js — a tiny, dependency-free .xlsx writer that mimics the slice of
   * the ExcelJS API our blueprint renderer (renderSheet / buildSegmentWorkbookMulti)
   * actually uses. Produces a valid multi-sheet workbook via a hand-rolled
   * store-only (uncompressed) ZIP + Office Open XML. Works under Salesforce CSP
   * (no CDN, no eval, no deps) in a bookmarklet, extension, or Node.
   *
   * Supported cell surface (matches renderSheet's usage):
   *   ws.getColumn(i).width           ws.getRow(i).height
   *   ws.getCell(r,c).value           (string | number)
   *   ws.getCell(r,c).numFmt          ("0", "0.####", …)
   *   ws.getCell(r,c).font            ({bold,italic,size,color:{argb}})
   *   ws.getCell(r,c).fill            ({type:"pattern",pattern:"solid",fgColor:{argb}})
   *   ws.getCell(r,c).alignment       ({horizontal,vertical,wrapText})
   *   ws.getCell(r,c).border          ({top,bottom,left,right}: {style,color:{argb}})
   *   ws.mergeCells(r0,c0,r1,c1)
   *   wb.addWorksheet(name, {views:[…]})   (views ignored except showGridLines)
   *   await wb.xlsx.writeBuffer()      -> Uint8Array (a complete .xlsx)
   *
   * ExcelJS argb is 8-hex "AARRGGBB"; OOXML wants the same, so we pass through.
   */
  (function (root) {
    "use strict";

    // ── CRC32 (for ZIP entries) ───────────────────────────────────────────────
    var CRC_TABLE = (function () {
      var t = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
      return t;
    })();
    function crc32(bytes) {
      var c = 0xFFFFFFFF;
      for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // UTF-8 encode to a Uint8Array (TextEncoder when available; manual fallback)
    function utf8(str) {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
      var out = [], i, c;
      for (i = 0; i < str.length; i++) {
        c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
        else if (c >= 0xD800 && c <= 0xDBFF) { // surrogate pair
          var c2 = str.charCodeAt(++i);
          var u = 0x10000 + (((c & 0x3FF) << 10) | (c2 & 0x3FF));
          out.push(0xF0 | (u >> 18), 0x80 | ((u >> 12) & 0x3F), 0x80 | ((u >> 6) & 0x3F), 0x80 | (u & 0x3F));
        } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
      }
      return new Uint8Array(out);
    }

    function xmlEsc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
        // strip control chars XML forbids
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
    }

    // ── store-only ZIP ──────────────────────────────────────────────────────────
    function zipStore(files) {
      // files: [{name, data:Uint8Array}]
      var chunks = [], central = [], offset = 0;
      function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
      function u32(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF]; }
      files.forEach(function (f) {
        var nameBytes = utf8(f.name);
        var crc = crc32(f.data), sz = f.data.length;
        var local = [].concat(
          u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
          u32(crc), u32(sz), u32(sz), u16(nameBytes.length), u16(0));
        chunks.push(new Uint8Array(local)); chunks.push(nameBytes); chunks.push(f.data);
        var central1 = [].concat(
          u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
          u32(crc), u32(sz), u32(sz), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
          u32(0), u32(offset));
        central.push(new Uint8Array(central1)); central.push(nameBytes);
        offset += local.length + nameBytes.length + sz;
      });
      var centralStart = offset, centralSize = 0;
      central.forEach(function (c) { centralSize += c.length; });
      var eocd = new Uint8Array([].concat(
        u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
        u32(centralSize), u32(centralStart), u16(0)));
      var total = 0, all = chunks.concat(central, [eocd]);
      all.forEach(function (c) { total += c.length; });
      var out = new Uint8Array(total), p = 0;
      all.forEach(function (c) { out.set(c, p); p += c.length; });
      return out;
    }

    // ── styles registry (dedup fonts / fills / borders / numFmts / xfs) ──────────
    function StyleBook() {
      this.fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
      this.fills = ['<fill><patternFill patternType="none"/></fill>',
                    '<fill><patternFill patternType="gray125"/></fill>'];
      this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
      this.numFmts = {};           // code -> id (custom start at 164)
      this.nextNumFmtId = 164;
      this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
      this._xfKey = { '0': 0 };
    }
    function idxOf(arr, xml) { var i = arr.indexOf(xml); if (i < 0) { i = arr.length; arr.push(xml); } return i; }

    StyleBook.prototype.fontId = function (f) {
      if (!f) return 0;
      var s = "";
      if (f.bold) s += "<b/>";
      if (f.italic) s += "<i/>";
      s += '<sz val="' + (f.size || 11) + '"/>';
      if (f.color && f.color.argb) s += '<color rgb="' + f.color.argb + '"/>';
      s += '<name val="Calibri"/>';
      return idxOf(this.fonts, "<font>" + s + "</font>");
    };
    StyleBook.prototype.fillId = function (f) {
      if (!f || !f.fgColor || !f.fgColor.argb) return 0;
      return idxOf(this.fills,
        '<fill><patternFill patternType="solid"><fgColor rgb="' + f.fgColor.argb +
        '"/><bgColor indexed="64"/></patternFill></fill>');
    };
    StyleBook.prototype.borderId = function (b) {
      if (!b) return 0;
      var STY = { thin: "thin", medium: "medium", thick: "thick", hair: "hair", dotted: "dotted" };
      function side(tag, s) {
        if (!s || !s.style) return "<" + tag + "/>";
        var st = STY[s.style] || "thin";
        var col = (s.color && s.color.argb) ? '<color rgb="' + s.color.argb + '"/>' : "";
        return "<" + tag + ' style="' + st + '">' + col + "</" + tag + ">";
      }
      var xml = "<border>" + side("left", b.left) + side("right", b.right) +
        side("top", b.top) + side("bottom", b.bottom) + "<diagonal/></border>";
      return idxOf(this.borders, xml);
    };
    StyleBook.prototype.numFmtId = function (code) {
      if (!code) return 0;
      // built-in "0" is id 1 in the reserved range but 0 general is fine; treat "0" as builtin 1
      if (code === "0") return 1;
      if (this.numFmts[code] != null) return this.numFmts[code];
      var id = this.nextNumFmtId++;
      this.numFmts[code] = id;
      return id;
    };
    StyleBook.prototype.cellXf = function (cell) {
      var fontId = this.fontId(cell.font);
      var fillId = this.fillId(cell.fill);
      var borderId = this.borderId(cell.border);
      var numFmtId = this.numFmtId(cell.numFmt);
      var a = cell.alignment;
      var alignXml = "";
      if (a) {
        // ExcelJS accepts "middle" for vertical center; OOXML only allows "center".
        var VMAP = { middle: "center", centre: "center" };
        var HMAP = { centre: "center" };
        var attrs = "";
        if (a.horizontal) attrs += ' horizontal="' + (HMAP[a.horizontal] || a.horizontal) + '"';
        if (a.vertical) attrs += ' vertical="' + (VMAP[a.vertical] || a.vertical) + '"';
        if (a.wrapText) attrs += ' wrapText="1"';
        if (attrs) alignXml = "<alignment" + attrs + "/>";
      }
      var applyAlign = alignXml ? ' applyAlignment="1"' : "";
      var xf = '<xf numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId +
        '" borderId="' + borderId + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1"' +
        applyAlign + (alignXml ? ">" + alignXml + "</xf>" : "/>");
      var key = xf;
      if (this._xfKey[key] != null) return this._xfKey[key];
      var i = this.xfs.length; this.xfs.push(xf); this._xfKey[key] = i; return i;
    };
    StyleBook.prototype.xml = function () {
      var self = this;
      var numFmtXml = "";
      var codes = Object.keys(this.numFmts);
      if (codes.length) {
        numFmtXml = '<numFmts count="' + codes.length + '">' +
          codes.map(function (c) { return '<numFmt numFmtId="' + self.numFmts[c] + '" formatCode="' + xmlEsc(c) + '"/>'; }).join("") +
          "</numFmts>";
      }
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        numFmtXml +
        '<fonts count="' + this.fonts.length + '">' + this.fonts.join("") + '</fonts>' +
        '<fills count="' + this.fills.length + '">' + this.fills.join("") + '</fills>' +
        '<borders count="' + this.borders.length + '">' + this.borders.join("") + '</borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="' + this.xfs.length + '">' + this.xfs.join("") + '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>';
    };

    // ── column-letter helper (1 -> A, 27 -> AA) ──────────────────────────────────
    function colLetter(n) {
      var s = "";
      while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = ((n - m) / 26) | 0; }
      return s;
    }

    // ── Cell / Row / Column / Worksheet / Workbook ───────────────────────────────
    function Cell() {
      this.value = null; this.numFmt = null;
      this.font = null; this.fill = null; this.alignment = null; this.border = null;
    }
    function Worksheet(name, opts) {
      this.name = name; this.opts = opts || {};
      this._cells = {};      // "r,c" -> Cell
      this._cols = {};       // c -> {width}
      this._rows = {};       // r -> {height}
      this._merges = [];     // [r0,c0,r1,c1]
      this._maxR = 0; this._maxC = 0;
    }
    Worksheet.prototype.getCell = function (r, c) {
      var k = r + "," + c, cell = this._cells[k];
      if (!cell) { cell = new Cell(); this._cells[k] = cell; }
      if (r > this._maxR) this._maxR = r;
      if (c > this._maxC) this._maxC = c;
      return cell;
    };
    Worksheet.prototype.getColumn = function (c) {
      var col = this._cols[c]; if (!col) { col = {}; this._cols[c] = col; } return col;
    };
    Worksheet.prototype.getRow = function (r) {
      var row = this._rows[r]; if (!row) { row = {}; this._rows[r] = row; } return row;
    };
    Worksheet.prototype.mergeCells = function (r0, c0, r1, c1) {
      this._merges.push([r0, c0, r1, c1]);
      if (r1 > this._maxR) this._maxR = r1;
      if (c1 > this._maxC) this._maxC = c1;
    };

    // Auto-fit so nothing is clipped on open (Excel does NOT auto-fit generated
    // files, and merged cells never grow row height on their own). Computes:
    //  • column widths from the longest SINGLE-column cell (horizontally-merged
    //    cells are excluded so a long title/note can't blow out one column),
    //    clamped to [min,max];
    //  • row heights for wrapped cells from text length ÷ the (possibly merged)
    //    width, honouring bold (~10% wider glyphs) and explicit newlines.
    // opts: { min:[], max:[] } — per-column width clamps by 1-based index.
    Worksheet.prototype.autoSize = function (opts) {
      opts = opts || {};
      var mins = opts.min || [], maxs = opts.max || [];
      // merge maps: horizontal span (for width) + vertical span (for height).
      var hSpan = {}, hCovered = {}, vSpan = {}, vCovered = {};
      this._merges.forEach(function (m) {
        var r0 = m[0], c0 = m[1], r1 = m[2], c1 = m[3];
        if (c1 > c0) { hSpan[r0 + "," + c0] = c1 - c0 + 1; for (var c = c0 + 1; c <= c1; c++) hCovered[r0 + "," + c] = 1; }
        if (r1 > r0) { vSpan[r0 + "," + c0] = r1 - r0 + 1; for (var r = r0 + 1; r <= r1; r++) vCovered[r + "," + c0] = 1; }
      });
      function textLen(v) { return v == null ? 0 : String(v).replace(/\s+/g, " ").length; }
      function isBold(cell) { return !!(cell && cell.font && cell.font.bold); }

      // ── column widths: measure only cells that occupy a SINGLE column ─────────
      for (var c = 1; c <= this._maxC; c++) {
        var w = 0;
        for (var r = 1; r <= this._maxR; r++) {
          var key = r + "," + c;
          if (hCovered[key] || hSpan[key]) continue;   // spans multiple columns → don't size one col to it
          var cell = this._cells[key]; if (!cell) continue;
          var len = textLen(cell.value); if (isBold(cell)) len = Math.ceil(len * 1.08);
          if (len > w) w = len;
        }
        if (w) {
          var col = this.getColumn(c);
          var lo = mins[c - 1] != null ? mins[c - 1] : 6;
          var hi = maxs[c - 1] != null ? maxs[c - 1] : 48;
          var want = Math.min(hi, Math.max(lo, w + 2));
          if (!col.width || col.width < want) col.width = want;
        }
      }

      // ── row heights: wrap-aware, honouring BOTH merge directions ──────────────
      // A vertically-merged wrapped cell (e.g. the per-block Notes) is satisfied by
      // the SUM of its spanned rows, so distribute its needed height across them
      // instead of forcing it all onto the first row.
      var LINE = 15, self = this;
      var rowNeed = {};
      function bump(r, h) { if (!rowNeed[r] || rowNeed[r] < h) rowNeed[r] = h; }
      for (var rr = 1; rr <= this._maxR; rr++) {
        for (var cc = 1; cc <= this._maxC; cc++) {
          var k = rr + "," + cc;
          if (hCovered[k] || vCovered[k]) continue;      // not an anchor
          var cel = this._cells[k]; if (!cel || cel.value == null || cel.value === "") continue;
          if (!(cel.alignment && cel.alignment.wrapText)) continue;
          var cspan = hSpan[k] || 1, widthChars = 0;
          for (var sc = cc; sc < cc + cspan; sc++) widthChars += ((this._cols[sc] && this._cols[sc].width) || 8.43);
          var perLine = Math.max(8, Math.floor(widthChars * 1.05));
          var lines = 0;
          String(cel.value).split("\n").forEach(function (seg) { lines += Math.max(1, Math.ceil((seg.replace(/\s+/g, " ").length || 1) / perLine)); });
          var need = lines * LINE + 4;
          var rspan = vSpan[k] || 1;
          if (rspan === 1) { bump(rr, need); }
          else {
            // distribute across the merged rows; only raise the deficit vs default
            var per = Math.ceil(need / rspan);
            for (var vr = rr; vr < rr + rspan; vr++) bump(vr, per);
          }
        }
      }
      Object.keys(rowNeed).forEach(function (rs) {
        var r = +rs, row = self.getRow(r), target = rowNeed[r];
        if (!row.height || row.height < target) row.height = target;
      });
    };

    // Serialize the SAME cells/merges/styles to an HTML <table> so "Copy for Sheets"
    // pastes the identical blueprint grid that Download Excel produces. Honors
    // rowspan/colspan (merges), fills, fonts, alignment, and borders.
    Worksheet.prototype.toHtmlTable = function () {
      var self = this;
      // map top-left of each merge -> {rs,cs}; and every covered cell -> "skip"
      var anchor = {}, covered = {};
      this._merges.forEach(function (m) {
        var r0 = m[0], c0 = m[1], r1 = m[2], c1 = m[3];
        anchor[r0 + "," + c0] = { rs: r1 - r0 + 1, cs: c1 - c0 + 1 };
        for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) if (!(r === r0 && c === c0)) covered[r + "," + c] = 1;
      });
      function cssOf(cell) {
        var s = "border:1px solid #d0d5de;padding:3px 7px;font-family:Calibri,Arial,sans-serif;";
        if (cell) {
          if (cell.fill && cell.fill.fgColor && cell.fill.fgColor.argb) s += "background:#" + cell.fill.fgColor.argb.slice(2) + ";";
          if (cell.font) {
            if (cell.font.bold) s += "font-weight:700;";
            if (cell.font.italic) s += "font-style:italic;";
            if (cell.font.size) s += "font-size:" + cell.font.size + "px;";
            if (cell.font.color && cell.font.color.argb) s += "color:#" + cell.font.color.argb.slice(2) + ";";
          }
          var a = cell.alignment;
          if (a) {
            if (a.horizontal) s += "text-align:" + a.horizontal + ";";
            var v = a.vertical === "middle" ? "middle" : a.vertical;
            if (v) s += "vertical-align:" + v + ";";
          }
        }
        return s;
      }
      var out = "<table style='border-collapse:collapse;font-size:12px'>";
      for (var r = 1; r <= this._maxR; r++) {
        out += "<tr>";
        for (var c = 1; c <= this._maxC; c++) {
          var key = r + "," + c;
          if (covered[key]) continue;
          var cell = this._cells[key];
          var span = anchor[key] || { rs: 1, cs: 1 };
          var attrs = (span.rs > 1 ? " rowspan='" + span.rs + "'" : "") + (span.cs > 1 ? " colspan='" + span.cs + "'" : "");
          var v = cell ? cell.value : "";
          var txt = (v == null ? "" : String(v)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          out += "<td" + attrs + " style='" + cssOf(cell) + "'>" + txt + "</td>";
        }
        out += "</tr>";
      }
      return out + "</table>";
    };

    Worksheet.prototype._sheetXml = function (styles) {
      var self = this, gridOff = false;
      try {
        var v = this.opts.views && this.opts.views[0];
        if (v && v.showGridLines === false) gridOff = true;
      } catch (e) {}

      // <cols>
      var colsXml = "";
      var colKeys = Object.keys(this._cols).map(Number).sort(function (a, b) { return a - b; });
      if (colKeys.length) {
        colsXml = "<cols>" + colKeys.map(function (c) {
          var w = self._cols[c].width;
          return '<col min="' + c + '" max="' + c + '" width="' + (w || 8.43) + '" customWidth="1"/>';
        }).join("") + "</cols>";
      }

      // rows
      var rowsXml = "";
      for (var r = 1; r <= this._maxR; r++) {
        var cellsXml = "", any = false;
        for (var c = 1; c <= this._maxC; c++) {
          var cell = this._cells[r + "," + c];
          if (!cell) continue;
          var ref = colLetter(c) + r;
          var sIdx = styles.cellXf(cell);
          var sAttr = sIdx ? ' s="' + sIdx + '"' : "";
          var v = cell.value;
          if (v == null || v === "") { cellsXml += '<c r="' + ref + '"' + sAttr + '/>'; any = true; continue; }
          if (typeof v === "number" && isFinite(v)) {
            cellsXml += '<c r="' + ref + '"' + sAttr + '><v>' + v + "</v></c>";
          } else {
            cellsXml += '<c r="' + ref + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + "</t></is></c>";
          }
          any = true;
        }
        var rowMeta = this._rows[r];
        var htAttr = (rowMeta && rowMeta.height) ? ' ht="' + rowMeta.height + '" customHeight="1"' : "";
        if (any || htAttr) rowsXml += '<row r="' + r + '"' + htAttr + ">" + cellsXml + "</row>";
      }

      var mergeXml = "";
      if (this._merges.length) {
        mergeXml = '<mergeCells count="' + this._merges.length + '">' +
          this._merges.map(function (m) {
            return '<mergeCell ref="' + colLetter(m[1]) + m[0] + ":" + colLetter(m[3]) + m[2] + '"/>';
          }).join("") + "</mergeCells>";
      }

      var dim = "A1:" + colLetter(Math.max(1, this._maxC)) + Math.max(1, this._maxR);
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<dimension ref="' + dim + '"/>' +
        '<sheetViews><sheetView' + (gridOff ? ' showGridLines="0"' : "") + ' workbookViewId="0"/></sheetViews>' +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        colsXml +
        "<sheetData>" + rowsXml + "</sheetData>" +
        mergeXml +
        "</worksheet>";
    };

    function Workbook() {
      this._sheets = [];
      var self = this;
      this.xlsx = { writeBuffer: function () { return Promise.resolve(self._build()); } };
    }
    Workbook.prototype.addWorksheet = function (name, opts) {
      var ws = new Worksheet(name || ("Sheet" + (this._sheets.length + 1)), opts);
      this._sheets.push(ws); return ws;
    };
    Workbook.prototype._build = function () {
      var styles = new StyleBook();
      var self = this;
      // render sheets first so the style book is populated
      var sheetXmls = this._sheets.map(function (ws) { return ws._sheetXml(styles); });

      var files = [];
      function add(name, str) { files.push({ name: name, data: utf8(str) }); }

      add("[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        self._sheets.map(function (ws, i) {
          return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join("") +
        "</Types>");

      add("_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>");

      var sheetsMeta = this._sheets.map(function (ws, i) {
        return '<sheet name="' + xmlEsc(ws.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join("");
      add("xl/workbook.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        "<sheets>" + sheetsMeta + "</sheets></workbook>");

      var relRows = this._sheets.map(function (ws, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join("");
      var stylesRid = "rId" + (this._sheets.length + 1);
      add("xl/_rels/workbook.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        relRows +
        '<Relationship Id="' + stylesRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>");

      sheetXmls.forEach(function (xml, i) { add("xl/worksheets/sheet" + (i + 1) + ".xml", xml); });
      add("xl/styles.xml", styles.xml());

      return zipStore(files);
    };

    var api = { Workbook: Workbook };
    { root.MiniXLSX = api; }
  })(SEGX_NS);

    /* ==== blueprint renderer (container bars + AND/OR rails) ==== */
  /* render-xlsx.js — build the single-tab blueprint workbook with ExcelJS.
   * Browser (extension) friendly: bundle ExcelJS, call downloadSegmentXLSX(tree).
   * Mirrors the validated openpyxl layout: container header bars + member rows,
   * and right-side rails inner(H) / mid(I) / outer(J), one merged bar each.
   *
   *   import ExcelJS from "exceljs";           // or <script src=".../exceljs.min.js">
   *   const buf = await buildSegmentWorkbook(ExcelJS, tree);
   *   // extension: chrome.downloads / <a download>; the demo uses saveAs
   */
  (function (root) {
    const ENTITY = {
      "Unified Individual TDIR":                ["DCE9F5", "9DC3E6"],
      "Individual Additional Information":       ["E2EFDA", "A9D08E"],
      "Insurance Policy":                        ["FFF2CC", "FFD966"],
      "Unified Indv Contact Point Email TDIR":   ["E6E0F0", "B4A7D6"],
      "Exact_10_Tier_Splits":                    ["F2F2F2", "D9D9D9"],
    };
    const FALLBACK = ["EEF3FA", "C9D6E5"];
    const HEADER_FILL = "1F3864", TITLE_FILL = "2E5496";
    const AND = "008000", OR = "C55A11", GRID = "BFBFBF", BLOCK = "404040";
    const AND_BAR = "EAF3E2", AND_OUTER = "C6E0B4", OR_BAR = "FCE4D6", NOTE = "FBFBFB";
    const col = (e) => ENTITY[e] || FALLBACK;

    // If entity is empty and the attribute is "<ObjectApiName> <FieldApiName>"
    // (last whitespace-token looks like an API name, i.e. has an underscore),
    // split it so the object lands in the Object/Entity column and the field in
    // Attribute. e.g. "" + "Exact_10_Tier_Splits Control_5_Pct__c"
    //   -> entity "Exact_10_Tier_Splits", attr "Control_5_Pct__c".
    // Conservative: only fires when entity is blank AND the trailing token has "_",
    // so plain phrases ("Data Source Object", "Days to Expiration") are untouched.
    function splitEntityAttr(entity, attr) {
      let e = entity || "", a = attr || "";
      if (!e && / /.test(a)) {
        const toks = a.split(/\s+/), last = toks[toks.length - 1];
        if (toks.length >= 2 && /_/.test(last)) { e = toks.slice(0, -1).join(" "); a = last; }
      }
      return { entity: e, attr: a };
    }

    // Write a value cell as a real number when it round-trips exactly (so "83"/"93"
    // become numbers and lose Excel's green "stored as text" flag), otherwise as
    // text. Rejects leading-zero / oversized ids to avoid mangling codes.
    function setValueCell(cell, raw) {
      const s = String(raw == null ? "" : raw).trim();
      const bare = s.replace(/,/g, "");
      if (/^-?\d{1,15}(\.\d+)?$/.test(bare) && String(Number(bare)) === bare) {
        cell.value = Number(bare);
        cell.numFmt = bare.indexOf(".") >= 0 ? "0.####" : "0";
      } else {
        cell.value = raw;
      }
    }

    // ---- flatten the tree into printable blocks (mirrors the Python model) ----
    // Each block => { entity, container, agg, note, groups:[{grp,box,join,rows:[{attr,op,v1,v2}]}], blockJoin }
    function flatten(tree) {
      const blocks = [];
      const kids = tree.children;
      kids.forEach((node, i) => {
        const blockJoin = i < kids.length - 1 ? (tree.join || "AND") : "";
        if (node.t === "cond") {
          blocks.push({ entity: node.entity, container: false, agg: "", blockJoin, kind: node.kind || "direct", note: node.note || "",
            groups: [{ grp: "", box: false, join: "", rows: [row(node)] }] });
        } else if (node.t === "rank") {
          // Rank & Limit block: header = object. These are SETTINGS (Sort/Group By,
          // Limit) — not attribute/operator/value conditions — so mark setting:true
          // and render them as "Label: value" property lines (see renderSheet).
          const rrows = [];
          if (node.rankType) rrows.push({ label: node.rankType, value: node.rankField || "", setting: true, entity: node.entity });
          if (node.limit)    rrows.push({ label: "Limit", value: node.limit, setting: true, entity: node.entity });
          if (!rrows.length) rrows.push({ label: node.attr || "(rank & limit)", value: "", setting: true, entity: node.entity });
          blocks.push({ entity: node.entity, container: true, agg: "Rank & Limit", blockJoin, kind: "rank", note: node.note || "",
            groups: [{ grp: "", box: false, join: "AND", rows: rrows, descriptive: true }] });
        } else if (node.t === "nested") {
          // Two distinct SF concepts (per docs):
          //  • Waterfall member = a Segment processed in PRIORITY order ("Priority N").
          //  • Nested Segment    = a segment reused as a condition inside criteria.
          // Publish Schedule / Publish Behavior are SETTINGS (not attr/op/value), so
          // they're setting:true → written as "Label: value" property lines.
          const label = node.waterfall
            ? (node.tier ? node.tier + " · Segment" : "Segment")
            : "Nested Segment";
          const nrows = [];
          if (node.sched) nrows.push({ label: "Publish Schedule", value: node.sched, setting: true, entity: node.entity });
          if (node.pub)   nrows.push({ label: "Publish Behavior", value: node.pub, setting: true, entity: node.entity });
          // If the nested segment exposes no publish settings, show ONLY the header
          // bar — no redundant "(no extra settings shown)" filler row. The header
          // already states it's a nested segment; the empty row was pure noise.
          blocks.push({ entity: node.entity, container: true, agg: label, blockJoin, kind: node.waterfall ? "priority" : "nested", note: node.note || "",
            groups: [{ grp: "", box: false, join: "AND", rows: nrows, descriptive: true }] });
        } else if (node.t === "container") {
          blocks.push({ entity: node.entity, container: true, agg: node.agg, blockJoin, kind: node.kind || "related", note: node.note || "",
            groups: [{ grp: "", box: false, join: node.join, rows: flattenRows(node.children) }] });
        } else if (node.t === "group") {
          // group of conds/containers => one block with multiple groups joined by node.join.
          // Each sub-group keeps its OWN kind (related/direct/ci) + objApi + how-to note,
          // so a Calculated Insight (or DLO/DMO related object) nested in a group is not
          // lost from the Notes column — it's labeled just like a top-level block.
          const groups = node.children.map((child, gi) => {
            const label = "G" + (i + 1) + "." + "abcdefgh"[gi];
            if (child.t === "container")
              return { grp: label, box: true, join: gi < node.children.length - 1 ? node.join : "",
                       rows: flattenRows(child.children), header: child.entity, agg: child.agg,
                       kind: child.kind || "related", objApi: child.objApi || "", note: child.note || "" };
            if (child.t === "group")   // nested pair (insurer matrix)
              return { grp: label, box: true, join: gi < node.children.length - 1 ? node.join : "",
                       rows: flattenRows(child.children), header: null, innerJoin: child.join,
                       note: "Sub-group joined internally by " + (child.join || "AND") + "." };
            return { grp: label, box: true, join: gi < node.children.length - 1 ? node.join : "",
                     rows: [row(child)], header: null, kind: child.kind || "direct",
                     objApi: child.objApi || "", note: child.note || "" };
          });
          // Note for the whole grouped block: describe the OR/AND-of-groups shape.
          const gnote = "Grouped block: " + node.children.length + " sub-group(s) joined by " +
            (node.join || "AND") + ". Build each sub-group, then combine them with " + (node.join || "AND") + ".";
          blocks.push({ entity: node.children[0].entity || rowEntity(node), container: false,
            agg: "", blockJoin, groups, groupOp: node.join, kind: "group", note: gnote });
        }
      });
      return blocks;
    }
    const row = (n) => {
      const s = splitEntityAttr(n.entity, n.attr);
      return { attr: s.attr, op: n.op, v1: n.v1 || "", v2: n.v2 || "", entity: s.entity };
    };
    // flatten a list of nodes (which may include nested groups) into flat cond rows
    function flattenRows(nodes) {
      const out = [];
      (nodes || []).forEach((n) => {
        if (!n) return;
        if (n.t === "cond") out.push(row(n));
        else if (n.children) out.push(...flattenRows(n.children));   // group/container → dig in
      });
      return out;
    }
    const rowEntity = (g) => (g.children[0] && (g.children[0].entity ||
                       (g.children[0].children && g.children[0].children[0].entity))) || "";

    // render one tab's tree onto a given worksheet (shared by single + multi-sheet)
    function renderSheet(ws, tree) {
      const NCOLS = 11;
      const widths = [5, 7, 27, 26, 12, 24, 8, 6, 6, 9, 34];
      widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
      const thin = { style: "thin", color: { argb: "FF" + GRID } };
      const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + argb } });
      const border = (r, c, sides) => { ws.getCell(r, c).border = Object.assign(ws.getCell(r, c).border || {}, sides); };
      function boxRange(r0, r1, c0, c1, style, argb) {
        const s = { style, color: { argb: "FF" + argb } };
        for (let c = c0; c <= c1; c++) { border(r0, c, { top: s }); border(r1, c, { bottom: s }); }
        for (let r = r0; r <= r1; r++) { border(r, c0, { left: s }); border(r, c1, { right: s }); }
      }

      // Title + subtitle
      ws.mergeCells(1, 1, 1, NCOLS);
      let t = ws.getCell(1, 1); t.value = "DATA CLOUD SEGMENT BLUEPRINT — " + (tree.tab || "Include");
      t.font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
      t.fill = fill(TITLE_FILL); t.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 22;
      ws.mergeCells(2, 1, 2, NCOLS);
      let s = ws.getCell(2, 1);
      s.value = "How to read: each dark header bar is a container (Entity : Count At Least N) with its member rows below; direct attributes are single rows. "
              + "The three right-hand columns show the AND/OR logic at each level — 'Join in group' joins rows inside one block, 'Join groups' joins a group-of-groups like (A OR B), 'Join all blocks' is the top-level join across everything. "
              + "A join only appears when it actually connects 2+ items. Colours: green = AND, orange = OR, blue = Priority (waterfall tier order).";
      s.font = { italic: true, size: 9, color: { argb: "FF333333" } };
      s.fill = fill("EAEFF7"); s.alignment = { wrapText: true, vertical: "middle" };
      ws.getRow(2).height = 34;

      // Header row. The three right-hand "join" columns are scoped, narrow→wide:
      //   Join in group  = joins rows WITHIN one grouped block (thin)
      //   Join groups    = joins a group-of-groups, e.g. (A OR B) (medium)
      //   Join all blocks= the top-level join across every block (thick)
      const HEAD = ["Blk#", "Group /\nNest", "Object / Entity\n(container header)", "Attribute",
        "Operator", "Value 1", "Value 2", "Join in\ngroup", "Join\ngroups", "Join all\nblocks", "Notes"];
      HEAD.forEach((h, i) => {
        const cell = ws.getCell(3, i + 1); cell.value = h;
        cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
        cell.fill = fill(HEADER_FILL); cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        boxRange(3, 3, i + 1, i + 1, "thin", GRID);
      });
      ws.getRow(3).height = 40;

      // empty tab: write a clear note instead of a blank sheet
      if (!tree.children || !tree.children.length) {
        ws.mergeCells(4, 1, 4, NCOLS);
        const em = ws.getCell(4, 1);
        em.value = "(No criteria on the " + (tree.tab || "this") + " tab.)";
        em.font = { italic: true, size: 11, color: { argb: "FF888888" } };
        em.alignment = { horizontal: "center", vertical: "middle" };
        ws.getRow(4).height = 24;
        return;
      }

      // Data rows
      const INNER = 8, MID = 9, OUTER = 10, NOTES = 11, ENT = 3, ATTR = 4, OPC = 5, V1 = 6, V2 = 7;
      const blocks = flatten(tree);
      let r = 4; const dataFirst = 4;
      const records = [];
      // Inline TYPE tag shown on the block header (or the entity cell for bare direct
      // attributes) so it's obvious what to drag. Derived from the scraped kind.
      const KIND_TAG = { direct: "DIRECT", related: "RELATED ATTR", ci: "CALC INSIGHT", nested: "NESTED SEG", priority: "SEGMENT", rank: "RANK & LIMIT" };
      for (const blk of blocks) {
        const [light, dark] = col(blk.entity);
        const blockStart = r; const groupsMeta = [];
        let bi = blocks.indexOf(blk);
        for (let gi = 0; gi < blk.groups.length; gi++) {
          const grp = blk.groups[gi]; const grpStart = r;
          // container / group header bar
          const headerEntity = grp.header || (blk.container ? blk.entity : null);
          if (headerEntity) {
            ws.mergeCells(r, ENT, r, V2);
            const hc = ws.getCell(r, ENT);
            // Inline TYPE tag so it's obvious what to drag, right on the header
            // (not just in the far Notes column). Derived from the scraped kind.
            const k = grp.kind || blk.kind;
            const tag = KIND_TAG[k] ? "[" + KIND_TAG[k] + "]  " : "";
            hc.value = "▦  " + tag + headerEntity + ((grp.agg || blk.agg) ? "     ·     " + (grp.agg || blk.agg) : "");
            hc.font = { bold: true, size: 10, color: { argb: "FF1A1A1A" } };
            hc.fill = fill(col(headerEntity)[1]); hc.alignment = { horizontal: "left", vertical: "middle" };
            for (let c = ENT; c <= V2; c++) { ws.getCell(r, c).fill = fill(col(headerEntity)[1]); boxRange(r, r, c, c, "thin", GRID); }
            ws.getRow(r).height = 18; r++;
          }
          const attrStart = r;
          grp.rows.forEach((row, ri) => {
            ws.getCell(r, 1).value = bi + 1; ws.getCell(r, 1).font = { bold: true, size: 11 };
            ws.getCell(r, 1).alignment = { horizontal: "center", vertical: "middle" };
            ws.getCell(r, 2).value = grp.grp; ws.getCell(r, 2).font = { size: 8, italic: true, color: { argb: "FF7030A0" } };
            ws.getCell(r, 2).alignment = { horizontal: "center", vertical: "middle" };
            const isMember = !!headerEntity;
            // SETTING rows (nested-segment publish settings, rank/limit) are NOT
            // attribute/operator/value conditions. Render as one merged
            // "Label: value" property line across ATTR→V2 so nothing masquerades as
            // a queryable field with an operator.
            if (row.setting) {
              ws.mergeCells(r, ATTR, r, V2);
              const pc = ws.getCell(r, ATTR);
              pc.value = "•  " + row.label + (row.value ? ":   " + row.value : "");
              pc.font = { size: 9, italic: true, color: { argb: "FF44546A" } };
              pc.alignment = { horizontal: "left", vertical: "middle" };
              for (let c = ATTR; c <= V2; c++) ws.getCell(r, c).fill = fill(light);
              const scols = [1, 2, ATTR, NOTES];
              scols.forEach((c) => boxRange(r, r, c, c, "thin", GRID));
              ws.getRow(r).height = 16; r++;
              return;
            }
            if (isMember) { ws.getCell(r, ATTR).value = "•  " + row.attr; }
            else {
              const ec = ws.getCell(r, ENT);
              // No header bar on a bare direct attribute → put the TYPE tag inline on
              // the entity cell (first row only) so it reads like the container blocks.
              const dtag = (ri === 0 && KIND_TAG[blk.kind]) ? "[" + KIND_TAG[blk.kind] + "]  " : "";
              ec.value = dtag + (row.entity || blk.entity);
              ec.font = { bold: true, size: 9, color: { argb: "FF1A1A1A" } }; ec.fill = fill(col(row.entity || blk.entity)[1]);
              ec.alignment = { horizontal: "left", vertical: "middle" };
              ws.getCell(r, ATTR).value = row.attr;
            }
            ws.getCell(r, ATTR).alignment = { horizontal: "left", vertical: "middle" };
            const fo = ws.getCell(r, OPC); fo.value = row.op; fo.alignment = { horizontal: "center", vertical: "middle" };
            fo.font = { size: 9, color: { argb: "FF1F3864" } }; fo.fill = fill("F2F2F2");
            setValueCell(ws.getCell(r, V1), row.v1); ws.getCell(r, V1).alignment = { horizontal: "left", vertical: "middle" };
            setValueCell(ws.getCell(r, V2), row.v2); ws.getCell(r, V2).alignment = { horizontal: "center", vertical: "middle" };
            const from = isMember ? ATTR : ENT;
            for (let c = from; c <= V2; c++) if (!(isMember === false && c === ENT)) ws.getCell(r, c).fill = fill(light);
            const cols = [1, 2]; for (let c = ENT; c <= V2; c++) cols.push(c); cols.push(NOTES);
            cols.forEach((c) => boxRange(r, r, c, c, "thin", GRID));
            ws.getRow(r).height = 16; r++;
          });
          const attrEnd = r - 1;
          if (grpStart !== r - 1) ws.mergeCells(grpStart, 2, r - 1, 2);
          if (grp.box) boxRange(grpStart, r - 1, ENT, V2, "medium", "7030A0");
          groupsMeta.push({ attrStart, attrEnd, grpStart, grpEnd: r - 1, kind: grp.kind, objApi: grp.objApi, note: grp.note,
            nrows: grp.rows.length, descriptive: !!grp.descriptive,
            within: (grp.rows[0] && grp.innerJoin) || grp.join || "AND" });
        }
        const blockEnd = r - 1;
        if (blockStart !== blockEnd) ws.mergeCells(blockStart, 1, blockEnd, 1);
        // Migration note: type tag + how-to-build text, in the Notes column. For a
        // GROUPED block we write PER-SUB-GROUP notes so each sub-container's type
        // (Direct / Related DLO|DMO / Calculated Insight / Nested) is documented —
        // otherwise a CI nested in an OR group would be lost from the Notes column.
        const TYPE_LABEL = { direct: "DIRECT ATTRIBUTE", related: "RELATED ATTRIBUTE", ci: "CALCULATED INSIGHT", nested: "NESTED SEGMENT", priority: "SEGMENT (PRIORITY)", rank: "RANK & LIMIT", group: "GROUPED (AND/OR)" };
        const writeNote = (r0, r1, label, text) => {
          if (r1 > r0) ws.mergeCells(r0, NOTES, r1, NOTES);
          const nk = ws.getCell(r0, NOTES);
          nk.value = (label ? label + " — " : "") + (text || "");
          nk.font = { size: 8, italic: true, color: { argb: "FF595959" } }; nk.fill = fill(NOTE);
          nk.alignment = { horizontal: "left", vertical: "top", wrapText: true };
        };
        if (blk.kind === "group") {
          // Header line for the whole group at its first row's Notes cell...
          const firstGrp = groupsMeta[0];
          // then a typed note for each sub-group across its own row span.
          groupsMeta.forEach((gm, ix) => {
            const lab = TYPE_LABEL[gm.kind] || "SUB-GROUP";
            const suffix = (gm.kind === "related" || gm.kind === "direct") && objectKindFromApi(gm.objApi)
              ? " [" + objectKindFromApi(gm.objApi) + (gm.objApi ? ": " + gm.objApi : "") + "]" : "";
            const pre = ix === 0 ? blk.note + "  ▸ " : "";
            writeNote(gm.grpStart, gm.grpEnd, lab + suffix, pre + (gm.note || ""));
          });
        } else if (blk.note) {
          writeNote(blockStart, blockEnd, TYPE_LABEL[blk.kind], blk.note);
        }
        for (let rr = blockStart; rr <= blockEnd; rr++) boxRange(rr, rr, NOTES, NOTES, "thin", GRID);
        boxRange(blockStart, blockEnd, 1, V2, "thick", BLOCK);
        records.push({ blk, start: blockStart, end: blockEnd, groups: groupsMeta, groupOp: blk.groupOp });
      }
      const dataLast = r - 1;

      // ---- rails: one merged bar, single centered operator ----
      // THEN (waterfall hierarchy) reuses the blue-ish OR palette but its own color.
      const THEN = "0B5CAB";
      function paintBar(c, r0, r1, op, style, outer) {
        const f = op === "AND" ? (outer ? AND_OUTER : AND_BAR) : OR_BAR;
        const rc = op === "AND" ? AND : op === "THEN" ? THEN : OR;
        for (let rr = r0; rr <= r1; rr++) ws.getCell(rr, c).fill = fill(f);
        if (r0 !== r1) ws.mergeCells(r0, c, r1, c);
        // SF's UI shows no "THEN" keyword — waterfall members are ranked by
        // priority (the numbered tiers). Display "Priority" instead of the
        // internal THEN token; AND/OR are shown verbatim as SF labels them.
        const cell = ws.getCell(r0, c); cell.value = (op === "THEN" ? "Priority" : op);
        cell.font = { bold: true, size: outer ? 12 : 10, color: { argb: "FF" + rc } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        boxRange(r0, r1, c, c, style, rc);
      }
      for (const rec of records) {
        // descriptive groups (nested-segment fields, rank rows) are NOT joined
        // conditions — never draw a join rail for them.
        for (const gm of rec.groups) if (gm.nrows > 1 && !gm.descriptive) paintBar(INNER, gm.attrStart, gm.attrEnd, gm.within, "thin", false);
        if (rec.groups.length > 1) paintBar(MID, rec.start, rec.end, rec.groupOp || "OR", "medium", false);
      }
      // Outer rail joins top-level blocks — only meaningful when there are 2+.
      // A single block (e.g. one nested segment / one condition) joins nothing.
      if (records.length > 1) paintBar(OUTER, dataFirst, dataLast, tree.join || "AND", "thick", true);

      // Auto-fit so nothing is clipped on open. Per-column clamps keep the grid
      // readable: rail columns stay narrow, value/notes columns can grow.
      if (typeof ws.autoSize === "function") ws.autoSize({
        //     Blk Grp Ent Attr Op  V1  V2  Jin Jgr Jall Notes
        min: [  4,  6, 18, 18, 10, 12,  6,  8,  8,  9,  30],
        max: [  6, 10, 40, 40, 18, 40, 14, 10, 10, 12,  60],
      });
    }

    const SHEET_VIEW = { views: [{ showGridLines: false, state: "frozen", xSplit: 3, ySplit: 3 }] };
    const sheetName = (tab) => (tab || "Segment").replace(/[\\/*?:\[\]]/g, " ").slice(0, 31);

    // Single-tab workbook (kept for back-compat).
    async function buildSegmentWorkbook(ExcelJS, tree) {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(sheetName(tree.tab || "Segment"), SHEET_VIEW);
      renderSheet(ws, tree);
      return await wb.xlsx.writeBuffer();
    }

    // Multi-tab workbook: ONE file, one sheet per tab. `treesByTab` is an object
    // like { Include: tree, Exclude: tree, "Rank and Limit": tree }. Only tabs that
    // exist in the object get a sheet; empty tabs render a "(no criteria)" note.
    // Pass includeEmpty=false to skip tabs with no criteria entirely.
    // `meta` (optional) = { segName, segmentOn, dataSpace, publishSchedule, refreshMode,
    // status, description, population } — rendered as a Segment Setup header + Legend sheet
    // so the file is self-sufficient for rebuilding the segment from scratch.
    async function buildSegmentWorkbookMulti(ExcelJS, treesByTab, includeEmpty, meta) {
      const wb = new ExcelJS.Workbook();
      const order = ["Include", "Exclude", "Rank and Limit"];
      const names = Object.keys(treesByTab).sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      // First tab: a Segment Setup sheet with everything needed to START the segment.
      if (meta && (meta.segName || meta.segmentOn)) renderSetupSheet(wb, meta);
      let added = 0;
      for (const name of names) {
        const tree = treesByTab[name];
        const hasCriteria = tree && tree.children && tree.children.length;
        if (!hasCriteria && includeEmpty === false) continue;    // skip empty when asked
        const ws = wb.addWorksheet(sheetName(name), SHEET_VIEW);
        renderSheet(ws, tree || { t: "root", tab: name, join: "AND", children: [] });
        added++;
      }
      if (!added) {   // nothing at all — still emit a placeholder sheet
        const ws = wb.addWorksheet("Segment", SHEET_VIEW);
        renderSheet(ws, { t: "root", tab: "Include", join: "AND", children: [] });
      }
      renderLegendSheet(wb, meta, treesByTab);
      return await wb.xlsx.writeBuffer();
    }

    // Segment Setup sheet — the header info someone needs BEFORE building any
    // criteria: name, the object it's Segment On, Data Space, publish/refresh,
    // status, description, and the live population as a validation target.
    function renderSetupSheet(wb, meta) {
      const ws = wb.addWorksheet("Segment Setup", { views: [{ showGridLines: false }] });
      ws.getColumn(1).width = 26; ws.getColumn(2).width = 90;
      const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + argb } });
      let r = 1;
      ws.mergeCells(r, 1, r, 2);
      const t = ws.getCell(r, 1); t.value = "SEGMENT SETUP";
      t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } }; t.fill = fill(TITLE_FILL);
      t.alignment = { horizontal: "center", vertical: "middle" }; ws.getRow(r).height = 22; r++;
      ws.mergeCells(r, 1, r, 2);
      const sub = ws.getCell(r, 1);
      sub.value = "Create the segment with these settings first, then build the criteria on the tab sheets. See 'How to Rebuild'.";
      sub.font = { italic: true, size: 9, color: { argb: "FF333333" } }; sub.fill = fill("EAEFF7");
      sub.alignment = { wrapText: true, vertical: "middle" }; ws.getRow(r).height = 26; r += 2;
      // Labels mirror the SF segment header fields; values are DOM-scraped, blanks omitted.
      const rows = [
        ["Segment Name", meta.segName],
        ["Segment Type", meta.segmentType],
        ["Segment On (object)", meta.segmentOn],
        ["Data Space", meta.dataSpace],
        ["Publish Type", meta.publishType],
        ["Publish Schedule", meta.publishSchedule],
        ["Refresh Mode", meta.refreshMode],
        ["Status", meta.status],
        ["Description", meta.description],
        ["Population (validation target)", meta.population],
      ];
      rows.forEach(([k, v]) => {
        if (v == null || v === "") return;                 // omit blanks; never fabricate
        const ck = ws.getCell(r, 1), cv = ws.getCell(r, 2);
        ck.value = k; cv.value = v;
        ck.font = { bold: true, size: 10, color: { argb: "FF1F3864" } };
        cv.font = { size: 10, color: { argb: "FF1A1A1A" } };
        ck.fill = fill("F3F6FB");
        ck.alignment = { vertical: "middle" }; cv.alignment = { vertical: "middle", wrapText: true };
        ck.border = cv.border = { bottom: { style: "thin", color: { argb: "FF" + GRID } } };
        ws.getRow(r).height = 18; r++;
      });
      if (typeof ws.autoSize === "function") ws.autoSize({ min: [24, 40], max: [34, 90] });
    }

    // A "How to Rebuild" sheet whose content is DYNAMIC — it describes only what
    // THIS segment actually contains: which tabs exist, which block types appear,
    // whether it's a waterfall, and which join operators (AND/OR/THEN) are used.
    // Nothing generic or misleading is added.
    function renderLegendSheet(wb, meta, treesByTab) {
      meta = meta || {}; treesByTab = treesByTab || {};
      // ── inspect the real trees to learn what this segment uses ────────────────
      const present = {}; const joins = {}; let isWaterfall = false;
      const tabsWithData = [];
      function walk(n) {
        if (!n) return;
        if (n.t === "root") { if (n.join) joins[n.join] = 1; (n.children || []).forEach(walk); return; }
        if (n.t === "group") { if (n.join) joins[n.join] = 1; (n.children || []).forEach(walk); return; }
        if (n.t === "cond") present[n.kind || "direct"] = 1;
        else if (n.t === "container") present[n.kind || "related"] = 1;
        else if (n.t === "nested") { if (n.waterfall) { present.priority = 1; isWaterfall = true; } else present.nested = 1; }
        else if (n.t === "rank") present.rank = 1;
        if (n.children) n.children.forEach(walk);
      }
      Object.keys(treesByTab).forEach((tab) => {
        const tr = treesByTab[tab];
        if (tr && tr.children && tr.children.length) { tabsWithData.push(tab); walk(tr); if (tr.join === "THEN" || tr.waterfall) isWaterfall = true; }
      });

      const ws = wb.addWorksheet("How to Rebuild", { views: [{ showGridLines: false }] });
      ws.getColumn(1).width = 26; ws.getColumn(2).width = 96;
      const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + argb } });
      let r = 1;
      const title = ws.getCell(r, 1); ws.mergeCells(r, 1, r, 2);
      title.value = "HOW TO REBUILD: " + (meta.segName || "this segment");
      title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
      title.fill = fill(TITLE_FILL); title.alignment = { horizontal: "center", vertical: "middle" }; ws.getRow(r).height = 22; r += 2;

      const rows = [];
      // ── steps, built from real facts ─────────────────────────────────────────
      const onObj = meta.segmentOn ? "\"" + meta.segmentOn + "\"" : "the object in the Segment Setup sheet";
      const spaceTxt = meta.dataSpace ? " in the \"" + meta.dataSpace + "\" Data Space" : "";
      // State the segment type up front — prefer the scraped label, else the
      // structurally-detected waterfall. Blank line if we couldn't determine it.
      const segType = meta.segmentType || (isWaterfall ? "Waterfall Segment" : "");
      if (segType) rows.push(["Segment Type", segType + (isWaterfall ? " — tiers are ordered by priority (top = highest)." : "")]);
      const newLabel = /waterfall/i.test(segType) ? "New → Waterfall Segment" : "New";
      rows.push(["Step 1", "In Data Cloud → Segments, click " + newLabel + ". Set 'Segment On' to " + onObj + spaceTxt + "."]);
      if (isWaterfall) {
        rows.push(["Step 2", "This is a waterfall segment: drag each segment onto the canvas in the priority order shown (Priority 1 first). An individual is placed only in the highest-priority segment they match (mutually exclusive audiences)."]);
      } else {
        const tabList = tabsWithData.length ? tabsWithData.join(", ") : "Include";
        rows.push(["Step 2", "Rebuild each numbered block (Blk#) top to bottom on the " + tabList + " sheet(s), using its Notes column for what to drag."]);
      }
      let stepN = 3;
      if (meta.publishSchedule || meta.refreshMode)
        rows.push(["Step " + stepN++, "Set Publish Schedule" + (meta.publishSchedule ? " = \"" + meta.publishSchedule + "\"" : "") + (meta.refreshMode ? " / Refresh = \"" + meta.refreshMode + "\"" : "") + ", then Save."]);
      if (meta.population)
        rows.push(["Step " + stepN++, "Recount and confirm the population matches the target: " + meta.population + "."]);

      // ── block-type key: ONLY the types this segment actually uses ─────────────
      const TYPE_DESC = {
        direct: ["DIRECT ATTRIBUTE", "A field on " + (meta.segmentOn || "the segment object") + ". Drag the attribute, set its operator + value (see the row)."],
        related: ["RELATED ATTRIBUTE", "A related object shown as a container (Count At Least N). Drag the related object, set the aggregation, then add the member filter(s) inside."],
        ci: ["CALCULATED INSIGHT", "From 'Calculated Insights' in the left panel, drag the named insight, then set its dimension/measure filter."],
        nested: ["NESTED SEGMENT", "An existing segment reused as a condition. Drag it from 'Segments' in the left panel; set its publish behavior."],
        priority: ["SEGMENT (PRIORITY)", "A waterfall member. Drag the named segment onto the canvas in priority order; the number is its priority (Priority 1 = highest)."],
        rank: ["RANK & LIMIT", "On the Rank and Limit tab, Group/Sort By the field shown, then Limit to N records."],
      };
      const usedTypes = Object.keys(TYPE_DESC).filter((k) => present[k]);
      if (usedTypes.length) {
        rows.push(["", ""]);
        rows.push(["BLOCK TYPES IN THIS SEGMENT", ""]);
        usedTypes.forEach((k) => rows.push(TYPE_DESC[k]));
      }

      // ── logic key: only the operators actually used ──────────────────────────
      const joinKeys = Object.keys(joins);
      if (joinKeys.length) {
        rows.push(["", ""]);
        rows.push(["LOGIC IN THIS SEGMENT", ""]);
        if (joins.AND) rows.push(["AND (green)", "All joined items must match."]);
        if (joins.OR)  rows.push(["OR (orange)", "Any one of the joined items may match."]);
        if (joins.THEN) rows.push(["Priority (blue)", "Waterfall tier order — tiers are applied in priority sequence, not AND/OR'd."]);
        rows.push(["Join columns", "The three right-hand columns show the join at each level (inside a group, across groups, across all blocks). A join only appears when it connects 2+ items."]);
      }

      rows.forEach(([a, b]) => {
        const ca = ws.getCell(r, 1), cb = ws.getCell(r, 2);
        ca.value = a; cb.value = b;
        const header = a && !b; // section header rows
        ca.font = { bold: true, size: header ? 11 : 9, color: { argb: header ? "FF1F3864" : "FF1A1A1A" } };
        cb.font = { size: 10, color: { argb: "FF333333" } };
        ca.alignment = { vertical: "top", wrapText: true }; cb.alignment = { vertical: "top", wrapText: true };
        if (header) { ca.fill = fill("EAEFF7"); cb.fill = fill("EAEFF7"); }
        r++;
      });
      if (typeof ws.autoSize === "function") ws.autoSize({ min: [24, 50], max: [34, 92] });
    }

    const api = { buildSegmentWorkbook, buildSegmentWorkbookMulti, renderSheet };
    Object.assign(root, api);
  })(SEGX_NS);

    /* ==== blueprint HTML renderer (SF-canvas bracket rails: outer top-level join + per-group AND/OR) ==== */
    /* render-html.js — turn a segment logic tree into the SF-canvas-style HTML.
     * Pure function, no deps. Works in a content script, bookmarklet, or Node.
     * Port of the validated Python renderer. Usage: renderSegmentHTML(tree) -> string
     */
    (function (root) {
      const COLORS = {
        "Unified Individual TDIR":                ["#DCE9F5", "#9DC3E6"],
        "Individual Additional Information":       ["#E2EFDA", "#A9D08E"],
        "Insurance Policy":                        ["#FFF2CC", "#FFD966"],
        "Unified Indv Contact Point Email TDIR":   ["#E6E0F0", "#B4A7D6"],
        "Exact_10_Tier_Splits":                    ["#F2F2F2", "#D9D9D9"],
      };
      const FALLBACK = ["#EEF3FA", "#C9D6E5"]; // any entity not in the map

      const esc = (s) => String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const color = (entity) => COLORS[entity] || FALLBACK;

      // If entity is blank and attr is "<ObjectApiName> <FieldApiName>" (trailing
      // token looks like an API name), split so the object shows as the entity and
      // the field as the attribute. Mirrors the xlsx renderer; leaves plain phrases
      // ("Days to Expiration") untouched.
      function splitEntityAttr(entity, attr) {
        let e = entity || "", a = attr || "";
        if (!e && / /.test(a)) {
          const toks = a.split(/\s+/), last = toks[toks.length - 1];
          if (toks.length >= 2 && /_/.test(last)) { e = toks.slice(0, -1).join(" "); a = last; }
        }
        return { entity: e, attr: a };
      }

      function renderCond(n, member) {
        const sea = splitEntityAttr(n.entity, n.attr);
        n = Object.assign({}, n, { entity: sea.entity, attr: sea.attr });
        let val = esc(n.v1);
        if (n.op === "Is Between") val = `<b>${esc(n.v1)}</b> <span class="op">AND</span> <b>${esc(n.v2)}</b>`;
        else if (n.v1) val = `<b>${esc(n.v1)}</b>`;
        const [light] = color(n.entity);
        const inner = `<span class="entity">${esc(n.entity)}</span>
            <span class="dot">&bull;</span> <b class="attr">${esc(n.attr)}</b>
            <span class="op">${esc(n.op)}</span> ${val}`;
        if (member) return `<div class="member">${inner}</div>`;
        // Top-level direct attribute → label it inline so it reads like the others.
        const chip = kindChip(n.kind || "direct", n.objApi);
        return `<div class="card" style="--bg:${light}"><div class="card-main">${chip}${inner}</div></div>`;
      }

      // Inline type chip on a container header so it reads at a glance what to drag.
      // Full words (not abbreviations) + a DLO/DMO/CI sub-badge derived ONLY from the
      // scraped API suffix (objectKindFromApi) — blank when the suffix is unknown.
      function kindChip(kind, objApi) {
        const M = { direct: ["DIRECT ATTRIBUTE", "#0f766e"], related: ["RELATED ATTRIBUTE", "#0b5cab"], ci: ["CALCULATED INSIGHT", "#7c3aed"], nested: ["NESTED SEGMENT", "#0b5cab"], priority: ["SEGMENT", "#0b5cab"], rank: ["RANK & LIMIT", "#c55a11"] };
        const m = M[kind]; if (!m) return "";
        const ok = objectKindFromApi(objApi);
        const sub = (ok && ok !== "CI") ? `<span class="kchip-sub">${ok}</span>` : "";
        return `<span class="kchip" style="background:${m[1]}">${m[0]}</span>${sub}`;
      }
      function renderContainer(n) {
        const [light, dark] = color(n.entity);
        const agg = n.agg ? `<span class="agg">: ${esc(n.agg).replace(/Count/, "Count <b>").concat("</b>")}</span>`
                          : "";
        // Show the full API name of the related object next to the label, when scraped.
        const api = n.objApi ? `<span class="cont-api">${esc(n.objApi)}</span>` : "";
        const head = `<div class="cont-head" style="background:${dark}">${kindChip(n.kind || "related", n.objApi)}<b>${esc(n.entity)}</b>${api}${agg}</div>`;
        const body = renderJoin(n.children, n.join, false, true);
        return `<div class="container" style="--bg:${light}">${head}${body}</div>`;
      }

      // Rank & Limit rule — a labeled card with Object / Group|Sort By / Field / Limit.
      function renderRank(n) {
        const [light, dark] = color(n.entity);
        const head = `<div class="cont-head" style="background:${dark}"><b>${esc(n.entity || "Rank & Limit")}</b></div>`;
        const rows = [];
        if (n.rankType) rows.push(`<span class="rk-k">${esc(n.rankType)}</span> <b class="attr">${esc(n.rankField || "")}</b>`);
        if (n.limit)    rows.push(`<span class="rk-k">Limit</span> <b class="attr">${esc(n.limit)}</b>`);
        if (!rows.length && n.attr) rows.push(`<b class="attr">${esc(n.attr)}</b>`);
        const body = rows.map((r) => `<div class="member">${r}</div>`).join("");
        return `<div class="container rank" style="--bg:${light}">${head}${body}</div>`;
      }

      // Waterfall member (a Segment in Priority order) or a true nested segment.
      // Blue-accented card: segment name + optional priority badge + publish behavior.
      function renderNested(n) {
        const kind = n.waterfall ? "priority" : "nested";
        const tier = n.tier ? `<span class="ns-badge">${esc(n.tier)}</span>` : "";
        const head = `<div class="cont-head" style="background:#dbe7f6">${kindChip(kind)}${tier}<span class="ns-ico">&#9673;</span><b>${esc(n.entity || n.attr)}</b></div>`;
        let rows = "";
        if (n.sched) rows += `<div class="ns-pub"><b>Publish Schedule:</b> ${esc(n.sched)}</div>`;
        if (n.pub)   rows += `<div class="ns-pub"><b>Publish Behavior:</b> <i>${esc(n.pub)}</i></div>`;
        // No publish settings → show only the header card, no filler row.
        return `<div class="container nested-seg" style="--bg:#dbe7f6">${head}${rows}</div>`;
      }

      function renderNode(n, member) {
        if (n.t === "cond")      return renderCond(n, member);
        if (n.t === "container") return renderContainer(n);
        if (n.t === "rank")      return renderRank(n);
        if (n.t === "nested")    return renderNested(n);
        if (n.t === "group")     return renderJoin(n.children, n.join, n.boxed, false);
        throw new Error("unknown node " + n.t);
      }

      // Map a join operator to its rail CSS modifier. AND=green, OR=orange,
      // THEN (waterfall hierarchy)=blue.
      function railMod(op) { return op === "OR" ? "or" : op === "THEN" ? "then" : "and"; }
      // SF shows no "THEN" — waterfall tiers are ranked by priority. Display label
      // for the rail text (internal token stays THEN for color/plumbing).
      function railText(op) { return op === "THEN" ? "Priority" : op; }

      // stack children; if >1, add a right-side bracket rail carrying the operator
      function renderJoin(children, op, boxed, member) {
        const inner = children.map((c) => renderNode(c, member)).join("\n");
        if (children.length <= 1) return `<div class="stack">${inner}</div>`;
        const cls = boxed ? "grp-body boxed" : "grp-body";
        const railCls = "rail " + railMod(op);
        return `<div class="grp ${railMod(op)}">
          <div class="${cls}">${inner}</div>
          <div class="${railCls}"><span class="line"></span><span class="conn">${esc(railText(op))}<span class="caret">&#9662;</span></span></div>
        </div>`;
      }

      function renderRoot(tree) {
        const kids = tree.children || [];
        const blocks = kids.map((c) => `<div class="toprow">${renderNode(c, false)}</div>`).join("\n");
        // A single top-level block joins nothing — omit the outer rail entirely.
        if (kids.length <= 1) return `<div class="root"><div class="root-body">${blocks}</div></div>`;
        const op = tree.join || "AND";
        const railCls = "rail " + railMod(op) + " outer";
        return `<div class="root grp ${railMod(op)}">
          <div class="root-body">${blocks}</div>
          <div class="${railCls}"><span class="line"></span><span class="conn">${esc(railText(op))}<span class="caret">&#9662;</span></span></div>
        </div>`;
      }

      const CSS = `
      :root { --bd:#d8dde6; --txt:#16325c; --sub:#54698d; }
      * { box-sizing:border-box; }
      body { margin:0; background:#f3f3f3; color:var(--txt);
             font:13px/1.4 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
      .seg-wrap { max-width:1200px; margin:0 auto; padding:16px; }
      .tabs { display:flex; gap:22px; border-bottom:1px solid var(--bd); margin-bottom:18px; }
      .tabs a { padding:10px 2px; text-decoration:none; color:var(--sub); font-weight:600; }
      .tabs a.active { color:#0b5cab; border-bottom:3px solid #0b5cab; }
      .root { align-items:stretch; }
      .root-body { flex:1; display:flex; flex-direction:column; gap:14px; }
      .toprow { display:block; }
      .stack { display:flex; flex-direction:column; gap:10px; }
      .card { background:#fff; border:1px solid var(--bd); border-left:5px solid var(--bg);
              border-radius:5px; box-shadow:0 1px 1px rgba(0,0,0,.05); }
      .card-main { padding:9px 12px; position:relative; }
      .entity { color:var(--sub); }
      .dot { color:#b0b8c4; }
      .attr { color:var(--txt); }
      .op { color:var(--sub); margin:0 4px; }
      .container { background:#fff; border:1px solid var(--bd); border-radius:6px;
                   box-shadow:0 1px 2px rgba(0,0,0,.06); overflow:hidden; }
      .cont-head { padding:9px 12px; font-size:14px; color:#1a1a1a; }
      .cont-head .agg { font-weight:400; margin-left:4px; }
      .kchip { display:inline-block; font:700 9px/1 system-ui; color:#fff; padding:2px 6px;
               border-radius:9px; letter-spacing:.04em; margin-right:5px; vertical-align:middle; }
      .kchip-sub { display:inline-block; font:700 9px/1 system-ui; color:#16325c; background:#fff;
                   border:1px solid rgba(0,0,0,.18); padding:2px 6px; border-radius:9px; margin-right:7px; vertical-align:middle; }
      .cont-api { font:600 10px/1 "SF Mono",Menlo,monospace; color:#5c6b8a; margin-left:8px; vertical-align:middle; }
      .container > .stack, .container > .grp { padding:0; }
      .container .card { box-shadow:none; }
      .member { position:relative; padding:10px 12px; border-top:1px dashed #e2e6ee; }
      .member:first-child { border-top:none; }
      .grp { display:flex; align-items:stretch; }
      .grp-body { flex:1; display:flex; flex-direction:column; gap:10px; }
      .grp-body.boxed { border:1.5px solid #c9cfda; border-radius:8px; padding:10px; background:#fbfcfe; }
      .rail { position:relative; width:58px; display:flex; align-items:center; justify-content:center; margin-left:2px; }
      .rail .line { position:absolute; left:8px; top:10px; bottom:10px; width:16px;
                    border:2px solid var(--rc); border-left:none; border-radius:0 7px 7px 0; }
      .rail .conn { position:relative; background:#fff; padding:3px 6px; border:1px solid var(--rc);
                    border-radius:12px; font-weight:700; color:var(--rc); font-size:12px; white-space:nowrap; }
      .rail.and { --rc:#008000; }
      .rail.or  { --rc:#c55a11; }
      .rail.then { --rc:#0b5cab; }
      .nested-seg .cont-head { display:flex; align-items:center; gap:8px; }
      .nested-seg .ns-badge { font:700 10px/1 system-ui; background:#0b5cab; color:#fff;
                              padding:2px 7px; border-radius:10px; letter-spacing:.05em; }
      .nested-seg .ns-ico { color:#0b5cab; font-size:13px; }
      .nested-seg .ns-pub { color:var(--sub); font-size:12px; padding:9px 12px; }
      .nested-seg .ns-pub b { color:var(--txt); }
      .rail.outer { width:66px; }
      .rail.outer .line { left:10px; width:22px; border-width:3px; top:6px; bottom:6px; }
      .rail.outer .conn { font-size:13px; padding:4px 8px; }
      .caret { font-size:9px; margin-left:3px; opacity:.8; }
      .rk-k { display:inline-block; min-width:64px; color:var(--sub); font-weight:600; }`;

      // returns just the inner markup (no <html>). Pass {tabs:false} to omit the
      // internal tab strip (the panel supplies its own tab switcher).
      function renderSegmentBody(tree, opts) {
        const showTabs = !(opts && opts.tabs === false);
        const tabs = showTabs ? `<div class="tabs">` + ["Include", "Exclude", "Rank and Limit"]
          .map((t) => `<a class="${t === (tree.tab || "Include") ? "active" : ""}" href="#">${t}</a>`).join("") + `</div>` : "";
        return `<div class="seg-wrap">${tabs}${renderRoot(tree)}</div>`;
      }

      // returns a full standalone document string
      function renderSegmentHTML(tree) {
        return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
    <title>Data Cloud Segment — ${esc(tree.tab || "Include")}</title>
    <style>${CSS}</style></head><body>${renderSegmentBody(tree)}</body></html>`;
      }

      const api = { renderSegmentHTML, renderSegmentBody, SEG_CSS: CSS };
      Object.assign(root, api);
    })(SEGX_NS);

    /* ==== adapter: tool tree ({type:set|simple|aggregation|ci|nested-segment}) -> kit tree ({t:root|group|container|cond}) ==== */
    function condOf(n) {
      var op = n.operator || "";
      var v1 = n.values || "", v2 = "";
      if (/between/i.test(op) && v1) {
        var m = v1.split(/\s*,\s*|\s+AND\s+/i);
        if (m.length >= 2) { v1 = (m[0]||"").trim(); v2 = m.slice(1).join(" ").trim(); }
      }
      var entity = n.objectLabel || "";
      var attr = n.fieldLabel || "";
      if (n.type === "nested-segment") { attr = attr || "(nested segment)"; }
      return { t: "cond", entity: entity, attr: attr, op: op, v1: v1, v2: v2,
               objApi: n.objApi || "", fieldApi: n.fieldApi || "" };
    }
    // "(API: field_api__c on Object__dlm)" suffix when API names are available.
    function apiSuffix(node) {
      var f = node.fieldApi || "", o = node.objApi || "";
      if (!f && !o) return "";
      return " (API: " + (f || "?") + (o ? " on " + o : "") + ")";
    }
    // A Rank & Limit row from readRankLimitFromDOM: fieldLabel = "Group By"/"Sort By",
    // operator = the ranked/sorted field (+ direction), values = "Limit: N …".
    function rankOf(n) {
      var limit = (n.values || "").replace(/^Limit:\s*/i, "").trim();
      return { t: "rank", entity: n.objectLabel || "Rank & Limit",
               rankType: n.fieldLabel || "", rankField: n.operator || "", limit: limit,
               attr: [n.fieldLabel, n.operator, n.values].filter(Boolean).join(" ") };
    }
    // Waterfall member (a Segment in Priority order) OR a true nested segment.
    // operator carries "Priority N" for waterfall members (SF's term).
    function nestedOf(n) {
      var isWf = !!n.waterfallPriority || /^priority\b/i.test(n.operator || "");
      return { t: "nested", entity: n.objectLabel || "(segment)",
               attr: n.objectLabel || "", pub: n.fieldLabel || "", sched: n.publishSchedule || "",
               waterfall: isWf,
               tier: /^(priority|tier)\b/i.test(n.operator || "") ? n.operator : "" };
    }
    // Human-readable "how to build this in Salesforce" note per block kind. This is
    // what makes the export self-sufficient for a migration: the person rebuilding
    // the segment knows exactly WHAT to drag from the left panel and how to set it.
    function buildNote(kind, node) {
      switch (kind) {
        case "direct": {
          // Classify the segment object itself when its suffix is known.
          var dk = objectKindFromApi(node.objApi);
          return "Direct attribute of " + (node.entity || "the segment object") +
                 (dk ? " (" + dk + ")" : "") +
                 ". Drag this attribute onto the canvas and set: " +
                 [node.attr, node.op, node.v1 || node.v2].filter(Boolean).join(" ") + "." + apiSuffix(node);
        }
        case "related": {
          // State whether the related object is a DLO or a DMO — derived ONLY from
          // the scraped API-name suffix, blank if unknown (never guessed).
          var rk = objectKindFromApi(node.objApi);
          return "Related attribute — a field on the related object " +
                 (node.entity || "a related object") +
                 (rk ? " (" + rk + ")" : "") +
                 (node.objApi ? " [API: " + node.objApi + "]" : "") +
                 ". Drag the related object" +
                 (node.agg ? ", set the aggregation (" + node.agg + ")" : ", set its aggregation as shown in the UI") +
                 ", then add the member filter(s) inside it.";
        }
        case "ci":
          return "Calculated Insight: " + (node.entity || "") +
                 (node.objApi ? " [" + node.objApi + "]" : "") +
                 ". From the left panel open Calculated Insights, drag \"" + (node.entity || "") +
                 "\", then set its dimension/measure filter.";
        case "priority":
          // Waterfall member — SF term: a Segment processed in priority order.
          return "Waterfall member segment \"" + (node.entity || "") + "\"" +
                 (node.tier ? " (" + node.tier + ")" : "") +
                 ". Drag this segment onto the waterfall canvas in priority order" +
                 (node.sched ? ". Publish Schedule: " + node.sched : "") +
                 (node.pub ? ". Publish Behavior: " + node.pub : "") + ".";
        case "nested":
          return "Nested segment: drag the segment \"" + (node.entity || "") +
                 "\" from Segments in the left panel" +
                 (node.sched ? ". Publish Schedule: " + node.sched : "") +
                 (node.pub ? ". Publish Behavior: " + node.pub : "") + ".";
        case "rank":
          return "Rank & Limit rule on " + (node.entity || "") + ": " +
                 [node.rankType, node.rankField].filter(Boolean).join(" ") +
                 (node.limit ? ", limit " + node.limit : "") + ".";
        default: return "";
      }
    }
    function conv(node, isRank) {
      if (!node) return null;
      if (node.type === "set") {
        return { t: "group", join: node.join || "AND", boxed: true,
                 children: (node.items || []).map(function (c) { return conv(c, isRank); }).filter(Boolean) };
      }
      if (isRank) { var rk = rankOf(node); rk.kind = "rank"; rk.note = buildNote("rank", rk); return rk; }
      if (node.type === "nested-segment") { var ns = nestedOf(node); ns.kind = ns.waterfall ? "priority" : "nested"; ns.note = buildNote(ns.kind, ns); return ns; }
      if (node.type === "aggregation" || node.type === "ci") {
        var isCi = node.type === "ci";
        var agg = isCi ? (node.fieldLabel || "Calculated Insight")
                       : [node.fieldLabel, node.operator, node.values].filter(Boolean).join(" ");
        var c = { t: "container", entity: node.objectLabel || "", agg: agg, join: node.subJoin || "AND",
                  kind: isCi ? "ci" : "related", objApi: node.objApi || "",
                  children: (node.subFilters || []).map(function (sf) { return condOf(Object.assign({ type: "simple" }, sf)); }) };
        // A CI with an inline operator/value but no sub-filters: keep the comparison as a member row.
        if (isCi && !c.children.length && (node.operator || node.values)) {
          c.children.push(condOf(Object.assign({ type: "simple" }, { objectLabel: node.objectLabel, fieldLabel: node.fieldLabel, operator: node.operator, values: node.values })));
        }
        c.note = buildNote(c.kind, c);
        return c;
      }
      var cd = condOf(node); cd.kind = "direct"; cd.note = buildNote("direct", cd); return cd;
    }
    function segTreeToKit(toolTree, tab) {
      var isRank = /rank/i.test(tab || "");
      // Waterfall tiers are ordered/prioritised → THEN join (blue rail), not AND/OR.
      var join = (toolTree && toolTree.waterfall) ? "THEN" : ((toolTree && toolTree.join) || "AND");
      var root = { t: "root", tab: tab || "Include", join: join, children: [] };
      if (toolTree && toolTree.items) root.children = toolTree.items.map(function (c) { return conv(c, isRank); }).filter(Boolean);
      return root;
    }
    return { MiniXLSX: SEGX_NS.MiniXLSX, buildSegmentWorkbookMulti: SEGX_NS.buildSegmentWorkbookMulti,
             renderSheet: SEGX_NS.renderSheet, segTreeToKit: segTreeToKit,
             renderSegmentBody: SEGX_NS.renderSegmentBody, SEG_CSS: SEGX_NS.SEG_CSS };
  })();


  // ── Segment export modal ──────────────────────────────────────────────────

  function openSegmentExport() {
    const segName = readSegmentName();
    const meta    = readSegmentMeta();
    const { activeTab, availableTabs, tree, flat } = readSegmentRules();

    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const tsvEsc = (s) => String(s == null ? "" : s).replace(/\t/g, " ");
    const safeFilename = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");

    const buildMetaStr = (tab) => {
      const parts = ["Segment: " + segName, "Tab: " + tab];
      if (meta.segmentType)     parts.push("Segment Type: " + meta.segmentType);
      if (meta.segmentOn)       parts.push("Segment On: " + meta.segmentOn);
      if (meta.publishType)     parts.push("Publish Type: " + meta.publishType);
      if (meta.publishSchedule) parts.push("Publish Schedule: " + meta.publishSchedule);
      if (meta.status)          parts.push("Status: " + meta.status);
      return parts.join("\n");
    };

    // Build a Sheets-friendly TSV with group structure.
    // Layout: Group | Join | # | Type | Object | Field | Operator | Value(s)
    // Groups are visually separated by a blank row; sub-filters are indented.
    // Build an HTML table for clipboard (Google Sheets / Excel).
    // Works from the TREE so all joins and group structure are preserved.
    //
    // NO rowspan/colspan — Google Sheets mis-places cells when rowspan meets colspan.
    // Instead: visual "merged" look via consistent background + thick left border
    // on every row of a group. First row shows "Group N" text; others are blank.
    //   Col A = Group label (first row) or blank (same color = looks merged)
    //   Col B–F = # | Object/CI | Field | Operator | Value(s)
    //   Inner AND/OR = thin row within a group, pill on right only
    //   Between-group AND/OR = compact gap row, pill on right only
    //   No "Container" column — root join shown via between-group pill on the right
    const toClipboardHtml = (tree, flatRows, tab) => {
      // No rowspan/colspan — Sheets breaks cell alignment when they mix.
      // "Merged" group look = same tinted bg + thick left border on EVERY row in the group.
      // Col layout (6 cols): Group | # | Object/CI | Field | Operator | Value(s)
      // AND/OR badges appear ONLY on the far right of joiner rows.
      const B     = "border:1px solid #d0d5de;";
      const TOTAL = 6; // Group | # | Object/CI | Field | Operator | Value(s)

      const TYPE_DOT = {
        "simple": "#3b82f6", "aggregation": "#f59e0b",
        "ci": "#7c3aed", "nested-segment": "#0b5cab",
      };

      // ── Build a flat display list from the tree ─────────────────────────────
      const DR = [];
      let condNum = 0;

      function collectG(groupNode, gIdx, gJoin, state) {
        const items = groupNode.items || [];
        items.forEach((item, i) => {
          const isLast = i === items.length - 1;
          if (item.type === "set") {
            collectG(item, gIdx, gJoin, state);
          } else {
            condNum++;
            const grpLabel = (state.condCount === 0) ? state.groupLabel : "";
            state.condCount++;
            DR.push({ kind: "cond", node: item, condNum, gIdx, gJoin, grpLabel });
            if (item.type === "aggregation" && item.subFilters && item.subFilters.length) {
              item.subFilters.forEach((sf, si) => {
                DR.push({ kind: "cond", node: { ...sf, type: "sub" }, condNum: null, gIdx, gJoin, grpLabel: "" });
                if (si < item.subFilters.length - 1)
                  DR.push({ kind: "inner", label: item.subJoin || "AND", gIdx, gJoin });
              });
            }
            if (!isLast && items[i + 1] && items[i + 1].type !== "set") {
              DR.push({ kind: "inner", label: groupNode.join || "AND", gIdx, gJoin });
            }
          }
        });
      }

      if (tree && tree.items) {
        const topGroups = [];
        let batch = [];
        tree.items.forEach(item => {
          if (item.type === "set") {
            if (batch.length) { topGroups.push({ type:"set", join:tree.join, items:batch }); batch=[]; }
            topGroups.push(item);
          } else {
            batch.push(item);
          }
        });
        if (batch.length) topGroups.push({ type:"set", join:tree.join, items:batch });

        topGroups.forEach((g, gi) => {
          const hasSubSets = (g.items || []).some(it => it.type === "set");
          const barJoin = hasSubSets ? (g.join || "AND") : "AND";
          const groupLabel = hasSubSets
            ? "Group " + (gi + 1) + " (" + (g.join || "AND") + ")"
            : "Group " + (gi + 1);
          collectG(g, gi, barJoin, { condCount: 0, groupLabel });
          if (gi < topGroups.length - 1) DR.push({ kind: "inner", label: tree.join || "AND", gIdx: -1, gJoin: tree.join || "AND", isBetweenGroups: true });
        });
      }

      // ── Render ───────────────────────────────────────────────────────────────
      // Col layout: Group | # | Object/CI | Field | Operator | Value(s)
      let html = "";

      const GRP_PALETTES_AND = ["#f0f6ff","#e8f4fd","#f0f9ff","#eaf2ff"];
      const GRP_PALETTES_OR  = ["#faf5ff","#f3eeff","#f8f4ff","#f0ebff"];
      const grpBg = (gIdx, isOrGroup) => {
        const pal = isOrGroup ? GRP_PALETTES_OR : GRP_PALETTES_AND;
        return pal[gIdx % pal.length];
      };

      DR.forEach(dr => {
        if (dr.kind === "inner") {
          const isOr = dr.label === "OR";
          const jc   = isOr ? "#7c3aed" : "#0b5cab";
          const jbg  = isOr ? "#f5f0ff" : "#edf4ff";

          if (dr.isBetweenGroups) {
            // Compact gap between groups — AND/OR pill on the right only
            html += "<tr style='height:18px'>";
            for (let k = 0; k < TOTAL - 1; k++) html += "<td style='border:none;background:#f4f6fb'></td>";
            html += "<td style='border:none;background:#f4f6fb;text-align:right;padding:2px 10px'>" +
              "<span style='display:inline-block;font:700 10px/1 -apple-system,sans-serif;color:" + jc + ";background:" + jbg + ";padding:2px 10px;border-radius:10px;border:1px solid " + jc + "55;letter-spacing:.07em'>" + esc(dr.label) + "</span></td>";
            html += "</tr>\n";
          } else {
            // Inner joiner within a group — thin divider row, AND/OR pill on right only
            const gIsOr = dr.gJoin === "OR";
            const gbg   = grpBg(dr.gIdx, gIsOr);
            html += "<tr style='height:16px'>";
            html += "<td style='border:none;background:" + gbg + ";border-left:4px solid " + (gIsOr?"#a78bfa":"#93c5fd") + "'></td>";
            for (let k = 1; k < TOTAL - 1; k++) html += "<td style='border:none;background:" + gbg + "'></td>";
            html += "<td style='border:none;background:" + gbg + ";text-align:right;padding:1px 10px'>" +
              "<span style='display:inline-block;font:700 10px/1 -apple-system,sans-serif;color:" + jc + ";background:" + jbg + ";padding:1px 8px;border-radius:8px;border:1px solid " + jc + "40;letter-spacing:.07em'>" + esc(dr.label) + "</span></td>";
            html += "</tr>\n";
          }
          return;
        }

        // Condition row
        const n      = dr.node;
        const isSub  = n.type === "sub";
        const dot    = isSub ? "#f59e0b" : (TYPE_DOT[n.type] || "#3b82f6");
        const obj    = n.objectLabel || "";
        const gIsOrC = dr.gJoin === "OR";
        const gbgC   = grpBg(dr.gIdx, gIsOrC);
        const rowBg  = isSub ? (gIsOrC ? "#f3ecff" : "#eef4ff") : gbgC;
        const barCol = gIsOrC ? "#a78bfa" : "#93c5fd";
        const grpCell = "border:none;border-left:4px solid " + barCol + ";padding:4px 10px;background:" + gbgC + ";color:" + (gIsOrC?"#7c3aed":"#0b5cab") + ";font-size:12px;font-weight:700;text-align:center;white-space:nowrap;vertical-align:middle;";

        html += "<tr>";
        // Group col — label only on first row of group; rest empty but same tint
        html += "<td style='" + grpCell + "'>" + esc(dr.grpLabel || "") + "</td>";
        // #
        html += "<td style='" + B + "padding:5px 8px;font-size:12px;color:#8a94ab;font-weight:700;background:" + rowBg + ";text-align:right;white-space:nowrap;vertical-align:middle'>" +
          esc(isSub ? "└" : (dr.condNum ? String(dr.condNum) : "")) + "</td>";
        // Object/CI
        html += "<td style='" + B + "padding:5px 9px;font-size:12px;font-weight:700;color:#16325c;background:" + rowBg + ";vertical-align:middle" + (isSub ? ";padding-left:20px" : "") + "'>" +
          "<span style='display:inline-block;width:7px;height:7px;border-radius:50%;background:" + dot + ";margin-right:6px;vertical-align:middle'></span>" +
          esc(obj) + "</td>";
        // Field
        html += "<td style='" + B + "padding:5px 9px;font-size:11.5px;color:#0b5cab;font-family:Consolas,Courier New,monospace;background:" + rowBg + ";vertical-align:middle'>" +
          esc(n.fieldLabel || "") + "</td>";
        // Operator
        html += "<td style='" + B + "padding:5px 9px;font-size:12px;font-style:italic;color:#54698d;background:" + rowBg + ";vertical-align:middle;white-space:nowrap'>" +
          esc(n.operator || "") + "</td>";
        // Value(s)
        html += "<td style='" + B + "padding:5px 9px;font-size:12px;font-weight:700;color:#16325c;background:" + rowBg + ";vertical-align:middle'>" +
          esc(n.values || "") + "</td>";
        html += "</tr>\n";
      });

      // Metadata footer
      const blankRow = "<tr>" + Array(TOTAL).fill("<td style='padding:3px;border:none'></td>").join("") + "</tr>\n";
      html += blankRow;
      buildMetaStr(tab).split("\n").forEach(l => {
        html += "<tr><td style='" + B + "padding:3px 9px;font-size:11px;color:#5c6b8a;background:#f9fafc'>" + esc(l) + "</td>" +
          Array(TOTAL - 1).fill("<td style='" + B + "background:#f9fafc'></td>").join("") + "</tr>\n";
      });

      const TH = (t) => "<th style='" + B + "padding:6px 9px;font-size:12px;background:#16325c;color:#fff;font-weight:700;white-space:nowrap;text-align:left'>" + esc(t) + "</th>";
      return "<table style='border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif'>" +
        "<thead><tr>" + TH("Group") + TH("#") + TH("Object / CI") + TH("Field") + TH("Operator") + TH("Value(s)") + "</tr></thead>" +
        "<tbody>\n" + html + "</tbody></table>";
    };

    // Plain-text fallback (used when ClipboardItem API not available)
    const toTSV = (flatRows, tab) => {
      const e = tsvEsc;
      const lines = [["Group","Type","Object / CI","Field","Operator","Value(s)","Join"].map(e).join("\t"), ""];
      let groupNum = 0, prevJoin = "";
      flatRows.forEach((r, i) => {
        const isSub = r.objectLabel && r.objectLabel.startsWith("  └ ");
        if (!isSub && (i === 0 || prevJoin === "")) { if (i > 0) lines.push(""); groupNum++; }
        const typeLabel = isSub ? "└ Filter" : (r.type === "aggregation" ? "Aggregation" : r.type === "ci" ? "Calc. Insight" : r.type === "nested-segment" ? "Nested Seg." : "Simple");
        lines.push([e(isSub ? "" : "Group " + groupNum), e(typeLabel), e(isSub ? r.objectLabel.replace("  └ ","") : r.objectLabel||""), e(r.fieldLabel||""), e(r.operator||""), e(r.values||""), e(r.joinWithNext||"")].join("\t"));
        if (!isSub) prevJoin = r.joinWithNext || "";
      });
      lines.push("", "", e("=== Metadata ==="));
      buildMetaStr(tab).split("\n").forEach(l => lines.push(e(l)));
      return lines.join("\n");
    };

    // Renders one condition row exactly as SF shows it:
    // [dot] ObjectLabel · FieldLabel  Operator  Value
    // Nested-segment row — segment icon + bold name + publish behavior subtitle
    function nestedSegRow(r) {
      return "<div style='padding:8px 10px;min-height:38px'>" +
        "<div style='display:flex;align-items:center;gap:8px'>" +
        "<span style='width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center'>" +
        "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#0b5cab' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>" +
        "<circle cx='12' cy='12' r='10'/><path d='M8 12l3 3 5-5'/>" +
        "</svg></span>" +
        "<span style='font-weight:700;color:#0b5cab;font-size:13px'>" + esc(r.objectLabel) + "</span>" +
        "</div>" +
        (r.fieldLabel ? "<div style='font-size:11.5px;color:#5c6b8a;padding-left:24px;margin-top:2px'><b style=\"color:#16325c\">Nested Publish Behavior:</b> <i>" + esc(r.fieldLabel) + "</i></div>" : "") +
        "</div>";
    }

    // Single condition row — dot + Object · Field  Operator  Value(s)
    function condRow(r) {
      if (!r.objectLabel && !r.fieldLabel) return "";
      if (r.type === "nested-segment") return nestedSegRow(r);
      const dotColor = r.type === "aggregation" ? "#f59e0b" : r.type === "ci" ? "#7c3aed" : "#3b82f6";
      return "<div style='display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 0;padding:7px 10px 7px 10px;min-height:32px'>" +
        "<span style='width:7px;height:7px;border-radius:50%;background:" + dotColor + ";flex-shrink:0;margin-right:8px;margin-top:4px;display:inline-block'></span>" +
        "<span style='font-weight:600;color:#16325c;margin-right:4px'>" + esc(r.objectLabel) + "</span>" +
        "<span style='color:#b0bac9;margin-right:4px'>&#183;</span>" +
        "<span style='font-family:SF Mono,Consolas,monospace;font-size:11.5px;color:#0b5cab;font-weight:600;margin-right:8px'>" + esc(r.fieldLabel) + "</span>" +
        (r.operator ? "<span style='color:#54698d;margin-right:6px;font-style:italic'>" + esc(r.operator) + "</span>" : "") +
        (r.values   ? "<span style='font-weight:700;color:#16325c'>" + esc(r.values) + "</span>" : "") +
        "</div>";
    }

    // ── Rendering primitives ──────────────────────────────────────────────────

    // Thin horizontal rule + right-aligned AND/OR pill between rows inside one card
    function innerJoiner(label) {
      const c  = label === "OR" ? "#7c3aed" : "#0b5cab";
      const bg = label === "OR" ? "#f5f0ff" : "#edf4ff";
      return "<div style='display:flex;align-items:center;padding:0 10px;height:20px'>" +
        "<div style='flex:1;height:1px;background:#dee3ed'></div>" +
        "<span style='font:700 10px/1 -apple-system,sans-serif;color:" + c + ";background:" + bg + ";padding:2px 8px;border-radius:5px;margin-left:6px;letter-spacing:.07em;flex-shrink:0'>" + esc(label) + "</span>" +
        "</div>";
    }

    // A card with left-bracket bar. No outer margin — parent spacing handles gaps.
    function card(rowsHtml, opts) {
      opts = opts || {};
      const barC = opts.barColor || "#0b5cab";
      const bdr  = opts.bdrColor || "#c9d9f0";
      const bg   = opts.bgColor  || "#ffffff";
      return "<div style='display:flex'>" +
        "<div style='width:4px;flex-shrink:0;background:" + barC + ";border-radius:3px 0 0 3px'></div>" +
        "<div style='flex:1;border:1px solid " + bdr + ";border-left:none;border-radius:0 6px 6px 0;background:" + bg + ";overflow:hidden'>" +
        rowsHtml +
        "</div></div>";
    }

    // Wraps multiple card-blocks under ONE vertical bar with a single badge at top-right.
    // When a set has N blocks joined by AND/OR, we show ONE label, not N-1 labels.
    function groupedBlocks(blocksHtml, label) {
      const isOr = label === "OR";
      const c    = isOr ? "#7c3aed" : "#0b5cab";
      const bg   = isOr ? "#f5f0ff" : "#edf4ff";
      const barC = isOr ? "#a78bfa" : "#93c5fd";
      return "<div style='display:flex;margin-bottom:8px'>" +
        "<div style='width:3px;flex-shrink:0;background:" + barC + ";border-radius:3px 0 0 3px'></div>" +
        "<div style='flex:1;min-width:0;padding-left:6px'>" +
        "<div style='display:flex;justify-content:flex-end;margin-bottom:4px'>" +
        "<span style='font:700 10px/1 -apple-system,sans-serif;color:" + c + ";background:" + bg + ";padding:2px 9px;border-radius:5px;letter-spacing:.07em;border:1px solid " + c + "55'>" + esc(label) + "</span>" +
        "</div>" +
        "<div style='display:flex;flex-direction:column;gap:4px'>" + blocksHtml + "</div>" +
        "</div></div>";
    }

    // Render a leaf node (simple/ci/nested-segment/aggregation) into HTML rows string.
    // Returns { html, isEmpty }
    function leafHtml(node) {
      if (node.type === "nested-segment") return { html: nestedSegRow(node), isEmpty: !node.objectLabel };
      if (node.type === "simple" || node.type === "ci") {
        const h = condRow(node);
        return { html: h, isEmpty: !h };
      }
      if (node.type === "aggregation") {
        let h = "<div style='display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 0;padding:7px 10px;background:#fff8ed;border-bottom:" + (node.subFilters && node.subFilters.length ? "1px solid #ffe0a0" : "none") + "'>" +
          "<span style='width:7px;height:7px;border-radius:50%;background:#f59e0b;flex-shrink:0;margin-right:8px;margin-top:4px;display:inline-block'></span>" +
          "<span style='font-weight:700;color:#92400e;margin-right:4px'>" + esc(node.objectLabel) + "</span>" +
          "<span style='color:#b0bac9;margin-right:4px'>&#183;</span>" +
          "<span style='font-family:SF Mono,Consolas,monospace;font-size:11.5px;color:#b45309;font-weight:600;margin-right:8px'>" + esc(node.fieldLabel) + "</span>" +
          (node.operator ? "<span style='color:#54698d;font-style:italic;margin-right:6px'>" + esc(node.operator) + "</span>" : "") +
          (node.values   ? "<span style='font-weight:700;color:#16325c'>" + esc(node.values) + "</span>" : "") +
          "</div>";
        if (node.subFilters && node.subFilters.length) {
          const sfRows = node.subFilters.map(sf => condRow(Object.assign({ type: "simple" }, sf))).filter(Boolean);
          let sfInner = "";
          sfRows.forEach((r, i) => { sfInner += r; if (i < sfRows.length - 1) sfInner += innerJoiner(node.subJoin || "AND"); });
          h += "<div style='padding:5px 8px 5px 12px;background:#fffdf5'>" +
            card(sfInner, { barColor: "#f59e0b", bdrColor: "#ffe0a0", bgColor: "#fff8ed" }) +
            "</div>";
        }
        return { html: h, isEmpty: false };
      }
      return { html: "", isEmpty: true };
    }

    // Render a set node.
    // Design rule: if this set produces more than one card-block, wrap them all in
    // groupedBlocks() so there is exactly ONE join label for the whole group — not
    // one badge between every pair of blocks.
    function renderSet(node) {
      if (!node.items || !node.items.length) return "";

      const blocks = [];
      let batch = [];

      function flushBatch(batchJoin) {
        if (!batch.length) return;
        const rows = batch.map(item => leafHtml(item)).filter(r => !r.isEmpty);
        if (!rows.length) { batch = []; return; }
        let inner = "";
        rows.forEach((r, i) => { inner += r.html; if (i < rows.length - 1) inner += innerJoiner(batchJoin); });
        blocks.push(card(inner));
        batch = [];
      }

      node.items.forEach(item => {
        if (item.type === "set") {
          flushBatch(node.join);
          const inner = renderSet(item);
          if (inner) blocks.push(inner);
        } else {
          batch.push(item);
        }
      });
      flushBatch(node.join);

      if (!blocks.length) return "";
      // One block: no wrapper needed
      if (blocks.length === 1) return blocks[0];
      // Multiple blocks: wrap in ONE group with a single join label
      return groupedBlocks(blocks.join(""), node.join);
    }

    function buildCanvasView(t, tabName) {
      if (!t || !t.items || !t.items.length) return "<div style='padding:32px;text-align:center;color:#8a94ab;font-size:13px'>No conditions found. Make sure the correct tab is active on the Salesforce page, then reopen this modal.</div>";
      // Use the blueprint renderer (SF-canvas bracket rails: outer top-level join +
      // per-group AND/OR rails between containers). Scoped so the kit CSS can't leak.
      try {
        const kit = SEGX.segTreeToKit(t, tabName || currentModalTab || activeTab);
        return "<style>" + SEGX.SEG_CSS.replace(/(^|\})\s*body\s*\{[^}]*\}/, "$1") + "</style>" +
               "<div class='dc-seg-canvas'>" + SEGX.renderSegmentBody(kit, { tabs: false }) + "</div>";
      } catch (e) {
        try { console.warn("[DC-MI] blueprint view failed, using fallback:", e); } catch (_) {}
        return renderSet(t); // fallback to the native renderer
      }
    }

    function buildHtmlFile(t, tab) {
      const condCount = countConditions(t);
      const chips = [
        meta.segmentType     ? "<span class='chip'><b>Segment Type:</b> " + esc(meta.segmentType) + "</span>" : "",
        meta.segmentOn       ? "<span class='chip'><b>Segment On:</b> " + esc(meta.segmentOn) + "</span>" : "",
        meta.publishType     ? "<span class='chip'><b>Publish Type:</b> " + esc(meta.publishType) + "</span>" : "",
        meta.publishSchedule ? "<span class='chip'><b>Publish Schedule:</b> " + esc(meta.publishSchedule) + "</span>" : "",
        meta.status          ? "<span class='chip status'>" + esc(meta.status) + "</span>" : "",
        "<span class='chip'><b>Tab:</b> " + esc(tab) + "</span>",
        "<span class='chip'><b>Conditions:</b> " + condCount + "</span>",
      ].filter(Boolean).join("\n");

      const css = [
        "*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
        "body{font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin:0;padding:24px 32px;color:#16325c;background:#f4f6fb}",
        ".page{max-width:820px;margin:0 auto}",
        /* header card */
        ".seg-header{background:#fff;border-radius:10px;border:1px solid #c9d9f0;padding:18px 22px 14px;margin-bottom:18px;box-shadow:0 2px 8px rgba(0,0,0,.07)}",
        ".seg-header h1{margin:0 0 8px;font-size:20px;color:#0b5cab;font-weight:800;letter-spacing:-.01em}",
        ".chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}",
        ".chip{display:inline-block;padding:2px 10px;border-radius:12px;background:#edf4ff;color:#16325c;font-size:11.5px;border:1px solid #c9d9f0}",
        ".chip b{color:#0b5cab}",
        ".chip.status{background:#d4f0db;color:#0a6b2d;border-color:#a3d9b1}",
        /* legend */
        ".legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin-bottom:14px;font-size:11.5px;color:#5c6b8a;align-items:center}",
        ".legend-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle}",
        /* conditions */
        ".cond-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 0;padding:7px 10px;min-height:32px}",
        ".dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-right:8px;margin-top:4px;display:inline-block}",
        ".obj{font-weight:700;color:#16325c;margin-right:4px}",
        ".sep{color:#b0bac9;margin-right:4px}",
        ".fld{font-family:SFMono-Regular,Consolas,monospace;font-size:11.5px;color:#0b5cab;font-weight:600;margin-right:8px}",
        ".op{color:#54698d;margin-right:6px;font-style:italic}",
        ".val{font-weight:700;color:#16325c}",
        /* card */
        ".card{display:flex;margin-bottom:0}",
        ".card-bar{width:4px;flex-shrink:0;border-radius:3px 0 0 3px}",
        ".card-body{flex:1;border:1px solid #c9d9f0;border-left:none;border-radius:0 6px 6px 0;background:#fff;overflow:hidden}",
        /* inner joiner (within card) */
        ".inner-join{display:flex;align-items:center;padding:0 10px;height:20px}",
        ".inner-join hr{flex:1;border:none;border-top:1px solid #dee3ed;margin:0}",
        ".inner-join .badge{font:700 10px/1 -apple-system,sans-serif;padding:2px 8px;border-radius:5px;margin-left:6px;flex-shrink:0;letter-spacing:.07em}",
        ".badge-and{color:#0b5cab;background:#edf4ff}",
        ".badge-or{color:#7c3aed;background:#f5f0ff}",
        /* group wrapper */
        ".group{display:flex;margin-bottom:8px}",
        ".group-bar{width:3px;flex-shrink:0;border-radius:3px 0 0 3px}",
        ".group-bar-and{background:#93c5fd}",
        ".group-bar-or{background:#a78bfa}",
        ".group-inner{flex:1;min-width:0;padding-left:6px}",
        ".group-label{display:flex;justify-content:flex-end;margin-bottom:4px}",
        ".group-label .badge{font:700 10px/1 -apple-system,sans-serif;padding:2px 9px;border-radius:5px;letter-spacing:.07em}",
        ".group-cards{display:flex;flex-direction:column;gap:4px}",
        /* agg */
        ".agg-header{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 0;padding:7px 10px;background:#fff8ed}",
        ".agg-sub{padding:5px 8px 5px 12px;background:#fffdf5}",
        /* nested segment */
        ".nested-seg{padding:8px 10px}",
        ".nested-seg .ns-name{font-weight:700;color:#0b5cab;font-size:13px}",
        ".nested-seg .ns-pub{font-size:11.5px;color:#5c6b8a;padding-left:24px;margin-top:2px}",
        /* print */
        "@media print{body{padding:12px 16px;background:#fff}.seg-header{box-shadow:none}}"
      ].join("\n");

      // Render with the blueprint renderer (SF-canvas bracket rails) so the
      // downloaded file matches the on-screen view. Fall back to renderSet on error.
      let rulesHtml, kitCss = "";
      if (t && t.items && t.items.length) {
        try {
          const kit = SEGX.segTreeToKit(t, tab);
          rulesHtml = "<div class='dc-seg-canvas'>" + SEGX.renderSegmentBody(kit, { tabs: false }) + "</div>";
          kitCss = SEGX.SEG_CSS.replace(/(^|\})\s*body\s*\{[^}]*\}/, "$1"); // drop kit's body{} so page shell wins
        } catch (e) { rulesHtml = renderSet(t); }
      } else {
        rulesHtml = "<p style='color:#8a94ab;font-size:13px'>No conditions found for this tab.</p>";
      }

      return "<!DOCTYPE html>\n<html lang='en'>\n<head>\n<meta charset='utf-8'>\n" +
        "<meta name='viewport' content='width=device-width,initial-scale=1'>\n" +
        "<title>" + esc((segName || "Segment") + " — " + tab + " Rules") + "</title>\n" +
        "<style>\n" + css + "\n" + kitCss + "\n</style>\n</head>\n<body>\n<div class='page'>\n" +
        "<div class='seg-header'>\n" +
        "<h1>" + esc(segName || "Segment") + "</h1>\n" +
        "<div class='chips'>\n" + chips + "\n</div>\n</div>\n" +
        "<div class='legend'>" +
        "<span><span class='legend-dot' style='background:#008000'></span>AND join</span>" +
        "<span><span class='legend-dot' style='background:#c55a11'></span>OR join</span>" +
        "</div>\n" +
        rulesHtml + "\n</div>\n</body>\n</html>";
    }

    function countConditions(t) {
      if (!t) return 0;
      if (t.type === "set") return t.items.reduce((s, i) => s + countConditions(i), 0);
      return 1;
    }
    const totalConditions = countConditions(tree);

    // tabData[tabName] = { tree, flat } — current tab is pre-filled; others
    // are eagerly loaded in the background right after the modal opens.
    const tabData = {};
    tabData[activeTab] = { tree, flat };

    if (!detailExportEl) { detailExportEl = document.createElement("div"); document.body.appendChild(detailExportEl); }
    detailExportEl.id = "dc-detail-export";
    detailExportEl.style.cssText = "position:fixed;top:4vh;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(900px,94vw);height:min(82vh,700px);min-width:340px;min-height:260px;max-width:98vw;max-height:96vh;display:flex;flex-direction:column;background:#fff;color:#16325c;border:1px solid #c9cede;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.5);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden";
    // No backdrop for segment export — user needs to see the SF segment canvas behind the modal

    // Build tab bar — only show tabs that exist in the SF UI
    const tabBarHtml = availableTabs.map((name, i) => {
      const count = name === activeTab ? totalConditions : "…";
      return "<div class='tab" + (name === activeTab ? " active" : "") + "' data-tab='" + esc(name) + "'>" + esc(name) + " (<span class='tc'>" + count + "</span>)</div>";
    }).join("");
    // Panes for each tab
    const panesHtml = availableTabs.map((name) => {
      const isActive = name === activeTab;
      const content = isActive ? buildCanvasView(tree, name) : "<div style='padding:24px 0;text-align:center;color:#8a94ab;font-size:13px'>Loading…</div>";
      return "<div class='pane" + (isActive ? " active" : "") + "' data-pane='" + esc(name) + "'>" + content + "</div>";
    }).join("");

    detailExportEl.innerHTML =
      "<style>" +
      "#dc-detail-export .hd{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f3f6fb;border-bottom:1px solid #e0e5ee;flex-shrink:0;flex-wrap:wrap;cursor:move}" +
      "#dc-detail-export .hd strong{font-size:15px;flex-shrink:0}" +
      "#dc-detail-export .meta-bar{display:flex;flex-wrap:wrap;gap:4px 18px;padding:7px 16px;background:#f9fafc;border-bottom:1px solid #e0e5ee;font-size:11px;color:#5c6b8a;flex-shrink:0}" +
      "#dc-detail-export .meta-bar b{color:#16325c}" +
      "#dc-detail-export .tabs{display:flex;gap:0;padding:0 16px;border-bottom:1px solid #e0e5ee;background:#fff;flex-shrink:0;flex-wrap:wrap;align-items:flex-end}" +
      "#dc-detail-export .tab{padding:9px 16px;cursor:pointer;font:600 12px -apple-system,sans-serif;color:#5c6b8a;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;flex-shrink:0}" +
      "#dc-detail-export .tab.active{color:#0b5cab;border-bottom-color:#0b5cab}" +
      "#dc-detail-export .tab.loading{opacity:.6;cursor:default;pointer-events:none}" +
      "#dc-detail-export .tab-actions{display:none}" +
      "#dc-detail-export .toolbar{display:flex;flex-wrap:wrap;gap:8px;padding:8px 12px;border-bottom:1px solid #e0e5ee;background:#fff;flex-shrink:0}" +
      "#dc-detail-export button{flex:1 1 120px;min-width:110px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid #0b5cab;background:#0b5cab;color:#fff;border-radius:6px;padding:7px 8px;font-weight:600;cursor:pointer;font-size:12px;text-align:center}" +
      "#dc-detail-export button.sec{background:#fff;color:#0b5cab}" +
      "#dc-detail-export button svg{flex-shrink:0}" +
      "#dc-detail-export .x{flex:0 0 auto;min-width:auto;border:none;background:transparent;color:#5c6b8a;font-size:20px;padding:0 4px;cursor:pointer;line-height:1;margin-left:4px}" +
      "#dc-detail-export .bd{overflow:auto;flex:1;min-height:0;padding:12px 16px}" +
      "#dc-detail-export .ft{padding:6px 16px;border-top:1px solid #e0e5ee;color:#8a94ab;font-size:11px;background:#f9fafc;flex-shrink:0}" +
      "#dc-detail-export .pane{display:none}#dc-detail-export .pane.active{display:block}" +
      "#dc-detail-export .sp{flex:1 1 0}" +
      "</style>" +
      "<div class='hd'>" +
        "<strong>" + esc(segName || "Segment") + "</strong>" +
        (meta.segmentOn ? "<span style='font-size:11px;color:#5c6b8a'>" + esc(meta.segmentOn) + "</span>" : "") +
        (meta.status    ? "<span style='display:inline-block;padding:1px 8px;border-radius:10px;background:#d4f0db;color:#0a6b2d;font-size:11px'>" + esc(meta.status) + "</span>" : "") +
        "<span class='sp'></span><button class='x' id='dc-d-close'>&times;</button>" +
      "</div>" +
      "<div class='meta-bar'>" +
        (meta.segmentType     ? "<span><b>Segment Type:</b> " + esc(meta.segmentType)   + "</span>" : "") +
        (meta.segmentOn       ? "<span><b>Segment On:</b> " + esc(meta.segmentOn)       + "</span>" : "") +
        (meta.publishType     ? "<span><b>Publish Type:</b> " + esc(meta.publishType)   + "</span>" : "") +
        (meta.publishSchedule ? "<span><b>Publish Schedule:</b> " + esc(meta.publishSchedule) + "</span>" : "") +
        (meta.status          ? "<span><b>Status:</b> "    + esc(meta.status)          + "</span>" : "") +
      "</div>" +
      "<div class='tabs'>" + tabBarHtml + "</div>" +
      "<div class='toolbar'>" +
        "<button id='dc-d-copy' title='Copies the current tab only, as a grid you can paste into Google Sheets or Excel'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>Copy tab for Sheets</button>" +
        "<button class='sec' id='dc-d-csv' title='Downloads the current tab as a standalone HTML file (opens with no tools installed)'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><path d='M3 2h7l3 3v9H3z' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M10 2v3h3'/><path d='M6 9l2 2 2-2M8 7v4'/></svg>Download HTML (tab)</button>" +
        "<button class='sec' id='dc-d-xlsx' title='Downloads ONE Excel workbook with all tabs, a Segment Setup sheet, and a How to Rebuild guide'><svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><path d='M3 2h7l3 3v9H3z' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M6 8l4 4M10 8l-4 4' stroke='currentColor' stroke-width='1.5'/></svg>Download Excel (all tabs)</button>" +
      "</div>" +
      "<div class='bd'>" + panesHtml + "</div>" +
      "<div class='ft' id='dc-seg-ft'>" + totalConditions + " condition(s) · " + esc(activeTab) + "</div>";

    const closeDetail = () => { if (detailExportEl) { detailExportEl.remove(); detailExportEl = null; } hideBackdrop(); };
    detailExportEl.querySelector("#dc-d-close").onclick = closeDetail;

    const ftEl = detailExportEl.querySelector("#dc-seg-ft");

    // Track which tab is currently shown in the modal
    let currentModalTab = activeTab;

    // Helper: fill a tab's pane + count once its data arrives
    function applyTabData(name, t2, f2) {
      if (!detailExportEl) return;
      const tabEl = detailExportEl.querySelector(".tab[data-tab='" + name + "']");
      const pane  = detailExportEl.querySelector(".pane[data-pane='" + name + "']");
      const n = countConditions(t2);
      if (tabEl) {
        const tcEl = tabEl.querySelector(".tc");
        if (tcEl) tcEl.textContent = n;
        tabEl.classList.remove("loading");
      }
      // Only overwrite pane content if it still shows the loading placeholder
      // (don't stomp on content the user is already reading)
      if (pane && (!pane.classList.contains("active") || pane.innerHTML.includes("Loading"))) {
        pane.innerHTML = buildCanvasView(t2, name);
      }
      if (name === currentModalTab && ftEl && detailExportEl) {
        ftEl.textContent = n + " condition(s) · " + name;
      }
    }

    // Wire up tab clicks — data is pre-loaded; click just switches the view
    detailExportEl.querySelectorAll(".tab").forEach((tabEl) => {
      tabEl.addEventListener("click", async () => {
        const name = tabEl.getAttribute("data-tab");
        if (!name || name === currentModalTab) return;

        detailExportEl.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        tabEl.classList.add("active");
        detailExportEl.querySelectorAll(".pane").forEach(p => p.classList.remove("active"));
        const pane = detailExportEl.querySelector(".pane[data-pane='" + name + "']");

        if (!tabData[name]) {
          // Still loading — show spinner and wait
          tabEl.classList.add("loading");
          if (pane) { pane.classList.add("active"); pane.innerHTML = "<div style='padding:24px 0;text-align:center;color:#8a94ab;font-size:13px'>Loading " + esc(name) + "…</div>"; }
          const { tree: t2, flat: f2 } = await readConditionsForTab(name, activeTab);
          tabData[name] = { tree: t2, flat: f2 };
          applyTabData(name, t2, f2);
        } else {
          // Already loaded — instant switch
          if (pane) { pane.classList.add("active"); pane.innerHTML = buildCanvasView(tabData[name].tree, name); }
        }

        tabEl.classList.remove("loading");
        currentModalTab = name;
        const n = countConditions(tabData[name].tree);
        if (ftEl && detailExportEl) ftEl.textContent = n + " condition(s) · " + name;
      });
    });

    // Eagerly pre-load all other tabs in the background so clicking them is instant.
    // Runs sequentially (one SF tab-switch at a time) to avoid race conditions.
    (async () => {
      for (const name of availableTabs) {
        if (tabData[name]) continue; // already loaded (the active tab)
        if (!detailExportEl) break;  // modal was closed
        try {
          const { tree: t2, flat: f2 } = await readConditionsForTab(name, activeTab);
          if (!detailExportEl) break;
          tabData[name] = { tree: t2, flat: f2 };
          applyTabData(name, t2, f2);
        } catch(e) {}
      }
    })();

    detailExportEl.querySelector("#dc-d-copy").onclick = (e) => {
      const d = tabData[currentModalTab] || {};
      const flat = d.flat || [];
      const btn = e.currentTarget || e.target;
      const COPY_ICON = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><rect x='5' y='4' width='8' height='10' rx='1.5' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M3 2h7v2H5v8H3z' fill='currentColor'/></svg>";
      const restore = (txt) => setTimeout(() => (btn.innerHTML = COPY_ICON + "Copy tab for Sheets"), 1400);
      const ok   = () => { btn.textContent = "✓ Copied!"; restore(); };
      const fail = () => { btn.textContent = "Failed";  restore(); };
      // Nothing to copy on an empty tab — tell the user instead of copying a blank grid.
      const hasCriteria = d.tree && d.tree.items && d.tree.items.length;
      if (!hasCriteria) { btn.textContent = "Nothing to copy on this tab"; restore(); return; }
      // Copy the SAME blueprint grid that Download Excel produces: render the kit
      // tree onto a MiniXLSX sheet, then serialize that sheet to an HTML table.
      // Falls back to the legacy clipboard table if anything goes wrong.
      let tableHtml;
      try {
        const kit = SEGX.segTreeToKit(d.tree || { type:"set", items:[] }, currentModalTab);
        const wb = new SEGX.MiniXLSX.Workbook();
        const ws = wb.addWorksheet("seg", { views: [{ showGridLines: false }] });
        SEGX.renderSheet(ws, kit);
        tableHtml = ws.toHtmlTable();
      } catch (err) {
        tableHtml = toClipboardHtml(d.tree || { type:"set", items:[] }, flat, currentModalTab);
      }

      // execCommand('copy') on a real DOM selection produces CF_HTML that Excel/Word/Sheets all understand.
      // ClipboardItem+Blob only works for browser targets (Google Sheets web), not Excel desktop.
      const tryExecCopy = () => {
        const div = document.createElement("div");
        div.contentEditable = "true";
        div.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
        div.innerHTML = tableHtml;
        document.body.appendChild(div);
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(div);
        sel.removeAllRanges();
        sel.addRange(range);
        let success = false;
        try { success = document.execCommand("copy"); } catch(err) {}
        sel.removeAllRanges();
        div.remove();
        return success;
      };

      if (tryExecCopy()) { ok(); return; }

      // Fallback: ClipboardItem API (works in Chrome/Edge for Google Sheets)
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        const htmlBlob  = new Blob([tableHtml], { type: "text/html" });
        const plainBlob = new Blob([toTSV(flat, currentModalTab)], { type: "text/plain" });
        navigator.clipboard.write([new ClipboardItem({ "text/html": htmlBlob, "text/plain": plainBlob })]).then(ok).catch(() => {
          navigator.clipboard.writeText(toTSV(flat, currentModalTab)).then(ok).catch(fail);
        });
      } else {
        navigator.clipboard.writeText(toTSV(flat, currentModalTab)).then(ok).catch(fail);
      }
    };

    addResizeHandle(detailExportEl, 340, 260);
    detailExportEl.querySelector("#dc-d-csv").onclick = (e) => {
      const d = tabData[currentModalTab] || {};
      const btn = e.currentTarget || e.target;
      // Don't produce an empty HTML file — if this tab has no conditions, say so
      // instead of downloading a blank document.
      const hasCriteria = d.tree && d.tree.items && d.tree.items.length;
      if (!hasCriteria) {
        const CSV_ICON = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><path d='M3 2h7l3 3v9H3z' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M10 2v3h3'/><path d='M6 9l2 2 2-2M8 7v4'/></svg>";
        btn.textContent = "No conditions on this tab";
        setTimeout(() => (btn.innerHTML = CSV_ICON + "Download HTML (tab)"), 1600);
        return;
      }
      const fn = safeFilename(segName || "segment");
      const html = buildHtmlFile(d.tree, currentModalTab);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fn + "-" + safeFilename(currentModalTab) + "-rules.html";
      document.body.appendChild(a); a.click(); a.remove();
    };

    // Download Excel — ONE .xlsx, one sheet per tab that actually has criteria
    // (Include / Exclude / Rank and Limit). Uses the self-contained blueprint
    // renderer (container bars + AND/OR rails) with no external dependency.
    const xlsxBtn = detailExportEl.querySelector("#dc-d-xlsx");
    if (xlsxBtn) xlsxBtn.onclick = async () => {
      const btn = xlsxBtn;
      const restore = () => setTimeout(() => (btn.innerHTML = "<svg width='13' height='13' viewBox='0 0 16 16' fill='currentColor' style='vertical-align:middle;margin-right:4px'><path d='M3 2h7l3 3v9H3z' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M6 8l4 4M10 8l-4 4' stroke='currentColor' stroke-width='1.5'/></svg>Download Excel (all tabs)"), 1600);
      try {
        // Make sure every available tab is loaded (background loader may still be running)
        for (const name of availableTabs) {
          if (!tabData[name]) {
            btn.textContent = "Loading " + name + "…";
            try { const r = await readConditionsForTab(name, activeTab); tabData[name] = { tree: r.tree, flat: r.flat }; applyTabData(name, r.tree, r.flat); } catch (e) {}
          }
        }
        // Convert each non-empty tab to the kit tree; skip tabs with no criteria.
        const trees = {};
        for (const name of availableTabs) {
          const t = tabData[name] && tabData[name].tree;
          if (t && t.items && t.items.length) trees[name] = SEGX.segTreeToKit(t, name);
        }
        const names = Object.keys(trees);
        if (!names.length) { btn.textContent = "No criteria"; restore(); return; }
        btn.textContent = "Building…";
        const xlMeta = {
          segName: segName, segmentType: meta.segmentType, segmentOn: meta.segmentOn, dataSpace: meta.dataSpace,
          publishType: meta.publishType, publishSchedule: meta.publishSchedule, refreshMode: meta.refreshMode,
          status: meta.status, description: meta.description, population: meta.population,
        };
        const buf = await SEGX.buildSegmentWorkbookMulti(SEGX.MiniXLSX, trees, false, xlMeta);
        const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const fn = safeFilename(segName || "segment") + ".xlsx";
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fn;
        document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 8000);
        btn.textContent = "✓ " + names.length + " sheet" + (names.length > 1 ? "s" : "");
        restore();
      } catch (e) {
        btn.textContent = "Failed"; restore();
        try { console.error("[DC-MI] segment Excel export failed:", e); } catch (_) {}
      }
    };

    // Drag by header
    const hdEl = detailExportEl.querySelector(".hd");
    if (hdEl) {
      let dx = 0, dy = 0;
      hdEl.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        const r = detailExportEl.getBoundingClientRect();
        detailExportEl.style.left = r.left + "px"; detailExportEl.style.top = r.top + "px";
        detailExportEl.style.transform = "none";
        dx = e.clientX - r.left; dy = e.clientY - r.top;
        const onMove = (ev) => {
          detailExportEl.style.left = Math.max(0, Math.min(window.innerWidth  - 100, ev.clientX - dx)) + "px";
          detailExportEl.style.top  = Math.max(0, Math.min(window.innerHeight - 40,  ev.clientY - dy)) + "px";
        };
        const onUp = () => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); };
        document.addEventListener("pointermove", onMove); document.addEventListener("pointerup", onUp);
        e.preventDefault();
      });
    }

    const onEsc = (e) => { if (e.key === "Escape") { closeDetail(); document.removeEventListener("keydown", onEsc, true); } };
    document.addEventListener("keydown", onEsc, true);
    const onOut = (e) => { if (detailExportEl && !detailExportEl.contains(e.target)) { closeDetail(); document.removeEventListener("pointerdown", onOut, true); } };
    setTimeout(() => document.addEventListener("pointerdown", onOut, true), 100);
  }

  // ===== DATA EXPLORE PAGE =====
  // Detects runtime_cdp-data-view-record-list (Data Explore / Data View tab).
  // Features:
  //   - Column picker: select any of ALL available fields (not just SF's 10)
  //   - Save/restore column selection per object (localStorage, keyed by objectApiName)
  //   - Export visible rows to CSV
  //   - Copy SOQL with selected columns + custom LIMIT

  function findRecordListEl() {
    let el = null;
    eachElement(document, e => { if (!el && tagOf(e) === "runtime_cdp-data-view-record-list") el = e; });
    return el;
  }

  // Resolve the DATA SPACE for a given object — using ONLY authoritative sources, never
  // guessing from the object name (that was the "RH_Profile__dll → RH → denied" bug:
  // the name prefix is NOT the data space). Priority:
  //   1) the exact space the PAGE used for THIS object (captured from its own query)
  //   2) LWC/object-selector props, if exposed
  //   3) the most-recent sniffed space (same page session)
  // Returns "" if genuinely unknown — callers then try candidate spaces incl. "default".
  function resolveDataSpace(objectName) {
    // 1) authoritative: the space the page itself queried THIS object with
    if (objectName && _dsByObject[objectName] != null) return _dsByObject[objectName];
    // 2) LWC props (usually undefined, but authoritative when present)
    var rl = findRecordListEl();
    var cand = ["dataSpace", "dataspace", "selectedDataSpaceName", "dataSpaceName", "space"];
    if (rl) { for (var i = 0; i < cand.length; i++) { try { var v = rl[cand[i]]; if (v && typeof v === "string") return v; } catch (e) {} } }
    var sel = null;
    eachElement(document, function (e) { if (!sel && tagOf(e) === "runtime_cdp-data-view-object-selector") sel = e; });
    if (sel) { for (var j = 0; j < cand.length; j++) { try { var v2 = sel[cand[j]]; if (v2 && typeof v2 === "string") return v2; } catch (e) {} } }
    // 3) last sniffed space this session (the object currently open usually matches)
    if (_auraSniff.dataSpace != null) return _auraSniff.dataSpace;
    return "";   // unknown → caller tries candidate spaces (incl. "default")
  }
  // Known-space candidates to try, MOST-AUTHORITATIVE first. We collect every distinct
  // data space the page has used this session (from _dsByObject) plus "" and "default",
  // so a query works even when we haven't captured THIS object's space yet.
  function dataSpaceCandidates(objectName) {
    var out = [], seen = {};
    var add = function (s) { if (s != null && !seen[s]) { seen[s] = 1; out.push(s); } };
    add(resolveDataSpace(objectName));                 // best guess first (may be "")
    Object.keys(_dsByObject).forEach(function (k) { add(_dsByObject[k]); });  // any seen space
    if (_auraSniff.dataSpace != null) add(_auraSniff.dataSpace);
    // Read from page UI as fallback (covers cold-start bookmarklet)
    if (typeof readPageDataSpace === "function") { var pageDs = readPageDataSpace(); if (pageDs) add(pageDs); }
    // Derive from object name prefix: TDI_Quote__dlm → "TDI" (last resort, but proven
    // correct for this org pattern where prefix = dataspace). Only use if the prefix is
    // short (≤6 chars) and alphanumeric — avoids false positives on longer prefixes.
    if (objectName) {
      var prefixMatch = objectName.match(/^([A-Za-z0-9]{2,6})_/);
      if (prefixMatch) add(prefixMatch[1]);
    }
    add(""); add("default");
    return out;
  }

  // Module-level store for state that must survive SF re-rendering the DOM element.
  // Keys are objectApiName strings. Values: { allColumns, lastApplied }.
  const _exploreCache = {};
  function exploreCache(objectName) {
    if (!_exploreCache[objectName]) _exploreCache[objectName] = { allColumns: null, lastApplied: null };
    return _exploreCache[objectName];
  }
  function exploreCacheClear(objectName) {
    if (_exploreCache[objectName]) {
      _exploreCache[objectName].allColumns  = null;
      _exploreCache[objectName].lastApplied = null;
    }
  }

  function isDataExplorePage() {
    // URL hint: Data Explorer lives under specific paths. Exclude known non-Explorer pages.
    var h = location.href;
    // List views (no record ID in /r/DataStream/ etc.) are NOT Data Explorer
    if (/\/r\/(DataStream|DataLakeObjectInstance|Segment|DataQueryWorkspace)\/?$/i.test(h)) return false;
    if (/\/r\/(DataStream|DataLakeObjectInstance|Segment|DataQueryWorkspace)\/[^/]*\/?(list|related)/i.test(h)) return false;
    // Segment pages are NOT Data Explorer (even if they contain a record-list component)
    if (/segmentWizard|standard-Segment|\/r\/Segment\//i.test(h)) return false;
    return !!findRecordListEl();
  }

  // ── Safety limits for the Data Explorer query/render (prevents browser freeze) ──
  // The documented /ssot/query-sql endpoint allows up to 49,999 rows, but rendering
  // 50k×60 = 3M DOM nodes would hang the tab. So: allow FETCHING a lot (CSV can hold
  // it), but only RENDER a bounded number of rows into the table (the rest stay in the
  // data set for CSV export). Conservative, tunable ceilings; defined here (module top)
  // so every function below can rely on them.
  var DC_MAX_FETCH_ROWS  = 49999;  // hard ceiling accepted by the endpoint
  var DC_WARN_ROWS       = 5000;   // above this we warn it may be slow
  var DC_MAX_RENDER_ROWS = 2000;   // cap DOM rows; extras remain exportable via CSV

  // ── Aura query harvesting ───────────────────────────────────────────────────
  // Data Explorer fetches rows via an Aura server action (proven by probes 1–5):
  //   POST /aura?...ui-cdp-components-controllers.CdpDataView.query=1
  //   message.actions[0].descriptor =
  //     serviceComponent://ui.cdp.components.controllers.CdpDataViewController/ACTION$query
  //   params.query = { objectName, columns:[...], selectedDataSpaceName }
  //   response.actions[0].returnValue = [ { fields:{ <fieldApi>:value, ..., Id } }, ... ]
  // The 10-column limit is UI-ONLY — the backend returns ALL requested columns in one
  // call. So we passively capture a live request's aura.context/token/pageURI, then
  // replay the SAME read-only query with EVERY selected column. No dialog, no batching.
  var _auraSniff = { context: null, token: null, pageURI: null, dataSpace: null, objectName: null, template: null, installed: false };
  // REAL data space per object, captured from the page's own queries. The data space is
  // NOT derivable from the object name (e.g. DLO "RH_Profile__dll" is NOT in space "RH").
  // The ONLY reliable source is the {objectName, selectedDataSpaceName} pair the page
  // itself sends — so we remember it here, keyed by objectName.
  var _dsByObject = {};

  function decodeFormField(v) { try { return decodeURIComponent((v || "").replace(/\+/g, " ")); } catch (e) { return v || ""; } }

  // Pull the aura.* credentials + query params out of a captured x-www-form-urlencoded body.
  // aura.context / aura.token / aura.pageURI are SESSION-GLOBAL — identical across EVERY
  // aura action — so we grab them from ANY /aura POST (telemetry, navigation, etc.), which
  // the page fires constantly. objectName + dataSpace come only from a CdpDataView.query.
  function absorbAuraForm(body) {
    var s = String(body || "");
    var parts = s.split("&"), map = {};
    parts.forEach(function (p) { var i = p.indexOf("="); if (i > 0) map[p.slice(0, i)] = p.slice(i + 1); });
    if (map["aura.context"]) _auraSniff.context = map["aura.context"];   // keep URL-encoded (posted verbatim)
    if (map["aura.token"])   _auraSniff.token   = map["aura.token"];
    if (map["aura.pageURI"]) _auraSniff.pageURI = map["aura.pageURI"];
    // From a CdpDataView query, keep the WHOLE decoded action as a template — cloning
    // it (and swapping only columns) is far more reliable than rebuilding from parts,
    // because it preserves the exact query shape SF expects (dataSpace, etc.).
    if (/CdpDataView|ACTION\$query|QueryWorkspace|queryDCSql/i.test(s) && map["message"]) {
      try {
        var msg = JSON.parse(decodeFormField(map["message"]));
        var actions = (msg && msg.actions) || [];
        for (var ai = 0; ai < actions.length; ai++) {
          var act = actions[ai];
          if (!act || !act.params) continue;
          var q = act.params.query;
          if (q) {
            _auraSniff.template = act;
            if (q.objectName) _auraSniff.objectName = q.objectName;
            if (q.selectedDataSpaceName != null) _auraSniff.dataSpace = q.selectedDataSpaceName;
            if (q.objectName && q.selectedDataSpaceName != null) _dsByObject[q.objectName] = q.selectedDataSpaceName;
          }
          // Capture dataspace from QueryWorkspace.queryDCSql params (Query Editor page)
          // Handle both "dataspace" and "dataSpace" casing
          var capturedDs = act.params.dataspace || act.params.dataSpace || act.params.selectedDataSpaceName || "";
          if (capturedDs) _auraSniff.dataSpace = capturedDs;
        }
      } catch (e) {}
    }
  }
  // Ready only when we have credentials AND a real captured query template — the
  // template carries the correct dataSpace/shape, without which the backend rejects
  // the query ("Something's not right with the query").
  function haveAuraCreds() { return !!(_auraSniff.context && _auraSniff.token && _auraSniff.template); }

  // Install fetch + XHR wrappers ONCE to passively remember the freshest credentials
  // from ANY aura traffic. Read-only observation; we never block or alter requests.
  function installAuraSniffer() {
    if (_auraSniff.installed) return;
    _auraSniff.installed = true;
    try {
      var of = window.fetch;
      window.fetch = function (input, init) {
        try {
          var url = (typeof input === "string") ? input : (input && input.url) || "";
          if (/\/aura/i.test(url) && init && init.body) absorbAuraForm(init.body);
        } catch (e) {}
        return of.apply(this, arguments);
      };
    } catch (e) {}
    try {
      var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) { this.__dcU = u; return oo.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function (b) {
        try { if (/\/aura/i.test(String(this.__dcU || "")) && b) absorbAuraForm(b); } catch (e) {}
        return os.apply(this, arguments);
      };
    } catch (e) {}
  }

  // Guarantee we have a captured CdpDataView query template before running the query
  // functions. If one was already seen (page load / sort / apply) we're set. Otherwise
  // we must trigger a REAL re-query so the sniffer captures a template.
  //
  // CRITICAL: re-applying the SAME columns is a NO-OP in SF — no re-query fires, so no
  // template is captured (this was the "Couldn't reach the query service" bug). To
  // force an actual query we apply a DIFFERENT column set (drop the last column), let
  // it fire, then restore the original. Both go through SF's dialog (flash suppressed).
  // We only truly need session CREDENTIALS (context+token) — queryAllColumns can build
  // the query from scratch when no template was captured. Credentials come from ANY
  // /aura request, and the page fires those constantly, so this almost always succeeds
  // fast. The dialog-drive below is a best-effort nudge to speed up a cold start.
  function haveCredsOnly() { return !!(_auraSniff.context && _auraSniff.token); }

  // Read aura token + context DIRECTLY from the page's own Aura framework. This is the
  // deterministic path — no sniffing, no waiting for a request. If it yields both, we
  // populate _auraSniff so every query works on the FIRST click. Best-effort + guarded;
  // if the framework shape differs we simply fall back to the sniffer (below).
  function primeCredsFromAura() {
    if (haveCredsOnly()) return true;
    try {
      var $A = window.$A;
      if (!$A || !$A.getContext) return false;
      var ctx = $A.getContext();
      // token: several framework versions expose it differently
      var token = (ctx.getCsrfToken && ctx.getCsrfToken())
        || ($A.clientService && ($A.clientService._token || $A.clientService.token))
        || (window.aura && window.aura.token) || "";
      // context: the exact object aura posts as aura.context
      var ctxForServer = ctx.getContextForServer && ctx.getContextForServer();
      var ctxStr = ctxForServer ? (typeof ctxForServer === "string" ? ctxForServer : JSON.stringify(ctxForServer)) : "";
      if (token && ctxStr) {
        // store URL-encoded to match what absorbAuraForm captures (posted verbatim)
        _auraSniff.token = encodeURIComponent(token);
        _auraSniff.context = encodeURIComponent(ctxStr);
        if (!_auraSniff.pageURI) { try { _auraSniff.pageURI = encodeURIComponent("/one/one.app"); } catch (e) {} }
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Proactively warm up credentials on Explore-page load: try the direct framework
  // read first; if that doesn't yield creds, trigger ONE real query (invisible column
  // flip + restore) so the sniffer captures them BEFORE the user clicks anything. This
  // is what removes the hit-and-trial: by the time the modal opens, creds are ready.
  var _warmedUp = false;
  function warmUpQueryContext() {
    if (_warmedUp) return; _warmedUp = true;
    if (extBridgePresent()) return;                  // extension handles auth via sid cookie — no nudge needed
    if (primeCredsFromAura()) return;               // instant, deterministic
    // else nudge a real query in the background (best-effort, bookmarklet only)
    try {
      const rl = findRecordListEl();
      const current = rl ? getCurrentFields(rl) : [];
      if (current.length >= 2 && typeof applyColumnViaSF === "function") {
        const probeSet = current.slice(0, current.length - 1);
        applyColumnViaSF(probeSet, function () {
          setTimeout(function () { try { applyColumnViaSF(current, function () {}); } catch (e) {} }, 400);
        });
      }
    } catch (e) {}
  }

  function ensureQueryContext(cb) {
    // 0) EXTENSION mode: auth is handled in the background via the sid cookie — no
    // sniffed creds needed. Always "ready". This is the reliable path (no hit-and-trial).
    if (extBridgePresent()) { cb(true); return; }
    // 1) direct framework read (deterministic, instant)
    if (primeCredsFromAura()) { cb(true); return; }
    if (haveCredsOnly()) { cb(true); return; }
    const rl = findRecordListEl();
    const current = rl ? getCurrentFields(rl) : [];
    var polls = 0, done = false;
    function finish(ok) { if (done) return; done = true; cb(ok); }
    function poll() {
      if (primeCredsFromAura() || haveCredsOnly()) { finish(true); return; }
      if (polls++ > 50) { finish(false); return; }   // ~10s max
      setTimeout(poll, 200);
    }
    // 2) fallback nudge: force a real /aura query by changing the column set, then restore
    if (current.length >= 2 && typeof applyColumnViaSF === "function") {
      var probeSet = current.slice(0, current.length - 1);
      try {
        applyColumnViaSF(probeSet, function () {
          setTimeout(function () { try { applyColumnViaSF(current, function () {}); } catch (e) {} }, 400);
        });
      } catch (e) {}
    } else if (current.length && typeof applyColumnViaSF === "function") {
      try { applyColumnViaSF(current, function () {}); } catch (e) {}
    }
    poll();
  }

  // "Connect to Data Cloud" — renders a button that triggers credential capture, then
  // calls `onConnected()`. Use wherever ensureQueryContext fails in bookmarklet mode.
  function renderConnectButton(container, onConnected) {
    if (extBridgePresent()) { onConnected(); return; }
    container.innerHTML = "";
    var box = document.createElement("div");
    box.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px;";
    var msg = document.createElement("div");
    msg.style.cssText = "font:12px/1.5 -apple-system,sans-serif;color:#475569;text-align:center;";
    msg.textContent = "Connect to Data Cloud to enable querying.";
    var btn = document.createElement("button");
    btn.textContent = "Connect to Data Cloud";
    btn.style.cssText = "border:none;border-radius:20px;padding:10px 20px;cursor:pointer;font:600 12px -apple-system,sans-serif;color:#fff;background:linear-gradient(135deg,#6366f1,#4f46e5);box-shadow:0 3px 12px rgba(99,102,241,.3);transition:transform .1s;";
    btn.onmouseenter = function () { btn.style.transform = "scale(1.03)"; };
    btn.onmouseleave = function () { btn.style.transform = "scale(1)"; };
    btn.onclick = function () {
      btn.disabled = true; btn.textContent = "Connecting…";
      msg.textContent = "Establishing session…";
      // Try direct framework read first (instant if available)
      if (primeCredsFromAura() || haveCredsOnly()) {
        btn.textContent = "Connected ✓";
        btn.style.background = "linear-gradient(135deg,#10b981,#059669)";
        msg.textContent = "Ready — you can query now.";
        setTimeout(onConnected, 600);
        return;
      }
      // Force an /aura call: try column toggle on record list, or fire a minimal
      // navigation aura action (which also sends aura.context + aura.token)
      var triggered = false;
      var rl = findRecordListEl();
      var current = rl ? getCurrentFields(rl) : [];
      if (current.length >= 2 && typeof applyColumnViaSF === "function") {
        var probeSet = current.slice(0, current.length - 1);
        try { applyColumnViaSF(probeSet, function () {
          setTimeout(function () { try { applyColumnViaSF(current, function () {}); } catch (e) {} }, 400);
        }); triggered = true; } catch (e) {}
      } else if (current.length && typeof applyColumnViaSF === "function") {
        try { applyColumnViaSF(current, function () {}); triggered = true; } catch (e) {}
      }
      // Fallback: fire a dummy /aura POST (the sniffer catches context+token from ANY aura call)
      if (!triggered) {
        try {
          fetch("/aura?r=99&aura.ApexAction.execute=1", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: "message=%7B%22actions%22%3A%5B%5D%7D&aura.context=%7B%7D&aura.token=undefined",
            credentials: "include"
          }).catch(function () {});
        } catch (e) {}
      }
      // Also try clicking a sortable column header in the page to trigger a real query
      if (!triggered) {
        try {
          var sortBtn = document.querySelector("th[aria-sort] button, th button[title*='Sort'], [data-aura-rendered-by] th");
          if (sortBtn) { sortBtn.click(); setTimeout(function () { sortBtn.click(); }, 500); }
        } catch (e) {}
      }
      // Poll for credentials (longer timeout since we're trying multiple approaches)
      var attempts = 0;
      var check = function () {
        if (primeCredsFromAura() || haveCredsOnly()) {
          btn.textContent = "Connected ✓";
          btn.style.background = "linear-gradient(135deg,#10b981,#059669)";
          msg.textContent = "Ready — you can query now.";
          setTimeout(onConnected, 600);
          return;
        }
        if (attempts++ > 60) {
          btn.disabled = false; btn.textContent = "Retry";
          msg.innerHTML = "Sort any column in the table above, then click <b>Retry</b>.";
          return;
        }
        setTimeout(check, 250);
      };
      setTimeout(check, 500);
    };
    box.appendChild(msg); box.appendChild(btn);
    container.appendChild(box);
  }

  // Run ONE read-only query for the given columns; resolves to an array of row objects
  // (each a flat {fieldApi: value, Id}). Rejects with a readable message on failure.
  // We CLONE the captured live-query action and swap only columns (+ optional limit),
  // preserving SF's exact query shape (dataSpace, paging keys, etc.) so the backend
  // doesn't reject it. `limit` (optional) overrides the page's default row count.
  function queryAllColumns(objectName, columns, dataSpace, limit) {
    return new Promise(function (resolve, reject) {
      // Need session credentials (from ANY /aura call). A captured template is
      // preferred (exact shape), but if we only have creds we BUILD a minimal query
      // from the shape probe 4/5 proved — {objectName, columns, selectedDataSpaceName}.
      if (!_auraSniff.context || !_auraSniff.token) {
        reject(new Error("Session not connected — click 'Connect to Data Cloud' or sort a column to establish a session.")); return;
      }
      var act;
      if (_auraSniff.template) {
        try { act = JSON.parse(JSON.stringify(_auraSniff.template)); }
        catch (e) { act = null; }
      }
      if (!act) {
        // Build from scratch — proven-valid minimal CdpDataView.query shape.
        var ds0 = (dataSpace != null) ? dataSpace : (_auraSniff.dataSpace != null ? _auraSniff.dataSpace : "default");
        act = {
          descriptor: "serviceComponent://ui.cdp.components.controllers.CdpDataViewController/ACTION$query",
          callingDescriptor: "UNKNOWN",
          params: { query: { objectName: objectName, columns: [], selectedDataSpaceName: ds0 } }
        };
      }
      _auraQid = (_auraQid || 0) + 1;
      act.id = "dc-" + _auraQid + ";a";
      var q = act.params && act.params.query;
      if (!q) { reject(new Error("Query template shape unexpected.")); return; }
      q.columns = columns.slice();
      if (objectName) q.objectName = objectName;
      if (dataSpace != null) q.selectedDataSpaceName = dataSpace;
      // Row count: SF uses keys like maxRows/pageSize/count/limit depending on version.
      // Only override the ones the captured template ALREADY has, so we don't invent a
      // param the backend rejects.
      if (limit != null) {
        ["maxRows", "pageSize", "count", "limit", "rowLimit", "size"].forEach(function (k) {
          if (q[k] != null) q[k] = limit;
        });
      }
      var msg = { actions: [act] };
      var form = "message=" + encodeURIComponent(JSON.stringify(msg)) +
        "&aura.context=" + _auraSniff.context +
        "&aura.pageURI=" + (_auraSniff.pageURI || "") +
        "&aura.token=" + _auraSniff.token;
      fetch("/aura?r=" + _auraQid + "&ui-cdp-components-controllers.CdpDataView.query=1", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: form, credentials: "include"
      }).then(function (r) { return r.text(); }).then(function (txt) {
        // SESSION EXPIRED: SF's /aura returns a login redirect / invalidSession marker
        // instead of JSON when the session dies. Detect and give a clear message.
        if (/aura:invalidSession|window\.location|\/secur\/login|INVALID_SESSION/i.test(txt) && txt.indexOf("actions") < 0) {
          reject(new Error("Your Salesforce session has expired — reload this page (log in again), then click the bookmark and retry.")); return;
        }
        var json; try { json = JSON.parse(txt); } catch (e) { reject(new Error("Query response was not JSON.")); return; }
        var a2 = json && json.actions && json.actions[0];
        if (!a2) { reject(new Error("Query response had no actions.")); return; }
        if (a2.state !== "SUCCESS") {
          var em = "";
          try { em = (a2.error && a2.error[0] && a2.error[0].message) || a2.state; } catch (e) { em = a2.state; }
          if (/invalidSession|INVALID_SESSION|session expired/i.test(em)) { reject(new Error("Your Salesforce session has expired — reload this page and retry.")); return; }
          reject(new Error("Query failed: " + em)); return;
        }
        var rv = a2.returnValue || [];
        var list = Array.isArray(rv) ? rv : (rv.records || rv.data || []);
        var rows = list.map(function (r) { return (r && r.fields) ? r.fields : r; }).filter(Boolean);
        resolve(rows);
      }).catch(function (err) { reject(new Error("Query request failed: " + err)); });
    });
  }
  var _auraQid = 0;

  // >100 rows: the Data Explorer's own query is hard-capped at 100 (probe 6) and the
  // REST Query API is CORS-walled (probe 7). But the Data Cloud QUERY EDITOR runs SQL
  // via a same-origin aura action that honors rowLimit (probe 8):
  //   POST /aura ... QueryWorkspace.queryDCSql=1
  //   params { sql, rowLimit, dataspace }
  //   returnValue.dataRows[ { row:[v1,v2,...] } ]  — POSITIONAL, in SELECT order.
  // We BUILD the SQL from the user's selected columns (proven-valid field names) so the
  // user never writes SQL, then map each positional row back to {fieldApi:value, Id}.
  // Requires the same aura creds the sniffer already captured. Reject with the SF
  // error verbatim so SQL-dialect edge cases are visible.
  function sqlQuoteIdent(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }

  // Are we running as the browser EXTENSION (bridge.js present)? It stamps this attr.
  // Extension mode unlocks the DOCUMENTED /ssot/query-sql endpoint (via the bridge →
  // background, which reads the sid cookie) — up to 49,999 rows, supported API. The
  // bookmarklet has no bridge → we fall back to the internal /aura path (100-row cap).
  function extBridgePresent() {
    try { return document.documentElement.getAttribute("data-dc-ext") === "1"; } catch (e) { return false; }
  }
  var _dcBridgeSeq = 0;
  // Run a SELECT via the extension bridge → background → documented /ssot/query-sql.
  // Resolves rows as POSITIONAL arrays aligned to `metadata[]` (mapped to selectCols by
  // the caller). Rejects with the server error. 20s timeout so a dead bridge can't hang.
  function runDcSqlViaBridge(sql, rowLimit, dataspace) {
    return new Promise(function (resolve, reject) {
      var id = "dcq-" + (_dcBridgeSeq = (_dcBridgeSeq || 0) + 1);
      var done = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        var d = ev.data;
        if (!d || d.__dcRes !== "dc-sql-query" || d.id !== id) return;
        window.removeEventListener("message", onMsg, false);
        if (done) return; done = true;
        if (d.ok && d.resp) resolve({ data: d.resp.data || [], metadata: d.resp.metadata || [], queryId: d.resp.queryId || "", rowCount: d.resp.rowCount || 0 });
        else reject(new Error(d.error || (d.resp && d.resp.error) || "bridge query failed"));
      }
      window.addEventListener("message", onMsg, false);
      // dataspace is REQUIRED by /ssot/query-sql (probe: no ds → 400, ds="TDI" → 201).
      window.postMessage({ __dcReq: "dc-sql-query", id: id, sql: sql, rowLimit: rowLimit || 2000, dataspace: dataspace || "" }, "*");
      setTimeout(function () { if (!done) { done = true; window.removeEventListener("message", onMsg, false); reject(new Error("bridge timeout — the query may still be running on the server. Try again or use a smaller row limit.")); } }, 120000);
    });
  }

  // Fetch one page of a paginated query result via the extension bridge.
  function fetchPageViaBridge(queryId, offset, rowLimit, dataspace) {
    return new Promise(function (resolve, reject) {
      if (!extBridgePresent()) { reject(new Error("Pagination requires the extension.")); return; }
      var id = "dcp-" + (_dcBridgeSeq = (_dcBridgeSeq || 0) + 1);
      var done = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        var d = ev.data;
        if (!d || d.__dcRes !== "dc-fetch-page" || d.id !== id) return;
        window.removeEventListener("message", onMsg, false);
        if (done) return; done = true;
        if (d.ok && d.resp) resolve({ data: d.resp.data || [], metadata: d.resp.metadata || [] });
        else reject(new Error(d.error || "page fetch failed"));
      }
      window.addEventListener("message", onMsg, false);
      window.postMessage({ __dcReq: "dc-fetch-page", id: id, queryId: queryId, offset: offset, rowLimit: rowLimit, dataspace: dataspace || "" }, "*");
      setTimeout(function () { if (!done) { done = true; window.removeEventListener("message", onMsg, false); reject(new Error("page fetch timeout")); } }, 60000);
    });
  }

  // Paginated CSV export: runs a query (rowLimit=CHUNK_SIZE), then loops GET /rows until
  // all rows fetched (or cap hit). Builds CSV incrementally so memory stays bounded (we
  // hold the CSV string, not parsed objects). Returns a Blob URL to download.
  // `onProgress(fetched, total)` is called after each chunk for a UI progress bar.
  // Extension-only (pagination requires the sid-cookie background).
  var DC_PAGE_SIZE = 49999;
  var DC_MAX_TOTAL_EXPORT = 500000;   // hard cap (memory + credit safety)
  // Paginated CSV export: runs a query, then pages through all results building CSV
  // incrementally. Extension-only (pagination needs the sid-cookie background).
  // `onProgress(fetchedSoFar, totalRows)` for UI feedback.
  // Resolves { blobUrl, totalRows, columns } — the caller triggers the download.
  function exportPaginatedCsv(sql, dataspace, onProgress) {
    return new Promise(function (resolve, reject) {
      // Bookmarklet: paginate via LIMIT/OFFSET batches through /aura.
      if (!extBridgePresent()) {
        var BM_PAGE = 49999;
        var BM_MAX = DC_MAX_TOTAL_EXPORT;
        var esc2 = function (v) { var s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        var csvOut = []; var cols2 = []; var totalFetched = 0; var bmTotal = 0;

        // Detect if user's SQL already has a LIMIT (respect it as a cap)
        var userLimitMatch = sql.match(/\bLIMIT\s+(\d+)/i);
        var userLimit = userLimitMatch ? parseInt(userLimitMatch[1], 10) : 0;
        var effectiveMax = userLimit > 0 ? Math.min(userLimit, BM_MAX) : BM_MAX;

        // Strip trailing LIMIT/OFFSET to build our own pagination
        var baseSql = sql.replace(/\s+LIMIT\s+\d+\s*/gi, " ").replace(/\s+OFFSET\s+\d+\s*/gi, " ").trim();

        function fetchBatch(offset) {
          var remaining = effectiveMax - offset;
          if (remaining <= 0) {
            var blob = new Blob(csvOut, { type: "text/csv" });
            resolve({ blobUrl: URL.createObjectURL(blob), totalRows: totalFetched, columns: cols2 });
            return;
          }
          var pageSize = Math.min(BM_PAGE, remaining);
          var batchSql = baseSql + " LIMIT " + pageSize + (offset > 0 ? " OFFSET " + offset : "");
          runRawSql(batchSql, dataspace, pageSize).then(function (res) {
            if (!cols2.length && res.columns.length) {
              cols2 = res.columns;
              csvOut.push(cols2.map(esc2).join(",") + "\n");
            }
            res.rows.forEach(function (row) {
              csvOut.push(cols2.map(function (c) { return esc2(row[c]); }).join(",") + "\n");
              totalFetched++;
            });
            if (onProgress) onProgress(totalFetched, bmTotal || (userLimit || totalFetched));
            if (res.rows.length < pageSize || totalFetched >= effectiveMax) {
              var blob = new Blob(csvOut, { type: "text/csv" });
              resolve({ blobUrl: URL.createObjectURL(blob), totalRows: totalFetched, columns: cols2 });
            } else {
              fetchBatch(offset + pageSize);
            }
          }).catch(reject);
        }

        // Run first batch directly — no COUNT(*) (it can fail on complex queries
        // and adds latency). Progress shows fetched so far; total updates as we go.
        fetchBatch(0);
        return;
      }
      var csvParts = []; var cols = []; var fetched = 0; var totalRows = 0;
      var esc = function (v) { var s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      function appendRows(data, metadata) {
        if (!cols.length && metadata && metadata.length) {
          cols = metadata.map(function (m) { return m.name; });
          csvParts.push(cols.map(esc).join(",") + "\n");   // header
        }
        data.forEach(function (row) {
          if (!Array.isArray(row)) return;
          csvParts.push(cols.map(function (c, i) { return esc(row[i]); }).join(",") + "\n");
          fetched++;
        });
      }
      // 1) initial query — the background polls async queries to completion, so
      //    rowCount is the TRUE total (not partial). Paginate until we reach it.
      runDcSqlViaBridge(sql, DC_PAGE_SIZE, dataspace).then(function (first) {
        appendRows(first.data, first.metadata);
        totalRows = first.rowCount || fetched;
        if (onProgress) onProgress(fetched, totalRows);
        if (!first.queryId || fetched >= totalRows || fetched >= DC_MAX_TOTAL_EXPORT) {
          var blob = new Blob(csvParts, { type: "text/csv" });
          resolve({ blobUrl: URL.createObjectURL(blob), totalRows: fetched, columns: cols });
          return;
        }
        // 2) paginate remaining chunks
        var queryId = first.queryId;
        function nextPage() {
          if (fetched >= totalRows || fetched >= DC_MAX_TOTAL_EXPORT) {
            var blob = new Blob(csvParts, { type: "text/csv" });
            resolve({ blobUrl: URL.createObjectURL(blob), totalRows: fetched, columns: cols });
            return;
          }
          fetchPageViaBridge(queryId, fetched, DC_PAGE_SIZE, dataspace).then(function (page) {
            appendRows(page.data, page.metadata);
            if (onProgress) onProgress(fetched, totalRows);
            if (!page.data || page.data.length === 0) {
              var blob = new Blob(csvParts, { type: "text/csv" });
              resolve({ blobUrl: URL.createObjectURL(blob), totalRows: fetched, columns: cols });
            } else { nextPage(); }
          }).catch(reject);
        }
        nextPage();
      }).catch(reject);
    });
  }

  // Read a Data Transform's full definition via the extension bridge → background
  // (documented GET /ssot/data-transforms/{nameOrId}, sid-cookie auth). Extension-only:
  // the page can't fetch my.salesforce.com (CORS). Resolves the parsed definition JSON.
  function fetchTransformViaBridge(nameOrId) {
    return new Promise(function (resolve, reject) {
      if (!extBridgePresent()) { reject(new Error("Reading a transform needs the browser extension (the page can't reach the API directly).")); return; }
      var id = "dct-" + (_dcBridgeSeq = (_dcBridgeSeq || 0) + 1);
      var done = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        var d = ev.data;
        if (!d || d.__dcRes !== "dc-transform" || d.id !== id) return;
        window.removeEventListener("message", onMsg, false);
        if (done) return; done = true;
        if (d.ok && d.resp) resolve(d.resp);
        else reject(new Error(d.error || (d.resp && d.resp.error) || "transform read failed"));
      }
      window.addEventListener("message", onMsg, false);
      window.postMessage({ __dcReq: "dc-transform", id: id, nameOrId: nameOrId }, "*");
      setTimeout(function () { if (!done) { done = true; window.removeEventListener("message", onMsg, false); reject(new Error("bridge timeout")); } }, 20000);
    });
  }

  // Read the transform id + devName from the editor URL (standalone Aura app):
  //   .../transformEditor/transformEditor.app?transformId=<id>&definitionDevName=<devName>
  function transformIdsFromUrl() {
    var out = { transformId: "", devName: "" };
    try {
      var qs = (location.href.split("?")[1] || "").replace(/#.*/, "");
      qs.split("&").forEach(function (kv) {
        var i = kv.indexOf("="); if (i < 0) return;
        var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
        if (/transformId/i.test(k)) out.transformId = v;
        if (/definitionDevName|devName/i.test(k)) out.devName = v;
      });
    } catch (e) {}
    return out;
  }
  function isTransformPage() { var t = transformIdsFromUrl(); return !!(t.transformId || t.devName); }

  // Detect the Data Cloud QUERY EDITOR page (the SQL workspace tab).
  // URL: /r/DataQueryWorkspace/<18-char-id>/view OR contains queryEditor/queryWorkspace keywords with an ID.
  function isQueryEditorPage() {
    var h = location.href;
    if (/\/r\/DataQueryWorkspace\/[a-zA-Z0-9]{15,18}\//i.test(h)) return true;
    if (/queryEditor|query-editor/i.test(h) && /[a-zA-Z0-9]{15,18}/.test(h)) return true;
    // Component-based fallback: look for the query workspace tag
    var found = false;
    eachElement(document, function (el) {
      if (found) return;
      var t = tagOf(el);
      if (/cdp-query-workspace|query-workspace|queryWorkspace/i.test(t)) found = true;
    });
    return found;
  }

  // Track the last-focused SQL editor element. When the user clicks "Export CSV",
  // focus moves to the button — so we need to remember which editor they were in.
  var _lastSqlEditor = null;
  document.addEventListener("focusin", function (e) {
    var el = e.target;
    if (!el) return;
    var t = tagOf(el);
    if (t === "textarea" && el.value && /select|from/i.test(el.value)) { _lastSqlEditor = el; return; }
    if (el.getAttribute && el.getAttribute("contenteditable") === "true" && el.textContent && /select|from/i.test(el.textContent)) { _lastSqlEditor = el; return; }
  }, true);

  function readQueryEditorSql() {
    var result = { full: "", selected: "", cursorPos: -1 };
    // Use the last-focused editor if available (most reliable for multi-tab)
    var el = _lastSqlEditor;
    if (el) {
      var t = tagOf(el);
      if (t === "textarea" && el.value && el.value.trim().length > 8) {
        result.full = el.value.trim();
        if (el.selectionStart !== el.selectionEnd) result.selected = el.value.substring(el.selectionStart, el.selectionEnd).trim();
        result.cursorPos = el.selectionStart;
        return result;
      }
      if (el.getAttribute && el.getAttribute("contenteditable") === "true" && el.innerText) {
        result.full = el.innerText.trim();
        var sel = window.getSelection();
        if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
          var selText = sel.toString().trim();
          if (selText.length > 0) result.selected = selText;
          var preRange = document.createRange();
          preRange.setStart(el, 0);
          preRange.setEnd(sel.anchorNode, sel.anchorOffset);
          result.cursorPos = preRange.toString().length;
        }
        return result.full ? result : null;
      }
    }
    // Fallback: scan all editors (first match)
    eachElement(document, function (scan) {
      if (result.full) return;
      var st = tagOf(scan);
      if (st === "textarea" && scan.value && scan.value.trim().length > 8 && /select|from/i.test(scan.value)) {
        result.full = scan.value.trim();
        result.cursorPos = scan.selectionStart || 0;
        return;
      }
      if (scan.getAttribute && scan.getAttribute("contenteditable") === "true" && scan.innerText && /select|from/i.test(scan.innerText)) {
        result.full = scan.innerText.trim();
        return;
      }
    });
    return result.full ? result : null;
  }

  // Read the dataspace from the Query Editor page header.
  // The page shows "Data Space" label with the value (e.g. "TDI") nearby.
  // A valid dataspace is short, alphanumeric (may have underscores/hyphens), no spaces.
  function readPageDataSpace() {
    var ds = "";
    var isValidDs = function (s) {
      if (!s || s.length === 0 || s.length >= 30) return false;
      if (!/^[A-Za-z0-9_-]+$/.test(s)) return false;
      if (/^(Sort|Filter|Select|Search|Edit|View|Home|Notes|Files|Data|Space|Workspace|Query|Result|Run|Save|New|Delete|Close|Cancel|Apply|Clear|Add|Remove|Show|Hide|All|None|By|In|On|Or|And|Not|The|Loading|Duration|Rows|Processed|Retrieved|count)$/i.test(s)) return false;
      return true;
    };
    // Strategy 1: find the "Data Space" label element, read sibling/child for the value
    eachElement(document, function (el) {
      if (ds) return;
      var txt = (el.textContent || "").trim();
      if (/^Data\s*Space$/i.test(txt) && el.children.length === 0) {
        // Look at next sibling element
        var next = el.nextElementSibling;
        if (next) {
          var val = next.textContent.trim().split("\n")[0].trim();
          if (isValidDs(val)) { ds = val; return; }
        }
        // Look at parent's text minus the label
        var parent = el.parentElement;
        if (parent) {
          var parts = parent.textContent.trim().split(/\s+/);
          for (var i = 0; i < parts.length; i++) {
            if (isValidDs(parts[i]) && !/^data$/i.test(parts[i]) && !/^space$/i.test(parts[i])) { ds = parts[i]; return; }
          }
        }
      }
    });
    if (ds) return ds;
    // Strategy 2: look for "Workspace" label followed by the space name
    eachElement(document, function (el) {
      if (ds) return;
      var txt = (el.textContent || "").trim();
      if (/^Workspace$/i.test(txt) && el.children.length === 0) {
        var next = el.nextElementSibling;
        if (next) {
          var val = next.textContent.trim().split("\n")[0].trim();
          if (isValidDs(val)) { ds = val; return; }
        }
      }
    });
    if (ds) return ds;
    // Strategy 3: look for any element whose parent contains "Data Space" or "Workspace"
    // and the element itself is a short valid identifier (common SF header layout)
    eachElement(document, function (el) {
      if (ds) return;
      if (el.children.length > 0) return;
      var txt = (el.textContent || "").trim();
      if (!isValidDs(txt)) return;
      var parent = el.parentElement;
      if (!parent) return;
      var pTxt = parent.textContent || "";
      if (/Data\s*Space|Workspace/i.test(pTxt) && pTxt.indexOf(txt) >= 0) {
        if (!/^(Data|Space|Workspace|Home|Notes|Files)$/i.test(txt)) { ds = txt; return; }
      }
    });
    if (ds) return ds;
    // Strategy 4: URL may contain dataspace param
    try {
      var urlParams = new URLSearchParams(location.search);
      var urlDs = urlParams.get("dataspace") || urlParams.get("dataSpace") || urlParams.get("ds") || "";
      if (isValidDs(urlDs)) ds = urlDs;
    } catch (e) {}
    return ds;
  }

  // Given the full SQL text and cursor position, extract the single statement at cursor.
  // Splits on ";" AND on blank lines (two+ consecutive newlines where the next non-blank
  // line starts with a SQL keyword like SELECT/INSERT/UPDATE/DELETE/WITH/CREATE).
  // Ignores separators inside string literals, -- comments, and /* */ blocks.
  function statementAtCursor(fullSql, cursorPos) {
    if (!fullSql || cursorPos < 0) return fullSql || "";
    // First, find split points: semicolons + blank-line-before-keyword boundaries
    var splits = [];
    var i = 0;
    var len = fullSql.length;
    while (i < len) {
      var ch = fullSql[i];
      if (ch === "'" || ch === '"') {
        var q = ch; i++;
        while (i < len && fullSql[i] !== q) { if (fullSql[i] === "\\") i++; i++; }
        i++;
      } else if (ch === "-" && fullSql[i + 1] === "-") {
        while (i < len && fullSql[i] !== "\n") i++;
      } else if (ch === "/" && fullSql[i + 1] === "*") {
        i += 2;
        while (i < len && !(fullSql[i] === "*" && fullSql[i + 1] === "/")) i++;
        i += 2;
      } else if (ch === ";") {
        splits.push(i);
        i++;
      } else if (ch === "\n") {
        // Check for blank-line boundary: \n followed by optional whitespace/newlines,
        // then a SQL keyword at the start of a line
        var peek = i + 1;
        var sawBlank = false;
        while (peek < len && (fullSql[peek] === "\n" || fullSql[peek] === "\r" || fullSql[peek] === " " || fullSql[peek] === "\t")) {
          if (fullSql[peek] === "\n") sawBlank = true;
          peek++;
        }
        if (sawBlank && peek < len) {
          var rest = fullSql.substring(peek, Math.min(peek + 10, len));
          if (/^(SELECT|INSERT|UPDATE|DELETE|MERGE|CREATE|WITH|VALUES)\b/i.test(rest)) {
            splits.push(peek - 1);
          }
        }
        i++;
      } else {
        i++;
      }
    }
    // Build statement ranges from split points
    var stmts = [];
    var start = 0;
    for (var s = 0; s < splits.length; s++) {
      var text = fullSql.substring(start, splits[s]).trim();
      if (text.length > 0) stmts.push({ text: text, start: start, end: splits[s] });
      start = splits[s] + 1;
      while (start < len && /[\s;]/.test(fullSql[start])) start++;
    }
    if (start < len) {
      var tail = fullSql.substring(start).trim();
      if (tail.length > 0) stmts.push({ text: tail, start: start, end: len });
    }
    if (stmts.length === 0) return fullSql;
    for (var j = 0; j < stmts.length; j++) {
      if (cursorPos >= stmts[j].start && cursorPos <= stmts[j].end) {
        return stmts[j].text;
      }
    }
    return stmts[stmts.length - 1].text;
  }

  // Run RAW user SQL (from the SQL editor / filter) through the documented endpoint
  // (extension) or the /aura action (bookmarklet). Unlike runDcSql we DON'T know the
  // column order in advance, so we key rows by the server's metadata[] names. Resolves
  // { columns:[names in result order], rows:[{name:value}] }.
  function runRawSql(sql, dataSpace, rowLimit) {
    return new Promise(function (resolve, reject) {
      var ds = (dataSpace != null && dataSpace !== "") ? dataSpace : (_auraSniff.dataSpace != null && _auraSniff.dataSpace !== "") ? _auraSniff.dataSpace : "";
      // Fallback: derive from table name prefix or page header
      if (!ds) { ds = (typeof readPageDataSpace === "function") ? readPageDataSpace() : ""; }
      if (!ds) { var fm = sql.match(/\bFROM\s+["]?([A-Za-z0-9_]+)/i); if (fm) { var px = fm[1].match(/^([A-Za-z0-9]{2,6})_/); if (px) ds = px[1]; } }
      var n = Math.max(1, Math.min(DC_MAX_FETCH_ROWS, rowLimit || 2000));
      function mapByMeta(data, metadata) {
        var cols = (metadata || []).map(function (m) { return m && m.name; });
        var rows = (data || []).map(function (arr) {
          if (!Array.isArray(arr)) return null;
          var o = {}; for (var i = 0; i < cols.length; i++) o[cols[i]] = arr[i]; return o;
        }).filter(Boolean);
        return { columns: cols, rows: rows };
      }
      if (extBridgePresent()) {
        runDcSqlViaBridge(sql, n, ds).then(function (res) {
          resolve(mapByMeta(res.data, res.metadata));
        }).catch(reject);
        return;
      }
      // Bookmarklet fallback: /aura QueryWorkspace.queryDCSql (positional dataRows[].row).
      if (!_auraSniff.context || !_auraSniff.token) { reject(new Error("Session not connected — click 'Connect to Data Cloud' or scroll the table to establish a session.")); return; }
      // Build candidate dataspaces to try (most-likely first). "denied authorization" means wrong space.
      var dsCandidates = [ds];
      if (typeof dataSpaceCandidates === "function") {
        var fm2 = sql.match(/\bFROM\s+["]?([A-Za-z0-9_]+)/i);
        var tblName = fm2 ? fm2[1] : "";
        dataSpaceCandidates(tblName).forEach(function (c) { if (dsCandidates.indexOf(c) < 0) dsCandidates.push(c); });
      }
      if (dsCandidates.indexOf("default") < 0) dsCandidates.push("default");
      function tryDs(dsi) {
        var trySpace = dsCandidates[dsi] || "";
        _auraQid = (_auraQid || 0) + 1;
        var act = { id: "dcraw-" + _auraQid + ";a", descriptor: "serviceComponent://ui.cdp.components.controllers.QueryWorkspaceController/ACTION$queryDCSql", callingDescriptor: "UNKNOWN", params: { sql: sql, rowLimit: n, dataspace: trySpace } };
        var form = "message=" + encodeURIComponent(JSON.stringify({ actions: [act] })) + "&aura.context=" + _auraSniff.context + "&aura.pageURI=" + (_auraSniff.pageURI || "") + "&aura.token=" + _auraSniff.token;
        fetch("/aura?r=" + _auraQid + "&ui-cdp-components-controllers.QueryWorkspace.queryDCSql=1", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: form, credentials: "include" })
          .then(function (r) { return r.text(); }).then(function (txt) {
            if (/aura:invalidSession|INVALID_SESSION|\/secur\/login/i.test(txt) && txt.indexOf("actions") < 0) { reject(new Error("Your Salesforce session has expired — reload the page and retry.")); return; }
            var j; try { j = JSON.parse(txt); } catch (e) { reject(new Error("SQL response was not JSON.")); return; }
            var a = j && j.actions && j.actions[0];
            if (!a || a.state !== "SUCCESS") {
              var em = ""; try { em = (a.error && a.error[0] && (a.error[0].message || a.error[0].primaryMessage)) || (a && a.state); } catch (e) {}
              // "denied authorization" = wrong dataspace → try next candidate
              if (/denied authorization|not authorized/i.test(em) && dsi + 1 < dsCandidates.length) { tryDs(dsi + 1); return; }
              reject(new Error("SQL query failed: " + (em || "unknown")));
              return;
            }
            // Success — remember this dataspace for future queries
            if (trySpace) _auraSniff.dataSpace = trySpace;
            var rv = a.returnValue || {}; var dr = rv.dataRows || rv.rows || []; var meta = rv.metadata || [];
            var arrData = dr.map(function (d) { return d && d.row ? d.row : d; });
            resolve(mapByMeta(arrData, meta));
          }).catch(function (err) { reject(new Error("SQL request failed: " + err)); });
      }
      tryDs(0);
    });
  }

  // Fire ONE queryDCSql for an exact SELECT column list; resolve rows mapped positionally
  // back to {selectCol: value}. `idKey` (if any) is included in the SELECT and its column
  // renamed to "Id" in the output. Rejects with the SF error verbatim.
  // EXTENSION mode → documented /ssot/query-sql via bridge; else → internal /aura action.
  function runDcSql(objectName, selectCols, ds, rowLimit) {
    return new Promise(function (resolve, reject) {
      var want = rowLimit || 2000;

      // ── DOCUMENTED path (extension): send SQL WITHOUT LIMIT so the server's rowCount
      //    reflects the TRUE total rows in the table. We use the API's rowLimit param to
      //    control page size and stop fetching after `want` rows ourselves. ──
      if (extBridgePresent()) {
        var sqlNoLimit = "SELECT " + selectCols.map(sqlQuoteIdent).join(", ") + " FROM " + objectName;
        runDcSqlViaBridge(sqlNoLimit, want, ds).then(function (res) {
          var allData = res.data || [];
          var totalRows = res.rowCount || allData.length;
          var queryId = res.queryId || "";

          function mapRows(data) {
            var mapped = data.map(function (arr) {
              if (!Array.isArray(arr)) return null;
              var obj = {};
              for (var i = 0; i < selectCols.length; i++) obj[selectCols[i]] = arr[i];
              return obj;
            }).filter(Boolean);
            mapped.__serverRowCount = totalRows;
            mapped.__queryId = queryId;
            return mapped;
          }

          // Done if: no pagination possible, already got all server rows, or hit our limit
          if (!queryId || allData.length >= totalRows || allData.length >= want) {
            resolve(mapRows(allData));
            return;
          }
          // Paginate remaining rows until empty page or limits reached
          function fetchMore() {
            if (allData.length >= want || allData.length >= totalRows) {
              resolve(mapRows(allData));
              return;
            }
            fetchPageViaBridge(queryId, allData.length, Math.min(DC_PAGE_SIZE, want - allData.length), ds).then(function (page) {
              var pageData = page.data || [];
              if (pageData.length === 0) { resolve(mapRows(allData)); return; }
              allData = allData.concat(pageData);
              fetchMore();
            }).catch(function () { resolve(mapRows(allData)); });
          }
          fetchMore();
        }).catch(reject);
        return;
      }

      // ── FALLBACK path (bookmarklet): internal /aura QueryWorkspace.queryDCSql ──
      // Paginate via LIMIT/OFFSET batches. First run COUNT(*) to get true total,
      // then fetch data rows in batches up to `bmWant`.
      var BM_BATCH = 49999;
      var bmWant = rowLimit || 2000;
      var allRows = [];
      var baseSql = "SELECT " + selectCols.map(sqlQuoteIdent).join(", ") + " FROM " + objectName;
      var bmServerTotal = 0;

      function bmAuraQuery(sql2, rl, cb) {
        _auraQid = (_auraQid || 0) + 1;
        var act = {
          id: "dcsql-" + _auraQid + ";a",
          descriptor: "serviceComponent://ui.cdp.components.controllers.QueryWorkspaceController/ACTION$queryDCSql",
          callingDescriptor: "UNKNOWN",
          params: { sql: sql2, rowLimit: rl, dataspace: ds }
        };
        var form = "message=" + encodeURIComponent(JSON.stringify({ actions: [act] })) +
          "&aura.context=" + _auraSniff.context +
          "&aura.pageURI=" + (_auraSniff.pageURI || "") +
          "&aura.token=" + _auraSniff.token;
        fetch("/aura?r=" + _auraQid + "&ui-cdp-components-controllers.QueryWorkspace.queryDCSql=1", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: form, credentials: "include"
        }).then(function (r) { return r.text(); }).then(function (txt) {
          var json; try { json = JSON.parse(txt); } catch (e) { cb(new Error("SQL response was not JSON."), null); return; }
          var a = json && json.actions && json.actions[0];
          if (!a || a.state !== "SUCCESS") {
            var em = ""; try { em = (a.error && a.error[0] && (a.error[0].message || a.error[0].primaryMessage)) || (a && a.state); } catch (e) {}
            cb(new Error(em || "query failed"), null); return;
          }
          cb(null, a.returnValue || {});
        }).catch(function (err) { cb(new Error("SQL request failed: " + err), null); });
      }

      function fetchBmBatch(offset) {
        var batchSql = baseSql + " LIMIT " + Math.min(BM_BATCH, bmWant - offset) + (offset > 0 ? " OFFSET " + offset : "");
        bmAuraQuery(batchSql, Math.min(BM_BATCH, bmWant - offset), function (err, rv) {
          if (err) { reject(err); return; }
          var dataRows = rv.dataRows || rv.rows || [];
          var batchRows = dataRows.map(function (dr) {
            var arr = dr && dr.row ? dr.row : dr;
            if (!Array.isArray(arr)) return null;
            var obj = {};
            for (var i = 0; i < selectCols.length; i++) obj[selectCols[i]] = arr[i];
            return obj;
          }).filter(Boolean);
          allRows = allRows.concat(batchRows);
          if (batchRows.length < Math.min(BM_BATCH, bmWant - offset) || allRows.length >= bmWant) {
            allRows.__serverRowCount = bmServerTotal || allRows.length;
            resolve(allRows);
          } else {
            fetchBmBatch(allRows.length);
          }
        });
      }

      // Get true row count first, then fetch data
      var countSql = "SELECT COUNT(*) FROM " + objectName;
      bmAuraQuery(countSql, 1, function (err, rv) {
        if (!err && rv) {
          var dr = rv.dataRows || rv.rows || [];
          if (dr.length > 0) {
            var row = dr[0] && dr[0].row ? dr[0].row : dr[0];
            if (Array.isArray(row) && row.length > 0) bmServerTotal = parseInt(row[0], 10) || 0;
          }
        }
        fetchBmBatch(0);
      });
    });
  }
  // The Data Explorer's objectName PREPENDS the data-space name, e.g. data space "TDI" +
  // table "TDI_GI_Individual_Additional__dlm" → "TDI_TDI_GI_Individual_Additional__dlm".
  // The CdpDataView query accepts that (space is implicit) but the SQL engine wants the
  // REAL table name + the data space passed separately. So we try the name as-is, then
  // with a leading "<dataspace>_" stripped. Evidence-driven (matches the doubled prefix).
  function tableNameCandidates(objectName, ds) {
    var out = [objectName], seen = {}; seen[objectName] = 1;
    var add = function (name) { if (name && !seen[name]) { seen[name] = 1; out.push(name); } };
    // 1) If we know the data space, strip a leading "<ds>_" (the documented doubling).
    if (ds && ds !== "default") {
      var pre = ds + "_";
      if (objectName.indexOf(pre) === 0) add(objectName.slice(pre.length));
    }
    // 2) dataSpace is often NOT captured (sniffer may miss it), so ALSO detect the
    //    doubled prefix straight from the name: "<TOK>_<TOK>_rest" → strip one "<TOK>_".
    //    e.g. "TDI_TDI_GI_Individual_Additional__dlm" → "TDI_GI_Individual_Additional__dlm".
    var m = objectName.match(/^([A-Za-z0-9]+)_(\1_.*)$/);
    if (m) add(m[2]);
    // 3) Generic fallback: strip the FIRST underscore-delimited token (the space
    //    prefix) once, in case the real table simply carries a space prefix.
    var us = objectName.indexOf("_");
    if (us > 0) add(objectName.slice(us + 1));
    return out;
  }
  function querySqlAllColumns(objectName, columns, dataSpace, rowLimit) {
    return new Promise(function (resolve, reject) {
      // Extension mode auths via the sid cookie in the background (no sniffed creds
      // needed). Bookmarklet mode needs the sniffed /aura creds for the fallback.
      if (!extBridgePresent() && (!_auraSniff.context || !_auraSniff.token)) {
        reject(new Error("Session not connected — click 'Connect to Data Cloud' or scroll the table to establish a session.")); return;
      }
      // De-dupe the user's (already-valid) selected columns, preserving order.
      // NOTE: we no longer append an Id column — the table doesn't show it, and many
      // objects (DLO/DMO/CI) have no "Id" field (that caused "unknown column" retries).
      var base = [], seen = {};
      columns.forEach(function (c) { if (c && !seen[c]) { seen[c] = 1; base.push(c); } });

      // Build (table, dataspace) combos to try. Probe 9 PROVED the winner is the FULL
      // object name (e.g. "TDI_TDI_GI_..._dlm") + the REAL data space (e.g. "TDI").
      // So try that FIRST, then variants only as fallbacks. The wrong data space — not
      // the name — is the usual "table does not exist" cause.
      // Data space: use ALL authoritative candidates (captured per-object spaces, then
      // "", "default") — never derived from the name. If the caller passed one, try it first.
      var spaces = [];
      var addSp = function (s) { if (s != null && spaces.indexOf(s) < 0) spaces.push(s); };
      if (dataSpace != null) addSp(dataSpace);
      dataSpaceCandidates(objectName).forEach(addSp);
      if (!spaces.length) spaces.push("");
      // Table name: use the object name AS-IS first (what the page uses), then the
      // prefix-stripped variants only as fallbacks (some orgs differ).
      var names = tableNameCandidates(objectName, resolveDataSpace(objectName) || "");
      // combos: for each data space, try each table name (as-is name first).
      var combos = [];
      spaces.forEach(function (sp) { names.forEach(function (nm) { combos.push({ tbl: nm, ds: sp }); }); });

      var _firstErr = null;   // remember the FIRST combo's error (the most meaningful)
      function tryCombo(ci) {
        var c = combos[ci];
        runDcSql(c.tbl, base.slice(), c.ds, rowLimit).then(function (rows) {
          resolve(rows);
        }).catch(function (err) {
          var msg = String(err && err.message || err);
          if (ci === 0 && !_firstErr) _firstErr = "[tried table=\"" + c.tbl + "\" dataspace=" + JSON.stringify(c.ds) + "] " + msg;
          // Wrong table OR wrong data space (incl. "denied authorization", which means
          // the object isn't in that space / no access there) → try the next combo.
          if (/does not exist|not found|42P01|INVALID_ARGUMENT|invalid|denied authorization|not authorized|no access/i.test(msg) && ci + 1 < combos.length) { tryCombo(ci + 1); return; }
          // Surface the FIRST combo's error (the proven-good combo) — trailing combos
          // are just fallbacks and their errors are noise.
          reject(new Error("SQL query failed: " + (_firstErr || msg)));
        });
      }
      tryCombo(0);
    });
  }

  // Single router for "load column data". Picks the best path automatically:
  //   • EXTENSION mode → documented /ssot/query-sql (via bridge) — supported, ≤49,999 rows,
  //     reliable (sid cookie), no hit-and-trial. Used for ANY row count.
  //   • BOOKMARKLET, ≤100 rows → internal /aura CdpDataView (fast, existing path).
  //   • BOOKMARKLET, >100 rows → internal /aura queryDCSql (existing path).
  // Returns rows as {fieldApi: value} objects. `want` is the desired row count.
  function loadColumnsData(objectName, columns, want) {
    // Single choke point: clamp to the endpoint's hard ceiling so no caller can ask for
    // an abusive/oversized row count (guards the browser + is polite to the server).
    var n = Math.max(1, Math.min(DC_MAX_FETCH_ROWS, want || 100));
    if (extBridgePresent()) return querySqlAllColumns(objectName, columns, null, n);
    if (n > 100) return querySqlAllColumns(objectName, columns, null, n);
    return queryAllColumns(objectName, columns, null, n);
  }

  // ── localStorage helpers ──────────────────────────────────────────────────
  // Key: dc-explore::<objectApiName>
  // Value: { fields: ["api1","api2",...], savedAt: <timestamp> }
  // TTL: 90 days of no use; auto-cleared on object switch if key changes.
  const LS_PREFIX = "dc-explore::";
  const LS_TTL    = 90 * 24 * 60 * 60 * 1000;


  // Extract a stable org identifier from the current Salesforce URL.
  // SF URLs contain the 15/18-char org ID in the subdomain, e.g.:
  //   https://<orgId>.lightning.force.com/...  OR
  //   https://<myDomain>.my.salesforce.com/...
  // We use the full hostname as the org token — unique per org, stable.
  function lsOrgToken() {
    try { return location.hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "_"); } catch(e) { return "default"; }
  }

  function lsKey(objectApiName) { return LS_PREFIX + lsOrgToken() + "::" + objectApiName; }

  // Clear all dc-explore keys for the current org (e.g. on logout detection)
  function lsClearOrg() {
    try {
      const prefix = LS_PREFIX + lsOrgToken() + "::";
      const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
      keys.forEach(k => localStorage.removeItem(k));
    } catch(e) {}
  }

  // Detect logout: SF sets a flag in session storage. If the user session ends
  // the page navigates away; on reload (login page) the hostname changes so
  // lsOrgToken() naturally produces a different prefix. No extra detection needed.

  // Store full column objects (not just names) so restore works even when
  // SF's default columns change between sessions. The fieldName is still used
  // as the identity key when cross-checking against the live column list.
  function lsSave(objectApiName, columns) {
    try {
      const key = lsKey(objectApiName);
      // Always remove existing entry first so stale data can never bleed through
      localStorage.removeItem(key);
      localStorage.setItem(key, JSON.stringify({ cols: columns, savedAt: Date.now() }));
    } catch(e) {}
  }

  function lsLoad(objectApiName) {
    try {
      const raw = localStorage.getItem(lsKey(objectApiName));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj) return null;
      // Expire after TTL
      if (obj.savedAt && Date.now() - obj.savedAt > LS_TTL) { localStorage.removeItem(lsKey(objectApiName)); return null; }
      // Support both old format (fields:[]) and new format (cols:[])
      if (Array.isArray(obj.cols)) return obj.cols;
      if (Array.isArray(obj.fields)) return obj.fields.map(fn => ({ fieldName: fn }));
      return null;
    } catch(e) { return null; }
  }

  function lsClear(objectApiName) {
    try { localStorage.removeItem(lsKey(objectApiName)); } catch(e) {}
  }

  // ── Column application ────────────────────────────────────────────────────
  // recList.columns holds the rendered columns. We replace it with a new array
  // built from allCols (all available columns from the full set).
  // The first column is always the "View" link (type=url, fieldName=recordPageUrl) —
  // keep it in place.

  function findEditColumnsBtn() {
    let btn = null;
    eachElement(document, el => {
      if (!btn && tagOf(el) === "button" &&
          ((el.getAttribute("aria-label") || "") === "Edit Columns" || (el.textContent || "").trim() === "Edit Columns") &&
          isVisible(el)) btn = el;
    });
    return btn;
  }

  // Inject a CSS rule that forces any SF modal/dialog off-screen with !important.
  // This works even when SF reveals a pre-existing hidden dialog (not a DOM insertion),
  // which is why MutationObserver addedNodes alone was insufficient.
  // SF's Edit Columns dialog lives inside lightning-overlay-container's shadow DOM.
  // Probe confirmed: setting visibility:hidden on that light-DOM element hides the whole
  // dialog. CSS rules and MutationObserver cannot cross the shadow boundary, so this is
  // the only reliable approach.
  function sfOverlay() { return document.querySelector("lightning-overlay-container"); }

  // Returns true when the Object type dropdown shows "Calculated Insights".
  // For that object type, manipulating SF's Edit Columns panel breaks the insight
  // loading pipeline — we must only use applyColumnsDirect (headers only).
  function isCalculatedInsights() {
    let found = false;
    eachElement(document, el => {
      if (found) return;
      const t = tagOf(el);
      if (t === "lightning-combobox" || t === "lightning-base-combobox" || t === "select") {
        const txt = (el.textContent || "").toLowerCase();
        if (txt.includes("calculated insight")) found = true;
      }
      // Also check combobox button/input values
      if (!found && (t === "button" || t === "input") && el.value) {
        if ((el.value || "").toLowerCase().includes("calculated insight")) found = true;
      }
      // Check aria labels on list options
      if (!found && el.getAttribute) {
        const aria = (el.getAttribute("aria-label") || el.getAttribute("aria-selected") === "true" ? el.textContent : "") || "";
        if (aria.toLowerCase().includes("calculated insight")) found = true;
      }
    });
    return found;
  }

  // Hide the SF overlay so the Edit Columns dialog is completely invisible.
  // opacity:0 + left:-9999px is the only approach that works — visibility:hidden
  // is overridden by shadow-DOM child styles; CSS rules can't cross the shadow boundary.
  function hideOverlay(ov) {
    if (!ov) return;
    ov.style.cssText = "opacity:0!important;pointer-events:none!important;position:fixed!important;left:-99999px!important;";
  }
  function showOverlay(ov) {
    if (!ov) return;
    ov.style.cssText = "";
  }

  // FLASH FIX (wider approach): the inline hideOverlay above only runs AFTER we click
  // and poll — leaving a visible frame where SF's dialog flashes on screen. Instead,
  // pre-install a document stylesheet rule that hides lightning-overlay-container from
  // the moment it renders (it's a light-DOM element, so a document rule applies to it
  // with no reactive gap). Call hideOverlayCss() BEFORE clicking Edit Columns and
  // showOverlayCss() once we're done. This removes the flash entirely.
  var _ovStyleEl = null;
  function hideOverlayCss() {
    if (_ovStyleEl) return;
    try {
      _ovStyleEl = document.createElement("style");
      _ovStyleEl.id = "dc-hide-overlay";
      // Push the overlay OFF-SCREEN + transparent — but DO NOT zero its width/height.
      // Zeroing dimensions collapses the dialog so its dual-listbox never lays out /
      // renders options, which broke the invisible dialog-drive (no query fired →
      // "Couldn't reach the query service"). This matches the proven inline hideOverlay:
      // the dialog stays fully laid out (drivable), just invisible and off-screen.
      // Scope to ONLY the overlay container — broad selectors like .slds-modal could
      // displace legitimate page modals. Off-screen + transparent, full size preserved.
      _ovStyleEl.textContent =
        "lightning-overlay-container{" +
        "opacity:0!important;pointer-events:none!important;position:fixed!important;" +
        "left:-99999px!important;top:0!important;}";
      (document.head || document.documentElement).appendChild(_ovStyleEl);
    } catch (e) {}
  }
  function showOverlayCss() {
    if (_ovStyleEl) { try { _ovStyleEl.remove(); } catch (e) {} _ovStyleEl = null; }
  }

  // Search inside the overlay's shadow root for a button with exact trimmed text.
  // Must use ov.shadowRoot — querySelectorAll on ov itself never crosses the shadow boundary.
  function findBtnInOverlay(ov, exactText) {
    if (!ov || !ov.shadowRoot) return null;
    let found = null;
    eachElement(ov.shadowRoot, el => {
      if (found) return;
      if (tagOf(el) === "button" && (el.textContent || "").trim() === exactText) found = el;
    });
    return found;
  }

  function applyColumnViaSF(fieldNames, statusCb) {
    // Calculated Insights objects break when we touch SF's Edit Columns panel —
    // the insight pipeline errors with "Cannot load the created insight".
    // Use direct column write only for those.
    if (isCalculatedInsights()) {
      const rl = findRecordListEl();
      if (rl) applyColumnsDirect(rl, fieldNames);
      statusCb("Applied");
      return;
    }
    const editBtn = findEditColumnsBtn();
    if (!editBtn) { statusCb(""); return; }
    statusCb("Applying…");
    hideOverlayCss();   // pre-emptively hide the dialog so it never flashes

    const patchWidths = () => {
      try {
        const rl = findRecordListEl();
        if (rl && rl.columns) {
          rl.columns = rl.columns.map(c => {
            const col = Object.assign({}, c);
            col.wrapText = false;
            col.initialWidth = 200;
            return col;
          });
        }
      } catch(e) {}
      fixDatatableOverflow();
    };

    // Click first — overlay is created dynamically on first open
    try { editBtn.click(); } catch(e) {}

    // Wait for lightning-dual-listbox to appear (not just the overlay element —
    // the overlay persists in DOM between openings, so we must wait for the dlb
    // content itself to be freshly rendered before hiding and interacting).
    let attempts = 0;
    const waitDlb = () => {
      const ov = sfOverlay();
      let dlb = null;
      if (ov && ov.shadowRoot) eachElement(ov.shadowRoot, el => { if (!dlb && tagOf(el) === "lightning-dual-listbox") dlb = el; });

      if (!dlb) {
        // Hide overlay as soon as it appears, even before dlb is rendered
        if (ov) hideOverlay(ov);
        if (attempts++ < 80) { setTimeout(waitDlb, 30); return; }
        if (ov) showOverlay(ov);
        showOverlayCss();
        statusCb(""); return;
      }

      // dlb is rendered — hide overlay (idempotent) and interact
      hideOverlay(ov);

      // Remove SF's max-selection limit before setting value (default is often 10)
      try { if (!dlb.max || dlb.max < fieldNames.length) dlb.max = fieldNames.length; } catch(e) {}
      try { dlb.value = fieldNames.slice(); } catch(e) {}
      try { dlb.dispatchEvent(new CustomEvent("change", { detail: { value: fieldNames.slice() }, bubbles: true, composed: true })); } catch(e) {}

      // Small settle delay so dlb registers the value before Done is clicked
      setTimeout(() => {
        const ov2 = sfOverlay();
        const saveBtn = findBtnInOverlay(ov2, "Done");
        if (!saveBtn) {
          const cancelBtn = findBtnInOverlay(ov2, "Cancel");
          if (cancelBtn) try { cancelBtn.click(); } catch(e) {}
          if (ov2) showOverlay(ov2);
          showOverlayCss();
          statusCb(""); return;
        }
        try { saveBtn.click(); } catch(e) {}

        // Poll until dlb disappears (SF closed the dialog after Done)
        let closeAttempts = 0;
        const waitClose = () => {
          closeAttempts++;
          const ov3 = sfOverlay();
          let open = false;
          if (ov3 && ov3.shadowRoot) eachElement(ov3.shadowRoot, el => { if (!open && tagOf(el) === "lightning-dual-listbox") open = true; });
          if (!open || closeAttempts > 50) {
            if (ov3) showOverlay(ov3);
            showOverlayCss();
            patchWidths();
            setTimeout(patchWidths, 800);
            setTimeout(patchWidths, 2500);
            statusCb("Applied");
          } else {
            setTimeout(waitClose, 200);
          }
        };
        setTimeout(waitClose, 200);
      }, 80);
    };
    waitDlb();
  }

  // Fix cell overflow on every shadow root inside the datatable tree.
  // SF's datatable is deeply nested shadow DOM — styles don't inherit across boundaries.
  // Strategy: (1) inject a <style> into every shadow root we find, and
  //           (2) stamp max-width/overflow directly on every <td> element.
  // A MutationObserver re-runs when SF adds new rows.
  let _dtObserver = null;
  function fixDatatableOverflow() {
    const CSS =
      "td,th{overflow:hidden!important;max-width:200px!important;}" +
      ".slds-truncate,.slds-cell-wrap,span,a{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;max-width:200px!important;display:block!important;}";

    const injectStyle = (sr) => {
      if (!sr || sr.querySelector("style[data-dc-ov]")) return;
      const s = document.createElement("style");
      s.setAttribute("data-dc-ov", "1");
      s.textContent = CSS;
      sr.insertBefore(s, sr.firstChild);
    };

    const fixAll = () => {
      try {
        // Walk each lightning-datatable ONCE, handling both style injection and td
        // clamping in a single pass (was three separate walks → 3× the work).
        eachElement(document, el => {
          if (tagOf(el) !== "lightning-datatable") return;
          injectStyle(el.shadowRoot);
          eachElement(el, inner => {
            if (inner.shadowRoot) injectStyle(inner.shadowRoot);
            var t = tagOf(inner);
            if (t === "td" || t === "th") {
              // stamp so we never re-touch a cell we've already clamped (avoids
              // re-processing the same nodes on every scroll mutation).
              if (inner.__dcClamped) return;
              inner.__dcClamped = 1;
              inner.style.overflow = "hidden";
              inner.style.maxWidth = "200px";
            }
          });
        });
      } catch(e) {}
    };

    fixAll();

    // Watch for row additions and re-apply (SF renders rows lazily) — but DEBOUNCE:
    // scrolling a datatable fires MANY childList mutations; without debouncing, fixAll
    // (a full shadow-DOM walk) would run on each one → jank. Coalesce bursts into one
    // run ~150ms after activity settles.
    if (!_dtObserver) {
      var _dtDebounce = null;
      var schedule = function () {
        if (_dtDebounce) return;
        _dtDebounce = setTimeout(function () { _dtDebounce = null; fixAll(); }, 150);
      };
      _dtObserver = new MutationObserver(schedule);
      try {
        eachElement(document, el => {
          if (tagOf(el) === "lightning-datatable" && el.shadowRoot) {
            _dtObserver.observe(el.shadowRoot, { childList: true, subtree: true });
          }
        });
      } catch(e) {}
    }
  }

  // Direct column write — used for restore-on-load where we can't open a panel.
  function applyColumnsDirect(recList, fieldNames) {
    try {
      const objN = recList.objectName || "";
      const pool = (objN && exploreCache(objN).allColumns) || recList.columns || [];
      const viewCol = (recList.columns || []).find(c => c.fieldName === "recordPageUrl")
                   || pool.find(c => c.fieldName === "recordPageUrl");
      const selected = fieldNames.map(fn => {
        const found = pool.find(c => c.fieldName === fn);
        const col = found ? Object.assign({}, found) : { fieldName: fn, label: fn, type: "formattedText" };
        col.wrapText = false;
        col.initialWidth = 200;
        return col;
      }).filter(c => c.fieldName !== "recordPageUrl");
      recList.columns = viewCol ? [viewCol, ...selected] : selected;
      try { recList.dispatchEvent(new CustomEvent("columnschange", { bubbles: false })); } catch(e) {}
      fixDatatableOverflow();
    } catch(e) {}
  }

  // Keep applyColumns as alias for direct write (used in restore/export paths)
  function applyColumns(recList, fieldNames) { applyColumnsDirect(recList, fieldNames); }

  function getCurrentFields(recList) {
    return (recList.columns || [])
      .filter(c => c.fieldName && c.fieldName !== "recordPageUrl")
      .map(c => c.fieldName);
  }

  // Count options inside the SOURCE listbox specifically (aria-label contains "source-list").
  // The source listbox = the "available" (unselected) fields — always has more than the selected list.
  function countSourceOptions() {
    let count = 0;
    eachElement(document, el => {
      if (!el.getAttribute) return;
      if (el.getAttribute("role") !== "listbox") return;
      const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "";
      if (!/source-list/i.test(aria)) return;
      eachElement(el, opt => {
        if (opt.getAttribute && opt.getAttribute("role") === "option" && opt.getAttribute("data-value")) count++;
      });
    });
    return count;
  }

  // Read ALL options from BOTH the source and selected listboxes.
  function readAllListboxOptions() {
    const seen = new Map();
    eachElement(document, el => {
      if (!el.getAttribute) return;
      if (el.getAttribute("role") !== "listbox") return;
      const aria = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "";
      if (!/source-list|selected-list/i.test(aria)) return;
      eachElement(el, opt => {
        if (!opt.getAttribute || opt.getAttribute("role") !== "option") return;
        const dv = opt.getAttribute("data-value");
        if (!dv || seen.has(dv)) return;
        const lbl = (opt.textContent || "").trim().replace(/\s+/g, " ") || dv;
        seen.set(dv, { fieldName: dv, label: lbl, type: "formattedText" });
      });
    });
    return seen;
  }

  // Opens the Edit Columns panel, polls ONLY for the SOURCE listbox (the available-fields
  // side). The selected-list appears first with ~10 items — we ignore that and keep
  // waiting until the source-list has items, which means SF has loaded the full field set.
  function discoverAllColumns(recList, callback) {
    const objN = recList.objectName || "";
    const cached = objN ? exploreCache(objN).allColumns : null;
    if (cached && cached.length > 10) {
      callback(cached); return;
    }
    let editBtn = null;
    eachElement(document, el => {
      if (!editBtn && tagOf(el) === "button" && ((el.getAttribute("aria-label") || "") === "Edit Columns" || (el.textContent || "").trim() === "Edit Columns") && isVisible(el))
        editBtn = el;
    });
    if (!editBtn) { callback(recList.columns || []); return; }

    hideOverlayCss();   // pre-emptively hide so the dialog never flashes during discovery
    // Click first — overlay is created on first open
    try { editBtn.click(); } catch(e) {}

    function closeSfPanel() {
      const ov = sfOverlay();
      const cancelBtn = findBtnInOverlay(ov, "Cancel");
      if (cancelBtn) try { cancelBtn.click(); } catch(e) {}
      if (ov) showOverlay(ov);
      showOverlayCss();
    }

    // Poll for dlb — hide overlay only once dlb is rendered inside it
    // (overlay element persists in DOM between opens; hiding it too early breaks next open)
    let attempts = 0;
    const poll = () => {
      attempts++;
      const ov = sfOverlay();
      if (ov) {
        let dlb = null;
        eachElement(ov.shadowRoot || ov, el => { if (!dlb && tagOf(el) === "lightning-dual-listbox") dlb = el; });
        if (dlb) hideOverlay(ov);
      }
      const srcCount = countSourceOptions();
      if (srcCount > 0 || attempts >= 80) {  // max ~8 s
        const seen = readAllListboxOptions();
        closeSfPanel();
        if (seen.size > 0) {
          const cols = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
          (recList.columns || []).forEach(c => {
            if (c.fieldName && seen.has(c.fieldName)) {
              const entry = seen.get(c.fieldName);
              if (c.label) entry.label = c.label;
              if (c.type)  entry.type  = c.type;
            }
          });
          if (objN) exploreCache(objN).allColumns = cols;
          callback(cols);
        } else {
          callback(recList.columns || []);
        }
      } else {
        setTimeout(poll, 100);
      }
    };
    setTimeout(poll, 100);
  }

  // ── Export visible rows to CSV ────────────────────────────────────────────
  function exportExploreCsv(recList) {
    const cols = (recList.columns || []).filter(c => c.fieldName && c.fieldName !== "recordPageUrl");
    const rows = recList.data || [];
    const esc = v => { const s = v == null ? "" : String(v); return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [cols.map(c => esc(c.label || c.fieldName)).join(",")];
    rows.forEach(row => lines.push(cols.map(c => esc(row[c.fieldName])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (recList.objectName || "data-explore") + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // Download an arbitrary rows[]×columns[] set as CSV (used by the full-table view,
  // so ALL columns export with data — not just SF's 10).
  function downloadRowsCsv(objectName, columns, rows) {
    const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const header = ["Id"].concat(columns);
    const lines = [header.map(esc).join(",")];
    rows.forEach(r => lines.push(header.map(c => esc(r[c])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (objectName || "data-explore") + "-all-columns.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ── "Understand this transform" — plain-language view of a Data Transform ──────
  // Reads the definition (batch node-graph or streaming SQL) and renders sources →
  // steps/joins → output, so you don't have to read raw JSON. Extension-only (the read
  // goes through the cookie bridge). Draggable modal; nothing is written.
  let _xformEl = null;
  function closeTransformView() { if (_xformEl) { _xformEl.remove(); _xformEl = null; } }
  function showTransformSummary(rep) {
    closeTransformView();
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]); }); };
    // The batch graph is at definitions[0].definition (or .definition); streaming has sql.
    var d0 = rep.definition || (rep.definitions && rep.definitions[0]) || {};
    var def = (d0 && d0.definition && (d0.definition.nodes || d0.definition.sql)) ? d0.definition : d0;
    var nodes = def.nodes || {};
    var keys = Object.keys(nodes);
    var isSql = !!(def.sql || def.query || def.dcSql || def.stlSql);

    // Build readable sections from the node graph.
    var sources = [], steps = [];
    keys.forEach(function (k) {
      var n = nodes[k] || {}, p = n.parameters || {};
      var act = (n.action || n.type || "").toLowerCase();
      if (act === "load") {
        var ds = p.dataset || {};
        sources.push({ id: k, obj: ds.name || "(unknown)", objType: ds.type || "", fields: p.fields || [] });
      } else if (act === "join") {
        steps.push({ id: k, kind: "JOIN", detail: (p.joinType || "") + " join  on  " + ([].concat(p.leftKeys || []).join(",")) + "  =  " + ([].concat(p.rightKeys || []).join(",")) + (p.rightQualifier ? "   (right: " + p.rightQualifier + ")" : "") });
      } else if (act) {
        steps.push({ id: k, kind: act.toUpperCase(), detail: JSON.stringify(p).slice(0, 120) });
      }
    });
    var outs = (def.outputDataObjects || []).map(function (o) {
      return { name: o.name || o.label || "(output)", category: o.category || "", fields: (o.fields || []).map(function (f) { return { label: f.label, name: f.name, type: f.type, pk: !!f.isPrimaryKey }; }) };
    });

    var m = document.createElement("div");
    _xformEl = m;
    m.style.cssText = "position:fixed;top:5vh;left:50%;transform:translateX(-50%);width:min(900px,94vw);height:min(86vh,880px);z-index:2147483646;background:#fff;border:1px solid #c9cede;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16325c;";
    var hdr = "<div style='display:flex;align-items:center;gap:10px;padding:11px 16px;border-bottom:1px solid #e0e5ee;background:#f3f6fb;cursor:move' class='dc-xf-hdr'>" +
      "<div style='flex:1'><div style='font-weight:700;font-size:14px'>" + esc(rep.label || rep.name || "Data Transform") + "</div>" +
      "<div style='font-size:11px;color:#5c6b8a;margin-top:1px'>" + esc(rep.type || "") + " &bull; data space: " + esc(rep.dataSpaceName || "—") +
      " &bull; last run: " + esc(rep.lastRunStatus || "—") + (rep.lastRunDate ? " (" + esc(String(rep.lastRunDate).slice(0, 10)) + ")" : "") + "</div></div>" +
      "<button class='dc-xf-copy' style='border:1px solid #c9d0da;background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:600 11px system-ui;color:#1e3a5f'>Copy JSON</button>" +
      "<button class='dc-xf-x' style='border:none;background:none;cursor:pointer;font-size:16px;color:#5c6b8a;padding:2px 8px'>&times;</button></div>";

    var body = "<div style='flex:1;overflow:auto;padding:14px 16px'>";
    if (isSql) {
      body += "<div style='font-weight:700;margin-bottom:6px'>SQL</div><pre style='white-space:pre-wrap;word-break:break-word;background:#f7f9fc;border:1px solid #e0e5ee;border-radius:6px;padding:10px;font:12px/1.5 SF Mono,Consolas,monospace'>" + esc(def.sql || def.query || def.dcSql || def.stlSql) + "</pre>";
    } else {
      // SOURCES
      body += "<div style='font-weight:700;margin:2px 0 6px'>Sources (" + sources.length + ")</div>";
      sources.forEach(function (s) {
        body += "<div style='padding:6px 10px;border:1px solid #e6ebf3;border-radius:6px;margin-bottom:5px'>" +
          "<b>" + esc(s.obj) + "</b> <span style='color:#8a94a6'>" + esc(s.objType) + "</span>" +
          (s.fields.length ? "<div style='font:11px SF Mono,Consolas,monospace;color:#5c6b8a;margin-top:2px'>" + esc(s.fields.join(", ")) + "</div>" : "") + "</div>";
      });
      // STEPS
      body += "<div style='font-weight:700;margin:12px 0 6px'>Steps (" + steps.length + ")</div>";
      steps.forEach(function (st) {
        body += "<div style='padding:5px 10px;border-left:3px solid #0d6efd;background:#f7f9fc;margin-bottom:4px'>" +
          "<b>" + esc(st.kind) + "</b> <span style='color:#5c6b8a'>" + esc(st.detail) + "</span></div>";
      });
      // OUTPUT
      body += "<div style='font-weight:700;margin:12px 0 6px'>Output (" + outs.length + ")</div>";
      outs.forEach(function (o) {
        body += "<div style='padding:6px 10px;border:1px solid #cfe0d3;border-radius:6px;margin-bottom:5px;background:#f4faf5'>" +
          "<b>" + esc(o.name) + "</b> <span style='color:#8a94a6'>" + esc(o.category) + "</span>" +
          (o.fields.length ? "<div style='font:11px SF Mono,Consolas,monospace;color:#5c6b8a;margin-top:2px'>" + o.fields.map(function (f) { return esc(f.name) + (f.pk ? " 🔑" : ""); }).join(", ") + "</div>" : "") + "</div>";
      });
    }
    body += "</div>";
    m.innerHTML = hdr + body;
    document.body.appendChild(m);
    m.querySelector(".dc-xf-x").onclick = closeTransformView;
    m.querySelector(".dc-xf-copy").onclick = function () { try { navigator.clipboard.writeText(JSON.stringify(rep, null, 2)); var b = m.querySelector(".dc-xf-copy"); b.textContent = "Copied!"; setTimeout(function () { b.textContent = "Copy JSON"; }, 1200); } catch (e) {} };
    if (typeof makeDraggable === "function") try { makeDraggable(m, m.querySelector(".dc-xf-hdr")); } catch (e) {}
  }

  // Render the tool's OWN full-width, scrollable results table showing EVERY selected
  // column with real data (from one queryAllColumns call). This is what removes the
  // 10-column ceiling for the user — no SF datatable involved. Draggable + resizable,
  // sticky header + sticky Id column, with a "Download CSV (all columns)" action.
  let allColsTableEl = null;
  function closeAllColumnsTable() { if (allColsTableEl) { allColsTableEl.remove(); allColsTableEl = null; } }
  // Popup showing one cell's FULL value (for long text / JSON / blob fields), with a
  // Copy button and pretty-print for JSON. Salesforce-like "view field value" behavior.
  var _cellViewEl = null;
  function showCellValue(fieldApi, fieldLabel, value) {
    if (_cellViewEl) { _cellViewEl.remove(); _cellViewEl = null; }
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]); }); };
    // pretty-print JSON if it parses (common for blob/graph fields)
    var pretty = value;
    try { var p = JSON.parse(value); if (p && typeof p === "object") pretty = JSON.stringify(p, null, 2); } catch (e) {}
    var m = document.createElement("div");
    _cellViewEl = m;
    m.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(760px,92vw);max-height:80vh;z-index:2147483647;background:#fff;border:1px solid #c9cede;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16325c;";
    m.innerHTML =
      "<div style='display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #e0e5ee;background:#f3f6fb'>" +
        "<div style='flex:1'><div style='font-weight:700;font-size:13px'>" + esc(fieldLabel) + "</div>" +
        "<div style='font:600 10px SF Mono,Consolas,monospace;color:#5c6b8a'>" + esc(fieldApi) + " &bull; " + value.length + " chars</div></div>" +
        "<button class='dc-cv-copy' style='border:1px solid #0d6efd;background:#0d6efd;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:600 11px system-ui'>Copy</button>" +
        "<button class='dc-cv-x' style='border:none;background:none;cursor:pointer;font-size:16px;color:#5c6b8a;padding:2px 8px'>&times;</button>" +
      "</div>" +
      "<pre style='margin:0;padding:12px 14px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px/1.5 SF Mono,Consolas,monospace;color:#1a1a1a'>" + esc(pretty) + "</pre>";
    document.body.appendChild(m);
    m.querySelector(".dc-cv-copy").onclick = function () {
      try { navigator.clipboard.writeText(value); var b = m.querySelector(".dc-cv-copy"); b.textContent = "Copied!"; setTimeout(function () { b.textContent = "Copy"; }, 1200); } catch (e) {}
    };
    var close = function () { if (_cellViewEl) { _cellViewEl.remove(); _cellViewEl = null; } };
    m.querySelector(".dc-cv-x").onclick = close;
    if (typeof makeDraggable === "function") try { makeDraggable(m, m.firstChild); } catch (e) {}
  }

  // Persisted filter state per object so conditions SURVIVE re-renders (Apply re-renders
  // the table; without this the filter bar would reset and the user loses what they typed).
  // Shape: { conds:[{col,op,val}], join:"AND"|"OR", active:bool }.
  var _filterState = {};
  function showTableSpinner(panel, msg) {
    var existing = panel.querySelector(".dc-table-spinner");
    if (existing) { existing.querySelector("span").textContent = msg || "Loading…"; existing.style.display = "flex"; return; }
    var overlay = document.createElement("div");
    overlay.className = "dc-table-spinner";
    overlay.style.cssText = "display:flex;position:absolute;inset:0;background:rgba(255,255,255,.8);z-index:20;align-items:center;justify-content:center;flex-direction:column;gap:10px;border-radius:12px;";
    overlay.innerHTML = "<div style='width:32px;height:32px;border:3px solid #d0d5de;border-top-color:#5b4f9e;border-radius:50%;animation:dc-spin 0.7s linear infinite'></div><span style='font:600 13px -apple-system,sans-serif;color:#1e3a5f;'>" + (msg || "Loading…") + "</span>";
    if (!document.getElementById("dc-spin-style")) { var ss = document.createElement("style"); ss.id = "dc-spin-style"; ss.textContent = "@keyframes dc-spin{to{transform:rotate(360deg)}}"; document.head.appendChild(ss); }
    panel.style.position = "relative";
    panel.appendChild(overlay);
  }
  function hideTableSpinner(panel) {
    var s = panel && panel.querySelector(".dc-table-spinner");
    if (s) s.style.display = "none";
  }
  // Module-level handle to the SQL editor opener (it's defined inside _buildExploreModal,
  // out of scope for the results table). Assigned when the modal builds; used by the
  // results table's "Edit SQL" button to relaunch the editor.
  var _openSoqlEditor = null;
  // `allColumns` (optional) = the FULL selected set, used for CSV export even when the
  // view is filtered to non-empty columns. Defaults to `columns` when not passed.
  function showAllColumnsTable(objectName, columns, rows, wantRows, allColumns) {
    closeAllColumnsTable();
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    // Field label lookup from whatever we discovered (falls back to the api name).
    const meta = {};
    const pool = (exploreCache(objectName).allColumns) || [];
    pool.forEach(c => { if (c && c.fieldName) meta[c.fieldName] = c.label || c.fieldName; });

    const panel = document.createElement("div");
    allColsTableEl = panel;
    panel.id = "dc-allcols-table";
    panel.style.cssText = "position:fixed;top:5vh;left:50%;transform:translateX(-50%);width:min(1400px,96vw);height:min(86vh,900px);z-index:2147483646;background:#fff;border:1px solid #c9cede;border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16325c;";

    // header
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #e0e5ee;background:#f3f6fb;flex-shrink:0;cursor:move;";
    const titleWrap = document.createElement("div");
    titleWrap.style.cssText = "flex:1;user-select:text;cursor:text;";
    var serverTotal = rows.__serverRowCount || 0;
    var rowsSubInfo = "";
    if (serverTotal > rows.length) {
      rowsSubInfo = "<b>" + rows.length.toLocaleString() + "</b> rows loaded &times; " + columns.length + " cols &bull; <span style='color:#7c3aed;font-weight:700'>Total records: " + serverTotal.toLocaleString() + "</span> &mdash; click <b>Export All</b> to download full CSV, or change Rows &amp; Reload";
    } else if (rows.length > DC_MAX_RENDER_ROWS) {
      rowsSubInfo = "<b>" + rows.length.toLocaleString() + "</b> rows loaded &times; " + columns.length + " cols &bull; <span style='color:#d97706'>Table shows first " + DC_MAX_RENDER_ROWS.toLocaleString() + " for speed &mdash; Download CSV has all " + rows.length.toLocaleString() + "</span>";
    } else {
      rowsSubInfo = "<b>" + rows.length.toLocaleString() + "</b> rows &times; " + columns.length + " cols &bull; <span style='color:#059669'>all loaded</span> &mdash; click <b>Count</b> to check total records in object";
    }
    titleWrap.innerHTML = "<div style='font-weight:700;font-size:13px'>" + columns.length + " columns &mdash; " + esc(objectName) + "</div>" +
      "<div class='dc-ac-sub' style='font-size:11px;color:#5c6b8a;margin-top:1px'>" + rowsSubInfo + "</div>";
    hdr.appendChild(titleWrap);

    // Rows control — request more than the default page (e.g. 2000). We can only honor
    // ≤100 uses the fast CdpDataView query; >100 switches to the Query Editor's SQL
    // action (queryDCSql), which honors rowLimit. Both are same-origin /aura — no CORS.
    const rowsWrap = document.createElement("div");
    rowsWrap.style.cssText = "display:flex;align-items:center;gap:5px;font-size:11px;color:#5c6b8a;";
    rowsWrap.innerHTML = "<span>Rows:</span>";
    const rowsInput = document.createElement("input");
    rowsInput.type = "number"; rowsInput.min = "1"; rowsInput.max = String(DC_MAX_FETCH_ROWS);
    rowsInput.value = String(rows.length || 100);
    rowsInput.style.cssText = "width:78px;border:1px solid #c9d0da;border-radius:5px;padding:4px 6px;font:12px -apple-system,sans-serif;color:#16325c;";
    rowsInput.title = "Enter how many rows to load into the table view (max " + DC_MAX_FETCH_ROWS.toLocaleString() + "). Use Count to check total first.";
    const reloadBtn = document.createElement("button");
    reloadBtn.textContent = "Reload";
    reloadBtn.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:5px;padding:5px 10px;cursor:pointer;font:600 11px -apple-system,sans-serif;color:#1e3a5f;";
    reloadBtn.onclick = () => {
      var raw = parseInt(rowsInput.value, 10) || 100;
      var want = Math.max(1, Math.min(DC_MAX_FETCH_ROWS, raw));
      if (raw > DC_MAX_FETCH_ROWS) rowsInput.value = String(want);
      reloadBtn.disabled = true; reloadBtn.textContent = "Loading…";
      showTableSpinner(panel, "Loading " + want + " rows…");
      const sub = panel.querySelector(".dc-ac-sub");
      if (sub) sub.textContent = "Loading " + want + " rows…" + (want > DC_WARN_ROWS ? " (large query — this can take a while)" : "");
      const fail = (err) => {
        reloadBtn.disabled = false; reloadBtn.textContent = "Reload";
        hideTableSpinner(panel);
        const s = panel.querySelector(".dc-ac-sub"); if (s) s.textContent = String(err && err.message || err);
      };
      ensureQueryContext(function (ready) {
        if (!ready) {
          reloadBtn.disabled = false; reloadBtn.textContent = "Reload";
          hideTableSpinner(panel);
          var sub2 = panel.querySelector(".dc-ac-sub");
          if (sub2) { sub2.textContent = ""; var cw = document.createElement("div"); sub2.appendChild(cw); renderConnectButton(cw, function () { reloadBtn.click(); }); }
          else { fail(new Error("Session not ready — try scrolling the table, then retry.")); }
          return;
        }
        loadColumnsData(objectName, columns, want).then((newRows) => {
          showAllColumnsTable(objectName, columns, newRows, want);
        }).catch(fail);
      });
    };

    // "Count" button — runs COUNT(*) to show the true total records in the DMO/DLO
    const countBtn = document.createElement("button");
    countBtn.textContent = "Count";
    countBtn.style.cssText = "border:1px solid #7c3aed;background:#7c3aed;color:#fff;border-radius:5px;padding:5px 10px;cursor:pointer;font:600 11px -apple-system,sans-serif;";
    countBtn.title = "Query the total number of records in this object (runs SELECT COUNT(*))";
    countBtn.onclick = () => {
      countBtn.disabled = true; countBtn.textContent = "Counting…";
      var ds = (typeof resolveDataSpace === "function") ? resolveDataSpace(objectName) : "";
      var cSql = "SELECT COUNT(*) FROM " + objectName;
      ensureQueryContext(function (ready) {
        if (!ready) { countBtn.disabled = false; countBtn.textContent = "Count"; return; }
        runRawSql(cSql, ds, 1).then(function (res) {
          var cnt = 0;
          if (res.rows.length > 0) {
            var firstCol = res.columns[0] || "count";
            cnt = parseInt(res.rows[0][firstCol], 10) || 0;
          }
          countBtn.disabled = false;
          countBtn.textContent = "Total: " + cnt.toLocaleString();
          countBtn.style.background = "#059669"; countBtn.style.borderColor = "#059669";
          // Update the subtitle with count info
          var sub = panel.querySelector(".dc-ac-sub");
          if (sub) {
            var info = "<b>" + rows.length.toLocaleString() + "</b> rows loaded &times; " + columns.length + " cols";
            info += " &bull; <span style='color:#7c3aed;font-weight:700;'>Total records in object: " + cnt.toLocaleString() + "</span>";
            if (cnt > rows.length) info += " &mdash; enter a number above and click Reload, or use <b>Export All</b> to download everything as CSV";
            sub.innerHTML = info;
          }
          // Show Export All button if it was hidden (now we know the total)
          var eab = panel.querySelector("#dc-export-all-btn");
          if (eab && cnt > rows.length) {
            eab.style.display = "";
            eab.textContent = "⬇ Export All (" + cnt.toLocaleString() + " rows)";
            eab.setAttribute("data-total", cnt);
          }
        }).catch(function (err) {
          countBtn.disabled = false; countBtn.textContent = "Count";
          countBtn.title = "Error: " + (err && err.message || err);
        });
      });
    };

    rowsWrap.appendChild(rowsInput); rowsWrap.appendChild(reloadBtn); rowsWrap.appendChild(countBtn);
    hdr.appendChild(rowsWrap);

    // "Hide empty columns" — data is often sparse (many all-null columns), so this
    // trims the table to only columns that have data in the loaded rows. Pure VIEW
    // filter: CSV still exports the FULL set. Empties are computed from the FULL column
    // set (fullCols) against the fetched rows, so the toggle is stable across re-renders.
    const fullCols = allColumns || columns;
    const emptyCols = {}; fullCols.forEach(fn => { emptyCols[fn] = true; });
    rows.forEach(r => { fullCols.forEach(fn => { var v = r[fn]; if (v !== null && v !== undefined && v !== "") emptyCols[fn] = false; }); });
    const nonEmptyColumns = fullCols.filter(fn => !emptyCols[fn]);
    const emptyCount = fullCols.length - nonEmptyColumns.length;
    const hideWrap = document.createElement("label");
    hideWrap.style.cssText = "display:flex;align-items:center;gap:5px;font-size:11px;color:#5c6b8a;cursor:pointer;white-space:nowrap;";
    const hideCb = document.createElement("input"); hideCb.type = "checkbox";
    hideCb.checked = !!(window.__dcHideEmpty);           // remember choice across re-renders
    hideWrap.appendChild(hideCb);
    hideWrap.appendChild(document.createTextNode("Hide empty (" + emptyCount + ")"));
    hideWrap.title = "Show only columns that have data in the loaded rows. CSV still exports all columns.";
    hideCb.onchange = () => {
      window.__dcHideEmpty = hideCb.checked;
      // re-render with the visible column set; always pass the FULL set for CSV + stable recompute.
      const shown = hideCb.checked ? nonEmptyColumns : fullCols;
      showAllColumnsTable(objectName, shown, rows, wantRows, fullCols);
    };
    if (emptyCount > 0) hdr.appendChild(hideWrap);

    // Relaunch the SQL editor from the results table (the editor closes on a
    // successful Run so it doesn't cover the data — this reopens it to edit/re-run).
    const sqlBtn = document.createElement("button");
    sqlBtn.textContent = "Edit SQL";
    sqlBtn.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:600 11px -apple-system,sans-serif;color:#1e3a5f;white-space:nowrap;";
    sqlBtn.onclick = () => {
      // If a UI filter is active, warn user — editing SQL will reset it
      var activeFilter = _filterState[objectName] && _filterState[objectName].active;
      if (activeFilter) {
        if (!confirm("You have a UI filter active. Opening the SQL editor will reset the filter so they don't conflict.\n\nProceed?")) return;
        _filterState[objectName] = null;
      }
      try { if (typeof _openSoqlEditor === "function") _openSoqlEditor(); } catch (e) {}
    };

    const csvBtn = document.createElement("button");
    csvBtn.textContent = "Download CSV (" + rows.length.toLocaleString() + " rows)";
    csvBtn.style.cssText = "border:1px solid #0d6efd;background:#0d6efd;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:600 11px -apple-system,sans-serif;white-space:nowrap;";
    csvBtn.onclick = () => downloadRowsCsv(objectName, fullCols, rows);

    // "Export All" — fetches ALL rows from the server (up to 500k) via paginated query.
    // Visible when we know total > loaded rows, or after user clicks Count.
    const exportAllBtn = document.createElement("button");
    exportAllBtn.id = "dc-export-all-btn";
    var knownTotal = serverTotal > rows.length ? serverTotal : 0;
    exportAllBtn.textContent = knownTotal ? ("⬇ Export All (" + knownTotal.toLocaleString() + " rows)") : "⬇ Export All";
    exportAllBtn.style.cssText = "border:1px solid #059669;background:#059669;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font:600 11px -apple-system,sans-serif;white-space:nowrap;" + (knownTotal ? "" : "display:none;");
    exportAllBtn.onclick = function () {
      var btnTotal = parseInt(exportAllBtn.getAttribute("data-total"), 10) || knownTotal || 0;
      var confirmMsg = btnTotal
        ? "Are you sure you want to download all " + btnTotal.toLocaleString() + " rows? This may take a while for large datasets."
        : "Are you sure you want to download ALL records from this object? This may take a while.";
      if (!confirm(confirmMsg)) return;
      exportAllBtn.disabled = true;
      exportAllBtn.textContent = "Preparing…";
      var ds = (typeof resolveDataSpace === "function") ? resolveDataSpace(objectName) : "";
      var allCols = fullCols.map(sqlQuoteIdent).join(", ");
      var exportSql = "SELECT " + allCols + " FROM " + objectName;
      ensureQueryContext(function (ready) {
        if (!ready) {
          exportAllBtn.disabled = false;
          exportAllBtn.textContent = "⬇ Export All" + (btnTotal ? " (" + btnTotal.toLocaleString() + " rows)" : "");
          alert("Session not ready — scroll the Data Explorer table first, then retry.");
          return;
        }
        exportPaginatedCsv(exportSql, ds, function (fetched, total) {
          exportAllBtn.textContent = fetched.toLocaleString() + " / " + (total > fetched ? total.toLocaleString() : "?") + " rows…";
        }).then(function (res) {
          exportAllBtn.disabled = false;
          exportAllBtn.textContent = "⬇ Export All" + (btnTotal ? " (" + btnTotal.toLocaleString() + " rows)" : " (" + res.totalRows.toLocaleString() + " rows)");
          if (res.totalRows === 0) { exportAllBtn.textContent = "No data"; return; }
          var fn = objectName.replace(/[^a-zA-Z0-9_]/g, "") + "_ALL_" + new Date().toISOString().slice(0, 10) + ".csv";
          var a = document.createElement("a"); a.href = res.blobUrl; a.download = fn; a.click();
          setTimeout(function () { URL.revokeObjectURL(res.blobUrl); }, 15000);
        }).catch(function (err) {
          exportAllBtn.disabled = false;
          exportAllBtn.textContent = "⬇ Export All" + (btnTotal ? " (" + btnTotal.toLocaleString() + " rows)" : "");
          alert("Export failed: " + (err && err.message || err));
        });
      });
    };

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "&#x2715;";
    closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:16px;color:#5c6b8a;padding:2px 8px;line-height:1;";
    closeBtn.onclick = closeAllColumnsTable;
    hdr.appendChild(sqlBtn); hdr.appendChild(csvBtn); hdr.appendChild(exportAllBtn); hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    // ── Type-aware FILTER row ───────────────────────────────────────────────────
    // Pick a column → the value control adapts to the column's inferred type:
    //   boolean → true/false dropdown; number → operator + number; date → operator +
    //   date; text → operator (=, contains, starts) + text. Builds a WHERE and re-runs
    //   the query server-side via runRawSql. Type is inferred from the loaded values.
    function inferType(fn) {
      var seen = 0;
      for (var i = 0; i < rows.length && seen < 20; i++) {
        var v = rows[i][fn]; if (v === null || v === undefined || v === "") continue; seen++;
        if (typeof v === "boolean") return "bool";
        var s = String(v);
        if (v === "true" || v === "false") return "bool";
        if (/^-?\d+(\.\d+)?$/.test(s)) return "number";
        if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(s)) return "date";
        return "text";
      }
      return "text";
    }
    const fullColsForFilter = allColumns || columns;
    // Build one WHERE fragment from a {colSel, opSel, valCtl} condition row.
    function fragOf(cond) {
      var fn = cond.colSel.value, op = cond.opSel.value, t = inferType(fn);
      var raw = (cond.valCtl && cond.valCtl.value != null) ? String(cond.valCtl.value).trim() : "";
      if (raw === "" && t !== "bool") return null;
      var q = '"' + fn.replace(/"/g, '""') + '"';
      var litStr = "'" + raw.replace(/'/g, "''") + "'";
      if (t === "bool") return q + " = " + (raw === "true" ? "true" : "false");
      if (t === "number") return q + " " + op + " " + raw;
      if (t === "date") return q + " " + op + " '" + raw + "'";
      if (op === "contains") return q + " LIKE '%" + raw.replace(/'/g, "''") + "%'";
      if (op === "starts with") return q + " LIKE '" + raw.replace(/'/g, "''") + "%'";
      if (op === "!=") return q + " != " + litStr;
      return q + " = " + litStr;
    }

    // ── multi-condition filter bar ──────────────────────────────────────────────
    const fbar = document.createElement("div");
    fbar.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:7px 14px;border-bottom:1px solid #e0e5ee;background:#fafbfd;flex-shrink:0;font-size:11px;color:#5c6b8a;";
    const condsWrap = document.createElement("div");
    condsWrap.style.cssText = "display:flex;flex-direction:column;gap:5px;";
    const conditions = [];   // list of {row, colSel, opSel, valCtl}

    // AND/OR joiner between conditions (applies to all — simple & predictable)
    const joinSel = document.createElement("select");
    joinSel.style.cssText = "border:1px solid #c9d0da;border-radius:5px;padding:3px 5px;font:600 11px -apple-system,sans-serif;color:#16325c;";
    ["AND", "OR"].forEach(function (j) { var o = document.createElement("option"); o.value = j; o.textContent = j; joinSel.appendChild(o); });

    function addCondition(preset) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
      // leading joiner label (AND/OR) for rows after the first
      const joinCell = document.createElement("span");
      joinCell.style.cssText = "min-width:38px;text-align:right;font-weight:600;color:#8a94a6;";
      const colSel = document.createElement("select");
      colSel.style.cssText = "border:1px solid #c9d0da;border-radius:5px;padding:4px 6px;font:12px -apple-system,sans-serif;color:#16325c;max-width:220px;";
      fullColsForFilter.forEach(function (fn) { var o = document.createElement("option"); o.value = fn; o.textContent = (meta[fn] || fn); colSel.appendChild(o); });
      if (preset && preset.col) colSel.value = preset.col;   // restore saved column
      const opSel = document.createElement("select");
      opSel.style.cssText = "border:1px solid #c9d0da;border-radius:5px;padding:4px 6px;font:12px -apple-system,sans-serif;color:#16325c;";
      const valWrap = document.createElement("span");
      const cond = { row: row, colSel: colSel, opSel: opSel, valCtl: null };
      function rebuild() {
        const t = inferType(colSel.value);
        opSel.innerHTML = "";
        const ops = t === "bool" ? ["="] :
                    t === "number" ? ["=", "!=", ">", ">=", "<", "<="] :
                    t === "date" ? ["=", ">", ">=", "<", "<="] :
                    ["=", "!=", "contains", "starts with"];
        ops.forEach(function (op) { var o = document.createElement("option"); o.value = op; o.textContent = op; opSel.appendChild(o); });
        if (preset && preset.op && ops.indexOf(preset.op) >= 0) opSel.value = preset.op;
        valWrap.innerHTML = "";
        if (t === "bool") {
          cond.valCtl = document.createElement("select");
          ["true", "false"].forEach(function (b) { var o = document.createElement("option"); o.value = b; o.textContent = b; cond.valCtl.appendChild(o); });
        } else {
          cond.valCtl = document.createElement("input");
          cond.valCtl.type = t === "number" ? "number" : "text";
          cond.valCtl.placeholder = t === "date" ? "YYYY-MM-DD" : "value";
        }
        cond.valCtl.style.cssText = "border:1px solid #c9d0da;border-radius:5px;padding:4px 6px;font:12px -apple-system,sans-serif;color:#16325c;min-width:120px;";
        if (preset && preset.val != null) cond.valCtl.value = preset.val;   // restore saved value
        valWrap.appendChild(cond.valCtl);
      }
      colSel.onchange = rebuild; rebuild();
      // once the preset is consumed for this row, clear it so onchange doesn't re-apply
      var _presetUsed = preset; preset = null;
      const rm = document.createElement("button");
      rm.textContent = "×"; rm.title = "Remove this condition";
      rm.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:5px;padding:2px 8px;cursor:pointer;color:#c0392b;font:700 12px system-ui;";
      rm.onclick = function () {
        var idx = conditions.indexOf(cond);
        if (idx >= 0) conditions.splice(idx, 1);
        row.remove(); relabelJoiners();
      };
      row.appendChild(joinCell); row.appendChild(colSel); row.appendChild(opSel); row.appendChild(valWrap); row.appendChild(rm);
      cond.joinCell = joinCell;
      conditions.push(cond);
      condsWrap.appendChild(row);
      relabelJoiners();
    }
    function relabelJoiners() {
      conditions.forEach(function (c, i) {
        if (i === 0) { c.joinCell.textContent = "Where"; }
        else { c.joinCell.innerHTML = ""; c.joinCell.appendChild(joinSel); }
      });
    }
    // combine all conditions into one WHERE (joined by AND/OR)
    function buildWhere() {
      var frags = conditions.map(fragOf).filter(Boolean);
      if (!frags.length) return null;
      return frags.join(" " + joinSel.value + " ");
    }

    // controls row: + Add filter | Apply | Clear | status
    const ctrlRow = document.createElement("div");
    ctrlRow.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
    const addBtn = document.createElement("button");
    addBtn.textContent = "+ Add condition";
    addBtn.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:5px;padding:4px 10px;cursor:pointer;font:600 11px -apple-system,sans-serif;color:#1e3a5f;";
    addBtn.onclick = function () { addCondition(); };
    const applyF = document.createElement("button");
    applyF.textContent = "Apply filter";
    applyF.style.cssText = "border:1px solid #0d6efd;background:#0d6efd;color:#fff;border-radius:5px;padding:4px 10px;cursor:pointer;font:600 11px -apple-system,sans-serif;";
    const clearF = document.createElement("button");
    clearF.textContent = "Clear";
    clearF.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:5px;padding:4px 10px;cursor:pointer;font:600 11px -apple-system,sans-serif;color:#1e3a5f;";
    const fStatus = document.createElement("span"); fStatus.style.cssText = "color:#8a94a6;";
    // Snapshot the current condition rows into plain data (for persistence across re-render).
    function snapshotConds() {
      return conditions.map(function (c) {
        return { col: c.colSel.value, op: c.opSel.value, val: (c.valCtl && c.valCtl.value != null) ? String(c.valCtl.value) : "" };
      });
    }
    function runFilter(whereClause) {
      const cols = (allColumns || columns);
      const sql = "SELECT " + cols.map(function (c) { return '"' + c.replace(/"/g, '""') + '"'; }).join(", ") +
                  " FROM " + objectName + (whereClause ? " WHERE " + whereClause : "") + " LIMIT " + DC_MAX_FETCH_ROWS;
      applyF.disabled = true; fStatus.textContent = "Filtering…";
      showTableSpinner(panel, "Filtering…");
      // PERSIST the filter so it survives the re-render below (the bug: filter vanished).
      _filterState[objectName] = whereClause ? { conds: snapshotConds(), join: joinSel.value, active: true } : null;
      const ds = (typeof resolveDataSpace === "function") ? resolveDataSpace(objectName) : "";
      ensureQueryContext(function (ready) {
        if (!ready) { applyF.disabled = false; fStatus.textContent = "query service unavailable"; hideTableSpinner(panel); return; }
        runRawSql(sql, ds, DC_MAX_FETCH_ROWS).then(function (res) {
          applyF.disabled = false; fStatus.textContent = "";
          showAllColumnsTable(objectName, cols, res.rows, res.rows.length, cols);
        }).catch(function (err) {
          applyF.disabled = false; fStatus.textContent = String(err && err.message || err);
          hideTableSpinner(panel);
          _filterState[objectName] = null;   // failed filter → don't leave stale state
        });
      });
    }
    applyF.onclick = function () { const w = buildWhere(); if (!w) { fStatus.textContent = "add at least one condition with a value"; return; } runFilter(w); };
    clearF.onclick = function () { _filterState[objectName] = null; runFilter(null); };
    ctrlRow.appendChild(addBtn); ctrlRow.appendChild(applyF); ctrlRow.appendChild(clearF); ctrlRow.appendChild(fStatus);
    fbar.appendChild(condsWrap); fbar.appendChild(ctrlRow);
    // RESTORE persisted conditions (so an applied filter stays visible after re-render).
    const saved = _filterState[objectName];
    if (saved && saved.conds && saved.conds.length) {
      saved.conds.forEach(function (c) { addCondition(c); });
      joinSel.value = saved.join || "AND"; relabelJoiners();
      if (saved.active) fStatus.textContent = "✓ filter active (" + saved.conds.length + " condition" + (saved.conds.length > 1 ? "s" : "") + ")";
    }
    panel.appendChild(fbar);

    // scroll area + table
    const scroll = document.createElement("div");
    scroll.style.cssText = "flex:1;overflow:auto;position:relative;";
    const table = document.createElement("table");
    table.style.cssText = "border-collapse:separate;border-spacing:0;font-size:12px;white-space:nowrap;";
    // header row: one <th> per selected column (no internal Id column — it's the
    // opaque record key and is empty/meaningless for many objects).
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    const thStyle = "position:sticky;top:0;z-index:2;background:#1f3864;color:#fff;font-weight:700;text-align:left;padding:7px 10px;border-right:1px solid #33507f;border-bottom:1px solid #33507f;";
    columns.forEach(fn => {
      const th = document.createElement("th");
      th.title = fn;
      th.innerHTML = esc(meta[fn] || fn) + "<div style='font-weight:400;font-size:9px;color:#b9c6de;font-family:SF Mono,Consolas,monospace'>" + esc(fn) + "</div>";
      th.style.cssText = thStyle + "min-width:120px;max-width:320px;white-space:normal;";
      htr.appendChild(th);
    });
    thead.appendChild(htr); table.appendChild(thead);
    // body — RENDER CAP: only build DOM for the first DC_MAX_RENDER_ROWS rows so a huge
    // result (e.g. 50k) can't freeze the tab. ALL rows stay in `rows` for CSV export.
    const tbody = document.createElement("tbody");
    const fmt = (v) => v == null ? "" : (typeof v === "boolean" ? (v ? "true" : "false") : String(v));
    const renderRows = rows.length > DC_MAX_RENDER_ROWS ? rows.slice(0, DC_MAX_RENDER_ROWS) : rows;
    renderRows.forEach((r, ri) => {
      const tr = document.createElement("tr");
      tr.style.background = ri % 2 ? "#f7f9fc" : "#fff";
      columns.forEach(fn => {
        const td = document.createElement("td");
        const val = fmt(r[fn]);
        td.style.cssText = "position:relative;padding:6px 10px;border-right:1px solid #eef1f6;border-bottom:1px solid #eef1f6;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        const span = document.createElement("span");
        span.textContent = val; span.style.cssText = "user-select:text;";
        td.appendChild(span);
        td.title = val;
        if (val !== "") {
          // Salesforce-like cell affordances: hover shows Copy + View (View opens a
          // modal with the FULL value — essential for long text / JSON / blob fields).
          const tools = document.createElement("span");
          tools.style.cssText = "position:absolute;right:2px;top:2px;display:none;gap:2px;background:rgba(255,255,255,.95);border-radius:4px;padding:1px;";
          const mkT = (label, title, onclick) => {
            const b = document.createElement("button");
            b.textContent = label; b.title = title;
            b.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:3px;font:600 9px system-ui;padding:1px 4px;cursor:pointer;color:#1e3a5f;";
            b.onclick = (e) => { e.stopPropagation(); onclick(); };
            return b;
          };
          tools.appendChild(mkT("Copy", "Copy value", () => {
            try { navigator.clipboard.writeText(val); } catch (e) {}
          }));
          if (val.length > 40) tools.appendChild(mkT("View", "View full value", () => showCellValue(fn, meta[fn] || fn, val)));
          td.appendChild(tools);
          td.onmouseenter = () => { tools.style.display = "flex"; };
          td.onmouseleave = () => { tools.style.display = "none"; };
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    panel.appendChild(scroll);
    document.body.appendChild(panel);
    // Render-cap notice: if we only drew part of a large result, say so clearly and
    // point to CSV for the full set (nothing is lost — all rows are in the export).
    if (rows.length > DC_MAX_RENDER_ROWS) {
      const sub = panel.querySelector(".dc-ac-sub");
      if (sub) sub.innerHTML = "Showing first " + DC_MAX_RENDER_ROWS + " of " + rows.length +
        " rows &times; " + columns.length + " cols &bull; " +
        "<span style='color:#b8860b'>table caps at " + DC_MAX_RENDER_ROWS + " for speed — use “Download CSV” for all " + rows.length + " rows.</span>";
    } else if (wantRows && rows.length < wantRows) {
      // If the user asked for more rows than actually came back, say so honestly — this
      // just means the data set has fewer records than requested (not a silent cap).
      const sub = panel.querySelector(".dc-ac-sub");
      if (sub) sub.innerHTML = rows.length + " rows &times; " + columns.length + " columns &bull; " +
        "<span style='color:#b8860b'>requested " + wantRows + ", but only " + rows.length + " records exist (or the source capped it).</span>";
    }
    if (typeof makeDraggable === "function") try { makeDraggable(panel, hdr); } catch (e) {}
    if (typeof addResizeHandle === "function") try { addResizeHandle(panel, 480, 300); } catch (e) {}
  }

  // ── Build SOQL from current selection ─────────────────────────────────────

  // ── Column picker modal ───────────────────────────────────────────────────
  let exploreModalEl = null;

  function closeExploreModal() {
    if (exploreModalEl) { exploreModalEl.remove(); exploreModalEl = null; }
    const bar = document.getElementById("dc-bar");
    if (bar) bar.style.visibility = "";
    hideBackdrop();
  }

  function openExploreModal() {
    if (exploreModalEl) { closeExploreModal(); return; }
    // Guard first — never hide the bar unless we can actually open the modal
    const recList = findRecordListEl();
    if (!recList) return;
    const bar = document.getElementById("dc-bar");
    if (bar) bar.style.visibility = "hidden";
    const objectName = recList.objectName || "unknown";

    const MODAL_CSS = "position:fixed;top:60px;right:24px;width:420px;max-height:82vh;z-index:2147483645;background:#fff;border:1px solid #d0d5de;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#16325c;overflow:hidden;";

    // Always open immediately with whatever columns we have (current SF columns or cache).
    // If we don't have the full list yet, discover it in background and silently refresh.
    const _cachedCols = exploreCache(objectName).allColumns;
    const initialCols = _cachedCols && _cachedCols.length > 0
      ? _cachedCols
      : (recList.columns || []).filter(c => c.fieldName && c.fieldName !== "recordPageUrl");

    // Capture the columns CURRENTLY shown in the Explorer table RIGHT NOW, while the
    // recList is guaranteed populated. We thread this through so the picker always
    // defaults to "what's on screen" — even after the background field-discovery
    // re-reads a momentarily-empty recList (which previously fell through to select-all).
    const initialSelected = getCurrentFields(recList);

    const modal = document.createElement("div");
    exploreModalEl = modal;
    modal.id = "dc-explore-modal";
    modal.style.cssText = MODAL_CSS;
    document.body.appendChild(modal);
    // No backdrop — user needs to see the SF Data Explorer page behind the modal
    _buildExploreModal(modal, recList, initialCols, objectName, initialSelected);

    if (!(_cachedCols && _cachedCols.length > 0)) {
      // First open — discover full field list in background, then silently rebuild modal content
      discoverAllColumns(recList, (allCols) => {
        const freshRecList = findRecordListEl() || recList;
        // Only update if the same modal is still open
        if (exploreModalEl === modal && modal.isConnected) {
          _buildExploreModal(modal, freshRecList, allCols, objectName, initialSelected);
        }
      });
    }
  }

  function _buildExploreModal(modal, recList, allCols, objectName, initialSelected) {
    modal.innerHTML = ""; // clear any previous build (e.g. background refresh after discoverAllColumns)
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const all = allCols.filter(c => c.fieldName && c.fieldName !== "recordPageUrl");
    // Prefer the columns captured at open time (what's actually in the table); fall back
    // to a fresh read only if that wasn't provided. This stops the picker from defaulting
    // to "select all 59" when a background re-read sees a momentarily-empty recList.
    const currentFields = (initialSelected && initialSelected.length)
      ? initialSelected.slice()
      : getCurrentFields(recList);

    // ── Header ────────────────────────────────────────────────────────────────
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e0e5ee;background:#f3f6fb;border-radius:12px 12px 0 0;flex-shrink:0;cursor:move;user-select:none;";
    hdr.innerHTML = "<div><div style='font-weight:700;font-size:13px'>Column Selector</div><div style='font-size:11px;color:#5c6b8a;margin-top:1px'>" + esc(objectName) + " &bull; " + all.length + " fields available</div></div>";
    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "&#x2715;";
    closeBtn.style.cssText = "border:none;background:none;cursor:pointer;font-size:15px;color:#5c6b8a;padding:2px 6px;border-radius:4px;line-height:1;";
    closeBtn.onclick = closeExploreModal;
    hdr.appendChild(closeBtn);
    modal.appendChild(hdr);

    // ── Toolbar: search + sort + select-all ───────────────────────────────────
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "padding:8px 16px 6px;border-bottom:1px solid #e0e5ee;flex-shrink:0;display:flex;flex-direction:column;gap:5px;";

    const searchRow = document.createElement("div");
    searchRow.style.cssText = "display:flex;gap:6px;align-items:center;";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search fields…";
    searchInput.style.cssText = "flex:1;box-sizing:border-box;border:1px solid #c9d0da;border-radius:6px;padding:5px 10px;font:13px -apple-system,sans-serif;color:#16325c;outline:none;";

    // Sort A→Z / Z→A toggle
    let sortAsc = true;
    const sortBtn = document.createElement("button");
    sortBtn.title = "Toggle sort order";
    sortBtn.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:11px;color:#1e3a5f;white-space:nowrap;flex-shrink:0;";
    const updateSortLabel = () => { sortBtn.textContent = sortAsc ? "A → Z" : "Z → A"; };
    updateSortLabel();
    sortBtn.onclick = () => { sortAsc = !sortAsc; updateSortLabel(); renderList(searchInput.value); };

    searchRow.appendChild(searchInput);
    searchRow.appendChild(sortBtn);

    const selRow = document.createElement("div");
    selRow.style.cssText = "display:flex;gap:5px;align-items:center;font-size:12px;";
    const countSpan = document.createElement("span");
    countSpan.style.cssText = "color:#5c6b8a;flex:1;";
    const selAllBtn = document.createElement("button");
    selAllBtn.textContent = "Select all";
    selAllBtn.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:5px;padding:3px 9px;cursor:pointer;font-size:11px;color:#1e3a5f;";
    const deselAllBtn = document.createElement("button");
    deselAllBtn.textContent = "Deselect all";
    deselAllBtn.style.cssText = "border:1px solid #c9d0da;background:#fff;border-radius:5px;padding:3px 9px;cursor:pointer;font-size:11px;color:#1e3a5f;";
    selRow.appendChild(countSpan);
    selRow.appendChild(selAllBtn);
    selRow.appendChild(deselAllBtn);
    toolbar.appendChild(searchRow);
    toolbar.appendChild(selRow);
    modal.appendChild(toolbar);

    // ── Field list (two tabs: Available | Order selected) ─────────────────────
    // Tab bar
    const tabBar = document.createElement("div");
    tabBar.style.cssText = "display:flex;border-bottom:1px solid #e0e5ee;flex-shrink:0;background:#fafbfd;";
    let activeTab = "available";
    const mkTab = (id, label) => {
      const t = document.createElement("button");
      t.textContent = label;
      t.dataset.tab = id;
      t.style.cssText = "border:none;background:none;padding:7px 16px;font:600 11px -apple-system,sans-serif;cursor:pointer;border-bottom:2px solid transparent;color:#5c6b8a;";
      t.onclick = () => { activeTab = id; updateTabs(); renderActiveTab(); };
      return t;
    };
    const tabAvail = mkTab("available", "Available");
    const tabOrder = mkTab("order", "Column Order");
    tabBar.appendChild(tabAvail);
    tabBar.appendChild(tabOrder);
    modal.appendChild(tabBar);

    const updateTabs = () => {
      [tabAvail, tabOrder].forEach(t => {
        const active = t.dataset.tab === activeTab;
        t.style.borderBottomColor = active ? "#0d6efd" : "transparent";
        t.style.color = active ? "#0d6efd" : "#5c6b8a";
      });
      toolbar.style.display = activeTab === "available" ? "flex" : "none";
    };

    // Checked set — priority: last applied by us > savedColObjs (below) > SF's current columns.
    // exploreCache survives SF re-rendering the DOM element (unlike storing on recList directly).
    const _cache = exploreCache(objectName);
    // DEFAULT selection priority: the columns CURRENTLY in the SF table (what the user
    // sees) win. Only if we somehow can't read those do we fall back to our last-applied
    // set, and finally to all fields. This keeps the picker honest to the live table.
    const curValid = currentFields.filter(fn => all.find(c => c.fieldName === fn));
    const lastApplied = _cache.lastApplied && _cache.lastApplied.length > 0
      ? _cache.lastApplied.filter(fn => all.find(c => c.fieldName === fn))
      : null;
    let initFields = curValid.length > 0
      ? curValid
      : (lastApplied && lastApplied.length ? lastApplied : all.map(c => c.fieldName));
    const checked = new Set(initFields);
    // orderedSelected: maintains user-defined drag order, same initial order
    let orderedSelected = initFields.slice();

    const listWrap = document.createElement("div");
    listWrap.style.cssText = "overflow-y:auto;flex:1;padding:6px 0;";
    modal.appendChild(listWrap);

    // Auto-persist the selection+order so a tab close never loses the user's setup.
    // Enabled only after initial build (below) to avoid thrashing storage during setup.
    let _autosaveOn = false, _autosaveT = null;
    function persistSelection() {
      if (!_autosaveOn) return;
      clearTimeout(_autosaveT);
      _autosaveT = setTimeout(() => {
        try {
          const ordered = orderedSelected.filter(fn => checked.has(fn));
          const cols = ordered.map(fn => all.find(c => c.fieldName === fn) || { fieldName: fn, label: fn });
          lsSave(objectName, cols);
          exploreCache(objectName).lastApplied = ordered.slice();
        } catch (e) {}
      }, 250);
    }

    function updateCount() {
      countSpan.textContent = checked.size + " of " + all.length + " selected";
      countSpan.style.color = "#5c6b8a";
      tabOrder.textContent = "Column Order (" + checked.size + ")";
      persistSelection();
    }

    // ── Available tab renderer ─────────────────────────────────────────────────
    function renderAvailable(filter) {
      listWrap.innerHTML = "";
      const q = (filter || "").toLowerCase();
      let visible = all.filter(col => {
        const label = col.label || col.fieldName;
        return !q || label.toLowerCase().includes(q) || col.fieldName.toLowerCase().includes(q);
      });
      // Sort: checked fields first (in selection order), then unchecked alphabetically
      let selectedCount = 0;
      if (!q) {
        const selectedInOrder = orderedSelected.filter(fn => checked.has(fn));
        const unchecked = visible.filter(col => !checked.has(col.fieldName));
        if (!sortAsc) unchecked.reverse();
        const selectedCols = selectedInOrder.map(fn => visible.find(c => c.fieldName === fn)).filter(Boolean);
        selectedCount = selectedCols.length;
        visible = [...selectedCols, ...unchecked];
        // "SELECTED (n)" header pinned above the selected group
        if (selectedCount > 0) {
          const selHdr = document.createElement("div");
          selHdr.style.cssText = "padding:4px 16px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#0d6efd;background:#eef4ff;border-bottom:1px solid #dbe6fb;";
          selHdr.textContent = "Selected (" + selectedCount + ")";
          listWrap.appendChild(selHdr);
        }
      } else {
        if (!sortAsc) visible = visible.slice().reverse();
      }

      // Divider between selected and unselected (only when no search query)
      let dividerAdded = false;
      visible.forEach((col, idx) => {
        const label = col.label || col.fieldName;
        const isChecked = checked.has(col.fieldName);

        // Insert divider between selected and unselected sections
        if (!q && !dividerAdded && !isChecked && selectedCount > 0) {
          dividerAdded = true;
          const sep = document.createElement("div");
          sep.style.cssText = "padding:4px 16px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;background:#f8fafc;border-top:1px solid #e0e5ee;border-bottom:1px solid #e0e5ee;margin-top:2px;";
          sep.textContent = "Not selected";
          listWrap.appendChild(sep);
        }

        const row = document.createElement("label");
        row.style.cssText = "display:flex;align-items:center;gap:10px;padding:6px 16px;cursor:pointer;transition:background .1s;" +
          (isChecked ? "background:#f0f5ff;" : "");
        row.onmouseenter = () => (row.style.background = isChecked ? "#e8f0fe" : "#f3f6fb");
        row.onmouseleave = () => (row.style.background = isChecked ? "#f0f5ff" : "");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = isChecked;
        cb.style.cssText = "flex-shrink:0;cursor:pointer;";
        cb.onchange = () => {
          if (cb.checked) {
            checked.add(col.fieldName);
            if (!orderedSelected.includes(col.fieldName)) orderedSelected.push(col.fieldName);
          } else {
            if (checked.size <= 1) { cb.checked = true; return; }
            checked.delete(col.fieldName);
            orderedSelected = orderedSelected.filter(fn => fn !== col.fieldName);
          }
          updateCount();
          renderAvailable(filter); // re-render to move item between sections
        };
        const nameCol = document.createElement("div");
        nameCol.style.cssText = "flex:1;min-width:0;";
        nameCol.innerHTML = "<div style='font-weight:600;color:#16325c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(label) + "</div>" +
          "<div style='font-size:11px;color:#5c6b8a;font-family:SF Mono,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(col.fieldName) + "</div>";
        row.appendChild(cb);
        row.appendChild(nameCol);
        listWrap.appendChild(row);
      });
    }

    // ── Order tab renderer (pointer-based drag-to-reorder; avoids LWC event swallow) ──
    function renderOrder() {
      listWrap.innerHTML = "";
      // Sync orderedSelected: add new checked fields not yet in order list
      orderedSelected = orderedSelected.filter(fn => checked.has(fn));
      [...checked].forEach(fn => { if (!orderedSelected.includes(fn)) orderedSelected.push(fn); });

      if (orderedSelected.length === 0) {
        listWrap.innerHTML = "<div style='padding:20px;text-align:center;color:#5c6b8a;font-size:12px'>No columns selected yet.<br>Go to the Available tab to pick fields.</div>";
        return;
      }

      orderedSelected.forEach((fn) => {
        const col = all.find(c => c.fieldName === fn) || { fieldName: fn, label: fn };
        const lbl = col.label || col.fieldName;
        const row = document.createElement("div");
        row.dataset.fn = fn;
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:5px;user-select:none;box-sizing:border-box;background:#fff;";

        const handle = document.createElement("span");
        handle.textContent = "⠿";
        handle.style.cssText = "color:#bbb;font-size:16px;flex-shrink:0;cursor:grab;line-height:1;padding:0 2px;";

        const num = document.createElement("span");
        num.style.cssText = "flex-shrink:0;color:#aab;font-size:11px;min-width:18px;";
        num.textContent = (orderedSelected.indexOf(fn) + 1) + ".";

        const txt = document.createElement("div");
        txt.style.cssText = "flex:1;min-width:0;";
        txt.innerHTML = "<div style='font-weight:600;color:#16325c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px'>" + esc(lbl) + "</div>" +
          "<div style='font-size:10px;color:#5c6b8a;font-family:SF Mono,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(fn) + "</div>";

        const rm = document.createElement("button");
        rm.innerHTML = "&#x2715;";
        rm.title = "Remove";
        rm.style.cssText = "border:none;background:none;color:#ccd;cursor:pointer;font-size:13px;padding:0 3px;flex-shrink:0;";
        rm.onmouseenter = () => (rm.style.color = "#e00");
        rm.onmouseleave = () => (rm.style.color = "#ccd");
        rm.onclick = () => {
          if (checked.size <= 1) return;
          checked.delete(fn);
          orderedSelected = orderedSelected.filter(f => f !== fn);
          updateCount(); renderOrder();
        };

        row.appendChild(handle);
        row.appendChild(num);
        row.appendChild(txt);
        row.appendChild(rm);
        listWrap.appendChild(row);

        // Smooth pointer drag — translate the row visually, commit order on drop only
        handle.addEventListener("pointerdown", (e) => {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          handle.setPointerCapture(e.pointerId);

          const startY  = e.clientY;
          const rowH    = row.getBoundingClientRect().height;
          const fromIdx = orderedSelected.indexOf(fn);
          let   toIdx   = fromIdx;

          // Lift the dragged row above siblings
          row.style.cssText += ";position:relative;z-index:10;box-shadow:0 4px 16px rgba(0,0,0,.15);background:#e8f0fe;opacity:.95;transition:none;";
          listWrap.style.userSelect = "none";

          const onMove = (ev) => {
            const dy    = ev.clientY - startY;
            row.style.transform = "translateY(" + dy + "px)";
            // Work out which slot the row is hovering over
            const hover = Math.round(fromIdx + dy / rowH);
            toIdx = Math.max(0, Math.min(orderedSelected.length - 1, hover));
            // Shift other rows out of the way visually
            const allRows = [...listWrap.querySelectorAll("[data-fn]")];
            allRows.forEach((r, i) => {
              if (r === row) return;
              const origIdx = orderedSelected.indexOf(r.dataset.fn);
              let shift = 0;
              if (fromIdx < toIdx && origIdx > fromIdx && origIdx <= toIdx) shift = -rowH;
              else if (fromIdx > toIdx && origIdx < fromIdx && origIdx >= toIdx) shift = rowH;
              r.style.transform = "translateY(" + shift + "px)";
              r.style.transition = "transform .1s";
            });
          };

          const onUp = () => {
            handle.releasePointerCapture(e.pointerId);
            handle.removeEventListener("pointermove", onMove);
            handle.removeEventListener("pointerup",   onUp);
            // Commit the reorder
            if (toIdx !== fromIdx) {
              orderedSelected.splice(fromIdx, 1);
              orderedSelected.splice(toIdx, 0, fn);
            }
            // Reset all transforms before clean re-render
            [...listWrap.querySelectorAll("[data-fn]")].forEach(r => { r.style.transform = ""; r.style.transition = ""; });
            listWrap.style.userSelect = "";
            renderOrder();
            persistSelection();   // remember the new order across tab close
          };

          handle.addEventListener("pointermove", onMove);
          handle.addEventListener("pointerup",   onUp);
        });
      });
    }

    function renderActiveTab() {
      if (activeTab === "available") renderAvailable(searchInput.value);
      else renderOrder();
    }

    searchInput.oninput = () => { if (activeTab === "available") renderAvailable(searchInput.value); };
    selAllBtn.onclick = () => {
      const q = searchInput.value.toLowerCase();
      all.forEach(c => {
        if (!q || (c.label||c.fieldName).toLowerCase().includes(q) || c.fieldName.toLowerCase().includes(q)) {
          if (!checked.has(c.fieldName)) { checked.add(c.fieldName); orderedSelected.push(c.fieldName); }
        }
      });
      renderActiveTab(); updateCount();
    };
    deselAllBtn.onclick = () => {
      const q = searchInput.value.toLowerCase();
      const visible = all.filter(c => !q || (c.label||c.fieldName).toLowerCase().includes(q) || c.fieldName.toLowerCase().includes(q));
      visible.forEach(c => { if (checked.size > 1) { checked.delete(c.fieldName); orderedSelected = orderedSelected.filter(fn => fn !== c.fieldName); } });
      renderActiveTab(); updateCount();
    };

    updateTabs();
    renderActiveTab();
    updateCount();

    // ── SOQL Editor panel ─────────────────────────────────────────────────────
    let soqlPanelEl = null;
    let soqlAcDropEl = null;
    function closeSoqlEditor() {
      soqlAcDropEl = null; // acDrop lives inside soqlPanelEl, removed with it
      if (soqlPanelEl)  { soqlPanelEl.remove();  soqlPanelEl = null; }
    }
    _openSoqlEditor = openSoqlEditor;   // expose to the results-table "Edit SQL" button
    function openSoqlEditor() {
      if (soqlPanelEl) { closeSoqlEditor(); return; }

      // ── Syntax token regexes ──────────────────────────────────────────────
      const SOQL_KW  = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|LIKE|INCLUDES|EXCLUDES|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|ASC|DESC|NULLS\s+FIRST|NULLS\s+LAST|NULL|TRUE|FALSE|TODAY|YESTERDAY|TOMORROW|THIS_WEEK|LAST_WEEK|NEXT_WEEK|THIS_MONTH|LAST_MONTH|THIS_QUARTER|LAST_QUARTER|THIS_YEAR|LAST_YEAR|LAST_N_DAYS|NEXT_N_DAYS|LAST_N_MONTHS|NEXT_N_MONTHS)\b/gi;
      const SOQL_FN  = /\b(COUNT|SUM|AVG|MIN|MAX|COUNT_DISTINCT|CALENDAR_MONTH|CALENDAR_YEAR|FORMAT|FIELDS)\b/gi;
      const SOQL_STR = /'[^']*'/g;
      const SOQL_NUM = /\b\d[\d.]*\b/g;
      const SOQL_CMT = /--[^\n]*/g;

      const allFieldNames = all.map(c => c.fieldName);
      const allFieldMap   = {};
      all.forEach(c => { allFieldMap[c.fieldName] = c; });

      // ── Highlighter: mirror technique — textarea is transparent, pre shows colors ──
      function highlightSoql(raw) {
        const escaped = raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        const ranges = [];
        const add = (re, cls) => {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(escaped)) !== null) {
            const s = m.index, e = m.index + m[0].length;
            if (!ranges.some(r => r.s < e && r.e > s)) ranges.push({s, e, cls});
          }
        };
        add(SOQL_CMT, "cmt");
        add(SOQL_STR, "str");
        add(SOQL_KW,  "kw");
        add(SOQL_FN,  "fn");
        add(SOQL_NUM, "num");
        allFieldNames.forEach(fn => {
          const re = new RegExp("\\b" + fn.replace(/[.*+?^${}()|[\]\\]/g,"\\$&") + "\\b", "g");
          re.lastIndex = 0; let m2;
          while ((m2 = re.exec(escaped)) !== null) {
            const s = m2.index, e = m2.index + m2[0].length;
            if (!ranges.some(r => r.s < e && r.e > s)) ranges.push({s, e, cls:"fld"});
          }
        });
        ranges.sort((a,b) => a.s - b.s);
        // Vibrant palette on dark
        const C = {
          kw:  "color:#60a5fa;font-weight:700",   // vivid blue
          fn:  "color:#f59e0b",                   // amber
          str: "color:#34d399",                   // emerald green (strings)
          num: "color:#fb923c",                   // orange (numbers)
          fld: "color:#e879f9",                   // fuchsia/pink (field names — very distinct)
          cmt: "color:#64748b;font-style:italic"  // slate (comments)
        };
        let out = "", pos = 0;
        ranges.forEach(r => {
          if (r.s > pos) out += "<span style='color:#e2e8f0'>" + escaped.slice(pos, r.s) + "</span>";
          out += "<span style='" + (C[r.cls]||"color:#e2e8f0") + "'>" + escaped.slice(r.s, r.e) + "</span>";
          pos = r.e;
        });
        if (pos < escaped.length) out += "<span style='color:#e2e8f0'>" + escaped.slice(pos) + "</span>";
        return out;
      }

      // ── Autocomplete ──────────────────────────────────────────────────────
      const AC_KEYWORDS = ["SELECT","FROM","WHERE","AND","OR","NOT","IN","LIKE","INCLUDES","EXCLUDES",
        "ORDER BY","HAVING","LIMIT","OFFSET","ASC","DESC","NULL","TRUE","FALSE",
        "COUNT","SUM","AVG","MIN","MAX","TODAY","YESTERDAY","THIS_WEEK","LAST_WEEK",
        "THIS_MONTH","LAST_MONTH","THIS_YEAR","LAST_N_DAYS:","NEXT_N_DAYS:","LAST_N_MONTHS:"];

      function getWordAtCursor(val, pos) {
        let s = pos;
        while (s > 0 && /\w/.test(val[s-1])) s--;
        return { word: val.slice(s, pos), start: s };
      }

      // ── Build panel ───────────────────────────────────────────────────────
      soqlPanelEl = document.createElement("div");
      // overflow:visible is required so the autocomplete dropdown can escape the panel bounds
      soqlPanelEl.style.cssText = "position:fixed;top:48px;left:50%;transform:translateX(-50%);width:min(760px,96vw);z-index:2147483647;background:#0f172a;border:1px solid #1e293b;border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,.7),0 0 0 1px rgba(99,102,241,.15);display:flex;flex-direction:column;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;overflow:hidden;";

      // ── Header: gradient accent bar + object pill ─────────────────────────
      const sh = document.createElement("div");
      sh.style.cssText = "background:linear-gradient(135deg,#1e1b4b 0%,#0f172a 60%);border-bottom:1px solid #1e293b;padding:12px 16px 10px;display:flex;align-items:center;gap:10px;cursor:move;user-select:none;flex-shrink:0;";
      // colored left accent line
      const accentLine = document.createElement("div");
      accentLine.style.cssText = "width:3px;height:28px;background:linear-gradient(180deg,#818cf8,#6366f1);border-radius:2px;flex-shrink:0;";
      const titleWrap = document.createElement("div");
      titleWrap.style.cssText = "flex:1;min-width:0;";
      titleWrap.innerHTML =
        "<div style='font-weight:700;font-size:13px;color:#e2e8f0;letter-spacing:.01em'>SOQL Editor</div>" +
        "<div style='font-size:10px;color:#6366f1;margin-top:1px;font-weight:600;letter-spacing:.04em;text-transform:uppercase'>" + esc(recList.objectName || "") + "</div>";
      const scb = document.createElement("button");
      scb.innerHTML = "&#x2715;";
      scb.style.cssText = "border:none;background:rgba(255,255,255,.06);cursor:pointer;font-size:13px;color:#94a3b8;padding:4px 7px;border-radius:6px;line-height:1;flex-shrink:0;transition:background .15s;";
      scb.onmouseenter = () => (scb.style.background = "rgba(255,255,255,.12)");
      scb.onmouseleave = () => (scb.style.background = "rgba(255,255,255,.06)");
      scb.onclick = () => closeSoqlEditor();
      sh.appendChild(accentLine);
      sh.appendChild(titleWrap);
      sh.appendChild(scb);
      soqlPanelEl.appendChild(sh);

      // ── Editor: highlight layer + transparent textarea ────────────────────
      const buildInitialSoql = () => {
        const fields = orderedSelected.filter(fn => checked.has(fn) && fn !== "recordPageUrl");
        const from = recList.objectName || "Unknown__c";
        const fieldStr = fields.length ? fields.join(", ") : "Id";
        // Include WHERE from active UI filter (so user sees what filter is doing)
        var whereClause = "";
        var fs = _filterState[from];
        if (fs && fs.active && fs.conds && fs.conds.length) {
          var frags = fs.conds.map(function (c) {
            if (!c.col || (!c.val && c.val !== "false" && c.val !== "true")) return null;
            var q = '"' + c.col.replace(/"/g, '""') + '"';
            if (c.op === "contains") return q + " LIKE '%" + c.val.replace(/'/g, "''") + "%'";
            if (c.op === "starts with") return q + " LIKE '" + c.val.replace(/'/g, "''") + "%'";
            return q + " " + c.op + " '" + c.val.replace(/'/g, "''") + "'";
          }).filter(Boolean);
          if (frags.length) whereClause = " WHERE " + frags.join(" " + (fs.join || "AND") + " ");
        }
        // Use current rowsInput value as the LIMIT (editable by user)
        var lim = DC_MAX_FETCH_ROWS;
        try { var ri = panel.querySelector("input[type=number]"); if (ri) lim = parseInt(ri.value, 10) || DC_MAX_FETCH_ROWS; } catch(e){}
        return "SELECT " + fieldStr + "\nFROM " + from + whereClause + "\nLIMIT " + lim;
      };

      const editorWrap = document.createElement("div");
      // overflow:visible so the absolute-positioned acDrop can overflow outside the textarea bounds
      editorWrap.style.cssText = "position:relative;flex-shrink:0;background:#0a0f1e;";

      // The highlight <pre> sits behind; textarea is on top with color:transparent
      const hlPre = document.createElement("pre");
      hlPre.setAttribute("aria-hidden","true");
      hlPre.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;margin:0;padding:14px 16px;font:13px/1.6 'SF Mono',Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;overflow:hidden;pointer-events:none;z-index:1;box-sizing:border-box;";

      const textarea = document.createElement("textarea");
      textarea.value = buildInitialSoql();
      textarea.spellcheck = false;
      textarea.autocomplete = "off";
      textarea.autocorrect = "off";
      textarea.autocapitalize = "off";
      // color:transparent is the key — lets the hlPre colors show through
      textarea.style.cssText = "position:relative;z-index:2;display:block;width:100%;box-sizing:border-box;height:160px;min-height:80px;resize:vertical;border:none;padding:14px 16px;font:13px/1.6 'SF Mono',Menlo,Consolas,monospace;color:transparent;caret-color:#a5b4fc;outline:none;background:transparent;tab-size:2;";

      const syncHighlight = () => {
        hlPre.innerHTML = highlightSoql(textarea.value) + "\n ";
        hlPre.scrollTop  = textarea.scrollTop;
        hlPre.scrollLeft = textarea.scrollLeft;
      };

      editorWrap.appendChild(hlPre);
      editorWrap.appendChild(textarea);
      soqlPanelEl.appendChild(editorWrap);

      // ── Toolbar ───────────────────────────────────────────────────────────
      const toolbar = document.createElement("div");
      toolbar.style.cssText = "display:flex;align-items:center;gap:8px;padding:9px 14px;background:#0f172a;border-bottom:1px solid #1e293b;flex-shrink:0;";

      const statusDot = document.createElement("span");
      statusDot.style.cssText = "width:6px;height:6px;border-radius:50%;background:#334155;flex-shrink:0;";
      const statusSpan = document.createElement("span");
      statusSpan.style.cssText = "flex:1;font-size:11px;color:#64748b;";
      statusSpan.textContent = "⌘↵ to run  ·  type to autocomplete";

      const mkB = (label, accent) => {
        const b = document.createElement("button");
        b.textContent = label;
        const base = accent
          ? "background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:none;box-shadow:0 2px 8px rgba(99,102,241,.4);"
          : "background:rgba(255,255,255,.06);color:#94a3b8;border:1px solid #1e293b;";
        b.style.cssText = "border-radius:7px;padding:5px 14px;cursor:pointer;font:600 11px -apple-system,sans-serif;white-space:nowrap;flex-shrink:0;" + base;
        if (!accent) {
          b.onmouseenter = () => (b.style.background = "rgba(255,255,255,.1)");
          b.onmouseleave = () => (b.style.background = "rgba(255,255,255,.06)");
        }
        return b;
      };
      const runBtn   = mkB("▶  Run", true);
      const copyBtn  = mkB("Copy", false);
      const resetBtn = mkB("Reset", false);

      function setStatus(msg, type) {
        const dotColor = type==="ok"?"#4ade80":type==="err"?"#f87171":type==="warn"?"#fbbf24":"#334155";
        const txtColor = type==="ok"?"#4ade80":type==="err"?"#f87171":type==="warn"?"#fbbf24":"#64748b";
        statusDot.style.background = dotColor;
        statusSpan.style.color = txtColor;
        statusSpan.textContent = msg;
      }

      runBtn.onclick = () => {
        hideAc();
        var soql = textarea.value.trim();
        if (!soql) { setStatus("Query is empty", "err"); return; }
        var selMatch = soql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+/i);
        if (!selMatch) { setStatus("Missing SELECT … FROM", "err"); return; }
        var parsedFields = selMatch[1].split(",").map(function (f) { return f.trim().replace(/\s+/g, ""); }).filter(function (f) { return f && f !== "*"; });
        var objName = (findRecordListEl() && findRecordListEl().objectName) || (recList && recList.objectName) || "";
        // Run the user's REAL SQL server-side (WHERE / ORDER BY / LIMIT all honored) via
        // the documented endpoint (extension) or /aura (bookmarklet), then render the
        // result in OUR own table — the same table with View/Copy/hide-empty features.
        setStatus("Running query…", "");
        runBtn.disabled = true; runBtn.style.opacity = ".55";
        var ds = (typeof resolveDataSpace === "function") ? resolveDataSpace(objName) : "";
        ensureQueryContext(function (ready) {
          if (!ready) {
            runBtn.disabled = false; runBtn.style.opacity = "1";
            var connectWrap = document.createElement("div");
            connectWrap.style.cssText = "margin-top:8px;";
            var statusEl = panel.querySelector(".dc-soql-status") || panel;
            statusEl.textContent = "";
            statusEl.appendChild(connectWrap);
            renderConnectButton(connectWrap, function () { runBtn.click(); });
            return;
          }
          // Parse user's LIMIT to request that many rows (default 49999 if no LIMIT)
          var userLim = soql.match(/\bLIMIT\s+(\d+)/i);
          var askRows = userLim ? Math.min(parseInt(userLim[1], 10), DC_MAX_FETCH_ROWS) : DC_MAX_FETCH_ROWS;
          // Reset UI filter since user is running custom SQL
          _filterState[objName] = null;
          runRawSql(soql, ds, askRows).then(function (res) {
            runBtn.disabled = false; runBtn.style.opacity = "1";
            if (!res.columns.length) { setStatus("Query ran but returned no columns.", "warn"); return; }
            try { closeSoqlEditor(); } catch (e) {}
            showAllColumnsTable(objName, res.columns, res.rows, res.rows.length, res.columns);
          }).catch(function (err) {
            runBtn.disabled = false; runBtn.style.opacity = "1";
            setStatus(String(err && err.message || err), "err");
          });
        });
      };
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(textarea.value)
          .then(()=>{ copyBtn.textContent="✓ Copied"; setTimeout(()=>{copyBtn.textContent="Copy";},2000); })
          .catch(()=>{ textarea.select(); document.execCommand("copy"); });
      };
      resetBtn.onclick = () => { textarea.value=buildInitialSoql(); syncHighlight(); setStatus("⌘↵ to run  ·  type to autocomplete",""); hideAc(); };

      toolbar.appendChild(runBtn);
      toolbar.appendChild(copyBtn);
      toolbar.appendChild(resetBtn);
      toolbar.appendChild(statusDot);
      toolbar.appendChild(statusSpan);

      // Inline suggestion list — sits between the textarea and the toolbar inside the flex column.
      const acDrop = document.createElement("div");
      acDrop.style.cssText = "display:none;background:#0f172a;border-top:1px solid #1e293b;border-bottom:1px solid #1e293b;max-height:224px;overflow-y:auto;flex-shrink:0;";
      soqlAcDropEl = acDrop;
      soqlPanelEl.appendChild(acDrop);   // between textarea and toolbar
      soqlPanelEl.appendChild(toolbar);
      let acItems = [], acIdx = -1;

      function hideAc() { acDrop.style.display="none"; acItems=[]; acIdx=-1; }
      function highlightAcRow() {
        [...acDrop.children].forEach((r,i) => {
          r.style.background = i===acIdx ? "rgba(99,102,241,.2)" : "transparent";
        });
      }
      function showAc(items, word) {
        if (!items.length) { hideAc(); return; }
        acItems = items; acIdx = 0;
        acDrop.innerHTML = "";
        // Header label
        const hd = document.createElement("div");
        hd.style.cssText = "padding:4px 14px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#475569;";
        hd.textContent = "Suggestions — Tab to insert";
        acDrop.appendChild(hd);
        items.slice(0,12).forEach((item, i) => {
          const isField = !!allFieldMap[item];
          const col     = isField ? allFieldMap[item] : null;
          const nameColor = isField ? "#e879f9" : "#60a5fa";
          const badgeBg   = isField ? "rgba(232,121,249,.12)" : "rgba(96,165,250,.12)";
          const badgeFg   = isField ? "#c084fc" : "#60a5fa";
          const badge     = isField ? (col.type || "field") : "keyword";
          // Highlight the matching part of the item name
          const wl = word.toLowerCase();
          const matchIdx = item.toLowerCase().indexOf(wl);
          let nameHtml;
          if (matchIdx >= 0 && wl.length > 0) {
            nameHtml = esc(item.slice(0, matchIdx)) +
              "<span style='background:rgba(99,102,241,.35);border-radius:2px'>" + esc(item.slice(matchIdx, matchIdx + wl.length)) + "</span>" +
              esc(item.slice(matchIdx + wl.length));
          } else {
            nameHtml = esc(item);
          }
          const row = document.createElement("div");
          row.style.cssText = "padding:5px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;border-radius:0;" +
            (i===0 ? "background:rgba(99,102,241,.2);" : "");
          row.innerHTML =
            "<span style='font:13px/1.4 SF Mono,Menlo,monospace;color:" + nameColor + ";flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + nameHtml + "</span>" +
            "<span style='font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:1px 6px;border-radius:3px;background:" + badgeBg + ";color:" + badgeFg + ";flex-shrink:0'>" + esc(badge) + "</span>";
          row.onmouseenter = () => { acIdx = i; highlightAcRow(); };
          row.onclick      = () => insertAcItem(item, word);
          acDrop.appendChild(row);
        });
        acDrop.style.display = "block";
      }
      function insertAcItem(item, typedWord) {
        const val = textarea.value, pos = textarea.selectionStart;
        const start = pos - typedWord.length;
        textarea.value = val.slice(0, start) + item + val.slice(pos);
        textarea.selectionStart = textarea.selectionEnd = start + item.length;
        hideAc(); textarea.focus(); syncHighlight();
      }
      function triggerAc() {
        setTimeout(() => {
          const val = textarea.value, pos = textarea.selectionStart;
          const {word} = getWordAtCursor(val, pos);
          if (word.length < 1 || /^\d+$/.test(word)) { hideAc(); return; }
          const wl = word.toLowerCase();
          // Match fields that CONTAIN the typed word anywhere (not just starts-with)
          const fieldMatches = allFieldNames.filter(fn => fn.toLowerCase().includes(wl));
          // Sort: starts-with first, then contains
          fieldMatches.sort((a, b) => {
            const as = a.toLowerCase().startsWith(wl), bs = b.toLowerCase().startsWith(wl);
            if (as && !bs) return -1; if (!as && bs) return 1;
            return a.localeCompare(b);
          });
          const kwMatches = AC_KEYWORDS.filter(k => k.toLowerCase().startsWith(wl) && k.toLowerCase() !== wl);
          const items = [...fieldMatches.slice(0, 10), ...kwMatches.slice(0, 4)];
          if (!items.length) { hideAc(); return; }
          showAc(items, word);
        }, 0);
      }

      // ── Hint strip — tiny, one line, not overwhelming ─────────────────────
      const hintBar = document.createElement("div");
      hintBar.style.cssText = "padding:6px 16px;background:#0a0f1e;font-size:10px;color:#334155;display:flex;gap:14px;align-items:center;flex-shrink:0;border-top:1px solid #1e293b;";
      const hint = (k,v) => {
        const s = document.createElement("span");
        s.innerHTML = "<kbd style='background:#1e293b;color:#64748b;border:1px solid #334155;border-radius:3px;padding:0 4px;font:10px SF Mono,Menlo,monospace'>" + k + "</kbd> <span style='color:#475569'>" + v + "</span>";
        return s;
      };
      hintBar.appendChild(hint("⌘↵","Run"));
      hintBar.appendChild(hint("Tab","Accept suggestion"));
      hintBar.appendChild(hint("Esc","Close suggestion"));
      hintBar.appendChild(hint("⌘Z","Undo"));
      // Color legend — tiny dots
      const legend = document.createElement("span");
      legend.style.cssText = "margin-left:auto;display:flex;gap:8px;align-items:center;";
      [["#60a5fa","keyword"],["#e879f9","field"],["#34d399","string"],["#fb923c","number"]].forEach(([c,l]) => {
        const s = document.createElement("span");
        s.style.cssText = "display:flex;align-items:center;gap:3px;";
        s.innerHTML = "<span style='width:7px;height:7px;border-radius:50%;background:"+c+";flex-shrink:0'></span><span style='color:#475569;font-size:9px'>"+l+"</span>";
        legend.appendChild(s);
      });
      hintBar.appendChild(legend);
      soqlPanelEl.appendChild(hintBar);

      // ── Events ────────────────────────────────────────────────────────────
      textarea.addEventListener("input", () => { syncHighlight(); triggerAc(); });
      textarea.addEventListener("scroll", () => { hlPre.scrollTop=textarea.scrollTop; hlPre.scrollLeft=textarea.scrollLeft; });
      textarea.addEventListener("keydown", (e) => {
        if (acDrop.style.display !== "none") {
          if (e.key==="ArrowDown") { e.preventDefault(); acIdx=Math.min(acIdx+1,acItems.length-1); highlightAcRow(); return; }
          if (e.key==="ArrowUp")   { e.preventDefault(); acIdx=Math.max(acIdx-1,0); highlightAcRow(); return; }
          if ((e.key==="Enter"||e.key==="Tab") && acIdx>=0 && acItems[acIdx]) {
            e.preventDefault();
            insertAcItem(acItems[acIdx], getWordAtCursor(textarea.value,textarea.selectionStart).word);
            return;
          }
          if (e.key==="Escape") { e.preventDefault(); hideAc(); return; }
        }
        if ((e.ctrlKey||e.metaKey) && e.key==="Enter") { e.preventDefault(); e.stopPropagation(); runBtn.click(); }
      });
      textarea.addEventListener("blur", () => setTimeout(hideAc, 150));

      makeDraggable(soqlPanelEl, sh);
      addResizeHandle(soqlPanelEl, 460, 240);
      document.body.appendChild(soqlPanelEl);
      syncHighlight();
      textarea.focus();
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement("div");
    footer.style.cssText = "padding:8px 14px;border-top:1px solid #e0e5ee;flex-shrink:0;display:flex;flex-direction:column;gap:6px;background:#f9fafc;border-radius:0 0 12px 12px;";

    // LIMIT used only in SOQL editor — keep a hidden ref for openSoqlEditor
    const limitInputEl = document.createElement("input");
    limitInputEl.type = "number"; limitInputEl.value = "2000"; limitInputEl.style.display = "none";
    footer.appendChild(limitInputEl);

    const savedNote = document.createElement("div");
    savedNote.style.cssText = "font-size:11px;color:#5c6b8a;min-height:14px;";
    const savedColObjs = lsLoad(objectName);
    const savedNames = savedColObjs ? savedColObjs.map(c => c.fieldName || c).filter(Boolean) : null;
    if (savedNames) savedNote.textContent = "Saved set: " + savedNames.length + " fields";
    footer.appendChild(savedNote);

    const mkFootBtn = (label, primary, icon) => {
      const b = document.createElement("button");
      b.textContent = icon ? icon + " " + label : label;
      b.style.cssText = "flex:1;border-radius:6px;padding:7px 8px;cursor:pointer;font:600 11px -apple-system,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid " +
        (primary ? "#0d6efd;background:#0d6efd;color:#fff;" : "#c9d0da;background:#fff;color:#1e3a5f;");
      if (!primary) { b.onmouseenter = () => (b.style.background = "#f3f6fb"); b.onmouseleave = () => (b.style.background = "#fff"); }
      return b;
    };
    const viewAllBtn = mkFootBtn("Show selected columns' data", true);
    const saveBtn    = mkFootBtn("Save set", false);
    const restoreBtn = mkFootBtn("Restore saved", false);
    const clearBtn   = mkFootBtn("Clear saved", false);
    const exportBtn  = mkFootBtn("Export CSV", false);
    const soqlEdBtn  = mkFootBtn("Edit SOQL", false);

    // Grey out restore if nothing saved
    if (!savedColObjs || !savedColObjs.length) {
      restoreBtn.disabled = true;
      restoreBtn.style.opacity = "0.4";
      restoreBtn.style.cursor = "not-allowed";
    }

    // Row 1: "Show selected columns' data" (full width, primary)
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;";
    // Row 2: secondary buttons
    const btnRow2 = document.createElement("div");
    btnRow2.style.cssText = "display:flex;gap:4px;";

    // Spinner overlay — shown during apply so user knows work is happening
    const spinnerEl = document.createElement("div");
    spinnerEl.style.cssText = "display:none;position:absolute;inset:0;background:rgba(255,255,255,.75);z-index:10;align-items:center;justify-content:center;flex-direction:column;gap:8px;border-radius:12px;font:13px -apple-system,sans-serif;color:#1e3a5f;";
    spinnerEl.innerHTML = "<div style='width:28px;height:28px;border:3px solid #d0d5de;border-top-color:#0d6efd;border-radius:50%;animation:dc-spin 0.7s linear infinite'></div><span>Applying columns…</span>";
    if (!document.getElementById("dc-spin-style")) {
      const ss = document.createElement("style"); ss.id = "dc-spin-style";
      ss.textContent = "@keyframes dc-spin{to{transform:rotate(360deg)}}";
      document.head.appendChild(ss);
    }
    modal.style.position = "fixed"; // ensure spinner positions correctly
    modal.appendChild(spinnerEl);

    let applyInProgress = false;
    const showSpinner = (msg) => { applyInProgress = true; spinnerEl.style.display = "flex"; spinnerEl.querySelector("span").textContent = msg || "Applying columns…"; };
    const hideSpinner = () => { applyInProgress = false; spinnerEl.style.display = "none"; };

    // ── "Show selected columns' data" — one read-only Aura query, our own table ─────
    // Shows every SELECTED column's data at once (removing SF's 10-col display cap) in
    // our own scrollable table. "ALL columns" = all the columns you've selected (which
    // defaults to the current table's columns; tick more in the picker to add them).
    // Auto-persists the selection so a tab close never loses the setup.
    viewAllBtn.onclick = () => {
      const cols = orderedSelected.filter(fn => checked.has(fn));
      if (!cols.length) { savedNote.textContent = "Select at least one field first."; return; }
      // Persist immediately so the work survives a tab close, even before viewing.
      try { lsSave(objectName, cols.map(fn => all.find(c => c.fieldName === fn) || { fieldName: fn, label: fn })); } catch (e) {}
      exploreCache(objectName).lastApplied = cols.slice();
      viewAllBtn.disabled = true;
      showSpinner("Loading " + cols.length + " columns…");
      // Make sure we have live query credentials first (bootstraps invisibly if the
      // page hasn't fired a query since the tool loaded), THEN run the one-shot query.
      ensureQueryContext(function (ready) {
        if (!ready) {
          hideSpinner(); viewAllBtn.disabled = false;
          savedNote.textContent = "";
          var connectWrap2 = document.createElement("div");
          savedNote.appendChild(connectWrap2);
          renderConnectButton(connectWrap2, function () { viewAllBtn.click(); });
          return;
        }
        loadColumnsData(objectName, cols, 100).then((rows) => {
          hideSpinner(); viewAllBtn.disabled = false;
          savedNote.textContent = "Loaded " + rows.length + " rows × " + cols.length + " columns.";
          showAllColumnsTable(objectName, cols, rows);
        }).catch((err) => {
          hideSpinner(); viewAllBtn.disabled = false;
          savedNote.textContent = String(err && err.message || err);
        });
      });
    };

    saveBtn.onclick = () => {
      const ordered = orderedSelected.filter(fn => checked.has(fn));
      const savedCols = ordered.map(fn => all.find(c => c.fieldName === fn) || { fieldName: fn, label: fn });
      lsSave(objectName, savedCols);
      // Reset session guard so next page load auto-applies the NEW saved set
      // Enable restore button now that we have a saved set
      restoreBtn.disabled = false;
      restoreBtn.style.opacity = "1";
      restoreBtn.style.cursor = "pointer";
      savedNote.textContent = "✓ Saved " + savedCols.length + " fields";
    };
    restoreBtn.onclick = () => {
      const latest = lsLoad(objectName);
      if (!latest || !latest.length) { savedNote.textContent = "No saved set found"; return; }
      const fns = latest.map(c => c.fieldName || c).filter(Boolean);
      checked.clear();
      fns.forEach(fn => checked.add(fn));
      orderedSelected = fns.slice();
      latest.forEach(saved => {
        if (!saved.fieldName) return;
        if (!all.find(c => c.fieldName === saved.fieldName)) all.push(saved);
        const ac = exploreCache(objectName).allColumns;
        if (ac && !ac.find(c => c.fieldName === saved.fieldName)) ac.push(saved);
      });
      renderActiveTab();
      updateCount();
      exploreCache(objectName).lastApplied = fns.slice();
      // Restore = repopulate the picker AND open the full-columns table for the saved
      // set (via the one-shot query) — no blank writes to SF's native table.
      showSpinner("Restoring + loading " + fns.length + " saved columns…");
      ensureQueryContext(function (ready) {
        if (!ready) { hideSpinner(); savedNote.textContent = "Restored picker (" + fns.length + " fields). Sort a column once, then click \"Show selected columns' data\"."; return; }
        loadColumnsData(objectName, fns, 100).then((rows) => {
          hideSpinner();
          savedNote.textContent = "✓ Restored " + fns.length + " fields — " + rows.length + " rows loaded.";
          showAllColumnsTable(objectName, fns, rows);
        }).catch((err) => { hideSpinner(); savedNote.textContent = String(err && err.message || err); });
      });
    };
    clearBtn.onclick = () => {
      lsClear(objectName);
      restoreBtn.disabled = true;
      restoreBtn.style.opacity = "0.4";
      restoreBtn.style.cursor = "not-allowed";
      savedNote.textContent = "Cleared saved set";
    };
    exportBtn.onclick = () => {
      const ordered = orderedSelected.filter(fn => checked.has(fn));
      if (!ordered.length) { savedNote.textContent = "Select at least one field first."; return; }
      exportBtn.disabled = true;
      savedNote.textContent = "Exporting all " + ordered.length + " columns…";
      // Export via the SAME one-shot query as the full-table view, so ALL selected
      // columns land in the CSV with real data — not just SF's 10.
      ensureQueryContext(function () {
        loadColumnsData(objectName, ordered, 100).then((rows) => {
          exportBtn.disabled = false;
          downloadRowsCsv(objectName, ordered, rows);
          savedNote.textContent = "Exported " + rows.length + " rows × " + ordered.length + " columns.";
        }).catch((err) => {
          // Fallback to SF's ≤10-column data if the query path isn't ready.
          exportBtn.disabled = false;
          savedNote.textContent = String(err && err.message || err) + " — exporting visible columns instead.";
          const rl = findRecordListEl(); if (rl) exportExploreCsv(rl);
        });
      });
    };
    soqlEdBtn.onclick = openSoqlEditor;

    // Row 1: the headline "Show selected columns' data" (primary, full width).
    viewAllBtn.style.flex = "1";
    btnRow.appendChild(viewAllBtn);
    // Row 2: everything else, secondary.
    btnRow2.appendChild(soqlEdBtn);
    btnRow2.appendChild(saveBtn);
    btnRow2.appendChild(restoreBtn);
    btnRow2.appendChild(clearBtn);
    btnRow2.appendChild(exportBtn);
    footer.appendChild(btnRow);
    footer.appendChild(btnRow2);
    modal.appendChild(footer);

    makeDraggable(modal, hdr);
    addResizeHandle(modal, 360, 320);

    // The picker DEFAULTS to the columns currently in the SF table (initFields above)
    // — that's what the user expects to see selected. We do NOT auto-force a stale
    // saved set here (that caused the picker to show old, unrelated fields). Instead,
    // just merge any saved field metadata into `all` so the "Restore saved" button can
    // repopulate them on demand, and note that a saved set exists.
    if (savedColObjs && savedColObjs.length > 0) {
      const savedFns = savedColObjs.map(c => c.fieldName || c).filter(Boolean);
      if (savedFns.length > 0) {
        savedColObjs.forEach(saved => {
          if (!saved.fieldName) return;
          if (!all.find(c => c.fieldName === saved.fieldName)) all.push(saved);
          const ac2 = exploreCache(objectName).allColumns;
          if (ac2 && !ac2.find(c => c.fieldName === saved.fieldName)) ac2.push(saved);
        });
        savedNote.textContent = "Showing current table columns. (Saved set of " + savedFns.length + " available — click \"Restore saved\".)";
      }
    }

    // Initial setup is done — from here, every selection/order change auto-saves so a
    // tab close never loses the user's work.
    _autosaveOn = true;

    const onEsc = (e) => {
      if (e.key === "Escape") {
        if (soqlPanelEl) { closeSoqlEditor(); }
        else { closeExploreModal(); }
        document.removeEventListener("keydown", onEsc, true);
      }
    };
    document.addEventListener("keydown", onEsc, true);
    const barEl = document.getElementById("dc-bar");
    const onOut = (e) => {
      if (!exploreModalEl) return;
      if (applyInProgress) return;
      const inModal  = exploreModalEl.contains(e.target);
      const inSoql   = soqlPanelEl && soqlPanelEl.contains(e.target);
      const inAcDrop = soqlAcDropEl && soqlAcDropEl.contains(e.target);
      const inBar    = barEl && barEl.contains(e.target);
      if (!inModal && !inSoql && !inAcDrop && !inBar) { closeExploreModal(); closeSoqlEditor(); document.removeEventListener("pointerdown", onOut, true); }
    };
    setTimeout(() => document.addEventListener("pointerdown", onOut, true), 100);
  }


  // ── Object-change watcher ─────────────────────────────────────────────────
  // PERF: this used to run findRecordListEl() (a full recursive shadow-DOM walk of the
  // whole page) on a 1200ms setInterval FOREVER — pure wasted work that caused lag,
  // and its body did nothing (it only tracked a name it never used). Removed the timer.
  // The cache is read fresh each time the Column Selector opens (keyed by objectName),
  // so no background watcher is needed — object changes are handled on demand.
  function watchExploreObjectChange() { /* no-op: was a costly idle poll; removed for perf */ }

  // ── Data Transform launcher (FAB) ─────────────────────────────────────────
  // The transform editor is a standalone Aura app; we add a minimal launcher with a
  // single "Understand this transform" action that reads the definition (extension
  // cookie path) and renders the plain-language summary.
  function ensureTransformLauncher() {
    if (document.getElementById("dc-bar")) return;
    const wrap = document.createElement("div");
    wrap.id = "dc-bar";
    wrap.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;";
    const btn = document.createElement("button");
    btn.textContent = "🔎 Understand this transform";
    btn.style.cssText = "border:none;border-radius:22px;padding:11px 18px;cursor:pointer;font:600 13px -apple-system,sans-serif;color:#fff;background:linear-gradient(135deg,#1e3a5f,#0d6efd);box-shadow:0 3px 12px rgba(13,110,253,.4);";
    const note = document.createElement("div");
    note.style.cssText = "font-size:11px;color:#5c6b8a;background:#fff;border:1px solid #e0e5ee;border-radius:6px;padding:4px 8px;display:none;max-width:280px;";
    btn.onclick = () => {
      const ids = transformIdsFromUrl();
      const nameOrId = ids.devName || ids.transformId;
      if (!nameOrId) { note.textContent = "Couldn't find the transform id in the URL."; note.style.display = "block"; return; }
      if (typeof extBridgePresent === "function" && !extBridgePresent()) {
        note.textContent = "Reading a transform needs the browser extension (the page can't reach the API directly). Use the extension, not the bookmarklet, here.";
        note.style.display = "block"; return;
      }
      btn.disabled = true; btn.textContent = "Reading…"; note.style.display = "none";
      fetchTransformViaBridge(nameOrId).then((rep) => {
        btn.disabled = false; btn.textContent = "🔎 Understand this transform";
        showTransformSummary(rep);
      }).catch((err) => {
        btn.disabled = false; btn.textContent = "🔎 Understand this transform";
        note.textContent = String(err && err.message || err); note.style.display = "block";
      });
    };
    wrap.appendChild(note); wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }

  // ── Query Editor launcher (FAB) — "Export results to CSV" ─────────────────
  // SF's Query Editor shows results but can't export them. This button reads the user's
  // SQL, re-runs it via our proven query path (up to 49,999 rows), and downloads the
  // full result as CSV. Reuses the same runRawSql mechanism already built.
  function ensureQueryEditorLauncher() {
    if (document.getElementById("dc-bar")) return;
    try { installAuraSniffer(); } catch (e) {}

    const wrap = document.createElement("div");
    wrap.id = "dc-bar";
    wrap.style.cssText = "position:fixed;bottom:20px;left:20px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-start;gap:10px;";

    // Info card (results, guidance, errors)
    const card = document.createElement("div");
    card.id = "dc-qe-card";
    card.style.cssText = "display:none;width:340px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;box-shadow:0 4px 20px rgba(0,0,0,.1);font:13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;color:#1e293b;position:relative;";

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "×";
    closeBtn.style.cssText = "position:absolute;top:8px;right:10px;border:none;background:none;font-size:18px;color:#94a3b8;cursor:pointer;line-height:1;padding:2px 6px;border-radius:4px;";
    closeBtn.onmouseenter = () => { closeBtn.style.color = "#475569"; closeBtn.style.background = "#f1f5f9"; };
    closeBtn.onmouseleave = () => { closeBtn.style.color = "#94a3b8"; closeBtn.style.background = "none"; };
    closeBtn.onclick = () => { card.style.display = "none"; };

    const cardBody = document.createElement("div");
    card.appendChild(closeBtn);
    card.appendChild(cardBody);

    // Button row
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;align-items:center;";

    const runBtn = document.createElement("button");
    runBtn.textContent = "▶ Run & Export";
    runBtn.style.cssText = "border:none;border-radius:20px;padding:10px 18px;cursor:pointer;font:600 12px -apple-system,sans-serif;color:#fff;background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 3px 12px rgba(16,185,129,.3);transition:transform .1s,box-shadow .1s;";
    runBtn.onmouseenter = () => { runBtn.style.transform = "scale(1.03)"; runBtn.style.boxShadow = "0 4px 16px rgba(16,185,129,.4)"; };
    runBtn.onmouseleave = () => { runBtn.style.transform = "scale(1)"; runBtn.style.boxShadow = "0 3px 12px rgba(16,185,129,.3)"; };

    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = "⬇ Download CSV";
    downloadBtn.style.cssText = "display:none;border:none;border-radius:20px;padding:10px 18px;cursor:pointer;font:600 12px -apple-system,sans-serif;color:#fff;background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 3px 12px rgba(37,99,235,.3);transition:transform .1s,box-shadow .1s;";
    downloadBtn.onmouseenter = () => { downloadBtn.style.transform = "scale(1.03)"; downloadBtn.style.boxShadow = "0 4px 16px rgba(37,99,235,.4)"; };
    downloadBtn.onmouseleave = () => { downloadBtn.style.transform = "scale(1)"; downloadBtn.style.boxShadow = "0 3px 12px rgba(37,99,235,.3)"; };

    btnRow.appendChild(runBtn);
    btnRow.appendChild(downloadBtn);

    var _lastResult = null;
    var _savedSelection = "";
    // Continuously track the latest selection from ANYWHERE on the page.
    // This means: highlight SQL → click our button (even after switching tabs).
    document.addEventListener("selectionchange", function () {
      var sel = window.getSelection();
      var txt = sel ? sel.toString().trim() : "";
      if (txt.length > 5) _savedSelection = txt;
    });
    // Also capture on mousedown on our button (backup)
    document.addEventListener("mousedown", function (e) {
      if (wrap.contains(e.target)) {
        var sel = window.getSelection();
        var txt = sel ? sel.toString().trim() : "";
        if (txt.length > 5) _savedSelection = txt;
      }
    }, true);

    function normalizeSql(raw) {
      // Only fix the specific pattern where SF's editor DOM collapses lines:
      // e.g. "__dlmFROM" or "__cWHERE" — an identifier suffix glued to a major keyword.
      // We do NOT broadly rewrite SQL — that breaks things like APPROX_COUNT_DISTINCT.
      return (raw || "")
        .replace(/(__)([a-z]{1,3})(SELECT|FROM|WHERE|GROUP|ORDER|HAVING|JOIN|LIMIT|OFFSET|AND|OR|ON|UNION)\b/gi, "$1$2 $3")
        .replace(/;\s*$/, "").trim();
    }

    function extractTableName(sql) {
      var m = sql.match(/\bFROM\s+([A-Za-z0-9_"]+)/i);
      if (!m) return "query-results";
      var raw = m[1].replace(/"/g, "");
      // TDI_Quote__dlm → Quote, TDI_TDI_GI_Unified__dlm → GI_Unified, RH_Profile__dll → Profile
      var cleaned = raw
        .replace(/__dlm$|__dll$/i, "")
        .replace(/^[A-Z0-9]{2,6}_/, "");
      // If doubled prefix (TDI_TDI_...), strip the second one too
      if (/^[A-Z0-9]{2,6}_/.test(cleaned) && raw.indexOf(cleaned) > 0) {
        cleaned = cleaned.replace(/^[A-Z0-9]{2,6}_/, "");
      }
      return cleaned || raw;
    }

    function todayStr() {
      var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    }

    function showGuide() {
      card.style.display = "block";
      var maxRows = "500K";
      var modeNote = extBridgePresent() ? "" : "<br><span style='color:#94a3b8;font-size:10px;'>Bookmarklet mode — fetches in batches of 49,999 rows.</span>";
      cardBody.innerHTML = ""
        + "<div style='font:600 14px -apple-system,sans-serif;margin-bottom:8px;'>Select your query</div>"
        + "<div style='color:#475569;font-size:12px;line-height:1.7;'>"
        + "Highlight the SQL in the editor, then click <b>Run & Export</b>.<br><br>"
        + "<span style='color:#64748b;font-size:11px;'>The tool will run your query (up to " + maxRows + " rows) and download the results as CSV.</span>"
        + modeNote
        + "</div>";
    }

    function validateSql(raw) {
      if (!raw || raw.trim().length < 6) return { ok: false, msg: "Selection is too short to be a valid query." };
      // Strip comments before validating
      var stripped = raw.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!stripped || stripped.length < 6) return { ok: false, msg: "Your selection contains only comments — select the SQL query itself." };
      if (!/\bSELECT\b/i.test(stripped)) return { ok: false, msg: "No SELECT found. Make sure you highlight a complete query starting with SELECT." };
      if (!/\bFROM\b/i.test(stripped)) return { ok: false, msg: "No FROM clause found. Highlight a complete query (SELECT ... FROM ...)." };
      var selectCount = (stripped.match(/\bSELECT\b/gi) || []).length;
      var fromCount = (stripped.match(/\bFROM\b/gi) || []).length;
      // Allow subqueries (SELECT in SELECT) but warn if it looks like 2 separate queries
      if (selectCount > fromCount + 1) return { ok: false, msg: "Looks like multiple queries are selected. Highlight just one query." };
      return { ok: true };
    }

    runBtn.onclick = () => {
      // Try multiple sources for the highlighted SQL (order: most specific → broadest).
      // KEY PROBLEM: clicking our button CLEARS the window selection (focus moves away).
      // So we rely on: (a) _savedSelection from selectionchange, (b) _lastSqlEditor content,
      // (c) readQueryEditorSql() which handles all edge cases including shadow DOM.
      var highlighted = "";
      // 1) Saved selection (captured BEFORE button click cleared it)
      if (_savedSelection && _savedSelection.length > 10 && /select|from/i.test(_savedSelection)) {
        highlighted = _savedSelection;
      }
      // 2) readQueryEditorSql — handles textarea, contenteditable, shadow DOM, multi-tab
      if (!highlighted || highlighted.length <= 10) {
        var qeResult = (typeof readQueryEditorSql === "function") ? readQueryEditorSql() : null;
        if (qeResult) {
          // Prefer selected text; if nothing selected, use full content (Cmd+A then click = full)
          highlighted = qeResult.selected || qeResult.full || "";
        }
      }
      // 3) _lastSqlEditor — if user did Cmd+A, selection might be cleared but content is there
      if ((!highlighted || highlighted.length <= 10) && _lastSqlEditor) {
        var le = _lastSqlEditor;
        if (le.tagName === "TEXTAREA" && le.value && le.value.trim().length > 10) {
          if (le.selectionStart !== le.selectionEnd) {
            highlighted = le.value.substring(le.selectionStart, le.selectionEnd).trim();
          } else {
            highlighted = le.value.trim();
          }
        } else if (le.getAttribute && le.getAttribute("contenteditable") === "true" && le.innerText && le.innerText.trim().length > 10) {
          highlighted = le.innerText.trim();
        }
      }
      // 4) Current window selection (unlikely to work after button click, but try)
      if (!highlighted || highlighted.length <= 10) {
        var sel = window.getSelection();
        highlighted = (sel && sel.toString().trim().length > 10) ? sel.toString().trim() : "";
      }
      _savedSelection = "";
      var sql;
      if (highlighted && highlighted.length > 10 && /select|from/i.test(highlighted)) {
        sql = highlighted;
      } else {
        showGuide();
        return;
      }
      // Validate before normalizing
      var check = validateSql(sql);
      if (!check.ok) {
        card.style.display = "block";
        cardBody.innerHTML = ""
          + "<div style='display:flex;align-items:center;gap:8px;margin-bottom:8px;'>"
          + "<div style='width:8px;height:8px;border-radius:50%;background:#f59e0b;'></div>"
          + "<span style='font:600 13px -apple-system,sans-serif;color:#92400e;'>Check your selection</span></div>"
          + "<div style='font-size:12px;color:#475569;line-height:1.6;margin-bottom:10px;'>" + check.msg + "</div>"
          + "<div style='font-size:11px;color:#64748b;background:#fffbeb;border-radius:6px;padding:8px;line-height:1.5;'>"
          + "<b>Tip:</b> Select only the query text — from SELECT through the end of the statement. Avoid selecting line numbers, comments, or multiple queries.</div>";
        return;
      }
      sql = normalizeSql(sql);
      if (!sql || sql.length < 6) { showGuide(); return; }

      var tableName = extractTableName(sql);
      var preview = sql.length > 120 ? sql.substring(0, 120) + "…" : sql;

      var ds = readPageDataSpace();
      if (!ds) {
        var fromMatch = sql.match(/\bFROM\s+([A-Za-z0-9_"]+)/i);
        var tableInSql = fromMatch ? fromMatch[1].replace(/"/g, "") : "";
        var dsCandidates = (typeof dataSpaceCandidates === "function") ? dataSpaceCandidates(tableInSql) : [""];
        ds = dsCandidates[0] || "";
      }

      runBtn.disabled = true; runBtn.innerHTML = "<span style='display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:dc-spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;'></span>Running…";
      if (!document.getElementById("dc-spin-style")) { var ss = document.createElement("style"); ss.id = "dc-spin-style"; ss.textContent = "@keyframes dc-spin{to{transform:rotate(360deg)}}"; document.head.appendChild(ss); }
      downloadBtn.style.display = "none";
      card.style.display = "block";
      cardBody.innerHTML = ""
        + "<div style='display:flex;align-items:center;gap:8px;margin-bottom:8px;'>"
        + "<div style='width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:dcpulse 1s infinite;'></div>"
        + "<span style='font:600 13px -apple-system,sans-serif;'>Running query…</span></div>"
        + "<div style='color:#64748b;font-size:11px;background:#f8fafc;border-radius:6px;padding:8px;font-family:monospace;word-break:break-all;max-height:60px;overflow:hidden;'>" + preview.replace(/</g,"&lt;") + "</div>"
        + "<style>@keyframes dcpulse{0%,100%{opacity:1}50%{opacity:.3}}</style>";

      ensureQueryContext(function (ready) {
        if (!ready) {
          runBtn.disabled = false; runBtn.textContent = "▶ Run & Export";
          cardBody.innerHTML = ""
            + "<div style='display:flex;align-items:center;gap:8px;margin-bottom:8px;'>"
            + "<div style='width:8px;height:8px;border-radius:50%;background:#f59e0b;'></div>"
            + "<span style='font:600 13px -apple-system,sans-serif;color:#92400e;'>Session needed</span></div>"
            + "<div style='font-size:12px;color:#475569;line-height:1.6;margin-bottom:10px;'>"
            + "Click <b>Run Highlighted Query</b> in SF's editor first (to establish a session), then click our <b>Run & Export</b> again.</div>"
            + "<div style='font-size:11px;color:#64748b;background:#fffbeb;border-radius:6px;padding:8px;line-height:1.5;'>"
            + "The bookmarklet needs SF to fire one query so it can capture the session. After that, all exports work automatically.</div>";
          return;
        }
        var startTime = Date.now();
        exportPaginatedCsv(sql, ds, function (fetched, total) {
          var pctKnown = total > fetched;
          runBtn.textContent = pctKnown ? (fetched.toLocaleString() + " / " + total.toLocaleString() + " rows…") : (fetched.toLocaleString() + " rows fetched…");
          var pct = pctKnown ? Math.round(fetched / total * 100) : 0;
          var barHtml = pctKnown
            ? "<div style='margin:8px 0;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;'><div style='height:100%;background:linear-gradient(90deg,#10b981,#059669);width:" + pct + "%;transition:width .3s;'></div></div>"
            : "<div style='margin:8px 0;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden;'><div style='height:100%;background:linear-gradient(90deg,#10b981,#059669);width:100%;animation:dc-indeterminate 1.5s infinite;'></div></div>";
          var countHtml = pctKnown
            ? "<b>" + fetched.toLocaleString() + "</b> of <b>" + total.toLocaleString() + "</b> rows fetched"
            : "<b>" + fetched.toLocaleString() + "</b> rows fetched so far…";
          cardBody.innerHTML = ""
            + "<div style='display:flex;align-items:center;gap:8px;margin-bottom:8px;'>"
            + "<div style='width:8px;height:8px;border-radius:50%;background:#f59e0b;animation:dcpulse 1s infinite;'></div>"
            + "<span style='font:600 13px -apple-system,sans-serif;'>Fetching data…</span></div>"
            + barHtml
            + "<div style='color:#64748b;font-size:11px;'>" + countHtml + "</div>"
            + "<style>@keyframes dcpulse{0%,100%{opacity:1}50%{opacity:.3}}@keyframes dc-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}</style>";
        }).then(function (res) {
          var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          runBtn.disabled = false; runBtn.textContent = "▶ Run & Export";
          card.style.display = "block";
          if (res.totalRows === 0) {
            _lastResult = null;
            cardBody.innerHTML = ""
              + "<div style='display:flex;align-items:center;gap:8px;margin-bottom:8px;'>"
              + "<div style='width:8px;height:8px;border-radius:50%;background:#f59e0b;'></div>"
              + "<span style='font:600 14px -apple-system,sans-serif;color:#92400e;'>No results</span></div>"
              + "<div style='font-size:12px;color:#475569;line-height:1.6;'>Query returned <b>0 rows</b>. Nothing to export.<br>"
              + "<span style='color:#64748b;font-size:11px;'>Table: " + tableName + " | Space: " + (ds || "default") + " | Time: " + elapsed + "s</span></div>";
            downloadBtn.style.display = "none";
            return;
          }
          _lastResult = { blobUrl: res.blobUrl, filename: tableName + "_" + todayStr() + ".csv", rows: res.totalRows, cols: res.columns.length, columns: res.columns, tableName: tableName };
          var defaultFilename = tableName + "_" + todayStr() + ".csv";
          cardBody.innerHTML = ""
            + "<div style='display:flex;align-items:center;gap:8px;margin-bottom:10px;'>"
            + "<div style='width:8px;height:8px;border-radius:50%;background:#10b981;'></div>"
            + "<span style='font:600 14px -apple-system,sans-serif;'>Query complete</span></div>"
            + "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;'>"
            + "<div style='background:#f0fdf4;border-radius:8px;padding:8px 10px;text-align:center;'><div style='font:700 18px -apple-system,sans-serif;color:#059669;'>" + res.totalRows.toLocaleString() + "</div><div style='font-size:10px;color:#64748b;'>Rows</div></div>"
            + "<div style='background:#eff6ff;border-radius:8px;padding:8px 10px;text-align:center;'><div style='font:700 18px -apple-system,sans-serif;color:#2563eb;'>" + res.columns.length + "</div><div style='font-size:10px;color:#64748b;'>Columns</div></div>"
            + "</div>"
            + "<div style='font-size:11px;color:#475569;line-height:1.6;margin-bottom:10px;'>"
            + "<b>Table:</b> " + tableName + " &nbsp;|&nbsp; <b>Space:</b> " + (ds || "default") + " &nbsp;|&nbsp; <b>Time:</b> " + elapsed + "s"
            + "</div>"
            + "<div style='display:flex;align-items:center;gap:6px;'>"
            + "<label style='font:600 11px -apple-system,sans-serif;color:#475569;white-space:nowrap;'>Filename:</label>"
            + "<input id='dc-qe-filename' type='text' value='" + defaultFilename.replace(/'/g,"") + "' style='flex:1;padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;font:12px -apple-system,sans-serif;color:#1e293b;'/>"
            + "</div>";
          downloadBtn.style.display = "inline-block";
        }).catch(function (err) {
          runBtn.disabled = false; runBtn.textContent = "▶ Run & Export";
          card.style.display = "block";
          var errMsg = String(err && err.message || err);
          var hint = "";
          if (/denied authorization/i.test(errMsg)) hint = "<div style='margin-top:8px;font-size:11px;color:#92400e;background:#fffbeb;border-radius:6px;padding:8px;line-height:1.5;'><b>Likely cause:</b> Wrong dataspace detected. Run a query in SF's editor first so we can capture the correct dataspace from your session.</div>";
          else if (/session.*expired|INVALID_SESSION|invalidSession/i.test(errMsg)) hint = "<div style='margin-top:8px;font-size:11px;color:#92400e;background:#fffbeb;border-radius:6px;padding:8px;line-height:1.5;'><b>Fix:</b> Your Salesforce session expired. Refresh the page, log back in, then retry.</div>";
          else if (/timeout|bridge timeout/i.test(errMsg)) hint = "<div style='margin-top:8px;font-size:11px;color:#92400e;background:#fffbeb;border-radius:6px;padding:8px;line-height:1.5;'><b>Fix:</b> The request timed out. Check your connection and try again. For large queries, try a smaller row limit.</div>";
          else if (/not connected|not ready/i.test(errMsg)) hint = "<div style='margin-top:8px;font-size:11px;color:#92400e;background:#fffbeb;border-radius:6px;padding:8px;line-height:1.5;'><b>Fix:</b> Run any query in SF's editor first to establish a session, then try again.</div>";
          cardBody.innerHTML = "<div style='color:#dc2626;font:600 13px -apple-system,sans-serif;margin-bottom:6px;'>Query failed</div>"
            + "<div style='color:#64748b;font-size:11px;background:#fef2f2;border-radius:6px;padding:8px;word-break:break-all;line-height:1.5;'>" + errMsg.replace(/</g,"&lt;") + "</div>"
            + hint;
          downloadBtn.style.display = "none";
        });
      });
    };

    downloadBtn.onclick = () => {
      if (!_lastResult) return;
      var fnInput = document.getElementById("dc-qe-filename");
      var filename = (fnInput && fnInput.value.trim()) || _lastResult.filename;
      if (!filename.endsWith(".csv")) filename += ".csv";
      var a = document.createElement("a");
      a.href = _lastResult.blobUrl;
      a.download = filename;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(_lastResult.blobUrl); }, 10000);
      downloadBtn.textContent = "✓ Downloaded!";
      downloadBtn.style.background = "linear-gradient(135deg,#059669,#047857)";
      setTimeout(function () { downloadBtn.textContent = "⬇ Download CSV"; downloadBtn.style.background = "linear-gradient(135deg,#3b82f6,#2563eb)"; }, 2500);
    };

    // Drag handle on the button row
    var _dragMoved = false;
    btnRow.style.cursor = "grab";
    btnRow.addEventListener("pointerdown", function (e) {
      if (e.target === runBtn || e.target === downloadBtn) return;
      e.preventDefault();
      btnRow.style.cursor = "grabbing";
      var startX = e.clientX, startY = e.clientY;
      _dragMoved = false;
      var rect = wrap.getBoundingClientRect();
      var ox = rect.left, oy = rect.top;
      wrap.style.left = ox + "px"; wrap.style.top = oy + "px";
      wrap.style.right = "auto"; wrap.style.bottom = "auto";
      var mv = function (ev) {
        var dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!_dragMoved && Math.sqrt(dx*dx + dy*dy) > 4) _dragMoved = true;
        if (!_dragMoved) return;
        wrap.style.left = Math.max(0, Math.min(ox + dx, window.innerWidth - 60)) + "px";
        wrap.style.top = Math.max(0, Math.min(oy + dy, window.innerHeight - 60)) + "px";
      };
      var up = function () {
        btnRow.style.cursor = "grab";
        window.removeEventListener("pointermove", mv, true);
        window.removeEventListener("pointerup", up, true);
      };
      window.addEventListener("pointermove", mv, true);
      window.addEventListener("pointerup", up, true);
    }, true);

    wrap.appendChild(card); wrap.appendChild(btnRow);
    document.body.appendChild(wrap);
  }

  // ── Data Explore launcher (FAB) ───────────────────────────────────────────
  function ensureExploreLauncher() {
    // Begin passively capturing the page's own Data Cloud query credentials so the
    // "Show selected columns' data" query can reuse them (no dialog, no re-auth).
    try { installAuraSniffer(); } catch (e) {}
    // Proactively warm up credentials NOW (direct framework read, or one background
    // query) so the first click always works — no "sort a column first" hit-and-trial.
    try { warmUpQueryContext(); } catch (e) {}
    if (document.getElementById("dc-bar")) return;
    const wrap = document.createElement("div");
    wrap.id = "dc-bar";
    wrap.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none";

    const menu = document.createElement("div");
    menu.id = "dc-fab-menu";
    menu.style.cssText = "position:relative;width:220px;background:#111827;border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);overflow:hidden;padding:8px;pointer-events:none;transition:opacity .2s cubic-bezier(.34,1.56,.64,1),transform .2s cubic-bezier(.34,1.56,.64,1);opacity:0;transform:translateY(12px) scale(.95);";
    menu.setAttribute("aria-hidden", "true");

    const colIconSvg    = "<svg width='14' height='14' viewBox='0 0 16 16' fill='white'><rect x='1' y='1' width='4' height='14' rx='1'/><rect x='6' y='1' width='4' height='14' rx='1'/><rect x='11' y='1' width='4' height='14' rx='1'/></svg>";
    const exportIconSvg = "<svg width='14' height='14' viewBox='0 0 16 16' fill='white'><path d='M8 1v9M4 6l4 4 4-4'/><rect x='2' y='13' width='12' height='2' rx='1'/></svg>";

    const mkBtn = (id, label, title, iconGrad, iconSvg, subtitle) => {
      const b = document.createElement("button");
      b.id = id;
      b.title = title;
      b.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:10px;cursor:pointer;border:none;background:#111827;color:#fff;text-align:left;transition:background .12s;";
      b.onmouseenter = () => { b.style.background = "rgba(255,255,255,.07)"; };
      b.onmouseleave = () => { b.style.background = "#111827"; };
      const iconBox = "<div style='flex-shrink:0;width:32px;height:32px;border-radius:10px;background:" + iconGrad + ";display:flex;align-items:center;justify-content:center;'>" + iconSvg + "</div>";
      const textCol = "<div style='display:flex;flex-direction:column;gap:1px;'><span style='font:600 13px/1.2 -apple-system,sans-serif;color:#fff;'>" + label + "</span><span style='font:400 11px/1.3 -apple-system,sans-serif;color:#94a3b8;'>" + subtitle + "</span></div>";
      b.innerHTML = iconBox + textCol;
      return b;
    };

    const colBtn    = mkBtn("dc-explore-cols-btn",   "Columns",    "Select and save columns",   "linear-gradient(135deg,#6366f1,#4f46e5)", colIconSvg,    "Pick & reorder fields");
    const exportBtn = mkBtn("dc-explore-export-btn", "Export CSV", "Export visible rows to CSV", "linear-gradient(135deg,#10b981,#059669)", exportIconSvg, "Download visible rows");

    const separator = document.createElement("div");
    separator.style.cssText = "height:1px;background:rgba(255,255,255,.08);margin:4px 0;";

    const dismissRow = document.createElement("button");
    dismissRow.title = "Remove Data 360 Inspector";
    dismissRow.innerHTML = "<span style='font:500 12px/1 -apple-system,sans-serif;color:#ef4444;display:flex;align-items:center;gap:6px;padding:2px 0;'><span style='font-size:14px;line-height:1;'>×</span>Remove</span>";
    dismissRow.style.cssText = "display:flex;align-items:center;width:100%;padding:8px 10px;border-radius:10px;cursor:pointer;border:none;background:#111827;transition:background .12s;";
    dismissRow.onmouseenter = () => (dismissRow.style.background = "rgba(239,68,68,.08)");
    dismissRow.onmouseleave = () => (dismissRow.style.background = "#111827");
    dismissRow.onclick = (e) => { e.stopPropagation(); teardown(); };

    colBtn.onclick    = (e) => { e.stopPropagation(); openExploreModal(); };
    exportBtn.onclick = (e) => { e.stopPropagation(); const rl = findRecordListEl(); if (rl) exportExploreCsv(rl); };

    menu.appendChild(colBtn);
    menu.appendChild(exportBtn);
    menu.appendChild(separator);
    menu.appendChild(dismissRow);

    const fab = document.createElement("button");
    fab.id = "dc-fab";
    fab.title = "Data 360 Inspector";
    fab.innerHTML = "<svg width='22' height='22' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='10' stroke='#fff' stroke-width='1.5'/><circle cx='12' cy='4' r='1.2' fill='#fff'/><circle cx='17.7' cy='6.3' r='1.2' fill='#fff'/><circle cx='20' cy='12' r='1.2' fill='#fff'/><circle cx='17.7' cy='17.7' r='1.2' fill='#fff'/><circle cx='12' cy='20' r='1.2' fill='#fff'/><circle cx='6.3' cy='17.7' r='1.2' fill='#fff'/><circle cx='4' cy='12' r='1.2' fill='#fff'/><circle cx='6.3' cy='6.3' r='1.2' fill='#fff'/><circle cx='12' cy='9.5' r='2.5' fill='#fff'/><path d='M8 16.5c0-2.2 1.8-4 4-4s4 1.8 4 4' stroke='#fff' stroke-width='1.5' stroke-linecap='round'/></svg>";
    fab.style.cssText = "width:44px;height:44px;border-radius:50%;border:none;cursor:pointer;pointer-events:auto;background:linear-gradient(135deg,#2d2b55 0%,#5b4f9e 100%);box-shadow:0 4px 18px rgba(91,79,158,.5);display:flex;align-items:center;justify-content:center;transition:box-shadow .15s,transform .12s;flex-shrink:0;";
    fab.onmouseenter = () => { fab.style.boxShadow = "0 6px 24px rgba(91,79,158,.65)"; fab.style.transform = "scale(1.07)"; };
    fab.onmouseleave = () => { fab.style.boxShadow = "0 4px 18px rgba(91,79,158,.5)"; fab.style.transform = "scale(1)"; };

    let menuOpen = false;
    const openMenu = () => { menuOpen = true; menu.style.opacity = "1"; menu.style.transform = "translateY(0) scale(1)"; menu.setAttribute("aria-hidden", "false"); menu.style.pointerEvents = "auto"; };
    const closeMenu = () => { menuOpen = false; menu.style.opacity = "0"; menu.style.transform = "translateY(12px) scale(.95)"; menu.setAttribute("aria-hidden", "true"); menu.style.pointerEvents = "none"; };
    fab.onclick = (e) => { e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); };
    document.addEventListener("pointerdown", (e) => { if (menuOpen && !wrap.contains(e.target)) closeMenu(); }, true);

    let fabDragMoved = false;
    fab.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      fabDragMoved = false;
      const r0 = wrap.getBoundingClientRect();
      let ox = r0.left, oy = r0.top;
      const mv = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!fabDragMoved && Math.sqrt(dx*dx+dy*dy) > 5) {
          fabDragMoved = true; fab.releasePointerCapture(e.pointerId);
          wrap.style.right = "auto"; wrap.style.bottom = "auto";
          wrap.style.left = ox + "px"; wrap.style.top = oy + "px";
        }
        if (!fabDragMoved) return;
        wrap.style.left = Math.max(4, Math.min(ox+dx, window.innerWidth-54)) + "px";
        wrap.style.top  = Math.max(4, Math.min(oy+dy, window.innerHeight-54)) + "px";
      };
      const up = () => { window.removeEventListener("pointermove", mv, true); window.removeEventListener("pointerup", up, true); if (fabDragMoved) setTimeout(() => { fabDragMoved = false; }, 10); };
      window.addEventListener("pointermove", mv, true);
      window.addEventListener("pointerup", up, true);
    }, true);
    fab.addEventListener("click", (e) => { if (fabDragMoved) { e.stopImmediatePropagation(); fabDragMoved = false; } }, true);

    wrap.appendChild(menu);
    wrap.appendChild(fab);
    addFabResizeGuard(wrap);
    document.body.appendChild(wrap);

    watchExploreObjectChange();
  }
  /* @strip:end */

  // In the public build the Data Explorer / Segment code is stripped, so guard the
  // calls with typeof. detectDetailPageType() never returns "Segment" there either.
  // PRIORITY: Segment before DataExplore (segment pages may contain record-list components).
  const onTransformPage = (typeof isTransformPage === "function") && isTransformPage();
  const onQueryEditorPage = (typeof isQueryEditorPage === "function") && isQueryEditorPage();
  const onSegmentPage = detectDetailPageType() === "Segment";
  const detailPageType = onTransformPage ? "Transform"
    : onQueryEditorPage ? "QueryEditor"
    : onSegmentPage ? "Segment"
    : ((typeof isDataExplorePage === "function" && isDataExplorePage()) ? "DataExplore" : detectDetailPageType());
  if (detailPageType === "Transform" && typeof ensureTransformLauncher === "function") {
    ensureTransformLauncher();
  } else if (detailPageType === "QueryEditor" && typeof ensureQueryEditorLauncher === "function") {
    ensureQueryEditorLauncher();
    watchNavigation();
  } else if (detailPageType === "DataExplore" && typeof ensureExploreLauncher === "function") {
    ensureExploreLauncher();
    watchNavigation();
  } else if (detailPageType && detailPageType !== "DataExplore") {
    function ensureDetailLauncher() {
      if (document.getElementById("dc-bar")) return;
      const wrap = document.createElement("div");
      wrap.id = "dc-bar";
      wrap.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none";

      const menu = document.createElement("div");
      menu.id = "dc-fab-menu";
      menu.style.cssText = "position:relative;width:220px;background:#111827;border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);overflow:hidden;padding:8px;pointer-events:none;transition:opacity .2s cubic-bezier(.34,1.56,.64,1),transform .2s cubic-bezier(.34,1.56,.64,1);opacity:0;transform:translateY(12px) scale(.95);";
      menu.setAttribute("aria-hidden", "true");

      const exportIconSvg = "<svg width='14' height='14' viewBox='0 0 16 16' fill='white'><path d='M8 1v9M4 6l4 4 4-4'/><rect x='2' y='13' width='12' height='2' rx='1'/></svg>";
      const segIconSvg    = "<svg width='14' height='14' viewBox='0 0 16 16' fill='white'><rect x='1' y='1' width='6' height='6' rx='1'/><rect x='9' y='1' width='6' height='6' rx='1'/><rect x='1' y='9' width='6' height='6' rx='1'/><path d='M9 12h6M12 9v6'/></svg>";

      const mkBtn = (id, label, title, iconGrad, iconSvg, subtitle) => {
        const b = document.createElement("button");
        b.id = id;
        b.title = title;
        b.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:10px;cursor:pointer;border:none;background:#111827;color:#fff;text-align:left;transition:background .12s;";
        b.onmouseenter = () => { b.style.background = "rgba(255,255,255,.07)"; };
        b.onmouseleave = () => { b.style.background = "#111827"; };
        const iconBox = "<div style='flex-shrink:0;width:32px;height:32px;border-radius:10px;background:" + iconGrad + ";display:flex;align-items:center;justify-content:center;'>" + iconSvg + "</div>";
        const textCol = "<div style='display:flex;flex-direction:column;gap:1px;'><span style='font:600 13px/1.2 -apple-system,sans-serif;color:#fff;'>" + label + "</span><span style='font:400 11px/1.3 -apple-system,sans-serif;color:#94a3b8;'>" + subtitle + "</span></div>";
        b.innerHTML = iconBox + textCol;
        return b;
      };

      const isSegment = detailPageType === "Segment";
      const btnIconSvg   = isSegment ? segIconSvg : exportIconSvg;
      const btnGrad      = isSegment ? "linear-gradient(135deg,#8b5cf6,#7c3aed)" : "linear-gradient(135deg,#f59e0b,#d97706)";
      const btnLabel     = isSegment ? "Export Rules" : "Export Fields";
      const btnSubtitle  = isSegment ? "All segment conditions" : "All fields with types";

      const dl = mkBtn("dc-detail-btn", btnLabel, btnLabel, btnGrad, btnIconSvg, btnSubtitle);
      dl.onclick = (e) => { e.stopPropagation(); if (detailPageType === "DataStream") openDsExport(); else if (detailPageType === "DLO") openDloExport(); else if (detailPageType === "Segment" && typeof openSegmentExport === "function") openSegmentExport(); else openDmoExport(); };

      const separator = document.createElement("div");
      separator.style.cssText = "height:1px;background:rgba(255,255,255,.08);margin:4px 0;";

      const dismissRow = document.createElement("button");
      dismissRow.title = "Remove Data 360 Inspector";
      dismissRow.innerHTML = "<span style='font:500 12px/1 -apple-system,sans-serif;color:#ef4444;display:flex;align-items:center;gap:6px;padding:2px 0;'><span style='font-size:14px;line-height:1;'>×</span>Remove</span>";
      dismissRow.style.cssText = "display:flex;align-items:center;width:100%;padding:8px 10px;border-radius:10px;cursor:pointer;border:none;background:#111827;transition:background .12s;";
      dismissRow.onmouseenter = () => (dismissRow.style.background = "rgba(239,68,68,.08)");
      dismissRow.onmouseleave = () => (dismissRow.style.background = "#111827");
      dismissRow.onclick = (e) => { e.stopPropagation(); teardown(); };

      menu.appendChild(dl);
      menu.appendChild(separator);
      menu.appendChild(dismissRow);

      const fab = document.createElement("button");
      fab.id = "dc-fab";
      fab.title = "Data 360 Inspector";
      fab.innerHTML = "<svg width='22' height='22' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='10' stroke='#fff' stroke-width='1.5'/><circle cx='12' cy='4' r='1.2' fill='#fff'/><circle cx='17.7' cy='6.3' r='1.2' fill='#fff'/><circle cx='20' cy='12' r='1.2' fill='#fff'/><circle cx='17.7' cy='17.7' r='1.2' fill='#fff'/><circle cx='12' cy='20' r='1.2' fill='#fff'/><circle cx='6.3' cy='17.7' r='1.2' fill='#fff'/><circle cx='4' cy='12' r='1.2' fill='#fff'/><circle cx='6.3' cy='6.3' r='1.2' fill='#fff'/><circle cx='12' cy='9.5' r='2.5' fill='#fff'/><path d='M8 16.5c0-2.2 1.8-4 4-4s4 1.8 4 4' stroke='#fff' stroke-width='1.5' stroke-linecap='round'/></svg>";
      fab.style.cssText = "width:44px;height:44px;border-radius:50%;border:none;cursor:pointer;pointer-events:auto;background:linear-gradient(135deg,#2d2b55 0%,#5b4f9e 100%);box-shadow:0 4px 18px rgba(91,79,158,.5);display:flex;align-items:center;justify-content:center;transition:box-shadow .15s,transform .12s;flex-shrink:0;";
      fab.onmouseenter = () => { fab.style.boxShadow = "0 6px 24px rgba(91,79,158,.65)"; fab.style.transform = "scale(1.07)"; };
      fab.onmouseleave = () => { fab.style.boxShadow = "0 4px 18px rgba(91,79,158,.5)"; fab.style.transform = "scale(1)"; };

      let menuOpen = false;
      const openMenu = () => {
        menuOpen = true;
        menu.style.opacity = "1";
        menu.style.transform = "translateY(0) scale(1)";
        menu.setAttribute("aria-hidden", "false");
        menu.style.pointerEvents = "auto";
      };
      const closeMenu = () => {
        menuOpen = false;
        menu.style.opacity = "0";
        menu.style.transform = "translateY(12px) scale(.95)";
        menu.setAttribute("aria-hidden", "true");
        menu.style.pointerEvents = "none";
      };
      fab.onclick = (e) => { e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); };
      document.addEventListener("pointerdown", (e) => {
        if (menuOpen && !wrap.contains(e.target)) closeMenu();
      }, true);

      let fabDragMoved = false;
      fab.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        const startX = e.clientX, startY = e.clientY;
        fabDragMoved = false;
        const r0 = wrap.getBoundingClientRect();
        let ox = r0.left, oy = r0.top;
        const mv = (ev) => {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (!fabDragMoved && Math.sqrt(dx*dx+dy*dy) > 5) {
            fabDragMoved = true; fab.releasePointerCapture(e.pointerId);
            wrap.style.right = "auto"; wrap.style.bottom = "auto";
            wrap.style.left = ox + "px"; wrap.style.top = oy + "px";
          }
          if (!fabDragMoved) return;
          let nx = Math.max(4, Math.min(ox + dx, window.innerWidth  - 54));
          let ny = Math.max(4, Math.min(oy + dy, window.innerHeight - 54));
          wrap.style.left = nx + "px"; wrap.style.top = ny + "px";
        };
        const up = () => {
          window.removeEventListener("pointermove", mv, true);
          window.removeEventListener("pointerup",   up, true);
          if (fabDragMoved) { setTimeout(() => { fabDragMoved = false; }, 10); }
        };
        window.addEventListener("pointermove", mv, true);
        window.addEventListener("pointerup",   up, true);
      }, true);
      fab.addEventListener("click", (e) => { if (fabDragMoved) { e.stopImmediatePropagation(); fabDragMoved = false; } }, true);

      wrap.appendChild(menu);
      wrap.appendChild(fab);
      addFabResizeGuard(wrap);
      document.body.appendChild(wrap);
    }
    ensureDetailLauncher();
    watchNavigation();
  } else {
    // Only show the mapping launcher if the mapping canvas component is actually on this page.
    // On unsupported pages, show a brief toast telling the user which pages work.
    var hasMappingCanvas = findByTag(TAGGING_CMP).length > 0;
    if (hasMappingCanvas) {
      ensureLauncher();
      updateBadge();
      watchNavigation();
    } else {
      var toast = document.createElement("div");
      toast.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#111827;color:#fff;font:500 13px/1.4 -apple-system,sans-serif;padding:14px 20px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.4);max-width:320px;opacity:0;transition:opacity .3s;";
      toast.innerHTML = "<div style='display:flex;align-items:flex-start;gap:10px;'>" +
        "<span style='font-size:18px;line-height:1;'>&#9432;</span>" +
        "<div><strong style='display:block;margin-bottom:4px;'>Data 360 Inspector</strong>" +
        "<span style='color:#94a3b8;font-size:12px;line-height:1.5;'>This page is not supported. Works on:<br>" +
        "• DLO → DMO Mapping canvas<br>" +
        "• Data Stream / DLO / DMO detail<br>" +
        "• Data Explorer<br>" +
        "• Query Editor<br>" +
        "• Segment builder</span></div></div>";
      document.body.appendChild(toast);
      requestAnimationFrame(function () { toast.style.opacity = "1"; });
      setTimeout(function () { toast.style.opacity = "0"; setTimeout(function () { try { toast.remove(); } catch (e) {} }, 400); }, 6000);
    }
  }
})();
