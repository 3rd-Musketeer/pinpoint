import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.argv.length > 2) throw new Error('Use npm run test:e2e:serial -- <options> for targeted runs.');

const root = fileURLToPath(new URL('../', import.meta.url));
const all = readdirSync(new URL('../e2e/', import.meta.url)).filter(name => name.endsWith('.spec.js')).sort();
// Balance by measured file durations. New specs automatically join the second group.
const first = new Set(['workbench.spec.js', 'review-refinements.spec.js', 'scroll-motion.spec.js',
  'dir-entry.spec.js', 'integration-canvas.spec.js', 'mixed-board.spec.js', 'url-entry.spec.js', 'page-sort.spec.js']);
const groups = [all.filter(name => first.has(name)), all.filter(name => !first.has(name))];
const port = Number(process.env.E2E_PORT || 5299);
if (!Number.isInteger(port) || port < 1024 || port > 65505) throw new Error('Invalid E2E_PORT');
const children = [];
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    process.exitCode = 1;
    for (const child of children) child.kill(signal);
  });
}
const started = Date.now();
const results = await Promise.all(groups.map((files, index) => new Promise(resolve => {
  const groupPort = port + index * 20;
  console.log(`E2E group ${index + 1}: ${files.length} files, port ${groupPort}`);
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
    ...files.map(name => `e2e/${name}`), '--workers=1'], {
    cwd: root, stdio: 'inherit', env: {...process.env, E2E_PORT: String(groupPort),
      E2E_UPSTREAM_PORT: String(groupPort + 10), PLAYWRIGHT_HTML_OPEN: 'never'},
  });
  children.push(child);
  child.once('error', error => { console.error(error); resolve(1); });
  child.once('exit', code => resolve(code ?? 1));
})));
console.log(`E2E groups finished in ${((Date.now() - started) / 1000).toFixed(1)}s; exit codes: ${results.join(', ')}`);
if (results.some(code => code !== 0)) process.exitCode = 1;
