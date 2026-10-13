import assert from 'node:assert/strict';
import test from 'node:test';

import { formatProjectError, isArticleError } from './project-errors.js';

test('formatProjectError: path prefix only when the error has one', () => {
  assert.equal(formatProjectError({ code: 'frontmatter', message: '值为空', path: 'articles/a/index.mdx' }), 'articles/a/index.mdx：值为空');
  assert.equal(formatProjectError({ code: 'name_collision', message: '撞名 [[x]]：…' }), '撞名 [[x]]：…');
  assert.equal(formatProjectError({ code: 'x', message: '' }), '');
});

test('isArticleError: the article directory and files under it, not a sibling with the same prefix', () => {
  assert.ok(isArticleError({ path: 'articles/a' }, 'a'));
  assert.ok(isArticleError({ path: 'articles/a/index.mdx' }, 'a'));
  assert.ok(!isArticleError({ path: 'articles/ab/index.mdx' }, 'a'));
  assert.ok(!isArticleError({ path: 'concepts/a.md' }, 'a'));
  assert.ok(!isArticleError({ message: 'no path' }, 'a'));
  assert.ok(!isArticleError(null, 'a'));
});
