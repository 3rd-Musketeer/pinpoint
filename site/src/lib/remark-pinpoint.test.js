import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @mdx-js/mdx is what @astrojs/mdx compiles with; it arrives through that dependency.
import { compile } from '@mdx-js/mdx';
import { remarkPinpoint, projectIdFor } from './remark-pinpoint.js';
import { parseArticleCanvas } from '../../../src/server/lib/article-canvas.js';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-site-remark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'docs', 'pinpoint');
  fs.mkdirSync(path.join(dir, 'articles', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ id: 'demo', title: 'Demo' }));
  return path.join(dir, 'articles', 'a', 'index.mdx');
}

const run = (value, file) => compile({ value, path: file }, { remarkPlugins: [remarkPinpoint] }).then(String);

test('sections get letters in order and refs become <Ref raw from>', async (t) => {
  const file = project(t);
  assert.equal(projectIdFor(file), 'demo');
  const out = await run('前言 [[确认卡]] 和 `[[代码]]`。\n\n<Section id="one" title="一">\n\n文字 [[other:x|标签]]\n\n</Section>\n\n<Section id="two">\n\nb\n\n</Section>\n', file);
  assert.match(out, /letter: "A"/);
  assert.match(out, /letter: "B"/);
  assert.match(out, /raw: "确认卡"/);
  assert.match(out, /raw: "other:x\|标签"/);
  assert.match(out, /from: "demo"/);
  assert.doesNotMatch(out, /raw: "代码"/);
});

test('a Canvas gets the id of its Section; one outside a Section gets none', async (t) => {
  const file = project(t);
  const out = await run('<Canvas frames={["x"]} section="wrong" />\n\n<Section id="flow">\n\n<Canvas frames={["a"]} />\n\n</Section>\n', file);
  const calls = [...out.matchAll(/_jsx\(Canvas, \{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  assert.equal(calls.length, 2, out);
  assert.doesNotMatch(calls[0], /section:/);
  assert.match(calls[1], /section: "flow"/);
});

test('bad sections fail with the file path', async (t) => {
  const file = project(t);
  await assert.rejects(run('<Section id="x">a</Section>\n\n<Section id="x">b</Section>', file), (e) => e.message.includes(file) && /duplicate <Section id="x">/.test(e.message));
  await assert.rejects(run('<Section title="no id">a</Section>', file), /needs a literal id/);
  await assert.rejects(run('<Section id="a">\n\n<Section id="b">x</Section>\n\n</Section>', file), /cannot be nested/);
});

test('files outside a project are left alone', async () => {
  const out = await run('[[x]]', path.join(os.tmpdir(), 'not-a-project', 'x.mdx'));
  assert.doesNotMatch(out, /raw: "x"/);
});

test('heading letters agree with the canvas the service derives from the same text', async (t) => {
  const file = project(t);
  const text = [
    '---', 'title: T', '---', '',
    '<Section id="why">', '', '纯文字。', '', '</Section>', '',
    '<div>', '<Section id="flow">', '', '<Canvas frames={["a"]} />', '', '</Section>', '</div>', '',
    '<Section id="mech" title="底层">', '', '<Canvas frames={["b"]} shell="comp" />', '', '</Section>', '',
  ].join('\n');
  const out = await run(text, file);
  const letters = [...out.matchAll(/letter: "([A-Z]+)"/g)].map((m) => m[1]);
  const canvas = parseArticleCanvas(text);
  assert.deepEqual(canvas.errors, []);
  assert.deepEqual(letters, ['A', 'B', 'C']);
  assert.deepEqual(canvas.sections.map((s) => [s.id, s.articleLetter]), [['flow', 'B'], ['mech', 'C']]);
  const calls = [...out.matchAll(/_jsx\(Canvas, \{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  assert.match(calls[0], /section: "flow"/);
  assert.match(calls[1], /section: "mech"/);
});
