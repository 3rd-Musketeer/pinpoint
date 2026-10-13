import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { fileURLToPath } from 'node:url';
import { remarkPinpoint } from './src/lib/remark-pinpoint.js';
import { loadProjects } from './src/lib/projects-source.js';

// 内容来自 registry 里登记的 project（仓外绝对路径），站点只放代码（common.md §5）。
// 开发服务器由 pinpoint 服务按需拉起并代理（包 C）；PINPOINT_SITE_PORT 覆盖端口，不设 base。
// PINPOINT_SITE_OUT / PINPOINT_SITE_CACHE 让测试把产物与缓存放进临时目录。
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const { projects } = await loadProjects();
const viteBase = process.env.PINPOINT_SITE_VITE_BASE || undefined;

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
  root: fileURLToPath(new URL('.', import.meta.url)),
  outDir: process.env.PINPOINT_SITE_OUT || './dist',
  cacheDir: process.env.PINPOINT_SITE_CACHE || './.astro-cache',
  build: { format: 'directory' },
  trailingSlash: 'ignore',
  server: { host: '127.0.0.1', port: Number(process.env.PINPOINT_SITE_PORT) || 4530 },
  devToolbar: { enabled: false },
  integrations: [mdx()],
  markdown: { remarkPlugins: [remarkPinpoint] },
  // project 目录在站点之外；启动时登记的 project 根都放进 fs.allow（之后新登记的要重启 dev）。
  // pinpoint 服务自己是 vite，占着 /@vite/ /@fs/ /@id/ /node_modules/ 和根路径的 HMR socket；
  // 代理时它设 PINPOINT_SITE_VITE_BASE=/_astro/，把 Astro dev 的内部路径挪到 /_astro/ 下（站点 base 仍是 /）。
  vite: {
    base: viteBase,
    plugins: [pageUrlsOutsideViteBase()],
    server: { fs: { allow: [repoRoot, ...projects.map((p) => p.root)] } },
  },
});
