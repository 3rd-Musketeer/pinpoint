/**
 * 离线导出页运行时（src/client/share-runtime.js）的打包器。
 *
 * share-runtime 从 2026-10-19 起与工作台共用 src/shared/canvas-gesture.js 的手势
 * 数学（ES import），而导出页要的是单个自包含经典脚本（file:// 直接打开、零附加
 * 请求）——所以导出时用 esbuild 打成 IIFE 再内联，与 /annotate.js 的 annotate-bundle
 * 同一做法。不 minify：导出文件要能被人读，体积不是导出面的约束。
 *
 * 产物守卫与旧 readInlineScript 相同：正文里不许出现 </script>（内联进
 * <script> 的安全前提），违者抛 OfflinePageExportError 让导出显式失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

import { OfflinePageExportError } from './offline-page-export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', '..');
const ENTRY = path.join(SRC, 'client', 'share-runtime.js');

/** 打包 share-runtime 及其 import 图（src/shared/…）成一个经典脚本。 */
export function buildShareRuntimeBundle() {
  const result = esbuild.buildSync({
    entryPoints: [ENTRY],
    // absWorkingDir 钉住源码路径基准，不随进程 cwd 漂移。
    absWorkingDir: SRC,
    bundle: true,
    format: 'iife',
    minify: false,
    write: false,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
  });
  const js = result.outputFiles[0].text;
  if (/<\/script/i.test(js)) {
    throw new OfflinePageExportError('unsafe_script', 'src/client/share-runtime.js bundle must not contain </script>');
  }
  return js;
}
