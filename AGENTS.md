# iOS App Preview — Agent Guide

Read this first when working in this repo.
Human-oriented docs: [`README.md`](README.md) · onboarding: [`QUICKSTART.html`](QUICKSTART.html) · recent changes: [`CHANGELOG.md`](CHANGELOG.md).

Repo skills live in [`skills/`](skills/) — plain directories referenced by path (dir-ref),
so they work with any coding agent (Claude Code / Codex / Cursor / …). Open the SKILL.md
the routing table below points at before touching the matching surface.

## Start the server

```bash
npm install          # first time
npm run dev          # http://127.0.0.1:5199/index.html (PORT overrides; auto-port on conflict)
```

Health: `curl -s http://127.0.0.1:5199/health` — the same port serves preview + annotate API.

Kit CSS/JS is framework-free. **Workbench** needs Vite + Lucide (`npm install`).

Checks: `npm test` (contracts) · `npm run test:e2e` (Chromium; first time
`npx playwright install chromium`) · `npm run check` (both). E2e runs the server with
`PREVIEW_TEMPLATE_ONLY=1`, so instance-local pages/components never affect assertions.

## Edit surfaces

| Do edit | Do not edit |
|---|---|
| `previews/<pageId>/*.html` (screen fragment: `.ios-app` + sibling overlays) | Phone chrome / bezel / status bar (loader-owned) |
| `previews/<pageId>/*.js` (screen sidecar `mount(root)`) | Product gestures in `ios-kit.js` |
| `previews/<pageId>/board.json` | Hand-set `font-size` on `.wb-lib-cap` / `.wb-screen-cap` |
| `components/<id>/` (`meta.json` + variants) | Paste-copy component HTML into screens |
| `previews/_index.json` when adding a page | `ios-kit.css` to “fix” one annotation |

**Overlay rule:** `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` are siblings of `.ios-app`, not children. Nesting them inside `.ios-app` breaks scroll / sheet positioning — see [build skill](skills/ios-app-preview-build/SKILL.md) §1.1.

Glass chrome: use `.ios-glass` / `.ios-glass-pill` (tokens in `ios-kit.css`). Add `.ios-glass--liquid` only for Chromium refraction wow on sparse chrome — not full-page surfaces.

Captions: write copy only. Sizes come from `--wb-cap-section` / `--wb-cap-screen` (fractions of `--wb-phone-w`).

## Skill routing

