// preview-hmr：previews/ 与 registry dir/file 条目的变更 → workbench 重摆。
// registry 条目（2026-08-17e 实例搬迁地基）：vite 默认只 watch 仓库根，仓外
// 条目目录经 configureServer 的 watcher.add 补挂；条目增删随 registry:reload
// 同步（vite.config 里包装 registryStore.reload 调本插件的 syncWatcher）。
// 仓库自身（id 多为 'pinpoint' 的默认条目）不算——previews/ 走下面的既有分支，
// workbench 源码走 vite 默认 HMR，都不许被 preview:update 吞掉。
//
// pp2（2026-09-22 切片 1）：页是「源码 → 编译 → dist」——
// - 服务启动时对所有 dir 条目与模板页跑一遍全量编译，日志打总耗时与每页耗时；
// - 页目录里 .jsx / .html / board.json / .css 变更 → 重编译该页 → 发
//   preview:update（增量编译带上重编过的屏清单，工作台按屏重摆；整页重编不带）；
//   .js（sidecar）变更 → 重编译该页 → 发 full-reload
//   （ES module 缓存，见 BACKLOG「sidecar 模块改动后画板自动刷新」）。
//   帧 import 的 .json / .ts / .tsx / .mjs / .cjs 同样盯（它们会进 build.json
//   的 deps，不盯就改了零事件），类型清单与排除项见 recompile-plan 的 isWatchedSource。
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { PROJECT_CONTENT_DIR } from './lib/page-resolve.js';
import { buildAllPages, compilePage, defaultDistRoot } from './lib/page-compiler.js';
import { resolvePageTarget } from './lib/board-source.js';
import { articlePageId } from '../shared/project-ids.js';
import { findProject } from './lib/projects.js';
import { projectEntries } from './lib/registry.js';
import { isWatchedSource, planPageRecompile } from './lib/recompile-plan.js';
import { broadcastPreviewUpdate } from './annotate-api.js';

// PREVIEW_TEMPLATE_ONLY=1 keeps compile targets on pure template state, so e2e
// (playwright.config.js sets it) sees the same targets on every machine.
const templateOnly = () => !!process.env.PREVIEW_TEMPLATE_ONLY;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// previews 分支（M2）：模板页的 components/ 子目录（pp2 的核心输入）与任意
// 深层的帧/资源都要接住，正则此前只认页目录顶层单段文件名，子目录变更静默
// 不重编。这里只取页 id，文件类型由 isWatchedSource 判；嵌套的 board.json 不是
// 板，由 recompile-plan 认领不到 → 全编。
const PREVIEWS_FILE = /\/previews\/([^/]+)\/(?:[^/]+\/)*[^/]+$/;
// F3：首个文件事件收同伴的窗口（CLI startPageWatch 的 debounce 同思路，那边 120ms）。
const COLLECT_MS = 80;

