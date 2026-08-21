# Privacy Policy — Data 360 Inspector

_Last updated: 2026-08-03_

**Data 360 Inspector** is a read-only developer tool for Salesforce Data Cloud / Data 360.

## What it does with data

- The extension runs only on Salesforce domains (`*.salesforce.com`, `*.force.com`,
  `*.lightning.force.com`, `*.salesforce-setup.com`) and only when you click its toolbar
  icon.
- It reads field names, mapping metadata, and segment/rule information **already present on
  the page** you are viewing, and displays it back to you.
- For the "show all columns' data" feature, it reads your Salesforce **session cookie**
  (`sid`) for the org you are logged into, and uses it solely to make **read-only** queries
  to **that same org's own documented API**. The cookie value is never stored and never
  sent anywhere except to your own Salesforce instance.

## Optional AI-explain feature

If you choose to use the "Explain this transform" feature, you provide your own API key
(Anthropic, OpenAI, or Google Gemini). That key is stored locally in `chrome.storage.local`
(encrypted at rest by the browser) and is sent **only** to the provider you chose, **only**
when you click "Explain". The transform definition JSON is sent to that provider for
analysis. No other data is sent. If you never configure this feature, no AI calls are made.

## What it does NOT do

- **No data is collected, stored, or transmitted to the developer or any third party.**
- **No external servers are contacted** apart from your own Salesforce org and (optionally)
  your chosen AI provider when you explicitly trigger it.
- **No analytics, no tracking, no advertising.**
- **No remote code** — all code ships inside the extension package.
- It never modifies, creates, or deletes your Salesforce data (read-only).

## Local storage

Your column selections for the Data Explorer feature are saved in your browser's
`localStorage` on your own device, so your setup persists between sessions. This never
leaves your machine and can be cleared any time via the tool's "Clear saved" button or your
browser settings.

## Contact

For questions about this policy, contact the developer via the extension's store listing.
