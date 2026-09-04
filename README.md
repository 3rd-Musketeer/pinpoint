# pinpoint

**A local visual feedback service for high-fidelity UIUX prototypes — your agent builds and revises
them, you review the real thing in a browser and hand feedback back through annotations.**

pinpoint runs as one persistent local service (`https://pinpoint.localhost`) with three layers:

- 🧰 **Kits** — accumulated design specs. `content/kits/ios/` (HIG-accurate, CJK-safe, zero runtime deps) is
  the first kit, not the product; the layout leaves room for future web/html kits.
- 🖥️ **Workbench / canvas** — a Figma-like multi-page viewer for comparing prototype variants side
  by side. A page holds two forms: **canvas** (phone artboards, the iterating form) and **doc**
  (a whole standalone document in a full-viewport iframe, the presenting form).
- ✏️ **Annotation** — the core layer and the human→agent feedback loop. Marks made in the browser
  land on disk for the agent to read and act on. One client, injected only into what you registered.

Also: 🤖 **agent-native** ([`AGENTS.md`](AGENTS.md) + in-repo skills teach any coding agent the
contracts), 🖼️ **doc-ready export** (Frame picker → isolated 2× PNG / zip), 🔁 **HMR** (edit a screen
or component, the open board refreshes in place).

## 问题 → 文档

| 你要什么 | 读哪里 |
|---|---|
| 这些词是什么意思（page / board / entry / frame / 桶 / 账本） | [`CONTEXT.md`](CONTEXT.md) |
| agent 开工读什么、验收命令、坑与约定 | [`AGENTS.md`](AGENTS.md) |
| `board.json` 的字段、条目派生、交互 frame、编辑面 | [`docs/board-schema.md`](docs/board-schema.md) |
| registry 条目形状、`pinpoint add` / `move` / `rename`、三条注入路径、url 代理 | [`docs/registry.md`](docs/registry.md) |
| 标注字段、账本与桶、控制面、workbench 偏好、图片导出 | [`docs/annotation.md`](docs/annotation.md) |
| 设计语言正典（写 / 改 UI 前必读） | [`docs/design.md`](docs/design.md) |
| 一个决定为什么是这样、什么时候定的 | [`docs/adr/`](docs/adr/) |
| 怪现象排查案例库 | [`docs/debugging.md`](docs/debugging.md) |
| 五阶段收敛计划当时怎么切的（历史） | [`docs/2026-08-16-roadmap.md`](docs/2026-08-16-roadmap.md) |
| 加页 / 加屏 / 加组件的做法 | [`skills/pinpoint-build/SKILL.md`](skills/pinpoint-build/SKILL.md) |
| 标注 → 读标注 → 修改的做法 | [`skills/pinpoint-annotate/SKILL.md`](skills/pinpoint-annotate/SKILL.md) |
| 变更历史 | `git log`（本仓不维护 changelog） |

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
`http://127.0.0.1:5199`. Once `pinpoint` is on your PATH (`npm link`), `pinpoint status` is the
first thing to run when the site does not open — it checks the portless route, the pid, both
health endpoints, and whether the running service is the repo you are standing in;
`pinpoint start` / `stop` / `restart` drive that same service.

Then tell your agent:

> 读一下 AGENTS.md，然后在 Example Library 加一屏 XXX

Verify changes:

```bash
npx playwright install chromium   # first browser-test run only
just check                        # node contracts + template-only workbench e2e
```

