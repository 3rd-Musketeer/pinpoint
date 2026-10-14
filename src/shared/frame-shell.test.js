import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('wrapPhoneShell lock shell', () => {
  assert.ok(wrapPhoneShell('<div class="ios-app">x</div>', 'lock').includes('ios-screen ios-lock'));
});

test('wrapCompStage wraps without phone chrome', () => {
  const out = wrapCompStage('<button>hi</button>');
  assert.ok(out.startsWith('<div class="wb-comp-stage">'));
  assert.ok(out.includes('<div class="ios-root" data-theme="light">'));
  assert.ok(!/ios-device/.test(out));
});

test('wrapFragmentForLibrary wraps bare html and passes fragments through', () => {
  assert.equal(wrapFragmentForLibrary('  <div class="ios-app">a</div> '), '<div class="ios-app">a</div>');
  const bare = wrapFragmentForLibrary('<p>hello</p>');
  assert.ok(bare.startsWith('<div class="ios-app"'));
  assert.ok(bare.includes('<p>hello</p>'));
  assert.equal(wrapFragmentForLibrary(''), '<div class="ios-app"><div class="ios-page"></div></div>');
});
