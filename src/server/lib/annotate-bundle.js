/**
 * /annotate.js 客户端的构建器（性能审计 B3）。
 *
 * src/client/annotate.js 顶部 import 的共享库（src/shared、src/client/lib）以
 * 真正的 ES 模块参与打包，esbuild 产出一个自包含 IIFE——注入到别人页面时仍是
 * 单个文件、运行时零附加请求；共享 CSS 经 text loader 成为 annotate.js <style>
 * 块里的同名常量。取代旧的「正则删 import/export 拼进 'use strict' 之后」拼接
 * （annotate-api readAnnotateJs），顺带拿到 minify 与构建期预压缩。
 *
 * 产物按内容算短哈希：pinpoint 生成的注入点引用 /annotate.<hash>.js
 * （immutable 永久缓存）；老地址 /annotate.js 继续发同一份产物（内容页里的
 * 手写标签、浏览器扩展与跨域注入还在用），带 ETag + no-cache。构建失败的错误
 * 不吞：HTTP 面显式 500 带原因，绝不静默发旧版。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', '..');

/** 参与失效判定的全部源文件（annotate.js 的 import 由 esbuild 自己追）。 */
export function annotateBundleSources() {
  return [
    path.join(SRC, 'client', 'annotate.js'),
    path.join(SRC, 'shared', 'ann-list.css'),
  ];
}

// 哈希地址的形状与 hashJs 的截断长度绑死（SSOT 在这里）：/annotate.<hash>.js。
const HASH_RE = '[0-9a-f]{10}';
export const ANNOTATE_BUNDLE_URL_RE = new RegExp(`^\\/annotate\\.(${HASH_RE})\\.js$`);

function esbuildOptions() {
  return {
    entryPoints: [path.join(SRC, 'client', 'annotate.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    // 注入到别人页面：必须恰好一个输出文件，运行时不能再去拉 chunk。
    // charset utf8：client 文案里中文很多，默认 ascii 转义会把体积打回去。
    loader: { '.css': 'text' },
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
  };
}

function hashJs(js) {
  // 10 个 hex 位（40bit）对这个进程内保留最近几版的产物足够防撞。
  return crypto.createHash('sha256').update(js).digest('hex').slice(0, 10);
}

function compress(js) {
  const buf = Buffer.from(js, 'utf8');
  return {
    gzip: zlib.gzipSync(buf),
    br: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
  };
}

/**
 * 构建一次 annotate 客户端。返回 { js, hash, gzip, br }：js 是产物文本，
 * gzip / br 是构建期预压缩好的 buffer，serve 层按 Accept-Encoding 挑。
 * minify:false 仅供测试对未压缩中间产物断言。
 */
export async function buildAnnotateBundle({ minify = true } = {}) {
  const result = await esbuild.build({ ...esbuildOptions(), minify });
  const js = result.outputFiles[0].text;
  return { js, hash: hashJs(js), ...compress(js) };
}

function buildAnnotateBundleSync() {
  const result = esbuild.buildSync(esbuildOptions());
  const js = result.outputFiles[0].text;
  return { js, hash: hashJs(js), ...compress(js) };
}

export class AnnotateBundleError extends Error {
  constructor(message) {
    super(`annotate client build failed: ${message}`);
    this.name = 'AnnotateBundleError';
  }
}

function describeBuildError(error) {
  const lines = (error && error.errors ? error.errors : []).map((e) => {
    const loc = e.location ? `${e.location.file}:${e.location.line}` : '';
    return loc ? `${loc} ${e.text}` : e.text;
  });
  return lines.length ? lines.join('; ') : (error && error.message) || String(error);
}

// 进程内单例。构建在服务启动时做一次（annotate-api configureServer），之后靠
// 源文件 max-mtime 失效：下次有人要产物时同步重编（与旧 readAnnotateJs 同思路）。
// artifacts 留最近几版：HTML 被浏览器缓存、源码中途变过时，旧哈希地址仍可取到
// 自己那份，不让缓存的页面拿到 404。
const ARTIFACT_KEEP = 5;
const artifacts = new Map(); // hash -> artifact（按构建顺序，最新的在最后）
let current = null;          // 最新一次成功构建
let currentMtime = null;     // 构建时的源文件 max-mtime
let building = null;         // 在途的 async 构建（并发调用共享同一份 promise）

function maxSourceMtime() {
  return Math.max(...annotateBundleSources().map((p) => fs.statSync(p).mtimeMs));
}

function remember(artifact) {
  artifacts.set(artifact.hash, artifact);
  while (artifacts.size > ARTIFACT_KEEP) {
    artifacts.delete(artifacts.keys().next().value);
  }
  current = artifact;
  return artifact;
}

/**
 * 异步取最新产物：过期就重编，失败抛 AnnotateBundleError（调用方决定 500 还是
 * 回退老地址）。并发调用与在途构建合并成同一份 promise。
 */
export function ensureAnnotateBundle() {
  if (current && !building && currentMtime === maxSourceMtime()) return Promise.resolve(current);
  if (building) return building;
  building = buildAnnotateBundle()
    .then((artifact) => {
      currentMtime = maxSourceMtime();
      return remember(artifact);
    })
    .catch((error) => {
      // 重编失败就摘掉 current：注入点回退老地址、/annotate.js 显式 500 带原因
      // —— 不能让页面继续引用旧哈希地址、静默吃旧版（immutable 缓存下更没救）。
      current = null;
      throw new AnnotateBundleError(describeBuildError(error));
    })
    .finally(() => { building = null; });
  return building;
}

/**
 * 同步取产物（注入点是同步拼 HTML 的，等不了 async）。源码没变直接回缓存；
 * 在途构建先给手上这份（落地后下一次调用自然换新）。失败抛 AnnotateBundleError。
 */
export function currentAnnotateBundle() {
  if (building) {
    if (!current) throw new AnnotateBundleError('first build still running');
    return current;
  }
  if (current && currentMtime === maxSourceMtime()) return current;
  try {
    const artifact = buildAnnotateBundleSync();
    currentMtime = maxSourceMtime();
    return remember(artifact);
  } catch (error) {
    current = null;
    throw new AnnotateBundleError(describeBuildError(error));
  }
}

/** 按哈希找历史产物（/annotate.<hash>.js 路由；找不到 = 不认识的哈希，404）。 */
export function annotateBundleByHash(hash) {
  return artifacts.get(hash) || null;
}

/**
 * 注入点该引用的客户端地址。有产物用哈希地址；构建还没落地或失败时回退老
 * 地址 /annotate.js —— 那条路由对同一个失败显式 500 带原因，不吞错。
 */
export function annotateClientSrc() {
  return current ? `/annotate.${current.hash}.js` : '/annotate.js';
}

/**
 * 把 ios-kit.js 自注入里的老地址字面量换成哈希地址（工作台自身的加载处）。
 * 精确替换这一处字面量：kit 也被模板静态发布（无 pinpoint 服务替换），字面量
 * 保持原样时依旧落在老地址上，行为不变。
 */
export function injectAnnotateSrc(jsSource, url) {
  const literal = "s.src = '/annotate.js';";
  if (!jsSource.includes(literal)) return jsSource;
  return jsSource.replace(literal, `s.src = '${url}';`);
}
