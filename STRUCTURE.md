# Data 360 Inspector — Project Structure & Build Guide

This folder (`~/datacloud-mapping-inspector`) is the **private build workshop** for the
Data 360 Inspector. You edit ONE source file, run ONE build command, and it regenerates
every shareable artifact. This doc explains what each file is, how the build works, and
— critically — **what may and may not be published**.

---

## 1. The single source of truth

| File | Role |
|---|---|
| **`console-decorate.js`** | **The only file you edit.** ~434 KB. Contains ALL features. In-development features (Data Explorer, Segment export) are wrapped in `/* @strip:start dev */ … /* @strip:end */` markers so the build can physically remove them from the public version. |
| **`build.js`** | The build pipeline. Run `node build.js` after every edit. |

Everything else in the top level is **generated** by `build.js` — never edit generated
files by hand (they'll be overwritten).

---

## 2. Two builds from one source (PUBLIC vs FULL)

`build.js` produces **two** variants:

### PUBLIC build — safe to publish
Data Explorer + Segment code is **physically stripped** (via the `@strip` markers).
Contains only: mapping (API Tooltip / Pin / Export), Data Stream, DLO, DMO exports.
- `install.html` — the drag-to-install page → **this is what goes to GitHub Pages as `index.html`**
- `console-decorate.min.js` — obfuscated paste version
- `bookmarklet.txt` — obfuscated `javascript:` one-liner

### FULL build — LOCAL ONLY, never publish
Everything, including in-development Data Explorer + Segment. **You** drag from this.
- `install-full.html`
- `Data360-Inspector-FULL-internal.html`  ← the page you personally drag the bookmarklet from
- `console-decorate-full.min.js`
- `bookmarklet-full.txt`

> These FULL files are in `.gitignore` so they can't be accidentally committed/leaked.

---

## 3. ⚠️ PUBLISHING RULE (read before pushing anything public)

**Only the PUBLIC build ships. Data Explorer + Segment stay local until they're fully
done and approved.** Confirmed policy (2026-07-31):

- The live site `https://ljoshi30.github.io/datacloud-inspector/` must only ever contain
  the **stripped** `install.html` (renamed `index.html`) — mapping + Data Stream + DLO + DMO.
- **Do NOT push** Data Explorer or Segment features publicly while in development.
- `build.js` enforces the strip at build time and asserts no in-dev symbols
  (`openSegmentExport`, `ensureExploreLauncher`, `openExploreModal`, `readSegmentRules`)
  survive in the public payload — it aborts if they do.

**This local folder is NOT connected to GitHub.** It has no git remote. Publishing is a
separate, manual step into the standalone `ljoshi30/datacloud-inspector` Pages repo.

### How to publish the PUBLIC build (when ready)
```bash
# 1. Rebuild
cd ~/datacloud-mapping-inspector && node build.js

# 2. Get install.html into the PUBLIC Pages repo as index.html.
#    (Clone it once if you don't have it locally:)
#    git clone https://github.com/ljoshi30/datacloud-inspector.git ~/datacloud-inspector-pages
cp install.html ~/datacloud-inspector-pages/index.html
cp console-decorate.min.js bookmarklet.txt ~/datacloud-inspector-pages/   # optional extras

# 3. Commit + push from the Pages repo
cd ~/datacloud-inspector-pages
git add index.html console-decorate.min.js bookmarklet.txt
git commit -m "Update public build"
git push
```
GitHub Pages then serves the new `index.html` within a minute or two.

---

## 4. The extensions (Chrome + Firefox — auto-updating vehicle)

The extension is the only path that auto-updates without re-dragging. It carries the
**FULL** build (includes in-dev Explorer + Segment) — it's the private dev/internal
vehicle, unlike the stripped public `install.html`.

`chrome-extension/` is the **source of truth** for the shared extension files.
`firefox-extension/` is **GENERATED** from it by `build.js` (gitignored; regenerate any
time with `node build.js`).

| File | Role |
|---|---|
| `chrome-extension/inject.js` | **= the FULL source** (`console-decorate.js`), rewritten every build. |
| `chrome-extension/background.js` | **Cross-browser** (aliases `chrome`/`browser` → `api`). Toolbar-click → inject into MAIN world; auto-installs the bookmarklet on install/update (bookmarks-bar id discovered dynamically for FF). |
| `chrome-extension/manifest.json` | Chrome MV3 (`background.service_worker`). Version auto-bumps (patch) on code change. |
| `chrome-extension/.buildid` | Build-state stamp (hash of code) so the version bumps ONLY when code changed. Gitignored. |
| `firefox-extension/manifest.json` | Generated Firefox MV3: `background.scripts` + `browser_specific_settings.gecko` (`strict_min_version 128.0`). Same version as Chrome. |
| `firefox-extension/{inject,background,bookmarklet}.js/.txt + icons/` | Copied verbatim from chrome-extension each build. |

**Why two manifests:** Firefox MV3 needs `background.scripts` (not `service_worker`), a
gecko id, and — because the tool requires `world:"MAIN"` injection — **Firefox 128+**
(`strict_min_version`). The shared `background.js` handles the `chrome`/`browser` API
namespace difference at runtime.

**Version bump:** `build.js` bumps the manifest patch version (both browsers stay in sync)
ONLY when `inject.js` actually changed since last build — so Chrome Web Store / Firefox
AMO see a new version to roll out to users, without churning the number on no-op rebuilds.

**Dev loop (Chrome):** `node build.js` → `chrome://extensions` → click ↻ reload on the card.
**Dev loop (Firefox):** `node build.js` → `about:debugging` → This Firefox → Reload (or Load
Temporary Add-on → pick `firefox-extension/manifest.json`).

Because the extension ships the code inside itself, it sidesteps the SF CSP wall that
blocks loader-bookmarklets (see §6).

> ⚠️ Not yet tested on a live browser in this environment. Known port risks to confirm on
> first real load: (a) MAIN-world inject works only on Firefox **128+**; (b) Firefox may
> block the auto-installed `javascript:` bookmark (degrades quietly — the toolbar-click
> feature is unaffected); (c) AMO signing is required to distribute a Firefox build.

---

## 5. The bookmarklet & the "re-drag" reality

The bookmarklet **embeds the whole tool** as base64 in the `javascript:` URL. So changing
the code means the OLD bookmark still runs OLD code — you must **re-drag** after each build.

- The install pages show an **update banner** (build-id stored in `localStorage`) that tells
  the user when the code changed since they last added it, so they know to re-drag. It only
  nags when the code actually changed (build id = hash of the payload).
- Browsers can't re-drag a bookmark for the user, so this banner is the best a bookmarklet
  can do. For truly hands-off updates, use the extension (§4).

---

## 6. Why we can't auto-update a bookmarklet (CSP)

Confirmed on a live org: Salesforce Lightning's Content-Security-Policy **hard-blocks**
loading external code (`fetch`/`<script src>` to github.io etc. → *"Refused to connect …
violates the document's Content Security Policy"*). So a "loader bookmarklet" that pulls
the latest code is impossible. This is why the payload is inlined, and why the extension is
the only auto-update path.

---

## 7. `_archive/` (not part of the product)

Reversibly moved here to keep the top level clean. Nothing in `_archive/` is used by the
build. Safe to ignore; safe to delete if you want.

- `_archive/probes/` — ~58 one-off `console-*probe*.js` DevTools diagnostics from development.
- `_archive/tests/` — `console-test-*.js` manual test snippets.
- `_archive/old-v0/` — the abandoned v0.1.0 approach (`src/` content scripts + old root `manifest.json`).
- `_archive/*.zip` — stale packaged zips.

---

## 8. Quick reference

```bash
# Edit the source
$EDITOR console-decorate.js

# Rebuild everything (verifies round-trip, browser-decode, syntax, strip-symbols)
node build.js

# Test locally: drag bookmarklet from Data360-Inspector-FULL-internal.html
#   OR reload the extension at chrome://extensions

# Publish PUBLIC build only — see §3
```

**Golden rules:**
1. Only ever edit `console-decorate.js`.
2. Keep in-dev features inside `@strip:start dev … @strip:end`.
3. Never publish the FULL build or the readable source. Only the stripped `install.html`.
4. Re-drag the bookmarklet (or reload the extension) after every build.