export default function previewHmr(options = {}) {
  const registry = options.registry || null;
  const distRoot = options.distRoot || null;
  const templateRoot = options.templateRoot || ROOT;
  // 测试口：collectMs 改成 0 时，「首拍开编之后才到的第二拍」必须落进下一次编译；
  // onCompileStart 让测试能精确卡在「编译刚开始」这一刻。
  const collectMs = options.collectMs ?? COLLECT_MS;
  const onCompileStart = options.onCompileStart || null;
  let watcher = null;
  const watched = new Set();
  const compiling = new Map();

  function registryTargets() {
    if (!registry) return [];
    return (registry.entries || []).filter((entry) => (
      (entry.kind === 'dir' || entry.kind === 'file')
      && typeof entry.path === 'string'
      && path.resolve(entry.path) !== ROOT
    ));
  }

  // pp3：登记的 project 的内容目录（文章画布的帧、正文、组件都在下面）。
  function projectDirs() {
    return projectEntries(registry)
      .filter((entry) => entry && typeof entry.path === 'string')
      .map((entry) => ({ id: entry.id, dir: path.join(path.resolve(entry.path), PROJECT_CONTENT_DIR) }));
  }

  // 登记根的等价拼写表（owner 第四轮条件缺口：登记 /var/...，watcher 可交付 realpath
  // 形态 /private/var/...——macOS 上 /var 是 /private/var 的 symlink）。归属、过滤与
  // 编译全按登记拼写做字符串前缀比较，所以事件入口先把等价拼写归一化回登记拼写，
  // planPageRecompile 的页相对认领才能命中单屏、不退成整页重编。
  // realpath 只在 syncWatcher 时按登记根数量各解析一次（根不存在就只留登记拼写）；
  // 事件路径的改写是纯字符串比较，无逐事件 fs I/O。删除事件的叶子已不存在，
  // 能归一化靠的就是这里登记时记下的根前缀。与 site/src/lib/loaders.js watchAll
  // 的 expand 同一思路，那边只认可两种前缀，这边还要改写回登记拼写。
  let aliasPrefixes = [];

  function rebuildAliasPrefixes() {
    const roots = [...registryTargets().map((entry) => entry.path), ...projectDirs().map((project) => project.dir)];
    const pairs = [];
    for (const root of roots) {
      const raw = path.resolve(root);
      let real;
      try { real = fs.realpathSync(raw); } catch { continue; }
      if (real !== raw && !pairs.some((pair) => pair.real === real)) pairs.push({ real, raw });
    }
    // 最长 real 在前：嵌套登记根的归属方向与 ownerFor 一致。
    pairs.sort((a, b) => b.real.length - a.real.length);
    aliasPrefixes = pairs;
  }

  // 事件路径 → 登记拼写；不落在任何等价前缀下原样返回。
  function normalizeEventPath(file) {
    for (const { real, raw } of aliasPrefixes) {
      if (file === real) return raw;
      if (file.startsWith(real + path.sep)) return raw + file.slice(real.length);
    }
    return file;
  }

  // pp3：工作台左栏的「文章」组读 /api/projects。project 里看得见的那一层（标题、
  // 文章增删与标题、摘要、画布节数、布局错误）变了才发 projects:update；只改正文、
  // 帧内容这类不改列表的变更不发。digest 按 project id 缓存，syncWatcher 时补齐。
  const projectDigests = new Map();

  function projectDigest(id) {
    const project = findProject(registry, id);
    if (!project) return null;
    return JSON.stringify({
      title: project.title,
      errors: project.errors,
      articles: project.articles.map((a) => [a.id, a.title, a.summary || '', a.pageId || '', a.canvasSections]),
    });
  }

  function seedProjectDigests() {
    const ids = new Set(projectDirs().map((project) => project.id));
    for (const id of [...projectDigests.keys()]) if (!ids.has(id)) projectDigests.delete(id);
    for (const id of ids) if (!projectDigests.has(id)) projectDigests.set(id, projectDigest(id));
  }

  /** 变更文件落在某个 project 的内容目录里、且列表那一层变了 → 发 projects:update。 */
  function notifyProjectChange(server, file) {
    const owner = projectDirs().find((project) => file === project.dir || file.startsWith(project.dir + path.sep));
    if (!owner) return;
    const next = projectDigest(owner.id);
    const prev = projectDigests.get(owner.id);
    projectDigests.set(owner.id, next);
    if (prev !== undefined && prev !== next) {
      server.ws.send({ type: 'custom', event: 'projects:update', data: { project: owner.id } });
    }
  }

  function syncWatcher() {
    seedProjectDigests();
    rebuildAliasPrefixes();
    if (!watcher) return;
    const paths = [...registryTargets().map((entry) => entry.path), ...projectDirs().map((project) => project.dir)];
    for (const target of paths) {
      if (watched.has(target)) continue;
      watched.add(target);
      watcher.add(target);
    }
  }

  // 变更文件 → 受影响的文章画布目标：articles/<文章>/ 下的文件归那一篇。
  // project 级 components/ 不参与编译（ADR 0045），别的文件都不归任何一篇。
  function articleTargetsFor(file) {
    for (const project of projectDirs()) {
      if (!file.startsWith(project.dir + path.sep)) continue;
      const parts = path.relative(project.dir, file).split(path.sep);
      if (parts[0] === 'articles' && parts.length >= 3) {
        let pageId;
        try { pageId = articlePageId(project.id, parts[1]); } catch { return []; }
        const target = resolvePageTarget(pageId, { registry, root: ROOT });
        return target ? [target] : [];
      }
      return [];
    }
    return [];
  }

  // 变更文件 → 所属条目（dir 前缀匹配 / file 精确匹配；嵌套条目取最长路径）。
  function ownerFor(file) {
    let best = null;
    for (const entry of registryTargets()) {
      const hit = entry.kind === 'file'
        ? file === entry.path
        : file.startsWith(entry.path + path.sep);
      if (hit && (!best || entry.path.length > best.path.length)) best = entry;
    }
    return best;
  }

  // 重编译该页（dir 条目或模板页；file 条目与无板目录没有编译目标，跳过）。
  // 同一页的并发触发共享一次编译；编译失败的屏进 build.json，serve 时 500 上面板。
  // 增量（审计 B1）：每轮先按「变更文件集合 ∩ build.json 依赖图」筛出要重编的屏，
  // 筛不动（板变、屏增删、认领不到的文件、上次有失败屏……）就整页重编 ——
  // planPageRecompile 的方向是宁可多编。
  // 首个文件事件等一小拍收同伴（F3：agent 批量改帧常见一次改 3–5 个；此前第二拍
  // 文件撞上编译中的 drift 判定被打成整页重编），攒成一批一次编译；编译期间到达
  // 的事件进 pending、收尾后补跑，直到没有新事件为止（R11「不丢最后一拍」）。
  // 通知一次编译只有一条（合入同一次编译的事件不再各发一条）：sidecar .js 进过
  // pending 就 full-reload，否则 preview:update 带上本次重编的屏清单（整页重编过
  // / 编译异常 → 不带，客户端整板重摆）；全是 noop（只改正文）不通知。
  function recompile(server, target, files) {
    if (!target) return Promise.resolve(null);
    const inflight = compiling.get(target.entryId);
    if (inflight) {
      for (const file of files || []) {
        inflight.pending.add(file);
        if (/\.js$/.test(file)) inflight.fullReload = true;
      }
      return inflight.promise;
    }
    const state = { pending: new Set(), promise: null, full: false, screens: new Set(), compiled: false, fullReload: false };
    // 进函数就登记：收集窗内到达的下一拍要看到这次编译还在飞，并进 pending，
    // 而不是 map 还空着、自己再开一次编译。
    compiling.set(target.entryId, state);
    for (const file of files || []) {
      state.pending.add(file);
      if (/\.js$/.test(file)) state.fullReload = true;
    }
    const runOnce = async () => {
      const changed = [...state.pending];
      state.pending.clear();
      try {
        const options = distRoot ? { distRoot } : {};
        const plan = planPageRecompile(target, changed, options);
        // 文章画布：只改了正文、画布没变 → 不编（站点自己有 HMR）。
        if (plan.noop) return { noop: true };
        if (plan.drift) console.log(`[pp2] ${target.entryId}：${plan.drift} 变了但没收到 watch 事件，整页重编`);
        if (!plan.all) options.onlyScreens = plan.screens;
        const result = await compilePage(target, options);
        state.compiled = true;
        if (result.partial) for (const row of result.screens) state.screens.add(row.id);
        else { state.full = true; state.screens.clear(); }
        const failed = result.screens.filter((row) => !row.ok);
        if (result.error || failed.length) {
          console.error(`[pp2] 编译 ${target.entryId} 有失败屏：${result.error || failed.map((row) => `${row.id}（${row.error}）`).join('；')}`);
        }
        return result;
      } catch (error) {
        // 编译异常（不是屏级失败）：客户端整板重摆去拿错误面板（与收编前一致）。
        state.compiled = true;
        state.full = true;
        state.screens.clear();
        console.error(`[pp2] 编译 ${target.entryId} 异常：${(error && error.message) || error}`);
        return null;
      }
    };
    state.promise = (async () => {
      try {
        let result = null;
        // 每一轮都重新开窗，而不只是首轮：编译期间到达的同伴赶上窗口就并进同一次
        // 编译，而不是等编译读完盘才到、被漂移校验打成下一次全编（F3）。窗口为 0 时
        // 这一轮立刻收口，赶不上的落进下一次编译。收到没有新事件为止（R11）。
        let opened = false;
        while (state.pending.size) {
          await new Promise((resolve) => setTimeout(resolve, collectMs));
          if (!state.pending.size) break;
          result = await runOnce();
          // 窗口为 0 时这一轮收完就结束：赶不上的落进下一次编译，不再开下一轮。
          if (!(collectMs > 0)) break;
          // 测试口：首轮收口之后、窗口再开之前。单测把下一拍补在这里——窗口还开时
          // 它算这一批，窗口为 0 时走不到这里。
          if (!opened && onCompileStart) onCompileStart(state.pending);
          opened = true;
        }
        if (!state.compiled) return null;
        const screens = state.full ? null : [...state.screens];
        notify(server, target, { fullReload: state.fullReload, screens });
        return { result, screens };
      } finally {
        if (compiling.get(target.entryId) === state) compiling.delete(target.entryId);
      }
    })();
    return state.promise;
  }

  function recompileArticles(server, targets, file) {
    return Promise.all(targets.map((target) => recompile(server, target, [file]))).then(() => []);
  }

  // Vite 6 只对“改了”的文件调 handleHotUpdate；新建、删除走 watcher 的 add/unlink，
  // 由 configureServer 挂到这里。已登记源码的 add 走与 change 一致的归属/过滤/编译/
  // 通知路径：删除并重建已登记目录时，v2 写入常落在 watcher 重扫窗口里，只交付 add
  // （hmr-watch-probe 实测），不接 add 就没有 hot/重编/通知，dist 停在旧版。
  // - project 内容目录（M4）：列表那一层比对 digest，新建的源文件重编它那一篇。
  // - 模板页 / 带板的 registry dir 条目（同根因入口）：复用 ownerFor（嵌套取最长路径）
  //   与 recompile，和 change 走同一条编译队列与通知。
  // 保持的边界：file 条目与无板 dir 的 add 不通知（change 的「无编译目标 → 通知」分支
  // 不搬过来——新建文件没有待刷新的编译产物）；删除只刷 project 列表 digest，不重编
  // 不通知页（删除的编译语义不在此重设计）。
  function onProjectFileAddOrRemove(server, file, removed) {
    file = normalizeEventPath(file);
    const inProject = projectDirs().some((project) => file.startsWith(project.dir + path.sep));
    if (inProject) notifyProjectChange(server, file);
    if (removed || !isWatchedSource(file, { distRoot: distRoot || defaultDistRoot() })) return Promise.resolve([]);
    if (inProject) {
      const targets = articleTargetsFor(file);
      return targets.length ? recompileArticles(server, targets, file) : Promise.resolve([]);
    }
    const preview = file.replace(/\\/g, '/').match(PREVIEWS_FILE);
    if (preview) {
      const target = templateTarget(preview[1]);
      return target ? recompile(server, target, [file]).then(() => []) : Promise.resolve([]);
    }
    const owner = ownerFor(file);
    const target = owner && owner.kind === 'dir' ? resolvePageTarget(owner.id, { registry, root: ROOT }) : null;
    return target ? recompile(server, target, [file]).then(() => []) : Promise.resolve([]);
  }

  function templateTarget(pageId) {
    return resolvePageTarget(pageId, { registry: null, root: templateRoot });
  }

  function notify(server, target, { fullReload = false, screens = null } = {}) {
    const data = { id: target.entryId };
    if (Array.isArray(screens)) data.screens = screens;
    broadcastPreviewUpdate(data);
    if (fullReload) {
      server.ws.send({ type: 'full-reload' });
    } else {
      // F2/K3：增量编译只重编了几屏 → 带上屏清单，工作台按屏重摆；
      // 没带（整页重编 / 板变 / 无编译目标的通知）→ 工作台整板重摆。
      server.ws.send({ type: 'custom', event: 'preview:update', data });
    }
  }

  return {
    name: 'preview-hmr',
    async configureServer(server) {
      watcher = server.watcher;
      syncWatcher();
      if (watcher && typeof watcher.on === 'function') {
        // 返回 Promise 只是让测试能 await 到编译收尾；chokidar 忽略返回值。
        watcher.on('add', (file) => onProjectFileAddOrRemove(server, file, false));
        watcher.on('unlink', (file) => onProjectFileAddOrRemove(server, file, true));
      }
      // 启动编译（probe）：dist 已是最新（同一版编译器、源码与板没动过）的页整页
      // 跳过，只编改动过的页 —— 重启不再为没变的东西付全量编译。总耗时 + 每页
      // 耗时照旧打进日志。
      const started = performance.now();
      const results = await buildAllPages({ registry, root: ROOT, templateOnly: templateOnly(), skipFresh: true, ...(distRoot ? { distRoot } : {}) });
      const total = Math.round(performance.now() - started);
      const skipped = results.filter((result) => result.skipped).length;
      console.log(`[pp2] 启动编译：${results.length} 页（fresh 跳过 ${skipped}），共 ${total}ms`);
      for (const result of results) {
        if (result.skipped) continue;
        const failed = result.screens.filter((row) => !row.ok).length;
        console.log(`[pp2]   ${result.entryId} ${result.ms}ms${result.error ? ` 板错误：${result.error}` : ''}${failed ? ` ${failed} 屏失败` : ''}`);
      }
    },
    syncWatcher,
    /** 测试口：同 watcher 的 add / unlink。 */
    onProjectFileAddOrRemove,
    handleHotUpdate({ file, server }) {
      file = normalizeEventPath(file);
      const rel = file.replace(/\\/g, '/');
      if (/\/previews\/_index\.json$/.test(rel)) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
      // 页源码之外的东西（dist、build.json、node_modules、非 deps 类型）不进编译分支，
      // 编译写盘不会再触发编译。
      const isSource = isWatchedSource(file, { distRoot: distRoot || defaultDistRoot() });
      const preview = isSource && rel.match(PREVIEWS_FILE);
      if (preview) {
        const target = templateTarget(preview[1]);
        if (!target) return [];
        return recompile(server, target, [file]).then(() => []);
      }
      // kit JSX 印章变更（review 1-5 的接力）：comp 屏对 pinpoint/kit 的引用在
      // 编译期定型，印章一改必须全量重编 → 对每页发 preview:update。分支收窄到
      // kit 目录：名字里带 jsx 的仓外条目交给下面的 registry 分支正确归属。
      if (/\/kits\/ios\/jsx\//.test(rel)) {
        return buildAllPages({ registry, root: ROOT, templateOnly: templateOnly(), ...(distRoot ? { distRoot } : {}) }).then((results) => {
          for (const result of results) {
            notify(server, { entryId: result.entryId });
          }
          return [];
        });
      }
      notifyProjectChange(server, file);
      // 文章画布（pp3）：帧、组件、正文、article.css / .js 变更 → 重编 → 该画布页重摆。
      const articleTargets = isSource ? articleTargetsFor(file) : [];
      if (articleTargets.length) return recompileArticles(server, articleTargets, file);
      // registry dir/file 条目（仓外）：板、屏、sidecar 变更 → 重编译 → 该条目页重摆
      if (isSource) {
        const owner = ownerFor(file);
        if (!owner) return undefined;
        const target = owner.kind === 'dir' ? resolvePageTarget(owner.id, { registry, root: ROOT }) : null;
        if (!target) {
          // file 条目 / 无板目录没有编译目标；.js 变更一样吃 ES module 缓存，full-reload。
          notify(server, { entryId: owner.id }, { fullReload: /\.js$/.test(rel) });
          return [];
        }
        return recompile(server, target, [file]).then(() => []);
      }
      return undefined;
    },
  };
}
