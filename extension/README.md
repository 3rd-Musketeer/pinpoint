# pinpoint browser extension

Injects the pinpoint annotate client (`/annotate.js`) into any local-dev page
whose origin matches a `url` entry in the pinpoint registry
(`~/.html-annotate/registry.json`). Annotations made on the injected page land
in that entry's bucket under `~/.html-annotate/<entry-id>/`, served by the
persistent pinpoint service (`https://pinpoint.localhost`).

**Main entry: click the pinpoint toolbar icon** to open/close the annotation
panel (`#ann-sidebar`) on the current tab. The panel header has a
「交互 | 标注」segmented switch, the current ledger's annotation list with
click-to-jump, and hover edit/delete. The floating toolbar's「列表」button and
the **S** key remain as secondary entries.

How it works (`content.js`, top frame only):

1. Probes `https://pinpoint.localhost/registry`, then the page's own origin —
   the first origin returning JSON wins. If none responds, pinpoint is not
   running and the page is left untouched.
2. Matches `location.origin` against the registry's `url` entries (exact
   origin match). No match → nothing is injected.
3. Stamps the entry id into the page's main world via the shared DOM
   (`<html data-pinpoint-entry="...">` — inline `<script>` injection is
   blocked on pages with a strict CSP), then loads `annotate.js` from the
   service's `service.directOrigin` reported by `/registry` (the API's plain
   loopback bind, e.g. `http://127.0.0.1:<port>`).

   Why not `https://pinpoint.localhost` directly? Since Chrome 130, scripts
   injected by a content script are checked against the extension's own CSP,
   which by default only allows the extension origin and
   `http://localhost:*` / `http://127.0.0.1:*`. Loopback http is a
   potentially trustworthy origin (no mixed-content block from https pages),
   and the annotate API answers cross-origin calls with
   `Access-Control-Allow-Origin: *` (no credentials).

Toolbar icon click chain (`background.js` → `content.js` → page):

1. `chrome.action.onClicked` fires in the MV3 service worker, which sends
   `{type: 'pinpoint:toggle-sidebar'}` to the clicked tab. Tabs without the
   content script (non-localhost pages, `chrome://`, …) reject the
   `sendMessage` — caught, quiet no-op.
2. The content script relays the message into the page's main world as a DOM
   `CustomEvent('pinpoint:command', {detail: {command: 'toggle-sidebar'}})` —
   DOM events cross isolated worlds without inline scripts, so this bridge is
   CSP-safe. The annotate client listens for it and toggles the panel
   (suppressed on workbench pages / embedded frames, same as the S key).

## Load it (Chromium / Chrome)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `extension/` directory.
4. Keep the pinpoint service running (`just dev` in the pinpoint repo) and
   browse a registered url entry, e.g. `https://your-app.localhost`.
5. Click the pinpoint toolbar icon to open the annotation panel.

No host permissions: content-script fetches run with the page's origin and are
governed by the annotate API's CORS contract. Third-party (non-localhost)
sites are intentionally out of scope — the manifest only matches `localhost` /
`*.localhost` / `127.0.0.1`.
