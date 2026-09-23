# pinpoint

**A local visual feedback service for high-fidelity UIUX prototypes — your agent builds and revises
them, you review the real thing in a browser and hand feedback back through annotations.**

pinpoint runs as one persistent local service (`https://pinpoint.localhost`) with three layers:

- 🧰 **Kits** — accumulated design specs. `content/kits/ios/` (`ios-kit.css` + `ios-kit.js` + `jsx/`
  component stamps; HIG-accurate, CJK-safe, zero runtime deps) is the first kit, not the product.
- 🖥️ **Workbench / canvas** — a Figma-like multi-page viewer for comparing prototype variants side
  by side. A page holds two forms: **canvas** (phone artboards, the iterating form) and **doc**
  (a whole standalone document in a full-viewport iframe, the presenting form).
- ✏️ **Annotation** — the core layer and the human→agent feedback loop. Marks made in the browser
  land on disk for the agent to read and act on. One client, injected only into what you registered.

Also: 🤖 **agent-native** ([`AGENTS.md`](AGENTS.md) + in-repo skills teach any coding agent the
contracts), 🖼️ **offline interactive HTML export** (one self-contained file per page), 🔁 **HMR**
(source change → recompile → the open board refreshes in place).

Since pp2 (2026-09-22) a page is **source**: `<screenId>.jsx` frames + `components/<Name>.jsx`
page-local components + `board.json`. `ppnt build` compiles it to dist under `~/.pinpoint/dist/<entry>/`;
the canvas, annotations, exports and mentions only ever see the compiled output. Existing `.html`
frames keep working as-is.

## 问题 → 文档

| 你要什么 | 读哪里 |
|---|---|
| 这些词是什么意思（page / board / entry / frame / 桶 / 账本） | [`CONTEXT.md`](CONTEXT.md) |
| agent 开工读什么、验收命令、坑与约定 | [`AGENTS.md`](AGENTS.md) |
| `board.json` 的字段、条目派生、交互 frame、编辑面 | [`docs/board-schema.md`](docs/board-schema.md) |
| registry 条目形状与分组层、`pinpoint add` / `move` / `rename` / `folder`、三条注入路径、url 代理 | [`docs/registry.md`](docs/registry.md) |
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

> 读一下 AGENTS.md，然后按 pinpoint-build 的流程给 XXX 搭一页，跑 `ppnt build` 编译

Verify changes with `just check` (or `npm run check`). Install the matching browser on the first run:

```bash
npx playwright install chromium
```

E2E startup checks full Chromium and headless shell before testing. Playwright owns both
the proxy fixture and workbench server and stops them on exit; an occupied port fails
instead of silently reusing another service. Use a distinct `E2E_PORT` for a separate run;
the upstream defaults to that port + 10.

`just check` now uses the same two-group E2E runner as `just e2e-parallel`. It runs two independent groups, each with one worker and its own server,
registry, annotation storage, copied site fixtures and reports. It reserves `E2E_PORT`
(default 5299), +10, +20 and +30; choose a base whose four ports are free. New spec files
are included automatically. Any group failure fails the command, and Ctrl+C stops both.

Use `just e2e-serial` for serial verification. For a targeted test, use
`npm run test:e2e:serial -- e2e/scroll-motion.spec.js`. Ordinary workbench navigation uses
reduced motion; dedicated motion stories retain real animation. Run `canvas-pan.spec.js`
alone when comparing frame timings: parallel load is suitable for functional checks,
not an isolated rendering benchmark.

Prefer fast contract tests for parsing, persistence, rejection paths and data migration.
Browser tests cover complete user flows, browser-specific behavior and serious regressions;
avoid fixing font sizes, colors or obsolete DOM structure in long-lived assertions.

