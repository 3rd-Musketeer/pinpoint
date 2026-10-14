import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY, E2E_SITES_DIR } from './env.js';
import { closeSettled } from './ledger-settle.js';
import { waitNoReload } from './site-settle.js';

// pp3：文章正文选中文字评论（src/client/prose-comments.js）。固件 = registry 常驻的
// project e2e-prose → 本轮的副本 <sites>/prose-site/（registry-fixture.js 复制），一篇
// notes：两节，“确认卡写清收款方”在两节里各出现一次，第一节有一张画布卡片（帧 pay-card）。
// 改正文要动副本，不动仓内固件；用例结束把副本还原。
//
// 一个用例走完（Astro 冷启动只发生一次）：选字 → 评论 → 刷新仍在 → ppnt check 看得到 →
// ppnt reply / mark 在右栏实时出现 → owner 回复回 open → 保存被拒时原文退回 → bfcache 返回、
// SSE 断线后右栏照样同步 → 改折行仍定位 → 改正文后重新定位 → 引文没了标失效。

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLE = '/e2e-prose/notes/';
const PAGE_ID = 'e2e-prose_notes';
const SOURCE = path.join(E2E_SITES_DIR, 'prose-site', 'docs', 'pinpoint', 'articles', 'notes', 'index.mdx');
const LEDGER = path.join(E2E_DATA_DIR, PAGE_ID, '@prose.json');

async function ppnt(args) {
  const { stdout } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
    cwd: ROOT,
    env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY, PINPOINT_ORIGIN: E2E_BASE_URL },
  });
  return stdout;
}

/** 在 scope 里找 needle 的第一处，用真鼠标从第一个字拖到最后一个字。 */
async function dragSelect(page, scope, needle) {
  const box = await page.evaluate(([sel, text]) => {
    const el = document.querySelector(sel);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(text);
      if (at < 0) continue;
      // 鼠标只能在视口里拖：画布卡片把后面的正文推出首屏，先把这段滚到中间再量。
      node.parentElement.scrollIntoView({ block: 'center' });
      const first = document.createRange();
      first.setStart(node, at);
      first.setEnd(node, at + 1);
      const last = document.createRange();
      last.setStart(node, at + text.length - 1);
      last.setEnd(node, at + text.length);
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
    }
    return null;
  }, [scope, needle]);
  expect(box, `${scope} 里有“${needle}”`).not.toBeNull();
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => String(window.getSelection()))).toBe(needle);
}

// 账本每轮从空开始（--repeat-each、重跑都要“右栏空着”）；收尾先等关页时的写落盘。
test.beforeEach(() => fs.rmSync(LEDGER, { force: true }));
test.afterEach(async ({ page }) => { await closeSettled(page); });

const settled = (page) => page.waitForFunction(() => window.pinpointProse && window.pinpointProse.settled());

