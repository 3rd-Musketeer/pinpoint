# pinpoint — Agent Guide

Read this first when working in this repo.
Human-oriented docs: [`README.md`](README.md) · onboarding: [`QUICKSTART.html`](QUICKSTART.html) · recent changes: [`CHANGELOG.md`](CHANGELOG.md).

pinpoint is a **local visual feedback service**: kits (`kits/ios/`, the first design-spec
kit) + a workbench canvas (multi-scheme prototype viewer) + the annotation layer
(human→agent feedback loop, the core). The persistent service runs at
`https://pinpoint.localhost` and serves the workbench, the annotate API, registered
external dirs (`/sites/<id>/`), and the client bundle (`/annotate.js`).

Repo skills live in [`skills/`](skills/) — plain directories referenced by path (dir-ref),
so they work with any coding agent (Claude Code / Codex / Cursor / …). Open the SKILL.md
the routing table below points at before touching the matching surface.

## Start the server

```bash
brew install just         # once per workstation
npm install -g portless   # once per workstation
npm install          # first time
just dev             # https://pinpoint.localhost/index.html
```

`Justfile` is the workflow SSOT; `package.json` scripts are implementation primitives.
Portless owns the normal route and process lifecycle. `npm run dev:direct` is
the explicit proxy-bypass fallback at `http://127.0.0.1:5199`; do not use a
persistent Portless alias for this app.

Health: `curl -s https://pinpoint.localhost/health` — the same origin serves workbench,
annotate API, and `/sites/`. The payload carries `dataDir` (the default `pinpoint` bucket
path, kept for `jq -r .dataDir` consumers), `dataRoot` (the annotation data root), and a
`registry` section (`ok` / `path` / `entries` **count** / `errors` / `warnings`) — use
`GET /registry` when you need the actual entry list.

Kit CSS/JS is framework-free. **Workbench** needs Vite + Lucide (`npm install`).

Checks: `just check` (contracts + Chromium e2e; first time
`npx playwright install chromium`). E2e runs the server with
`PREVIEW_TEMPLATE_ONLY=1`, so instance-local pages/components never affect assertions.

## Worktree and publishing contract

- This is one Git repository with two long-lived worktrees: daily development on
  `dev`, public-template release on `main`.
- Run the persistent `pinpoint.localhost` service only from the `dev` worktree.
  The release worktree is a cold verification and publishing surface.
- Do not develop, create private instance content, or commit directly on `main`.
  `main` may only fast-forward to the published `dev` tip.
- `just ship-dev` is the only canonical dev-push workflow. It requires clean,
  non-divergent `dev`, runs the full check, pushes `origin/dev`, and verifies the ref.
- `just publish` is the only canonical main-publish workflow. Run it from the release
  worktree on `main`; it requires both worktrees clean and local `dev == origin/dev`,
  uses `git merge --ff-only`, installs from the lockfile, runs template-only verification,
  pushes `origin/main`, and verifies `origin/main == origin/dev`.
- Both recipes change remote state. Never work around a failed guard, force-push,
  or create a merge commit to make a release proceed.

## Repository map

