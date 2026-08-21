# Security Architecture — Data 360 Inspector

_Last updated: 2026-08-21_

## Data flow

```
[Salesforce page DOM]
        |
        | (inject.js reads LWC properties for field names — MAIN world)
        |
        v
[inject.js] --postMessage--> [bridge.js] --runtime.sendMessage--> [background.js]
  (MAIN world)                (ISOLATED world)                     (service worker)
                                                                        |
                                                        reads sid via cookies API
                                                                        |
                                                                        v
                                                          [User's own SF org API]
                                                          (GET/SELECT-only calls)
```

## What the extension CAN access

- The Salesforce session cookie (`sid`) for any `*.salesforce.com` / `*.force.com` /
  `*.lightning.force.com` / `*.salesforce-setup.com` domain the user is logged into.
- DOM content and LWC component properties of the active Salesforce tab (MAIN world).
- `chrome.storage.local` for persisting user AI provider settings.

## What the extension ACTUALLY accesses

- The `sid` cookie, used exclusively as a Bearer token in Authorization headers to the
  user's own Salesforce org. Never stored, never logged, never transmitted elsewhere.
- DOM elements/properties to extract field API names and mapping metadata already visible
  on the page the user is viewing.
- Documented read-only Salesforce APIs:
  - `GET /services/data/vXX/ssot/data-model-objects`
  - `GET /services/data/vXX/ssot/data-model-objects/{name}`
  - `POST /services/data/vXX/ssot/query-sql` (SELECT only)
  - `GET /services/data/vXX/ssot/query-sql/{id}/rows`
  - `GET /services/data/vXX/ssot/data-transforms/{name}`
  - `GET /services/data/vXX/ssot/activations/{id}`

## Privacy: what is NOT collected

- No telemetry, analytics, or crash reporting.
- No data leaves the browser except to the user's own Salesforce org (and optionally,
  the user's chosen AI provider if they configure the explain feature).
- No user behavior tracking. No fingerprinting.
- The extension has no server component and no backend.

## Read-only guarantee

- Every Salesforce API call uses GET or a SELECT-only POST (`/ssot/query-sql`).
- No POST/PUT/PATCH/DELETE calls that modify Salesforce data are made.
- The tool only adds visual annotations (CSS, data attributes) to the page DOM; it does
  not modify Salesforce records or metadata.

## Security controls

### Host validation
The background service worker validates that the host parameter matches known Salesforce
domain patterns before reading any cookies or making fetch calls. This prevents a
compromised content script from tricking the background into leaking the sid to an
attacker-controlled server.

### Message allowlist
The bridge content script only forwards messages with recognized `__dcReq` types to the
background. Unknown message types are silently dropped.

### Sender verification
The background message listener verifies `sender.id === runtime.id` — only messages from
this extension's own content scripts are accepted.

### Error sanitization
All error messages returned to content scripts are sanitized: Bearer tokens and hex
strings resembling session ids are redacted before being sent back through postMessage.

### No eval / no remote code
The extension contains no `eval()`, no `new Function()`, no dynamic script loading from
remote URLs. All code ships in the extension package.

### No sid in logs
The session cookie value is never written to `console.log`, `console.warn`, or
`console.error`. Diagnostic logs output only URLs (without auth headers), status codes,
and row counts.

### AI key isolation
User-provided AI API keys are stored in `chrome.storage.local` (encrypted at rest by the
browser, not synced) and sent only to the user's explicitly chosen provider endpoint.
Keys are never logged or included in error messages.

## Threat model

| Threat | Mitigation |
|--------|-----------|
| Malicious SF page sends crafted postMessage to trigger API calls | Bridge validates `ev.source === window` + allowlist of `__dcReq` types |
| Another extension sends runtime messages to our background | `sender.id` check rejects external senders |
| Content script spoofs host to redirect sid to attacker domain | Host regex validation in background before any cookie read or fetch |
| Error message leaks sid | `safeError()` strips Bearer tokens and long hex strings |
| XSS via message data | Bridge never uses innerHTML with message-derived content; only forwards structured data to background |
| Prototype pollution from inject.js | inject.js saves/restores originals of any prototype methods it patches (XHR/fetch/anchor) |

## Chrome Web Store / Firefox AMO compliance

- No obfuscated code (inject.js is readable, not minified beyond standard bundling).
- Single clear purpose: Data Cloud inspection and export.
- No hidden features — every capability is user-initiated (click icon, click buttons).
- No remote code execution.
- Privacy policy provided (PRIVACY.md).
- All permissions justified with specific technical reasons (STORE-LISTING.md).
