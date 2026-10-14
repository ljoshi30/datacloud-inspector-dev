# Data 360 Inspector — How It Works (Backend & API Approach)

*A plain-English guide to what happens behind each feature: which Salesforce API calls
the tool makes, which endpoints, and — for the features that make **no** API call at all —
how they work instead.*

This is written so you can confidently answer **“how is this built, and which APIs are you
using?”** without reading the code. Nothing here is guessed — it reflects what the tool
actually does.

---

## 1. The one-minute summary

- The tool is **read-only**. It never creates, updates, or deletes anything in Salesforce.
- It runs **entirely in your browser**. There is **no server of ours** — no backend we host,
  no database, nothing phones home.
- **Most features make no API call at all.** They just read what Salesforce has already drawn
  on the page.
- The few features that *do* fetch data call **the user’s own Salesforce org**, using the
  user’s **existing logged-in session** — no new login, no connected app, no stored password.
- The **only** time any data leaves Salesforce is the **optional** AI “explain this transform”
  feature — and only to the AI provider the user themselves configured with their own key.
  If they never set that up, it never happens.

---

## 2. Two ways the tool runs

The tool ships in two forms. The **code is identical**; what differs is *how it’s allowed to
reach Salesforce data*.

### A) Bookmarklet version (a bookmark you click)

A bookmarklet is just JavaScript that runs **inside the Salesforce page you’re already on**.
Because of browser security rules, it has two hard limits:

- It **cannot read the login cookie** (Salesforce marks the session cookie “HttpOnly”, which
  means page scripts are blocked from reading it — by design).
- It **cannot call `my.salesforce.com` directly** (browsers block cross-origin calls).

So how does it query data? It **reuses the page’s own machinery**:

> **The “sniff and replay” approach.** The Salesforce Data Cloud page constantly makes its
> own internal requests to a same-page endpoint called `/aura` (that’s how Salesforce’s UI
> talks to its back end). The tool quietly watches those requests go by and **captures the
> session token the page is already sending**. When you click Count or Fetch, the tool sends
> a request to that **same `/aura` endpoint**, reusing that token — exactly as if the page
> itself had asked. It’s same-origin and read-only, so the browser allows it.

Think of it as: *the page already has the keys and is already talking to the back end; the
tool just asks the back end the same way, using the same keys, for a read-only query.*

### B) Extension version (Chrome / Firefox add-on)

The browser extension is more capable because it’s *allowed* to do what a page script can’t.
It has a small **background script** that:

- **Reads the Salesforce session cookie** (`sid`) — but *only* for known Salesforce domains,
  and only to authorize calls back to **your own org**. The cookie is never logged, stored, or
  sent anywhere else.
- **Calls Salesforce’s official, documented REST APIs** directly (the `/services/data/...`
  endpoints). This is cleaner than the bookmarklet’s approach and, importantly, supports
  **true pagination** — which is why big exports work better in the extension.

So the extension uses **documented public Salesforce APIs**; the bookmarklet uses the page’s
**own internal endpoint**. Both are read-only and both act strictly as the logged-in user.

### How the two compare

| | Bookmarklet | Extension |
|---|---|---|
| How it authorizes | Reuses a session token sniffed from the page’s own `/aura` traffic | Reads the `sid` session cookie (background script) |
| What it calls | The page’s **internal** `/aura` endpoint (same-origin) | Salesforce’s **documented** REST APIs (`/services/data/...`) |
| Big-export pagination | Uses `OFFSET` paging (works, but re-scans — slower on huge tables) | Uses a proper result-cursor (`queryId` + `/rows`) — more efficient |
| Install | Drag a bookmark, no permissions | Add-on with cookie/host permissions for Salesforce domains |
| Read-only? | Yes | Yes |

---

## 3. Does a feature call an API? Feature-by-feature

The key thing to know: **the “read what’s on screen” features make zero API calls**, and the
“go get data” features make read-only calls to your own org.

