# iOS App Preview

**Build pixel-honest iOS interactive prototypes in plain HTML — with your AI agent doing the building, and a Figma-style annotation loop for review.**

A single self-contained workbench: an HIG-accurate, CJK-safe iOS kit (zero runtime deps), a
Figma-like multi-page canvas, a live Component Library, and a browser annotation system whose
marks land on disk for your agent to read and act on.

- 📱 **Pixel-honest** — iPhone 16 Pro chrome, true iOS points, light/dark, Dynamic Type
- 🤖 **Agent-native** — [`AGENTS.md`](AGENTS.md) + in-repo skills teach any coding agent the contracts (Claude Code / Codex / Cursor / …)
- ✏️ **Review loop** — mark up screens in the browser（标注）, agent revises and replies on each mark
- 🖼️ **Doc-ready export** — export a Frame or Section as isolated 2× WebP / PNG without neighboring canvas UI
- 🔁 **HMR** — edit a screen or component, the open board refreshes in place

New here? Open **[`QUICKSTART.html`](QUICKSTART.html)** in a browser — 10-minute onboarding with the concept glossary.

## Quickstart

```bash
npm install
npm run dev          # http://127.0.0.1:5199/index.html
```

Then tell your agent:

> 读一下 AGENTS.md，然后在 Example Library 加一屏 XXX

Verify changes:

```bash
npm test                          # node contract tests
npx playwright install chromium   # first browser-test run only
npm run test:e2e                  # workbench e2e (template-only mode)
npm run check                     # both
```

Requires Node ≥ 20.

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
| **Variables** | Color / type / spacing / radius tokens + usage rules (≈ Figma Variables) | `ios-kit.css` `--ios-*`, type classes |
| **Library** | System primitives + product components (≈ Figma Components) | `components/` — auto page **Component Library** |
| **Chrome** | Device bezel, status bar, home indicator — stable, loader-owned | `wrapPhoneShell` in `workbench.js` |

Agent work stays in **screen fragments** (`*.html` + optional sidecar `*.js`) and
**components**; chrome is not an edit surface. Product gestures use screen scripts
(A+B), not `ios-kit.js`.

Board hierarchy: **page → canvas → section → frame**; a **screen** is the iOS content
inside a frame. These five words are also the annotation address space (`@page:` /
`@section:` / `@frame:`), so humans, agents, and the tooling all speak the same names.

## Repository layout

```
AGENTS.md              Agent entry — contracts + routing (read first)
QUICKSTART.html        Human onboarding — concepts + usage, self-contained
ios-kit.css            Variables + chrome styles + primitive CSS
ios-kit.js             Kit runtime — auto-fit, tabs/sheet/segmented, live clock; annotate inject
index.html             WORKBENCH — Pages (Component Library pinned first) + Theme controls
workbench.js           Board loader, data-ios-include, preview-script mount (A+B), HMR
annotate.js            Browser annotation client (served as /annotate.js)
components/            Component Library sources (meta.json + variant HTML)
previews/<page>/       Flow pages — board.json + screen HTML (+ optional <screen>.js)
previews/_index.json   Page manifest (id / title / order / default)
plugins/               Vite plugins: annotate/export APIs, components-board, preview-hmr, template-only
lib/                   Node-tested shared modules (annotation store, board navigation, …)
skills/                Agent skills (dir-ref, tool-agnostic) — build + annotate contracts
starter.html           COPY-ME standalone one-off phone (no workbench needed)
e2e/                   Playwright workbench tests
```

## Pages

Workbench **Pages** (top → bottom):

1. **Component Library** (system, always present) — synthesized from `components/*/meta.json`.
   Variants render on a light board (`.wb-comp-stage`), not inside phone chrome.
