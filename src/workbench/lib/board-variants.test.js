import test from 'node:test';
import assert from 'node:assert/strict';
import { expandVariants, isVariantGroup } from './board-variants.js';
import { validateBoard, ContractError } from './preview-contracts.js';

const sec = (screens, extra = {}) => ({ id: 's', layout: 'row', screens, ...extra });

test('expandVariants: 组换成变体，带 variantOf / groupTitle，组上的 shell / role 由变体继承', () => {
  const out = expandVariants({ sections: [sec(['a', { id: 'g', title: '组', shell: 'lock', variants: ['v1', { id: 'v2', title: '二', shell: 'app' }] }])] });
  assert.deepEqual(out.sections[0].screens, [
    'a',
    { shell: 'lock', id: 'v1', variantOf: 'g', groupTitle: '组' },
    { shell: 'app', id: 'v2', title: '二', variantOf: 'g', groupTitle: '组' },
  ]);
});

test('expandVariants: 没有变体组时原样返回同一个对象，摊平过的板再摊平是空操作', () => {
  const plain = { sections: [sec(['a', { id: 'b' }])] };
  assert.equal(expandVariants(plain), plain);
  const once = expandVariants({ sections: [sec([{ id: 'g', variants: ['v'] }])] });
  assert.equal(expandVariants(once), once);
  assert.equal(expandVariants(null), null);
  assert.equal(isVariantGroup({ id: 'g', variants: [] }), true);
  assert.equal(isVariantGroup('g'), false);
});

test('validateBoard: 变体摊平成普通屏，变体带 variantOf', () => {
  const board = validateBoard({ sections: [sec(['a', { id: 'g', title: '组', variants: ['v1', { id: 'v2', title: '二' }] }])] });
  assert.deepEqual(board.sections[0].screens.map((s) => [s.id, s.variantOf || '', s.title]), [
    ['a', '', ''], ['v1', 'g', ''], ['v2', 'g', '二'],
  ]);
  assert.equal(board.sections[0].screens[1].groupTitle, '组');
});

test('validateBoard: 组形状错误逐条拦下', () => {
  const bad = (group, re) => assert.throws(
    () => validateBoard({ sections: [sec(['a', group])] }),
    (e) => e instanceof ContractError && re.test(e.message),
  );
  bad({ id: 'g', variants: [] }, /non-empty array/);
  bad({ id: 'g', src: 'x.html', variants: ['v'] }, /no file of its own/);
  bad({ id: 'g', variants: [{ id: 'x', variants: ['y'] }] }, /cannot nest/);
  bad({ id: 'a', variants: ['v'] }, /collides with a screen id/);
  bad({ id: 'g', variants: ['v', 'a'] }, /duplicate screen id/);
});
