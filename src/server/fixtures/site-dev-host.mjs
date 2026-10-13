#!/usr/bin/env node
/**
 * 测 stopOnSignals 用的服务替身：建一个 site dev server（命令是 site-dev-stub.mjs），
 * 装上 stopOnSignals，拉起站点，就绪后往 stdout 打一行 JSON { pid }（站点进程组
 * leader 的 pid），然后一直挂着，等测试给它发信号。
 *   node site-dev-host.mjs <port>
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSiteDevServer, stopOnSignals } from '../lib/site-dev-server.js';

const port = Number(process.argv[2]);
const stub = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site-dev-stub.mjs');
const dev = createSiteDevServer({
  port,
  command: `${JSON.stringify(process.execPath)} ${JSON.stringify(stub)} --port ${port}`,
  log: () => {},
});
stopOnSignals(dev);
dev.ensure();
const ready = await dev.whenReady();
process.stdout.write(`${JSON.stringify({ state: ready.state, pid: ready.pid })}\n`);
setInterval(() => {}, 1 << 30);
