import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cardModel, looseErrors } from './canvas-card.js';
import { figureModel, figureSrc } from './figure.js';

test('figure model: n → this figure; errors replace the iframe; src is the embed=figure page', () => {
  const canvas = {
    pageId: 'demo_payments',
    sections: [{ id: 'flow', letter: 'B', frames: [{ id: 'ask', ref: 'B1' }] }],
    figures: [
      { index: 0, line: 9, id: 'pay-sequence', caption: '付款前', errors: [] },
      { index: 1, line: 15, section: 'flow', errors: [{ code: 'figure_src', section: 'flow', line: 15, message: '第 15 行：<Figure> 缺 src' }] },
      { index: 2, line: 17, section: 'flow', id: 'ghost', missing: true, errors: [{ code: 'figure_missing', section: 'flow', figure: 'ghost', line: 17, message: '第 17 行：<Figure> 图 "ghost" 没有源文件' }] },
    ],
    errors: [
      { code: 'figure_src', section: 'flow', line: 15, message: '第 15 行：<Figure> 缺 src' },
      { code: 'figure_missing', section: 'flow', figure: 'ghost', line: 17, message: '第 17 行：<Figure> 图 "ghost" 没有源文件' },
      { code: 'figure_prop', line: 3, message: '第 3 行：<Figure> 不认识属性 x' },
    ],
  };
  assert.deepEqual(figureModel(canvas, '0'), {
    id: 'pay-sequence', caption: '付款前', title: '付款前', missing: false, errors: [],
    src: '/api/frame?page=demo_payments&figure=pay-sequence&embed=figure',
  });
  assert.deepEqual(figureModel(canvas, '1').errors, ['第 15 行：<Figure> 缺 src']);
  assert.equal(figureModel(canvas, '1').src, '');
  assert.equal(figureModel(canvas, 2).missing, true);
  assert.equal(figureModel(canvas, 2).src, '');
  assert.match(figureModel(canvas, '9').errors[0], /找不到这个图（第 10 个 <Figure>）/);
  assert.match(figureModel(canvas, undefined).errors[0], /找不到这个图/);
  // A figure's errors show in the figure only: not on the section's canvas card, not in the page banner.
  assert.deepEqual(cardModel(canvas, 'flow').errors, []);
  assert.deepEqual(looseErrors(canvas), []);
  assert.equal(figureSrc('p', 'a&b'), '/api/frame?page=p&figure=a%26b&embed=figure');
});

test('figure palette: figure.css carries the site tokens (same values, light and dark)', () => {
  const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const site = read('../styles/site.css');
  const figure = read('../../../content/kits/figure/figure.css');
  const blocks = (css, selector) => [...css.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
  const vars = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const pairs = { bg: 'bg', panel: 'soft', ink: 'ink', 'ink-2': 'ink-2', muted: 'muted', hair: 'hair', accent: 'accent', 'accent-soft': 'accent-soft', err: 'err' };
  const check = (selector) => {
    const s = blocks(site, selector).map(vars);
    const f = blocks(figure, selector).map(vars);
    assert.ok(s.length && s.length === f.length, selector);
    s.forEach((siteVars, i) => {
      for (const [fig, tok] of Object.entries(pairs)) assert.equal(f[i][`fig-${fig}`], siteVars[tok], `${selector} --fig-${fig} = --${tok}`);
    });
  };
  check(':root');
  check(':root:not\\(\\[data-theme="light"\\]\\)');
  check(':root\\[data-theme="dark"\\]');
});
