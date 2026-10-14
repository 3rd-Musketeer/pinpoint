// 关页前把标注写落盘，再让用例删桶。
//
// 关页会触发 pagehide，两个标注客户端（annotate.js、prose-comments.js）在 pagehide 里把
// 还没落盘的写（在途保存之后又改的、排着的操作）用 keepalive 发出去（lib/save-request.js）。
// 用例在 afterEach / beforeEach 里删桶时，这次保存可能还在服务端写：写回来的
// @canvas.json / _seq.json 让下一个 spec 的计数多一条（page-bucket.spec 期望 #1 实际 #3），
// 正好撞上 rmSync 时服务端 rename 报 ENOENT，整个服务退出，组里后面的用例全挂
// （2026-10-13 实测）。
//
// closeSettled：每个 frame 里先等在途保存和换账本 outbox 里的写回来，再在页面里派发一次 pagehide，让客户端
// 现在就发离开时要发的写，等它回来，最后关页。真正关页时再触发的 pagehide 就没有可发的了。
//
// lastRect（锚点几何缓存）在几何变了 600ms 后才写，离开页面时也不补发：closeSettled 若不等它，
// 它会在关页前一刻发出、和用例随后的删桶同时到达服务端。服务端读完旧账本、还没 rename 时桶被删，
// 账本就带着上一条用例的行被写回来（mention.spec 期望 1 行实际 3 行，2026-10-14 trace 里
// 新用例 hydrate 读到的是上一条用例 reload 后那次 lastRect 写出的 rev 5）。所以它也算在途的写。
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
      // 画布：在途保存（syncing）、换账本交给 outbox 还没写完的旧账本快照（outbox）、
      // 防抖里还没到点的 lastRect 写（lastRectPending）都要等完。
      const idle = () => {
        const st = ann && ann.getState();
        return (!st || (!st.syncing && !st.outbox && !st.lastRectPending)) && (!prose || prose.settled());
      };
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
