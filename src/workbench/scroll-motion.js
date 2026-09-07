import { advanceScrollSpring } from './lib/scroll-spring.js';

let active = null;

export function cancelStageScroll() {
  if (!active) return;
  const previous = active;
  active = null;
  cancelAnimationFrame(previous.raf);
  previous.cleanup();
  previous.resolve(false);
}

export function whenStageScrollSettled() {
  return active ? active.promise : Promise.resolve(true);
}

/** One owner for canvas navigation. Retarget from presentation position and velocity. */
export function scrollStageTo(stage, target, options = {}) {
  if (!stage) return Promise.resolve(false);
  const vx = active && active.stage === stage ? active.vx : 0;
  const vy = active && active.stage === stage ? active.vy : 0;
  cancelStageScroll();
  const left = Math.max(0, Math.min(target.left ?? stage.scrollLeft, stage.scrollWidth - stage.clientWidth));
  const top = Math.max(0, Math.min(target.top ?? stage.scrollTop, stage.scrollHeight - stage.clientHeight));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (options.smooth === false || reduced.matches) {
    stage.scrollTo({ left, top, behavior: 'instant' });
    return Promise.resolve(true);
  }
  const motion = { stage, vx, vy, x: stage.scrollLeft, y: stage.scrollTop, raf: 0, last: performance.now() };
  let writtenX = stage.scrollLeft;
  let writtenY = stage.scrollTop;
  motion.promise = new Promise(resolve => { motion.resolve = resolve; });
  const onKey = event => {
    if (['Escape', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)
        && !event.target.closest?.('input, textarea, [contenteditable="true"]')) cancelStageScroll();
  };
  const onReduced = () => {
    if (!reduced.matches) return;
    active = null;
    cancelAnimationFrame(motion.raf);
    motion.cleanup();
    stage.scrollTo({ left, top, behavior: 'instant' });
    motion.resolve(true);
  };
  stage.addEventListener('wheel', cancelStageScroll, { capture: true, passive: true });
  stage.addEventListener('pointerdown', cancelStageScroll, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', cancelStageScroll);
  reduced.addEventListener('change', onReduced);
  motion.cleanup = () => {
    stage.removeEventListener('wheel', cancelStageScroll, true);
    stage.removeEventListener('pointerdown', cancelStageScroll, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', cancelStageScroll);
    reduced.removeEventListener('change', onReduced);
  };
  active = motion;
  const tick = now => {
    if (active !== motion) return;
    if (Math.abs(stage.scrollLeft - writtenX) > 1 || Math.abs(stage.scrollTop - writtenY) > 1) {
      cancelStageScroll();
      return;
    }
    const dt = Math.max(0, (now - motion.last) / 1000);
    motion.last = now;
    const x = advanceScrollSpring(motion.x, motion.vx, left, dt);
    const y = advanceScrollSpring(motion.y, motion.vy, top, dt);
    motion.x = x.position;
    motion.y = y.position;
    motion.vx = x.velocity;
    motion.vy = y.velocity;
    // Keep subpixel integration separate from rounded DOM scroll offsets.
    stage.scrollTo({ left: x.position, top: y.position, behavior: 'instant' });
    writtenX = stage.scrollLeft;
    writtenY = stage.scrollTop;
    if (Math.abs(stage.scrollLeft - left) < 1 && Math.abs(stage.scrollTop - top) < 1
        && Math.abs(motion.vx) < 8 && Math.abs(motion.vy) < 8) {
      stage.scrollTo({ left, top, behavior: 'instant' });
      active = null;
      motion.cleanup();
      motion.resolve(true);
    } else {
      motion.raf = requestAnimationFrame(tick);
    }
  };
  motion.raf = requestAnimationFrame(tick);
  return motion.promise;
}
