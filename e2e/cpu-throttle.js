/**
 * CPU 节流钩子（时序 flake 复现用）：E2E_CPU_THROTTLE=<倍率> 时对当前 page 开
 * CDP `Emulation.setCPUThrottlingRate`，模拟全量两组并行 + 机器满载（load 5~6）
 * 下渲染进程的执行压力。不设或 ≤1 时空转，普通 e2e 跑法零影响。
 *
 * 用法：在 spec 的 beforeEach 里 `await maybeThrottle(page);`，然后
 * `E2E_CPU_THROTTLE=6 npx playwright test e2e/<file> --repeat-each=5`。
 */
export async function maybeThrottle(page) {
  const rate = Number(process.env.E2E_CPU_THROTTLE || 0);
  if (!Number.isFinite(rate) || rate <= 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}