test('正文评论：选字评论 → 刷新仍在 → ppnt check / reply / mark → 改正文重新定位，引文没了标失效', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const original = fs.readFileSync(SOURCE, 'utf8');
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const thread = (n) => page.locator(`.pp-thread[data-n="${n}"]`);
  let first = 0;
  let second = 0;

  // 记下页面开的每个 EventSource，断线用例要拿到它关掉。
  await page.addInitScript(() => {
    const Native = window.EventSource;
    window.__ppEventSources = [];
    window.EventSource = class extends Native {
      constructor(...args) { super(...args); window.__ppEventSources.push(this); }
    };
  });

  try {
    await test.step('打开文章：桶 = 文章页 id，右栏空着，没有画布标注的工具条', async () => {
      await page.goto(ARTICLE);
      await expect(page.locator('#article .prose h1')).toHaveText('评论固件', { timeout: 150_000 });
      await waitNoReload(page);
      await settled(page);
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
      await settled(page);
    });

    await test.step('再评一条第一节的“始终知道钱什么时候会被扣”（后面改正文时删掉它）', async () => {
      await dragSelect(page, '#why', '始终知道钱什么时候会被扣');
      await page.locator('.pp-selbtn').click();
      await page.locator('.pp-thread.draft textarea').fill('这句太长');
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.locator('.pp-thread.draft')).toHaveCount(0);
      await settled(page);
      second = Number(await page.locator('.pp-thread').first().getAttribute('data-n'));
      expect(second).toBe(first + 1);
      // 右栏按正文位置排：第一节的在前。
      await expect(page.locator('.pp-thread')).toHaveCount(2);
      await expect(page.locator('#why mark.pp-hl')).toHaveText('始终知道钱什么时候会被扣');
    });

    await test.step('刷新：两条都从磁盘回来，高亮还在原处；点高亮聚焦线程', async () => {
      await page.reload();
      await settled(page);
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
    // 「check <project>_<article>：正文评论单独成组」与 reply / mark 用例钉住（2026-10-13 测试
    // 清理）；这里只证明 CLI 读到的是浏览器刚写的账本、写回的东西实时出现在右栏。
    await test.step('ppnt check <文章页 id>：读到浏览器写的两条正文评论', async () => {
      const out = await ppnt(['check', PAGE_ID]);
      expect(out).toContain(`[#${first}] 收款方要写全称`);
      expect(out).toContain(`[#${second}] 这句太长`);
    });

    await test.step('ppnt reply：agent 的回复实时出现在线程里，状态不变；ppnt mark check 改状态', async () => {
      await ppnt(['reply', `#${first}`, '已改成收款方全称', '--page', PAGE_ID]);
      await expect(thread(first).locator('.msg .who')).toHaveText(['你', 'agent']);
      await expect(thread(first).locator('.msg .text').nth(1)).toHaveText('已改成收款方全称');
      await expect(thread(first)).toHaveAttribute('data-status', 'open');
      await ppnt(['mark', `${PAGE_ID}#${first}`, 'check', '--page', PAGE_ID]);
      await expect(thread(first)).toHaveAttribute('data-status', 'check');
      await expect(thread(first).locator('.pp-st')).toHaveText('check');
    });

    await test.step('owner 在线程里回一句：消息接在 agent 后面，状态回 open', async () => {
      await thread(first).click();
      await thread(first).locator('textarea').fill('再短一点');
      await thread(first).getByRole('button', { name: '发送' }).click();
      await expect(thread(first).locator('.msg .who')).toHaveText(['你', 'agent', '你']);
      await expect(thread(first)).toHaveAttribute('data-status', 'open');
      await settled(page);
      const row = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations.find((a) => a.n === first);
      expect([row.status, row.messages.map((m) => m.who)]).toEqual(['open', ['agent', 'owner']]);
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

        await thread(first).click();
        await thread(first).locator('textarea').fill('被拒的回复');
        await thread(first).getByRole('button', { name: '发送' }).click();
        await expect(page.locator('.pp-rail-note')).toContainText('测试拒绝');
        await expect(thread(first).locator('textarea')).toHaveValue('被拒的回复');
        await expect(thread(first).locator('.msg .who')).toHaveText(['你', 'agent', '你']);
      } finally {
        await page.unroute('**/save');
      }
      await thread(first).locator('textarea').fill('');
      await settled(page);
    });

    await test.step('从画布按“返回”（bfcache：pagehide → pageshow persisted）：漏掉的回复补上，之后的回复照常实时出现', async () => {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await ppnt(['reply', `#${first}`, '离开期间的回复', '--page', PAGE_ID]);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      await expect(thread(first).locator('.msg .text').last()).toHaveText('离开期间的回复');
      await expect.poll(() => page.evaluate(() => window.__ppEventSources.filter((es) => es.readyState === 1).length)).toBe(1);
      await ppnt(['reply', `#${first}`, '回来之后的回复', '--page', PAGE_ID]);
      await expect(thread(first).locator('.msg .text').last()).toHaveText('回来之后的回复');
    });

    await test.step('SSE 断线（连接被关掉）：自己重连，并重新水合补上断线期间的回复', async () => {
      await page.evaluate(() => {
        const es = window.__ppEventSources.filter((one) => one.readyState !== 2).at(-1);
        es.close();
        es.dispatchEvent(new Event('error'));
      });
      await ppnt(['reply', `#${first}`, '断线期间的回复', '--page', PAGE_ID]);
      await expect(thread(first).locator('.msg .text').last()).toHaveText('断线期间的回复', { timeout: 10_000 });
      await ppnt(['reply', `#${first}`, '重连之后的回复', '--page', PAGE_ID]);
      await expect(thread(first).locator('.msg .text').last()).toHaveText('重连之后的回复');
      await settled(page);
    });

    await test.step('离开页面：在途保存后面还排着一条回复时整页离开，两条回复都落盘、各一次', async () => {
      let releaseHeld;
      const held = new Promise((resolve) => { releaseHeld = resolve; });
      let heldStarted;
      const started = new Promise((resolve) => { heldStarted = resolve; });
      let saves = 0;
      await page.route('**/save', async (route) => {
        if (++saves === 1) { heldStarted(); await held; }
        await route.continue().catch(() => {}); // 离开后被浏览器取消的请求 continue 会抛
      });
      try {
        await thread(first).click();
        await thread(first).locator('textarea').fill('离开前的回复一');
        await thread(first).getByRole('button', { name: '发送' }).click();
        await started;
        await thread(first).click();
        await thread(first).locator('textarea').fill('离开前的回复二');
        await thread(first).getByRole('button', { name: '发送' }).click();
        await expect(thread(first).locator('.msg .text').last()).toHaveText('离开前的回复二');
        await page.goto('/health');
        releaseHeld();
        const texts = () => {
          const row = JSON.parse(fs.readFileSync(LEDGER, 'utf8')).annotations.find((a) => a.n === first);
          return row.messages.map((m) => m.text).filter((t) => t.startsWith('离开前的回复'));
        };
        await expect.poll(texts, { timeout: 10_000 }).toEqual(['离开前的回复一', '离开前的回复二']);
      } finally {
        await page.unroute('**/save');
      }
      await page.goto(ARTICLE);
      await settled(page);
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
        await thread(second).click();
        await thread(second).locator('textarea').fill('第二条的回复');
        await thread(second).getByRole('button', { name: '发送' }).click();
        await started;
        await ppnt(['mark', `${PAGE_ID}#${first}`, 'done', '--note', '第一条改好了', '--page', PAGE_ID]);
        releaseHeld();
        await settled(page);
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

    await test.step('完成 → closed 段里，高亮跟着筛选；重新打开回 pending', async () => {
      await thread(second).getByRole('button', { name: '完成' }).click();
      await expect(thread(second)).toHaveCount(0);
      await expect(page.locator('#why mark.pp-hl')).toHaveCount(0);
      await page.locator('[data-filter="closed"]').click();
      await expect(thread(second)).toHaveAttribute('data-status', 'close');
      await expect(page.locator('#why mark.pp-hl')).toHaveText('始终知道钱什么时候会被扣');
      await thread(second).getByRole('button', { name: '重新打开' }).click();
      await expect(thread(second)).toHaveCount(0);
      await page.locator('[data-filter="pending"]').click();
      await expect(thread(second)).toHaveAttribute('data-status', 'open');
      await settled(page);
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
      await settled(page);
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
      await settled(page);
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
