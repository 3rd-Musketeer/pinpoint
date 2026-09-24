/**
 * 阶段 4 live 代理画中画 —— /sites/<id>/ 同源代理的纯函数与集成测试。
 *
 * 集成部分起两个真实 server：一个 node:http 上游 fixture（绝对路径 HTML 页 +
 * /assets/*.js + /api/* JSON + 302 + cookie + SSE + WS echo），一个挂了
 * createSitesHandler + createSiteUpgradeHandler 的 pinpoint 侧 server，
 * 用真实 fetch / 全局 WebSocket 打穿整条链路。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { parseReqUrl } from './lib/req-url.js';

import { createSitesHandler } from './sites-api.js';
import {
  createSiteUpgradeHandler,
  injectProxyBootstrap,
  proxyBootstrapSnippet,
  rewriteProxyCss,
  rewriteProxyHtml,
  rewriteProxyLocation,
  rewriteProxyReferer,
  rewriteProxySetCookie,
} from './lib/site-proxy.js';
import { ensureAnnotateBundle } from './lib/annotate-bundle.js';

// 注入断言盯的是构建产物的哈希地址（审计 B3）—— 先把产物编出来。
await ensureAnnotateBundle();
const HASHED_SCRIPT_RE = /<script src="\/annotate\.[0-9a-f]{10}\.js"><\/script>/;

const PREFIX = '/sites/app';
const TARGET = 'https://app.localhost';

/* ---------------- pure rewriters ---------------- */

test('rewriteProxyHtml: root-absolute attributes rebase onto the prefix', () => {
  const html = [
    '<!doctype html><html><head>',
    '<link rel="stylesheet" href="/assets/site.css">',
    '<script type="module" src="/assets/index-abc.js"></script>',
    '</head><body>',
    '<img src="/assets/logo.png" srcset="/a.png 1x, /b.png 2x, //cdn.x/c.png 3x">',
    "<form action='/submit' method=post><button formaction=\"/go\">x</button></form>",
    '<a href="/about">about</a>',
    '<video poster="/p.png"></video>',
    '<object data="/doc.pdf"></object>',
    '</body></html>',
  ].join('');
  const out = rewriteProxyHtml(html, PREFIX);
  assert.ok(out.includes('href="/sites/app/assets/site.css"'));
  assert.ok(out.includes('src="/sites/app/assets/index-abc.js"'));
  assert.ok(out.includes('src="/sites/app/assets/logo.png"'));
  assert.ok(out.includes('srcset="/sites/app/a.png 1x, /sites/app/b.png 2x, //cdn.x/c.png 3x"'));
  assert.ok(out.includes("action='/sites/app/submit'"));
  assert.ok(out.includes('formaction="/sites/app/go"'));
  assert.ok(out.includes('href="/sites/app/about"'));
  assert.ok(out.includes('poster="/sites/app/p.png"'));
  assert.ok(out.includes('data="/sites/app/doc.pdf"'));
});

test('rewriteProxyHtml: already-prefixed, protocol-relative, and relative URLs stay', () => {
  const html = '<img src="/sites/app/x.png"><img src="//cdn.x/y.png"><img src="rel/z.png">';
  assert.equal(rewriteProxyHtml(html, PREFIX), html);
});

test('rewriteProxyHtml: data-src lazy-load attribute also rebases', () => {
  const out = rewriteProxyHtml('<img data-src="/lazy.png">', PREFIX);
  assert.ok(out.includes('data-src="/sites/app/lazy.png"'));
});

test('rewriteProxyHtml: meta refresh and <base> rebase', () => {
  const out = rewriteProxyHtml(
    '<head><base href="/"><meta http-equiv="refresh" content="5; url=/login"></head>',
    PREFIX,
  );
  assert.ok(out.includes('<base href="/sites/app/"'));
  assert.ok(out.includes('url=/sites/app/login'));
});

test('rewriteProxyHtml: <style> bodies and style attributes get the CSS rewrite', () => {
  const out = rewriteProxyHtml(
    '<style>.a{background:url(/bg.png)}</style><div style="background: url(\'/i.png\')"></div>',
    PREFIX,
  );
  assert.ok(out.includes('url(/sites/app/bg.png)'));
  assert.ok(out.includes("url('/sites/app/i.png')"));
});

