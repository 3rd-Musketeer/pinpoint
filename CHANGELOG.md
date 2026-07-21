# Changelog

All notable changes to the **iOS App Preview** template. Newest first.
Loosely follows [Keep a Changelog](https://keepachangelog.com/); dates are `YYYY-MM-DD`.
Group entries under **Added** / **Changed** / **Fixed** / **Removed**.

---

## 2026-07-20

### Changed
- **topic-subs SSOT** — product conclusions for standing-question / 关注 live in
  `topics/topic-subs/`; `shared-calendar` preview keeps executable UI + points
  back via `NOTES.md`. Workbench page title →「关注 · 话题同步」.
- **shared-calendar · digest body-first** — digest cards drop topic headline;
  topic + period stay in the foot; bullets carry the summary.
- **shared-calendar · digest card wash** — cool blue gradient on digest cards
  (vs alert red wash) so mixed newest-first feed reads as two kinds at a glance.
- **shared-calendar · strategy page as edit surface** — strategy list supports
  manual add/delete; same panel for create and for editing an existing topic
  (tap from `topic-list`). Footer still「继续修改」(areta sheet) /「结束修改」.
- **shared-calendar · topic create as key frames** — split into `topic-list` /
  `topic-compose` / `topic-strategy` side-by-side (strategy list: alert one-liner
  + digest with interval/time; voice「让 areta 继续改」). Old multi-view
  `topic-manage` moved to backlog.

### Added
- **shared-calendar · topic-manage frame** — separate phone for topic list +
  create flow: intent + peers → agent strategy → confirm / manual edit /
  one-line agent revise loop. Keeps follow feed frame light.

### Changed
- **shared-calendar · timeline as secondary page** — digest tap pushes in-app
  timeline (back to 关注); rail + cards only (no section mini-titles); digest
  timestamp moved to card bottom-left beside peer avatars.
- **shared-calendar · 关注 feed layout** — (superseded same day by newest-first
  mixed stream) earlier two-section digests-on-top layout; swipe triage and
  timeline secondary page remain.

### Added
- **shared-calendar · alert triage variants** — Discover › 关注 watchlist:
  per-subscription block with open/todo alerts + pinned latest digest.
  Compare A swipe (→ todo toggle / ← 知道了), B tap-to-expand actions,
  C always-visible dual buttons (`topic-feed-a1` / `expand` / `buttons`).

### Changed
- **shared-calendar · MVP → Discover › 关注** — relocate unified subscription
  feed from Memory「近况」to Discover between 好友 and 商店
  (`topic-feed-a1`). Same chip filter + leading list-icon manage / create;
  nav `+` also opens create. Friends list stub + store placeholder for
  segment context. Memory-hosted shells stay in backlog.
- **shared-calendar · MVP = leading list icon** — promote `topic-feed-a1`:
  sticky manage icon + scrollable filter chips; manage sheet jumps to filter
  and hosts create flow (intent → plan → peer). Trailing「管理」(`a2`) and
  other IA shells stay in backlog. Navbar gear remains Memory settings.

### Added
- **shared-calendar · manage entry A1/A2** — unified feed kept; compare
  chip-row manage placements: leading list icon (`topic-feed-a1`) vs trailing
  「管理」chip (`topic-feed-a2`). Navbar gear stays Memory settings. Scheme B
  and prior top-right「订阅」entry moved to backlog.
- **shared-calendar · Topic IA 对照** — primary section compares scheme
  **A** unified feed (`topic-feed-a`: alerts atop digests, one subscription
  filter axis, manage via sheet) vs **B** mode segments (`topic-feed-b`:
  需关注 | 汇总 | 订阅). Memory chrome treats「近况」as peer to 日程与活动.
  Prior dual-calendar / split shells moved to **backlog** section.
- **shared-calendar · Topic 多视图** — section ③ side-by-side frames on one fake
  story: `subs-home` (subscription-first + create sheet: intent → digest/alert
  plan → pick peer), `alert-timeline` (filterable alert column), `digest-feed`,
  `cal-alert-attach` (dual day with alert badges on episodes). Shared data in
  `_topic-data.js`. Calendar framed as time anchor only, not the product core.
- **shared-calendar page** — dual-column Memory calendar prototype for exploring
  side-by-side self/peer day timelines. Interactive `dual-day` toggles Joy / 妈妈
  via contact sheet (summary-only peer lane); `solo-day` is the single-column
  baseline. Entry: workbench page **Shared Calendar**.

---

## 2026-07-14

### Added
- **goal-weekly · v8-river PROBE** — second expression of baseline-vs-day: Cloudflare-style
  100% stacked-area of daily composition (3 weeks, real TA data) with workday/weekend
  baseline reference columns, flaw-day gaps (broken record / >24h window overlap),
  lone-day column fallback, leave-one-out per-day deltas, legend chips, and generated
  copy on probe days. Data via `areta-flow runs/day-flow-probe/rivermap.py`;
  geometry/interaction in `river-core.js`.
- **goal-weekly · v7-gen PROBE row** — four `bvs-*-gen` screens: same sankey geometry
  and data as the hand-written v6-bvs row, but headline / body / insights / prompts are
  LLM-generated (areta-flow `runs/day-flow-probe/`, dsv4pro single call over chart JSON +
  episode timeline + obs ledger). Side-by-side blind eval against the hand-written row;
  regenerate via `probe.py run && probe.py emit`.

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
- **评论 → 标注** copy sweep in `skills/annotate.js` comments (data fields unchanged).

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
  `.ios-nav` / `.ios-navbar` / `.ios-glass` share sheen + rim + chroma. `--ios-glass`
  remains a compat alias.
- smart-todo floating nav pills use `.ios-glass-pill` instead of duplicated inline blur.
- Sidebar toggle labels **交互** / **标注**; empty-state hint points at 标注 mode.
- Scope matching is strict: annotations without `pageId` never match `@page` / `@section` /
  `@frame`. Unsaved annotate-box copy falls back to a scope indicator (never a dangling `@a:`).

### Removed
- **Glass Lab** comparison page (`previews/glass-lab/`) after kit surface upgrade landed.

---

## 2026-07-10

### Added
- **Goal 周报卡 page** (`previews/goal-weekly/`) — 5 interaction variants for the weekly-report
  goal section (feed cards / full-screen story / evidence drill-down / chat-anchored prompts /
  claim triage), fed by `topics/areta-flow` `goal.suggest` output. Registered in
  `previews/_index.json`. Plus a 总览 screen (`overview-sankey`): last-week vs this-week
  time-allocation alluvial from real aria day-level TA (6/23–28 vs 6/29–7/5), tap-to-drill
  per category with insight + prompts.
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
  `data-preview-mount` / `src` sidecar (incl. the tear-calendar exemplar) failed with
  `TypeError: Failed to resolve module specifier`. URLs are now root-absolute (`/previews/…`).
- **Dev server port** — `vite.config.js` honors `PORT` (fallback 5199) and launch.json sets
  `autoPort`, so a second session no longer collides with an already-running kit server.
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
- **Marks disk SSOT + SSE** — annotations hydrate from `~/.html-annotate` on boot
  (`GET /marks/<page>`); `localStorage` is cache only. `POST /save` uses `revision` /
  `baseRevision` (409 on conflict) and rejects blind empty overwrites. `GET /events`
  broadcasts mark updates across browsers. Workbench prefs stay viewer-local (not synced).
  Same behavior in Vite `annotate-api` and `skills/serve.py`.
- **Interactive frame scripts (A+B)** — after mount, workbench runs screen
  `data-preview-script` (inline / module / `src`) and `data-preview-mount` sidecars
  (`previews/<page>/<screenId>.js` → `export default function mount(root)`). Optional
  `unmount` on board reload / HMR. Product gestures stay with the screen; kit stays
  chrome-only. Example: tear calendar moved to `tear-calendar.js`.
- **Canvas minimap** — bottom-left overview of board frames; click a frame to snap-center
  it in the stage (empty space still free-jumps). Toggle with `<` / `>`; prefs store
  `minimapCollapsed`. Updates on scroll / zoom / board mount.

### Changed
- **Agent-ready docs** — topic `AGENTS.md` entry; README `sections[]` + new-page recipe;
  skills split into `skills/annotate/` + `skills/preview-build/` (dir-ref only).
- **Topic skills dir** — renamed `ios-preview-annotate/` → `skills/` (dir-ref only).
  Removed `mori-ws/.claude/skills/ios-preview-annotate` symlink; do not reinstall.
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
  (`position:absolute; overflow:hidden; z-index:5`) so mark frames no longer paint over the
  sidebar; chrome clamps to the stage rect.
- **Marks scoped by workbench page** — new marks store `pageId`; canvas + sidebar list only
  show the active page (legacy marks without `pageId` fall back to current-board `group` /
  selector). `goToMark` switches page when needed.
- **Per-page viewport memory** — prefs `pageViewports[pageId]` remember scroll + zoom across
  page switches; first visit still auto-frames the board.

### Added
- **Collapsible sidebar** — header toggle / stage expand button / splitter click (when
  collapsed) or double-click toggles; width drag still works and expands if collapsed.
  Prefs store `sideCollapsed` alongside `sideWidth`.
- **Component Library page** — pinned first in Pages; synthesized from `components/*/meta.json`
  via `/components/board.json` (Vite plugin + serve.py). System primitives + product components
  share one gallery; empty state stays visible when no components exist.
- **`data-ios-include`** — screen HTML can pull `components/<id>/<variant>.html`; optional
  `data-text` fills `[data-ios-slot="text"]`. HMR on `components/**` refreshes the library and
  the active flow page.
- **Board.json page layout** — Example Library is now `previews/library/board.json` + sibling
  screen HTML. Workbench `loadBoard` fetches the board, injects screens, and lays out each
  section as `row` | `column`. HMR watches `previews/<page>/board.json` and `*.html`.
- **Loader phone shell** — board screens are in-screen fragments; `wrapPhoneShell` adds
  stage/device/bezel/statusbar/home. Optional `shell: "lock"` for lock screens. Legacy
  full-shell HTML is detected and left as-is.
- **Seed components** — system recipes (button, segmented, chip, callout, switch, search,
  list, nav, notification) + product `bubble` (incoming/outgoing); msg-flow uses includes.

### Changed
- **Component Library board** — variants use `.wb-comp-stage` (light surface, no phone chrome);
  flow pages still get `wrapPhoneShell`. Annotate targets include `.wb-comp-stage`.
- **Sidebar delete mark** — each annotation row has ×; calls `iOSAnnotate.removeMark(n)`.
- **Workbench multi-page** — click Pages to switch boards; Component Library is system
  (no rename). Active page persisted in prefs.
- **Annotation comment UI** — comment box / tip / lasso mount inside `#ann-chrome` above the
  highlight overlay; box clamps to the stage. Title, actions, and sidebar list spacing /
  overflow tightened.
- **Screen chrome classes** — drop legacy `wb-ab-col` / `wb-ab-cap`; titled screens use
  `wb-screen` + `wb-screen-cap` only.
- **Example Library screens** — migrated to content-only fragments under `previews/library/`.
- **Annotate flow containers** — clicking a section title (e.g. 「锁屏 · 通知」) or phone
  chrome outside `.ios-screen` selects the whole `.wb-lib-item` flow; in-screen clicks still
  target concrete UI. Mark `text` for flows uses the section title.
- **Messaging flow example** — board section `msg-flow` (lock → thread → reply) as a
  three-screen `row` demo of the agent screen-fragment contract.

### Fixed
- **Annotation marks follow pan/zoom** — scroll/resize use rAF-throttled `renderAll`; canvas
  zoom calls `iOSAnnotate.render()` after updating `--wb-board-zoom`.
- **Recenter on Component Library** — HUD 回中 targets `#wb-board-panel` and scrolls to the
  midpoint of all `.wb-comp-stage` / `.ios-stage` frames (was stuck on removed `#wb-library-panel`
  and only jumped to board pad origin).
- **Annotation misalignment under canvas zoom** — board scale uses `transform: scale` (with a
  sized `.wb-zoom-wrap`) instead of CSS `zoom`, which desynced `getBoundingClientRect` from
  `elementFromPoint` and shifted hover/marks.
- **ESC exits annotation** — Escape closes the comment box, cancels in-progress lasso/arrow,
  then turns off annotate mode.
- **Sidebar mark navigation** — `goToMark` no longer calls `setPaused(true)`, which hid the
  overlay (and the comment box) after jumping to a mark.

### Removed
- Monolithic `previews/library.html` (replaced by the board directory).
- In-board `components` section / `previews/library/components.html` (replaced by Component Library page).
- Boot-time `MutationObserver` on `[data-ann-group]` (never saw async-loaded board sections).

---

## 2026-07-08

### Changed
- **Example Library page** — merged lock / settings / feed / components / AB into a single
  scrollable `previews/library.html`. Sidebar jump links scroll to each `#lib-{group}` block;
  `switchPage` / annotation navigation updated accordingly. Per-tab preview fragments removed.
- **Sidebar collapsible sections** — replaced Pages / Annotator mode tabs with Figma-style
  collapsible sections (`Pages`, `Annotations`) in a single scrollable panel. Section
  open/closed state persisted as `sectionOpen` in localStorage. Settings overlay unchanged.

### Added
- **Sidebar Annotator panel** — workbench side panel hosts annotate controls and all-marks
  list with click-to-navigate (`goToMark`), optional Pin for the floating toolbar.
  `iOSAnnotate` API extended with `onUpdate`, `getState`, `setFloatingToolbar`, `goToMark`,
  `openMark`. Floating toolbar hidden by default.

First working template, then three rounds of refinement in one day.

### Added
- **Vite dev server** — `npm run dev` on port **5199** replaces `serve.py` as the primary
  local dev entry. CSS hot-reloads via Vite; `previews/<tab>.html` fragments reload only
  their panel (`preview-hmr` plugin + `workbench.js`). Annotation API ported to
  `plugins/annotate-api.js` middleware. `npm run dev:py` / `serve.py` kept as a no-Node
  fallback.

### Changed
- **Icon model** — app/content icons are **emoji** (`.ios-emo`, `.ios-cell-emo`,
  emoji inside `.ios-icon-tile` / `.ios-tab`). System chrome stays **SVG**: one
  `#ios-kit-chrome` sprite for status bar (`sb-cellular` / `sb-wifi` / `sb-battery`) and
  nav (`c-chev` / `c-back` / `c-search`). WiFi glyph redrawn (old path clipped outside its
  viewBox). All preview scenarios updated; removed the separate emoji experiment tab.
- **Unified local server** — `ios-preview-annotate/serve.py` now serves the template
  **and** the annotation API on one port (**5199**). No separate `http.server` +
  annotate process. `ios-kit.js` injects `/annotate.js` (same origin); `annotate.js`
  resolves its API base from `document.currentScript` so cross-port manual injection
  still works.

### Added
- **Framework-free iOS kit** (`ios-kit.css`): pixel-honest iPhone 16 Pro bezel + a
  `screen-only` mode, and an HIG-accurate component library — nav (large-title + compact
  bar), grouped lists, cards, buttons, segmented, switch, search, chips, badges, callouts,
  tab bar, sheet. Everything scoped under `.ios-root`; role-based `--ios-*` tokens with a
  full light/dark set. Typography is **CJK-safe** (no negative Latin tracking, which crushes
  PingFang).
- **Runtime** (`ios-kit.js`): autoFit device scaling, in-phone tabs / sheets / segmented,
  live status-bar clock. Auto-injects the icon sprite + status-bar glyphs so a preview needs
  no boilerplate for either.
- **Lock screen + frosted notification** components.
- **iOS Dynamic Type** knob (`data-text-size` = small / default / large) that scales content
  text while chrome (status bar, tab labels, lock clock) stays fixed, as on iOS.
- **Workbench** (`index.html`): a sidepanel of preview tabs with editable title/description
  and pinned Frame / Text / Theme controls that drive every phone at once, plus an AB-test
  tab pattern (two side-by-side variants under one tab).
- **`starter.html`**: copy-me single-phone preview for one-off use.
- **Annotation review loop** (`ios-preview-annotate/` skill): mark up a preview in the
  browser — click / lasso / comment / paste reference image / draw move-arrow / flag research
  — auto-persisted to `~/.html-annotate/`; Claude reads the marks and revises the source.
  **Tab-aware**: each mark records its workbench tab (`group`/`groupLabel`), only the active
  tab's marks render, and Claude reads & edits grouped by tab. Auto-injected by `ios-kit.js`
  on localhost (silent no-op if its server isn't running; never injected off a real host).
  A tab-aware fork of [xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate).
- **Per-tab preview fragments** (`previews/<tab>.html`): the workbench builds one panel per
  tab and fetches each scenario from its own file. The board never bloats into one giant
  HTML, and editing a scenario (or resolving its annotations) opens only that small file.
  Add a tab = new `previews/<id>.html` + one `.wb-tab` button; the panel self-builds.

### Changed
- Converged to a **single device** (iPhone 16 Pro); default to **screen-only** (bezel is a
  toggle); text-size steps relabelled small / standard / large.
- Unified all icons into **one filled SVG sprite**.
- **Design-system cleanup** (value-preserving — verified no visual change): merged the two
  parallel letter-spacing token sets into the per-type `--ios-t-*-ls` tokens, so CJK-safe
  tracking has a single source; wired stray `10px` radii to `--ios-r-sm` and two raw dark
  hexes to `--ios-bg-3` / `--ios-gray-2`.
- Enlarged the lock-screen clock (`.ios-lock-clock`, 86px → 96px) for closer iOS fidelity.

### Fixed
- **Buttons and tab-bar labels rendered at inherited body size/weight.** The scoped reset's
  `font: inherit` (specificity `0,1,1`) outranked `.ios-btn` / `.ios-tab` (`0,1,0`) and
  silently clobbered their `font-size` + `font-weight`, so buttons were 17px/400 (not
  16px/600 semibold) and tab labels were 16px (not 10px). The reset now inherits
  **`font-family` only**, letting component classes control size/weight.

### Removed
- Dead tokens: `--ios-r-lg`, `--ios-tr-t1/12/11`.
- The unused `.ios-root.dark` alias (standardized on `[data-theme="dark"]`) and the redundant
  `[data-device="iphone-16-pro"]` rule (it only re-set the defaults; the attribute stays as a
  label + future-preset hook).
