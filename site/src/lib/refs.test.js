import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRefBody, resolveRef, extractRefs, namespaceErrors, refHtml, rawRefHtml, RAW_REF_RE, unesc } from './refs.js';

const index = new Map([
  ['demo', { names: new Map([['确认卡', { kind: 'concept' }], ['payments', { kind: 'article' }]]) }],
  ['other', { names: new Map([['收款方', { kind: 'concept' }]]) }],
]);

test('[[ ]] resolves in the current project, across projects, and falls back to an empty ref', () => {
  assert.deepEqual(parseRefBody(' 确认卡 | 那张卡 '), { target: '确认卡', label: '那张卡' });
  assert.equal(resolveRef('确认卡', 'demo', index).kind, 'concept');
  assert.equal(resolveRef('payments|付款篇', 'demo', index).label, '付款篇');
  assert.equal(resolveRef('payments', 'demo', index).kind, 'article');
  const cross = resolveRef('other:收款方', 'demo', index);
  assert.deepEqual([cross.kind, cross.project, cross.name], ['concept', 'other', '收款方']);
  const emptyCross = resolveRef('other:没有', 'demo', index);
  assert.deepEqual([emptyCross.kind, emptyCross.project, emptyCross.name], ['empty', 'other', '没有']);
  // A prefix that is not a project id is part of the name.
  const colon = resolveRef('时间:上午', 'demo', index);
  assert.deepEqual([colon.kind, colon.project, colon.name], ['empty', 'demo', '时间:上午']);
  assert.equal(resolveRef('收款方', 'demo', index).kind, 'empty');
});

test('extractRefs skips fenced and inline code, like the remark pass', () => {
  const src = 'a [[一]] `[[不算]]` b\n\n```js\nconst x = "[[也不算]]";\n```\n\n[[二|标签]]';
  assert.deepEqual(extractRefs(src), ['一', '二|标签']);
});

test('article ids and concept names share one namespace per project', () => {
  const clean = { id: 'p', articles: [{ id: 'a', file: '/a' }], concepts: [{ name: 'b', file: '/b' }] };
  assert.deepEqual(namespaceErrors(clean), []);
  const clash = { id: 'p', articles: [{ id: 'x', file: '/a/x/index.mdx' }], concepts: [{ name: 'x', file: '/c/x.md' }] };
  const errs = namespaceErrors(clash);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /"x".*\/a\/x\/index\.mdx.*\/c\/x\.md/);
  assert.match(namespaceErrors({ id: 'p', articles: [{ id: 'concepts', file: '/f' }], concepts: [] })[0], /reserved/);
});

test('ref markup escapes and round-trips the .md placeholder', () => {
  const html = refHtml({ kind: 'empty', name: '<x>', project: 'p', label: '<x>' });
  assert.match(html, /class="cref empty"/);
  assert.ok(!html.includes('<x>'));
  const link = refHtml({ kind: 'concept', name: 'c', project: 'p', label: 'c' }, { href: '/p/concepts/c/', used: [{ title: 'T"' }] });
  assert.match(link, /^<a class="cref" href="\/p\/concepts\/c\/"/);
  assert.match(link, /data-used="\[\{&quot;title&quot;:&quot;T\\&quot;&quot;\}\]"/);
  const raw = rawRefHtml('a & b|标签', 'demo');
  const m = [...raw.matchAll(RAW_REF_RE)][0];
  assert.deepEqual([unesc(m[1]), unesc(m[2])], ['a & b|标签', 'demo']);
});
