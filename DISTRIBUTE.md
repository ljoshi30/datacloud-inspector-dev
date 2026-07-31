# Sharing the Data 360 Mapping Inspector

Because this org **blocks browser extensions by policy**, the shareable formats
are ones that need no install. Ranked best-first for a non-technical audience.

## What to send people

**`install.html`** — a self-contained install page. Colleagues open it and
**drag the "Show API Names" button** to their bookmarks bar (Option 1), or copy
the code into the DevTools Console (Option 2 fallback). Everything is embedded;
no other files are needed. Host it wherever your team already shares files:

- **Simplest:** attach `install.html` to a Slack/Teams/email; recipient opens it
  locally (double-click) and drags the button.
- **Nicer:** drop it on any internal static host / wiki / SharePoint / GitHub
  Pages and share the link. (It's one static HTML file, no server needed.)

`bookmarklet.txt` — the raw `javascript:` one-liner, for anyone who prefers to
create the bookmark manually (paste into a bookmark's URL field).

## Which method for whom

| Audience | Method |
|---|---|
| Anyone, non-technical | **Bookmarklet** (drag button from `install.html`) |
| Admins/engineers in DevTools | **Snippet** (paste `console-decorate.js`) — also saveable under DevTools → Sources → Snippets to keep permanently |
| A team that can get ONE extension approved by IT | **Tampermonkey userscript** (auto-runs, zero clicks) — see below |

## If a bookmarklet is CSP-blocked

Salesforce's Content-Security-Policy *may* block `javascript:` bookmarklets in
some orgs. If clicking the bookmark does nothing, use **Option 2 (Snippet)** —
pasting into the Console is not subject to page CSP and always works. For a
permanent no-paste setup, save it as a **DevTools Snippet**
(Sources → Snippets → New) and run it with one click each session.

## Optional: Tampermonkey userscript (auto-runs, needs the Tampermonkey extension)

If your team can get the **Tampermonkey** extension allowlisted by IT, this
version runs automatically on the mapping page — no clicking. Create a new
userscript and paste the contents of `console-decorate.js` below this header:

```javascript
// ==UserScript==
// @name         Data 360 Mapping Inspector
// @namespace    datacloud-mapping-inspector
// @match        https://*.lightning.force.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
```

## Obfuscation (deters casual copying)

The shared artifacts are **obfuscated**: the code is packed into an opaque
`eval(decodeURIComponent(atob("<base64>")))` blob that runs byte-identically to
the source. This deters casual reading/copying.

**Honest limitation:** browser JavaScript can never be *truly* hidden — it runs
in the user's browser, so anyone determined can recover it (decode the base64,
or read it live in DevTools). This only raises the effort bar; it is not
DRM/security. Keep **`console-decorate.js`** (the readable source) private and
share only the built artifacts:

- `console-decorate.min.js` — obfuscated paste version
- `bookmarklet.txt` / the button in `install.html` — obfuscated bookmarklet

## Regenerating after edits

Edit the readable **`console-decorate.js`**, then rebuild the obfuscated,
shareable files:

```bash
cd ~/datacloud-mapping-inspector && node build.js
```

The build re-obfuscates, verifies the blob round-trips to the exact source, and
simulates the browser's bookmarklet decode — aborting if anything is off.

## Privacy / safety note for reviewers

Read-only. It reads field labels + developer names already present in the page
(source names from DOM attributes, target names from the LWC component's
`entity.fields[]`) and renders them inline. **No network calls; no data leaves
the browser tab.** It adds a small `<span>` under each label and never modifies
mapping data.
