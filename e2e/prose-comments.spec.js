import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './lib/fixtures.js';

import { E2E_DATA_DIR, E2E_SITES_DIR } from './env.js';
import { closeSettled } from './ledger-settle.js';
import { ppnt } from './lib/cli.js';
import { dragSelect, proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';

// pp3：文章正文选中文字评论（src/client/prose-comments.js）。固件 = registry 常驻的
// project e2e-prose → 本轮的副本 <sites>/prose-site/（registry-fixture.js 复制），一篇
// notes：两节，“确认卡写清收款方”在两节里各出现一次，第一节有一张画布卡片（帧 pay-card）。
// 改正文要动副本，不动仓内固件；用例结束把副本还原。
//
// 一个用例走完（Astro 冷启动只发生一次）：选字 → 评论 → 刷新仍在 → ppnt comments 看得到 →
// ppnt reply / mark 在右栏实时出现 → owner 点“回复”回一句（Enter 发送、发完收框）回 open →
// 回复框的收起与草稿 → 保存被拒时原文退回 → bfcache 返回、SSE 断线后右栏照样同步 → 完成的在
// 原位收成一行、点开再收回 → 改折行仍定位 → 改正文后重新定位 → 引文没了标失效。

const ARTICLE = '/e2e-prose/notes/';
const PAGE_ID = 'e2e-prose_notes';
const SOURCE = path.join(E2E_SITES_DIR, 'prose-site', 'docs', 'pinpoint', 'articles', 'notes', 'index.mdx');
const LEDGER = path.join(E2E_DATA_DIR, PAGE_ID, '@prose.json');
const CANVAS_LEDGER = path.join(E2E_DATA_DIR, PAGE_ID, '@canvas.json');

// 账本每轮从空开始（--repeat-each、重跑都要“右栏空着”）；收尾先等关页时的写落盘。
test.beforeEach(() => { fs.rmSync(LEDGER, { force: true }); fs.rmSync(CANVAS_LEDGER, { force: true }); });
test.afterEach(async ({ page }) => { await closeSettled(page); });

/** 往一本账本里放一行或多行（baseRevision 取盘上现版，整本换成这些行）。 */
async function seed(request, entry, ledger, row) {
  const doc = await (await request.get(`/annotations/${encodeURIComponent(ledger)}?entry=${entry}`)).json();
  const saved = await request.post('/save', { data: { entry, page: ledger, path: '/', baseRevision: doc.revision, annotations: [].concat(row) } });
  expect(saved.ok()).toBe(true);
}

test('正文评论：选字评论 → 刷新仍在 → ppnt comments / reply / mark → 改正文重新定位，引文没了标失效', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const original = fs.readFileSync(SOURCE, 'utf8');
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const thread = (n) => page.locator(`.pp-thread[data-n="${n}"]`);
  const replyBtn = (n) => thread(n).getByRole('button', { name: '回复', exact: true });
  // 回复框默认不出现：点线程上的“回复”才展开，并且焦点就在框里。
  const openReply = async (n) => {
    await replyBtn(n).click();
    await expect(thread(n).locator('textarea')).toBeFocused();
  };
  let first = 0;
  let second = 0;

  // 记下页面开的每个 EventSource，断线用例要拿到它关掉。
  // 再包一层 fetch：离开页面那步要一次“请求已到服务端、应答还没回页面”的在途保存。
  // 布上 window.__ppSaveHold 之后，下一次 /save 照常发出，应答扣在页面里，hold.answered
  // 说明服务端已经回了；hold.release() 放行。其余请求原样走。
  await page.addInitScript(() => {
    const Native = window.EventSource;
    window.__ppEventSources = [];
    window.EventSource = class extends Native {
      constructor(...args) { super(...args); window.__ppEventSources.push(this); }
    };
    const nativeFetch = window.fetch;
    window.__ppSaveHold = null;
    window.fetch = function (input, init) {
      const sent = nativeFetch(input, init);
      const hold = window.__ppSaveHold;
      const url = typeof input === 'string' ? input : String((input && input.url) || '');
      if (!hold || hold.taken || !/\/save$/.test(url)) return sent;
      hold.taken = true;
      const gate = new Promise((resolve) => { hold.release = resolve; });
      return sent.then((res) => { hold.answered = true; return gate.then(() => res); });
    };
  });

  try {
    await test.step('打开文章：桶 = 文章页 id，右栏空着，没有画布标注的工具条', async () => {
      await page.goto(ARTICLE);
      await expect(page.locator('#article .prose h1')).toHaveText('评论固件', { timeout: 150_000 });
      await waitNoReload(page);
      await proseSettled(page);
      expect(await page.evaluate(() => [window.__pinpointEntry, window.pinpointProse.ledger])).toEqual([PAGE_ID, '@prose']);
      await expect(page.locator('#rail .empty-rail')).toHaveText('选中正文里的一段文字，点“评论”。');
      await expect(page.locator('#ann-toolbar')).toHaveCount(0);
    });

    await test.step('画布卡片里选字不出“评论”', async () => {
      const before = await page.evaluate(() => window.pinpointProse.selection().checks);
      // 卡片头里的节标题（正文里同一句在节标题上，那里不在卡片里）。
      await dragSelect(page, '[data-pp-canvas]', '为什么停下来');
      await expect.poll(() => page.evaluate(() => window.pinpointProse.selection().checks)).toBeGreaterThan(before);
      expect(await page.evaluate(() => window.pinpointProse.selection().offered)).toBe(false);
      await expect(page.locator('.pp-selbtn')).toHaveCount(0);
    });

    await test.step('选第二节里的“确认卡写清收款方” → 评论 → 发送：服务端发号、高亮落在第二节', async () => {
      await dragSelect(page, '#how', '确认卡写清收款方');
      await page.locator('.pp-selbtn').click();
      const draft = page.locator('.pp-thread.draft');
      await expect(draft.locator('.q')).toHaveText('确认卡写清收款方');
      await expect(page.locator('#how mark.pp-hl.draft')).toHaveText('确认卡写清收款方');
      await draft.locator('textarea').fill('收款方要写全称');
      await draft.getByRole('button', { name: '发送' }).click();
      await expect(page.locator('.pp-thread[data-n]:not([data-n=""])')).toHaveCount(1);
      first = Number(await page.locator('.pp-thread').first().getAttribute('data-n'));
      expect(first).toBeGreaterThan(0);
      await expect(thread(first).locator('.msg .who')).toHaveText(['你']);
      await expect(thread(first).locator('.msg .text')).toHaveText(['收款方要写全称']);
      await expect(page.locator('#how mark.pp-hl')).toHaveText('确认卡写清收款方');
      await expect(page.locator('#why mark.pp-hl')).toHaveCount(0);
      await proseSettled(page);
    });

    await test.step('再评一条第一节的“始终知道钱什么时候会被扣”（后面改正文时删掉它）：组字中的 Enter 不发，Shift+Enter 换行，Enter 发送', async () => {
      await dragSelect(page, '#why', '始终知道钱什么时候会被扣');
      await page.locator('.pp-selbtn').click();
      const area = page.locator('.pp-thread.draft textarea');
      await area.fill('这句');
      // 输入法组字中按 Enter 是确认候选词：真键盘造不出组字态，直接派一个 isComposing 的 keydown。
      const composingSent = await area.evaluate((el) => {
        const ev = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        return ev.defaultPrevented;
      });
      expect(composingSent, '组字中的 Enter 不被拦下发送').toBe(false);
      await expect(page.locator('.pp-thread.draft')).toHaveCount(1);
      await area.press('Shift+Enter');
      await area.pressSequentially('太长');
      await expect(area).toHaveValue('这句\n太长');
      await area.fill('这句太长');
      await area.press('Enter');
      await expect(page.locator('.pp-thread.draft')).toHaveCount(0);
      await proseSettled(page);
      second = Number(await page.locator('.pp-thread').first().getAttribute('data-n'));
      expect(second).toBe(first + 1);
      // 右栏按正文位置排：第一节的在前。
      await expect(page.locator('.pp-thread')).toHaveCount(2);
      await expect(page.locator('#why mark.pp-hl')).toHaveText('始终知道钱什么时候会被扣');
    });

    await test.step('刷新：两条都从磁盘回来，高亮还在原处；点高亮聚焦线程', async () => {
      await page.reload();
      await proseSettled(page);
      await expect(page.locator('.pp-thread')).toHaveCount(2);
      await expect(page.locator('#how mark.pp-hl')).toHaveText('确认卡写清收款方');
      await expect(page.locator('#why mark.pp-hl')).toHaveText('始终知道钱什么时候会被扣');
      await page.locator('#how mark.pp-hl').click();
      await expect(thread(first)).toHaveClass(/\bon\b/);
      await expect(page.locator('#how mark.pp-hl')).toHaveClass(/\bon\b/);
      const doc = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
      expect(doc.path).toBe(ARTICLE);
      expect(doc.annotations.map((a) => [a.n, a.type, a.section, a.quote.exact])).toEqual([
        [first, 'prose', 'how', '确认卡写清收款方'],
        [second, 'prose', 'why', '始终知道钱什么时候会被扣'],
      ]);
    });

    // CLI 的输出格式（引文、节、源文件行、reply / mark 的回显）由 bin/pinpoint-cli.test.js 的
    // 「comments <project>/<article>：正文评论单独成组」与 reply / mark 用例钉住（2026-10-13 测试
    // 清理）；这里只证明 CLI 读到的是浏览器刚写的账本、写回的东西实时出现在右栏。
    await test.step('ppnt comments <文章页 id>：读到浏览器写的两条正文评论', async () => {
      const { stdout: out } = await ppnt(['comments', PAGE_ID]);
      expect(out).toContain(`[#${first}] 收款方要写全称`);
      expect(out).toContain(`[#${second}] 这句太长`);
    });

    await test.step('ppnt reply：agent 的回复实时出现在线程里，状态不变；ppnt mark check 改状态', async () => {
      await ppnt(['reply', PAGE_ID, `#${first}`, '已改成收款方全称']);
      await expect(thread(first).locator('.msg .who')).toHaveText(['你', 'agent']);
      await expect(thread(first).locator('.msg .text').nth(1)).toHaveText('已改成收款方全称');
      await expect(thread(first)).toHaveAttribute('data-status', 'open');
      await ppnt(['mark', `${PAGE_ID}#${first}`, 'check']);
      await expect(thread(first)).toHaveAttribute('data-status', 'check');
      await expect(thread(first).locator('.pp-st')).toHaveText('check');
    });

    await test.step('owner 点“回复”回一句（Enter 发送）：消息接在 agent 后面，状态回 open，回复框收起', async () => {
      // 点引文聚焦线程（第一句现在点着是编辑）。
      await thread(first).locator('.q').click();
      await expect(thread(first)).toHaveClass(/\bon\b/);
      await expect(thread(first).locator('textarea'), '聚焦线程不展开回复框').toHaveCount(0);
      await openReply(first);
      await thread(first).locator('textarea').fill('再短一点');
      await thread(first).locator('textarea').press('Enter');
      await expect(thread(first).locator('.msg .who')).toHaveText(['你', 'agent', '你']);
      await expect(thread(first).locator('textarea')).toHaveCount(0);
      await expect(replyBtn(first)).toBeVisible();
      await expect(thread(first)).toHaveAttribute('data-status', 'open');
      await proseSettled(page);
      const row = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations.find((a) => a.n === first);
      expect([row.status, row.messages.map((m) => m.who)]).toEqual(['open', ['agent', 'owner']]);
    });

    await test.step('回复框的收起：点卡外面空框收起；Esc 收起但留草稿，再点“回复”放回；有字时点外面不收', async () => {
      await openReply(second);
      await page.locator('#article .prose h1').click();
      await expect(thread(second).locator('textarea')).toHaveCount(0);
      await openReply(second);
      await thread(second).locator('textarea').fill('写到一半');
      await page.keyboard.press('Escape');
      await expect(thread(second).locator('textarea')).toHaveCount(0);
      await expect(thread(second).locator('.pp-draft-tag')).toHaveText('有草稿');
      await expect(replyBtn(second)).toBeFocused();
      await openReply(second);
      await expect(thread(second).locator('textarea')).toHaveValue('写到一半');
      await page.locator('#article .prose h1').click();
      await expect(thread(second).locator('textarea')).toHaveValue('写到一半');
      // 另一条展开时，这条有字的照样留着。
      await openReply(first);
      await expect(thread(second).locator('textarea')).toHaveValue('写到一半');
      await thread(second).locator('textarea').fill('');
      await page.locator('#article .prose h1').click();
      await expect(page.locator('.pp-reply')).toHaveCount(0);
      await expect(page.locator('.pp-draft-tag')).toHaveCount(0);
      expect(JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations.find((a) => a.n === second).messages, '收框不写账本').toEqual([]);
    });

    await test.step('保存被拒（非 409）：新评论的原文退回草稿、回复的原文退回输入框，右栏给出原因', async () => {
      await page.route('**/save', (route) => route.fulfill({ status: 400, json: { error: 'invalid_transition', detail: '测试拒绝' } }));
      try {
        await dragSelect(page, '#why', '扣给谁');
        await page.locator('.pp-selbtn').click();
        await page.locator('.pp-thread.draft textarea').fill('被拒的新评论');
        await page.locator('.pp-thread.draft').getByRole('button', { name: '发送' }).click();
        await expect(page.locator('.pp-rail-note')).toContainText('测试拒绝');
        await expect(page.locator('.pp-thread.draft textarea')).toHaveValue('被拒的新评论');
        await expect(page.locator('.pp-thread.draft .q')).toHaveText('扣给谁');
        await expect(page.locator('#why mark.pp-hl.draft')).toHaveText('扣给谁');
        await page.locator('.pp-thread.draft').getByRole('button', { name: '取消' }).click();
        await expect(page.locator('.pp-thread.draft')).toHaveCount(0);

        await openReply(first);
        await thread(first).locator('textarea').fill('被拒的回复');
        await thread(first).getByRole('button', { name: '发送' }).click();
        await expect(page.locator('.pp-rail-note')).toContainText('测试拒绝');
        await expect(thread(first).locator('textarea'), '被拒的回复退回重新展开的框').toHaveValue('被拒的回复');
        await expect(thread(first).locator('.msg .who')).toHaveText(['你', 'agent', '你']);
      } finally {
        await page.unroute('**/save');
      }
      await thread(first).locator('textarea').fill('');
      await page.keyboard.press('Escape');
      await expect(page.locator('.pp-reply')).toHaveCount(0);
      await proseSettled(page);
    });

    await test.step('从画布按“返回”（bfcache：pagehide → pageshow persisted）：漏掉的回复补上，之后的回复照常实时出现', async () => {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await ppnt(['reply', PAGE_ID, `#${first}`, '离开期间的回复']);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await expect(thread(first).locator('.msg .text').last()).toHaveText('离开期间的回复');
      await expect.poll(() => page.evaluate(() => window.__ppEventSources.filter((es) => es.readyState === 1).length)).toBe(1);
      await ppnt(['reply', PAGE_ID, `#${first}`, '回来之后的回复']);
      await expect(thread(first).locator('.msg .text').last()).toHaveText('回来之后的回复');
    });

    await test.step('SSE 断线（连接被关掉）：自己重连，并重新水合补上断线期间的回复', async () => {
      await page.evaluate(() => {
        const es = window.__ppEventSources.filter((one) => one.readyState !== 2).at(-1);
        es.close();
        es.dispatchEvent(new Event('error'));
      });
      await ppnt(['reply', PAGE_ID, `#${first}`, '断线期间的回复']);
      await expect(thread(first).locator('.msg .text').last()).toHaveText('断线期间的回复', { timeout: 10_000 });
      await ppnt(['reply', PAGE_ID, `#${first}`, '重连之后的回复']);
      await expect(thread(first).locator('.msg .text').last()).toHaveText('重连之后的回复');
      await proseSettled(page);
    });

    await test.step('离开页面：在途保存后面还排着一条回复时整页离开，两条回复都落盘、各一次', async () => {
      // 在途 = 第一次保存已在服务端落盘、应答扣在页面里（见开头的 fetch 包装）。不用 page.route
      // 扣：离开时发的 keepalive 快照在满载下会停在 Playwright 的拦截层，不进路由回调，unroute
      // 时才放出去，断言等不到（2026-10-14 满载复现，见 docs/debugging.md）。这里离开时没有拦截，
      // 快照和产品里一样直接上网络。
      const texts = () => {
        const row = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations.find((a) => a.n === first);
        return row.messages.map((m) => m.text).filter((t) => t.startsWith('离开前的回复'));
      };
      await page.evaluate(() => { window.__ppSaveHold = { taken: false, answered: false }; });
      try {
        await openReply(first);
        await thread(first).locator('textarea').fill('离开前的回复一');
        await thread(first).getByRole('button', { name: '发送' }).click();
        await expect.poll(() => page.evaluate(() => window.__ppSaveHold.answered)).toBe(true);
        expect(texts(), '第一次保存已落盘，页面还当它在途').toEqual(['离开前的回复一']);
        await openReply(first);
        await thread(first).locator('textarea').fill('离开前的回复二');
        await thread(first).getByRole('button', { name: '发送' }).click();
        await expect(thread(first).locator('.msg .text').last()).toHaveText('离开前的回复二');
        expect(await page.evaluate(() => window.pinpointProse.settled()), '回复二排在在途保存后面').toBe(false);
        await page.goto('/health');
        await expect.poll(texts, { timeout: 10_000 }).toEqual(['离开前的回复一', '离开前的回复二']);
      } finally {
        // 没走到离开那一步就挂了：放掉扣着的应答，收尾的 closeSettled 才等得到。
        await page.evaluate(() => window.__ppSaveHold && window.__ppSaveHold.release && window.__ppSaveHold.release()).catch(() => {});
      }
      await page.goto(ARTICLE);
      await proseSettled(page);
      await expect(thread(first).locator('.msg .text').last()).toHaveText('离开前的回复二');
    });

    await test.step('保存扣在路上时 agent 把另一条写成 done：409 后重放，agent 的状态与回复、owner 的回复都落盘', async () => {
      let releaseHeld;
      const held = new Promise((resolve) => { releaseHeld = resolve; });
      let heldStarted;
      const started = new Promise((resolve) => { heldStarted = resolve; });
      let saves = 0;
      await page.route('**/save', async (route) => {
        if (++saves === 1) { heldStarted(); await held; }
        await route.continue();
      });
      try {
        await openReply(second);
        await thread(second).locator('textarea').fill('第二条的回复');
        await thread(second).getByRole('button', { name: '发送' }).click();
        await started;
        await ppnt(['mark', `${PAGE_ID}#${first}`, 'done', '--note', '第一条改好了']);
        releaseHeld();
        await proseSettled(page);
        expect(saves, '扣住的那次撞 409，重放后再存一次').toBe(2);
        const rows = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations;
        const brief = (n) => {
          const row = rows.find((a) => a.n === n);
          return [row.status, row.messages.at(-1).who, row.messages.at(-1).text];
        };
        expect(brief(first)).toEqual(['done', 'agent', '第一条改好了']);
        expect(brief(second)).toEqual(['open', 'owner', '第二条的回复']);
        await expect(thread(first)).toHaveAttribute('data-status', 'done');
      } finally {
        await page.unroute('**/save');
      }
    });

    await test.step('完成 → 原位收成一行（高亮也收起）；点开成完整卡片、再点收回；重新打开回到普通卡片', async () => {
      const order = () => page.locator('#rail .pp-thread').evaluateAll((els) => els.map((el) => el.getAttribute('data-n')));
      const before = await order();
      expect(before).toEqual([String(second), String(first)]);
      await thread(second).getByRole('button', { name: '完成' }).click();
      const row = thread(second).locator('.pp-closed-row');
      await expect(row).toHaveAttribute('aria-expanded', 'false');
      await expect(row).toContainText('已关闭');
      await expect(thread(second).locator('.pp-closed-peek')).toHaveText('始终知道钱什么时候会被扣');
      await expect(thread(second).locator('.msg')).toHaveCount(0);
      await expect(page.locator('#why mark.pp-hl')).toHaveCount(0);
      expect(await order(), '收起的那条留在原位').toEqual(before);
      await row.click();
      await expect(thread(second)).toHaveAttribute('data-status', 'close');
      await expect(thread(second).locator('.msg .text').first()).toHaveText('这句太长');
      await expect(page.locator('#why mark.pp-hl')).toHaveText('始终知道钱什么时候会被扣');
      expect(await order()).toEqual(before);
      await thread(second).getByRole('button', { name: '收起' }).click();
      await expect(thread(second).locator('.pp-closed-row')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#why mark.pp-hl')).toHaveCount(0);
      await thread(second).locator('.pp-closed-row').click();
      await thread(second).getByRole('button', { name: '重新打开' }).click();
      await expect(thread(second)).toHaveAttribute('data-status', 'open');
      await expect(thread(second).locator('.pp-closed-row')).toHaveCount(0);
      await expect(page.locator('#why mark.pp-hl')).toHaveText('始终知道钱什么时候会被扣');
      expect(await order()).toEqual(before);
      await proseSettled(page);
    });

    await test.step('改折行：被评的两句在源文件里拆成两行，评论照样定位，不标失效', async () => {
      const rewrapped = original
        .replace('钱什么时候会被扣', '钱什么时候\n会被扣')
        .replace('先停下，确认卡写清收款方。', '先停下，确认卡写清\n收款方。');
      expect(rewrapped).not.toBe(original);
      fs.writeFileSync(SOURCE, rewrapped);
      await expect(async () => {
        await page.reload();
        expect(await page.evaluate(() => document.querySelector('#why').textContent.includes('什么时候\n会被扣'))).toBe(true);
      }).toPass({ timeout: 30_000 });
      await proseSettled(page);
      const marked = (sel) => page.evaluate((s) => [...document.querySelectorAll(s + ' mark.pp-hl')].map((m) => m.textContent).join('').replace(/\s/g, ''), sel);
      await expect.poll(() => marked('#why')).toBe('始终知道钱什么时候会被扣');
      await expect.poll(() => marked('#how')).toBe('确认卡写清收款方');
      await expect(page.locator('.pp-stale')).toHaveCount(0);
    });

    await test.step('改正文：第二节前插一段、第一节删掉被评的那句 → 第一条重新定位到第二节，第二条标失效', async () => {
      const edited = original
        .replace('付款之前 agent 停下来，用户始终知道钱什么时候会被扣、扣给谁。', '付款之前 agent 停下来，扣款时间与收款方都写在卡上。')
        .replace('agent 读到提交按钮时先停下，确认卡写清收款方。', '新加的一段：先说结论。\n\nagent 读到提交按钮时先停下，确认卡写清收款方。');
      expect(edited).not.toBe(original);
      fs.writeFileSync(SOURCE, edited);
      await expect(async () => {
        await page.reload();
        await expect(page.locator('#how')).toContainText('新加的一段：先说结论。', { timeout: 1000 });
      }).toPass({ timeout: 30_000 });
      await proseSettled(page);
      await expect(page.locator('#how mark.pp-hl')).toHaveText('确认卡写清收款方');
      await expect(page.locator('#why mark.pp-hl')).toHaveCount(0);
      await expect(thread(first).locator('.pp-stale')).toHaveCount(0);
      await expect(thread(second).locator('.pp-stale')).toHaveText('失效');
      await expect(thread(second).locator('.q')).toHaveText('始终知道钱什么时候会被扣');
      // 失效的排在最后。
      await expect(page.locator('.pp-thread').last()).toHaveAttribute('data-n', String(second));
    });
  } finally {
    fs.writeFileSync(SOURCE, original);
  }

  expect(pageErrors).toEqual([]);
});

test('改自己写的评论：点第一句原地编辑，⌘/Ctrl+Enter 或点外面保存，Esc 取消，清空恢复原文，409 不丢字；画布标注同规则', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(request, PAGE_ID, '@prose', {
    id: 'edit-me', type: 'prose', status: 'open', content: '收款方写简称',
    quote: { exact: '确认卡写清收款方' }, section: 'how', messages: [],
  });
  await seed(request, PAGE_ID, '@canvas', [
    { id: 'edit-canvas', screenId: 'pay-card', status: 'open', content: '画布上的原始标注' },
    {
      id: 'edit-token', screenId: 'pay-card', status: 'open', content: '把 [@t:i1] 改成主按钮',
      targets: [{ ref: 'i1', selector: '[data-pp-id="pay"]', text: '确认支付' }],
    },
  ]);
  await page.goto(ARTICLE);
  await expect(page.locator('#article .prose h1')).toHaveText('评论固件', { timeout: 150_000 });
  await waitNoReload(page);
  await proseSettled(page);
  const thread = (id) => page.locator(`.pp-thread[data-id="${id}"]`);
  const firstText = () => thread('edit-me').locator('.msg').first().locator('.text');
  const editBox = () => thread('edit-me').locator('textarea.pp-edit');
  const diskContent = (ledger, id) => JSON.parse(fs.readFileSync(ledger, 'utf8')).annotations.find((a) => a.id === id).content;
  // 开编辑前记下第一句的字体与卡片位置，编辑框出现后逐项对：字号行高不跳，卡片不挪。
  let metricsBefore;

  await test.step('点第一句进编辑：字号行高与卡片位置不变，框里是原文', async () => {
    // 可编辑的只有 owner 的第一句：整张卡里 [data-edit] 只有一个，引文上没有。
    await expect(thread('edit-me').locator('[data-edit]')).toHaveCount(1);
    await expect(thread('edit-me').locator('.q[data-edit]')).toHaveCount(0);
    metricsBefore = await firstText().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight, cardTop: el.closest('.pp-thread').getBoundingClientRect().top };
    });
    await firstText().click();
    await expect(editBox()).toBeFocused();
    await expect(editBox()).toHaveValue('收款方写简称');
    const during = await editBox().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fontSize: cs.fontSize, lineHeight: cs.lineHeight, cardTop: el.closest('.pp-thread').getBoundingClientRect().top };
    });
    expect([during.fontSize, during.lineHeight]).toEqual([metricsBefore.fontSize, metricsBefore.lineHeight]);
    expect(Math.abs(during.cardTop - metricsBefore.cardTop)).toBeLessThanOrEqual(1);
  });

  await test.step('⌘/Ctrl+Enter 保存：右栏与账本都是新字，状态回 open，ppnt comments 读到', async () => {
    await editBox().fill('收款方要写全称');
    await editBox().press('ControlOrMeta+Enter');
    await expect(editBox()).toHaveCount(0);
    await expect(firstText()).toHaveText('收款方要写全称');
    await proseSettled(page);
    const row = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations.find((a) => a.id === 'edit-me');
    expect([row.content, row.status]).toEqual(['收款方要写全称', 'open']);
    const { stdout } = await ppnt(['comments', PAGE_ID]);
    expect(stdout).toContain('收款方要写全称');
  });

  await test.step('刷新后是新内容', async () => {
    await page.reload();
    await proseSettled(page);
    await expect(firstText()).toHaveText('收款方要写全称');
  });

  await test.step('Esc 取消：恢复原文，账本不动', async () => {
    await firstText().click();
    await expect(editBox()).toHaveValue('收款方要写全称');
    await editBox().fill('改了一半又不要了');
    await editBox().press('Escape');
    await expect(editBox()).toHaveCount(0);
    await expect(firstText()).toHaveText('收款方要写全称');
    await proseSettled(page);
    expect(diskContent(LEDGER, 'edit-me')).toBe('收款方要写全称');
  });

  await test.step('清空后点卡外面保存：不删评论，恢复原文', async () => {
    await firstText().click();
    await editBox().fill('');
    await page.locator('#article .prose h1').click();
    await expect(thread('edit-me').locator('textarea')).toHaveCount(0);
    await expect(firstText()).toHaveText('收款方要写全称');
    await proseSettled(page);
    expect(diskContent(LEDGER, 'edit-me')).toBe('收款方要写全称');
  });

  await test.step('agent 的回复与引文点了不进编辑；owner 的后续回复能改', async () => {
    const n = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations.find((a) => a.id === 'edit-me').n;
    await ppnt(['reply', PAGE_ID, `#${n}`, '已按全称改好']);
    await expect(thread('edit-me').locator('.msg[data-who="agent"] .text')).toHaveText('已按全称改好');
    await thread('edit-me').locator('.msg[data-who="agent"] .text').click();
    await expect(thread('edit-me').locator('textarea')).toHaveCount(0);
    await thread('edit-me').locator('.q').click();
    await expect(thread('edit-me').locator('textarea')).toHaveCount(0);
    // agent 的那句没有 [data-edit]；这时还只有第一句能改。
    await expect(thread('edit-me').locator('.msg[data-who="agent"] .text[data-edit]')).toHaveCount(0);
    await expect(thread('edit-me').locator('[data-edit]')).toHaveCount(1);

    await thread('edit-me').getByRole('button', { name: '回复', exact: true }).click();
    const reply = thread('edit-me').locator('textarea[data-reply]');
    await reply.fill('全称还要带括号');
    await reply.press('Enter');
    const mine = thread('edit-me').locator('.msg[data-who="owner"]').nth(1).locator('.text');
    await expect(mine).toHaveText('全称还要带括号');
    await proseSettled(page);
    await mine.click();
    const mineBox = thread('edit-me').locator('textarea.pp-edit');
    await expect(mineBox).toBeFocused();
    await expect(mineBox).toHaveValue('全称还要带括号');
    await mineBox.fill('全称带上公司名');
    await mineBox.press('ControlOrMeta+Enter');
    await expect(mine).toHaveText('全称带上公司名');
    await proseSettled(page);
    const row = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations.find((a) => a.id === 'edit-me');
    expect(row.messages.map((m) => [m.who, m.text])).toEqual([['agent', '已按全称改好'], ['owner', '全称带上公司名']]);
    expect(row.messages[1].at, '改文本不改时间').toBeTruthy();
    expect(row.status).toBe('open');
    // agent 的那句仍点不进编辑。
    await thread('edit-me').locator('.msg[data-who="agent"] .text').click();
    await expect(thread('edit-me').locator('textarea')).toHaveCount(0);
  });

  await test.step('画布标注在右栏同规则：编辑保存落回 @canvas，不打开画布浮层', async () => {
    const canvasThread = page.locator('.pp-thread[data-kind="canvas"][data-id="c:edit-canvas"]');
    const canvasText = canvasThread.locator('.msg').first().locator('.text');
    await expect(canvasText).toHaveText('画布上的原始标注');
    await canvasText.click();
    const canvasBox = canvasThread.locator('textarea.pp-edit');
    await expect(canvasBox).toBeFocused();
    await expect(canvasBox).toHaveValue('画布上的原始标注');
    await expect(page.locator('dialog[data-pp-overlay][open]'), '点正文不打开画布浮层').toHaveCount(0);
    await canvasBox.fill('画布标注改过了');
    await canvasBox.press('ControlOrMeta+Enter');
    await expect(canvasThread.locator('textarea')).toHaveCount(0);
    await expect(canvasText).toHaveText('画布标注改过了');
    await proseSettled(page);
    expect(diskContent(CANVAS_LEDGER, 'edit-canvas')).toBe('画布标注改过了');
    const { stdout } = await ppnt(['comments', PAGE_ID]);
    expect(stdout).toContain('画布标注改过了');
  });

  await test.step('画布标注正文含目标记号：显示成元素文字，点不进编辑，记号留在账本里', async () => {
    const tokenThread = page.locator('.pp-thread[data-kind="canvas"][data-id="c:edit-token"]');
    const tokenText = tokenThread.locator('.msg').first().locator('.text');
    await expect(tokenText).toHaveText('把 “确认支付” 改成主按钮');
    await expect(tokenText).not.toHaveAttribute('data-edit', /.+/);
    await expect(tokenThread.locator('[data-edit]')).toHaveCount(0);
    await tokenText.click();
    await expect(tokenThread.locator('textarea')).toHaveCount(0);
    // 点不进编辑，所以这一下仍是点卡片：画布浮层照常开。记号留在账本里，没有被换成显示文字。
    await expect(page.locator('dialog[data-pp-overlay][open]')).toHaveCount(1);
    expect(diskContent(CANVAS_LEDGER, 'edit-token')).toBe('把 [@t:i1] 改成主按钮');
    await page.locator('dialog[data-pp-overlay][open]').evaluate((el) => el.close());
  });

  await test.step('/save 一直回 409：编辑入队重放，字一直显示在右栏；放行后落盘', async () => {
    await page.route('**/save', (route) => route.fulfill({ status: 409, json: { error: 'revision_conflict', ...JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } }));
    try {
      await firstText().click();
      await editBox().fill('冲突里也要留住的字');
      await editBox().press('ControlOrMeta+Enter');
      await expect(editBox()).toHaveCount(0);
      await expect(firstText()).toHaveText('冲突里也要留住的字', '409 重放期间草稿一直显示');
      await expect(page.locator('.pp-rail-note')).toContainText('保存一直冲突', { timeout: 15_000 });
      await expect(firstText()).toHaveText('冲突里也要留住的字');
    } finally {
      await page.unroute('**/save');
    }
    await proseSettled(page);
    expect(diskContent(LEDGER, 'edit-me')).toBe('冲突里也要留住的字');
    await expect(page.locator('.pp-rail-note')).toHaveText('');
  });
});