Requires Node ≥ 24 and [just](https://just.systems/).

## CLI (`ppnt` = `pinpoint`)

One entry (`bin/pinpoint.mjs`; `npm link` once to put both names on your PATH):

```bash
ppnt list [words…]             # page list: id · title · kind · counts · folder + source path; fuzzy match on words
ppnt status                    # service checkup: route · pid · both health endpoints · root · registry
ppnt start | stop | restart    # drive the persistent pinpoint.localhost service
ppnt add <dir|file|url>        # register an entry (files stay where they are) — see docs/registry.md
ppnt move <id> <target>        # re-point an entry, keep its id and annotations
ppnt rename <old> <new>        # rename id + annotation bucket + /sites/ prefix in one shot
ppnt folder list|add|rename|rm|move   # the one level of page grouping in the sidebar
ppnt build <page> [--watch]    # compile source → dist (~/.pinpoint/dist/<entry>/)
ppnt render <page>/<screen>    # compile one frame to stdout, no dist write
ppnt check <page>              # read annotations: statuses, intents, code excerpts (contract, slice 4)
ppnt locate <ref…>             # resolve #12 / B3 to source file, line, component (contract, slice 4)
ppnt shot <ref…> [--marks]     # PNG of frames/sections/page, --marks bakes the #n pins (contract)
ppnt mark <ref…> done|check    # write annotation status, --note for the one-liner (contract)
```

## Repository layout

```text
AGENTS.md                    Agent entry — 开工读序 + 坑与约定 + 技能路由
CONTEXT.md                   Vocabulary — one definition per word, with where it lives in code
docs/                        Rules and runbooks: board-schema, registry, annotation, design; adr/ = decisions
index.html                   WORKBENCH shell — full-bleed canvas + floating glass panel + bottom strip

src/                         pinpoint itself — the disk layout moves, the served URLs never do
  src/workbench/             Board loader, dist screens, preview-script mount (A+B), HMR client
  src/client/annotate.js     The annotation client (served as /annotate.js)
  src/server/                Vite plugins: annotate/sites/export APIs, page compiler, preview-hmr,
                             preview-inject, content-routes (URL → disk mapping);
                             lib/site-proxy.js = same-origin proxy for url entries;
                             lib/annotate-snippet.js = injection SSOT
  src/shared/                Node-tested isomorphic libs inlined into /annotate.js (page key, indicator,
                             slug, clip, bubble, ann-row) + proxy-rebase.js + ann-list.css

content/                     what the service serves
  content/kits/ios/ios-kit.css   iOS kit: variables + chrome styles + primitive CSS
  content/kits/ios/ios-kit.js    iOS kit runtime — auto-fit, tabs/sheet/segmented, live clock
  content/kits/ios/jsx/          Kit component stamps (JSX), imported from 'pinpoint/kit'
  content/previews/              Template pages only — each a source dir: board.json + <screen>.jsx
                                 + components/ (+ assets); manifest _index.json — URL /previews/…

bin/pinpoint.mjs             CLI — service lifecycle, registry, build/render; logic + tests in
                             bin/pinpoint-cli.js; `ppnt` and `pinpoint` are the same entry
skills/                      Agent skills (dir-ref, tool-agnostic) — build + annotate contracts
scripts/                     wb-token generator + export-preview (frame renderer)
e2e/                         Playwright workbench / registry tests + page fixtures (e2e/jsx-site …)

~/.pinpoint/dist/<entry>/    Compiled screens (pp2 dist) — generated, not in git, not in the page dir
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
2. Say“标好了，你看一下”— the agent runs `ppnt check <page>` (statuses, intents, code excerpts,
   no browser), edits the routed source file, `ppnt build`, then writes `ppnt mark … done --note`.
   Annotations live in per-entry buckets under `~/.pinpoint/<entry-id>/` (disk is the SSOT;
   revisioned, SSE-synced). Four states: `open` (yours) → `check` / `done` (agent) → `close` (yours).
3. Hover a pin on the canvas to read its comment card, or open “这页的标注” from the count
   button at the right end of the bottom strip and click 定位 to focus the owning frame. Review the
   change and click 关闭 on the done row (one click, toast with 5 s undo). Closed rows collapse away.

Short locators for chat: `#12` · `plugins#12` · `B3` · `@frame:<page>/<screen>` · `@a:<id>`.
Full schema, states and routing: [`docs/annotation.md`](docs/annotation.md).

Annotations are per-machine (solo human + agent loop), not a multiplayer comment system.
The annotation layer never touches a page you didn't register — **登记过才注入**. Everything else —
`file://`, a self-started server, an unregistered origin — opens the identical bytes with zero
annotation surface, and exported artifacts never contain the injected client.

## Export an offline interactive HTML

The strip's **导出** button writes one self-contained `<page>__interactive.html`
(`POST /api/export-page-html`, ADR 0033) — the single user-facing export (pp2). It
opens as the same shell you use in the workbench: the full-bleed grid canvas, the
floating glass panel with the outline, and the bottom strip (panel toggle, page
title, `‹ n / N ›` frame navigation, zoom readout, 回中). Wheel scrolls, ctrl/⌘ +
wheel zooms around the cursor, Space + drag or middle-drag pans. On narrow screens
(≤ 760px) the panel starts collapsed and frames stack vertically at screen width.
No annotation surface.

HTTPS static dependencies are scanned first and frozen byte-exact only after
per-resource approval; pages without remote resources download immediately.

Frame images are the agent side: `ppnt shot` (with `--marks` baking the `#n` pins)
and `ppnt check --mode image` reuse the same server-side renderer
(`POST /api/export-image`) — screens never implement their own screenshotting.

## One phone, no workbench

Use the minimal skeleton:

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

Live recipes: the page fixtures under `e2e/` (`e2e/jsx-site/` for JSX frames + components,
`e2e/ios-site/` for the full board shapes). Sheet + tabbar structure: `e2e/ios-site/home.jsx`.

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

Clone per project. `content/previews/` holds **template content only** (pp2 removed the old tracked
example pages; instance content always registers via `pinpoint add` and lives outside this repo).
Framework files stay untouched, so pulling template updates is a clean overwrite of
`content/kits/ios/` / `src/` / `index.html`.

## Credits

The annotation system is a heavily extended fork of
[xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)
(section/page routing, disk SSOT + SSE, target composer, indicators).

## “去 Manus 配置” 移出产品页（2026-09-10 晚，owner 问“正式的 web 里会有吗”）

不会有。它只是原型里跳到 Manus 设置页模拟的入口，用来演示 “把 key 填进应用” 这一步；正式 Web 无法深链进第三方设置页。已从保存 key 页删除，保存页只剩 “我已保存”。模拟页改由评审工具栏的 “模拟 Manus 配置” 打开。
