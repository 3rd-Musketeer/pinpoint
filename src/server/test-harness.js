/**
 * 服务端插件的 node --test 公共手脚架（2026-09-22 切片 4 收拢）。
 *
 * 四份 mockReq / mockRes 与一份 fakeServer 此前各写各的，行为在悄悄分叉
 * （string body 还是 Buffer、json getter 有没有、代理分支的 on/destroy 有没有）。
 * 这里一份超集：足够 annotate-api / sites-api（代理分支）/ frame-api 用。
 *   mockReq(method, url, body?) —— body 是字符串原样发、对象 JSON.stringify
 *     （读侧 readBody 拿到 Buffer）；undefined 时不发（GET / 代理流）。
 *   mockRes() —— chunks 累 Buffer，body / text / json 取值器齐全，
 *     headersSent / writableEnded / on / destroy 给代理与 HEAD 分支。
 *   fakeServer() —— vite server 桩：ws.send / watcher.add 收集到数组。
 */
import { EventEmitter } from 'node:events';

export function mockReq(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {};
  req.pipe = () => {}; // url 条目的代理分支把请求体 pipe 给上游
  if (body !== undefined) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    queueMicrotask(() => {
      req.emit('data', Buffer.from(payload));
      req.emit('end');
    });
  }
  return req;
}

export function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    chunks: [],
    headersSent: false,
    writableEnded: false,
    setHeader(key, value) { this.headers[key] = value; },
    on() { return this; },      // 代理分支挂 close 监听
    destroy() {},
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); },
    write(chunk) { this.chunks.push(Buffer.from(chunk)); this.headersSent = true; },
    end(data) {
      if (data !== undefined) this.chunks.push(Buffer.from(data));
      this.headersSent = true;
      this.writableEnded = true;
    },
    get body() { return Buffer.concat(this.chunks); },
    get text() { return this.body.toString('utf8'); },
    get json() { return JSON.parse(this.text); },
  };
}

export function fakeServer() {
  const server = {
    sent: [],
    added: [],
    ws: { send(message) { server.sent.push(message); } },
    watcher: { add(target) { server.added.push(target); } },
  };
  return server;
}
