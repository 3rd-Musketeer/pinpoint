import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workbenchSupplement, workbenchGroupMode } from './e2e-workbench-modes.js';

if (process.argv.length > 2) throw new Error('Use npm run test:e2e:serial -- <options> for targeted runs.');

const root = fileURLToPath(new URL('../', import.meta.url));
const all = readdirSync(new URL('../e2e/', import.meta.url)).filter(name => name.endsWith('.spec.js')).sort();
// 各 spec 实测时长（秒，只含 test 本身，不含起服），只用来配平两组。每轮跑完，首跑的
// 每文件时长（只算通过的用例）写进 .tmp/e2e-durations.json；表偏了就照它改这里
// （2026-10-20 提速后按两组全量首跑实测重填，load 约 7.3；负载只抬高绝对值，比例可用）。表里
// 没有的新 spec 按表内平均时长计，下面会提示补登记。
const durations = {
  'ann-sidebar.spec.js': 8.4,
  'article-canvas.spec.js': 6.2,
  'article-site.spec.js': 9.5,
  'article-source.spec.js': 6.7,
  'article-viewer.spec.js': 15.3,
  'bundle-cache.spec.js': 0.1,
  'canvas-clipping.spec.js': 11.5,
  'canvas-diagnostics.spec.js': 2.7,
  'canvas-overlay-motion.spec.js': 34.4,
  'canvas-pan.spec.js': 23.9,
  'comp-layout.spec.js': 0.4,
  'dir-entry.spec.js': 3,
  'doc-reply.spec.js': 2.2,
  'events-reconnect.spec.js': 2.5,
  'export-picker.spec.js': 1.7,
  'figure.spec.js': 1.2,
  'frame-reset.spec.js': 2.3,
  'hidden-scrollbars.spec.js': 5.7,
  'html-frames.spec.js': 15.7,
  'integration-canvas.spec.js': 4.5,
  'layer-stack.spec.js': 4,
  'ledger-rail.spec.js': 4,
  'live-card-save.spec.js': 2.4,
  'mixed-board.spec.js': 2.4,
  'overlay-escape.spec.js': 2.4,
  'owner-flows.spec.js': 39.1,
  'owner-performance.spec.js': 17.5,
  'page-bucket.spec.js': 1.9,
  'page-migrate.spec.js': 2.3,
  'page-overlays.spec.js': 6,
  'page-sort.spec.js': 1.8,
  'phone-cards.spec.js': 1.7,
  'pp-id-anchor.spec.js': 2.4,
  'pp2-build.spec.js': 3.2,
  'ppnt-article.spec.js': 15.6,
  'ppnt-cli.spec.js': 7.3,
  'ppnt-html-shots.spec.js': 9.1,
  'preview-hmr.spec.js': 5,
  'prose-comments.spec.js': 17.6,
  'prose-text-index.spec.js': 0.9,
  'rail-align.spec.js': 27.9,
  'review-refinements.spec.js': 14.2,
  'scroll-motion.spec.js': 2.1,
  'section-deeplink.spec.js': 6.2,
  'section-scroll.spec.js': 4.5,
  'shot-page-race.spec.js': 1,
  'sidebar-content.spec.js': 6.4,
  'tabs.spec.js': 9.1,
  'toc-entry.spec.js': 3.2,
  'viewport.spec.js': 8.7,
  'wiki-panel.spec.js': 4.3,
  'workbench.spec.js': 56.1,
};
// 重度依赖文章站点（真 Astro 开发服务器）的 spec 放在同一组：每轮只冷启动一次（约 4 s），
// 也不会有两个 Astro 同时在跑。2026-10-13 集成那一轮，prose-comments 的 SSE 断线一步
// 首跑失败，trace 里站点在那一步中途重启（文章 503 → 500 → 整页重载）；当时另一组也有
// 自己的 Astro，两者共用 site/.astro/。原因没钉死，同组跑先把这层重叠去掉。
// 之后每个站点进程有了自己的 Astro root（site/.astro-cache/<端口>/，astro.config.mjs），不再共用
// 内容库；同组仍省一次冷启动。
// article-site 要看到“站点还没拉起过”，按文件名它在这一组里排第一个。
// 注：lightweight 开几篇文章页的 spec（canvas-overlay-motion、rail-align、ledger-rail、
// toc-entry、wiki-panel、layer-stack 等）不在此列——它们会在自己那组把该组的站点拉起来，
// 各组站点有自己的 cache root，互不影响（2026-10-20 核对）。
const SITE_SPECS = ['article-site.spec.js', 'article-source.spec.js', 'article-updates.spec.js', 'article-viewer.spec.js', 'figure.spec.js', 'html-frames.spec.js', 'overlay-escape.spec.js', 'owner-flows.spec.js', 'owner-performance.spec.js', 'ppnt-article.spec.js', 'prose-comments.spec.js', 'sidebar-content.spec.js'];
// 按表贪心分两组：时长降序，依次放进当前总时长更短的那组；SITE_SPECS 合成一块一起放
// （2026-09-24 之前是手排 first 集合，workbench 长出来后第一组独大约 73%）。
function splitGroups(files) {
  const values = Object.values(durations);
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
  const weight = name => durations[name] ?? avg;
  const site = files.filter(name => SITE_SPECS.includes(name));
  const blocks = [...files.filter(name => !SITE_SPECS.includes(name)).map(name => [name]), ...(site.length ? [site] : [])]
    .map(names => ({ names, weight: names.reduce((sum, name) => sum + weight(name), 0) }));
  blocks.sort((a, b) => b.weight - a.weight || (a.names[0] < b.names[0] ? -1 : 1));
  const totals = [0, 0];
  const groups = [[], []];
  for (const block of blocks) {
    const i = totals[1] < totals[0] ? 1 : 0;
    groups[i].push(...block.names);
    totals[i] += block.weight;
  }
  return groups.map(names => names.sort());
}
const unlisted = all.filter(name => !(name in durations));
if (unlisted.length) console.log(`E2E: not in the durations table (counted as the average): ${unlisted.join(', ')}`);
// 高负载降为单组（2026-09-23）：机器 1 分钟 load ≥ 阈值时两组并行会随机超时，
// 每次挂的用例不同、单跑全过。阈值默认 4（实测 load < 4 时两组稳定），
// E2E_SINGLE_GROUP_LOAD 改阈值，E2E_GROUPS=1|2 强制组数。
// 2026-09-24 校准：根因修复（挂载几何批、whenBoardSettled）之后，load 6.6~8.6
// 下强制两组连跑 3 轮，每轮首跑仍有 2~3 条随机超时、一轮重跑后仍挂（单跑全过），
// 所以阈值维持 4，不上调。
const load = loadavg()[0];
// 2026-09-29 性能调研：本机 load 常年 5~20，阈值 4 等于永远单组（约 114 秒）；
// 强制两组在 load 5~7 下连跑 3 轮均为 60~85 秒、首跑各有 1~6 条超时且一次重跑全清。
// 所以阈值抬到 10：日常两组，机器真的被压垮（load ≥ 10）才退回单组。
const threshold = Number(process.env.E2E_SINGLE_GROUP_LOAD || 10);
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

