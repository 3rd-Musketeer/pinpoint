import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @mdx-js/mdx is what @astrojs/mdx compiles with; it arrives through that dependency.
import { compile } from '@mdx-js/mdx';
import { remarkPinpoint, projectIdFor } from './remark-pinpoint.js';

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