| Path | Role |
|---|---|
| `client/annotate.js` | The annotation client, served as `/annotate.js`; libs are inlined at serve time |
| `client/lib/` | Client-only libs (hit test) inlined into `/annotate.js` |
| `server/` | Vite plugins: `annotate-api.js`, `sites-api.js`, `frame-notes-api.js`, `export-image-api.js`, `export-doc-api.js`, `components-board.js`, `preview-hmr.js`, `template-only.js` |
| `server/lib/` | Server stores/contracts: `annotation-store.js`, `registry.js`, `annotate-data-dir.js`, export bake/contract libs |
| `workbench/` | Canvas: `stage.js` (P4 正名自 workbench.js: board loader, mount orchestration + DI wiring, `window.workbench` API, splitter/pan/zoom stage input, HMR), cluster modules (`pages` / `board-nav` / `boot-prefs` / `screen-load` / `preview-mount` / `ann-bridge` / `export-core` / `frame-notes`), `workbench-icons.js`, `url-sync.js` (P3: `?page=&mode=` deep-link write side; read side is `resolveBootPageId` in `stage.js`), `wb-tokens.css` (P4: generated `--wb-*` visual tokens — edit `scripts/build-wb-tokens.mjs`, never the output) |
| `workbench/app/` | React chrome (P1b): `main.jsx` entry mounts `Sidebar.jsx` (head/Pages/Annotations/footer) + `CanvasHud.jsx` (dock/HUD) + `AnnPanel.jsx` + `SettingsView.jsx`; `frame-menu.jsx` (P3) is the Radix DropdownMenu island mounted per frame menu shell (behavior only; skin/geometry stay in `index.html` CSS, Popper wrapper neutralized there); `store.js` (zustand) is the single home of shared chrome state; `query-client.js` (TanStack Query, P2) is the single home of server state — SSE (`preview:update`) is the only invalidation source; visual-rebuild V0: `wb-tw.css` is the Tailwind v4 entry (no preflight, sources scoped to `app/**`, `@theme inline` consumes the shadcn bridge vars from `wb-tokens.css`), `ui/` holds the vendored shadcn/ui copies (source-owned, edit freely), `lib/utils.js` has `cn()` |
| `workbench/lib/` | Board navigation, mount session, include slots, preview contracts, icon data (`wb-icons.js`) |
| `lib/` | Isomorphic libs inlined into `/annotate.js` (page key, indicator, slug, clip, bubble, ann-row) — node-tested SSOT; `ann-list.css` is the shared list-row stylesheet (linked by `index.html`, injected as a JS string into `/annotate.js`) |
| `kits/ios/` | First kit: `ios-kit.css/js` + `components/` (Component Library sources) |
| `previews/` | Template pages: `_index.json` manifest + `<pageId>/board.json` + screen HTML/JS |
| `extension/` | MV3 browser extension — injects the client on registered `url` entries |
| `skills/` | Agent skills (dir-ref): `pinpoint-build`, `pinpoint-annotate` |
| `e2e/` | Playwright: workbench, annotation buckets, dir-entry sites, extension, SPA ledger |

Editing a file in `lib/` or `client/lib/` changes the served `/annotate.js` (inlined at
serve time); those modules are pure and node-tested — keep them DOM-free.

## Edit surfaces

| Do edit | Do not edit |
|---|---|
| `previews/<pageId>/*.html` (iOS: `.ios-app` + sibling overlays; Web: any non-document fragment) | Phone chrome / bezel / status bar (loader-owned) |
| `previews/<pageId>/*.js` (screen sidecar `mount(root)`) | Product gestures in `ios-kit.js` |
| `previews/<pageId>/board.json` | Hand-set `font-size` on `.wb-lib-cap` / `.wb-screen-cap` |
| `kits/ios/components/<id>/` (`meta.json` + variants) | Paste-copy component HTML into screens |
| `previews/_index.json` when adding a page (`mode`: `ios` \| `web` \| `html`) | `ios-kit.css` to “fix” one annotation |
| `~/.pinpoint/registry.json` to register external review targets (machine-local, never tracked) | tracked files to smuggle instance content in |

**Board modes:** the Pages list has an **iOS / Web / HTML** switch. Lists are isolated; Component Library is iOS-only.

| Board | Input | Artboard | For |
|---|---|---|---|
| **iOS** | body fragment | phone chrome | phone prototypes |
| **Web** | body fragment | `.wb-html-stage` / `.wb-html-surface`, `--wb-web-w: 960px` | web app surfaces — example `previews/web-library/` |
| **HTML** | **complete standalone document** | full-viewport iframe, **no canvas** | one-page reports and docs — example `previews/doc-library/` |

HTML pages use `shell: "doc"`. The file keeps its own `<!doctype>`, `<head>`, and `<style>`, so it is
**hosted in an iframe rather than inlined** — inlining would drop its `body{}` rules and leak its CSS
into the workbench. The loader therefore skips the fragment check for `doc` screens.

**The HTML board is not a canvas.** A report has to be read at the reader's real window size, so the
document fills the stage 1:1 — no zoom, no pan, no artboard, no Frame titles or Frame Notes, and no
canvas Frame export (it would not match the real layout). Export the active document from the
sidebar Versions/Document header (**导出**): HTML 完整、去除 CSS 的 HTML、or a full-page long PNG
(920×2, annotate blocked). HTML modes show text-token estimates (local `bpe-lite`); image mode
shows vision-token estimates from export pixel size (Gemini / OpenAI / Anthropic formulas). Multiple screens in a `board.json` become **versions in the sidebar**
(`#wbdoc-versions`), one shown at a time and remembered per page, instead of frames sitting side by
side. A screen's `"src"` may point at any URL, so a symlink under `previews/` is enough to review a
document living outside this repo.