Requires Node ≥ 24 and [just](https://just.systems/).

## Repository layout

```
AGENTS.md                    Agent entry — 开工读序 + 坑与约定 + 技能路由
CONTEXT.md                   Vocabulary — one definition per word, with where it lives in code
docs/                        Rules and runbooks: board-schema, registry, annotation, design; adr/ = decisions
index.html                   WORKBENCH shell — Pages (Component Library pinned first) + Theme controls

src/                         pinpoint itself — the disk layout moves, the served URLs never do
  src/workbench/             Board loader, data-ios-include, preview-script mount (A+B), HMR client
  src/client/annotate.js     The annotation client (served as /annotate.js)
  src/server/                Vite plugins: annotate/sites/export APIs, components-board, preview-hmr,
                             preview-inject, template-only, content-routes (URL → disk mapping);
                             lib/site-proxy.js = same-origin proxy for url entries;
                             lib/annotate-snippet.js = injection SSOT
  src/shared/                Node-tested isomorphic libs inlined into /annotate.js (page key, indicator,
                             slug, clip, bubble, ann-row) + proxy-rebase.js + ann-list.css
  src/pages/                 panel.html (extension side panel) + starter.html — served as /panel.html,
                             /starter.html

content/                     what the service serves
  content/kits/ios/ios-kit.css   iOS kit: variables + chrome styles + primitive CSS
  content/kits/ios/ios-kit.js    iOS kit runtime — auto-fit, tabs/sheet/segmented, live clock
  content/kits/ios/components/   Component Library sources (meta.json + variant HTML) — URL /kits/…
  content/previews/<page>/       Template pages only — board.json + screen HTML (+ optional <screen>.js)
  content/previews/_index.json   Page manifest (id / title / order / default / mode) — URL /previews/…

bin/pinpoint.mjs             CLI — registry (`add` / `move`) + service lifecycle (`status` / `start` /
                             `stop` / `restart`); logic + tests in bin/pinpoint-cli.js
extension/                   MV3 browser extension — injects the client on registered url entries
skills/                      Agent skills (dir-ref, tool-agnostic) — build + annotate contracts
scripts/                     CLI entry for export + the wb-token generator
e2e/                         Playwright workbench / registry / extension tests
```

Your own pages do **not** live in this repo. Register any directory, single HTML file, or live URL
with `pinpoint add`, and it shows up as a workbench page served from `/sites/<entry-id>/` — the files
stay where they are. Moved the source? `pinpoint move <id> <new path>` re-points the entry and keeps
the id, so the annotations in `~/.pinpoint/<id>/` stay attached. Renaming the entry itself is
`pinpoint rename <old id> <new id>` — it moves the registry entry, the annotation bucket, and the
`/sites/<id>/` prefix written into the entry's own files in one shot. See
[`docs/registry.md`](docs/registry.md).

## Annotation review loop

Mark up a preview — Figma-style — and have your agent read marks and revise.

1. Press **A** to switch 交互 → **标注**; click / lasso elements, write comments in the bottom
   composer (pills reference targets; `[indicator N]` inlines them), paste reference images,
   draw move-arrows.
2. Say「标好了，你看一下」— the agent reads the annotation documents (disk SSOT in per-entry buckets
   under `~/.pinpoint/<entry-id>/`, exposed by `GET /health`; revisioned, SSE-synced) grouped by
   `pageId → section → screenId`, edits the routed source file, and the board hot-reloads.
   The agent summarizes what changed and why in the conversation.
3. Click any sidebar comment to focus its owning frame, review the visual change, then clear
   resolved marks and repeat.

Short locators for chat: `@page:library` · `@section:library/brew-flow` · `@frame:library/timer` ·
`@a:<id>`. Full schema and routing: [`docs/annotation.md`](docs/annotation.md).

Annotations are per-machine (solo human + agent loop), not a multiplayer comment system.
The annotation layer never touches a page you didn't register — **登记过才注入**. Everything else —
`file://`, a self-started server, an unregistered origin — opens the identical bytes with zero
annotation surface, and exported artifacts never contain the injected client.

## Export Frame images

Open the export picker from the canvas HUD's **导出** button — the single entry point (ADR 0015).
The picker shows the current page's proto tree (section rows select all their frames, frames check
freely), a live preview of the selected frames, and the only option that changes the delivered
pixels: background (**画布** paper grid / **白底** / **透明**). Output is fixed **PNG 2×**. Captions
(A1 ref + screen title + dim line) always ride along. One selected frame downloads a PNG directly;
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
Transparent output requires PNG; very large 2× Sections fail with a clear 1× retry hint instead of
silently wrapping or clipping the flow.

