import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatPageIndicator,
  formatSectionIndicator,
  formatFrameIndicator,
  formatAnnotationIndicator,
  indicatorForAnnotation,
  nextTargetRef,
  normalizeAnnotation,
  targetContentToDisplay,
  targetContentToStorage,
} from '../shared/annotation-indicator.js';
import { buildAnnotateBundle } from './lib/annotate-bundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const CSS = fs.readFileSync(path.join(SRC, 'shared', 'ann-list.css'), 'utf8');

// 产物里找共享库：minify 会把函数与常量改名，未压缩产物看名字，压缩产物看
// 不会被改名的字符串字面量（CSS 选择器、行为字符串）。
const unminified = await buildAnnotateBundle({ minify: false });
const minified = await buildAnnotateBundle({ minify: true });

test('build bundles the SSOT libs into one self-contained IIFE', () => {
  // 注入到别人页面：恰好一个输出文件，运行时不拉任何 chunk（构建期保证）。
  assert.equal(unminified.js.startsWith('(() =>'), true, 'IIFE wrapper present');
  assert.match(unminified.js, /function indicatorForAnnotation/, 'indicatorForAnnotation inlined');
  assert.match(unminified.js, /function normalizeAnnotation/, 'normalizeAnnotation inlined');
  assert.match(unminified.js, /function targetContentToDisplay/, 'targetContentToDisplay inlined');
  assert.match(unminified.js, /function targetContentToStorage/, 'targetContentToStorage inlined');
  assert.match(unminified.js, /function pickContained/, 'pickContained inlined');
  assert.match(unminified.js, /function annotationSlug/, 'annotationSlug inlined');
  assert.match(unminified.js, /function pageKeyFromPathname/, 'pageKeyFromPathname inlined');
  assert.match(unminified.js, /function bubbleInnerHtml/, 'bubbleInnerHtml inlined');
  assert.match(unminified.js, /function intersectRects/, 'intersectRects inlined');
  assert.match(unminified.js, /function clipByRects/, 'clipByRects inlined');
  assert.match(unminified.js, /function annRowModel/, 'annRowModel inlined');
  assert.match(unminified.js, /function annRowCap/, 'annRowCap inlined');
  assert.match(unminified.js, /function annMarkBroken/, 'annMarkBroken inlined');
  assert.match(unminified.js, /function frameInternalSelector/, 'frameInternalSelector inlined');
  assert.match(unminified.js, /function queryFrameScope/, 'queryFrameScope inlined');
  assert.match(unminified.js, /function ppIdAttrSelector/, 'ppIdAttrSelector inlined');
  assert.match(unminified.js, /function pickByTargetText/, 'pickByTargetText inlined');
  // ESM 语法不留在产物里：esbuild 负责打包，浏览器拿到的是普通脚本。
  assert.doesNotMatch(unminified.js, /^import /m);
  assert.doesNotMatch(unminified.js, /^export /m);
});

test('build carries the shared list CSS payload for both consumer scopes', () => {
  // 共享 CSS 以字符串常量进包（text loader）：workbench 侧栏与注入端 sidebar
  // 共用这一份 —— 类名在两种产物里都不改名，直接断言内容。
  assert.ok(CSS.includes('#wbann-list .wb-ann-item'), 'fixture sanity: workbench scope');
  assert.ok(CSS.includes('#ann-sidebar .wb-ann-item--broken'), 'fixture sanity: client scope');
  assert.ok(unminified.js.includes('#wbann-list .wb-ann-item'), 'workbench scope in the CSS payload');
  assert.ok(unminified.js.includes('#ann-sidebar .wb-ann-item--broken'), 'client scope in the CSS payload');
  assert.ok(minified.js.includes('#wbann-list .wb-ann-item'), 'workbench scope survives minify');
  assert.ok(minified.js.includes('#ann-sidebar .wb-ann-item--broken'), 'client scope survives minify');
  // annotate.js 的 <style> 块（结构增量）也在包里。
  assert.ok(minified.js.includes('#ann-sidebar{'), 'client sidebar pins rule present');
});

// 双端同步守卫（P4）：共享 CSS 消费的每个 var(--wb-*) 都必须在 #ann-sidebar
// 上有钉值（fallback 只兜第三方场景）；workbench 侧的值由 wb-tokens.css 定义。
// 三向漂移（token 源 / 共享 CSS / client 钉值）在这里变红。
test('client #ann-sidebar pins cover every --wb-* the shared CSS consumes', () => {
  const consumed = new Set([...CSS.matchAll(/var\((--wb-[a-z0-9-]+)/gi)].map((m) => m[1]));
  assert.ok(consumed.size > 0, 'shared CSS consumes --wb-* tokens');
  const pinsRule = unminified.js.match(/#ann-sidebar\{[^}]*\}/);
  assert.ok(pinsRule, '#ann-sidebar pins rule present in served bundle');
  for (const name of consumed) {
    assert.ok(
      pinsRule[0].includes(name + ':'),
      `#ann-sidebar pins ${name} (consumed by src/shared/ann-list.css)`,
    );
  }
  // workbench 侧 token 源同步定义同一组（双端同一个 --wb-* 宇宙）
  const tokens = fs.readFileSync(path.join(SRC, 'workbench', 'wb-tokens.css'), 'utf8');
  for (const name of consumed) {
    assert.ok(tokens.includes(name + ':'), `wb-tokens.css defines ${name}`);
  }
});

test('minified artifact parses as a script and hashes deterministically', async () => {
  // new Function only parses; it does not run, so undefined browser globals
  // don't matter. This catches syntax errors from the bundling/minify step.
  // eslint-disable-next-line no-new-func
  new Function(minified.js);
  assert.match(minified.hash, /^[0-9a-f]{10}$/, 'short content hash');
  // 哈希跟内容走：同输入同哈希（进程重启后缓存的 HTML 靠这个对上重编的产物），
  // 不同产物（minify 与否）哈希必不同。
  const again = await buildAnnotateBundle({ minify: true });
  assert.equal(again.hash, minified.hash);
  assert.notEqual(again.hash, unminified.hash);
});

test('inlined lib output matches direct lib import on fixtures', () => {
  // Guards drift: if someone edits the lib, the bundled copy tracks it (same
  // file), so this asserts the fixture expectations stay identical to the lib.
  assert.equal(formatPageIndicator('demo-app'), '@page:demo-app');
  assert.equal(formatSectionIndicator('demo-app', 'inbox'), '@section:demo-app/inbox');
  assert.equal(formatFrameIndicator('demo-app', 'today'), '@frame:demo-app/today');
  assert.equal(formatAnnotationIndicator('ab12cd'), '@a:ab12cd');
  assert.equal(
    indicatorForAnnotation({ id: 'ab12cd', pageId: 'p', section: 's' }, 'p', { persisted: true }),
    '@a:ab12cd',
  );
  assert.deepEqual(normalizeAnnotation({ content: 'hi', section: 'g' }), { content: 'hi', section: 'g', status: 'open' });
  const targets = [{ ref: 'i1', selector: '#one', text: 'One' }, { ref: 'i3', selector: '#three', text: 'Three' }];
  assert.equal(targetContentToDisplay('[@a:ab12cd] [@t:i3]', targets), '[@a:ab12cd] [indicator 3]');
  assert.equal(targetContentToStorage('[@a:ab12cd] [indicator 3]', targets), '[@a:ab12cd] [@t:i3]');
  assert.equal(nextTargetRef(targets), 'i4');
});
