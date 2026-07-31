# Data 360 Inspector

A browser tool (Chrome extension + bookmarklet) for Salesforce Data Cloud / Data 360. Adds a floating launcher on every Data 360 page that lets you inspect field mappings and export segment rules.

Read-only — nothing is sent anywhere. Everything runs in your browser using data the page already loaded.

---

## What it does

### On DLO → DMO mapping pages
- Reveals API (developer) names behind the label-only mapping canvas
- **Hover mode** — hover a row to see the API names in a tooltip
- **Inline mode** — shows all API names directly on the canvas at once
- **Export mappings** — opens a modal with the full DLO→DMO mapping table; copy to clipboard or download as HTML

### On DLO / Data Stream / DMO detail pages
- **Export Fields** — exports all fields with API names, labels, types

### On Segment pages
- **Export Rules** — reads the segment conditions from the SF canvas and shows them in a structured modal
- Supports **Include**, **Exclude**, and **Rank / Limit** tabs (whichever SF shows)
- **Copy for Sheets** — copies a formatted HTML table to clipboard; pastes with full colour/structure into Google Sheets or Excel
- **Download XLS** — saves a self-contained HTML file that opens correctly in Excel/Sheets with group colours and AND/OR structure

The segment Sheets export shows:
- Outer AND/OR container column (leftmost, no header) — mirrors the outermost bracket in the SF UI
- Group column — "Group N" or "Group N (OR)" for groups that contain sub-conditions joined by OR
- Condition rows with # counter, Object/CI, Field, Operator, Value(s)
- AND/OR joiner rows between conditions and between groups
- Sub-filter rows (└) for aggregation conditions
- Metadata footer (segment name, tab, segment-on object, status)

---

## Install

### Chrome extension (preferred)

1. Download / unzip `data360-inspector-extension.zip`
2. Chrome → `chrome://extensions` → enable **Developer mode** (top-right)
3. Click **Load unpacked** → select the unzipped folder
4. A blue "D" icon appears in the toolbar — click it on any Salesforce Data Cloud page to toggle the tool on/off

### Bookmarklet (no install needed)

1. Open `install.html` in your browser
2. Drag the **"Data 360 Inspector"** link to your bookmarks bar
3. On any Data 360 page, click the bookmark — the launcher appears
4. Click the bookmark again to remove it

> Company policy blocking extensions? Use the bookmarklet — it needs no install permissions.

---

## Usage

The floating launcher appears at the top of the page after activation. It is draggable — grab the bar background and drag to reposition.

| Button | Available on | What it does |
|--------|-------------|--------------|
| **Hover API** | Mapping canvas | Toggles hover tooltip showing API names |
| **Show inline** | Mapping canvas | Shows all API names on canvas at once |
| **Export** | Mapping canvas | Opens the mapping export modal |
| **Export Rules** | Segment pages | Opens the segment rules export modal |
| **Export Fields** | DLO / DMO / DataStream pages | Opens the field export modal |

### Segment export modal

- Tab bar at the top mirrors SF tabs (Include / Exclude / Rank / Limit)
- Clicking a tab reads that tab's conditions live from the SF canvas
- Modal is **draggable** (drag the header bar) and **resizable** (drag the bottom-right corner handle)
- **Copy for Sheets** — rich HTML table in clipboard; paste into Google Sheets or Excel desktop
- **Download XLS** — saves a formatted HTML file

---

## Files

| File | Purpose |
|------|---------|
| `console-decorate.js` | Full source (private — do not share) |
| `build.js` | Run `node build.js` to rebuild all artifacts |
| `install.html` | Bookmarklet installer page |
| `bookmarklet.txt` | Raw bookmarklet code |
| `chrome-extension/manifest.json` | MV3 extension manifest |
| `chrome-extension/inject.js` | Built script injected by extension |
| `chrome-extension/background.js` | Toolbar-click → inject handler |
| `chrome-extension/icons/` | Extension icons (16 / 48 / 128 px) |
| `data360-inspector-extension.zip` | Ready-to-load extension zip |

To rebuild after editing `console-decorate.js`:
```
node build.js
```
Then reload the extension at `chrome://extensions` (click the refresh icon on the card).

---

## Notes

- The tool runs in the page's own JavaScript context (required to read LWC component properties)
- It never modifies page data or calls any external URL
- A second click of the bookmarklet / extension icon removes the tool cleanly
