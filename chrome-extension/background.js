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

// ── Auto-install bookmarklet on install or update ─────────────────────────
// Adds "Data 360 Inspector" bookmark to position 0 on the bookmarks bar,
// removing any previous version first (matched by name). Best-effort: some
// browsers/policies block programmatic javascript: bookmarks — if so this
// degrades quietly and the core toolbar-click feature is unaffected.

const BOOKMARK_NAME = "Data 360 Inspector";

// Find the bookmarks-toolbar node id in a browser-agnostic way.
async function findBookmarksBarId() {
  // Chrome: bar is id "1". Firefox: id "toolbar_____". Discover from the tree
  // by locating a folder whose title looks like the bookmarks toolbar.
  try {
    const tree = await api.bookmarks.getTree();
    let found = null;
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (found) return;
        const t = (n.title || "").toLowerCase();
        if (!n.url && (n.id === "1" || n.id === "toolbar_____" || /bookmarks (bar|toolbar)|favorites bar/.test(t))) {
          found = n.id; return;
        }
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    if (found) return found;
    // Fallback: first child folder of the root (usually the bar).
    const root = tree && tree[0];
    const firstFolder = root && (root.children || []).find((c) => !c.url);
    return firstFolder ? firstFolder.id : "1";
  } catch (e) {
    return "1";
  }
}

async function installBookmarklet() {
  try {
    if (!api.bookmarks) return;                 // permission not granted on this browser
    const url = api.runtime.getURL("bookmarklet.txt");
    const resp = await fetch(url);
    const bmUrl = (await resp.text()).trim();
    if (!bmUrl.startsWith("javascript:")) return;

    const barId = await findBookmarksBarId();
    const existing = await api.bookmarks.getChildren(barId);

    // Remove any old versions with the same name
    for (const bm of existing) {
      if (bm.title === BOOKMARK_NAME) {
        try { await api.bookmarks.remove(bm.id); } catch (e) {}
      }
    }

    await api.bookmarks.create({ parentId: barId, index: 0, title: BOOKMARK_NAME, url: bmUrl });
    console.log("[DC-MI] Bookmarklet installed on bookmarks bar (" + barId + ").");
  } catch (e) {
    console.warn("[DC-MI] Could not auto-install bookmarklet:", e && e.message);
  }
}

api.runtime.onInstalled.addListener(installBookmarklet);
