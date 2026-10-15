import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { remarkPinpoint } from '../src/shared/remark-pinpoint.js';
import { rehypeTableScroll } from './src/lib/rehype-table-scroll.js';
import { loadProjects, projectIdForFile } from './src/lib/projects-source.js';

// 内容来自 registry 里登记的 project（仓外绝对路径），站点只放代码（common.md §5）。
// 开发服务器由 pinpoint 服务按需拉起并代理（包 C）；PINPOINT_SITE_PORT 覆盖端口，不设 base。
// PINPOINT_SITE_OUT / PINPOINT_SITE_CACHE 让测试把产物与缓存放进临时目录。
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const siteRoot = fileURLToPath(new URL('.', import.meta.url));
const { projects } = await loadProjects();
const viteBase = process.env.PINPOINT_SITE_VITE_BASE || undefined;
// 端口也是下面 root 的名字：手动 `astro dev --port N` 没设 PINPOINT_SITE_PORT 时从命令行取。
const argPort = process.argv.includes('--port') ? Number(process.argv[process.argv.indexOf('--port') + 1]) : 0;
const port = Number(process.env.PINPOINT_SITE_PORT) || argPort || 4530;

// 每个站点进程一个 Astro root：`.astro/`（dev 的内容库 data-store.json、settings.json、生成的类型）
// 固定落在 root 下，Astro 没有单独的配置项。root 留在 site/ 时，同一个 checkout 起的两个站点共用一份
// 内容库，一个站点会读到另一个 registry 的内容、文章 404（2026-10-13 fresh-reader 实测）。
// root 按端口分（同一个端口同时只有一个站点进程），build 单独一份；放在 site/ 下，裸 import
// （astro/…）才能往上找到仓库的 node_modules。代码仍从 site/src 读（srcDir）。
// PINPOINT_SITE_CACHE 只改 vite / Astro 的缓存目录，缺省也在这个 root 里。
const instanceRoot = path.join(siteRoot, '.astro-cache', process.argv.includes('build') ? 'build' : String(port));

// 开发服务器经 /@fs/（代理后是 /_astro/@fs/）能读到的目录：站点自己、仓库的 node_modules
// （Astro 与 vite 的客户端运行时），和每个 project 的 docs/pinpoint/（p.dir，文章引用的资源）。
// 不放仓库根和 project 根：根下的源码、README、配置不归站点服务。服务端渲染时 import 的
// 仓库代码（src/server/lib、src/workbench/lib）走模块加载，不受 fs.allow 限制。
// 启动时定好，之后新登记的 project 要重启 dev 才能读到它的资源。
function devFsAllow() {
  return [siteRoot, path.join(repoRoot, 'node_modules'), path.join(repoRoot, 'src/shared/ledger-frames.js'), ...projects.map((p) => p.dir)];
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
  root: instanceRoot,
  srcDir: path.join(siteRoot, 'src'),
  publicDir: path.join(siteRoot, 'public'),
  outDir: process.env.PINPOINT_SITE_OUT ? path.resolve(process.env.PINPOINT_SITE_OUT) : path.join(siteRoot, 'dist'),
  cacheDir: process.env.PINPOINT_SITE_CACHE ? path.resolve(process.env.PINPOINT_SITE_CACHE) : instanceRoot,
  build: { format: 'directory' },
  trailingSlash: 'ignore',
  server: { host: '127.0.0.1', port },
  devToolbar: { enabled: false },
  integrations: [mdx()],
  markdown: { remarkPlugins: [[remarkPinpoint, { projectIdFor: projectIdForFile }]], rehypePlugins: [rehypeTableScroll] },
  // pinpoint 服务自己是 vite，占着 /@vite/ /@fs/ /@id/ /node_modules/ 和根路径的 HMR socket；
  // 代理时它设 PINPOINT_SITE_VITE_BASE=/_astro/，把 Astro dev 的内部路径挪到 /_astro/ 下（站点 base 仍是 /）。
  vite: {
    base: viteBase,
    plugins: [pageUrlsOutsideViteBase()],
    server: { fs: { allow: devFsAllow() } },
  },
});
