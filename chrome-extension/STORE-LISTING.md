# Store submission pack — Data 360 Inspector

Everything you need to submit to the **Chrome Web Store** and **Firefox AMO**, plus the
permission justifications reviewers ask for. Read this before submitting.

---

## 1. What the extension is (single, clear purpose)

A **read-only** developer tool for Salesforce Data Cloud / Data 360. On a Data Cloud page
it adds a floating launcher that:
- reveals API (developer) names on the DLO→DMO mapping canvas,
- exports DLO / DMO / Data Stream field lists,
- exports segment rules,
- shows all columns of a Data Explorer object's data in one table.

It runs entirely in the user's browser, using the user's **existing Salesforce session**,
and talks **only** to the user's own Salesforce org. **No external servers. No analytics.
No data leaves the browser except back to the user's own Salesforce.**

---

## 2. Permission justifications (paste into the store forms)

| Permission | Why it's needed | Reviewer-facing justification |
|---|---|---|
| `scripting` | Inject the tool into the page's MAIN world on user click. | "Injects the inspector script when the user clicks the toolbar icon. MAIN world is required to read Salesforce Lightning component properties that hold the API names we display." |
| `activeTab` | Act only on the tab the user clicked from. | "We only act on the current tab, and only when the user clicks the icon." |
| `cookies` | Read the Salesforce session cookie to call the user's own org's **documented** Data Cloud Query API for the 'show all columns' feature. | "Reads only the Salesforce `sid` session cookie for the current org, used solely to authorize read-only queries to that same org's documented API (`/services/data/vXX/ssot/query-sql`). The cookie value is never stored or transmitted anywhere except back to the user's own Salesforce instance." |
| `storage` | Persist the user's AI provider preference and API keys locally (encrypted at rest by the browser). | "Stores the user's chosen AI provider setting and their own API keys so they persist across browser restarts. Never synced or transmitted to us." |
| host_permissions `*.salesforce.com`, `*.force.com`, `*.lightning.force.com`, `*.salesforce-setup.com` | Salesforce orgs live on these domains; the tool must run there and query the org's API. | "The tool only works on Salesforce Data Cloud pages, which are served from these domains. No other sites are accessed." |
| host_permissions `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` | Optional AI-explain feature: user provides their own API key; calls go to their chosen provider. | "Used only when the user explicitly configures the AI-explain feature with their own API key. No calls are made without user action." |

> If a reviewer questions the breadth of `*.force.com`: it is required because every
> Salesforce customer org has its own subdomain under these roots; there is no single
> host. The content script and API calls are still limited to the user's own logged-in org.

---

## 3. Data usage disclosures (Chrome Web Store "Privacy practices")

- **Does it collect user data?** No data is collected or transmitted to the developer or
  any third party.
- **Data handled locally:** the extension reads field/mapping data already on the page and
  the user's session cookie, used only to query the user's own Salesforce org. Column
  selections are saved in the browser's `localStorage` on the user's machine.
- **Remote code:** None. All code is bundled in the package (no eval, no remote scripts).
- **Sold/transferred:** No.
- Certify: "does not sell/transfer data", "not used for unrelated purposes", "not used for
  creditworthiness/lending".

---

## 4. Firefox AMO specifics

- AMO requires **reviewable source**. `inject.js` is readable (not minified/obfuscated);
  if asked, provide this repo + "build: `node build.js`; the extension is `firefox-extension/`".
- Manifest sets `browser_specific_settings.gecko.id` + `strict_min_version: 128.0`
  (MAIN-world script injection requires Firefox 128+).
- `background.scripts` is used (Firefox MV3), vs Chrome's `service_worker`.

---

## 5. Pre-submit checklist

- [ ] `node build.js` run; `chrome-extension/` and `firefox-extension/` regenerated.
- [ ] Manifest permissions are exactly: `scripting`, `activeTab`, `cookies`, `storage` (no `bookmarks`, no `<all_urls>` WAR).
- [ ] No `eval` / `new Function` / remote code (build asserts readable source).
- [ ] Privacy policy URL is live (host PRIVACY.md somewhere public, e.g. the GitHub Pages repo).
- [ ] Screenshots: launcher on a mapping page + the export modal.
- [ ] Description matches actual behavior (read-only, Salesforce-only, no external calls).
- [ ] Zip the correct folder: `chrome-extension/` for Chrome, `firefox-extension/` for AMO.

---

## 6. Honest expectations

- No obfuscation, no remote code, no external calls, minimal permissions → this clears the
  **common auto-rejection triggers**.
- BUT `cookies` + broad Salesforce host permissions will likely route it to **human review**
  (slower, and a reviewer may ask for the justifications above). That's normal for a tool
  like this (Salesforce Inspector Reloaded, which uses the same cookie technique, is
  approved on both stores).
- Approval is never 100% guaranteed — it depends on the reviewer. This pack maximizes the
  odds and gives you ready answers if they ask.
