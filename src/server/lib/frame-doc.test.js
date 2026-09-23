import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FrameDocError,
  assembleFrameContent,
  framePageHtml,
  frameTokens,
  neutralizePreviewScripts,
  resolveFrameTarget,
  stripScripts,
} from './frame-doc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

// pp2：board 屏改从 dist 出 —— 懒编译与读盘都落在 PINPOINT_DATA_DIR 下，
// 指到临时目录，不写真机的 ~/.pinpoint/dist。
process.env.PINPOINT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-framedoc-'));

// 与 e2e/registry-fixture.js 对齐的极简 registry 视图（提交固件 e2e/dir-site*）。
const registry = {
  resolve(id) {
    if (id === 'e2e-dir') return { id, title: 'E2E Dir', kind: 'dir', path: path.join(ROOT, 'e2e', 'dir-site') };
    if (id === 'e2e-dir-ios') return { id, title: 'E2E Dir iOS', kind: 'dir', path: path.join(ROOT, 'e2e', 'dir-site-ios'), board: 'ios' };
    if (id === 'e2e-ios') return { id, title: 'E2E iOS', kind: 'dir', path: path.join(ROOT, 'e2e', 'ios-site'), board: 'ios' };
    if (id === 'e2e-jsx') return { id, title: 'E2E JSX', kind: 'dir', path: path.join(ROOT, 'e2e', 'jsx-site'), board: 'ios' };
    if (id === 'e2e-url') return { id, title: 'E2E Url', kind: 'url', url: 'https://example.localhost' };
    return null;
  },
};

test('resolveFrameTarget: registry ios 固件的 fragment 屏 → fragment target with canvas identity', () => {
  const target = resolveFrameTarget('e2e-ios', 'recipe', { registry });
  assert.equal(target.kind, 'fragment');
  assert.equal(target.entry, 'pinpoint');
  assert.equal(target.baseUrl, '/sites/e2e-ios/');
  assert.equal(target.shell, 'app');
  assert.equal(target.section, 'brew-flow');
  assert.equal(target.sectionLabel, '冲一杯');
  assert.equal(target.ref, 'B2'); // brew-flow 是第 2 个 section，recipe 是第 2 屏
  assert.ok(target.distTarget.pageDir.endsWith(path.join('e2e', 'ios-site')));
  assert.equal(target.distTarget.kind, 'dir');
  assert.equal(target.title, '参数（内联脚本）');
});

test('resolveFrameTarget: doc-shell screen → redirect target with the screen URL', () => {
  const target = resolveFrameTarget('e2e-dir', 'doc', { registry });
  assert.equal(target.kind, 'doc');
  assert.equal(target.url, '/sites/e2e-dir/doc.html');
});

test('resolveFrameTarget: registry ios dir entry 的页内屏改从 dist 出', () => {
  const target = resolveFrameTarget('e2e-dir-ios', 'cards', { registry });
  assert.equal(target.kind, 'fragment');
  assert.equal(target.entry, 'pinpoint');
  assert.equal(target.baseUrl, '/sites/e2e-dir-ios/');
  assert.ok(target.distTarget.pageDir.endsWith(path.join('e2e', 'dir-site-ios')));
  assert.equal(target.distTarget.kind, 'dir');
});

test('resolveFrameTarget: legacy shell "web" normalizes to doc redirect', () => {
  const target = resolveFrameTarget('e2e-dir', 'cards', { registry });
  assert.equal(target.kind, 'doc');
  assert.equal(target.url, '/sites/e2e-dir/cards.html');
});

test('resolveFrameTarget: url entry synthesizes a single doc screen', () => {
  const target = resolveFrameTarget('e2e-url', 'index', { registry });
  assert.equal(target.kind, 'doc');
  assert.equal(target.url, '/sites/e2e-url/');
});

test('resolveFrameTarget: unknown page / screen are loud', () => {
  assert.throws(() => resolveFrameTarget('nope', 'x', { registry }), (e) => e instanceof FrameDocError && e.code === 'unknown_page');
  assert.throws(() => resolveFrameTarget('e2e-ios', 'nope', { registry }), (e) => e instanceof FrameDocError && e.code === 'unknown_screen');
  assert.throws(() => resolveFrameTarget('Library', 'recipe', { registry }), (e) => e.code === 'bad_request');
  assert.throws(() => resolveFrameTarget('e2e-ios', '../escape', { registry }), (e) => e.code === 'bad_request');
});

