import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceScrollSpring } from './scroll-spring.js';

test('resting spring approaches without overshoot and converges across refresh rates', () => {
  for (const hz of [30, 60, 120, 144]) {
    let position = 0, velocity = 0;
    for (let i = 0; i < hz; i++) {
      const next = advanceScrollSpring(position, velocity, 3000, 1 / hz);
      assert.ok(next.position >= position && next.position <= 3000);
      ({ position, velocity } = next);
    }
    assert.ok(3000 - position < 0.01);
    assert.ok(velocity < 0.2);
  }
});

test('retarget preserves presentation and velocity, then turns toward the new target', () => {
  const moving = advanceScrollSpring(0, 0, 3000, 0.12);
  const seam = advanceScrollSpring(moving.position, moving.velocity, -1000, 0);
  assert.ok(Math.abs(seam.position - moving.position) < 1e-8);
  assert.equal(seam.velocity, moving.velocity);
  const turned = advanceScrollSpring(moving.position, moving.velocity, -1000, 0.2);
  assert.ok(turned.velocity < 0);
  const settled = advanceScrollSpring(moving.position, moving.velocity, -1000, 2);
  assert.ok(Math.abs(settled.position + 1000) < 0.01);
});

test('analytic integration is independent of frame subdivision, including a delayed frame', () => {
  const whole = advanceScrollSpring(250, -400, 2000, 0.4);
  const first = advanceScrollSpring(250, -400, 2000, 0.03);
  const split = advanceScrollSpring(first.position, first.velocity, 2000, 0.37);
  assert.ok(Math.abs(whole.position - split.position) < 1e-8);
  assert.ok(Math.abs(whole.velocity - split.velocity) < 1e-8);
});
