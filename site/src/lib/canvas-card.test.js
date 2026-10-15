import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_SCALE, canvasHref, WORKBENCH_PATH, cardModel, DOC_WIDTHS, frameSrc, looseErrors, openCount, shellBox } from './canvas-card.js';
import { bannerErrors } from './site-errors.js';
import { articleCanvas, articlePageId } from './projects-source.js';
import { loadRegistry } from '../../../src/server/lib/registry.js';
import { listProjects } from '../../../src/server/lib/projects.js';
import { HTML_FRAME_WIDTHS } from '../../../src/shared/project-ids.js';
import { canvasViewHref, WORKBENCH_PATH as SHARED_WORKBENCH_PATH } from '../../../src/shared/workbench-url.js';

const FIX = fileURLToPath(new URL('../../fixtures/projects/', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

const canvas = {
  pageId: 'demo_payments',
  sections: [
    { id: 'flow', title: '付款前的确认', letter: 'B', frames: [{ id: 'ask', ref: 'B1' }, { id: 'confirm', ref: 'B2', title: '确认' }] },
    { id: 'mech', title: '底层', letter: 'C', shell: 'comp', frames: [{ id: 'pay-button', ref: 'C1' }] },
  ],
  errors: [{ section: 'mech', frame: 'x/y', message: '跨页' }, { message: '没有归属的错误' }],
};

test('card model: this section only, urls, meta, errors by section', () => {
  const m = cardModel(canvas, 'flow', '2');
  assert.deepEqual(m.frames.map((f) => [f.id, f.title, f.src]), [
    ['ask', 'ask', '/api/frame?page=demo_payments&screen=ask&annotate=off&embed=card'],
    ['confirm', '确认', '/api/frame?page=demo_payments&screen=confirm&annotate=off&embed=card'],
  ]);
  assert.equal(m.href, '/workbench/?page=demo_payments&section=flow');
  // The article shows numbers: the section's number, no canvas letter, no frame refs (B1 …).
  assert.equal(m.num, '2');
  assert.equal(m.meta, '2 帧');
  assert.equal('letter' in m, false);
  assert.equal(m.frames.some((f) => 'ref' in f), false);
  assert.equal(m.box.mode, 'phone');
  assert.deepEqual(m.errors, []);
  const c = cardModel(canvas, 'mech');
  assert.equal(c.meta, '1 帧');
  assert.equal(c.num, '');
  assert.equal(c.box.mode, 'natural');
  assert.deepEqual(c.errors, ['跨页']);
  assert.deepEqual(looseErrors(canvas), ['没有归属的错误']);
  assert.match(cardModel(canvas, 'nope').errors[0], /画布里没有这一节/);
  // Canvas outside any Section: articleCanvas reports it page-level (banner), the card renders nothing.
  assert.equal(cardModel(canvas, undefined).stray, true);
  assert.deepEqual(cardModel(canvas, undefined).errors, []);
  assert.equal(canvasHref('a b'), '/workbench/?page=a%20b');
  // 站点浏览器端不能 import 仓库源码：字面量与 src/shared/workbench-url.js 对账。
  assert.equal(WORKBENCH_PATH, SHARED_WORKBENCH_PATH);
  assert.equal(canvasHref('demo_pay', 'flow'), canvasViewHref('demo_pay', 'flow'));
  assert.equal(frameSrc('p', 'a&b'), '/api/frame?page=p&screen=a%26b&annotate=off&embed=card');
  assert.equal(shellBox('app').mode, 'phone');
  assert.equal(shellBox('lock').mode, 'phone');
  assert.equal(shellBox('comp').mode, 'natural');
});

test('card model: each frame sized by its own shell (frame over section)', () => {
  const mixed = { pageId: 'p', sections: [
    { id: 'card', letter: 'C', frames: [{ id: 'sheet', ref: 'C1' }, { id: 'bare', ref: 'C2', shell: 'comp' }, { id: 'gone', ref: 'C3', shell: 'comp', missing: true }] },
    { id: 'wall', letter: 'D', shell: 'comp', frames: [{ id: 'w1', ref: 'D1' }, { id: 'phone', ref: 'D2', shell: 'app' }] },
  ] };
  const card = cardModel(mixed, 'card');
  assert.equal(card.box.mode, 'phone'); // the section's own default stays a phone
  // One scale per card: the phone's (its 438 px stage shown 158 px wide); a comp frame is its own box × that scale.
  assert.deepEqual(card.frames.map((f) => [f.id, f.shell, f.box.mode, f.box.scale]), [
    ['sheet', '', 'phone', CARD_SCALE], ['bare', 'comp', 'natural', CARD_SCALE], ['gone', 'comp', 'natural', CARD_SCALE],
  ]);
  assert.equal(Math.round(card.frames[0].box.width * CARD_SCALE), 158);
  assert.deepEqual(cardModel(mixed, 'wall').frames.map((f) => [f.id, f.shell, f.box.mode]), [['w1', 'comp', 'natural'], ['phone', 'app', 'phone']]);
});

test('card model: document frames (HTML 帧) take the page width, the card gets a width switch', () => {
  const pages = { pageId: 'p', sections: [
    { id: 'pages', letter: 'B', frames: [{ id: 'long', ref: 'B1', shell: 'doc' }, { id: 'phone', ref: 'B2' }] },
    { id: 'app', letter: 'C', frames: [{ id: 'x', ref: 'C1' }] },
  ] };
  const card = cardModel(pages, 'pages');
  assert.equal(card.docWidth, 'phone');
  assert.deepEqual(card.frames.map((f) => [f.id, f.box.mode, f.box.width, f.box.height]), [['long', 'doc', 402, 874], ['phone', 'phone', 438, 910]]);
  assert.equal(cardModel(pages, 'app').docWidth, '');
  assert.deepEqual(shellBox('doc', 'desktop'), { mode: 'doc', width: 1280, height: 800, scale: CARD_SCALE });
  assert.deepEqual(shellBox('doc', 'watch'), shellBox('doc', 'phone'));
});

test('open count: open rows on this section\'s frames of this page', () => {
  const doc = { annotations: [
    { screenId: 'ask', pageId: 'p', status: 'open' },
    { screenId: 'ask' }, // no status = open, no pageId = this bucket
    { screenId: 'ask', pageId: 'p', status: 'check' },
    { screenId: 'ask', pageId: 'p', status: 'close' },
    { screenId: 'confirm', pageId: 'other', status: 'open' },
    { screenId: 'elsewhere', pageId: 'p', status: 'open' },
  ] };
  assert.equal(openCount(doc, 'p', ['ask', 'confirm']), 2);
  assert.equal(openCount(null, 'p', ['ask']), 0);
});

test('real articleCanvas: each error shown once (card or banner), missing frame keeps its tile', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-site-canvas-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: ['broken', 'demo'].map((id) => ({ id, kind: 'project', path: path.join(FIX, id) })) }));
  const registry = loadRegistry({ path: file, root: REPO, log: () => {} });

  const ok = articleCanvas('demo', 'payments', { registry });
  assert.equal(ok.pageId, articlePageId('demo', 'payments'));
  assert.equal(ok.pageId, 'demo_payments');
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(cardModel(ok, 'flow').frames.map((f) => [f.id, f.missing, f.src]), [
    ['ask', false, '/api/frame?page=demo_payments&screen=ask&annotate=off&embed=card'],
    ['confirm', false, '/api/frame?page=demo_payments&screen=confirm&annotate=off&embed=card'],
    ['confirm-card', false, '/api/frame?page=demo_payments&screen=confirm-card&annotate=off&embed=card'],
  ]);
  // articleCanvas itself keeps the canvas letters (workbench, ppnt, annotations); only the card model drops them.
  assert.deepEqual(ok.sections.map((s) => [s.id, s.letter]), [['flow', 'B'], ['mech', 'C']]);
  // confirm-card.jsx says `export const shell = "comp"`: that frame alone is a bare component in a phone section.
  assert.deepEqual(cardModel(ok, 'flow').frames.map((f) => [f.id, f.shell, f.box.mode]), [['ask', '', 'phone'], ['confirm', '', 'phone'], ['confirm-card', 'comp', 'natural']]);
  assert.equal(cardModel(ok, 'mech').shell, 'comp');

  const canvas = articleCanvas('broken', 'broken-canvas', { registry });
  const bad = cardModel(canvas, 'bad');
  // The cross-page ref is not on the canvas; the missing frame is, in its place, with no preview.
  assert.deepEqual(bad.frames.map((f) => [f.id, f.missing, f.src]), [
    ['ask', false, '/api/frame?page=broken_broken-canvas&screen=ask&annotate=off&embed=card'],
    ['gone', true, ''],
  ]);
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors[0], /^第 13 行：.*引用了别的页的帧 "browser-e2e-flow\/ask".*先把帧迁进本篇目录/);
  assert.match(bad.errors[1], /^第 13 行：.*帧 "gone" 没有源文件（本篇目录下缺 gone\.jsx 或 gone\.html）$/);
  assert.equal(cardModel(canvas, undefined).stray, true);

  // Banner: the project's errors repeat all three under articles/broken-canvas; only the page-level one is shown, once.
  // Errors of other articles and of the project itself are listed as `project "<id>": <line>`.
  // The figure with no source file: its error stays with the figure (not on the card above, not in the banner).
  assert.deepEqual(canvas.figures.map((f) => [f.index, f.id, f.section, f.missing, f.errors.map((e) => e.code)]), [[0, 'gone', 'bad', true, ['figure_missing']]]);
  const [project] = listProjects(registry).filter((p) => p.id === 'broken');
  assert.equal(project.errors.length, 4);
  const projectErrors = [
    ...project.errors,
    { code: 'frontmatter', message: '别篇的错', path: 'articles/other/index.mdx' },
    { code: 'project_json_invalid', message: 'project.json 的 title 必须是字符串' },
    // Same prefix, other article: not this article's.
    { code: 'frontmatter', message: '前缀相同的别篇', path: 'articles/broken-canvas-2/index.mdx' },
  ];
  const banner = bannerErrors('broken', projectErrors, 'broken-canvas', canvas);
  assert.deepEqual(banner, [
    'project "broken": articles/other/index.mdx：别篇的错',
    'project "broken": project.json 的 title 必须是字符串',
    'project "broken": articles/broken-canvas-2/index.mdx：前缀相同的别篇',
    '第 7 行：<Canvas> 必须写在 <Section> 里（画布按节排开）',
  ]);
  assert.deepEqual(bannerErrors('broken', project.errors, 'broken-canvas', canvas), ['第 7 行：<Canvas> 必须写在 <Section> 里（画布按节排开）']);
  // Shown once across the page: banner, the section's card, the figure (figure.js figureModel).
  const shown = [...banner, ...bad.errors, ...canvas.figures.flatMap((f) => f.errors.map((e) => e.message))];
  for (const e of project.errors) {
    assert.equal(shown.filter((x) => x === e.message).length, 1, `shown once: ${e.message}`);
  }
});

test('卡片宽度和服务端的宽度表是同一组数', () => {
  assert.equal(DOC_WIDTHS.phone.width, HTML_FRAME_WIDTHS.phone);
  assert.equal(DOC_WIDTHS.desktop.width, HTML_FRAME_WIDTHS.desktop);
});
