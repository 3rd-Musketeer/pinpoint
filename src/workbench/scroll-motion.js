import { advanceScrollSpring } from './lib/scroll-spring.js';
import { isTypingTarget } from '../shared/keys.js';

let active = null;

// content-visibility:auto 要到滚动之后的下一帧才重新判定“是否相关”。远距离跳转
// （focusFrame、goToMark、文章浮层落点，平滑与非平滑都进这里）的第一帧里，目的地
// stage 还停在跳过状态，机身是空白。跳之前按这次的位移预测落点视口，给相交的
// stage 打 data-cv-keep，CSS 让它们 content-visibility:visible；滚动落定、过两帧
// （cv 自己接管渲染）后再摘掉。连续滚动不走这里，不受影响。
const keptStages = new Set();
let releaseToken = 0;
let suppressRelease = false;

function stageIntersectsViewport(stage, stageRect, dx, dy) {
  const rect = stage.getBoundingClientRect();
  const left = rect.left - dx;
  const top = rect.top - dy;
  return left + rect.width >= stageRect.left && left <= stageRect.right
    && top + rect.height >= stageRect.top && top <= stageRect.bottom;
}

function revealStagesAt(stage, left, top) {
  if (!stage?.querySelectorAll) return;
  const viewport = stage.getBoundingClientRect();
  const dx = left - stage.scrollLeft;
  const dy = top - stage.scrollTop;
  for (const el of stage.querySelectorAll('.wb-screen > .ios-stage')) {
    if (!stageIntersectsViewport(el, viewport, dx, dy)) continue;
    if (el.getAttribute('data-cv-keep') === null) {
      el.setAttribute('data-cv-keep', '');
      keptStages.add(el);
    }
  }
}

function releaseKeptStagesSoon() {
  const token = ++releaseToken;
  // 两帧：第一帧把新的滚动位置画出来，第二帧让 cv:auto 接上再摘强制可见。
  // 平滑滚动途中又发起了下一段（token 被换掉，或弹簧还在跑）就不摘，
  // 否则滑进视口的 stage 会在动画中途重新变空白。
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token !== releaseToken || active) return;
    for (const el of keptStages) el.removeAttribute('data-cv-keep');
    keptStages.clear();
  }));
}

export function cancelStageScroll() {
  if (!active) return;
  const previous = active;
  active = null;
  cancelAnimationFrame(previous.raf);
  previous.cleanup();
  previous.resolve(false);
  // 缩放等外部取消不经过 scrollStageTo，停住后也要放开；下一次跳转
  // 自己会重新揭示，这里的 token 会被换掉。
  if (!suppressRelease) releaseKeptStagesSoon();
}

export function whenStageScrollSettled() {
  return active ? active.promise : Promise.resolve(true);
}

/** One owner for canvas navigation. Retarget from presentation position and velocity. */
export function scrollStageTo(stage, target, options = {}) {
  if (!stage) return Promise.resolve(false);
  const vx = active && active.stage === stage ? active.vx : 0;
  const vy = active && active.stage === stage ? active.vy : 0;
  suppressRelease = true;
  cancelStageScroll();
  suppressRelease = false;
  const left = Math.max(0, Math.min(target.left ?? stage.scrollLeft, stage.scrollWidth - stage.clientWidth));
  const top = Math.max(0, Math.min(target.top ?? stage.scrollTop, stage.scrollHeight - stage.clientHeight));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  revealStagesAt(stage, left, top);
  if (options.smooth === false || reduced.matches) {
    stage.scrollTo({ left, top, behavior: 'instant' });
    releaseKeptStagesSoon();
    return Promise.resolve(true);
  }
  const motion = { stage, vx, vy, x: stage.scrollLeft, y: stage.scrollTop, raf: 0, last: performance.now() };
  let writtenX = stage.scrollLeft;
  let writtenY = stage.scrollTop;
  motion.promise = new Promise(resolve => { motion.resolve = resolve; });
  const onKey = event => {
    if (['Escape', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)
        && !isTypingTarget(event.target)) cancelStageScroll();
  };
  const onReduced = () => {
    if (!reduced.matches) return;
    active = null;
    cancelAnimationFrame(motion.raf);
    motion.cleanup();
    stage.scrollTo({ left, top, behavior: 'instant' });
    motion.resolve(true);
    releaseKeptStagesSoon();
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
    // 弹簧每一步的落点也先揭示，途中滑进视口的 stage 不会空白一帧。
    revealStagesAt(stage, x.position, y.position);
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
      releaseKeptStagesSoon();
    } else {
      motion.raf = requestAnimationFrame(tick);
    }
  };
  motion.raf = requestAnimationFrame(tick);
  return motion.promise;
}
