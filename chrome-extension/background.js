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
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({
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
// removing any previous version first (matched by name prefix).

const BOOKMARK_NAME = "Data 360 Inspector";

async function installBookmarklet() {
  try {
    // Load the bookmarklet URL from the bundled file
    const url = chrome.runtime.getURL("bookmarklet.txt");
    const resp = await fetch(url);
    const bmUrl = (await resp.text()).trim();
    if (!bmUrl.startsWith("javascript:")) return;

    // Get the bookmarks bar node (id "1" in Chrome)
    const [bar] = await chrome.bookmarks.getChildren("1");
    const barId = "1";
    const existing = await chrome.bookmarks.getChildren(barId);

    // Remove any old versions with the same name
    for (const bm of existing) {
      if (bm.title === BOOKMARK_NAME) {
        await chrome.bookmarks.remove(bm.id);
      }
    }

    // Insert at position 0 (front of bookmarks bar)
    await chrome.bookmarks.create({
      parentId: barId,
      index: 0,
      title: BOOKMARK_NAME,
      url: bmUrl,
    });

    console.log("[DC-MI] Bookmarklet installed at position 0 on bookmarks bar.");
  } catch (e) {
    console.warn("[DC-MI] Could not auto-install bookmarklet:", e && e.message);
  }
}

chrome.runtime.onInstalled.addListener(installBookmarklet);
