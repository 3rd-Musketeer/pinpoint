// preview-hmr：previews/ 与 registry dir/file 条目的变更 → workbench 重摆。
// registry 条目（2026-08-17e 实例搬迁地基）：vite 默认只 watch 仓库根，仓外
// 条目目录经 configureServer 的 watcher.add 补挂；条目增删随 registry:reload
// 同步（vite.config 里包装 registryStore.reload 调本插件的 syncWatcher）。
// 仓库自身（id 多为 'pinpoint' 的默认条目）不算——previews//components 走下面
// 的既有分支，workbench 源码走 vite 默认 HMR，都不许被 preview:update 吞掉。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCHED_EXT = /(?:board\.json|[^/]+\.(?:html|js))$/;

export default function previewHmr(options = {}) {
  const registry = options.registry || null;
  let watcher = null;
  const watched = new Set();

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

  return {
    name: 'preview-hmr',
    configureServer(server) {
      watcher = server.watcher;
      syncWatcher();
    },
    syncWatcher,
    handleHotUpdate({ file, server }) {
      const rel = file.replace(/\\/g, '/');
      if (/\/previews\/_index(?:\.local)?\.json$/.test(rel)) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
      const preview = rel.match(/\/previews\/([^/]+)\/(?:board\.json|[^/]+\.(?:html|js))$/);
      if (preview) {
        server.ws.send({ type: 'custom', event: 'preview:update', data: { id: preview[1] } });
        return [];
      }
      // Component source or meta — refresh Component Library + any open flow that may include it
      if (/\/components\//.test(rel) && (/\.html$/.test(rel) || /meta\.json$/.test(rel) || /_index\.json$/.test(rel))) {
        server.ws.send({ type: 'custom', event: 'preview:update', data: { id: 'components', alsoActive: true } });
        return [];
      }
      // registry dir/file 条目（仓外）：板、屏、sidecar 变更 → 该条目页重摆
      if (WATCHED_EXT.test(rel)) {
        const owner = ownerFor(file);
        if (owner) {
          server.ws.send({ type: 'custom', event: 'preview:update', data: { id: owner.id } });
          return [];
        }
      }
    },
  };
}
