import test from 'node:test';
import assert from 'node:assert/strict';

import { applyIncludeSlots } from './include-slots.js';

test('include slots preserve data-text and support named component values', () => {
  const fragment = '<div><b data-ios-slot="text">Old</b><span data-ios-slot="capability">Old skill</span><i data-ios-slot="delivery">Old output</i></div>';
  const result = applyIncludeSlots(fragment, ' data-text="生成会议纪要" data-slot-capability="会议分析" data-slot-delivery="可编辑 Note"');
  assert.match(result, />生成会议纪要<\/b>/);
  assert.match(result, />会议分析<\/span>/);
  assert.match(result, />可编辑 Note<\/i>/);
});

test('unknown named slots leave the component unchanged', () => {
  assert.equal(applyIncludeSlots('<p data-ios-slot="text">Default</p>', ' data-slot-meta="ignored"'), '<p data-ios-slot="text">Default</p>');
});
