# pinpoint

**A local visual feedback service for high-fidelity UIUX prototypes — your agent builds and revises them, you review the real thing in a browser and hand feedback back through annotations.**

pinpoint runs as one persistent local service (`https://pinpoint.localhost`) with three layers:

- 🧰 **Kits** — accumulated design specs. `kits/ios/` (HIG-accurate, CJK-safe, zero runtime deps) is the first kit, not the product; the layout leaves room for future web/html kits.
- 🖥️ **Workbench / canvas** — a Figma-like multi-page viewer for comparing prototype variants side by side. Three boards: **iOS** (phone chrome), **Web** (960px artboard), **HTML** (whole-document iframe with a version sidebar).
- ✏️ **Annotation** — the core layer and the human→agent feedback loop. Marks made in the browser land on disk for the agent to read and act on. One client, injected only into what you registered — see [Registry and injection](#registry-and-injection).

Also: 🤖 **agent-native** ([`AGENTS.md`](AGENTS.md) + in-repo skills teach any coding agent the contracts), 🖼️ **doc-ready export** (Frame picker → isolated 2× PNG / zip), 🔁 **HMR** (edit a screen or component, the open board refreshes in place).

设计：[`DESIGN.md`](DESIGN.md) 是设计语言正典——写 / 改任何 UI 前先读；裁决来路见 [`decisions.md`](decisions.md)。

New here? Open **[`QUICKSTART.html`](QUICKSTART.html)** in a browser — 10-minute onboarding with the concept glossary.

## Quickstart

```bash
brew install just         # once per machine
npm install -g portless   # once per machine
npm install
just dev             # https://pinpoint.localhost/index.html
```

[`Justfile`](Justfile) is the workflow entrypoint. Normal development runs through
[Portless](https://github.com/vercel-labs/portless); install both CLIs once per machine.
Use `npm run dev:direct` only when debugging the proxy boundary; it falls back to
`http://127.0.0.1:5199`.

Then tell your agent:

> 读一下 AGENTS.md，然后在 Example Library 加一屏 XXX

Verify changes:

```bash
npx playwright install chromium   # first browser-test run only
just check                        # node contracts + template-only workbench e2e
```

Requires Node ≥ 24 and [just](https://just.systems/).

## Export Frame images

Open the export picker from the canvas HUD's **导出** button — the single entry point
(decisions 2026-08-15d). The picker shows the current page's proto tree (section rows select
all their frames, frames check freely), a live preview of the selected frames, and the only
option that changes the delivered pixels: background (**画布** paper grid / **白底** /
**透明**). Output is fixed **PNG 2×**. Captions (A1 ref + screen title + dim line) and Frame
Notes are drawing content and always ride along. One selected frame downloads a PNG directly;
several frames are packed into a zip on the server (`POST /api/export-zip`, store-only).

Export snapshots the live DOM before rendering in an isolated Chromium surface, so open sheets,
Ask User panels, selected controls, form values, internal scroll positions, and canvas output are
kept. The default filenames are stable and document-friendly:

```text
library__brew-flow__timer@2x.png
library__frames@2x.zip
```

Agents and scripts use the same renderer (start `npm run dev` first):

```bash
npm run export -- --page library --section brew-flow --frame timer
npm run export -- --page library --section brew-flow
```

Output defaults to gitignored `exports/`. Options: `--scale 1|2`,
`--background canvas|white|transparent`, `--format png|webp`, and `--output <path>`.
Transparent output requires PNG; very large 2× Sections fail with a clear 1× retry hint instead
of silently wrapping or clipping the flow.

## Mental model (three layers)

| Layer | What | Where |
|---|---|---|
| **Kits** | Design-spec accumulation: tokens, primitives, product components (≈ Figma Variables + Components) | `kits/<kit>/` — today `kits/ios/` (`ios-kit.css/js` + `components/`); more kits can sit alongside |
| **Workbench** | Multi-scheme prototype viewer: pages, canvas, boards, export, HMR | `index.html` + `workbench/` + `previews/` |
| **Annotation** | Human→agent feedback loop: browser client, disk store, injection contract | `client/annotate.js`, `server/annotate-api.js`, `server/sites-api.js`, `extension/` |

Agent work stays in **screen fragments** (`*.html` + optional sidecar `*.js`) and
**components**; chrome (device bezel, status bar, home indicator) is loader-owned and
not an edit surface. Product gestures use screen scripts (A+B), not `ios-kit.js`.

Board hierarchy: **page → canvas → section → frame**; a **screen** is the content
inside a frame. These five words are also the annotation address space (`@page:` /
`@section:` / `@frame:`), so humans, agents, and the tooling all speak the same names.

## Repository layout

```
AGENTS.md              Agent entry — contracts + routing (read first)
Justfile               Canonical dev, check, dev-push, and main-publish workflows
QUICKSTART.html        Human onboarding — concepts + usage, self-contained
index.html             WORKBENCH shell — Pages (Component Library pinned first) + Theme controls
workbench/             Board loader, data-ios-include, preview-script mount (A+B), HMR client
client/annotate.js     The annotation client (served as /annotate.js)
server/                Vite plugins: annotate/sites/export APIs, components-board, preview-hmr, template-only; lib/site-proxy.js = same-origin proxy for url entries (lib/annotate-snippet.js = injection SSOT)
lib/                   Node-tested isomorphic libs inlined into /annotate.js (page key, indicator, slug, clip, bubble, ann-row) + proxy-rebase.js (runtime URL rebase for proxied pages) + ann-list.css (shared list rows)
kits/ios/ios-kit.css   iOS kit: variables + chrome styles + primitive CSS
kits/ios/ios-kit.js    iOS kit runtime — auto-fit, tabs/sheet/segmented, live clock; localhost annotate inject
kits/ios/components/   Component Library sources (meta.json + variant HTML)
previews/<page>/       Flow pages — board.json + screen HTML (+ optional <screen>.js)
previews/_index.json   Page manifest (id / title / order / default / mode)
extension/             MV3 browser extension — injects the client on registered url entries (the own-origin path; the /sites/ proxy embed is the extension-free one)
skills/                Agent skills (dir-ref, tool-agnostic) — build + annotate contracts
starter.html           COPY-ME standalone one-off phone (no workbench needed)
scripts/               CLI entry for export
e2e/                   Playwright workbench / registry / extension tests
```

## Pages

Workbench **Pages** (top → bottom):

1. **Component Library** (system, always present) — synthesized from `kits/ios/components/*/meta.json`.
   Variants render on a light board (`.wb-comp-stage`), not inside phone chrome.
2. **Example Library** — `previews/library/`: a complete fictional app（冲煮手账）exercising
   every mechanism: cards/lists/tab/sheet home, a 3-screen flow with inline-script and
   sidecar interactive frames, lock screens, a message flow built from component includes,
   and an AB layout comparison.
3. **Example HTML** — `previews/doc-library/`: a standalone one-page report on the HTML board.

Beyond the tracked examples, pages come from two more sources: gitignored
`previews/_index.local.json` (instance-private override of the manifest) and registry
`dir` entries (external directories surfaced read-only — see below).

Click a page to switch boards. Add your own pages next to `library/` — see recipes below.

### Add a flow screen

One content fragment + one entry in that page’s `board.json` **`sections[]`**.
Canonical example: [`previews/library/board.json`](previews/library/board.json).
The loader wraps the phone shell — fragments never include a bezel.

```html
<!-- previews/library/onboard.html — in-screen fragment (no bezel) -->
<div class="ios-app">
  <div class="ios-nav"><h1>欢迎</h1></div>
  <div class="ios-page">…</div>
</div>
<!-- sheet / tabbar / backdrop: siblings of .ios-app, never inside it -->
```

```json
{
  "sections": [
    { "id": "onboard", "title": "Onboarding", "layout": "column", "screens": ["onboard"] }
  ]
}
```

Row flows with per-screen titles / shells:

```json
{
  "id": "msg-flow",
  "title": "锁屏 → 消息 → 回复",
  "layout": "row",
  "screens": [
    { "id": "msg-lock", "title": "锁屏通知", "shell": "lock" },
    {
      "id": "msg-thread",
      "title": "查看消息",
      "note": "场景：用户点开通知。\n交互：进入对应会话。"
    }
  ]
}
```

`screens[].note` / `sections[].note` is a durable **note**. It explains the scene,
interaction, or capability being tested; both the agent and the user edit the same
`board.json` SSOT (select the frame/section on the canvas, then read/edit in the
right-hand detail panel — revision-safe writes). Notes are part of the prototype
definition and are not rendered on the canvas itself. Review annotations remain
separate, disposable feedback. Titles stay single-line short noun phrases — no
hand-written numbers (refs are system-derived), no legends in titles.

For gestures / animation, add screen scripts (form A inline / form B sidecar) — full contract
in the [build skill](skills/pinpoint-build/SKILL.md); live examples
`previews/library/recipe.html` (A) and `previews/library/timer.{html,js}` (B).

### Add a workbench page

1. Create `previews/<pageId>/board.json` + screen HTML files.
2. Add the page to `previews/_index.json` (`pageId` becomes annotate `pageId` / `data-vpage`).
3. Do not invent a second loader — the manifest generates navigation.

To review a project that lives **outside** this repo, register it as a `dir` entry instead —
it shows up as a workbench page served from `/sites/<entry-id>/` (read-only), no copying.

### Add a reusable component

Component Library is for **reusable / variant-review atoms**, not every UI block.
Default: compose in the screen; extract to `kits/ios/components/` when you reuse across screens,
need a variant wall, or expect “change this widget” annotations. Full gate:
[build skill §4.0](skills/pinpoint-build/SKILL.md).

```
kits/ios/components/bubble/
  meta.json            { id, title, system, layout, variants: [{id, title}] }
  incoming.html        fragment (single element or a full .ios-app catalog screen)
  outgoing.html
```

Include it in any screen — edit the source once, every consumer refreshes:

```html
<div data-ios-include="bubble/outgoing" data-text="好的，我先看。"></div>

<div data-ios-include="your-card/default"
     data-text="冲煮完成"
     data-slot-detail="总时长 3:12 · 粉水比 1:16"></div>
```

`data-text` fills `[data-ios-slot="text"]`; named `data-slot-<name>` attributes fill matching
`[data-ios-slot="<name>"]` nodes. Slots vary content/state while the component keeps one visual
and semantic contract.

`system: true` marks kit primitives (Buttons, Lists, …) — keep those few and stable.
Product components use `system: false`.

## Annotation review loop

Mark up a preview — Figma-style — and have your agent read marks and revise.

1. Press **A** to switch 交互 → **标注**; click / lasso elements, write comments in the
   bottom composer (pills reference targets; `[indicator N]` inlines them), paste reference
   images, draw move-arrows.
2. Say「标好了，你看一下」— the agent reads the annotation documents (disk SSOT in per-entry
   buckets under `~/.pinpoint/<entry-id>/`, exposed by `GET /health`; revisioned,
   SSE-synced) grouped by `pageId → section → screenId`, edits the routed source file, and the
   board hot-reloads. The agent summarizes what changed and why in the conversation.
3. Click any sidebar comment to focus its owning frame (the same geometry as frame navigation),
   review the visual change, then clear resolved marks and repeat.

Short locators for chat: `@page:library` · `@section:library/brew-flow` ·
`@frame:library/timer` · `@a:<id>`. Full schema and routing rules:
[annotate skill](skills/pinpoint-annotate/SKILL.md).

Annotations are per-machine (solo human + agent loop), not a multiplayer comment system.

## Mention live frames in documents

A doc page (HTML shell) can **mention a canvas frame** in its body copy — the mount hydrates
into the *live* frame (the same fragment as on the canvas, interactive, scripts running):

```html
<div data-pinpoint-frame="library/timer"></div>
```

- The value is the existing `@frame:` identity: `<pageId>/<screenId>`
  (Component Library variants spell it `components/<comp>/<variant>`). Unknown refs keep the
  empty mount and get `data-pinpoint-frame-error="bad-ref"`.
- Hydration is done by the doc's own annotate client: each mount becomes an iframe to
  `GET /api/frame?page=<id>&screen=<id>`, which serves a self-contained document (fragment +
  phone chrome + ios-kit + preview-script runtime; doc-shell screens 302 to their own URL —
  same ledger by pathname). Style isolation comes free with the iframe; the iframe auto-sizes
  to content height.
- **Annotations pass through both ways.** Marks made inside an embedded frame land in the
  canvas ledger (same bucket file as the workbench board, row stamped `pageId` + `screenId` +
  `section`), and both surfaces render them in realtime over SSE. Anchors bind to *the frame*:
  the stored selector carries the stage segment, and each view normalizes it to a
  frame-internal path at resolve time (pageId + screenId + `:scope` chain) — so a frame moved
  or reordered on the canvas self-heals instead of going 锚点失效, and pre-existing marks keep
  working unchanged (no schema migration).
- **Mode routing matches the canvas**: the sidebar's 标注/交互 toggle reaches the doc's annotate
  instance and cascades into every embedded frame — 标注 mode clicks inside a frame annotate,
  交互 mode runs the prototype (frame JS keeps running in both modes).
- Doc-body annotations (marking the document's own text) stay in the document's own bucket —
  two namespaces, no interference: 文档的归文档，frame 的归 frame（画布板的桶）.
- **Export bakes frames statically.** Doc export (导出 → HTML 完整 / 去除 CSS / 长图 PNG)
  replaces each mount with a 2× PNG rendered by the existing `/api/export-image` pipeline
  (doc-shell screens bake through the doc long-image renderer; HTML 去除 CSS swaps in a text
  reference `[嵌入 Frame：…]` instead of an image). Baked exports are inert — no annotate
  client, no live frames.

A local demo page lives at `previews/mention-demo/` (instance-local, gitignored) — mention
Example Library frames there to see the loop end to end.

## Registry and injection

The annotation layer never touches a page you didn't register — **登记过才注入**. The
registry at `~/.pinpoint/registry.json` (`PINPOINT_REGISTRY` overrides) declares
entries:

```json
{
  "version": 1,
  "entries": [
    { "id": "pinpoint", "title": "pinpoint workbench", "kind": "dir", "path": "/path/to/pinpoint" },
    { "id": "your-app", "title": "Your App", "kind": "dir", "path": "/path/to/your-app/dist", "board": "html" },
    { "id": "one-pager", "title": "One Pager", "kind": "file", "path": "/path/to/report.html" },
    { "id": "your-spa", "title": "Your SPA", "kind": "url", "url": "https://your-app.localhost" }
  ]
}
```

The supported way to add entries is the CLI — `npm link` once puts `pinpoint`
on your PATH; otherwise run `node bin/pinpoint.mjs` from this repo:

```bash
pinpoint add /path/to/your-app/dist      # existing dir → kind "dir", hosted at /sites/<id>/
pinpoint add ./report.html               # single .html/.htm file → kind "file"
pinpoint add https://your-app.localhost  # http(s) URL → kind "url" (proxy-embedded; extension also works)
pinpoint add ./dist --title "Your App" --board ios --id your-app
pinpoint add ./draft.html --page weekly-review --draft
                                         # attach to an existing page's 内容 section
                                         # (draft group with --draft, product group without)
                                         # instead of adding a Pages row
```

The CLI derives the id from the basename (slugified; `-2` / `-3` appended on
conflict — an explicit `--id` that collides errors out instead of overwriting),
defaults `title` to the basename and `--board` to `html` (`--board` only matters
for `dir` entries — `file` entries always open in the doc reader, so `--board ios`
on a single file is rejected), and writes the
registry atomically (`--registry` / `PINPOINT_REGISTRY` override the file, so
scripts and tests never have to touch the real one). When the service is
reachable it then calls `POST /registry/reload` and the entry takes effect
without a restart — serving, injection, bucket routing, and the Pages list of
any open workbench all pick it up; otherwise the entry activates on the next start.

With `--page <pageId>` (2026-08-16f 阶段 8) the entry carries a `page` field and is
**attached to an existing page** instead of becoming one: it shows up as a doc entry
in that page's 「内容」 section (draft group with `--draft`, product group otherwise).
The target must resolve — a local manifest page or another registry entry id; the CLI
checks before writing and errors loudly otherwise. `url` entries are always
standalone pages, so `--page` is rejected for them. Deleting the registry entry (or
its target page) simply makes the row disappear — no dead rows, no sidebar errors.

Registered `dir`/`file`/`url` entries appear as workbench pages; the board comes from
`/sites/<id>/board.json` — a disk file when present, otherwise a synthesized doc
board (a `file` entry's single screen; a `dir` entry's top-level `*.html`, one
screen each; a `url` entry's single proxied screen), so「registered」always
means「opens readable and annotatable」.

`GET /registry` returns the effective entries. A missing file means the default
pinpoint-only registry; malformed JSON or invalid entries fall back / are skipped loudly and
the failure is visible on `GET /health` (which also reports `dataRoot` and the default-bucket
`dataDir`). Entry ids match `^[a-z0-9][a-z0-9-]*$`; annotations land in per-entry buckets
`~/.pinpoint/<entry-id>/` (`PINPOINT_DATA_DIR` overrides the root wholesale).

One client (`client/annotate.js`, served as `/annotate.js`), delivered three ways —
workbench self-injection, `/sites/` static serving, and url entries, which have **two**
coexisting paths (both annotate into the same per-entry bucket):

- **Workbench's own pages** — `ios-kit.js` self-injects the client on loopback / `.localhost`
  hosts only (opt out with `<html data-annotate="off">`); the same one-liner works for any
  standalone kit page. The pull is same-origin, so on any other server it simply 404s into a
  no-op.
- **`dir` entries** — the service serves the registered directory read-only under
  `/sites/<entry-id>/`. The registry is the whitelist: unknown ids, `..` traversal, and
  symlink escapes all 404; directories fall through to `index.html`. HTML GET responses get
  `<script>window.__pinpointEntry='<id>'</script><script src="/annotate.js"></script>`
  injected before `</body>`; `?annotate=off` serves the exact disk bytes (export paths and
  the workbench's inline fragment loader use it). Registered dirs also appear as workbench
  pages, with the entry's `board` field selecting the page shell (`ios` / `html`,
  default `html`). **`file` entries** get the same treatment for exactly one registered
  file: `/sites/<entry-id>/` and `/sites/<entry-id>/<basename>` both serve it, everything
  else (including sibling files in the same directory) 404s, and they appear as workbench
  pages too (always the doc shell — a single standalone document only has reader
  semantics). Entries without their own `board.json` stay readable: `/sites/<id>/board.json`
  then serves a **synthesized doc board** — one screen for a `file` entry, one screen per
  top-level `*.html` (sorted, one sidebar version each) for a `dir` entry — while a disk
  `board.json` always wins. No synthesis happens for `ios`-board dirs (a phone-canvas board
  needs hand-written sections) or dirs without any top-level HTML (404, matching the
  whitelist-nothing-to-read semantics).
- **`url` entries** — two coexisting paths into the same entry bucket:
  - **Same-origin proxy embed** (阶段 4, no extension needed) — the service proxies the
    registered origin under `/sites/<entry-id>/` (`server/lib/site-proxy.js`), so the live
    app renders inside the workbench's doc-shell iframe same-origin, with the annotate
    client injected by the proxy layer and the sidebar driving it directly. Method/headers/
    body pass through; responses get `Set-Cookie` rebased (Domain stripped, Path
    prefixed), 3xx `Location` rewritten back under the prefix, and CSP/X-Frame-Options/
    COOP/COEP stripped (the page must enter an iframe and run the inline bootstrap). HTML
    responses get root-absolute `src`/`href`/`action`/`srcset`/… rewritten onto the
    prefix; CSS gets `url(/…)` rewritten. What HTML rewriting cannot reach —
    `fetch('/api/…')`, XHR, `EventSource`, `WebSocket`, `sendBeacon` inside JS — is
    covered by an inline **rebase bootstrap** injected as the first `<head>` script,
    monkey-patching those APIs (`lib/proxy-rebase.js`); the annotate client's own
    endpoints (`/save`, `/annotations…`, `/images/…`, `/image`, `/events`,
    `/annotate.js`, `/sites/…`) are exempt by name. The bootstrap also **virtualizes
    the URL** (`history.replaceState` back to the unprefixed app path before any page
    script runs), because SPA routers read `location.pathname` — a native getter no
    patch can intercept — and would fall through to their catch-all under the prefix.
    Side effect (intended): the annotate ledger keys on the app path (`/`, `/global`,
    …), converging byte-for-byte with the extension-injected ledger on the app's own
    origin. WebSocket upgrades under the prefix
    are forwarded to the target as a generic fallback (vite `httpServer` 'upgrade').
    `?annotate=off` drops only the annotate client — the bootstrap and URL rewrites stay,
    because they are proxy mechanics, not annotation surface. The url entry's
    `board.json` is always synthesized locally (single doc screen, `src = sites/<id>/`),
    shadowing any upstream file of that name. Known blind spots: DOM-assigned URLs
    (`img.src = '/x.png'` — no patch intercepts property assignment), unquoted HTML
    attributes, protocol-relative (`//…`) URLs, target app routes colliding with the
    exempt pinpoint API names above (they would hit pinpoint instead),
    `localStorage`/`indexedDB` shared with the workbench origin (same-origin embedding
    means same storage partition), and virtualization hazards: `location.reload()` in
    the app reloads the virtual URL (an embedded iframe refresh then loads the
    unprefixed path on the pinpoint origin), and hard navigations
    (`location.href = '/x'`) leave the proxy — router-intercepted SPA links are fine.
  - **Browser extension** — the MV3 extension in [`extension/`](extension/) still matches
    `location.origin` against url entries on local-dev pages and injects the same client,
    stamping the entry id via `<html data-pinpoint-entry="…">`. When the service is offline
    or the origin isn't registered, the page stays untouched. The toolbar icon opens the
    annotation **side panel** (Chrome Side Panel; shell + service-hosted `panel.html`) —
    no in-page overlay. Load it once via
    `chrome://extensions` → **Load unpacked** — details in
    [`extension/README.md`](extension/README.md). Use this path when you want to annotate
    the app on its own origin (e.g. device/browser capability testing) instead of embedded
    in the workbench.

Everything else — `file://`, a self-started server, an unregistered origin — opens the
identical bytes with zero annotation surface. Exported artifacts (PNG/HTML) never contain the
injected client: the export pipeline requests `?annotate=off`, blocks `/annotate.js` in the
render browser, and strips the bootstrap from exported HTML.

On SPA pages the client follows route changes automatically (Navigation API first,
`pushState`/`popstate` fallback) and re-buckets annotations under the new pathname's ledger —
marks never silently land on the previous route's page.

## One phone, no workbench

Copy [`starter.html`](starter.html), or use the minimal skeleton:

```html
<link rel="stylesheet" href="kits/ios/ios-kit.css">
<script src="kits/ios/ios-kit.js" defer></script>

<div class="ios-stage" data-fit>
  <div class="ios-root screen-only" data-device="iphone-16-pro" data-theme="light">
    <div class="ios-device">
      <span class="ios-key act"></span><span class="ios-key vup"></span>
      <span class="ios-key vdn"></span><span class="ios-key pwr"></span>
      <div class="ios-bezel"><div class="ios-screen">
        <div class="ios-island"></div>
        <div class="ios-statusbar"><span class="ios-sb-time"></span>
          <span class="ios-sb-icons"></span></div>

        <div class="ios-app">
          <div class="ios-nav"><h1>标题</h1></div>
          <div class="ios-page"> … your screen … </div>
        </div>

        <div class="ios-home"></div>
      </div></div>
    </div>
  </div>
</div>
```

Standalone pages need the full shell; workbench screens do **not** — the loader owns chrome.

## Knobs (iOS kit)

| Attribute | On | Values |
|---|---|---|
| `data-device` | `.ios-root` | `iphone-16-pro` |
| `data-theme` | `.ios-root` | `light`, `dark` |
| `data-text-size` | `.ios-root` | `small`, `default`, `large` |
| `data-fit` | `.ios-stage` | present → scale device to container |
| `--ios-scale` | `.ios-device` | fixed scale (e.g. `0.5`) |
| `screen-only` | `.ios-root` | drop frame/bezel/keys |
| `flush` | `.ios-root` | with `screen-only`: edge-to-edge |

Everything inside `.ios-screen` renders at **true iOS points**.

## Class vocabulary (iOS kit)

- **Shell (chrome)** — `ios-stage` `ios-root` `ios-device` `ios-key.*` `ios-bezel` `ios-screen` `ios-island` `ios-statusbar` `ios-home` — loader-owned on boards
- **Type** — `ios-large` `ios-title1/2/3` `ios-headline` `ios-body` `ios-callout-t` `ios-subhead` `ios-footnote` `ios-caption/2`
- **Nav** — `ios-nav` · `ios-navbar` (`ios-nav-lead`/`-title`/`-trail`, `ios-back`)
- **Lists** — `ios-page` `ios-section` `ios-list` `ios-cell` `ios-card`
- **Controls** — `ios-btn` `ios-segmented` `ios-switch` `ios-search`
- **Status** — `ios-chip` `ios-badge` `ios-callout`
- **Overlays** — `ios-tabbar` · `ios-sheet` · `ios-sheet-backdrop` — **siblings of `.ios-app`**, not children (`.ios-app` scrolls; overlays pin to `.ios-screen`)
- **Lock** — `ios-lockscreen` `ios-notification` …
- **Utils** — `ios-muted` `ios-row` `ios-spacer` `ios-clamp1/2`

See the Component Library page for live recipes. Sheet + tabbar structure:
[`previews/library/home.html`](previews/library/home.html).

**Icons** — emoji for app/content; system chrome SVG (`#c-back`, `#c-chev`, `#c-search`) auto-injected.

## Design rules baked in (iOS kit)

- **Points, not viewport pixels** — device fixed-size, scaled as a unit.
- **Glass on the nav layer only** — content cards stay solid.
- **Grouped lists are flat** — white-on-gray, no shadow.
- **Role-based color** — `--ios-text-2`, `--ios-fill-3`, `--ios-accent`; never raw hex in app markup.
- **Tracking is CJK-safe** — body tracking `0`; don’t reintroduce negative Latin tracking.

## Development and publishing

This repository uses one Git repository with two long-lived worktrees:

| Branch / worktree role | Responsibility |
|---|---|
| **`dev` / daily worktree** | Ongoing development and the only owner of the persistent `pinpoint.localhost` route |
| **`main` / release worktree** | Clean public-template verification and publishing; no feature development or private instance content |

`main` only advances by fast-forwarding to a clean, published `dev` tip. The release
worktree has its own `node_modules`, so publishing installs the exact lockfile before
running the template-only gate.

Daily development:

```bash
just dev       # local server; no Git write
just check     # local verification; no remote write
just ship-dev  # check and push the clean dev branch to origin/dev
```

Publishing, from the release worktree on `main`:

```bash
just publish
```

`just publish` refuses dirty or divergent worktrees, requires local `dev` to match
`origin/dev`, fast-forwards `main`, runs `npm ci` plus the template-only checks, pushes
`origin/main`, and verifies that both remote branches end at the same commit. It never
force-pushes and never creates a merge commit.

## Template vs instance

Clone per project. Your content lives in `previews/<your-page>/` and `kits/ios/components/`; framework
files stay untouched, so pulling template updates is a clean overwrite of
`kits/ios/ios-kit.*` / `workbench/` / `index.html` / `client/` / `server/` / `lib/`.

For a long-lived instance, layer private content without touching tracked files:
gitignored `previews/_index.local.json` overrides the page manifest; component dirs outside
`kits/ios/components/_index.json` are auto-discovered; and the machine-local registry
(`~/.pinpoint/registry.json`) adds external dirs as read-only pages without any repo
change at all. `PREVIEW_TEMPLATE_ONLY=1` hides the in-repo overrides
(e2e and release verification run in this mode).

Pages may set `"mode"` to `ios` (default) or `html`; the Workbench Pages list is one
mixed list of untitled-type rows (2026-08-16f 阶段 7: the per-row shell pill is gone —
a page is a thread container with no type of its own). A page's `board.json` holds
**entries** — the `app`/`lock` screens form one **canvas** entry, every
`shell: "doc"` screen is a separate **document entry** (`role: "product"` default,
`"draft"` for 草稿), and a registry `url` entry's screen is a **web** entry. The stage
form (canvas vs reader) follows the selected entry (`?page=<id>&entry=<screenId>` deep
links; the choice is remembered per page). The sidebar's second layer is the 「内容」区
(`#wbcontents`): a 产物 group (canvas + document/web entries, each with a mono type
tag 画布/文档/网页; the canvas entry carries the frame tree — the old outline — under
its row) plus a 草稿 group (plain title rows). Single-entry plain-doc pages collapse
the section away entirely; canvas-only pages collapse the entry rows and keep the
tree. `"mode"` now only seeds the board's default shell and the `?mode=` deep-link
hint.

| Shell | Input | Artboard | Tracked example |
|---|---|---|---|
| **iOS** | body fragment | iPhone chrome | `previews/library/` |
| **HTML** | complete standalone document | full-viewport iframe, no canvas (`shell: "doc"`) | `previews/doc-library/` |

HTML boards host one-page reports and docs — files that carry their own `<!doctype>`, `<head>`, and
`<style>`. They render in an iframe rather than inlined, so the document is untouched; a screen's
`"src"` may point anywhere, which (with a symlink under `previews/`) lets you review a report that
lives outside this repo. Sidebar **导出** lives on each document/draft entry row (a hover icon
button in the 「内容」区) and downloads that doc as full HTML, CSS-stripped HTML (for AI), or a
full-page 2× PNG — without switching the selection. Annotating works out of the box on
the localhost service — the doc's own tail script pulls `/annotate.js` on loopback hosts only, so
the same file stays inert everywhere else (see [`AGENTS.md`](AGENTS.md)).

## Credits

The annotation system is a heavily extended fork of
[xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)
(section/page routing, disk SSOT + SSE, target composer, indicators).
