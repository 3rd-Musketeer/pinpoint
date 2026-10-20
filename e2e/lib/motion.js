/** 在 animate 调用的同一任务里取关键帧，免得短动画在 Playwright 往返期间已经结束。
 *  仍由真实动作触发产品动画；不暂停、不改时长，没产生动画就返回 null。 */
export async function captureMotion(panel, action) {
  await panel.evaluate((el) => {
    const original = el.animate;
    el.__motionCapture = { original, motion: null };
    el.animate = function (...args) {
      const animation = original.apply(this, args);
      const effect = animation.effect;
      el.__motionCapture.motion = {
        duration: effect.getTiming().duration,
        easing: effect.getTiming().easing,
        frames: effect.getKeyframes().map((f) => ({ opacity: String(f.opacity), transform: f.transform })),
      };
      return animation;
    };
  });
  try {
    const value = await action();
    const motion = await panel.evaluate((el) => el.__motionCapture.motion);
    return { motion, value };
  } finally {
    await panel.evaluate((el) => {
      el.animate = el.__motionCapture.original;
      delete el.__motionCapture;
    });
  }
}
