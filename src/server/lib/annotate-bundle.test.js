import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANNOTATE_BUNDLE_URL_RE,
  annotateBundleSources,
  buildAnnotateBundle,
  injectAnnotateSrc,
} from './annotate-bundle.js';

test('bundle sources: entry + shared CSS（其余源文件由 annotate.js 的 import 带入）', () => {
  const sources = annotateBundleSources();
  assert.equal(sources.length, 2);
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
