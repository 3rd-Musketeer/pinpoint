// preview-hmr：previews/ 与 registry dir/file 条目的变更 → workbench 重摆。
// registry 条目（2026-08-17e 实例搬迁地基）：vite 默认只 watch 仓库根，仓外
// 条目目录经 configureServer 的 watcher.add 补挂；条目增删随 registry:reload
// 同步（vite.config 里包装 registryStore.reload 调本插件的 syncWatcher）。
// 仓库自身（id 多为 'pinpoint' 的默认条目）不算——previews//components 走下面
// 的既有分支，workbench 源码走 vite 默认 HMR，都不许被 preview:update 吞掉。
//
// pp2（2026-09-22 切片 1）：页是「源码 → 编译 → dist」——
// - 服务启动时对所有 dir 条目与模板页跑一遍全量编译，日志打总耗时与每页耗时；
// - 页目录里 .jsx / .html / board.json / .css 变更 → 重编译该页 → 照旧发
//   preview:update；.js（sidecar）变更 → 重编译该页 → 发 full-reload
//   （ES module 缓存，见 BACKLOG「sidecar 模块改动后画板自动刷新」）。
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { buildAllPages, compilePage, resolvePageTarget } from './lib/page-compiler.js';
import { templateOnly } from './template-only.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCHED_EXT = /(?:board\.json|[^/]+\.(?:html|js|jsx|css))$/;

export default function previewHmr(options = {}) {
  const registry = options.registry || null;
  const distRoot = options.distRoot || null;
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
  function recompile(target) {
    if (!target) return Promise.resolve(null);
    if (compiling.has(target.entryId)) return compiling.get(target.entryId);
    const job = compilePage(target, distRoot ? { distRoot } : {})
      .then((result) => {
        const failed = result.screens.filter((row) => !row.ok);
        if (result.error || failed.length) {
          console.error(`[pp2] 编译 ${target.entryId} 有失败屏：${result.error || failed.map((row) => `${row.id}（${row.error}）`).join('；')}`);
        }
        return result;
      })
      .catch((error) => {
        console.error(`[pp2] 编译 ${target.entryId} 异常：${(error && error.message) || error}`);
        return null;
      })
      .finally(() => {
        if (compiling.get(target.entryId) === job) compiling.delete(target.entryId);
      });
    compiling.set(target.entryId, job);
    return job;
  }

  function templateTarget(pageId) {
    return resolvePageTarget(pageId, { registry: null, root: ROOT });
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
      if (/\/previews\/_index(?:\.local)?\.json$/.test(rel)) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
      const preview = rel.match(/\/previews\/([^/]+)\/(?:board\.json|[^/]+\.(?:html|js|jsx|css))$/);
      if (preview) {
        const target = templateTarget(preview[1]);
        if (!target) return [];
        return recompile(target).then(() => {
          notify(server, target, rel);
          return [];
        });
      }
      // kit 组件源 / meta 变更（2026-09-22 review 1-5）：存量 .html 帧的 include 是
      // 编译期展开的，组件一改必须全量重编（144ms 量级，不算依赖）→ 对每页发
      // preview:update；Component Library 自己的板照旧更新。分支收窄到 kit 目录：
      // 名字里带 components 的仓外条目交给下面的 registry 分支正确归属。
      if (/\/kits\/ios\/components\//.test(rel) && (/\.html$/.test(rel) || /meta\.json$/.test(rel) || /_index\.json$/.test(rel))) {
        return buildAllPages({ registry, root: ROOT, templateOnly: templateOnly(), ...(distRoot ? { distRoot } : {}) }).then((results) => {
          for (const result of results) {
            server.ws.send({ type: 'custom', event: 'preview:update', data: { id: result.entryId } });
          }
          server.ws.send({ type: 'custom', event: 'preview:update', data: { id: 'components', alsoActive: true } });
          return [];
        });
      }
      // registry dir/file 条目（仓外）：板、屏、sidecar 变更 → 重编译 → 该条目页重摆
      if (WATCHED_EXT.test(rel)) {
        const owner = ownerFor(file);
        if (!owner) return undefined;
        const target = owner.kind === 'dir' ? resolvePageTarget(owner.id, { registry, root: ROOT }) : null;
        if (!target) {
          // file 条目 / 无板目录没有编译目标；.js 变更一样吃 ES module 缓存，full-reload。
          if (/\.js$/.test(rel)) server.ws.send({ type: 'full-reload' });
          else server.ws.send({ type: 'custom', event: 'preview:update', data: { id: owner.id } });
          return [];
        }
        return recompile(target).then(() => {
          notify(server, target, rel);
          return [];
        });
      }
      return undefined;
    },
  };
}
