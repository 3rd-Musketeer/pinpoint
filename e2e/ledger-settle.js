// 关页前把标注写落盘，再让用例删桶。
//
// 关页会触发 pagehide，两个标注客户端（annotate.js、prose-comments.js）在 pagehide 里把
// 还没落盘的写（lastRect 的 debounce、排着的操作）用 keepalive 发出去（lib/save-request.js）。
// 用例在 afterEach / beforeEach 里删桶时，这次保存可能还在服务端写：写回来的
// @canvas.json / _seq.json 让下一个 spec 的计数多一条（page-bucket.spec 期望 #1 实际 #3），
// 正好撞上 rmSync 时服务端 rename 报 ENOENT，整个服务退出，组里后面的用例全挂
// （2026-10-13 实测）。
//
// closeSettled：每个 frame 里先等在途保存回来，再在页面里派发一次 pagehide，让客户端
// 现在就发离开时要发的写，等它回来，最后关页。真正关页时再触发的 pagehide 就没有可发的了。
//
// 尽力而为：用例自己扣着不放的保存（page.route 拦住 /save）等不回来，5s 后照常关页，
// 关页时浏览器取消它；还没建出执行上下文的 frame（懒加载的 iframe）跳过。
export async function closeSettled(page) {
  if (page.isClosed()) return;
  const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))]);
  for (const frame of page.frames()) {
    // 没有执行上下文的 frame 上 evaluate 会一直等：先用 500ms 探一下。
    if (await within(frame.evaluate(() => 'ok').catch(() => 'gone'), 500) !== 'ok') continue;
    await frame.evaluate(async () => {
      const ann = window.pinpoint && typeof window.pinpoint.getState === 'function' ? window.pinpoint : null;
      const prose = window.pinpointProse && typeof window.pinpointProse.settled === 'function' ? window.pinpointProse : null;
      if (!ann && !prose) return;
      const idle = () => (!ann || !ann.getState().syncing) && (!prose || prose.settled());
      const waitIdle = async () => {
        for (const until = Date.now() + 5000; !idle();) {
          if (Date.now() > until) return false;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return true;
      };
      if (!(await waitIdle())) return;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      await waitIdle();
    }).catch(() => {}); // frame 已卸载、换了文档：没有可等的
  }
  await page.close();
}
