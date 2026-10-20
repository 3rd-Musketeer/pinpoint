import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  displayAddress,
  letterNumber,
  looksLikeRef,
  normalizeRefToken,
  parseAddress,
  resolveAddress,
  sectionNumberOf,
  targetCandidates,
  toPageRef,
} from './address.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { sectionLetter } from '../../src/shared/project-ids.js';

test('parseAddress：斜杠形、页 id 形、文章网址都是同一篇文章；#n 拆出来', () => {
  const article = { kind: 'article', project: 'browser-use', article: 'payment-confirm', pageId: 'browser-use_payment-confirm' };
  for (const token of [
    'browser-use/payment-confirm',
    'browser-use/payment-confirm/',
    'browser-use_payment-confirm',
    'https://pinpoint.localhost/browser-use/payment-confirm/',
    'https://pinpoint.localhost/browser-use/payment-confirm/#confirm',
    'http://127.0.0.1:5750/browser-use/payment-confirm/#overlay=confirm',
    '/browser-use/payment-confirm/',
    'https://pinpoint.localhost/workbench/?page=browser-use_payment-confirm&section=confirm',
    'https://pinpoint.localhost/?page=browser-use_payment-confirm&section=confirm',
    'https://pinpoint.localhost/index.html?page=browser-use_payment-confirm',
    '@page:browser-use_payment-confirm',
  ]) {
    assert.deepEqual(parseAddress(token), article, token);
  }
  assert.deepEqual(parseAddress('browser-use/payment-confirm#3'), { ...article, n: 3 });
  assert.deepEqual(parseAddress('browser-use_payment-confirm#3'), { ...article, n: 3 });
  assert.deepEqual(parseAddress('routine-creator'), { kind: 'id', id: 'routine-creator' });
  assert.deepEqual(parseAddress('routine-creator#12'), { kind: 'id', id: 'routine-creator', n: 12 });
  // 工作台“复制 @page”给的写法：@page:<页 id> 同页 id。
  assert.deepEqual(parseAddress('@page:routine-creator'), { kind: 'id', id: 'routine-creator' });
  assert.deepEqual(parseAddress('@page:browser-use_payment-confirm#3'), { ...article, n: 3 });
  assert.equal(parseAddress('@page:bad page'), null);
  assert.deepEqual(parseAddress('https://pinpoint.localhost/browser-use/'), { kind: 'id', id: 'browser-use' });
  // wiki 是 wiki 词条页的路由段，不是文章；三段以上的路径也不是文章网址。
  assert.equal(parseAddress('https://pinpoint.localhost/browser-use/wiki/x/'), null);
  // concepts 不再保留（改名 301 已删）：两段网址按文章解析。
  assert.deepEqual(parseAddress('https://pinpoint.localhost/browser-use/concepts/'),
    { kind: 'article', project: 'browser-use', article: 'concepts', pageId: 'browser-use_concepts' });
});

test('parseAddress / looksLikeRef：引用的样子不当目标', () => {
  for (const token of ['#3', '#3-#7', 'B', 'B3', 'AA12', 'flow:B3', '§2', '@frame:p/s', '@a:k1']) {
    assert.equal(looksLikeRef(token), true, token);
    assert.equal(parseAddress(token), null, token);
  }
  for (const token of ['p/a', 'submit-confirm', 'p_a']) assert.equal(looksLikeRef(token), false, token);
});

test('toPageRef / displayAddress：只看字面，往返一致', () => {
  assert.equal(toPageRef('p/a'), 'p_a');
  assert.equal(toPageRef('p/a#3'), 'p_a#3');
  assert.equal(toPageRef('https://pinpoint.localhost/p/a/'), 'p_a');
  assert.equal(toPageRef('legacy'), 'legacy');
  assert.equal(toPageRef('@page:p_a'), 'p_a');
  assert.equal(toPageRef('#3'), '#3', '不是目标的样子原样返回');
  assert.equal(displayAddress('p_a'), 'p/a');
  assert.equal(displayAddress('legacy'), 'legacy');
  assert.equal(displayAddress(toPageRef('p/a')), 'p/a');
});

test('normalizeRefToken / letterNumber / sectionNumberOf：§n 是第 n 个字母，与 sectionLetter 互逆', () => {
  assert.equal(normalizeRefToken('§1'), 'A');
  assert.equal(normalizeRefToken('§2'), 'B');
  assert.equal(normalizeRefToken('§27'), 'AA');
  assert.equal(normalizeRefToken('p/a#3'), 'p_a#3');
  assert.equal(normalizeRefToken('B1'), 'B1');
  assert.equal(normalizeRefToken('submit-confirm'), 'submit-confirm');
  for (const n of [1, 2, 26, 27, 52, 53, 702, 703]) assert.equal(letterNumber(sectionLetter(n - 1)), n);
  assert.equal(letterNumber('b'), null);
  assert.equal(sectionNumberOf('§12'), 12);
  assert.equal(sectionNumberOf('§0'), null);
  assert.equal(sectionNumberOf('B'), null);
});

function fixtureRegistry(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppnt-address-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'proj');
  fs.mkdirSync(path.join(root, 'docs', 'pinpoint', 'articles', 'notes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id: 'demo', title: 'Demo' }));
  fs.writeFileSync(path.join(root, 'docs', 'pinpoint', 'articles', 'notes', 'index.mdx'), '---\ntitle: N\n---\n');
  fs.mkdirSync(path.join(dir, 'page'));
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
    { id: 'legacy', kind: 'dir', path: path.join(dir, 'page') },
    // 老登记表里残留的 url 条目：按不合法 kind 报错并跳过，不进候选。
    { id: 'site', kind: 'url', url: 'https://example.com' },
    { id: 'demo', kind: 'project', path: root },
  ] }));
  return loadRegistry({ root: dir, path: file, log: () => {} });
}

test('resolveAddress：文章、project、存量页、不在的文章、什么都不是', (t) => {
  const registry = fixtureRegistry(t);
  const ctx = { registry, manifestIds: ['example'] };
  const article = resolveAddress('demo/notes', ctx);
  assert.equal(article.kind, 'article');
  assert.equal(article.pageId, 'demo_notes');
  assert.equal(article.address, 'demo/notes');
  assert.equal(resolveAddress('demo_notes#2', ctx).n, 2);
  assert.deepEqual(resolveAddress('demo', ctx), { kind: 'project', projectId: 'demo', address: 'demo' });
  assert.deepEqual(resolveAddress('legacy', ctx), { kind: 'page', pageId: 'legacy', address: 'legacy' });
  assert.deepEqual(resolveAddress('example', ctx), { kind: 'page', pageId: 'example', address: 'example' });
  const missing = resolveAddress('demo/ghost', ctx);
  assert.equal(missing.kind, 'missing-article');
  assert.equal(missing.projectKnown, true);
  assert.equal(resolveAddress('nope/ghost', ctx).projectKnown, false);
  assert.equal(resolveAddress('nothing', ctx), null);
  assert.equal(resolveAddress('B3', ctx), null);
});

test('targetCandidates：文章打斜杠形，存量页打 id；残留的 url 条目和 project 自己不算目标', (t) => {
  const registry = fixtureRegistry(t);
  const rows = targetCandidates({ registry, manifestIds: ['example'], articlesOf: () => ['notes'] });
  assert.deepEqual(rows.map((row) => row.address), ['demo/notes', 'legacy', 'example']);
});
