import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) throw new Error('Use npm run test:e2e:serial -- <options> for targeted runs.');

const root = fileURLToPath(new URL('../', import.meta.url));
const all = readdirSync(new URL('../e2e/', import.meta.url)).filter(name => name.endsWith('.spec.js')).sort();
// 各 spec 实测时长（秒，只含 test 本身，不含起服）。重测更新这张表：
//   E2E_PORT=<空闲基准> npm run test:e2e:serial -- --reporter=json > durations.json
// 把 JSON 报告里每条用例的 duration 按文件汇总填进来（2026-09-24 e2e 精简后实测，
// load 约 5.4；负载只抬高绝对值，比例可用）。表里没有的新 spec 按表内平均
// 时长计，不用登记也进得了对组。
const durations = {
  'ann-sidebar.spec.js': 6.2,
  'attach-entry.spec.js': 1.0,
  'bundle-cache.spec.js': 0.1,
  'canvas-diagnostics.spec.js': 2.6,
  'canvas-pan.spec.js': 13.5,
  'comp-layout.spec.js': 0.3,
  'dir-entry.spec.js': 1.5,
  'export-picker.spec.js': 1.2,
  'grouping-refresh.spec.js': 0.8,
  'integration-canvas.spec.js': 3.4,
  'mention.spec.js': 1.2,
  'mixed-board.spec.js': 1.2,
  'page-bucket.spec.js': 1.6,
  'page-sort.spec.js': 1.4,
  'pp-id-anchor.spec.js': 0.9,
  'pp2-build.spec.js': 0.6,
  'ppnt-cli.spec.js': 2.6,
  'preview-hmr.spec.js': 0.5,
  'review-refinements.spec.js': 6.6,
  'scroll-motion.spec.js': 2.1,
  'section-scroll.spec.js': 3.0,
  'sidebar-content.spec.js': 5.5,
  'spa-ledger.spec.js': 1.1,
  'url-entry.spec.js': 1.1,
  'viewport.spec.js': 3.9,
  'workbench.spec.js': 46.3,
};
// 按表贪心分两组：时长降序，依次放进当前总时长更短的那组（2026-09-24 之前
// 是手排 first 集合，workbench 长出来后第一组独大约 73%、第二组空等 ~30s）。
function splitGroups(files) {
  const values = Object.values(durations);
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
  const weight = name => durations[name] ?? avg;
  const sorted = [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  const totals = [0, 0];
  const groups = [[], []];
  for (const name of sorted) {
    const i = totals[1] < totals[0] ? 1 : 0;
    groups[i].push(name);
    totals[i] += weight(name);
  }
  return groups;
}
// 高负载降为单组（2026-09-23）：机器 1 分钟 load ≥ 阈值时两组并行会随机超时，
// 每次挂的用例不同、单跑全过。阈值默认 4（实测 load < 4 时两组稳定），
// E2E_SINGLE_GROUP_LOAD 改阈值，E2E_GROUPS=1|2 强制组数。
// 2026-09-24 校准：根因修复（挂载几何批、whenBoardSettled）之后，load 6.6~8.6
// 下强制两组连跑 3 轮，每轮首跑仍有 2~3 条随机超时、一轮重跑后仍挂（单跑全过），
// 所以阈值维持 4，不上调。
const load = loadavg()[0];
const threshold = Number(process.env.E2E_SINGLE_GROUP_LOAD || 4);
const forced = process.env.E2E_GROUPS;
if (forced && forced !== '1' && forced !== '2') throw new Error('E2E_GROUPS must be 1 or 2');
const single = forced ? forced === '1' : load >= threshold;
const groups = single ? [all] : splitGroups(all);
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
    const groupStarted = Date.now();
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...args, '--workers=1'], {
      cwd: root, stdio: 'inherit', env: {...process.env, E2E_PORT: String(groupPort),
        E2E_UPSTREAM_PORT: String(groupPort + 10), PLAYWRIGHT_HTML_OPEN: 'never'},
    });
    children.push(child);
    child.once('error', error => { console.error(error); resolve(1); });
    child.once('exit', code => {
      // 各组墙钟落一行，配平偏没偏直接看得见（不用再拆 JSON 报告）。
      console.log(`E2E group ${index + 1}: exit ${code ?? 1} in ${((Date.now() - groupStarted) / 1000).toFixed(1)}s`);
      resolve(code ?? 1);
    });
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
