// token 产物新鲜度：磁盘上的每份产物必须等于生成器的当前输出（值只改 scripts/tokens/source.mjs，手改产物在这里变红）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { TARGETS } from './build-tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const [rel, build] of Object.entries(TARGETS)) {
  test(`${rel} is in sync with scripts/build-tokens.mjs`, () => {
    assert.equal(readFileSync(path.join(ROOT, rel), 'utf8'), build(), `${rel} 落后于源，跑 npm run build:tokens`);
  });
}
