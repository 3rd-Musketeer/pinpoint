import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 与服务配置分开：构建工作台不创建 registry、不拉起文章站点，也不编预览帧。
export async function buildWorkbench({ root = ROOT, outDir = process.env.PINPOINT_WORKBENCH_DIST || path.join(root, '.tmp/workbench-dist') } = {}) {
  await fs.mkdir(outDir, { recursive: true });
  const staging = await fs.mkdtemp(path.join(outDir, '.building-'));
  try {
    await build({
      configFile: false, root, base: '/workbench/', publicDir: false,
      plugins: [react(), tailwindcss(), {
        name: 'workbench-shell',
        enforce: 'post',
        transformIndexHtml: {
          order: 'pre',
          // kit 由服务按原 URL 提供，ios-kit.js 的标注注入地址仍由 content-routes 替换。
          handler: html => html
            .replace('<link rel="stylesheet" href="/kits/ios/ios-kit.css">', '<!-- wb-kit-css -->')
            .replace('<script src="/kits/ios/ios-kit.js"></script>', '<!-- wb-kit-js -->'),
        },
        generateBundle(_options, bundle) {
          const html = bundle['index.html'];
          html.source = String(html.source)
            .replace('<!-- wb-kit-css -->', '<link rel="stylesheet" href="/kits/ios/ios-kit.css">')
            .replace('<!-- wb-kit-js -->', '<script src="/kits/ios/ios-kit.js"></script>')
            .replace(/<script type="module"([^>]*)>/g, '<script type="module"$1 onerror="window.__wbBootFail(this.src)">');
        },
      }],
      build: {
        outDir: staging, emptyOutDir: false,
        rollupOptions: { external: ['/@vite/client'] },
      },
    });
    // 先落 hash 资源，最后原子替换 HTML。保留旧 hash，已打开的文档仍可继续取资源。
    await fs.cp(path.join(staging, 'assets'), path.join(outDir, 'assets'), { recursive: true });
    await fs.rename(path.join(staging, 'index.html'), path.join(outDir, 'index.html'));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWorkbench();
