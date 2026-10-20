/**
 * 服务端 HTTP 应答尾板（2026-10-19 S1 收敛，r2 D3）：annotate-api / sites-api /
 * frame-api / projects-api / export-image-api / export-page-html-api 原本各抄一份的
 * sendJson / readBody / sendFile / mime 表 / GET-HEAD 方法闸，这里一份。
 * 错误响应体统一 { error, message }（r2 I6）。
 * 缓存策略也在这里（S3，r2 I5 / 审计 K2c）：每类资源一行（CACHE_POLICIES），
 * Cache-Control 与 ETag 的算法一处定；sendCacheable 出条件应答（If-None-Match → 304）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { etagMatches } from './etag.js';

const MIME = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

/** 扩展名 → Content-Type 主类型；不认得的扩展名给 fallback。header（响应声明的
    content-type）给了就优先——离线导出抓回的远程资源以服务器说的为准。 */
export function mimeFor(name, fallback = 'application/octet-stream', header = '') {
  const declared = String(header || '').split(';')[0].trim().toLowerCase();
  if (declared) return declared;
  return MIME[path.extname(String(name)).toLowerCase()] || fallback;
}

/** 文本类主类型补 charset=utf-8，其余原样。 */
export function contentTypeFor(name) {
  const mime = mimeFor(name);
  return /^(text\/|application\/(json|javascript)|image\/svg)/.test(mime)
    ? `${mime}; charset=utf-8`
    : mime;
}

/**
 * 缓存策略表（S3）：每类资源一行，Cache-Control 与 ETag 算法在这里一处定
 * （r2 I5「同类资源不同策略」的归一；dist 屏加 ETag 是审计 K2c 的修复——
 * reload / HMR 重取时 304 落地，不再全量重传）。
 *
 *   etag: 'content' — 应答字节的 sha1（注入后的最终字节，内容一变 ETag 就变，
 *                     HMR 重编后浏览器必然拿到新内容）；
 *         'stat'    — 盘上文件的 mtime+size（静态资源原样出，不读内容也算得出）。
 *
 * 语义：no-cache = 可存但每次用前必须再验证（revalidate 命中即 304）。annotate
 * bundle 不在表里：它的哈希地址路由自己写 immutable 头、不出 ETag（annotate-api），
 * 表行救不了它也没有路由在读（review 建议 2，别再加死行）。资源类加行，别在路由
 * 里手写头。
 */
export const CACHE_POLICIES = {
  distScreen: { cacheControl: 'no-cache', etag: 'content' },
  frameHtml: { cacheControl: 'no-cache', etag: 'content' },
  staticFile: { cacheControl: 'no-cache', etag: 'stat' },
  boardJson: { cacheControl: 'no-cache', etag: 'content' },
  image: { cacheControl: 'no-cache', etag: 'stat' },
};

