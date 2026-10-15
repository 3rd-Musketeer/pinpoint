# pinpoint

**A local service for design articles with live UI prototypes in them — your agent writes the
article and its frames, you read it in a browser and hand feedback back through comments and
annotations.**

## The model

The unit is the **article**: a design document written in MDX, readable by anyone with the link. A
**project** is a thin container for a batch of articles and their **wiki entries** (short definitions
of terms); readers see it only as a small tag under the article title. An article is made of **sections**; a section can
hold a **canvas component** (`<Canvas>`) that lists its **frames** (a `.jsx` file per UI state, or a
whole `.html` page) and **figures** (`<Figure>`, diagrams the agent draws in SVG). Every article has an article page; an article with at least one canvas also has a canvas view:

- 📄 **Article page** — `https://pinpoint.localhost/<project>/<article>/`. Prose, a table of contents
  numbered 1, 2, 3, and one canvas card per section with frames. Click a frame to open the canvas
  overlay (frames are interactive there); “打开画布 →” jumps to the canvas view. `[[name]]` links to
  another article or a wiki entry; a link whose target does not exist yet (an empty ref) is allowed and
  shows the wiki entries or articles still missing.
- 🖼️ **Canvas view** — the workbench at `/workbench/?page=<project>_<article>`. Every section with a canvas
  becomes one row of frames, referenced as A1, B3 (section letter + frame number; the nth section is
  the nth letter). It is generated from `index.mdx`; you never write it by hand.

Feedback lands in **one queue per article**: prose comments (select text on the article page) and
annotations on the canvas view (pinned to elements of a JSX frame or of an HTML frame) share one
bucket, one `#n` sequence and one status machine (`open` → `check` / `done` → `close`). The agent
reads them with `ppnt comments`, edits, then replies in the thread and sets the status in one step
with `ppnt mark … done --note "<what changed>"`; `ppnt reply` replies without touching the status.

Underneath: 🧰 **kits** (`content/kits/ios/`: `ios-kit.css` + `ios-kit.js` + `jsx/` component stamps;
HIG-accurate, CJK-safe, zero runtime deps), a compiler that turns JSX frames and figures into static
HTML under `~/.pinpoint/dist/<page id>/` (HMR on every save; HTML frames are served as they are), and an annotation client injected only into what
you registered. Every word above has one definition in [`CONTEXT.md`](CONTEXT.md); the design
decision is [ADR 0042](docs/adr/0042-pp3-article-as-primary-object.md).

**Legacy pages** are prototype pages from before articles: a `board.json` plus frames (or an HTML
file), registered with `pinpoint add` and listed in the workbench's “页面” group.
They are a normal entry point next to articles: view, edit and annotate them as before, and run
`pinpoint migrate` when one should become an article. See the last section of
[`CONTEXT.md`](CONTEXT.md).

## 问题 → 文档

| 你要什么 | 读哪里 |
|---|---|
| 这些词是什么意思（project / 文章 / section / 帧 / 画布视图 / 页 id / 桶） | [`CONTEXT.md`](CONTEXT.md) |
| agent 开工读什么、验收命令、坑与约定 | [`AGENTS.md`](AGENTS.md) |
| 写文章、加帧、加组件、写 wiki 词条的做法（含存量页） | [`skills/pinpoint-build/SKILL.md`](skills/pinpoint-build/SKILL.md) |
| 处理画布标注与正文评论：读 → 修改 → 回复 → 写状态 | [`skills/pinpoint-annotate/SKILL.md`](skills/pinpoint-annotate/SKILL.md) |
| project 与文章的目录、`add --project`、画布视图与页 id、`migrate` | [`docs/projects.md`](docs/projects.md) |
| 文章站点：`Section` / `Canvas`、`[[ ]]`、画布浮层、路由、`llms.txt` | [`site/README.md`](site/README.md) |
| 帧、组件、编译、交互；存量页的 `board.json` 字段 | [`docs/board-schema.md`](docs/board-schema.md) |
| registry 条目形状、`pinpoint add` / `mv` / `remove`、注入路径 | [`docs/registry.md`](docs/registry.md) |
| 标注与评论的字段、桶与账本、状态机、控制面、图片导出 | [`docs/annotation.md`](docs/annotation.md) |
| 设计语言正典（写 / 改 UI 前必读） | [`docs/design.md`](docs/design.md) |
| 一个决定为什么是这样、什么时候定的 | [`docs/adr/`](docs/adr/) |
| 怪现象排查案例库 | [`docs/debugging.md`](docs/debugging.md) |
| 变更历史 | `git log`（本仓不维护 changelog） |

