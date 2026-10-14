#!/usr/bin/env node
/**
 * pinpoint CLI 壳：参数层与判定都在 ./pinpoint-cli.js（node --test 覆盖），
 * 这里只接进程 IO —— 发信号、spawn 服务、等待。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { run } from './pinpoint-cli.js';

/** pid 是否还在。EPERM = 进程在，只是不归我们（不该按「死了」处理）。 */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * 起服务 = 在仓库根跑 `npm run dev`（就是 `just dev` 包的那条：
 * `portless run --name pinpoint npm run dev:app`）。detached + 自己的进程组，
 * 好让它活过这个 CLI 进程；stdio 全落日志文件，什么都不继承。
 */
function spawnService({ cwd, logFile }) {
  const log = fs.openSync(logFile, 'a');
  fs.writeSync(log, `\n=== ${new Date().toISOString()} pinpoint start (cwd ${cwd}) ===\n`);
  const child = spawn('npm', ['run', 'dev'], {
    cwd,
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  });
  child.unref();
  return child;
}

/** 用系统浏览器打开一个网址（ppnt open 不带 --print）。 */
function openUrl(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(command, [url], { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  pidAlive,
  killPid: (pid, signal) => process.kill(pid, signal),
  spawnService,
  openUrl,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
process.exit(code);