**Annotating a doc page:** the document only needs a tail script that pulls
`/annotate.js` **when `location.hostname` is localhost**, then calls
`pinpoint.setFloatingToolbar(true)` when opened standalone (the toolbar hides
itself when there is no workbench sidebar). The page-world API is `window.pinpoint`;
`window.iOSAnnotate` survives only as a deprecated alias for pre-rename doc pages. Annotate treats the whole document as
the hit surface — authors do **not** need `wb-html-surface` / `data-ann-surface`
on content (those markers remain for Web-board fragments inlined into the
workbench, where sidebar/chrome must stay unselectable).

Marks land under the document's own page key (per-path file in the entry bucket, see
`/health`), not the workbench's. In the HTML board the sidebar still drives them: workbench
annotate calls resolve to the active doc frame's instance, so mode, count, and the
Annotations list all reflect the document, and the embedded document hides its own floating
toolbar and offers no annotation-list sidebar to keep one control surface.

**Overlay rule (iOS):** `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` are siblings of `.ios-app`, not children. Nesting them inside `.ios-app` breaks scroll / sheet positioning — see [build skill](skills/pinpoint-build/SKILL.md) §1.1.

**Safe area:** custom nav / composer must use `--ios-safe-top` / `--ios-safe-bottom` (Variables in `ios-kit.css`); do not hardcode px or spacer divs — see [build skill](skills/pinpoint-build/SKILL.md) §1.2.

Glass chrome: use `.ios-glass` / `.ios-glass-pill` (tokens in `ios-kit.css`). Add `.ios-glass--liquid` only for Chromium refraction wow on sparse chrome — not full-page surfaces.

Captions: write copy only. Sizes come from `--wb-cap-section` / `--wb-cap-screen` (fractions of `--wb-phone-w`).

Frame Notes are durable prototype context, not review annotations. Put a multiline `note` on a screen entry in `board.json`; it renders below the frame and can also be edited inline in the Workbench. Browser edits write back to that same `board.json` with revision checks.

Image export is Workbench-owned. Use the persistent `…` menu on every Frame title (or the
always-visible Section image button); default is
isolated 2× WebP on `#faf8f4`. **干净画面** omits captions/notes for a Frame and notes for a
Section; **带说明** includes Frame Notes. Agent CLI uses the same Chromium renderer:
`npm run export -- --page <page> --section <section> [--frame <screen>]`. Do not add screenshot
logic to individual screen fragments.

## Skill routing

