# iOS App Preview

**Build pixel-honest iOS interactive prototypes in plain HTML — with your AI agent doing the building, and a Figma-style annotation loop for review.**

A single self-contained workbench: an HIG-accurate, CJK-safe iOS kit (zero runtime deps), a
Figma-like multi-page canvas, a live Component Library, and a browser annotation system whose
marks land on disk for your agent to read and act on.

- 📱 **Pixel-honest** — iPhone 16 Pro chrome, true iOS points, light/dark, Dynamic Type
- 🤖 **Agent-native** — [`AGENTS.md`](AGENTS.md) + in-repo skills teach any Claude session the contracts
- ✏️ **Review loop** — mark up screens in the browser（标注）, agent reads `~/.html-annotate` and revises
- 🔁 **HMR** — edit a screen or component, the open board refreshes in place

New here? Open **[`QUICKSTART.html`](QUICKSTART.html)** in a browser — 10-minute onboarding with the concept glossary.

## Quickstart

```bash
npm install
npm run dev          # http://127.0.0.1:5199/index.html
```

Then tell your agent (Claude Code auto-discovers this repo's skills):

> 读一下 AGENTS.md，然后在 Example Library 加一屏 XXX

Verify changes:

```bash
npm test                          # node contract tests
npx playwright install chromium   # first browser-test run only
npm run test:e2e                  # workbench e2e (template-only mode)
npm run check                     # both
```

Requires Node ≥ 20.

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
plugins/               Vite plugins: annotate-api, components-board, preview-hmr, template-only
lib/                   Node-tested shared modules (annotation store, board navigation, …)
.claude/skills/        Repo skills — auto-discovered by Claude Code in this repo
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
    { "id": "msg-thread", "title": "2 · 查看消息" }
  ]
}
```

For gestures / animation, add screen scripts (form A inline / form B sidecar) — full contract
in the [build skill](.claude/skills/ios-app-preview-build/SKILL.md); live examples
`previews/library/recipe.html` (A) and `previews/library/timer.{html,js}` (B).

### Add a workbench page

1. Create `previews/<pageId>/board.json` + screen HTML files.
2. Add the page to `previews/_index.json` (`pageId` becomes annotate `pageId` / `data-vpage`).
3. Do not invent a second loader — the manifest generates navigation.

### Add a reusable component

```
components/bubble/
  meta.json            { id, title, system, layout, variants: [{id, title}] }
  incoming.html        fragment (single element or a full .ios-app catalog screen)
  outgoing.html
```

Include it in any screen — edit the source once, every consumer refreshes:

```html
<div data-ios-include="bubble/outgoing" data-text="好的，我先看。"></div>
```

`system: true` marks kit primitives (Buttons, Lists, …) — keep those few and stable.

## Annotation review loop

Mark up a preview — Figma-style — and have your agent read marks and revise.

1. Press **A** to switch 交互 → **标注**; click / lasso elements, write comments in the
   bottom composer (pills reference targets; `[indicator N]` inlines them), paste reference
   images, draw move-arrows.
2. Say「标好了，你看一下」— the agent reads `~/.html-annotate/*.json` (disk SSOT, revisioned,
   SSE-synced) grouped by `pageId → section → screenId`, edits the routed source file, and the
   board hot-reloads.
3. Review, clear resolved marks, repeat.

Short locators for chat: `@page:library` · `@section:library/brew-flow` ·
`@frame:library/timer` · `@a:<id>`. Full schema and routing rules:
[annotate skill](.claude/skills/ios-app-preview-annotate/SKILL.md).

Annotations are per-machine (solo human + agent loop) — this is not multiplayer Figma.

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

## Template vs instance

Clone per project. Your content lives in `previews/<your-page>/` and `components/`; framework
files stay untouched, so pulling template updates is a clean overwrite of
`ios-kit.*` / `workbench.js` / `index.html` / `annotate.js` / `plugins/` / `lib/`.

For a long-lived instance, layer private content without touching tracked files:
gitignored `previews/_index.local.json` overrides the page manifest; component dirs outside
`components/_index.json` are auto-discovered. `PREVIEW_TEMPLATE_ONLY=1` hides both
(e2e and release verification run in this mode).

## Credits

The annotation system is a heavily extended fork of
[xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)
(section/page routing, disk SSOT + SSE, target composer, indicators).