Document entries export from their own row in the sidebar's 「内容」区 (full HTML, CSS-stripped HTML
for AI, or a full-page 2× PNG).

## One phone, no workbench

Copy [`src/pages/starter.html`](src/pages/starter.html), or use the minimal skeleton:

```html
<link rel="stylesheet" href="/kits/ios/ios-kit.css">
<script src="/kits/ios/ios-kit.js" defer></script>

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

- **Shell (chrome)** — `ios-stage` `ios-root` `ios-device` `ios-key.*` `ios-bezel` `ios-screen`
  `ios-island` `ios-statusbar` `ios-home` — loader-owned on boards
- **Type** — `ios-large` `ios-title1/2/3` `ios-headline` `ios-body` `ios-callout-t` `ios-subhead`
  `ios-footnote` `ios-caption/2`
- **Nav** — `ios-nav` · `ios-navbar` (`ios-nav-lead`/`-title`/`-trail`, `ios-back`)
- **Lists** — `ios-page` `ios-section` `ios-list` `ios-cell` `ios-card`
- **Controls** — `ios-btn` `ios-segmented` `ios-switch` `ios-search`
- **Status** — `ios-chip` `ios-badge` `ios-callout`
- **Overlays** — `ios-tabbar` · `ios-sheet` · `ios-sheet-backdrop` — **siblings of `.ios-app`**,
  not children (`.ios-app` scrolls; overlays pin to `.ios-screen`)
- **Lock** — `ios-lockscreen` `ios-notification` …
- **Utils** — `ios-muted` `ios-row` `ios-spacer` `ios-clamp1/2`

See the Component Library page for live recipes. Sheet + tabbar structure:
[`content/previews/library/home.html`](content/previews/library/home.html).

**Icons** — emoji for app/content; system chrome SVG (`#c-back`, `#c-chev`, `#c-search`) auto-injected.

## Design rules baked in (iOS kit)

- **Points, not viewport pixels** — device fixed-size, scaled as a unit.
- **Glass on the nav layer only** — content cards stay solid.
- **Grouped lists are flat** — white-on-gray, no shadow.
- **Role-based color** — `--ios-text-2`, `--ios-fill-3`, `--ios-accent`; never raw hex in app markup.
- **Tracking is CJK-safe** — body tracking `0`; don't reintroduce negative Latin tracking.

The workbench's own design language is a separate canon — see [`docs/design.md`](docs/design.md).

## Development and publishing

One Git repository, two long-lived worktrees:

| Branch / worktree role | Responsibility |
|---|---|
| **`dev` / daily worktree** | Ongoing development and the only owner of the persistent `pinpoint.localhost` route |
| **`main` / release worktree** | Clean public-template verification and publishing; no feature development or private instance content |

```bash
just dev       # local server; no Git write
just check     # local verification; no remote write
just ship-dev  # check and push the clean dev branch to origin/dev
just publish   # from the release worktree on main: ff-only, npm ci, template-only check, push
```

`main` only advances by fast-forwarding to a clean, published `dev` tip. The release worktree has its
own `node_modules`, so publishing installs the exact lockfile before running the template-only gate.
`just publish` refuses dirty or divergent worktrees, never force-pushes, and never creates a merge
commit. The full contract is in [`AGENTS.md`](AGENTS.md).

Clone per project. `content/previews/` holds **template content only**: the tracked examples (`library/`,
`doc-library/`). Framework files stay untouched, so pulling template updates is a clean overwrite of
`content/kits/ios/ios-kit.*` / `src/` / `index.html`.

## Credits

The annotation system is a heavily extended fork of
[xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)
(section/page routing, disk SSOT + SSE, target composer, indicators).
