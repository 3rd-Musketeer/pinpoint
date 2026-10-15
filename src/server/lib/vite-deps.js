import fs from 'node:fs';
import path from 'node:path';

// pinpoint 服务（vite.config.js）的依赖预构建配置：缓存放哪、预构建哪些依赖。

/**
 * 这个 vite 实例的缓存目录（依赖预构建 deps/ 落在这里）。
 *
 * 不用 vite 缺省的 `node_modules/.vite`：worktree 和 `just preview` 的 node_modules 是软链到主 clone 的，
 * 缺省值让所有实例（常驻服务、各轮 e2e、各 worktree 的预览）共用一份 deps/。root 或依赖集不同的实例
 * 启动时会重建并整体覆盖它，另一个已启动的实例随后读到别人的 chunk，页面里出现多份 React
 * （Invalid hook call，2026-10-15 查清）。
 *
 * 缺省：仓库根真实路径下的 `.tmp/vite`（每个 checkout 一份，不经软链）。
 * PINPOINT_VITE_CACHE 覆盖它：e2e 每组设到自己的固件目录，`ppnt dev --sandbox` 设到自己的数据目录。
 */
export function viteCacheDir({ root, env = process.env } = {}) {
  if (env.PINPOINT_VITE_CACHE) return path.resolve(env.PINPOINT_VITE_CACHE);
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* root 不存在时按原样 */ }
  return path.join(real, '.tmp', 'vite');
}

// 工作台在浏览器里用到的全部第三方依赖（index.html 引的 src/workbench、src/client、src/shared 里的裸 import）。
// 启动时一次预构建齐，不等运行时发现新依赖再重建 deps/、换 chunk 名。加新依赖时一并登记，
// vite-deps.test.js 守它和源码对得上。
export const WORKBENCH_DEPS = [
  '@radix-ui/react-context-menu',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-scroll-area',
  '@radix-ui/react-slot',
  '@radix-ui/react-toggle-group',
  '@tanstack/react-query',
  'class-variance-authority',
  'clsx',
  'lucide',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'tailwind-merge',
  'zustand',
];
