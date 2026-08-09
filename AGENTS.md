# pinpoint — Agent Guide

Read this first when working in this repo.
Human-oriented docs: [`README.md`](README.md) · onboarding: [`QUICKSTART.html`](QUICKSTART.html) · recent changes: [`CHANGELOG.md`](CHANGELOG.md).

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

Health: `curl -s https://pinpoint.localhost/health` — the same origin serves preview + annotate API.

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

## Edit surfaces

| Do edit | Do not edit |
|---|---|
| `previews/<pageId>/*.html` (iOS: `.ios-app` + sibling overlays; Web: any non-document fragment) | Phone chrome / bezel / status bar (loader-owned) |
| `previews/<pageId>/*.js` (screen sidecar `mount(root)`) | Product gestures in `ios-kit.js` |
| `previews/<pageId>/board.json` | Hand-set `font-size` on `.wb-lib-cap` / `.wb-screen-cap` |
| `kits/ios/components/<id>/` (`meta.json` + variants) | Paste-copy component HTML into screens |
| `previews/_index.json` when adding a page (`mode`: `ios` \| `web` \| `html`) | `ios-kit.css` to “fix” one annotation |

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
`iOSAnnotate.setFloatingToolbar(true)` when opened standalone (the toolbar hides
itself when there is no workbench sidebar). Annotate treats the whole document as
the hit surface — authors do **not** need `wb-html-surface` / `data-ann-surface`
on content (those markers remain for Web-board fragments inlined into the
workbench, where sidebar/chrome must stay unselectable).

Marks land under the document's own page key (per-path file under `dataDir`, see `/health`), not the
workbench's. In the HTML board the sidebar still drives them: workbench annotate calls resolve to the
active doc frame's instance, so mode, count, and the Annotations list all reflect the document, and
the embedded document hides its own floating toolbar to keep one control surface.

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
- Screen file = `previews/<pageId>/<screenId>.html` (fragment: `.ios-app` + sibling overlays; no bezel).
- Frame Note = optional `screens[].note` in `board.json`; durable design context shown below the frame. It is distinct from disposable review annotations.
- Interactive screens: same-file `data-preview-script` and/or sidecar `previews/<pageId>/<screenId>.js` (`data-preview-mount`). See **Interactive frames** below.
- Default shell: **app**. Lock: `"shell": "lock"` on section or screen + `.ios-lockscreen`.
- `section.id` stamps `[data-ann-section]` → annotation `section`.
- Board hierarchy for agents: **page → canvas → section → frame**; **screen** = iOS content inside a frame (`screenId` = frame id).
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
- Overlay is stage-scoped; canvas/sidebar show active page annotations. `goToMark` switches page
  when needed, then focuses the owning frame through `workbench/lib/board-navigation.js`; only legacy marks
  without `screenId` fall back to centering the raw anchor.
- Canvas draws **live anchors only**. If a selector no longer resolves after HTML edits, the annotation stays in the sidebar as **锚点失效** (no ghost frame). Brokenness is computed at render time, not stored.

Annotations live in per-entry buckets `~/.html-annotate/<entry-id>/*.json`
(**disk SSOT**) as `annotations[]` — entries come from `~/.html-annotate/registry.json`
(`HTML_ANNOTATE_REGISTRY` overrides); this repo annotates under entry `pinpoint`.
Read the exact default-bucket path from the `dataDir` field of
`GET /health`; `HTML_ANNOTATE_DATA_DIR`
overrides the data root wholesale (e2e uses this).
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
  resolve geometry and focus policy through `workbench/lib/board-navigation.js`; never navigate using the
  `.wb-screen` wrapper because row layout makes it `display: contents`.
- **HMR**: edits under `previews/<page>/**` (html/js/board) or `kits/ios/components/**` refresh the board.

## Template vs instance

The repo ships template content only (Example Library + system components). A long-lived
instance layers private content on top without touching tracked files:

- `previews/_index.local.json` (gitignored) overrides the page manifest.
- Component dirs not listed in `kits/ios/components/_index.json` are auto-discovered and appended.
- `PREVIEW_TEMPLATE_ONLY=1` hides both overrides — used by e2e and release verification.

## Smoke checklist

1. Add a screen to Example Library (`board.json` `sections[]` + `previews/library/<id>.html`).
2. Add a new workbench page (`previews/<pageId>/` + one `previews/_index.json` entry).
3. Interactive screen: sidecar `mount(root)` + `data-preview-mount` (or inline `data-preview-script`); do not edit `ios-kit.js`.
4. Read annotations grouped by `pageId` then `section` (and `screenId` when present); edit the routed file; do not clear annotations for the user.
5. Resolve `content` target tokens against the same annotation's `targets[].ref`; keep
   missing refs visible instead of guessing another target.
6. After addressing annotations, summarize the concrete changes in the agent conversation;
   leave review and annotation cleanup to the user.

## Anti-patterns

- Flat `board.json` without `sections[]`
- Nesting sheet / backdrop / tabbar inside `.ios-app` (must be fragment-top siblings)
- Editing loader chrome to satisfy an annotation
- Product gestures / screen state in `ios-kit.js`
- Setting caption font sizes in screen HTML or ad-hoc CSS
