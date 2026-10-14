import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// e2e 代码的写法纪律（AGENTS.md“起服务与验收”）：用例与 helper 静态扫一遍。
const E2E = path.dirname(fileURLToPath(import.meta.url));

/** e2e/ 顶层与 e2e/lib/ 下的 .js（固件站点目录不算），不含本文件这类单测。 */
function e2eSources() {
  const files = [];
  for (const dir of [E2E, path.join(E2E, 'lib')]) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.js') || name.endsWith('.test.js')) continue;
      files.push(path.join(dir, name));
    }
  }
  return files;
}

const rel = (file) => path.relative(E2E, file).split(path.sep).join('/');

test('固定等待：waitForTimeout 只出现在标了“静默窗口”的行（量一段时间里什么都没发生）', () => {
  const offenders = [];
  for (const file of e2eSources()) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/\bwaitForTimeout\s*\(/.test(line) && !line.includes('静默窗口')) offenders.push(`${rel(file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], '等可观察信号（expect.poll、事件、页面里的计数），不写固定 sleep');
});

/** e2e/ 下全部 .js / .mjs / .cjs（含固件目录与 lib/），不含 *.test.js 和 node_modules。 */
function e2eScripts(dir = E2E) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...e2eScripts(full));
    else if (/\.[cm]?js$/.test(entry.name) && !entry.name.endsWith('.test.js')) files.push(full);
  }
  return files;
}

// 直接起 CLI 的三种写法：引用入口文件（bin/pinpoint.mjs、bin/pinpoint-cli.js，路径段或 import），
// 以及 child_process 直接跑 ppnt / pinpoint 命令。注释里提到入口文件名不算（后面没跟引号）。
const CLI_CALL = [
  /(?:pinpoint\.mjs|pinpoint-cli\.js)['"`]/,
  /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(\s*['"`](?:npx\s+)?(?:ppnt|pinpoint)\b/,
];

test('CLI 子进程只经 e2e/lib/cli.js 起：它总带 PINPOINT_ORIGIN，不会落到 owner 的常驻服务', () => {
  const offenders = [];
  for (const file of e2eScripts()) {
    const name = rel(file);
    if (name === 'lib/cli.js') continue;
    const text = fs.readFileSync(file, 'utf8');
    // spec 一律走 lib/cli.js；固件准备脚本这类非 spec 文件，显式设了 PINPOINT_ORIGIN 也算合规。
    if (!name.endsWith('.spec.js') && /PINPOINT_ORIGIN\s*[:=]/.test(text)) continue;
    text.split('\n').forEach((line, i) => {
      if (CLI_CALL.some((re) => re.test(line))) offenders.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'spec 用 e2e/lib/cli.js 的 ppnt / ppntResult；固件脚本要么也用它，要么显式带 PINPOINT_ORIGIN');
});
