# pinpoint

**A local visual feedback service for high-fidelity UIUX prototypes — your agent builds and revises them, you review the real thing in a browser and hand feedback back through annotations.**

pinpoint runs as one persistent local service (`https://pinpoint.localhost`) with three layers:

- 🧰 **Kits** — accumulated design specs. `kits/ios/` (HIG-accurate, CJK-safe, zero runtime deps) is the first kit, not the product; the layout leaves room for future web/html kits.
- 🖥️ **Workbench / canvas** — a Figma-like multi-page viewer for comparing prototype variants side by side. Three boards: **iOS** (phone chrome), **Web** (960px artboard), **HTML** (whole-document iframe with a version sidebar).
- ✏️ **Annotation** — the core layer and the human→agent feedback loop. Marks made in the browser land on disk for the agent to read and act on. One client, injected only into what you registered — see [Registry and injection](#registry-and-injection).

Also: 🤖 **agent-native** ([`AGENTS.md`](AGENTS.md) + in-repo skills teach any coding agent the contracts), 🖼️ **doc-ready export** (Frame/Section as isolated 2× WebP/PNG), 🔁 **HMR** (edit a screen or component, the open board refreshes in place).

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

## Export Frame / Section images

Use the persistent `…` menu at the right of every Frame title and choose **导出图片…**;
Sections keep a dimmed image button beside the Section title. The export panel
defaults to **2× WebP** on the clean Canvas background; choose PNG for lossless or transparent
output. Frame export contains only the current phone state with 48 CSS px of safe padding — no
caption, Frame Note, annotation, sidebar, or neighboring Frame. Section export preserves its
row/column layout, Section title, and Frame titles. Choose **带说明** when the document should also
contain Frame Notes.

Export snapshots the live DOM before rendering in an isolated Chromium surface, so open sheets,
Ask User panels, selected controls, form values, internal scroll positions, and canvas output are
kept. The default filenames are stable and document-friendly:

```text
library__brew-flow__timer@2x.webp
library__brew-flow@2x.webp
```

Agents and scripts use the same renderer (start `npm run dev` first):

```bash
npm run export -- --page library --section brew-flow --frame timer
npm run export -- --page library --section brew-flow --with-notes --format png
```

Output defaults to gitignored `exports/`. Options: `--scale 1|2`,
`--background canvas|white|transparent`, `--format webp|png`, and `--output <path>`.
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
server/                Vite plugins: annotate/sites/export APIs, components-board, preview-hmr, template-only
lib/                   Node-tested isomorphic libs inlined into /annotate.js (page key, indicator, slug, clip, bubble, ann-row) + ann-list.css (shared list rows)
kits/ios/ios-kit.css   iOS kit: variables + chrome styles + primitive CSS
kits/ios/ios-kit.js    iOS kit runtime — auto-fit, tabs/sheet/segmented, live clock; localhost annotate inject
kits/ios/components/   Component Library sources (meta.json + variant HTML)
previews/<page>/       Flow pages — board.json + screen HTML (+ optional <screen>.js)
previews/_index.json   Page manifest (id / title / order / default / mode)
extension/             MV3 browser extension — injects the client on registered url entries
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
3. **Example Web** — `previews/web-library/`: web-board surfaces on the 960px artboard.
4. **Example HTML** — `previews/doc-library/`: a standalone one-page report on the HTML board.

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
    { "id": "msg-lock", "title": "1 · 锁屏通知", "shell": "lock" },
    {
      "id": "msg-thread",
      "title": "2 · 查看消息",
      "note": "场景：用户点开通知。\n交互：进入对应会话。"
    }
  ]
}
```

`screens[].note` is a durable **Frame Note** shown below the phone. It explains the scene,
interaction, or capability being tested; both the agent and the user edit the same
`board.json` SSOT (the Workbench provides an inline editor with revision-safe writes).
Frame Notes are part of the prototype definition. Review annotations remain separate,
disposable feedback.

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
   buckets under `~/.html-annotate/<entry-id>/`, exposed by `GET /health`; revisioned,
   SSE-synced) grouped by `pageId → section → screenId`, edits the routed source file, and the
   board hot-reloads. The agent summarizes what changed and why in the conversation.
3. Click any sidebar comment to focus its owning frame (the same geometry as frame navigation),
   review the visual change, then clear resolved marks and repeat.

Short locators for chat: `@page:library` · `@section:library/brew-flow` ·
`@frame:library/timer` · `@a:<id>`. Full schema and routing rules:
[annotate skill](skills/pinpoint-annotate/SKILL.md).

Annotations are per-machine (solo human + agent loop), not a multiplayer comment system.

## Registry and injection

The annotation layer never touches a page you didn't register — **登记过才注入**. The
registry at `~/.html-annotate/registry.json` (`HTML_ANNOTATE_REGISTRY` overrides) declares
entries:

```json
{
  "version": 1,
  "entries": [
    { "id": "pinpoint", "title": "pinpoint workbench", "kind": "dir", "path": "/path/to/pinpoint" },
    { "id": "your-app", "title": "Your App", "kind": "dir", "path": "/path/to/your-app/dist", "board": "web" },
    { "id": "your-spa", "title": "Your SPA", "kind": "url", "url": "https://your-app.localhost" }
  ]
}
```

`GET /registry` returns the effective entries. A missing file means the default
pinpoint-only registry; malformed JSON or invalid entries fall back / are skipped loudly and
the failure is visible on `GET /health` (which also reports `dataRoot` and the default-bucket
`dataDir`). Entry ids match `^[a-z0-9][a-z0-9-]*$`; annotations land in per-entry buckets
`~/.html-annotate/<entry-id>/` (`HTML_ANNOTATE_DATA_DIR` overrides the root wholesale).

Three delivery paths, one client (`client/annotate.js`, served as `/annotate.js`):

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
  pages, with the entry's `board` field selecting the board mode (`ios` / `web` / `html`,
  default `web`).
- **`url` entries** — the MV3 browser extension in [`extension/`](extension/) matches
  `location.origin` against url entries on local-dev pages and injects the same client,
  stamping the entry id via `<html data-pinpoint-entry="…">`. When the service is offline or
  the origin isn't registered, the page stays untouched. Load it once via
  `chrome://extensions` → **Load unpacked** — details in
  [`extension/README.md`](extension/README.md).

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
(`~/.html-annotate/registry.json`) adds external dirs as read-only pages without any repo
change at all. `PREVIEW_TEMPLATE_ONLY=1` hides the in-repo overrides
(e2e and release verification run in this mode).

Pages may set `"mode"` to `ios` (default), `web`, or `html`; the Workbench Pages list switch keeps
the three lists separate.

| Board | Input | Artboard | Tracked example |
|---|---|---|---|
| **iOS** | body fragment | iPhone chrome | `previews/library/` |
| **Web** | body fragment | 960px desktop artboard (`shell: "web"`) | `previews/web-library/` |
| **HTML** | complete standalone document | full-viewport iframe, no canvas (`shell: "doc"`) | `previews/doc-library/` |

HTML boards host one-page reports and docs — files that carry their own `<!doctype>`, `<head>`, and
`<style>`. They render in an iframe rather than inlined, so the document is untouched; a screen's
`"src"` may point anywhere, which (with a symlink under `previews/`) lets you review a report that
lives outside this repo. Sidebar **导出** on the Versions/Document header downloads the active doc
as full HTML, CSS-stripped HTML (for AI), or a full-page 2× PNG. Annotating works out of the box on
the localhost service — the doc's own tail script pulls `/annotate.js` on loopback hosts only, so
the same file stays inert everywhere else (see [`AGENTS.md`](AGENTS.md)).

## Credits

The annotation system is a heavily extended fork of
[xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)
(section/page routing, disk SSOT + SSE, target composer, indicators).
