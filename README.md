# iOS App Preview — HTML template

A reusable template for **iOS app previews in plain HTML** — pixel-honest iPhone 16 Pro
plus an iOS 26/27 (HIG-accurate, CJK-safe) kit.

- **Kit** (`ios-kit.css` / `ios-kit.js`): framework-free, zero runtime deps.
- **Workbench** (`index.html` + Vite): needs `npm install` (Vite + Lucide).

**Agents:** read [`AGENTS.md`](AGENTS.md) first. Skills (dir-ref only):
[`skills/preview-build/`](skills/preview-build/SKILL.md) ·
[`skills/annotate/`](skills/annotate/SKILL.md).

## Mental model (three layers)

| Layer | What | Where |
|---|---|---|
| **Variables** | Color / type / spacing / radius tokens + usage rules (≈ Figma Variables) | `ios-kit.css` `--ios-*`, type classes |
| **Library** | System primitives + product components (≈ Figma Components) | `components/` — auto page **Component Library** |
| **Chrome** | Device bezel, status bar, home indicator — stable, loader-owned | `wrapPhoneShell` in `workbench.js` |

Agent work stays in **screen fragments** (`*.html` + optional sidecar `*.js`) and
**components**; chrome is not an edit surface. Product gestures use screen scripts
(A+B), not `ios-kit.js`.

## Files

```
AGENTS.md              Agent entry — read first
ios-kit.css            Variables + chrome styles + primitive CSS
ios-kit.js             runtime — auto-fit, tabs/sheet/segmented, live clock; annotate inject
index.html             WORKBENCH — Pages (Component Library pinned first) + Theme controls
workbench.js           board loader, data-ios-include, preview-script mount (A+B), HMR
components/            Component Library sources (meta.json + variant HTML)
previews/<page>/       Flow pages — board.json + screen HTML (+ optional <screen>.js)
plugins/               annotate-api, components-board, preview-hmr
starter.html           COPY-ME standalone one-off phone
skills/                topic skills (dir-ref) + browser annotation client
CHANGELOG.md
```

Serve with Vite:

```bash
cd topics/ios-app-preview-html-template
npm install          # first time only (workbench)
npm run dev          # http://127.0.0.1:5199/index.html
```

Verify changes:

```bash
npm test
npx playwright install chromium  # first browser-test run only
npm run test:e2e
npm run check                     # contracts + browser flows
```

## Pages

Workbench **Pages** (top → bottom):

1. **Component Library** (system, always present) — synthesized from `components/*/meta.json`.
   Variants render on a **light board** (`.wb-comp-stage`), not inside phone chrome. Flow pages
   still use the loader phone shell.
2. **Example Library** — `previews/library/board.json` + screens (flows / demos)
3. **GTD · 核心两屏** — `previews/smart-todo/`
4. **Time Insight** — `previews/time-insight/`

Click a page to switch boards. Component Library cannot be renamed.

### Add a flow screen

One content fragment + one entry in that page’s `board.json` **`sections[]`**.
Canonical example: [`previews/library/board.json`](previews/library/board.json).
Loader wraps the phone shell. For gestures / animation, add A+B screen scripts
(see **Interactive frames** below) — do not edit `ios-kit.js`.

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
    {
      "id": "onboard",
      "title": "Onboarding",
      "layout": "column",
      "screens": ["onboard"]
    }
  ]
}
```

Titled / per-screen shell (row flows):

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

- Default shell: **app**. Lock: `"shell": "lock"` + `.ios-lockscreen` (no `.ios-app`).
- Side-by-side: `"layout": "row"` + multiple screens (see `ab` / `msg-flow`).
- Section `title` → `.wb-lib-cap`; screen `title` → `.wb-screen-cap` (sizes from board tokens — write copy only).

### Add a workbench page

1. Create `previews/<pageId>/board.json` and screen HTML files (optional same-name `.js` for A+B).
2. Add the page to `previews/_index.json`:

```json
{
  "defaultPage": "library",
  "pages": [
    { "id": "library", "title": "Example Library" },
    { "id": "<pageId>", "title": "My Flow" }
  ]
}
```

3. Do not invent a second loader — the manifest generates navigation and `workbench.js` fetches `previews/<pageId>/board.json`.

The manifest owns page id / title / order / default. `pageId` becomes annotate `pageId` / `data-vpage`.
Board files own only `sections[]`; a legacy top-level `title` is accepted but ignored.

### Add a reusable component

```
components/bubble/
  meta.json
  incoming.html
  outgoing.html