| Feature | Makes an API call? | How it works / which endpoint |
|---|---|---|
| **Mapping canvas** — hover/copy API names, pin all names, export mapping | **No** | Reads the page’s own component data + shadow DOM. Pure on-screen reading. |
| **Data Stream / DLO field export** | **No** | Reads the rendered fields table on the page. |
| **DMO detail export** (Fields + Relationships) | **No** | Reads the rendered tabs on the page. |
| **Segment** — hover API names, container path, export rules | **No** | Reads field/object API names the builder already stores on its on-page elements. |
| **Activation** — hover API names (wizard) | **No** | Reads the wizard’s on-page elements. |
| **Data Model ERD** (Mermaid diagram) | **No** | Reads the entities/relationships from the page and formats a diagram. |
| **“Open in new tab” (⧉)** on nav items & Data Model list | **No** | Reads each item’s real link / row identifier from the page. |
| **Query Editor — # Count / Fetch & Export / Export ALL** | **Yes** | **Bookmarklet:** `/aura` action `queryDCSql`. **Extension:** `POST /services/data/v63.0/ssot/query-sql`, then pages with `GET /ssot/query-sql/{queryId}/rows`. All **SELECT-only**. |
| **Data Explorer — show all columns / export** | **Yes** | **Bookmarklet:** `/aura` action `CdpDataView.query`. **Extension:** the documented `/ssot/query-sql`. Read-only. |
| **Data Transform — View Definition** | **Yes (extension only)** | `GET /services/data/v63.0/ssot/data-transforms/{id}` — just reads the definition. The bookmarklet can’t do this (the page can’t reach that API), so it’s extension-only. |
| **Activation — Export** | **Yes** | **Extension:** `GET /services/data/v67.0/ssot/activations/{id}`. **Bookmarklet fallback:** the page’s own `/aura` actions (`getActivationStatusProperties`, `getRecord`). Read-only. |
| **AI “Explain this transform”** (optional) | **Yes — to an AI provider, not Salesforce** | Sends the transform’s definition JSON to the AI service the user configured (their own key). The *only* feature that sends anything outside Salesforce, and only if the user turns it on. |

**Takeaway for the “which API?” question:** everything that touches *data* is a **read-only
SELECT** or a **GET** against the user’s own org. The data-query features use Data Cloud’s
`ssot/query-sql` (documented REST) in the extension, or the page’s internal `queryDCSql` /
`CdpDataView.query` aura actions in the bookmarklet. The “read what’s on screen” features use
**no API at all**.

---

## 4. The endpoints, in one place

For a technical audience (e.g. a security reviewer), these are every Salesforce endpoint the
tool can call, all **read-only**:

**Extension — documented Salesforce REST** (`https://<org>.my.salesforce.com`):
- `POST /services/data/v63.0/ssot/query-sql` — run a SELECT (Query Editor, Data Explorer)
- `GET  /services/data/v63.0/ssot/query-sql/{queryId}/rows` — fetch a page of results
- `GET  /services/data/v63.0/ssot/query-sql/{queryId}?waitTimeMs=10000` — poll a long query until finished
- `GET  /services/data/v63.0/ssot/data-transforms/{id}` — read a Data Transform definition
- `GET  /services/data/v67.0/ssot/activations/{id}` — read an Activation definition

Authorization is always `Bearer <sid from the user’s cookie>`. The host is validated against
known Salesforce domain patterns before any cookie read or call.

**Bookmarklet — the page’s own internal endpoint** (same-origin `/aura`):
- `queryDCSql` action — Query Editor Count/Fetch
- `CdpDataView.query` action — Data Explorer
- `getActivationStatusProperties` / `getRecord` actions — Activation export fallback

**Optional AI (only if the user configures it, with their own key):** a single `POST` to the
AI provider they chose — Anthropic, OpenAI, Google Gemini, or an internal Salesforce gateway.
No Salesforce record data is sent — only the transform’s structural definition the user asked
to have explained.

---

## 5. Why so many features need no API

Salesforce Data Cloud is built with Lightning Web Components. The page has **already loaded**
the field names, API names, mappings, and relationships into the browser in order to draw the
UI. The catch is it usually shows you the friendly **label** and hides the **API name** you
actually need.

So for those features the tool doesn’t need to ask Salesforce for anything — the information is
**already in the page**, just not shown. The tool reads it from the components (including
“shadow DOM”, the encapsulated part of web components) and surfaces it to you. That’s why
hovering a mapping field, pinning API names, or exporting a field list is **instant and uses no
credits** — nothing is fetched.

---

## 6. Credits (because people ask)

Only the features that run a **query** consume Data Cloud credits — that’s **Count**,
**Fetch & Export**, **Export ALL**, and **Data Explorer**’s data pull. Salesforce bills by rows
**processed** (scanned), not rows returned. The “read what’s on screen” features (mapping,
field exports, API-name hovers, ERD, open-in-new-tab) run **no query**, so they cost nothing.
Reading a Data Transform or Activation definition is a tiny metadata GET, not a data query.

---

## 7. Privacy posture (the short version)

- Runs entirely in your browser; **no server of ours**, no third-party analytics on your data.
- Talks only to **your own Salesforce org**, as **you**, using your existing session.
- **Read-only** everywhere — never writes to Salesforce.
- The session cookie (extension) is used **only** to authorize calls to your org and is never
  logged, stored, or transmitted elsewhere; error messages are scrubbed of anything token-like.
- The **only** outbound-to-a-third-party path is the **optional** AI explain feature, using the
  user’s own API key, sending only a transform’s definition — never record data.
- No `eval()`, no remote code loading, no dynamic script injection.

---

*Last reviewed against the source: see the repository’s current build. If a feature’s behavior
changes, update this file in the same change so it never drifts from the code.*
