# pinpoint browser extension

Injects the pinpoint annotate client (`/annotate.js`) into any local-dev page
whose origin matches a `url` entry in the pinpoint registry
(`~/.pinpoint/registry.json`). Annotations made on the injected page land
in that entry's bucket under `~/.pinpoint/<entry-id>/`, served by the
persistent pinpoint service (`https://pinpoint.localhost`).

**Main entry: click the pinpoint toolbar icon** to open the annotation
**side panel** (Chrome Side Panel, native split-screen — the page keeps its
own viewport and reflows, nothing is overlaid). The panel shows the current
ledger's annotation list with click-to-jump, hover edit/delete, and the
「交互 | 标注」mode switch, live over SSE. The in-page `#ann-sidebar`
(floating toolbar's「列表」button / **S** key) remains for surfaces the
extension can't cover (e.g. browsing `/sites/` pages directly).

## Architecture (0.3.0)

```
toolbar icon click
  → background.js: chrome.sidePanel.open({tabId})
  → sidepanel.html/js (extension shell page)
      → chrome.tabs.sendMessage {type:'pinpoint:page-info'}
          (stale tab — no live content script: heal via
           chrome.scripting.executeScript(content.js), idempotency-guarded,
           then retry once)
      → happy path: iframe → <serviceOrigin>/panel.html?entry=&page=&tab=&mode=
      → otherwise: local hint (service down / unsupported page / bridge dead /
                   stale page client / not registered / workbench shell)
  → panel.html (served by the pinpoint service, workbench stack)
      → data: GET /annotations/<page>?entry= + SSE /events (live updates)
      → actions: postMessage({source:'pinpoint-panel', cmd:jump|edit|del|mode})
          → shell (validates source + event.origin)
          → content script → DOM CustomEvent('pinpoint:command')
          → the page's main-world annotate client (goToMark/openMark/
            removeMark/toggleMode — edits persist from the client, SSE
            broadcasts back to the panel: the panel is never a second writer)
```

Why a service-hosted panel page instead of an extension-rendered one: the
panel reuses the row model/styles (`lib/ann-row.js`, `lib/ann-list.css`) and
the annotate API/SSE directly — no duplicated UI inside the extension, one
SSOT. The extension shell only resolves *which* tab/entry/ledger to show and
ferries commands.

Content-script page-info contract (`data-pinpoint-*` on `<html>`, all stamped
by the annotate client at boot): `data-pinpoint-client="1"` (readiness),
`data-pinpoint-entry` (bucket entry), `data-pinpoint-sidebar="suppressed"`
(workbench shell / embedded page — the shell has its own annotation surface),
`data-pinpoint-mode` (`interact`/`annotate`).

## Injection (content.js, top frame only)

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

## Load it (Chromium / Chrome)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `extension/` directory.
4. Keep the pinpoint service running (`just dev` in the pinpoint repo) and
   browse a registered url entry, e.g. `https://my-todos.localhost`.
5. Click the pinpoint toolbar icon to open the annotation side panel.

Reload the extension after pulling changes (Chrome asks once when
permissions change). A page whose injected client predates the side-panel
era gets a「组件过旧」hint in the panel — one ⌘R on that page upgrades it.

Permissions: `scripting` (stale-tab self-heal re-injection) + `sidePanel`
(the panel itself) + `host_permissions` limited to the same localhost
patterns as the declarative content script. Content-script fetches run with
the page's origin and are governed by the annotate API's CORS contract.
Third-party (non-localhost) sites are intentionally out of scope — both the
content-script matches and the host permissions only cover `localhost` /
`*.localhost` / `127.0.0.1`.