| Task | Open |
|---|---|
| Add page / section / screen / component / interactive frame | [`skills/pinpoint-build/SKILL.md`](skills/pinpoint-build/SKILL.md)（组件何时抽：§4.0；safe area：§1.2） |
| Annotate → read annotations → revise | [`skills/pinpoint-annotate/SKILL.md`](skills/pinpoint-annotate/SKILL.md) |
| Register / verify a registry dir or url entry | [`skills/pinpoint-annotate/SKILL.md`](skills/pinpoint-annotate/SKILL.md) §2 |
| Tokens / class vocabulary / knobs | [`README.md`](README.md) |
| Export a Frame / Section image | [`README.md`](README.md#export-frame--section-images) |

Component includes support `data-text` → `[data-ios-slot="text"]` plus named
`data-slot-<name>` → `[data-ios-slot="<name>"]`. Use named slots when two screens share one
component/state model but vary copy or progress; do not fork visual variants only to swap text.

## Canonical board schema

Live reference: [`previews/library/board.json`](previews/library/board.json).

```json
{
  "sections": [
    {
      "id": "onboard",
      "title": "Onboarding",
      "layout": "column",
      "screens": ["onboard"]
    },
    {
      "id": "msg-flow",
      "title": "锁屏 → 消息 → 回复",
      "layout": "row",
      "screens": [
        { "id": "msg-lock", "title": "1 · 锁屏通知", "shell": "lock" },
        { "id": "msg-thread", "title": "2 · 查看消息", "note": "场景：用户点开通知。\n交互：进入对应会话。" }
      ]
    }
  ]
}
```

- Top level is **`sections[]`**, not a flat `{ id, screens }` object.
- Page id / title / order / default live in **`previews/_index.json`**; a gitignored
  `previews/_index.local.json` (same shape) overrides it for long-lived instances.
  Registry `dir` entries (except the workbench's own `pinpoint` entry) are appended
  as pages from `GET /registry`: mode comes from the entry's `board` field (default
  `web`), and their board/screens load read-only from `/sites/<entry-id>/`. A previews
  page with the same id wins over a registry page.
- Screen file = `previews/<pageId>/<screenId>.html` (fragment: `.ios-app` + sibling overlays; no bezel).
- Frame Note = optional `screens[].note` in `board.json`; durable design context shown below the frame. It is distinct from disposable review annotations.
- Interactive screens: same-file `data-preview-script` and/or sidecar `previews/<pageId>/<screenId>.js` (`data-preview-mount`). See **Interactive frames** below.
- Default shell: **app**. Lock: `"shell": "lock"` on section or screen + `.ios-lockscreen`.
- `section.id` stamps `[data-ann-section]` → annotation `section`.
- Board hierarchy for agents: **page → canvas → section → frame**; **screen** = content inside a frame (`screenId` = frame id).
- Annotate modes: **标注** (A) vs **交互** (default). Global indicators are `@page:` /
  `@section:` / `@frame:` / `@a:`; annotation-local targets use persisted `[@t:iN]`
  tokens displayed as `[indicator N]` — see [annotate skill](skills/pinpoint-annotate/SKILL.md).

## Interactive frames (A+B)

Workbench mounts screen HTML via `innerHTML`, so bare `<script>` never runs. Custom gestures stay with the screen; kit only provides tabs / sheet / segmented / clock.

| Form | When | How |
|---|---|---|
| **A · inline** | Short logic | `<script data-preview-script>` (classic: `root` in scope) or `<script type="module" data-preview-script>export default function mount(root){…}</script>` |
| **B · sidecar** | Longer logic | `previews/<page>/<screenId>.js` exporting `default function mount(root)`; mark root with `data-preview-mount`, or `<script type="module" data-preview-script src="./screenId.js">` |

- `root` = that screen’s `.ios-app` / `.ios-lockscreen` (override: `data-preview-root="css"`). Sheets live outside `root` — query via `root.closest('.ios-screen')`.
- `mount` may return an `unmount` function (or `{ unmount }`); board reload / HMR calls it first.
- Examples: `previews/library/recipe.html` (form A) · `previews/library/timer.html` + `timer.js` (form B).
- **Do not** add product gestures to `ios-kit.js` or special-case them in `afterMount`.

## Annotation routing

| Field | Meaning |
|---|---|
| `entry` | Registry entry id — the bucket the document lives in (default `pinpoint`) |
| `pageId` | Workbench page = `data-vpage` (`library`, `components`, or custom) |
| `section` | Board section `id` (legacy: `group`) |
| `screenId` | Frame / screen file id |
| `content` | Annotation body (legacy: `comment`) |
| `path` | Shell page (usually `index.html`) |

Element annotations always write `targets: [{ ref, selector, text }]`; stable refs are
`i1`, `i2`, … and are never renumbered after deletion. Top-level `selector` / `text`
mirror the first target as compatibility aliases. `[@t:iN]` resolves only within that
annotation and never enters `mentions[]`; `[@a:id]` keeps its cross-annotation meaning.

- Component Library annotations → edit `kits/ios/components/<id>/`.
- Flow node with `data-ios-from="bubble/outgoing"` → prefer that component source.
- Flow screen annotations → `previews/<pageId>/<screen>.html` only.
- Annotations made under `/sites/<entry-id>/` → edit the file on disk inside the registered
  directory (the service itself is read-only).
- Overlay is stage-scoped; canvas/sidebar show active page annotations. `goToMark` switches page
  when needed, then focuses the owning frame through `workbench/lib/board-navigation.js`; only legacy marks
  without `screenId` fall back to centering the raw anchor.
- Canvas draws **live anchors only**. If a selector no longer resolves after HTML edits, the annotation stays in the sidebar as **锚点失效** (no ghost frame). Brokenness is computed at render time, not stored.

Annotations live in per-entry buckets `~/.pinpoint/<entry-id>/*.json`
(**disk SSOT**) as `annotations[]` — entries come from `~/.pinpoint/registry.json`
(`PINPOINT_REGISTRY` overrides); this repo annotates under entry `pinpoint`.
Read the exact default-bucket path from the `dataDir` field of
`GET /health`; `PINPOINT_DATA_DIR`
overrides the data root wholesale (e2e uses this). The pre-rename
`HTML_ANNOTATE_DATA_DIR` / `HTML_ANNOTATE_REGISTRY` still apply with a deprecation
warning when the new name is absent.
`POST /save` requires `baseRevision` (integer ≥ 0; mismatch → `409 revision_conflict` with
the disk doc); clear uses the same save queue with `annotations: []`
(there is no `/clear` route). An explicit `entry` that is not registered is a loud
`400 unknown_entry` — misconfiguration never silently lands in the wrong bucket. The browser
`localStorage` cache is not authoritative. On boot
the client hydrates from disk; `GET /events` (SSE, `event: annotations`, payload carries
`entry` / `page` / `revision`) keeps open browsers near-realtime.
`GET /annotations` (no page) is a debug aggregate flattening every bucket into
`[{entry, ...doc}]`; per-page reads take `?entry=<id>`, as does `GET /images/<name>`.
**Workbench prefs** (active page, zoom, sidebar, theme) stay in browser `localStorage`
(`pinpoint-wb`) — viewer state, not synced.

## Registry and injection contract

**登记过才注入** — the annotate client only ever lands on registered targets; everything
else opens byte-identical pages with zero annotation surface.

**Registry** (`server/lib/registry.js`): `~/.pinpoint/registry.json`,
`PINPOINT_REGISTRY` overrides. Shape `{"version":1,"entries":[...]}`; entry
`{id, title?, kind: "dir"|"url", path? | url?, board?}`; id must match
`^[a-z0-9][a-z0-9-]*$` and be unique; `title` defaults to id; `board` (`ios`/`web`/`html`)
only matters for dir entries' workbench page mode. A missing file means the default
pinpoint-only registry (`{id:"pinpoint", kind:"dir", path:<repo root>}`). Malformed JSON or
a wrong top-level shape falls back to the default with the error recorded; invalid entries
are skipped individually; a missing dir path is a warning, not a removal. All of it is
visible on `GET /health` (registry summary — `entries` there is a **count**) and
`GET /registry` (full `entries` list plus `service.directOrigin`).

**Delivery paths** (one client, `client/annotate.js` → `/annotate.js`):

1. **Workbench's own pages** — `ios-kit.js` self-injects `/annotate.js` on loopback /
   `.localhost` hosts only (opt out: `<html data-annotate="off">`). Standalone docs copy the
   same tail script and call `pinpoint.setFloatingToolbar(true)` when not embedded — see
   `previews/doc-library/sample-report.html`.
2. **`dir` entries → `/sites/`** — `server/sites-api.js` serves the registered directory
   read-only under `/sites/<entry-id>/<path…>` (GET/HEAD only, 405 otherwise). The registry
   is the whitelist: unknown ids 404; `..` traversal is rejected textually and symlink
   escapes via realpath containment; directories fall through to `index.html`. HTML GET
   responses get `<script>window.__pinpointEntry='<id>'</script><script src="/annotate.js"></script>`
   injected before `</body>` (appended when there is no `</body>`); `?annotate=off` serves
   the exact disk bytes — the workbench inline fragment loader and export rendering use it.
   Dir entries also surface as workbench pages (see Canonical board schema).
3. **`url` entries → browser extension** — `extension/` is an MV3 extension whose content
   script (top frame only, `localhost` / `*.localhost` / `127.0.0.1` matches) probes
   `https://pinpoint.localhost/registry` then the page's own origin; first JSON wins. When
   `location.origin` exactly matches a registry `url` entry it stamps
   `<html data-pinpoint-entry="...">` (a page CSP blocks content-script-injected inline
   `<script>`; `window.__pinpointEntry` remains the same-origin injector contract and wins
   when both exist) and loads `annotate.js` from `service.directOrigin` — the API's plain
   loopback bind — because Chrome ≥130 checks content-script-injected scripts against the
   extension's own CSP, which whitelists `http://localhost:*` / `http://127.0.0.1:*` but not
   remote https origins. No candidate serving a registry → service is down → nothing is
   injected. All annotate API routes answer cross-origin requests with
   `Access-Control-Allow-Origin: *` (no credentials) and handle `OPTIONS` preflights.

**Client ledger** (`client/annotate.js`): the bucket entry is
`window.__pinpointEntry` → `<html data-pinpoint-entry>` → `'pinpoint'`; API calls go to the
origin the script was loaded from. The page key is
`decodeURIComponent(filename) + '~' + hash31(pathname).toString(36)`
(`lib/annotate-page-key.js`), so the same filename in different directories gets different
ledgers. SPA route changes re-key the ledger (entry / page / localStorage key) without a
reload — Navigation API `navigate` events first, patched `pushState`/`replaceState` +
`popstate` fallback; hash-only changes do not re-key, and in-flight sync/hydrate responses
from before a switch are discarded by epoch so marks never land on the previous route.

**Client chrome:** on non-workbench pages (`/sites/`, extension-injected) the floating
toolbar hides by default — **A** toggles annotate mode, and the annotation panel
(`#ann-sidebar`) opens from the **pinpoint toolbar icon** (main entry; MV3
`action.onClicked` → tab message → content script relays a CSP-safe DOM
`CustomEvent('pinpoint:command')` to the client), with the toolbar「列表」button and
**S** as secondary entries. The panel header carries a「交互 | 标注」segmented mode
switch; below it current-ledger marks sorted by `n`, click to jump, hover for
edit/delete, broken-anchor tags; open state persists as a localStorage viewer
preference, default closed. The panel is suppressed wherever `window.workbench`
exists or the document runs embedded in a frame — same one-control-surface rule as the
toolbar.

**Export purity:** doc exports accept `sites/<entry-id>/…` srcs and are guaranteed free of
the injected client — the pipeline requests `?annotate=off`, aborts `**/annotate.js` in the
render browser, and `stripAnnotateBootstrap` removes the injected snippet (including the
`__pinpointEntry` marker) from exported HTML.

## Workbench UX (prefs)

- **Sidebar**: collapse via header toggle / stage expand / splitter (click when collapsed, dblclick to collapse). Prefs: `sideCollapsed`, `sideWidth`.
- **Viewport**: per-page `pageViewports[pageId]` stores scroll + zoom (zoom single-source; no top-level `canvasZoom`).
- **Stage pan**: Space+drag or middle-button drag anywhere; left-drag only on empty board chrome (not inside `.ios-stage` / `.wb-comp-stage`) so frame clicks/scrolls work.
- **Canvas toolbar**: always visible at bottom-right; Section Navigator and the layered
  Canvas → Section → Frame minimap are independent persistent toggles. Open panels dock right
  and stack vertically in toolbar order. Ctrl/meta + wheel zooms. Both navigation modes must
  resolve geometry and focus policy through `workbench/lib/board-navigation.js`; never navigate using the
  `.wb-screen` wrapper because row layout makes it `display: contents`.
- **HMR**: edits under `previews/<page>/**` (html/js/board) or `kits/ios/components/**` refresh the board.

## Template vs instance

The repo ships template content only (Example Library + system components). A long-lived
instance layers private content on top without touching tracked files:

- `previews/_index.local.json` (gitignored) overrides the page manifest.
- Component dirs not listed in `kits/ios/components/_index.json` are auto-discovered and appended.
- `~/.pinpoint/registry.json` (machine-local) registers external dirs/urls as review
  targets — no repo change at all.
- `PREVIEW_TEMPLATE_ONLY=1` hides the in-repo overrides — used by e2e and release verification.

## Smoke checklist

1. Add a screen to Example Library (`board.json` `sections[]` + `previews/library/<id>.html`).
2. Add a new workbench page (`previews/<pageId>/` + one `previews/_index.json` entry).
3. Interactive screen: sidecar `mount(root)` + `data-preview-mount` (or inline `data-preview-script`); do not edit `ios-kit.js`.
4. Read annotations grouped by `pageId` then `section` (and `screenId` when present); edit the routed file; do not clear annotations for the user.
5. Register a `dir` entry in the machine registry; verify `GET /registry` lists it,
   `/sites/<id>/` serves HTML with `window.__pinpointEntry` injected, `?annotate=off` is
   byte-identical to disk, and the workbench lists it as a page. For a `url` entry: load
   `extension/` unpacked, browse the origin with the service up, and confirm the toolbar
   appears (and stays absent when the service is down).
6. Resolve `content` target tokens against the same annotation's `targets[].ref`; keep
   missing refs visible instead of guessing another target.
7. After addressing annotations, summarize the concrete changes in the agent conversation;
   leave review and annotation cleanup to the user.

## Anti-patterns

- Flat `board.json` without `sections[]`
- Nesting sheet / backdrop / tabbar inside `.ios-app` (must be fragment-top siblings)
- Editing loader chrome to satisfy an annotation
- Product gestures / screen state in `ios-kit.js`
- Setting caption font sizes in screen HTML or ad-hoc CSS
- Hand-injecting `/annotate.js` into unregistered pages — register a `dir`/`url` entry
  instead; unregistered surfaces stay clean by contract
- Committing machine-local registry content or instance-private pages into tracked files
