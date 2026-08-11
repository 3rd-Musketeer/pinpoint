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

// V0（goal-20260811）shadcn 桥契约：第二段 :root 的 shadcn 语义变量只许
// var(--wb-*) 引用（token 桥是唯一映射点，不许第二处色值字面量源）；
// wb-tw.css 的 @theme inline 映射也只能指向桥里真实定义的变量。
test('shadcn bridge section only references --wb-* tokens', () => {
  const css = buildWbTokensCss();
  const blocks = css.match(/:root \{[\s\S]*?\n\}/g) || [];
  assert.equal(blocks.length, 2, 'expected ladder :root + bridge :root');
  const bridge = blocks[1];
  const defined = new Set([...blocks[0].matchAll(/(--wb-[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const entries = [...bridge.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)];
  assert.ok(entries.length > 0, 'bridge section defines shadcn vars');
  for (const [, name, value] of entries) {
    assert.ok(!name.startsWith('--wb-'), `bridge must not redefine ${name}`);
    const refs = [...value.matchAll(/var\((--wb-[a-z0-9-]+)\)/gi)].map((m) => m[1]);
    assert.ok(refs.length > 0, `${name} must reference --wb-* (got ${value.trim()})`);
    for (const ref of refs) {
      assert.ok(defined.has(ref), `${name} references undefined ${ref}`);
    }
  }
});

test('wb-tw.css @theme inline maps only to defined bridge vars', () => {
  const tw = readFileSync(path.join(ROOT, 'workbench', 'app', 'wb-tw.css'), 'utf8');
  const theme = tw.match(/@theme inline \{([\s\S]*?)\n\}/);
  assert.ok(theme, '@theme inline block present');
  const bridgeVars = new Set(
    [...buildWbTokensCss().matchAll(/^\s*(--(?!wb-)[a-z0-9-]+)\s*:/gim)].map((m) => m[1]),
  );
  const ladderVars = new Set(
    [...buildWbTokensCss().matchAll(/(--wb-[a-z0-9-]+)\s*:/gi)].map((m) => m[1]),
  );
  const maps = [...theme[1].matchAll(/(--[a-z0-9-]+)\s*:\s*var\((--[a-z0-9-]+)\)/gi)];
  assert.ok(maps.length > 0, '@theme inline has mappings');
  for (const [, key, target] of maps) {
    if (key.startsWith('--color-')) {
      assert.ok(bridgeVars.has(target), `${key} -> ${target} must be a bridge var`);
    } else {
      assert.ok(ladderVars.has(target), `${key} -> ${target} must be a --wb-* ladder token`);
    }
  }
});