test('rewriteProxyCss: url() and @import rebase; data:/#/absolute stay', () => {
  const css = [
    '.a{background:url(/bg.png)}',
    ".b{background:url('/q.png')}",
    '@import "/base.css";',
    '.c{background:url(data:image/png;base64,xx)}',
    '.d{background:url(#clip)}',
    '.e{background:url(https://cdn.x/e.png)}',
    '.f{background:url(//cdn.x/f.png)}',
    '.g{background:url(/sites/app/g.png)}',
  ].join('\n');
  const out = rewriteProxyCss(css, PREFIX);
  assert.ok(out.includes('url(/sites/app/bg.png)'));
  assert.ok(out.includes("url('/sites/app/q.png')"));
  assert.ok(out.includes('@import "/sites/app/base.css"'));
  assert.ok(out.includes('url(data:image/png;base64,xx)'));
  assert.ok(out.includes('url(#clip)'));
  assert.ok(out.includes('url(https://cdn.x/e.png)'));
  assert.ok(out.includes('url(//cdn.x/f.png)'));
  assert.ok(out.includes('url(/sites/app/g.png)'));
});

test('rewriteProxyLocation: root-absolute and target-origin URLs rebase; foreign stay', () => {
  assert.equal(rewriteProxyLocation('/login', PREFIX, TARGET), '/sites/app/login');
  assert.equal(rewriteProxyLocation('/', PREFIX, TARGET), '/sites/app/');
  assert.equal(rewriteProxyLocation('/sites/app/x', PREFIX, TARGET), '/sites/app/x');
  assert.equal(
    rewriteProxyLocation('https://app.localhost/done?ok=1#f', PREFIX, TARGET),
    '/sites/app/done?ok=1#f',
  );
  assert.equal(
    rewriteProxyLocation('https://other.example.com/out', PREFIX, TARGET),
    'https://other.example.com/out',
  );
  assert.equal(rewriteProxyLocation('relative-next', PREFIX, TARGET), 'relative-next');
});

test('rewriteProxyReferer: prefixed referer maps back onto the target origin', () => {
  assert.equal(
    rewriteProxyReferer('https://pinpoint.localhost/sites/app/page?x=1', PREFIX, TARGET),
    'https://app.localhost/page?x=1',
  );
  assert.equal(
    rewriteProxyReferer('https://pinpoint.localhost/sites/app', PREFIX, TARGET),
    'https://app.localhost/',
  );
  assert.equal(
    rewriteProxyReferer('https://pinpoint.localhost/index.html', PREFIX, TARGET),
    'https://pinpoint.localhost/index.html',
    'workbench 自身的 referer 不动',
  );
});

test('rewriteProxySetCookie: Domain dropped, Path rebased in place (or added) under the prefix', () => {
  assert.equal(
    rewriteProxySetCookie('sid=1; Path=/; Domain=app.localhost; HttpOnly; Secure', PREFIX),
    'sid=1; Path=/sites/app; HttpOnly; Secure',
  );
  assert.equal(
    rewriteProxySetCookie('pref=dark; Path=/api; SameSite=Lax', PREFIX),
    'pref=dark; Path=/sites/app/api; SameSite=Lax',
  );
  assert.equal(
    rewriteProxySetCookie('bare=1', PREFIX),
    'bare=1; Path=/sites/app',
  );
});

test('proxyBootstrapSnippet: inlines the rebase lib, carries prefix+target, idempotent marker', () => {
  const snippet = proxyBootstrapSnippet('app', 'https://app.localhost');
  assert.ok(snippet.startsWith('<script data-pinpoint-proxy="app">'));
  assert.ok(snippet.includes('"prefix":"/sites/app"'));
  assert.ok(snippet.includes('"targetOrigin":"https://app.localhost"'));
  assert.ok(snippet.includes('window.__pinpointProxy'));
  assert.ok(snippet.includes('rebaseProxyUrl'));
  assert.ok(snippet.includes('virtualAppPath'), 'URL 虚拟化随 bootstrap 注入');
  assert.ok(snippet.includes('history.replaceState'));
  assert.ok(!/^export /m.test(snippet), 'ESM exports stripped for inline use');
  // 必须是合法 JS（拼进 <script> 后能被浏览器解析）。
  new Function(snippet.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
});

test('injectProxyBootstrap: first in <head>, fallback <html> / document start', () => {
  const withHead = injectProxyBootstrap('<html><head><title>t</title></head><body>x</body></html>', 'S');
  assert.equal(withHead, '<html><head>\nS<title>t</title></head><body>x</body></html>');
  const noHead = injectProxyBootstrap('<html lang="en"><body>x</body></html>', 'S');
  assert.equal(noHead, '<html lang="en">\nS<body>x</body></html>');
  const bare = injectProxyBootstrap('<p>x</p>', 'S');
  assert.equal(bare, 'S\n<p>x</p>');
});

/* ---------------- integration: upstream fixture ---------------- */

const APP_HTML = `<!doctype html>
<html><head>
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/app.js" defer></script>
</head><body>
<h1 id="title">upstream app</h1>
</body></html>
`;

const APP_JS = `document.getElementById('title').dataset.js = 'loaded';\n`;

function encodeWsText(text) {
  const payload = Buffer.from(text);
  const header = [0x81];
  if (payload.length < 126) header.push(payload.length);
  else if (payload.length < 65536) header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  else throw new Error('frame too long for the fixture');
  return Buffer.concat([Buffer.from(header), payload]);
}

/** Minimal WS echo server: parses masked client frames, echoes with a prefix. */
function wsEcho(socket) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;
      const mask = masked ? buf.subarray(offset, offset + 4) : null;
      let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
      if (mask) {
        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) unmasked[i] = payload[i] ^ mask[i % 4];
        payload = unmasked;
      }
      buf = buf.subarray(offset + maskLen + len);
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x1) socket.write(encodeWsText(`ws-echo:${payload.toString('utf8')}`));
    }
  });
}

