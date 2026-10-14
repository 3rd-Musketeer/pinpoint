// 多个 spec 共用的文章正文 helper：等正文评论客户端落定、用真鼠标拖选一段文字。
import { expect } from '@playwright/test';

/** 等正文评论客户端（window.pinpointProse）没有在途的读写。 */
export function proseSettled(page) {
  return page.waitForFunction(() => window.pinpointProse && window.pinpointProse.settled());
}

/** 在 scope 选中的元素里找 needle 这段文字，用鼠标从第一个字拖到最后一个字，等选区正好是它。 */
export async function dragSelect(page, scope, needle) {
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