const resultsFile = (index, suffix = '') => path.join(root, `test-results-${port + index * 20}${suffix}.json`);

function runGroup(index, args, { mode = workbenchGroupMode(index, process.env.PINPOINT_WORKBENCH_MODE), suffix = '' } = {}) {
  const groupPort = port + index * 20;
  return new Promise(resolve => {
    const groupStarted = Date.now();
    const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...args, '--workers=1',
      ...(suffix ? [`--output=test-results-${groupPort}${suffix}`] : [])], {
      cwd: root, stdio: 'inherit', env: {...process.env, E2E_PORT: String(groupPort),
        // 单组也测正式形态；双组一组 bundle、一组开发模块。显式变量可覆盖两组。
        PINPOINT_WORKBENCH_MODE: mode,
        PLAYWRIGHT_HTML_OPEN: 'never',
        PW_TEST_REPORTER: 'json', PLAYWRIGHT_JSON_OUTPUT_FILE: resultsFile(index, suffix)},
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
writeMeasuredDurations();

/** 首跑的每文件时长（秒，只算通过的用例）→ .tmp/e2e-durations.json，配平表照它更新。 */
function writeMeasuredDurations() {
  const measured = {};
  const walk = (suite, file) => {
    const name = path.basename(suite.file || file || '');
    for (const spec of suite.specs || []) {
      for (const t of spec.tests) {
        for (const r of t.results) if (r.status === 'passed') measured[name] = (measured[name] || 0) + r.duration / 1000;
      }
    }
    for (const child of suite.suites || []) walk(child, suite.file || file);
  };
  for (const index of groups.keys()) {
    try {
      for (const suite of JSON.parse(readFileSync(resultsFile(index), 'utf8')).suites) walk(suite);
    } catch { /* 这一组没出报告（起服失败）：只少几行 */ }
  }
  const out = path.join(root, '.tmp', 'e2e-durations.json');
  mkdirSync(path.dirname(out), { recursive: true });
  const rounded = Object.fromEntries(Object.entries(measured).sort().map(([k, v]) => [k, Math.round(v * 10) / 10]));
  writeFileSync(out, JSON.stringify({ measuredAt: new Date().toISOString(), load: Number(load.toFixed(2)), groups: groups.length, durations: rounded }, null, 2) + '\n');
  console.log(`E2E: first-run durations per spec in ${path.relative(root, out)}`);
}

// 失败用例自动重跑一次（2026-09-23）：只重跑失败的（playwright --last-failed，读该组
// 产物目录里的 .last-run.json），各组依次跑、不再并行。重跑仍挂才算挂。
// 重跑会清空该组的产物目录；先把首跑的截图、trace 与报告复制到 *-first-run，
// 重跑过了的偶发失败也留得下证据（2026-09-28：pp-id-anchor 一次偶发，trace 被重跑清掉）。
function keepFirstRunArtifacts(index, suffix = '') {
  const groupPort = port + index * 20;
  for (const dir of [`test-results-${groupPort}${suffix}`, `playwright-report-${groupPort}${suffix}`]) {
    const from = path.join(root, dir), kept = `${from}-first-run`;
    rmSync(kept, { recursive: true, force: true });
    if (existsSync(from)) cpSync(from, kept, { recursive: true });
  }
  if (existsSync(resultsFile(index, suffix))) cpSync(resultsFile(index, suffix), resultsFile(index, suffix).replace(/\.json$/, '-first-run.json'));
  console.log(`E2E group ${index + 1}: first-run artifacts kept in test-results-${groupPort}${suffix}-first-run/`);
}

for (const [index, code] of results.entries()) {
  if (code === 0) continue;
  keepFirstRunArtifacts(index);
  console.log(`E2E group ${index + 1}: rerunning failed tests once`);
  results[index] = await runGroup(index, ['--last-failed']);
  console.log(`E2E group ${index + 1}: rerun exit code ${results[index]}`);
}

// 模式专属回归在已退出的首组端口串行补跑：dev 的模块顺序、bundle 的真实 hash 入口都不能漏。
// 独立输出目录保留首组证据，--last-failed 也只读取本标签补跑的结果。
for (const [mode, tag] of [['dev', '@dev-modules'], ['bundle', '@bundle-entry']]) {
  const files = workbenchSupplement(groups,
    all.filter(file => readFileSync(path.join(root, 'e2e', file), 'utf8').includes(tag)), mode,
    process.env.PINPOINT_WORKBENCH_MODE);
  if (!files.length) continue;
  const options = { mode, suffix: `-${tag.slice(1)}` };
  console.log(`E2E ${tag}: ${files.join(', ')}; mode ${mode}, port ${port}`);
  let code = await runGroup(0, [...files.map(file => `e2e/${file}`), '--grep', tag], options);
  if (code !== 0) {
    keepFirstRunArtifacts(0, options.suffix);
    code = await runGroup(0, ['--last-failed', '--grep', tag], options);
    console.log(`E2E ${tag}: rerun exit code ${code}`);
  }
  results.push(code);
}
if (results.some(code => code !== 0)) process.exitCode = 1;
