import assert from 'node:assert/strict';
import test from 'node:test';

import { escHtml } from './esc-html.js';

test('escHtml：五种字符全转，null/undefined/数字落空串或字符串化', () => {
  assert.equal(escHtml(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&#39;f');
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
  assert.equal(escHtml(42), '42');
  assert.equal(escHtml(''), '');
});
