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

test('ppnt 子进程只在 e2e/lib/cli.js 里起：它总带 PINPOINT_ORIGIN，不会落到常驻服务', () => {
  const offenders = e2eSources()
    .filter((file) => rel(file) !== 'lib/cli.js')
    .filter((file) => /['"`](?:bin\/)?pinpoint\.mjs['"`]/.test(fs.readFileSync(file, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, [], '用 e2e/lib/cli.js 的 ppnt / ppntResult');
});