function startUpstream(t, hits) {
  const server = http.createServer((req, res) => {
    const { pathname, query } = parseReqUrl(req);
    const search = query.toString() ? `?${query}` : '';
    hits.push(`${req.method} ${pathname}${search}`);
    if (pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'",
        'X-Frame-Options': 'DENY',
      });
      res.end(APP_HTML);
      return;
    }
    if (pathname === '/assets/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(APP_JS);
      return;
    }
    if (pathname === '/assets/site.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end('body{background:url(/assets/bg.png)}\n');
      return;
    }
    if (pathname === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'api-via-proxy' }));
      return;
    }
    if (pathname === '/api/echo' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ echo: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      return;
    }
    if (pathname === '/redirect') {
      res.writeHead(302, { Location: '/final' });
      res.end();
      return;
    }
    if (pathname === '/redirect-absolute') {
      // 绝对 Location 用上游自己的 host（代理会把 Host 改写成它），这样
      // 代理侧 origin 比较才成立。
      res.writeHead(302, { Location: `http://${req.headers.host}/final-abs` });
      res.end();
      return;
    }
    if (pathname === '/cookie') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': ['sid=42; Path=/; Domain=upstream.local; HttpOnly', 'plain=1'],
      });
      res.end('cookie set');
      return;
    }
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: sse-one\n\n');
      const timer = setInterval(() => res.write('data: sse-two\n\n'), 20);
      req.on('close', () => clearInterval(timer));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('upstream 404');
  });
  server.on('upgrade', (req, socket) => {
    if (!req.url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    wsEcho(socket);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => server.close(done)));
      resolve(server);
    });
  });
}

function startProxySide(t, upstreamOrigin) {
  const registry = {
    resolve: (id) => (id === 'app' ? { id: 'app', title: 'App', kind: 'url', url: upstreamOrigin } : null),
  };
  const handleSites = createSitesHandler({ registry });
  const server = http.createServer((req, res) => {
    handleSites(req, res, (req.url || '').split('?')[0]).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end('fallthrough');
      }
    });
  });
  server.on('upgrade', createSiteUpgradeHandler({ registry }));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => new Promise((done) => server.close(done)));
      resolve(server);
    });
  });
}

async function withPair(t, run) {
  const hits = [];
  const upstream = await startUpstream(t, hits);
  const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = await startProxySide(t, upstreamOrigin);
  const base = `http://127.0.0.1:${proxy.address().port}`;
  await run(base, hits);
}

