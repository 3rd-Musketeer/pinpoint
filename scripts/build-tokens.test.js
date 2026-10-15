// token 产物新鲜度：磁盘上的每份产物必须等于生成器的当前输出（值只改 scripts/tokens/source.mjs，手改产物在这里变红）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { TARGETS, annTokens, buildSiteTokensCss, buildWbTokensCss } from './build-tokens.mjs';
import * as source from './tokens/source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const [rel, build] of Object.entries(TARGETS)) {
  test(`${rel} is in sync with scripts/build-tokens.mjs`, () => {
    assert.equal(readFileSync(path.join(ROOT, rel), 'utf8'), build(), `${rel} 落后于源，跑 npm run build:tokens`);
  });
}

test('遮罩与玻璃材质从同一份源传给站点、工作台与注入端', (t) => {
  // 改输入而非照抄生成器：各端输出必须跟随唯一源，防止另藏一份配方。
  assert.ok(source.MATERIAL, '材质配方必须住在 token 源');
  const originals = structuredClone(source.MATERIAL);
  t.after(() => Object.assign(source.MATERIAL, originals));
  source.MATERIAL.scrim = { light: 'scrim-light', dark: 'scrim-dark' };
  source.MATERIAL.glass = { light: 'glass-light', dark: 'glass-dark' };
  source.MATERIAL['glass-hi'] = { light: 'hi-light', dark: 'hi-dark' };
  source.MATERIAL['glass-blur'] = 'test-filter';
  for (const mode of ['light', 'dark']) {
    assert.ok(buildSiteTokensCss().includes(`--pp-scrim:scrim-${mode};`));
    assert.ok(buildWbTokensCss().includes(`--wb-glass:glass-${mode};`));
    assert.ok(buildWbTokensCss().includes(`--wb-glass-hi:hi-${mode};`));
    assert.equal(annTokens(mode)['--wb-glass'], `glass-${mode}`);
    assert.equal(annTokens(mode)['--wb-glass-hi'], `hi-${mode}`);
  }
  assert.ok(buildWbTokensCss().includes('--wb-glass-blur:test-filter;'));
});

test('工具菜单、gutter 评论与 toast 按用途消费圆角、颜色和阴影 token', () => {
  const css = readFileSync(path.join(ROOT, 'src/client/annotate-css.js'), 'utf8');
  const bridge = readFileSync(path.join(ROOT, 'src/workbench/ann-bridge.js'), 'utf8');
  assert.match(css.match(/#ann-tools-menu\{[^}]+/)[0], /border-radius:var\(--wb-r-3,8px\)/);
  assert.match(bridge, /border-radius:var\(--wb-r-3,8px\)/);
  const toast = css.match(/#ann-toast\{[^}]+/)[0];
  assert.match(toast, /background:var\(--ann-toast-bg\)/);
  assert.match(toast, /color:var\(--ann-toast-fg\)/);
  assert.match(toast, /box-shadow:var\(--wb-sh-3\)/);
  assert.match(css.match(/#ann-toast button\{[^}]+/)[0], /color:var\(--ann-toast-action\)/);
});
