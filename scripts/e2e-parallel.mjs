import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) throw new Error('Use npm run test:e2e:serial -- <options> for targeted runs.');

const root = fileURLToPath(new URL('../', import.meta.url));
const all = readdirSync(new URL('../e2e/', import.meta.url)).filter(name => name.endsWith('.spec.js')).sort();
// Balance by measured file durations. New specs automatically join the second group.
const first = new Set(['workbench.spec.js', 'review-refinements.spec.js', 'scroll-motion.spec.js',
  'dir-entry.spec.js', 'integration-canvas.spec.js', 'mixed-board.spec.js', 'url-entry.spec.js', 'page-sort.spec.js']);
// 高负载降为单组（2026-09-23）：机器 1 分钟 load ≥ 阈值时两组并行会随机超时，
// 每次挂的用例不同、单跑全过。阈值默认 4（实测 load < 4 时两组稳定），
// E2E_SINGLE_GROUP_LOAD 改阈值，E2E_GROUPS=1|2 强制组数。
const load = loadavg()[0];
const threshold = Number(process.env.E2E_SINGLE_GROUP_LOAD || 4);
const forced = process.env.E2E_GROUPS;
if (forced && forced !== '1' && forced !== '2') throw new Error('E2E_GROUPS must be 1 or 2');
const single = forced ? forced === '1' : load >= threshold;
const groups = single ? [all] : [all.filter(name => first.has(name)), all.filter(name => !first.has(name))];
console.log(`E2E: load ${load.toFixed(2)}, ${single ? '1 group' : '2 groups'}`
  + (forced ? ' (E2E_GROUPS)' : ` (single-group threshold ${threshold})`));
const port = Number(process.env.E2E_PORT || 5299);
if (!Number.isInteger(port) || port < 1024 || port > 65505) throw new Error('Invalid E2E_PORT');
const children = [];
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    process.exitCode = 1;
    for (const child of children) child.kill(signal);
  });
}

function runGroup(index, args) {
  const groupPort = port + index * 20;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...args, '--workers=1'], {
      cwd: root, stdio: 'inherit', env: {...process.env, E2E_PORT: String(groupPort),
        E2E_UPSTREAM_PORT: String(groupPort + 10), PLAYWRIGHT_HTML_OPEN: 'never'},
    });
    children.push(child);
    child.once('error', error => { console.error(error); resolve(1); });
    child.once('exit', code => resolve(code ?? 1));
  });
}

const started = Date.now();
const results = await Promise.all(groups.map((files, index) => {
  console.log(`E2E group ${index + 1}: ${files.length} files, port ${port + index * 20}`);
  return runGroup(index, files.map(name => `e2e/${name}`));
}));
console.log(`E2E groups finished in ${((Date.now() - started) / 1000).toFixed(1)}s; exit codes: ${results.join(', ')}`);

// 失败用例自动重跑一次（2026-09-23）：只重跑失败的（playwright --last-failed，读该组
// 产物目录里的 .last-run.json），各组依次跑、不再并行。重跑仍挂才算挂。
for (const [index, code] of results.entries()) {
  if (code === 0) continue;
  console.log(`E2E group ${index + 1}: rerunning failed tests once`);
  results[index] = await runGroup(index, ['--last-failed']);
  console.log(`E2E group ${index + 1}: rerun exit code ${results[index]}`);
}
if (results.some(code => code !== 0)) process.exitCode = 1;
