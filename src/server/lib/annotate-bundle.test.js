import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  ANNOTATE_BUNDLE_URL_RE,
  annotateBundleByHash,
  annotateBundleSources,
  annotateClientSrc,
  buildAnnotateBundle,
  ensureAnnotateBundle,
  injectAnnotateSrc,
} from './annotate-bundle.js';

test('bundle 固定名单：入口 + 共享 CSS（import 图由构建的 metafile 带出，不在这里手工列）', () => {
  const sources = annotateBundleSources();
  assert.equal(sources.length, 2, '固定名单只有兜底用的两个入口文件');
  assert.match(sources[0], /src\/client\/annotate\.js$/);
  assert.match(sources[1], /src\/shared\/ann-list\.css$/);
});

test('build: one self-contained minified IIFE with precompressed variants', async () => {
  const a = await buildAnnotateBundle({ minify: true });
  assert.match(a.hash, /^[0-9a-f]{10}$/);
  assert.match(a.js, /^\(\(\)=>/, 'esbuild iife wrapper');
  assert.ok(!/^import /m.test(a.js) && !/^export /m.test(a.js), 'no ESM syntax in artifact');
  // 注入别人页面是普通 <script>：产物必须是合法经典脚本（minify 不引入语法错）。
  // eslint-disable-next-line no-new-func
  new Function(a.js);
  // 预压缩版本解回来必须逐字节等于原文（serve 层直接发，不再校验）。
  const { gunzipSync, brotliDecompressSync } = await import('node:zlib');
  assert.equal(gunzipSync(a.gzip).toString('utf8'), a.js);
  assert.equal(brotliDecompressSync(a.br).toString('utf8'), a.js);
  // 压缩是真的省：产物比未压缩小，brotli 又明显小于 gzip。
  const raw = Buffer.byteLength(a.js);
  assert.ok(a.gzip.length < raw && a.br.length < a.gzip.length);
  // metafile 带出 import 图：入口、CSS 与被 import 的共享库都在失效名单里，
  // 路径是绝对路径（失效判定直接 stat）。名单会随构建更新，这里只钉覆盖面。
  for (const fragment of ['client/annotate.js', 'shared/ann-list.css', 'shared/ann-row.js', 'shared/frame-anchor.js']) {
    assert.ok(a.inputs.some((p) => p.endsWith(fragment)), `import graph covers ${fragment}`);
  }
  for (const p of a.inputs) assert.ok(path.isAbsolute(p), p);
});

test('hash route regex matches the artifact URL shape and nothing wider', () => {
  assert.deepEqual(ANNOTATE_BUNDLE_URL_RE.exec('/annotate.44bc529372.js')?.slice(1), ['44bc529372']);
  assert.equal(ANNOTATE_BUNDLE_URL_RE.test('/annotate.js'), false, '老地址不走哈希路由');
  assert.equal(ANNOTATE_BUNDLE_URL_RE.test('/annotate.abc.js'), false, '哈希长度钉死');
  assert.equal(ANNOTATE_BUNDLE_URL_RE.test('/annotate.44bc529372.js?x=1'), false, 'query 不进 pathname 匹配');
});

test('injectAnnotateSrc swaps only the ios-kit self-injection literal', () => {
  const kit = "  var s = document.createElement('script');\n    s.src = '/annotate.js';\n  s.async = true;";
  const out = injectAnnotateSrc(kit, '/annotate.44bc529372.js');
  assert.ok(out.includes("s.src = '/annotate.44bc529372.js';"), 'literal swapped');
  assert.ok(!out.includes("s.src = '/annotate.js';"), 'old literal gone');
  // 其余出现 /annotate.js 的行不动（注释、别处引用都原样）。
  const withNoise = "// fetch('/annotate.js') stays\ns.src = '/annotate.js';";
  assert.ok(injectAnnotateSrc(withNoise, '/x').includes("fetch('/annotate.js') stays"));
  // 字面量不在（kit 被改过）：原样返回，不炸 serve 路径。
  assert.equal(injectAnnotateSrc('var x = 1;', '/x'), 'var x = 1;');
});

// ---- 失效链（改源文件 → 产物换版）的进程内测试 --------------------------------
// 失效判定 stat 真实源文件，而 node --test 的各测试文件是并行进程——直接改仓内
// 源文件会打断别的进程正在做的构建（哈希漂移、注入断言错位）。所以把 src/ 拷进
// 临时目录、指 node_modules 回仓根，对副本动手：单例逻辑一字不变，改动静音。
const REPO_SRC = path.resolve(__dirname, '..', '..');

async function bundleCopyFor(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'annotate-bundle-test-'));
  fs.cpSync(REPO_SRC, path.join(tmp, 'src'), { recursive: true });
  fs.symlinkSync(path.resolve(REPO_SRC, '..', 'node_modules'), path.join(tmp, 'node_modules'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bundle = await import(pathToFileURL(path.join(tmp, 'src', 'server', 'lib', 'annotate-bundle.js')).href);
  return { bundle, srcRoot: path.join(tmp, 'src') };
}

function bumpMtime(file) {
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(file, t, t);
}

test('改被 import 的共享库 → 注入点哈希地址换版、新产物含改动', async (t) => {
  const { bundle, srcRoot } = await bundleCopyFor(t);
  const annRow = path.join(srcRoot, 'shared', 'ann-row.js');
  const orig = fs.readFileSync(annRow, 'utf8');
  const baseline = await bundle.ensureAnnotateBundle();
  const baselineSrc = bundle.annotateClientSrc();
  assert.equal(baselineSrc, `/annotate.${baseline.hash}.js`);

  fs.writeFileSync(annRow, `${orig}\nwindow.__bundleProbeLib = 'xyzzy-lib-probe';\n`);
  bumpMtime(annRow);
  // 注入点（/sites/、previews、/api/frame、ios-kit 都从这里拿地址）取地址前
  // 重验：库不在固定名单里，靠 metafile import 图覆盖。
  const nextSrc = bundle.annotateClientSrc();
  assert.notEqual(nextSrc, baselineSrc, '注入点立刻引用新哈希地址');
  const fresh = bundle.annotateBundleByHash(nextSrc.slice('/annotate.'.length, -'.js'.length));
  assert.ok(fresh, '新哈希地址有产物可取');
  assert.ok(fresh.js.includes('xyzzy-lib-probe'), '新产物包含库改动');
  assert.ok(!baseline.js.includes('xyzzy-lib-probe'), '旧产物确实没有这次改动');
});

test('同一次库改动后老地址 /annotate.js 也发新版', async (t) => {
  const { bundle, srcRoot } = await bundleCopyFor(t);
  const annStatus = path.join(srcRoot, 'shared', 'ann-status.js');
  const orig = fs.readFileSync(annStatus, 'utf8');
  await bundle.ensureAnnotateBundle();

  fs.writeFileSync(annStatus, `${orig}\nwindow.__bundleProbeLib = 'xyzzy-old-path-probe';\n`);
  bumpMtime(annStatus);
  // 老地址路由经 ensureAnnotateBundle 取产物——import 图里的库变了，这里必须
  // 拿到含改动的新版，而不是缓存里的旧产物。
  const served = await bundle.ensureAnnotateBundle();
  assert.ok(served.js.includes('xyzzy-old-path-probe'), '老地址产物包含库改动');
  assert.equal(bundle.annotateClientSrc(), `/annotate.${served.hash}.js`, '注入点与老地址是同一版');
});

test('import 图里的库被删 → 构建显式失败，注入点回退老地址而不是静默发旧版', async (t) => {
  const { bundle, srcRoot } = await bundleCopyFor(t);
  const annStatus = path.join(srcRoot, 'shared', 'ann-status.js');
  await bundle.ensureAnnotateBundle();

  fs.rmSync(annStatus);
  // 失效判定 stat 不到文件 → 按过期处理 → 真构建给出带文件名的错误。
  await assert.rejects(bundle.ensureAnnotateBundle(), /ann-status/);
  // 注入面回退老地址（那条路由对同一失败显式 500），绝不静默引用旧哈希。
  assert.equal(bundle.annotateClientSrc(), '/annotate.js');
});
