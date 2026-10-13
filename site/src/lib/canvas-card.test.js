import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bannerErrors, CARD_SCALE, canvasHref, cardModel, frameSrc, looseErrors, openCount, shellBox } from './canvas-card.js';
import { articleCanvas, articlePageId } from './canvas-source.js';
import { loadRegistry } from '../../../src/server/lib/registry.js';
import { listProjects } from '../../../src/server/lib/projects.js';

const FIX = fileURLToPath(new URL('../../fixtures/projects/', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

const canvas = {
  pageId: 'demo_payments',
  sections: [
    { id: 'flow', title: '付款前的确认', letter: 'B', frames: [{ id: 'ask', ref: 'B1' }, { id: 'confirm', ref: 'B2', title: '确认' }] },
    { id: 'mech', title: '底层', letter: 'C', shell: 'comp', frames: [{ id: 'pay-button', ref: 'C1' }] },
  ],
  errors: [{ section: 'mech', frame: 'x/y', message: '跨页' }, '没有归属的错误'],
};

test('card model: this section only, urls, meta, errors by section', () => {
  const m = cardModel(canvas, 'flow');
  assert.deepEqual(m.frames.map((f) => [f.ref, f.title, f.src]), [
    ['B1', 'ask', '/api/frame?page=demo_payments&screen=ask&annotate=off&embed=card'],
    ['B2', '确认', '/api/frame?page=demo_payments&screen=confirm&annotate=off&embed=card'],
  ]);
  assert.equal(m.href, '/?page=demo_payments&section=flow');
  assert.equal(m.meta, 'B1–B2 · 2 帧');
  assert.equal(m.box.mode, 'phone');
  assert.deepEqual(m.errors, []);
  const c = cardModel(canvas, 'mech');
  assert.equal(c.meta, 'C1 · 1 帧');
  assert.equal(c.box.mode, 'natural');
  assert.deepEqual(c.errors, ['跨页']);
  assert.deepEqual(looseErrors(canvas), ['没有归属的错误']);
  assert.match(cardModel(canvas, 'nope').errors[0], /画布里没有这一节/);
  // Canvas outside any Section: articleCanvas reports it page-level (banner), the card renders nothing.
  assert.equal(cardModel(canvas, undefined).stray, true);
  assert.deepEqual(cardModel(canvas, undefined).errors, []);
  assert.equal(canvasHref('a b'), '/?page=a%20b');
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
  assert.deepEqual(cardModel(ok, 'flow').frames.map((f) => [f.ref, f.id, f.missing, f.src]), [
    ['B1', 'ask', false, '/api/frame?page=demo_payments&screen=ask&annotate=off&embed=card'],
    ['B2', 'confirm', false, '/api/frame?page=demo_payments&screen=confirm&annotate=off&embed=card'],
    ['B3', 'confirm-card', false, '/api/frame?page=demo_payments&screen=confirm-card&annotate=off&embed=card'],
  ]);
  // confirm-card.jsx says `export const shell = "comp"`: that frame alone is a bare component in a phone section.
  assert.deepEqual(cardModel(ok, 'flow').frames.map((f) => [f.id, f.shell, f.box.mode]), [['ask', '', 'phone'], ['confirm', '', 'phone'], ['confirm-card', 'comp', 'natural']]);
  assert.equal(cardModel(ok, 'mech').shell, 'comp');

  const canvas = articleCanvas('broken', 'broken-canvas', { registry });
  const bad = cardModel(canvas, 'bad');
  // The cross-page ref is not on the canvas; the missing frame is, numbered, with no preview.
  assert.deepEqual(bad.frames.map((f) => [f.ref, f.id, f.missing, f.src]), [
    ['A1', 'ask', false, '/api/frame?page=broken_broken-canvas&screen=ask&annotate=off&embed=card'],
    ['A2', 'gone', true, ''],
  ]);
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors[0], /^第 13 行：.*引用了别的页的帧 "browser-e2e-flow\/ask".*先把帧迁进本篇目录/);
  assert.match(bad.errors[1], /^第 13 行：.*帧 "gone" 没有源文件（本篇目录下缺 gone\.jsx）$/);
  assert.equal(cardModel(canvas, undefined).stray, true);

  // Banner: the project's errors repeat all three with the article prefix; only the page-level one is shown, once.
  // The site's p.errors carries them as loadProjects writes them: `project "<id>": <listProjects line>`.
  const [project] = listProjects(registry).filter((p) => p.id === 'broken');
  assert.equal(project.errors.length, 3);
  const siteErrors = [...project.errors, 'articles/other/index.mdx：别篇的错', 'project.json 的 title 必须是字符串'].map((e) => `project "broken": ${e}`);
  const banner = bannerErrors(siteErrors, 'broken-canvas', canvas);
  assert.deepEqual(banner, [
    'project "broken": articles/other/index.mdx：别篇的错',
    'project "broken": project.json 的 title 必须是字符串',
    '第 7 行：<Canvas> 必须写在 <Section> 里（画布按节排开）',
  ]);
  assert.deepEqual(bannerErrors(project.errors, 'broken-canvas', canvas), ['第 7 行：<Canvas> 必须写在 <Section> 里（画布按节排开）']);
  const shown = [...banner, ...bad.errors];
  for (const e of project.errors) {
    assert.equal(shown.filter((x) => e.endsWith(x)).length, 1, `shown once: ${e}`);
  }
});
