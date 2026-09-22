import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expandIncludeRefs,
  looksPhoneWrapped,
  parseIncludeRef,
  wrapCompStage,
  wrapFragmentForLibrary,
  wrapPhoneShell,
} from './frame-shell.js';

test('wrapPhoneShell wraps bare fragments in phone chrome with a stable stage chain', () => {
  const out = wrapPhoneShell('<div class="ios-app">x</div>', 'app');
  assert.ok(out.startsWith('<div class="ios-stage">'));
  assert.ok(out.includes('<div class="ios-root screen-only" data-device="iphone-16-pro" data-theme="light">'));
  assert.ok(out.includes('<div class="ios-screen">'));
  assert.ok(out.includes('<div class="ios-app">x</div>'));
  assert.ok(out.includes('<div class="ios-home"></div>'));
});

test('wrapPhoneShell lock shell and already-wrapped pass-through', () => {
  assert.ok(wrapPhoneShell('<div class="ios-app">x</div>', 'lock').includes('ios-screen ios-lock'));
  const wrapped = '<div class="ios-stage"><div class="ios-root">y</div></div>';
  assert.equal(wrapPhoneShell(wrapped, 'app'), wrapped);
});

test('wrapCompStage wraps without phone chrome', () => {
  const out = wrapCompStage('<button>hi</button>');
  assert.ok(out.startsWith('<div class="wb-comp-stage">'));
  assert.ok(out.includes('<div class="ios-root" data-theme="light">'));
  assert.ok(!/ios-device/.test(out));
});

test('looksPhoneWrapped detects existing chrome', () => {
  assert.ok(looksPhoneWrapped('<div class="ios-stage"></div>'));
  assert.ok(looksPhoneWrapped('<div class="ios-device"></div>'));
  assert.ok(!looksPhoneWrapped('<div class="ios-app"></div>'));
});

test('wrapFragmentForLibrary wraps bare html and passes fragments through', () => {
  assert.equal(wrapFragmentForLibrary('  <div class="ios-app">a</div> '), '<div class="ios-app">a</div>');
  const bare = wrapFragmentForLibrary('<p>hello</p>');
  assert.ok(bare.startsWith('<div class="ios-app"'));
  assert.ok(bare.includes('<p>hello</p>'));
  assert.equal(wrapFragmentForLibrary(''), '<div class="ios-app"><div class="ios-page"></div></div>');
});

test('parseIncludeRef validates the comp/variant shape', () => {
  assert.deepEqual(parseIncludeRef('bubble/outgoing'), { component: 'bubble', variant: 'outgoing' });
  assert.equal(parseIncludeRef('nope'), null);
  assert.equal(parseIncludeRef('a/b/c'), null);
  assert.equal(parseIncludeRef(''), null);
});

test('expandIncludeRefs expands placeholders via the injected loader', async () => {
  const html = '<div class="ios-app"><div data-ios-include="bubble/outgoing" data-slot-text="hi"></div></div>';
  const out = await expandIncludeRefs(html, async ({ component, variant }) => {
    assert.equal(component, 'bubble');
    assert.equal(variant, 'outgoing');
    return '<div class="bubble"><span data-ios-slot="text">old</span></div>';
  }, (frag, attrs) => frag.replace('old', 'hi'));
  assert.ok(out.includes('hi'));
  assert.ok(!out.includes('data-ios-include'));
});

test('expandIncludeRefs renders an error block for missing includes', async () => {
  const out = await expandIncludeRefs('<div data-ios-include="ghost/nowhere"></div>', async () => null, (f) => f);
  assert.ok(out.includes('wb-screen-err'));
  assert.ok(out.includes('ghost/nowhere'));
});

test('expandIncludeRefs dedupes refs and leaves include-free html untouched', async () => {
  let calls = 0;
  const out = await expandIncludeRefs(
    '<div data-ios-include="a/b"></div><div data-ios-include="a/b"></div>',
    async () => { calls++; return '<i>x</i>'; },
    (f) => f,
  );
  assert.equal(calls, 1);
  assert.equal((out.match(/<i>x<\/i>/g) || []).length, 2);
  const plain = await expandIncludeRefs('<p>none</p>', async () => null, (f) => f);
  assert.equal(plain, '<p>none</p>');
});
