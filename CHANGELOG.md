# Changelog

All notable changes to the **iOS App Preview** template. Newest first.
Loosely follows [Keep a Changelog](https://keepachangelog.com/); dates are `YYYY-MM-DD`.
Group entries under **Added** / **Changed** / **Fixed** / **Removed**.

Template scope only — instance/product content changes live outside this file.

---

## 2026-07-21

### Added
- **Template split** — repo now ships template content only (framework + Example
  Library + system components). Instance-local content layers on top:
  gitignored `previews/_index.local.json` overrides the page manifest; component
  dirs missing from `components/_index.json` are auto-discovered and appended.
- **`PREVIEW_TEMPLATE_ONLY=1`** (`plugins/template-only.js`) — hides both
  instance-local mechanisms so e2e (wired in `playwright.config.js`) and release
  verification see identical template state on any machine.
- **Example Library redesign** — one coherent fictional app（冲煮手账 · pour-over
  journal）exercises every mechanism: cards/lists/tab/sheet home; a 3-screen brew
  flow with an inline-script frame (`recipe.html`, form A) and a sidecar timer
  frame (`timer.{html,js}`, form B, animated progress ring); lock screens; a
  message flow built from `bubble` component includes; an AB layout comparison.
  All copy is fictional. New e2e covers both interactive-frame forms.
- **`QUICKSTART.html`** — self-contained human onboarding: concept glossary
  (page / section / frame / screen, component, 标注/交互, indicators) + usage.
- **Per-project annotation dir** — annotation documents default to
  `~/.html-annotate/<repo-dirname>-<hash>/` (hash of the repo's absolute path),
  so multiple clones on one machine never share documents — previously every
  workbench keyed on `/index.html` and collided (mixed marks, shared
  clear/revision state). `GET /health` now returns `dataDir`;
  `HTML_ANNOTATE_DATA_DIR` still overrides.

### Changed
- **Skills renamed + rewritten** (`skills/ios-app-preview-build`,
  `skills/ios-app-preview-annotate`) — tool-agnostic dir-ref (works with
  Claude Code / Codex / Cursor), repo-relative paths, trigger-focused
  descriptions.
- **`annotate.js` relocated to repo root** — it is the browser runtime client
  (served as `/annotate.js`), not a skill; `plugins/annotate-api.js` and the
  inline test updated.
- **Docs restructured for sharing** — README rewritten as the landing page
  (quickstart, mental model, recipes, template-vs-instance); AGENTS.md is
  workspace-neutral and routes to the relocated skills.
- **e2e retargeted to template content** — assertions no longer reference
  instance pages; counts are deterministic under `PREVIEW_TEMPLATE_ONLY`.

---

## 2026-07-13

### Changed
- **preview-build skill · overlay mount** — document that `.ios-sheet` /
  `.ios-sheet-backdrop` / `.ios-tabbar` must be fragment-top siblings of `.ios-app`
  (not nested in the scroll surface). Mirrored in `AGENTS.md` + README class /
  data-attribute examples. (§1.1; anti-pattern list.)

### Added
- **Annotate frame hit** — click screen caption / phone bezel (or Alt/⌥+click inside
  a screen) to select the whole frame (`.ios-stage` / `.wb-comp-stage`); 🔗 copies
  `@frame:<pageId>/<screenId>`. Plain click inside content still marks the leaf element;
  section titles outside frames still mark the section.
- **Bottom Target Composer** — the annotation composer stays above the canvas HUD while
  canvas clicks continuously add targets without taking focus from the textarea. Target
  pills hover-highlight, locate, and remove targets; saved badges reopen the isolated draft.
- **Inline target indicators** — element annotations support “仅引用” and “插入到文本”.
  The UI shows `[indicator N]`; disk stores stable local `[@t:iN]` tokens and
  `targets: [{ ref, selector, text }]`. Top-level `selector` / `text` mirror the first
  target for legacy consumers. Old single/multi-target annotations gain refs on read.
- **Explicit composer drag handle** — a six-dot icon in the titlebar is the only drag
  surface. Dropping moves the composer to a viewport-fixed, edge-clamped position reused
  by later composers in the same page session; editing and target controls never drag it.

### Removed
- **Shift multi-anchor state** — Shift is no longer part of canvas selection, so textarea
  focus, IME composition, and Shift+Enter keep their native meaning.

---

## 2026-07-11

### Changed
- **Unified `annotationSlug`** — extracted to `lib/annotation-slug.js` (browser-safe,
  node-tested); inlined into `/annotate.js` so client `PAGE_KEY` and server disk/SSE
  page key use one function. Fixes SSE page-match drift when a path had consecutive
  non-word chars (old client regex lacked `+`).
- **`marks` → `annotations` on the wire** — SSE event `annotations`, HTTP
  `/annotations` + `/annotations/:page`, broadcast/save carry `annotations` only.
  Disk dual-read of legacy `marks` kept; new writes drop the `marks` alias.
- **Scoped include cache** — `includeCache` no longer cleared on every page switch /
  HMR; busted only on component changes. Page-screen-only HMR keeps component
  includes warm.
- **评论 → 标注** copy sweep in annotate client comments (data fields unchanged).

### Removed
- **`--ios-glass`** compat alias from `ios-kit.css` (no consumers; `--ios-glass-fill`
  is the canonical token).

### Added
- **`.ios-glass-pill`** — capsule chrome class for floating nav controls; opt-in
  `.ios-glass--liquid` adds Chromium SVG refraction via `iOSKit.ensureLiquidGlassFilter()`.
- **Annotate / Interact modes** — default is 交互 (product clicks/scroll; text selection
  allowed — pan via Space / middle-button). **A** / sidebar toggle switches to 标注
  (click/lasso → box). UI labels: **交互** / **标注**.
  Space pan works in both modes.
- **Hierarchical indicators** — annotate box **🔗** copies short locators for agents:
  `@page:<id>`, `@section:<page>/<section>`, `@frame:<page>/<screenId>`, `@a:<id>`.
  Scope indicators mean “all annotations under that locator”. Shared helpers in
  `lib/annotation-indicator.js`. Pages list row **🔗** copies `@page:<id>`.
- **DDD schema** — disk writes `annotations[]` with `content` / `section` /
  `sectionLabel` / `screenId`. Mentions store `[@a:id]`. Legacy `marks` / `comment` /
  `group` / `[@m:id]` dual-read and upgrade on save. Board emits `data-ann-section*`
  (keeps `data-ann-group*` for compatibility).

### Changed
- **Liquid-glass surface tokens** in `ios-kit.css` (`--ios-glass-fill/blur/sat/rim/…`);
  `.ios-nav` / `.ios-navbar` / `.ios-glass` share sheen + rim + chroma.
- Floating nav pills use `.ios-glass-pill` instead of duplicated inline blur.
- Sidebar toggle labels **交互** / **标注**; empty-state hint points at 标注 mode.
- Scope matching is strict: annotations without `pageId` never match `@page` / `@section` /
  `@frame`. Unsaved annotate-box copy falls back to a scope indicator (never a dangling `@a:`).

### Removed
- **Glass Lab** comparison page (`previews/glass-lab/`) after kit surface upgrade landed.

---

## 2026-07-10

### Added
- **Annotation intents + mentions** — comment box tag **改文案** (`changeTo: true`)
  tells the agent to replace copy with the mark’s comment. Typing `@` opens a keyboard-
  navigable picker (↑↓ / Enter / Esc); UI shows `@n`, disk stores stable `[@m:<id>]`
  plus optional `mentions[]`. Each mark gets a short `id` (migrated on hydrate).
- **Persistent canvas toolbar** — zoom, recenter, semantic Section Navigator, and the geometry
  minimap now share one always-visible bottom-right toolbar. Both navigation panels toggle as
  independent persistent docks, right-align and stack vertically in toolbar order. Section jumps
  keep the navigator open for continuous browsing; the minimap renders colored
  Canvas → Section → Frame hierarchy with frame/section/canvas hit priority.
- **Node-only contract checks** — `node:test` covers annotation CAS/atomic storage/image GC,
  board + page-manifest validation, and cancellable board-mount sessions; Playwright covers
  manifest navigation and queued annotation saves against real SSE.
- **Page manifest** — `previews/_index.json` now owns flow-page id/title/order/default and
  Workbench builds navigation from it. Board files own `sections[]` only.

### Changed
- **Single Node/Vite runtime** — removed the duplicated Python fallback. Annotation writes now
  require `baseRevision`, use atomic replace, and garbage-collect unreferenced page images.
- **Cancellable board mounts** — page/HMR loads use generation-scoped sessions so stale async
  sidecars dispose immediately and canceled load promises settle.
- **Clear through save** — `iOSAnnotate.clear()` remains, but `/clear` is removed; empty state is
  persisted through the same revisioned save queue as every other edit.

### Fixed
- **Sidecar mounts were dead** — `resolveSidecarUrl` returned a bare specifier
  (`previews/<page>/<screen>.js`), which dynamic `import()` rejects, so every
  `data-preview-mount` / `src` sidecar failed with
  `TypeError: Failed to resolve module specifier`. URLs are now root-absolute (`/previews/…`).
- **Dev server port** — `vite.config.js` honors `PORT` (fallback 5199) with auto-port,
  so a second session no longer collides with an already-running kit server.
- **Unified board navigation geometry** — Section Navigator and minimap now resolve targets from
  `lib/board-navigation.js`, including concrete frame boxes for row screens whose `.wb-screen`
  wrapper is `display: contents`. Section/frame focus uses the same zoom-safe alignment rules,
  and both right-dock panels share one width token.
- **Queued annotation edits** — local changes made during an in-flight save are sent in order;
  the save's own SSE broadcast no longer rolls newer local marks back.
- **Per-page first framing** — removed a global framing flag that could leave a newly opened page
  at the previous page's scroll position.
- **Broken annotation anchors** — when a mark’s selector no longer resolves after HTML
  edits, the canvas no longer paints a ghost frame from stale `rect`. The mark stays in
  the sidebar as **锚点失效** (comment still readable); live anchors keep drawing as
  usual. Resolution is centralized in `resolveMarkAnchor` (`annotate.js`).

## 2026-07-09

### Added
- **Marks disk SSOT + SSE** — annotations hydrate from `~/.html-annotate` on boot;
  `localStorage` is cache only. `POST /save` uses `revision` / `baseRevision` (409 on
  conflict) and rejects blind empty overwrites. `GET /events` broadcasts mark updates
  across browsers. Workbench prefs stay viewer-local (not synced).
- **Interactive frame scripts (A+B)** — after mount, workbench runs screen
  `data-preview-script` (inline / module / `src`) and `data-preview-mount` sidecars
  (`previews/<page>/<screenId>.js` → `export default function mount(root)`). Optional
  `unmount` on board reload / HMR. Product gestures stay with the screen; kit stays
  chrome-only.
- **Canvas minimap** — bottom-left overview of board frames; click a frame to snap-center
  it in the stage. Prefs store `minimapCollapsed`. Updates on scroll / zoom / board mount.

### Changed
- **Agent-ready docs** — AGENTS.md entry; README `sections[]` + new-page recipe;
  skills split into annotate + preview-build.
- **Board caption scale** — `.wb-lib-cap` / `.wb-screen-cap` size from `--wb-phone-w`
  (~7.3% / ~5.5%) so flow + step labels stay proportional to the phone frame; agents only write copy.
  Screen caps are **left-aligned**; row sections use a 2-row grid so phone tops stay level when
  titles wrap.
- **Incremental annotation overlay** — mark frame/badge/arrow nodes are cached by `n`;
  scroll/zoom only updates geometry; structure sync runs on mark mutations / full `render()`.
- **Zoom prefs single-source** — persist only `pageViewports[pageId].canvasZoom`; one-time
  migration seeds from legacy top-level `canvasZoom` then drops that key.
- **Boot prefs helper** — `resolveBootPageId` + `applyBootPrefs` own side/theme/zoom/shell
  restore; settings `restorePrefs` reuses the same path.
- **Workbench / annotate cleanup** — drop duplicate `refit`+`render` calls; debounce zoom and
  scroll viewport prefs; cache overlay origin per render frame; scope region lasso to
  `#wb-board-panel`; rAF-throttle library scroll spy; expand-button visibility is CSS-only.

### Fixed
- **Stage pan vs frame interaction** — left-drag inside phone/comp frames no longer
  steals clicks; pan with **Space+drag**, **middle-button drag**, or left-drag on empty
  board chrome only.
- **Annotation overlay stays in the stage** — `#ann-overlay` mounts on `.wb-stage-wrap`
  so mark frames no longer paint over the sidebar; chrome clamps to the stage rect.
- **Marks scoped by workbench page** — new marks store `pageId`; canvas + sidebar list only
  show the active page. `goToMark` switches page when needed.
- **Per-page viewport memory** — prefs `pageViewports[pageId]` remember scroll + zoom across
  page switches; first visit still auto-frames the board.

### Added
- **Collapsible sidebar** — header toggle / stage expand button / splitter click (when
  collapsed) or double-click toggles; width drag still works and expands if collapsed.
  Prefs store `sideCollapsed` alongside `sideWidth`.
- **Component Library page** — pinned first in Pages; synthesized from `components/*/meta.json`
  via `/components/board.json`. System primitives + product components share one gallery;
  empty state stays visible when no components exist.
- **`data-ios-include`** — screen HTML can pull `components/<id>/<variant>.html`; optional
  `data-text` fills `[data-ios-slot="text"]`. HMR on `components/**` refreshes the library and
  the active flow page.
- **Board.json page layout** — Example Library is `previews/library/board.json` + sibling
  screen HTML. Workbench `loadBoard` fetches the board, injects screens, and lays out each
  section as `row` | `column`. HMR watches `previews/<page>/board.json` and `*.html`.
- **Loader phone shell** — board screens are in-screen fragments; `wrapPhoneShell` adds
  stage/device/bezel/statusbar/home. Optional `shell: "lock"` for lock screens. Legacy
  full-shell HTML is detected and left as-is.
- **Seed components** — system recipes (button, segmented, chip, callout, switch, search,
  list, nav, notification) + product `bubble` (incoming/outgoing).

### Changed
- **Component Library board** — variants use `.wb-comp-stage` (light surface, no phone chrome);
  flow pages still get `wrapPhoneShell`. Annotate targets include `.wb-comp-stage`.
- **Sidebar delete mark** — each annotation row has ×; calls `iOSAnnotate.removeMark(n)`.
- **Workbench multi-page** — click Pages to switch boards; Component Library is system
  (no rename). Active page persisted in prefs.
- **Annotation comment UI** — comment box / tip / lasso mount inside `#ann-chrome` above the
  highlight overlay; box clamps to the stage.
- **Messaging flow example** — board section `msg-flow` (lock → thread → reply) as a
  three-screen `row` demo of the agent screen-fragment contract.

### Fixed
- **Annotation marks follow pan/zoom** — scroll/resize use rAF-throttled `renderAll`; canvas
  zoom calls `iOSAnnotate.render()` after updating `--wb-board-zoom`.
- **Annotation misalignment under canvas zoom** — board scale uses `transform: scale` (with a
  sized `.wb-zoom-wrap`) instead of CSS `zoom`, which desynced `getBoundingClientRect` from
  `elementFromPoint` and shifted hover/marks.
- **ESC exits annotation** — Escape closes the comment box, cancels in-progress lasso/arrow,
  then turns off annotate mode.
- **Sidebar mark navigation** — `goToMark` no longer calls `setPaused(true)`, which hid the
  overlay (and the comment box) after jumping to a mark.

### Removed
- Monolithic `previews/library.html` (replaced by the board directory).
- In-board `components` section (replaced by Component Library page).
- Boot-time `MutationObserver` on `[data-ann-group]` (never saw async-loaded board sections).

---

## 2026-07-08

### Changed
- **Example Library page** — merged lock / settings / feed / components / AB into a single
  scrollable page with sidebar jump links.
- **Sidebar collapsible sections** — Figma-style collapsible sections (`Pages`, `Annotations`)
  in a single scrollable panel; open/closed state persisted.

### Added
- **Sidebar Annotator panel** — workbench side panel hosts annotate controls and all-marks
  list with click-to-navigate (`goToMark`). `iOSAnnotate` API extended with `onUpdate`,
  `getState`, `setFloatingToolbar`, `goToMark`, `openMark`.
- **Vite dev server** — `npm run dev` on port **5199** replaces `serve.py` as the primary
  local dev entry. CSS hot-reloads via Vite; preview fragments reload only their panel
  (`preview-hmr` plugin + `workbench.js`). Annotation API ported to
  `plugins/annotate-api.js` middleware.

### Changed
- **Icon model** — app/content icons are **emoji** (`.ios-emo`, `.ios-cell-emo`,
  emoji inside `.ios-icon-tile` / `.ios-tab`). System chrome stays **SVG**: one
  `#ios-kit-chrome` sprite for status bar and nav glyphs.
- **Unified local server** — template + annotation API on one port.

### Added
- **Framework-free iOS kit** (`ios-kit.css`): pixel-honest iPhone 16 Pro bezel + a
  `screen-only` mode, and an HIG-accurate component library — nav (large-title + compact
  bar), grouped lists, cards, buttons, segmented, switch, search, chips, badges, callouts,
  tab bar, sheet. Everything scoped under `.ios-root`; role-based `--ios-*` tokens with a
  full light/dark set. Typography is **CJK-safe** (no negative Latin tracking, which crushes
  PingFang).
- **Runtime** (`ios-kit.js`): autoFit device scaling, in-phone tabs / sheets / segmented,
  live status-bar clock. Auto-injects the icon sprite + status-bar glyphs.
- **Lock screen + frosted notification** components.
- **iOS Dynamic Type** knob (`data-text-size` = small / default / large) that scales content
  text while chrome stays fixed, as on iOS.
- **Workbench** (`index.html`): a sidepanel of preview tabs with pinned Frame / Text / Theme
  controls that drive every phone at once, plus an AB-test tab pattern.
- **`starter.html`**: copy-me single-phone preview for one-off use.
- **Annotation review loop**: mark up a preview in the browser — click / lasso / comment /
  paste reference image / draw move-arrow / flag research — auto-persisted to
  `~/.html-annotate/`; the agent reads the marks and revises the source. A tab-aware fork of
  [xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate).
- **Per-tab preview fragments**: one small file per scenario, so the board never bloats into
  one giant HTML and editing a scenario opens only that file.

### Changed
- Converged to a **single device** (iPhone 16 Pro); default to **screen-only**.
- Unified all icons into **one filled SVG sprite**.
- **Design-system cleanup** — merged parallel letter-spacing token sets into per-type
  `--ios-t-*-ls` tokens; wired stray radii / raw hexes to tokens.

### Fixed
- **Buttons and tab-bar labels rendered at inherited body size/weight.** The scoped reset's
  `font: inherit` outranked `.ios-btn` / `.ios-tab` and silently clobbered their
  `font-size` + `font-weight`. The reset now inherits **`font-family` only**.

### Removed
- Dead tokens: `--ios-r-lg`, `--ios-tr-t1/12/11`; unused `.ios-root.dark` alias.
