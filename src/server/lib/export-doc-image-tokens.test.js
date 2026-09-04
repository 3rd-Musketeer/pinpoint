import test from 'node:test';
import assert from 'node:assert/strict';

import {
  anthropicResizedSize,
  anthropicImageTokensRaw,
  estimateAnthropicImageTokens,
  estimateGeminiImageTokens,
  estimateImageTokens,
  estimateOpenAIImageTokens,
} from './export-doc-image-tokens.js';

test('Anthropic resize matches the published A4 example on the standard tier', () => {
  assert.deepEqual(anthropicResizedSize(1075, 1520, 1568, 1568), [924, 1307]);
  assert.equal(anthropicImageTokensRaw(924, 1307), 33 * 47);
});

test('Anthropic high-res tier edge-limits tall screenshots (not the token budget)', () => {
  // Elongated pages hit the 2576 long-edge cap first; token budget rarely binds.
  const result = estimateAnthropicImageTokens(1840, 20250);
  assert.ok(result.capped);
  assert.equal(result.resizedHeight, 2576);
  assert.ok(result.tokens < 1500);
});

test('OpenAI high-detail patches shrink oversized long images under the 2048 edge', () => {
  const result = estimateOpenAIImageTokens(1840, 20250);
  assert.ok(result.capped);
  assert.ok(result.resizedHeight <= 2048);
  assert.ok(result.tokens <= 2500);
  assert.ok(result.tokens > 100);
});

test('Gemini 3 image tokens are a fixed media_resolution budget', () => {
  assert.equal(estimateGeminiImageTokens(100, 100).tokens, 1120);
  assert.equal(estimateGeminiImageTokens(4000, 8000, { resolution: 'low' }).tokens, 280);
});

test('estimateImageTokens returns the three provider chips', () => {
  const estimate = estimateImageTokens(1840, 20250);
  assert.equal(estimate.mode, 'image');
  assert.deepEqual(estimate.providers.map((p) => p.id), ['gemini', 'openai', 'anthropic']);
  assert.ok(estimate.counts.gemini > 0);
});