| Task | Open |
|---|---|
| Add page / section / screen / component / interactive frame | [`skills/ios-app-preview-build/SKILL.md`](skills/ios-app-preview-build/SKILL.md) |
| Annotate → read annotations → revise | [`skills/ios-app-preview-annotate/SKILL.md`](skills/ios-app-preview-annotate/SKILL.md) |
| Tokens / class vocabulary / knobs | [`README.md`](README.md) |

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
        { "id": "msg-thread", "title": "2 · 查看消息" }
      ]
    }
  ]
}
```

- Top level is **`sections[]`**, not a flat `{ id, screens }` object.
- Page id / title / order / default live in **`previews/_index.json`**; a gitignored
  `previews/_index.local.json` (same shape) overrides it for long-lived instances.
- Screen file = `previews/<pageId>/<screenId>.html` (fragment: `.ios-app` + sibling overlays; no bezel).
- Interactive screens: same-file `data-preview-script` and/or sidecar `previews/<pageId>/<screenId>.js` (`data-preview-mount`). See **Interactive frames** below.
- Default shell: **app**. Lock: `"shell": "lock"` on section or screen + `.ios-lockscreen`.
- `section.id` stamps `[data-ann-section]` → annotation `section`.
- Board hierarchy for agents: **page → canvas → section → frame**; **screen** = iOS content inside a frame (`screenId` = frame id).
- Annotate modes: **标注** (A) vs **交互** (default). Global indicators are `@page:` /
  `@section:` / `@frame:` / `@a:`; annotation-local targets use persisted `[@t:iN]`
  tokens displayed as `[indicator N]` — see [annotate skill](skills/ios-app-preview-annotate/SKILL.md).

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
| `pageId` | Workbench page = `data-vpage` (`library`, `components`, or custom) |
| `section` | Board section `id` (legacy: `group`) |
| `screenId` | Frame / screen file id |
| `content` | Annotation body (legacy: `comment`) |
| `path` | Shell page (usually `index.html`) |

Element annotations always write `targets: [{ ref, selector, text }]`; stable refs are
`i1`, `i2`, … and are never renumbered after deletion. Top-level `selector` / `text`
mirror the first target as compatibility aliases. `[@t:iN]` resolves only within that
annotation and never enters `mentions[]`; `[@a:id]` keeps its cross-annotation meaning.

- Component Library annotations → edit `components/<id>/`.
- Flow node with `data-ios-from="bubble/outgoing"` → prefer that component source.
- Flow screen annotations → `previews/<pageId>/<screen>.html` only.
- Overlay is stage-scoped; canvas/sidebar show active page annotations; `goToMark` switches page when needed.
- Canvas draws **live anchors only**. If a selector no longer resolves after HTML edits, the annotation stays in the sidebar as **锚点失效** (no ghost frame). Brokenness is computed at render time, not stored.

Annotations live in `~/.html-annotate/*.json` (**disk SSOT**) as `annotations[]`.
`POST /save` requires `baseRevision`; clear uses the same save queue with `annotations: []`
(there is no `/clear` route). The browser `localStorage` cache is not authoritative. On boot
the client hydrates from disk; `GET /events` (SSE) keeps open browsers near-realtime.
**Workbench prefs** (active page, zoom, sidebar, theme) stay in browser `localStorage`
(`ios-preview-wb`) — viewer state, not synced.

## Workbench UX (prefs)

- **Sidebar**: collapse via header toggle / stage expand / splitter (click when collapsed, dblclick to collapse). Prefs: `sideCollapsed`, `sideWidth`.
- **Viewport**: per-page `pageViewports[pageId]` stores scroll + zoom (zoom single-source; no top-level `canvasZoom`).
- **Stage pan**: Space+drag or middle-button drag anywhere; left-drag only on empty board chrome (not inside `.ios-stage` / `.wb-comp-stage`) so frame clicks/scrolls work.
- **Canvas toolbar**: always visible at bottom-right; Section Navigator and the layered
  Canvas → Section → Frame minimap are independent persistent toggles. Open panels dock right
  and stack vertically in toolbar order. Ctrl/meta + wheel zooms. Both navigation modes must
  resolve geometry and focus policy through `lib/board-navigation.js`; never navigate using the
  `.wb-screen` wrapper because row layout makes it `display: contents`.
- **HMR**: edits under `previews/<page>/**` (html/js/board) or `components/**` refresh the board.

## Template vs instance

The repo ships template content only (Example Library + system components). A long-lived
instance layers private content on top without touching tracked files:

- `previews/_index.local.json` (gitignored) overrides the page manifest.
- Component dirs not listed in `components/_index.json` are auto-discovered and appended.
- `PREVIEW_TEMPLATE_ONLY=1` hides both overrides — used by e2e and release verification.

## Smoke checklist

1. Add a screen to Example Library (`board.json` `sections[]` + `previews/library/<id>.html`).
2. Add a new workbench page (`previews/<pageId>/` + one `previews/_index.json` entry).
3. Interactive screen: sidecar `mount(root)` + `data-preview-mount` (or inline `data-preview-script`); do not edit `ios-kit.js`.
4. Read annotations grouped by `pageId` then `section` (and `screenId` when present); edit the routed file; do not clear annotations for the user.
5. Resolve `content` target tokens against the same annotation's `targets[].ref`; keep
   missing refs visible instead of guessing another target.

## Anti-patterns

- Flat `board.json` without `sections[]`
- Nesting sheet / backdrop / tabbar inside `.ios-app` (must be fragment-top siblings)
- Editing loader chrome to satisfy an annotation
- Product gestures / screen state in `ios-kit.js`
- Setting caption font sizes in screen HTML or ad-hoc CSS
