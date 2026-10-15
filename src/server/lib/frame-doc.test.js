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
  markEmbedStage,
  frameTokens,
  neutralizePreviewScripts,
  resolveFrameTarget,
} from './frame-doc.js';
import { ensureAnnotateBundle } from './annotate-bundle.js';
import frameApi from '../frame-api.js';
import { mockReq, mockRes } from '../test-harness.js';

// 注入断言盯的是构建产物的哈希地址（审计 B3）—— 先把产物编出来。
await ensureAnnotateBundle();

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
    return null;
  },
};

test('存量 src 帧：真实文件须留在被引用条目的登记根内，API 不返回越界正文', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-frame-boundary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const legacy = path.join(dir, 'legacy');
  const other = path.join(dir, 'other');
  fs.mkdirSync(legacy);
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(dir, 'private.txt'), 'UNREGISTERED_SECRET_C');
  fs.writeFileSync(path.join(other, 'safe.html'), '<p>跨登记条目可读</p>');
  fs.symlinkSync(path.join(dir, 'private.txt'), path.join(legacy, 'link.html'));
  fs.symlinkSync(path.join(other, 'safe.html'), path.join(legacy, 'cross.html'));
  fs.symlinkSync(other, path.join(dir, 'alias'));
  fs.writeFileSync(path.join(legacy, 'board.json'), JSON.stringify({ sections: [{ id: 's', shell: 'app', screens: [
    { id: 'leak', src: 'sites/legacy/link.html' },
    { id: 'cross-link', src: 'sites/legacy/cross.html' },
    { id: 'safe', src: 'sites/other/safe.html' },
    { id: 'alias', src: 'sites/alias/safe.html' },
    { id: 'exact', src: 'sites/exact/link.html' },
    { id: 'sibling', src: 'sites/exact/board.json' },
  ] }] }));
  const entries = [
    { id: 'legacy', kind: 'dir', path: legacy },
    { id: 'other', kind: 'dir', path: other },
    { id: 'alias', kind: 'dir', path: path.join(dir, 'alias') },
    { id: 'exact', kind: 'file', path: path.join(legacy, 'link.html') },
  ];
  const localRegistry = { entries, resolve: (id) => entries.find((entry) => entry.id === id) };
  let middleware;
  frameApi({ registry: localRegistry }).configureServer({ middlewares: { use: (fn) => { middleware = fn; } } });
  for (const screen of ['leak', 'cross-link', 'sibling']) {
    const res = mockRes();
    await middleware(mockReq('GET', `/api/frame?page=legacy&screen=${screen}&annotate=off`), res, () => {});
    assert.equal(res.statusCode, 404, screen);
    assert.ok(!res.text.includes('UNREGISTERED_SECRET_C'));
    assert.throws(() => resolveFrameTarget('legacy', screen, { registry: localRegistry }), FrameDocError);
  }
  for (const screen of ['safe', 'alias', 'exact']) {
    const html = await framePageHtml(resolveFrameTarget('legacy', screen, { registry: localRegistry }), { annotate: false });
    assert.ok(html.includes(screen === 'exact' ? 'UNREGISTERED_SECRET_C' : '跨登记条目可读'));
  }
});

test('模板 src 帧：根内文件可读，symlink 指出 previews 根时拒绝', (t) => {
  const dir = fs.mkdtempSync(path.join(ROOT, 'content/previews/.boundary-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-template-outside-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'safe.html'), '<p>模板正文</p>');
  fs.writeFileSync(path.join(outside, 'private.html'), 'UNREGISTERED_SECRET_C');
  fs.symlinkSync(path.join(outside, 'private.html'), path.join(dir, 'link.html'));
  const pageId = 'boundary-template';
  const readFile = fs.readFileSync;
  // 只替换模板清单与板定义，不改仓内模板；帧文件仍走真实磁盘和 realpath。
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === path.join(ROOT, 'content/previews/_index.json')) return JSON.stringify({ pages: [{ id: pageId }] });
    if (file === path.join(ROOT, 'content/previews', pageId, 'board.json')) return JSON.stringify({ sections: [{ id: 's', shell: 'app', screens: [
      { id: 'safe', src: `previews/${path.basename(dir)}/safe.html` },
      { id: 'leak', src: `previews/${path.basename(dir)}/link.html` },
    ] }] });
    return readFile(file, ...args);
  });
  const safe = resolveFrameTarget(pageId, 'safe');
  assert.equal(fs.readFileSync(safe.fragmentPath, 'utf8'), '<p>模板正文</p>');
  assert.throws(() => resolveFrameTarget(pageId, 'leak'), (error) => error instanceof FrameDocError && error.code === 'unknown_screen');
});