## Quickstart

```bash
brew install just         # once per machine
npm install -g portless   # once per machine
npm install
just dev             # https://pinpoint.localhost/ (all articles); workbench at /workbench/
```

[`Justfile`](Justfile) is the workflow entrypoint. Normal development runs through
[Portless](https://github.com/vercel-labs/portless); install both CLIs once per machine.
Use `npm run dev:direct` only when debugging the proxy boundary; it falls back to
`http://127.0.0.1:5199`. Once `pinpoint` is on your PATH (`npm link`), `pinpoint status` is the
first thing to run when the site does not open — it checks the portless route, the pid, both
health endpoints, and whether the running service is the repo you are standing in;
`pinpoint start` / `stop` / `restart` drive that same service.

Article pages are served on the same origin at `/<project>/<article>/`. The service starts the
Astro dev server on the first article request (`npm run site:dev`, port 4530) and proxies to it;
until it is ready the page shows “站点启动中” and refreshes itself. Knobs: `PINPOINT_SITE_PORT`
(default 4530), `PINPOINT_SITE_CMD` (shell command, `{port}` is substituted). The site's vite must
take its base from `PINPOINT_SITE_VITE_BASE` (the service sets `/_astro/`), because pinpoint's own
vite already owns `/@vite/`, `/@fs/` and the root HMR socket. Its log is
`~/.pinpoint/logs/site-dev.log`; `pinpoint status` shows its state. Routing rules and reserved
first segments: [`docs/design.md`](docs/design.md) “服务路由”.

Then tell your agent:

> 读一下 AGENTS.md，然后按 pinpoint-build 的流程给 XXX 写一篇 article，跑 `ppnt check` 验证

Verify changes with `just check` (or `npm run check`): unit tests, the site build check (`npm run test:site`), then e2e. Install the matching browser on the first run:

```bash
npx playwright install chromium
```

E2E startup checks full Chromium and headless shell before testing. Playwright writes the
fixtures, starts the workbench server and stops it on exit; an occupied port fails
instead of silently reusing another service. Use a distinct `E2E_PORT` for a separate run;
the article site defaults to that port + 5.

`just check` uses the same two-group E2E runner as `just e2e-parallel`. It runs two independent groups, each with one worker and its own server,
registry, annotation storage, copied site fixtures and reports. It reserves `E2E_PORT`
(default 5299), +5, +20 and +25 (each group's port and its article site); choose a base whose four ports are free. New spec files
are included automatically. Any group failure fails the command, and Ctrl+C stops both.
When the 1-minute load average is 10 or higher it runs one group instead of two, and each
failed group reruns its failed tests once; only a failure on that rerun counts (details in
`AGENTS.md`). Write regression tests as unit tests first; e2e is for behavior only a real
browser can check (see `AGENTS.md`).

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

One entry (`bin/pinpoint.mjs`; `npm link` once to put both names on your PATH). The first argument
is the target: an article is `<project>/<article>` (its URL and its page id `<project>_<article>` work
too; output always uses the slash form), a legacy page is its id. Sections are `§2`, a letter `B` or a
section id; frames are `B1` or a frame id; one item is `<project>/<article>#3`. A missing or unknown
target is an error that lists candidates (exit 2). `ppnt <command> --help` gives options and examples;
conventions and exit codes are in [`docs/registry.md`](docs/registry.md) “CLI”.

```bash
ppnt new article <article>     # jot down an article in the default project `notes` (created and registered on first use)
ppnt list [words…]             # projects (each article as <project>/<article>) and legacy pages; words also match article ids and titles
ppnt show <project>            # a project's articles, wiki entries, empty refs and layout errors
ppnt show <project>/<article>  # per section: §n · letter · section id · title · frames · open count · URLs
ppnt check <project>[/<article>]  # validate before reporting: layout errors, every frame's and figure's lint/compile, MDX render errors, empty refs; exit 1 on errors
ppnt comments <target>         # read the queue: canvas annotations, HTML-frame annotations and prose comments, statuses, intents, code excerpts (a project lists every article)
ppnt locate <target> <ref…>    # resolve #12 / B3 / §2 to source file, line, component
ppnt shot <target> [ref…]      # article page PNG (whole page, or §2 for one section); B1 / B / --canvas shoot the canvas view; waits while the site starts
ppnt mark <target> <ref…> done|check [--note <reply>]  # reply in each thread (with --note), then write the status
ppnt reply <project>/<article>#<n> <text>  # reply in one item's thread (status unchanged)
ppnt build <target> [--watch]  # compile frames → dist (~/.pinpoint/dist/<page id>/)
ppnt render <target>/<frame id>  # compile one frame to stdout, no dist write
ppnt status                    # service checkup: route · pid · both health endpoints · root · registry
ppnt prune <target>            # delete orphan ledgers in that bucket (owner's call)
ppnt start | stop | restart    # drive the persistent pinpoint.localhost service
ppnt new project <root>        # create a project skeleton under <root>/docs/pinpoint/ and register it
ppnt add <root> --project      # register a hand-written project (reads <root>/docs/pinpoint/project.json) — see docs/projects.md
ppnt add <dir|file>            # register a legacy page source (files stay where they are) — see docs/registry.md
ppnt mv <project>/<a> <project2>/  # file an article under another project (or <project2>/<b> to rename it too), annotation bucket included
ppnt mv <id> <new id>          # rename a project or page id + annotation bucket(s) + /sites/ prefix in one shot
ppnt mv <id> <path>            # re-point an entry (path starts with /, . or ~), keep its id and annotations
ppnt migrate <page id> --project <root>  # copy a legacy page into an article, then compare frame by frame — see docs/projects.md
```

## Repository layout

```text
AGENTS.md                    Agent entry — 开工读序 + 坑与约定 + 技能路由
CONTEXT.md                   Vocabulary — one definition per word, with where it lives in code
docs/                        Rules and runbooks: projects, board-schema, registry, annotation, design; adr/ = decisions
index.html                   WORKBENCH shell, served at /workbench/ (/?page=… and /index.html redirect there) — full-bleed canvas + floating glass panel + bottom strip
site/                        Article site (Astro): article pages, wiki pages, [[ ]] refs, llms.txt

src/                         pinpoint itself — the disk layout moves, the served URLs never do
  src/workbench/             Board loader, dist screens, preview-script mount (A+B), HMR client
  src/client/annotate.js     The canvas annotation client (served as /annotate.js)
  src/client/prose-comments.js  The prose comment client on article pages
  src/server/                Vite plugins: annotate/sites/export APIs, page compiler, preview-hmr,
                             preview-inject, content-routes (URL → disk mapping);
                             lib/projects.js = project / article reader;
                             lib/article-board.js = canvas view derived from index.mdx;
                             article-proxy.js = /<project>/… → on-demand Astro dev server;
                             lib/annotate-snippet.js = injection SSOT
  src/shared/                Node-tested isomorphic libs inlined into /annotate.js (page key, indicator,
                             slug, clip, bubble, ann-row, project ids, text quote) + ann-list.css

content/                     what the service serves
  content/kits/ios/ios-kit.css   iOS kit: variables + chrome styles + primitive CSS
  content/kits/ios/ios-kit.js    iOS kit runtime — auto-fit, tabs/sheet/segmented, live clock
  content/kits/ios/jsx/          Kit component stamps (JSX), imported from 'pinpoint/kit'
  content/previews/              Template legacy pages only — each a source dir: board.json + <frame>.jsx
                                 + components/ (+ assets); manifest _index.json — URL /previews/…

bin/pinpoint.mjs             CLI — service lifecycle, registry, build/render, article checks; commands in
                             bin/cli/ (address.js = targets and refs, help.js = per-command help),
                             dispatch + tests in bin/pinpoint-cli.js; `ppnt` and `pinpoint` are the same entry
skills/                      Agent skills (dir-ref, tool-agnostic) — build + annotate contracts
scripts/                     wb-token generator + offline-export verifier + e2e runner
e2e/                         Playwright tests + fixtures (e2e/project-site, e2e/prose-site, e2e/jsx-site …)

~/.pinpoint/dist/<page id>/  Compiled frames — generated, not in git, not in the source dir
```

Your articles do **not** live in this repo. `ppnt new article <id>` drops an article into the
default project `notes` without asking where it belongs; `ppnt mv notes/<id> <project>/` files it
later. A project lives in its own repository or topic under `<project root>/docs/pinpoint/`
(`project.json`, `articles/<id>/index.mdx` plus that article's frames and components, `wiki/`);
`ppnt new project <root>` creates and registers it once, and new articles show up without
re-registering. Legacy page sources register the same way with
`pinpoint add <dir|file>` and are served from `/sites/<id>/`. `ppnt mv <id> <new path>`
re-points an entry and keeps its id, so its annotations stay attached; `ppnt mv <old id> <new id>`
renames the id together with its buckets — for a project, every `<project>_<article>` bucket
([`docs/projects.md`](docs/projects.md), [`docs/registry.md`](docs/registry.md)).

## Feedback loop

1. On the article page, select prose and click “评论”; the comment opens a thread in the right
   rail. On the canvas view, press **A** to switch 交互 → **标注**, click / lasso elements and
   write in the bottom composer (pills reference targets, paste reference images, draw move-arrows).
2. Say “标好了，你看一下” — the agent runs `ppnt comments <project>/<article>` (both kinds in one
   list, no browser), edits the frame, component or `index.mdx`, runs `ppnt check`, and answers each
   item with `ppnt mark … done --note "<what changed>"` (or `check` when it looked but changed nothing).
3. Review: hover a pin on the canvas, or open the annotation list from the count button at the right
   end of the bottom strip; on the article page, read the thread in the right rail. Click 完成 to
   close an item (one click, 5 s undo). Closed items collapse away.

Everything for one article lives in one bucket, `~/.pinpoint/<project>_<article>/` (disk is the
SSOT; revisioned, SSE-synced): canvas annotations in `@canvas.json`, prose comments in
`@prose.json`, plus one ledger per HTML frame page for the annotations made on it.

Short locators for chat: `#12` · `<page id>#12` · `B3` · `@frame:<page id>/<frame id>` · `@section:<page id>/<section id>` · `@page:<page id>` (a target) · `@a:<id>`.
Full schema, states and routing: [`docs/annotation.md`](docs/annotation.md).

Annotations are per-machine (solo human + agent loop), not a multiplayer comment system.
The annotation client never touches a page you didn't register — **登记过才注入**. Everything else —
`file://`, a self-started server, an unregistered origin — opens the identical bytes with zero
annotation surface, and exported artifacts never contain the injected client.

## Export an offline interactive HTML

The strip's **导出** button writes one self-contained `<page id>__interactive.html`
(`POST /api/export-page-html`, ADR 0033) — the single user-facing export. The
button shows only on pages the export can build: registry dir entries with
`board: "ios"` (`src/shared/offline-export-scope.js`). It
opens as the same shell you use in the workbench: the full-bleed grid canvas, the
floating glass panel with the outline, and the bottom strip (panel toggle, page
title, `‹ n / N ›` frame navigation, zoom readout, 回中). Wheel scrolls, ctrl/⌘ +
wheel zooms around the cursor, Space + drag or middle-drag pans. On narrow screens
(≤ 760px) the panel starts collapsed and frames stack vertically at screen width.
No annotation surface. The export packages canvas frames; the button sits in the canvas tools, so
document entries (HTML frames, doc screens) don't show it. Sharing an article itself is by link to
the article page.

HTTPS static dependencies are scanned first and frozen byte-exact only after
per-resource approval; pages without remote resources download immediately.

Frame images are the agent side: `ppnt shot` (with `--marks` baking the `#n` pins)
and `ppnt comments --mode image` reuse the same server-side renderer
(`POST /api/export-image`) — frames never implement their own screenshotting.

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

Standalone pages need the full shell; frames do **not** — the loader owns chrome.

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

## Development and shipping

One long-lived branch, `main`, in one primary clone that also runs the persistent
`pinpoint.localhost` route. Larger features get a short-lived `feat/*` worktree and are merged back
with `--ff-only`.

```bash
just dev      # local server; no Git write
just preview  # in a feat worktree: <branch>.pinpoint.localhost on a snapshot of ~/.pinpoint
just check    # local verification; no remote write
just ship     # on main: clean + non-divergent guard, full check, push origin/main
```

`just ship` refuses a dirty or divergent `main` and never force-pushes. The full contract is in
[`AGENTS.md`](AGENTS.md).

Clone per project. `content/previews/` holds **template content only**; instance content
(projects, legacy pages) registers via `pinpoint add` and lives outside this repo.
Framework files stay untouched, so pulling template updates is a clean overwrite of
`content/kits/ios/` / `src/` / `index.html`.

## Credits

The annotation system is a heavily extended fork of
[xueweijia/html-prototype-annotate](https://github.com/xueweijia/html-prototype-annotate)
(section/page routing, disk SSOT + SSE, target composer, indicators).
