// preview-hmr：previews/ 与 registry dir/file 条目的变更 → workbench 重摆。
// registry 条目（2026-08-17e 实例搬迁地基）：vite 默认只 watch 仓库根，仓外
// 条目目录经 configureServer 的 watcher.add 补挂；条目增删随 registry:reload
// 同步（vite.config 里包装 registryStore.reload 调本插件的 syncWatcher）。
// 仓库自身（id 多为 'pinpoint' 的默认条目）不算——previews/ 走下面的既有分支，
// workbench 源码走 vite 默认 HMR，都不许被 preview:update 吞掉。
//
// pp2（2026-09-22 切片 1）：页是「源码 → 编译 → dist」——
// - 服务启动时对所有 dir 条目与模板页跑一遍全量编译，日志打总耗时与每页耗时；
// - 页目录里 .jsx / .html / board.json / .css 变更 → 重编译该页 → 照旧发
//   preview:update；.js（sidecar）变更 → 重编译该页 → 发 full-reload
//   （ES module 缓存，见 BACKLOG「sidecar 模块改动后画板自动刷新」）。
//   帧 import 的 .json / .ts / .tsx / .mjs / .cjs 同样盯（它们会进 build.json
//   的 deps，不盯就改了零事件），类型清单与排除项见 recompile-plan 的 isWatchedSource。
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { buildAllPages, compilePage, defaultDistRoot, resolvePageTarget } from './lib/page-compiler.js';
import { isWatchedSource, planPageRecompile } from './lib/recompile-plan.js';
import { templateOnly } from './template-only.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// previews 分支（M2）：模板页的 components/ 子目录（pp2 的核心输入）与任意
// 深层的帧/资源都要接住，正则此前只认页目录顶层单段文件名，子目录变更静默
// 不重编。这里只取页 id，文件类型由 isWatchedSource 判；嵌套的 board.json 不是
// 板，由 recompile-plan 认领不到 → 全编。
const PREVIEWS_FILE = /\/previews\/([^/]+)\/(?:[^/]+\/)*[^/]+$/;

export default function previewHmr(options = {}) {
  const registry = options.registry || null;
  const distRoot = options.distRoot || null;
  const templateRoot = options.templateRoot || ROOT;
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

  function syncWatcher() {
    if (!watcher) return;
    for (const entry of registryTargets()) {
      if (watched.has(entry.path)) continue;
      watched.add(entry.path);
      watcher.add(entry.path);
    }
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
  // 编译期间到达的新变更拿到的是变更前结果 —— job 收尾后补跑一轮，直到收尾
  // 时刻没有新事件为止（review R11；CLI startPageWatch 有 debounce+串行链，
  // 服务端这里补上等价的「不丢最后一拍」）。补跑合并期间的全部变更文件
  // （state.pending 是集合，不是最后一个事件）。
  function recompile(target, files) {
    if (!target) return Promise.resolve(null);
    const inflight = compiling.get(target.entryId);
    if (inflight) {
      for (const file of files || []) inflight.pending.add(file);
      inflight.rerun = true;
      return inflight.promise;
    }
    const state = { rerun: false, pending: new Set(files || []), promise: null };
    const runOnce = async () => {
      const changed = [...state.pending];
      state.pending.clear();
      try {
        const options = distRoot ? { distRoot } : {};
        const plan = planPageRecompile(target, changed, options);
        if (plan.drift) console.log(`[pp2] ${target.entryId}：${plan.drift} 变了但没收到 watch 事件，整页重编`);
        if (!plan.all) options.onlyScreens = plan.screens;
        const result = await compilePage(target, options);
        const failed = result.screens.filter((row) => !row.ok);
        if (result.error || failed.length) {
          console.error(`[pp2] 编译 ${target.entryId} 有失败屏：${result.error || failed.map((row) => `${row.id}（${row.error}）`).join('；')}`);
        }
        return result;
      } catch (error) {
        console.error(`[pp2] 编译 ${target.entryId} 异常：${(error && error.message) || error}`);
        return null;
      }
    };
    state.promise = (async () => {
      try {
        let result = await runOnce();
        while (state.rerun) {
          state.rerun = false;
          result = await runOnce();
        }
        return result;
      } finally {
        if (compiling.get(target.entryId) === state) compiling.delete(target.entryId);
      }
    })();
    compiling.set(target.entryId, state);
    return state.promise;
  }

  function templateTarget(pageId) {
    return resolvePageTarget(pageId, { registry: null, root: templateRoot });
  }

  function notify(server, target, file) {
    if (/\.js$/.test(file)) {
      server.ws.send({ type: 'full-reload' });
    } else {
      server.ws.send({ type: 'custom', event: 'preview:update', data: { id: target.entryId } });
    }
  }

  return {
    name: 'preview-hmr',
    async configureServer(server) {
      watcher = server.watcher;
      syncWatcher();
      // 启动全量编译（probe）：总耗时 + 每页耗时都打进日志。
      const started = performance.now();
      const results = await buildAllPages({ registry, root: ROOT, templateOnly: templateOnly(), ...(distRoot ? { distRoot } : {}) });
      const total = Math.round(performance.now() - started);
      console.log(`[pp2] 启动全量编译：${results.length} 页，共 ${total}ms`);
      for (const result of results) {
        const failed = result.screens.filter((row) => !row.ok).length;
        console.log(`[pp2]   ${result.entryId} ${result.ms}ms${result.error ? ` 板错误：${result.error}` : ''}${failed ? ` ${failed} 屏失败` : ''}`);
      }
    },
    syncWatcher,
    handleHotUpdate({ file, server }) {
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
        return recompile(target, [file]).then(() => {
          notify(server, target, rel);
          return [];
        });
      }
      // kit JSX 印章变更（review 1-5 的接力）：comp 屏对 pinpoint/kit 的引用在
      // 编译期定型，印章一改必须全量重编 → 对每页发 preview:update。分支收窄到
      // kit 目录：名字里带 jsx 的仓外条目交给下面的 registry 分支正确归属。
      if (/\/kits\/ios\/jsx\//.test(rel)) {
        return buildAllPages({ registry, root: ROOT, templateOnly: templateOnly(), ...(distRoot ? { distRoot } : {}) }).then((results) => {
          for (const result of results) {
            server.ws.send({ type: 'custom', event: 'preview:update', data: { id: result.entryId } });
          }
          return [];
        });
      }
      // registry dir/file 条目（仓外）：板、屏、sidecar 变更 → 重编译 → 该条目页重摆
      if (isSource) {
        const owner = ownerFor(file);
        if (!owner) return undefined;
        const target = owner.kind === 'dir' ? resolvePageTarget(owner.id, { registry, root: ROOT }) : null;
        if (!target) {
          // file 条目 / 无板目录没有编译目标；.js 变更一样吃 ES module 缓存，full-reload。
          if (/\.js$/.test(rel)) server.ws.send({ type: 'full-reload' });
          else server.ws.send({ type: 'custom', event: 'preview:update', data: { id: owner.id } });
          return [];
        }
        return recompile(target, [file]).then(() => {
          notify(server, target, rel);
          return [];
        });
      }
      return undefined;
    },
  };
}