test('resolveFrameTarget: registry ios 固件的 fragment 屏 → fragment target with canvas identity', () => {
  const target = resolveFrameTarget('e2e-ios', 'recipe', { registry });
  assert.equal(target.kind, 'fragment');
  assert.equal(target.entry, 'e2e-ios', '帧标注住所属页的桶（storage-unify）');
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
  assert.equal(target.entry, 'e2e-dir-ios');
  assert.equal(target.baseUrl, '/sites/e2e-dir-ios/');
  assert.ok(target.distTarget.pageDir.endsWith(path.join('e2e', 'dir-site-ios')));
  assert.equal(target.distTarget.kind, 'dir');
});

test('resolveFrameTarget: doc shell screen redirects to its page', () => {
  const target = resolveFrameTarget('e2e-dir', 'cards', { registry });
  assert.equal(target.kind, 'doc');
  assert.equal(target.url, '/sites/e2e-dir/cards.html');
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

test('framePageHtml: self-contained document with identity injection and inert preview scripts', async () => {
  const target = resolveFrameTarget('e2e-ios', 'recipe', { registry });
  const html = await framePageHtml(target, {});
  assert.ok(html.includes('<base href="/sites/e2e-ios/">'));
  assert.ok(html.includes('data-annotate="off"'));
  assert.ok(html.includes('/kits/ios/ios-kit.css'));
  assert.ok(html.includes('[frame-boot]'));
  assert.ok(html.includes('window.__pinpointFrame={"pageId":"e2e-ios","screenId":"recipe"'));
  assert.ok(html.includes('"section":"brew-flow"'));
  // storage-unify：entry = 帧所属页；不再注入 __pinpointLedger（帧账本恒 @canvas，
  // 客户端按 FRAME 身份自取）。
  assert.ok(!html.includes('__pinpointLedger'));
  assert.ok(html.includes('window.__pinpointEntry="e2e-ios"'));
  assert.ok(html.includes('data-screen="recipe"'));
  assert.ok(html.includes('wb-screen-cap'));
  assert.ok(html.includes('B2'));
  // 客户端标签引用构建产物的内容哈希地址（审计 B3）。
  assert.match(html, /<script src="\/annotate\.[0-9a-f]{10}\.js" async><\/script>/);
  // 预览脚本惰性化（防原生执行，交给 frame-boot）
  assert.ok(html.includes('type="text/x-pinpoint-preview"'));
  assert.ok(!/<script data-preview-script>/.test(html));
});

test('framePageHtml: annotate=off drops the annotate client but keeps boot mechanics', async () => {
  const target = resolveFrameTarget('e2e-ios', 'timer', { registry });
  const html = await framePageHtml(target, { annotate: false });
  // 哈希地址与老地址都不许出现。
  assert.ok(!/<script src="\/annotate/.test(html));
  assert.ok(!html.includes('__pinpointFrame'));
  assert.ok(html.includes('[frame-boot]'));
  assert.ok(html.includes('data-preview-mount'));
});

test('framePageHtml embed=card: stage + device markers, no caption, no annotate client (site card / overlay contract)', async () => {
  const phone = await framePageHtml(resolveFrameTarget('e2e-ios', 'recipe', { registry }), { embed: 'card' });
  assert.match(phone, /<html data-annotate="off" data-pp-embed="card">/);
  assert.equal((phone.match(/data-pp-stage=/g) || []).length, 1);
  assert.match(phone, /<div class="ios-stage" data-pp-stage="phone">/);
  assert.match(phone, /<div class="ios-device" data-pp-device>/);
  assert.ok(!phone.includes('class="wb-screen-cap"'));
  assert.ok(!/<script src="\/annotate/.test(phone));
  assert.ok(!phone.includes('__pinpointFrame'));
  // Without embed the frame page is unchanged: caption, no markers.
  const plain = await framePageHtml(resolveFrameTarget('e2e-ios', 'recipe', { registry }), { annotate: false });
  assert.ok(plain.includes('class="wb-screen-cap"'));
  assert.ok(!plain.includes('data-pp-stage') && !plain.includes('data-pp-device'));
});

test('markEmbedStage: first stage only, comp kind, attributes added without touching structure', () => {
  assert.equal(markEmbedStage('<div class="wb-comp-stage"><div class="ios-root">x</div></div>'),
    '<div class="wb-comp-stage" data-pp-stage="comp"><div class="ios-root">x</div></div>');
  assert.equal(markEmbedStage('<div id="a" class="x ios-stage y" style="z"><div class="ios-device"></div><div class="ios-stage"></div></div>'),
    '<div id="a" class="x ios-stage y" style="z" data-pp-stage="phone"><div class="ios-device" data-pp-device></div><div class="ios-stage"></div></div>');
  assert.equal(markEmbedStage('<p class="ios-stage">no div</p>'), '<p class="ios-stage">no div</p>');
});

test('frameTokens extracts canvas geometry + color tokens from the real files', () => {
  const tokens = frameTokens();
  assert.equal(tokens['--wb-phone-w'], '438px');
  assert.equal(tokens['--wb-accent'], '#008564');
  assert.ok(tokens['--wb-cap-screen']);
  assert.ok(tokens['--wb-fg']);
});
