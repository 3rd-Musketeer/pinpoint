/**
 * 服务端 HTTP 应答尾板（2026-10-19 S1 收敛，r2 D3）：annotate-api / sites-api /
 * frame-api / projects-api / export-image-api / export-page-html-api 原本各抄一份的
 * sendJson / readBody / sendFile / mime 表 / GET-HEAD 方法闸，这里一份。
 * 错误响应体统一 { error, message }（r2 I6）。
 * 缓存策略不在这里：各路由照旧自己写 Cache-Control（S3 才收策略表）。
 */
import fs from 'node:fs';
import path from 'node:path';

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
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

/** 扩展名 → Content-Type 主类型；不认得的扩展名给 fallback。 */
export function mimeFor(name, fallback = 'application/octet-stream') {
  return MIME[path.extname(String(name)).toLowerCase()] || fallback;
}

/** 文本类主类型补 charset=utf-8，其余原样。 */
export function contentTypeFor(name) {
  const mime = mimeFor(name);
  return /^(text\/|application\/(json|javascript)|image\/svg)/.test(mime)
    ? `${mime}; charset=utf-8`
    : mime;
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
 * 读盘出一个文件：Content-Type 按扩展名（文本类补 charset）+ Content-Length，
 * HEAD 只回头。inject 给了且是 HTML 时先过一遍注入（标注客户端）。
 * cacheControl 缺省 'no-cache'；传 null 不发 Cache-Control 头。应答完返回 true。
 */
export function sendFile(req, res, file, { inject = null, cacheControl = 'no-cache' } = {}) {
  let body = fs.readFileSync(file);
  if (inject && mimeFor(file) === 'text/html') body = Buffer.from(inject(body.toString('utf8')), 'utf8');
  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFor(file));
  res.setHeader('Content-Length', String(body.length));
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

/** GET / HEAD 之外的方法：405 + Allow + 统一错误体。POST 端点传 allow = 'POST'。 */
export function sendMethodNotAllowed(res, allow = 'GET, HEAD') {
  res.setHeader('Allow', allow);
  sendJson(res, 405, { error: 'method_not_allowed', message: 'method not allowed' });
}
