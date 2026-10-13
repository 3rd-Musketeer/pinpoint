import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT_CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'kits', 'ios', 'ios-kit.css');

/** The declaration block of the first rule whose selector list is exactly `selector`. */
function ruleBody(css, selector) {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
  assert.ok(at >= 0, `no rule ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

// Glass chroma is a pink left / cyan right inset rim. On a bar that spans the
// screen it sits on the screen edge and reads as a stray pink line down the
// frame (2026-10-13 fresh-reader shots), so only floating glass keeps it.
test('ios-kit.css: edge-to-edge bars have no side chroma; floating glass keeps it', () => {
  const css = fs.readFileSync(KIT_CSS, 'utf8');
  for (const bar of ['.ios-nav', '.ios-navbar']) {
    const body = ruleBody(css, bar);
    assert.match(body, /--ios-glass-rim/, `${bar} keeps the top rim`);
    assert.doesNotMatch(body, /--ios-glass-chroma/, `${bar} has side chroma`);
  }
  assert.match(ruleBody(css, '.ios-glass,\n.ios-glass-pill'), /--ios-glass-chroma-a/);
});
