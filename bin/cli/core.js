import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { slugify } from '../../src/shared/registry-ids.js';

export const DEFAULT_ORIGIN = 'https://pinpoint.localhost';
/** 服务在 portless 里的注册名 / 主机名（`portless run --name pinpoint`）。 */
export const PORTLESS_HOSTNAME = 'pinpoint.localhost';

// CLI 住在仓库里，仓库根就是 pinpoint workbench 自己的 dir entry 路径——
// 首次 add（registry 文件还不存在）时用它播种默认 pinpoint 条目，与
// loadRegistry 的 missing-file 语义一致，workbench 自己的标注桶不会丢。
// status 也拿它跟服务自报的 root 比对（2026-09-04 事故：进程还在，抱着搬迁前的
// 旧绝对路径跑裸默认配置）。
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export class CliError extends Error {}

export { slugify };

/**
 * 零依赖的 JSON 请求（GET/POST）。为什么不用全局 fetch：常驻服务经 portless
 * 代理暴露在 https://pinpoint.localhost，证书是本地自签 CA——curl 走系统
 * 钥匙串能验，node 的 fetch 读不到钥匙串会 SELF_SIGNED_CERT_IN_CHAIN。
 * 目标只是本机开发服务的探活/reload，故 https 关闭证书校验。
 * 返回 { status, json }；网络/超时错误 reject。
 */
export function requestJson(urlString, { method = 'GET', timeoutMs = 1500, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        rejectUnauthorized: false, // 本机自签代理，见函数注释
        timeout: timeoutMs,
        ...(body != null ? { headers: { 'Content-Type': 'application/json' } } : {}),
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch { /* 健康检查只要状态码；reload 一定是 JSON，json 为 null 时按失败处理 */ }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body == null ? undefined : JSON.stringify(body));
  });
}

export function ioOf(io) {
  return {
    cwd: io.cwd || process.cwd(),
    env: io.env || process.env,
    out: io.out || ((line) => console.log(line)),
    err: io.err || ((line) => console.error(line)),
    requestFn: io.requestFn || requestJson,
  };
}

const CJK = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/** 终端显示宽度（全角算 2），给状态表对齐用。 */
export function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) width += CJK.test(ch) ? 2 : 1;
  return width;
}

export function padWide(text, width) {
  return String(text) + ' '.repeat(Math.max(0, width - displayWidth(text)));
}