test('assembleFrameContent wraps the fragment in the shared phone shell', async () => {
  const target = resolveFrameTarget('e2e-ios', 'recipe', { registry });
  const html = await assembleFrameContent(target);
  assert.ok(html.startsWith('<div class="ios-stage">'));
  assert.ok(html.includes('<div class="ios-screen">'));
  assert.ok(html.includes('data-preview-script'));
});

test('pp2：.jsx 屏经 /api/frame 拿到带 data-pp-id 的 HTML（dist 懒编译）', async () => {
  const target = resolveFrameTarget('e2e-jsx', 'hello', { registry });
  assert.equal(target.kind, 'fragment');
  const html = await assembleFrameContent(target);
  assert.ok(html.includes('E2E jsx-site hello'));
  assert.ok(html.includes('data-pp-id="hello.jsx:3@1"'), html);
  assert.ok(html.includes('data-pp-comp="Hello"'), html);

  // 缺源码屏：编译错误冒成 500（frame-api 把普通 Error 落 frame_failed）。
  const ghost = resolveFrameTarget('e2e-jsx', 'ghost', { registry });
  await assert.rejects(() => assembleFrameContent(ghost), /源码不存在/);
});

test('neutralizePreviewScripts makes preview scripts inert and keeps contract attrs', () => {
  const out = neutralizePreviewScripts('<script type="module" data-preview-script src="./timer.js"></script><script data-preview-script>root.x=1</script>');
  assert.ok(out.includes('type="text/x-pinpoint-preview"'));
  assert.ok(out.includes('data-preview-kind="module"'));
  assert.ok(out.includes('data-preview-src="./timer.js"'));
  assert.ok(!/<script type="module"/.test(out));
  // 非预览脚本不动
  const keep = neutralizePreviewScripts('<script>window.a=1</script>');
  assert.equal(keep, '<script>window.a=1</script>');
});

test('stripScripts removes all script tags', () => {
  assert.equal(stripScripts('<div>a</div><script>x()</script><script type="module">y()</script>'), '<div>a</div>');
});

test('framePageHtml: self-contained document with identity injection and inert preview scripts', async () => {
  const target = resolveFrameTarget('e2e-ios', 'recipe', { registry });
  const html = await framePageHtml(target, { ledger: '/index.html' });
  assert.ok(html.includes('<base href="/sites/e2e-ios/">'));
  assert.ok(html.includes('data-annotate="off"'));
  assert.ok(html.includes('/kits/ios/ios-kit.css'));
  assert.ok(html.includes('[frame-boot]'));
  assert.ok(html.includes('window.__pinpointFrame={"pageId":"e2e-ios","screenId":"recipe"'));
  assert.ok(html.includes('"section":"brew-flow"'));
  assert.ok(html.includes('window.__pinpointLedger="/index.html"'));
  assert.ok(html.includes('window.__pinpointEntry="pinpoint"'));
  assert.ok(html.includes('data-screen="recipe"'));
  assert.ok(html.includes('wb-screen-cap'));
  assert.ok(html.includes('B2'));
  // 预览脚本惰性化（防原生执行，交给 frame-boot）
  assert.ok(html.includes('type="text/x-pinpoint-preview"'));
  assert.ok(!/<script data-preview-script>/.test(html));
});

test('framePageHtml: annotate=off drops the annotate client but keeps boot mechanics', async () => {
  const target = resolveFrameTarget('e2e-ios', 'timer', { registry });
  const html = await framePageHtml(target, { annotate: false });
  assert.ok(!html.includes('/annotate.js'));
  assert.ok(!html.includes('__pinpointFrame'));
  assert.ok(html.includes('[frame-boot]'));
  assert.ok(html.includes('data-preview-mount'));
});

test('frameTokens extracts canvas geometry + color tokens from the real files', () => {
  const tokens = frameTokens();
  assert.equal(tokens['--wb-phone-w'], '438px');
  assert.equal(tokens['--wb-accent'], '#5b7fa6');
  assert.ok(tokens['--wb-cap-screen']);
  assert.ok(tokens['--wb-fg']);
});