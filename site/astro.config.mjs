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
  vite: { server: { fs: { allow: [repoRoot, ...projects.map((p) => p.root)] } } },
});
