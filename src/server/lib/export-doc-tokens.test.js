import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countDocTokens,
  estimateDocTokens,
  formatTokenCount,
  prepareDocTextForTokens,
} from './export-doc-tokens.js';

test('token estimates strip CSS only for html-no-css mode', () => {
  const html = '<!doctype html><style>.x{color:red}</style><main>你好 world</main>';
  const full = prepareDocTextForTokens(html, 'html-full');
  const bare = prepareDocTextForTokens(html, 'html-no-css');
  assert.match(full, /<style/);
  assert.equal(bare.includes('<style'), false);
  assert.match(bare, /你好 world/);
});

test('counts expose gemini / openai / anthropic with stable positive integers', () => {
  const counts = countDocTokens('主 Chat 自发输入最常见的是个性化建议');
  assert.equal(typeof counts.gemini, 'number');
  assert.equal(typeof counts.openai, 'number');
  assert.equal(typeof counts.anthropic, 'number');
  assert.ok(counts.gemini > 0);
  assert.ok(counts.openai > 0);
  assert.ok(counts.anthropic > 0);
});

test('estimateDocTokens formats provider rows for the dialog', () => {
  const estimate = estimateDocTokens('<p>hello</p><style>a{}</style>', 'html-no-css');
  assert.equal(estimate.mode, 'html-no-css');
  assert.equal(estimate.providers.length, 3);
  assert.deepEqual(estimate.providers.map((p) => p.id), ['gemini', 'openai', 'anthropic']);
  assert.equal(estimate.providers[0].display, formatTokenCount(estimate.providers[0].tokens));
});

test('formatTokenCount uses compact k units', () => {
  assert.equal(formatTokenCount(42), '42');
  assert.equal(formatTokenCount(1200), '1.2k');
  assert.equal(formatTokenCount(12400), '12.4k');
});