test('proxy: HTML rewritten + bootstrap first + annotate injected; annotate=off keeps only mechanics', async (t) => {
  await withPair(t, async (base) => {
    const res = await fetch(`${base}/sites/app/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('src="/sites/app/assets/app.js"'), 'absolute script src rewritten');
    assert.ok(html.includes('href="/sites/app/assets/site.css"'), 'absolute link href rewritten');
    assert.ok(html.includes("window.__pinpointEntry='app'"), 'annotate entry marker injected');
    assert.ok(HASHED_SCRIPT_RE.test(html), 'annotate client injected on the hashed artifact URL');
    assert.ok(html.includes('window.__pinpointProxy'), 'rebase bootstrap injected');
    assert.ok(
      html.indexOf('__pinpointProxy') < html.indexOf('/assets/app.js'),
      'bootstrap runs before any page script',
    );
    // 框架/脚本封锁头整头剥掉。
    assert.equal(res.headers.get('content-security-policy'), null);
    assert.equal(res.headers.get('x-frame-options'), null);

    const off = await fetch(`${base}/sites/app/?annotate=off`);
    const offHtml = await off.text();
    assert.ok(!offHtml.includes('__pinpointEntry'), 'annotate=off: 无标注面');
    // annotate=off 一个客户端标签都不许有（哈希地址与老地址都算）。
    assert.ok(!/<script src="\/annotate/.test(offHtml), 'annotate=off: 无 annotate script 标签');
    assert.ok(offHtml.includes('window.__pinpointProxy'), 'annotate=off: 重基 bootstrap 保留（代理机制）');
    assert.ok(offHtml.includes('src="/sites/app/assets/app.js"'), 'annotate=off: URL 重写保留');
  });
});

test('proxy: assets pass through byte-identical; CSS url() rewritten; query preserved', async (t) => {
  await withPair(t, async (base, hits) => {
    const js = await fetch(`${base}/sites/app/assets/app.js`);
    assert.equal(js.status, 200);
    assert.equal(await js.text(), APP_JS, 'JS 不重写、逐字节透传');

    const css = await fetch(`${base}/sites/app/assets/site.css`);
    assert.equal(await css.text(), 'body{background:url(/sites/app/assets/bg.png)}\n');

    const json = await fetch(`${base}/sites/app/api/data?from=proxy`);
    assert.equal(json.status, 200);
    assert.deepEqual(await json.json(), { message: 'api-via-proxy' });
    assert.ok(hits.includes('GET /api/data?from=proxy'), 'query 串原样到达上游');
  });
});

test('proxy: POST body round-trips; 302 Location and Set-Cookie rewritten', async (t) => {
  await withPair(t, async (base) => {
    const echo = await fetch(`${base}/sites/app/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ping: 1 }),
    });
    assert.equal(echo.status, 200);
    assert.deepEqual(await echo.json(), { echo: { ping: 1 } });

    const redirect = await fetch(`${base}/sites/app/redirect`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/sites/app/final');

    // 上游 404 如实回传（原 e2e url-entry 的 /sites/e2e-proxy/nope 那半句）。
    const missing = await fetch(`${base}/sites/app/nope`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), 'upstream 404');

    // 上游 Location 里的「绝对 URL」指它自己 origin 时同样折回前缀。
    const absolute = await fetch(`${base}/sites/app/redirect-absolute`, { redirect: 'manual' });
    assert.equal(absolute.headers.get('location'), '/sites/app/final-abs');

    const cookie = await fetch(`${base}/sites/app/cookie`);
    const cookies = cookie.headers.getSetCookie();
    assert.ok(cookies.some((c) => c.startsWith('sid=42') && c.includes('Path=/sites/app') && !/Domain=/i.test(c)));
    assert.ok(cookies.some((c) => c.startsWith('plain=1') && c.includes('Path=/sites/app')));
  });
});

test('proxy: SSE streams through (my-todos /api/events 同款通道)', async (t) => {
  await withPair(t, async (base) => {
    const res = await fetch(`${base}/sites/app/api/events`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 3000;
    while (!text.includes('sse-two') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    assert.ok(text.includes('sse-one'), text);
    assert.ok(text.includes('sse-two'), text);
  });
});

test('proxy: WS upgrade forwards to the upstream echo (通用兜底)', async (t) => {
  await withPair(t, async (base) => {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/sites/app/ws`);
      const timer = setTimeout(() => reject(new Error('ws echo timeout')), 5000);
      ws.onopen = () => ws.send('hello');
      ws.onmessage = (event) => {
        clearTimeout(timer);
        assert.equal(event.data, 'ws-echo:hello');
        ws.close();
        resolve();
      };
      ws.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(`ws error: ${event.message || 'unknown'}`));
      };
    });
  });
});

test('proxy: board.json is synthesized locally (shadows upstream), unknown entries 404', async (t) => {
  await withPair(t, async (base) => {
    const board = await fetch(`${base}/sites/app/board.json`);
    assert.equal(board.status, 200);
    const doc = await board.json();
    assert.deepEqual(doc.sections[0].screens, [{ id: 'index', title: 'App', src: 'sites/app/' }]);

    const ghost = await fetch(`${base}/sites/ghost/`);
    assert.equal(ghost.status, 404);
  });
});

test('proxy: bootstrap 虚拟化把 annotate 参数从 search 剥掉，其余 query 原样保留', async (t) => {
  await withPair(t, async (base) => {
    const res = await fetch(`${base}/sites/app/?annotate=off&keep=1`);
    const html = await res.text();
    const bootstrap = html.match(/<script data-pinpoint-proxy="app">([\s\S]*?)<\/script>/)[1];
    // annotate 是代理机制参数，不许透给应用（url-entry.spec.js 曾直开代理页断言
    // location.search 为空，2026-09-24 精简下沉到这里）；replaceState 的 search
    // 只由删过 annotate 的剩余参数拼出。
    assert.match(bootstrap, /__qs\.delete\('annotate'\)/, 'annotate 参数被剥掉');
    assert.match(bootstrap, /history\.replaceState\([^\n]*__q\?'\?'\+__q:''/, 'search 只留剩余参数');
  });
});
