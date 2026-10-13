import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remarkPinpoint } from './src/lib/remark-pinpoint.js';
import { loadProjects } from './src/lib/projects-source.js';

// 内容来自 registry 里登记的 project（仓外绝对路径），站点只放代码（common.md §5）。
// 开发服务器由 pinpoint 服务按需拉起并代理（包 C）；PINPOINT_SITE_PORT 覆盖端口，不设 base。
// PINPOINT_SITE_OUT / PINPOINT_SITE_CACHE 让测试把产物与缓存放进临时目录。
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const siteRoot = fileURLToPath(new URL('.', import.meta.url));
const { projects } = await loadProjects();
const viteBase = process.env.PINPOINT_SITE_VITE_BASE || undefined;

// 开发服务器经 /@fs/（代理后是 /_astro/@fs/）能读到的目录：站点自己、仓库的 node_modules
// （Astro 与 vite 的客户端运行时），和每个 project 的 docs/pinpoint/（p.dir，文章引用的资源）。
// 不放仓库根和 project 根：根下的源码、README、配置不归站点服务。服务端渲染时 import 的
// 仓库代码（src/server/lib、src/workbench/lib）走模块加载，不受 fs.allow 限制。
// 启动时定好，之后新登记的 project 要重启 dev 才能读到它的资源。
function devFsAllow() {
  return [siteRoot, path.join(repoRoot, 'node_modules'), ...projects.map((p) => p.dir)];
}

// Vite 带 base 时只认 base 下的请求，页面 URL（/<project>/…）会被它拒掉。把 base 外的请求补上前缀交回去，
// 页面照旧在 /<project>/… 打开，只有 Astro / Vite 的内部资源走 /_astro/…。
const pageUrlsOutsideViteBase = () => ({
  name: 'pinpoint-page-urls-outside-vite-base',
  configureServer(server) {
    if (!viteBase) return;
    const prefix = viteBase.replace(/\/$/, '');
    server.middlewares.use((req, _res, next) => {
      if (!req.url) return next();
      // Astro dev 拼出的 `/_astro//@vite/client` 这类双斜杠也收回来。
      if (req.url.startsWith(`${prefix}//`)) req.url = prefix + req.url.slice(prefix.length + 1);
      else if (!req.url.startsWith(`${prefix}/`) && req.url !== prefix) req.url = prefix + req.url;
      next();
    });
  },
});

export default defineConfig({
  root: siteRoot,
  outDir: process.env.PINPOINT_SITE_OUT || './dist',
  cacheDir: process.env.PINPOINT_SITE_CACHE || './.astro-cache',
  build: { format: 'directory' },
  trailingSlash: 'ignore',
  server: { host: '127.0.0.1', port: Number(process.env.PINPOINT_SITE_PORT) || 4530 },
  devToolbar: { enabled: false },
  integrations: [mdx()],
  markdown: { remarkPlugins: [remarkPinpoint] },
  // pinpoint 服务自己是 vite，占着 /@vite/ /@fs/ /@id/ /node_modules/ 和根路径的 HMR socket；
  // 代理时它设 PINPOINT_SITE_VITE_BASE=/_astro/，把 Astro dev 的内部路径挪到 /_astro/ 下（站点 base 仍是 /）。
  vite: {
    base: viteBase,
    plugins: [pageUrlsOutsideViteBase()],
    server: { fs: { allow: devFsAllow() } },
  },
});
