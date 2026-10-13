import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canvasHref, cardModel, frameSrc, looseErrors, openCount, shellBox } from './canvas-card.js';
import { canvasFromMdx } from './canvas-stub.js';

const canvas = {
  pageId: 'demo--payments',
  sections: [
    { id: 'flow', title: '付款前的确认', letter: 'B', frames: [{ id: 'ask', ref: 'B1' }, { id: 'confirm', ref: 'B2', title: '确认' }] },
    { id: 'mech', title: '底层', letter: 'C', shell: 'comp', frames: [{ id: 'pay-button', ref: 'C1' }] },
  ],
  errors: [{ section: 'mech', frame: 'x/y', message: '跨页' }, '没有归属的错误'],
};

test('card model: this section only, urls, meta, errors by section', () => {
  const m = cardModel(canvas, 'flow');
  assert.deepEqual(m.frames.map((f) => [f.ref, f.title, f.src]), [
    ['B1', 'ask', '/api/frame?page=demo--payments&screen=ask&annotate=off'],
    ['B2', '确认', '/api/frame?page=demo--payments&screen=confirm&annotate=off'],
  ]);
  assert.equal(m.href, '/?page=demo--payments&section=flow');
  assert.equal(m.meta, 'B1–B2 · 2 帧');
  assert.equal(m.box.mode, 'phone');
  assert.deepEqual(m.errors, []);
  const c = cardModel(canvas, 'mech');
  assert.equal(c.meta, 'C1 · 1 帧');
  assert.equal(c.box.mode, 'natural');
  assert.deepEqual(c.errors, ['跨页']);
  assert.deepEqual(looseErrors(canvas), ['没有归属的错误']);
  assert.match(cardModel(canvas, 'nope').errors[0], /画布里没有这一节/);
  assert.match(cardModel(canvas, undefined).errors[0], /要写在 <Section> 里/);
  assert.equal(canvasHref('a b'), '/?page=a%20b');
  assert.equal(frameSrc('p', 'a&b'), '/api/frame?page=p&screen=a%26b&annotate=off');
  assert.equal(shellBox('app').mode, 'phone');
  assert.equal(shellBox('lock').mode, 'phone');
  assert.equal(shellBox('comp').mode, 'natural');
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

test('stub: sections with a Canvas, refs, shell, cross-page and missing frames', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-site-canvas-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of ['a', 'b', 'c']) fs.writeFileSync(path.join(dir, `${f}.jsx`), 'export default () => null;');
  const src = [
    '<Canvas frames={["a"]} />',
    '<Section id="intro" title="开头">\n\n文字\n\n</Section>',
    '<Section id="flow" title="流程">\n\n<Canvas frames={["a", "page/x", "gone", "b"]} />\n\n</Section>',
    '<Section id="lib">\n\n<Canvas shell="comp" frames={["c"]} />\n\n<Canvas frames={["a"]} />\n\n</Section>',
    '<Section id="bad">\n\n<Canvas frames={list} />\n\n</Section>',
  ].join('\n\n');
  const r = canvasFromMdx(src, dir);
  assert.deepEqual(r.sections, [
    { id: 'flow', title: '流程', letter: 'B', frames: [{ id: 'a', ref: 'B1' }, { id: 'b', ref: 'B2' }] },
    { id: 'lib', title: 'lib', letter: 'C', shell: 'comp', frames: [{ id: 'c', ref: 'C1' }] },
    { id: 'bad', title: 'bad', letter: 'D', frames: [] },
  ]);
  assert.deepEqual(r.errors.map((e) => `${e.section}:${e.frame || ''}`), ['flow:page/x', 'flow:gone', 'lib:', 'bad:']);
  assert.match(r.errors[0].message, /先把帧迁进本篇目录/);
  assert.match(r.errors[1].message, /没有 gone\.jsx/);
});