2. **Example Library** — `previews/library/`: a complete fictional app（冲煮手账）exercising
   every mechanism: cards/lists/tab/sheet home, a 3-screen flow with inline-script and
   sidecar interactive frames, lock screens, a message flow built from component includes,
   and an AB layout comparison.

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
in the [build skill](skills/ios-app-preview-build/SKILL.md); live examples
`previews/library/recipe.html` (A) and `previews/library/timer.{html,js}` (B).

### Add a workbench page

1. Create `previews/<pageId>/board.json` + screen HTML files.
2. Add the page to `previews/_index.json` (`pageId` becomes annotate `pageId` / `data-vpage`).
3. Do not invent a second loader — the manifest generates navigation.

### Add a reusable component

Component Library is for **reusable / variant-review atoms**, not every UI block.
Default: compose in the screen; extract to `components/` when you reuse across screens,
need a variant wall, or expect “change this widget” annotations. Full gate:
[build skill §4.0](skills/ios-app-preview-build/SKILL.md).

```
components/bubble/
  meta.json            { id, title, system, layout, variants: [{id, title}] }
  incoming.html        fragment (single element or a full .ios-app catalog screen)
  outgoing.html
```

Include it in any screen — edit the source once, every consumer refreshes:

```html
<div data-ios-include="bubble/outgoing" data-text="好的，我先看。"></div>

<div data-ios-include="status-card/default"
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
2. Say「标好了，你看一下」— the agent reads the annotation documents (disk SSOT under a
   per-project `~/.html-annotate/<dir>/`, path exposed by `GET /health`; revisioned,
   SSE-synced) grouped by `pageId → section → screenId`, edits the routed source file, and the
   board hot-reloads. It can attach a concise **Agent reply** to explain what changed and why.
3. Click any sidebar comment to focus its owning frame (the same geometry as frame navigation),
   review the visual change together with the reply, then clear resolved marks and repeat.

Short locators for chat: `@page:library` · `@section:library/brew-flow` ·
`@frame:library/timer` · `@a:<id>`. Full schema and routing rules:
[annotate skill](skills/ios-app-preview-annotate/SKILL.md).

Annotations are per-machine (solo human + agent loop) — replies close that loop, but this is
not a multiplayer comment system.

## One phone, no workbench

Copy [`starter.html`](starter.html), or use the minimal skeleton:

```html
<link rel="stylesheet" href="ios-kit.css">
<script src="ios-kit.js" defer></script>

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

## Knobs

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

## Class vocabulary

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

## Design rules baked in

- **Points, not viewport pixels** — device fixed-size, scaled as a unit.
- **Glass on the nav layer only** — content cards stay solid.
- **Grouped lists are flat** — white-on-gray, no shadow.
- **Role-based color** — `--ios-text-2`, `--ios-fill-3`, `--ios-accent`; never raw hex in app markup.
- **Tracking is CJK-safe** — body tracking `0`; don’t reintroduce negative Latin tracking.

## Branches

| Branch | Role |
|---|---|
| **`main`** | Public template (what you clone / pull for releases) |
| **`dev`** | Ongoing development |

Publish = update `main` from a clean `dev` tip (template-only check), then `git push origin main`.

## Template vs instance

Clone per project. Your content lives in `previews/<your-page>/` and `components/`; framework
files stay untouched, so pulling template updates is a clean overwrite of
`ios-kit.*` / `workbench.js` / `index.html` / `annotate.js` / `plugins/` / `lib/`.

For a long-lived instance, layer private content without touching tracked files:
gitignored `previews/_index.local.json` overrides the page manifest; component dirs outside
`components/_index.json` are auto-discovered. `PREVIEW_TEMPLATE_ONLY=1` hides both
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
as full HTML, CSS-stripped HTML (for AI), or a full-page 2× PNG. To annotate one, the document wires
itself in two places and stays inert outside localhost — see [`AGENTS.md`](AGENTS.md).

## Credits

The annotation system is a heavily extended fork of
[xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)
(section/page routing, disk SSOT + SSE, target composer, indicators).
