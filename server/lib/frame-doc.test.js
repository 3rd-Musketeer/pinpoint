import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FrameDocError,
  assembleFrameContent,
  frameExportSnapshot,
  framePageHtml,
  frameTokens,
  neutralizePreviewScripts,
  resolveFrameTarget,
  stripScripts,
} from './frame-doc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// 与 e2e/registry-fixture.js 对齐的极简 registry 视图（提交固件 e2e/dir-site*）。
const registry = {
  resolve(id) {
    if (id === 'e2e-dir') return { id, title: 'E2E Dir', kind: 'dir', path: path.join(ROOT, 'e2e', 'dir-site') };
    if (id === 'e2e-dir-ios') return { id, title: 'E2E Dir iOS', kind: 'dir', path: path.join(ROOT, 'e2e', 'dir-site-ios'), board: 'ios' };
    if (id === 'e2e-url') return { id, title: 'E2E Url', kind: 'url', url: 'https://example.localhost' };
    return null;
  },
};

test('resolveFrameTarget: previews fragment screen → fragment target with canvas identity', () => {
  const target = resolveFrameTarget('library', 'recipe', { registry });
  assert.equal(target.kind, 'fragment');
  assert.equal(target.entry, 'pinpoint');
  assert.equal(target.baseUrl, '/previews/library/');
  assert.equal(target.shell, 'app');
  assert.equal(target.section, 'brew-flow');
  assert.equal(target.sectionLabel, '冲一杯');
  assert.equal(target.ref, 'B2'); // brew-flow 是第 2 个 section，recipe 是第 2 屏
  assert.ok(target.fragmentPath.endsWith(path.join('previews', 'library', 'recipe.html')));
  assert.equal(target.title, '参数（内联脚本）');
});

test('resolveFrameTarget: doc-shell screen → redirect target with the screen URL', () => {
  const target = resolveFrameTarget('doc-library', 'sample-report', { registry });
  assert.equal(target.kind, 'doc');
  assert.equal(target.url, '/previews/doc-library/sample-report.html');
});

test('resolveFrameTarget: components board resolves comp/variant ids', () => {
  const target = resolveFrameTarget('components', 'bubble/outgoing', { registry });
  assert.equal(target.kind, 'fragment');
  assert.equal(target.shell, 'comp');
  assert.ok(target.fragmentPath.endsWith(path.join('components', 'bubble', 'outgoing.html')));
});

test('resolveFrameTarget: registry ios dir entry serves fragments from disk', () => {
  const target = resolveFrameTarget('e2e-dir-ios', 'cards', { registry });
  assert.equal(target.kind, 'fragment');
  assert.equal(target.entry, 'e2e-dir-ios');
  assert.equal(target.baseUrl, '/sites/e2e-dir-ios/');
  assert.ok(target.fragmentPath.endsWith(path.join('e2e', 'dir-site-ios', 'cards.html')));
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
  assert.throws(() => resolveFrameTarget('library', 'nope', { registry }), (e) => e instanceof FrameDocError && e.code === 'unknown_screen');
  assert.throws(() => resolveFrameTarget('Library', 'recipe', { registry }), (e) => e.code === 'bad_request');
  assert.throws(() => resolveFrameTarget('library', '../escape', { registry }), (e) => e.code === 'bad_request');
});

test('assembleFrameContent wraps the fragment in the shared phone shell', async () => {
  const target = resolveFrameTarget('library', 'recipe', { registry });
  const html = await assembleFrameContent(target);
  assert.ok(html.startsWith('<div class="ios-stage">'));
  assert.ok(html.includes('<div class="ios-screen">'));
  assert.ok(html.includes('data-preview-script'));
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
  const target = resolveFrameTarget('library', 'recipe', { registry });
  const html = await framePageHtml(target, { ledger: '/index.html' });
  assert.ok(html.includes('<base href="/previews/library/">'));
  assert.ok(html.includes('data-annotate="off"'));
  assert.ok(html.includes('/kits/ios/ios-kit.css'));
  assert.ok(html.includes('[frame-boot]'));
  assert.ok(html.includes('window.__pinpointFrame={"pageId":"library","screenId":"recipe"'));
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
  const target = resolveFrameTarget('library', 'timer', { registry });
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

test('frameExportSnapshot: script-free .wb-screen payload with tokens and dim row', async () => {
  const target = resolveFrameTarget('library', 'timer', { registry });
  const snapshot = await frameExportSnapshot(target);
  assert.equal(snapshot.kind, 'frame');
  assert.equal(snapshot.pageId, 'library');
  assert.equal(snapshot.sectionId, 'brew-flow');
  assert.equal(snapshot.screenId, 'timer');
  assert.equal(snapshot.format, 'png');
  assert.equal(snapshot.scale, 2);
  assert.ok(snapshot.html.startsWith('<div class="wb-screen" data-screen="timer">'));
  assert.ok(snapshot.html.includes('wb-screen-cap'));
  assert.ok(snapshot.html.includes('402 × 874'));
  assert.ok(!/<script/.test(snapshot.html));
  assert.equal(snapshot.tokens['--wb-phone-w'], '438px');
});