```

```json
{
  "id": "bubble",
  "title": "Message Bubble",
  "system": false,
  "layout": "row",
  "variants": [
    { "id": "incoming", "title": "Incoming" },
    { "id": "outgoing", "title": "Outgoing" }
  ]
}
```

- `system: true` — kit primitives (Buttons, Lists, …); keep few and stable.
- Variant files are **fragments** (may be a single bubble, or a full `.ios-app` catalog screen).
- Library auto-wraps bare fragments in a page shell for phone preview.
- Optional `components/_index.json` orders sections; system sections always render before product.

### Include a component in a screen (sync)

```html
<div data-ios-include="bubble/outgoing" data-text="好的，我先看。"></div>
```

Loader replaces the placeholder with `components/bubble/outgoing.html`. Optional `data-text`
fills `[data-ios-slot="text"]`. Edit the component source → Component Library **and** any
open flow that includes it refresh (HMR). Do **not** paste-copy component HTML into screens.

## Workbench UX

- **Sidebar** — collapse: header toggle, stage expand button, splitter click (when collapsed) /
  double-click (when expanded). Width drag still works. Prefs: `sideCollapsed`, `sideWidth`.
- **Per-page viewport** — `pageViewports[pageId]` remembers scroll + zoom (zoom single-source).
- **Canvas toolbar** — always visible at bottom-right. Open Section Navigator for continuous
  section/screen jumps and/or the colored Canvas → Section → Frame minimap. Both panels persist
  until their button is clicked again, docking right and stacking vertically in toolbar order;
  zoom ±, click label → 100%, 回中; ctrl/meta + wheel zooms.
- **Captions** — `--wb-cap-section` (~7.3% of `--wb-phone-w`), `--wb-cap-screen` (~5.5%); agents write copy only.
- **Annotations** — stage-scoped overlay; marks filtered by active `pageId`; list delete (×);
  filter 全部 / 当前示例; `goToMark` switches page when needed. Marks are **disk SSOT**
  (`~/.html-annotate`, revisioned save queue + SSE); workbench prefs stay browser-local.
- **HMR** — `previews/<page>/board.json|*.html|*.js` and `components/**` refresh the active board.

### Interactive frames (A+B)

Screen HTML is mounted with `innerHTML`, so bare `<script>` does not run. Keep product
gestures with the screen; do **not** add them to `ios-kit.js`.

| Form | Use when | Pattern |
|---|---|---|
| **A · inline** | Short | `<script data-preview-script>` or module `export default function mount(root)` |
| **B · sidecar** | Longer | `previews/<page>/<screenId>.js` + `data-preview-mount` on `.ios-app` |

`mount` may return `unmount`. Example: `previews/time-insight/tear-calendar.{html,js}`.

## One phone, minimal skeleton

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

Standalone pages still need the full shell (or copy from `starter.html`). Workbench screens
do **not** — loader owns chrome.

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

See Component Library page for live recipes of system primitives. Sheet structure: [`previews/library/feed.html`](previews/library/feed.html).

## JS data-attribute API (optional)

```html
<div class="ios-app" data-tab-page="home">
  <div class="ios-cell tappable" data-sheet-open="detail">…</div>
</div>
<div class="ios-sheet-backdrop"></div>
<div class="ios-sheet" id="detail">
  <div class="ios-sheet-body">
    <button type="button" data-sheet-close>Done</button>
  </div>
</div>
<div class="ios-tabbar">
  <button class="ios-tab on" data-tab="home">…</button>
</div>
```

**Icons** — emoji for app/content; system chrome SVG (`#c-back`, `#c-chev`, `#c-search`) auto-injected.

## Annotation review loop

Mark up a preview — Figma-style — and have Claude read marks and revise.
Skill: [`skills/annotate/SKILL.md`](skills/annotate/SKILL.md) (topic dir-ref; not installed into `.claude/skills`).

- Press **A** for 标注 (vs 交互), click/lasso, then keep adding targets while the
  bottom composer stays focused. Use pills for plain refs or insert `[indicator N]`
  inline, write content, copy 🔗 indicator, then「标好了，你看一下」.
- Annotations group by `pageId` + `[data-ann-section]` (board section; legacy `data-ann-group` still works).
- Indicators: `@page:` / `@section:` / `@frame:` / `@a:` — see annotate skill.
- On **Component Library**: edit `components/<id>/`.
- On a **flow** with `data-ios-from="bubble/outgoing"`: prefer editing that component source.
- Flow screen files stay content-only; never edit loader chrome.

## Design rules baked in

- **Points, not viewport pixels** — device fixed-size, scaled as a unit.
- **Glass on the nav layer only** — content cards stay solid.
- **Grouped lists are flat** — white-on-gray, no shadow.
- **Role-based color** — `--ios-text-2`, `--ios-fill-3`, `--ios-accent`; never raw hex in app markup.
- **Tracking is CJK-safe** — body tracking `0`; don’t reintroduce negative Latin tracking.
