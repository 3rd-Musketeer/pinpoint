// wb-tokens.css 鲜度守卫：磁盘文件必须是 scripts/build-wb-tokens.mjs 的当前
// 输出（token 只改生成器，手改产物会被本测试拦下）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildWbTokensCss } from '../scripts/build-wb-tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('workbench/wb-tokens.css is in sync with its generator', () => {
  const onDisk = readFileSync(path.join(ROOT, 'workbench', 'wb-tokens.css'), 'utf8');
  assert.equal(onDisk, buildWbTokensCss());
});