/** 应答字节的强 ETag（sha1 截 16 hex，40bit 对进程内一份内容足够防撞）。 */
export function contentEtag(body) {
  return `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
}

/** 盘上文件的 ETag：mtime 原值（不取整）+size。同一进程内文件没动过就命中 304。
    不取整是 review 必须修 1：APFS 的 mtime 带亚毫秒小数（125µs 一格），取整到
    毫秒后同一毫秒内的等长重写（watch 重写、脚本生成）ETag 不变，带旧 ETag 重取
    会 304 回旧字节。mtimeMs 是 double，本纪元下精度约 0.24µs，比 APFS 的 125µs
    一格细 500 倍，相邻两格分得开。 */
export function statEtag(stat) {
  return `"${stat.mtimeMs}-${stat.size}"`;
}

/**
 * 条件应答尾板：Cache-Control + ETag 先行，If-None-Match 命中（etagMatches 的
 * 弱比较 / 列表 / `*` 都算）答 304 不带表示头；未命中 200 + Content-Type +
 * Content-Length 出体，HEAD 只回头。etag 覆盖给得起自定义值（ios-kit 那种
 * 「源文件 mtime + 注入地址」拼出来的、sendFile 给 stat 策略拼的 mtime+size），
 * 缺省按最终应答字节算内容哈希。
 */
export function sendCacheable(req, res, body, { policy, contentType, etag = null }) {
  const row = typeof policy === 'string' ? CACHE_POLICIES[policy] : policy;
  if (!row) throw new TypeError(`sendCacheable 要策略表里的一行，收到 ${policy}`);
  const tag = etag || contentEtag(body);
  res.setHeader('Cache-Control', row.cacheControl);
  res.setHeader('ETag', tag);
  // 同源原生 iframe 的父页只能从 Navigation Timing 读响应元数据，不能直接读导航响应头。
  // 透出这一次实际显示的校验值；不另取一次源文件来猜，避免把后继稿的 ETag 记在旧画面上。
  if (row === CACHE_POLICIES.frameHtml) res.setHeader('Server-Timing', `pp-etag;desc="${encodeURIComponent(tag)}"`);
  if (etagMatches(req.headers['if-none-match'], tag)) {
    res.statusCode = 304;
    res.end();
    return true;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(body.length));
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

/** JSON 应答：status + Content-Type + Content-Length；cacheControl 给了才发 Cache-Control。 */
export function sendJson(res, status, body, { cacheControl = null } = {}) {
  const buffer = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(buffer.length));
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  res.end(buffer);
}

/** readBody 超上限时的拒因；调用方按自己的错误契约翻译（400 / 413）。 */
export class BodyTooLargeError extends Error {
  constructor(limit) {
    super('body is too large');
    this.name = 'BodyTooLargeError';
    this.limit = limit;
  }
}

/**
 * 读整个请求体（utf8 文本）。limit 是字节数上限，必给（每个入口写清自己的上限）；
 * 超了拒 BodyTooLargeError。拒完不能毁请求（req.destroy 会把 socket 一起带走，
 * 调用方的 413/400 应答发不出去）：停掉攒数、排空剩余体，让应答走同一条连接回去。
 */
export function readBody(req, limit) {
  if (!Number.isFinite(limit) || limit <= 0) throw new TypeError(`readBody 要明确的字节上限，收到 ${limit}`);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLargeError(limit));
        req.removeAllListeners('data');
        if (typeof req.resume === 'function') req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * 读盘出一个文件：Content-Type 按扩展名（文本类补 charset），走策略表的条件
 * 应答（sendCacheable）。inject 给了且是 HTML 时先过一遍注入（标注客户端）。
 * ETag：策略行 'content'（帧 HTML、要注入的文档——同一文件的注入 / off 两种
 * 变体字节不同，验证器必须是内容哈希才分得开）或注入真的发生了 → 最终字节的
 * 哈希；原样出的静态资源 / 图片走行里的 mtime+size。policy 是 CACHE_POLICIES
 * 的行名，缺省 staticFile。应答完（含 304）返回 true。
 * stat 的次序是「先 stat、再读、再 stat，两次不同就重读一次」（review 必须修 1
 * 后半）：旧的「先读后 stat」在两次系统调用之间文件被改写时，体是旧字节、ETag
 * 却按新 stat 算——这个 ETag 被记下去以后每次验证都 304，缓存里钉着旧体。重试
 * 的 stat 取在读之前：就算读时又被改写，ETag 也只比体旧，下次带它来必然 miss
 * 拿到新体，不会反向钉死。
 */
export function sendFile(req, res, file, { inject = null, policy = 'staticFile' } = {}) {
  const injected = Boolean(inject) && mimeFor(file) === 'text/html';
  let stat = fs.statSync(file);
  let body = fs.readFileSync(file);
  const after = fs.statSync(file);
  if (after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) {
    stat = fs.statSync(file);
    body = fs.readFileSync(file);
  }
  if (injected) body = Buffer.from(inject(body.toString('utf8')), 'utf8');
  const row = CACHE_POLICIES[policy];
  if (!row) throw new TypeError(`sendFile 要策略表里的一行，收到 ${policy}`);
  return sendCacheable(req, res, body, {
    policy: row,
    contentType: contentTypeFor(file),
    etag: !injected && row.etag === 'stat' ? statEtag(stat) : null,
  });
}

/** GET / HEAD 之外的方法：405 + Allow + 统一错误体。POST 端点传 allow = 'POST'。 */
export function sendMethodNotAllowed(res, allow = 'GET, HEAD') {
  res.setHeader('Allow', allow);
  sendJson(res, 405, { error: 'method_not_allowed', message: 'method not allowed' });
}

/** 这是不是一次读（sites-api 家规：只有 GET / HEAD 出内容）。 */
function isReadMethod(req) {
  return req.method === 'GET' || req.method === 'HEAD';
}

/** 非 GET / HEAD 时答 405 返回 true；读请求返回 false（调用方继续出自己的内容）。 */
export function rejectWrite(req, res, allow = 'GET, HEAD') {
  if (isReadMethod(req)) return false;
  sendMethodNotAllowed(res, allow);
  return true;
}
