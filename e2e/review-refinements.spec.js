import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_DATA_DIR } from './env.js';
import { maybeThrottle } from './cpu-throttle.js';
import { pageKeyFromPathname } from '../src/shared/annotate-page-key.js';

// These stories deliberately create and invalidate DOM targets. Their ledger
// must not survive into another story with a fresh document.
test.beforeEach(() => fs.rmSync(path.join(E2E_DATA_DIR, 'e2e-dir'), { recursive: true, force: true }));
test.beforeEach(async ({ page }) => { await maybeThrottle(page); });
test.afterEach(async ({page}) => {
  if (!page.isClosed()) {
    await page.waitForFunction(() => !window.pinpoint || !window.pinpoint.getState().syncing);
    await page.close();
  }
});

test('composer follows the selected DOM and docks only when adjacent space runs out', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.addStyleTag({content:'body{min-height:2000px} h1{position:absolute;left:240px;top:300px;width:180px;height:100px;margin:0}'});
  await page.evaluate(() => window.pinpoint.setMode(true));
  const target = page.locator('h1').first();
  await target.click({position:{x:10,y:10}});
  const composer = page.locator('#ann-box');
  await expect(composer).toHaveAttribute('data-placement','anchor');
  const before = await composer.boundingBox();
  const selected = await target.boundingBox();
  expect(before.x).toBeGreaterThan(selected.x + selected.width);
  await page.evaluate(() => window.scrollTo(0, 120));
  await expect.poll(async () => (await composer.boundingBox()).y).toBeCloseTo(before.y - 120, 0);
  await expect(composer.locator('.ann-drag-handle')).toHaveCount(0);
  await page.setViewportSize({width:540,height:500});
  await page.locator('h1').evaluate(el => { el.style.top='140px'; el.style.height='440px'; });
  await page.evaluate(() => window.pinpoint.viewportChanged());
  await expect(composer).toHaveAttribute('data-placement','dock');
  const docked = await composer.boundingBox();
  expect(docked.x).toBeGreaterThanOrEqual(0);
  expect(docked.x + docked.width).toBeLessThanOrEqual(540);
  expect(docked.y + docked.height).toBeLessThanOrEqual(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(120);
  await page.screenshot({path:test.info().outputPath('composer-dock.png')});
});

test('reviewer mixes target pills and Chinese text, chooses an intent and reopens the saved annotation', async ({ page }) => {
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await page.locator('#doc-title').click();
  const input=page.getByRole('textbox',{name:'写标注'});
  await expect(input.locator('[data-target-ref="i1"]')).toHaveCount(1);
  await input.press('End');
  await page.keyboard.insertText(' 请把标题改短，和 ');
  await page.locator('#doc-target').click();
  await expect(input.locator('[data-target-ref="i2"]')).toHaveCount(1);
  await input.press('End');
  await page.keyboard.insertText(' 保持一致');
  await page.locator('#ann-plus').click();
  await page.locator('#ann-change').click();
  await expect(page.getByRole('button',{name:'取消改文案',exact:true})).toBeVisible();
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  await expect(input).toBeVisible();
  await input.dispatchEvent('compositionend');
  await page.getByRole('button',{name:'发送标注',exact:true}).click();
  await expect(input).toHaveCount(0);
  const mark=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  expect(mark.content).toContain('[@t:i1]');
  expect(mark.content).toContain('[@t:i2]');
  expect(mark.content).toContain('请把标题改短');
  expect(mark.changeTo).toBe(true);
  expect(mark.targets).toHaveLength(2);
  await page.evaluate(n=>window.pinpoint.openMark(n),mark.n);
  await expect(input.locator('[data-target-ref]')).toHaveCount(2);
  await input.locator('[data-target-ref="i2"]').hover();
  await input.getByRole('button',{name:'移除目标 2'}).click();
  await expect(input.locator('[data-target-ref]')).toHaveCount(1);
  await page.getByRole('button',{name:'发送标注',exact:true}).click();
  const updated=await page.evaluate(n=>window.pinpoint.marks.find(m=>m.n===n),mark.n);
  expect(updated.targets).toHaveLength(1);
  expect(updated.content).not.toContain('[@t:i2]');
  expect(updated.id).toBe(mark.id);
  expect(errors).toEqual([]);
});

test('reviewer writes a long correction and adds a real move arrow without losing the draft', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await page.locator('#doc-title').click();
  const input=page.getByRole('textbox',{name:'写标注'});
  const longText=Array.from({length:15},(_,i)=>'第 '+i+' 行：请把标题放到正文旁边，保持层级。').join('\n');
  await input.fill(longText);
  await expect(input.locator('[data-target-ref]')).toHaveCount(1);
  const metrics=await input.evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight,bar:getComputedStyle(el).scrollbarWidth}));
  expect(metrics.height).toBeLessThanOrEqual(244);
  expect(metrics.scroll).toBeGreaterThan(metrics.height);
  expect(metrics.bar).toBe('none');
  await page.locator('#ann-plus').click();
  await page.locator('#ann-change').click();
  await page.locator('#ann-plus').click();
  await page.locator('#ann-move').click();
  await expect(input).toHaveCount(0);
  await page.locator('#doc-target').click();
  await expect(input).toBeVisible();
  await expect(input).toContainText('第 14 行');
  await expect(page.getByRole('button',{name:'取消改文案',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'取消移动',exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('composer-rich.png')});
  await page.getByRole('button',{name:'发送标注',exact:true}).click();
  const mark=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  expect(mark.move.to_selector).toBe('#doc-target');
  expect(mark.changeTo).toBe(true);
  expect(mark.content).toContain('第 14 行');
});

test('composer 压得过被审页面自己的浮层：z-index 极值弹层与原生 dialog top layer', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  const input=page.getByRole('textbox',{name:'写标注'});

  // 机制一：页面自带 z-index 极值的全屏弹层压不住 composer 的发送钮。
  await page.evaluate(() => {
    const popup=document.createElement('div'); popup.id='reviewed-popup';
    popup.style.cssText='position:fixed;inset:0;background:#eee;z-index:2147483647';
    popup.innerHTML='<button id="popup-target" style="position:absolute;left:180px;top:200px;width:180px;height:60px">页面弹窗按钮</button>';
    document.body.appendChild(popup);
    window.pinpoint.setMode(true);
  });
  await page.locator('#popup-target').click();
  await input.fill('弹窗按钮改成继续');
  const send=page.getByRole('button',{name:'发送标注',exact:true});
  const hit=await send.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  expect(hit).toBe(true);
  await send.click();
  expect(await page.evaluate(()=>window.pinpoint.marks.at(-1).content)).toContain('弹窗按钮改成继续');
  await page.evaluate(()=>document.querySelector('#reviewed-popup').remove());

  // 机制二：<dialog>.showModal() 的 top layer 在所有 z-index 之上，composer
  // 照样可命中可保存；关掉 dialog 后继续标注。
  await page.evaluate(()=>{
    const dialog=document.createElement('dialog');dialog.id='review-native-dialog';
    dialog.innerHTML='<button id="review-native-button">确认选择</button>';
    dialog.style.cssText='padding:60px';document.body.appendChild(dialog);dialog.showModal();
  });
  await page.locator('#review-native-button').click();
  await expect(input).toBeVisible();
  expect(await input.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+10,r.y+10));})).toBe(true);
  await input.fill('把确认选择改成继续');
  await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  expect(await page.evaluate(()=>window.pinpoint.marks.at(-1).content)).toContain('把确认选择改成继续');
  await page.locator('#review-native-dialog').evaluate(el=>el.close());
  await page.locator('#doc-title').click();
  await input.fill('弹窗关闭后继续标注');
  await page.locator('#ann-save').click();
  expect(await page.evaluate(()=>window.pinpoint.marks.at(-1).content)).toContain('弹窗关闭后继续标注');
});



test('clearInvalid 只清目标 wholly 失效的标注：判定矩阵一条跑完', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(()=>{
    window.pinpoint.setMode(true);
    ['stale','hidden','replaced'].forEach(id=>{
      const el=document.createElement('button');el.id='review-'+id;el.textContent=id;el.style.margin='20px';document.querySelector('#doc-target').after(el);
    });
    // temporary 与稍后会缺席的 frame（缺席作用域经打在 frame 里的标注表达）。
    const el=document.createElement('button');el.id='guard-temporary';el.textContent='temporary';document.body.appendChild(el);
    const frame=document.createElement('div');frame.className='wb-screen';frame.dataset.screen='lazy-result';
    frame.innerHTML='<div id="lazy-result-target">执行后的内容</div>';document.body.appendChild(frame);
  });
  const ids={};
  await test.step('造七条标注：stale / hidden / replaced / done / partial / temporary / absent-frame', async () => {
    for (const kind of ['stale','hidden','replaced']) {
      await page.locator('#review-'+kind).click();
      await page.getByRole('textbox',{name:'写标注'}).fill('修改 '+kind);
      await page.getByRole('button',{name:'发送标注',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
      ids[kind]=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
    }
    // done：目标会被「按标注删掉」，失效是干完活的常态形态，但 done 的账不能
    // 一键清掉（R5）—— mark 端点推进到 done。
    await page.locator('#doc-target-2').click();
    await page.getByRole('textbox',{name:'写标注'}).fill('按标注删掉这个目标');
    await page.locator('#ann-save').click();
    await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
    ids.done=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
    const doneN=await page.evaluate(()=>window.pinpoint.marks.at(-1).n);
    const ledger=pageKeyFromPathname('/sites/e2e-dir/doc.html');
    const rev=await page.evaluate(()=>window.pinpoint.getState().revision);
    expect((await page.request.post(`/annotations/${ledger}/${doneN}/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'done'}})).status()).toBe(200);
    await expect.poll(()=>page.evaluate(id=>window.pinpoint.marks.find(m=>m.id===id).status,ids.done)).toBe('done');
    // partial：双目标，只删一个不清。
    await page.locator('#doc-title').click();
    const input=page.getByRole('textbox',{name:'写标注'});
    await input.fill('保留第二个目标仍有效的意见');
    await page.locator('#doc-target').click();
    await expect(input.locator('[data-target-ref]')).toHaveCount(2);
    await page.locator('#ann-save').click();
    await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
    ids.partial=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
    // temporary：目标整个消失。
    await page.locator('#guard-temporary').click();await input.fill('修改 temporary');await page.locator('#ann-save').click();
    await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
    ids.temporary=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
    // absent-frame：标注打在稍后整体缺席的 frame 里。
    await page.locator('#lazy-result-target').click();await input.fill('标在将缺席的 frame 里');await page.locator('#ann-save').click();
    await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
    ids.absentScope=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
  });

  await test.step('删目标：stale / replaced / temporary / done 的目标离场，hidden 藏起，partial 只删一个，frame 整体缺席', async () => {
    await page.evaluate(()=>{
      document.querySelector('#review-stale').remove();
      document.querySelector('#review-replaced').remove();
      document.querySelector('#review-hidden').style.display='none';
      document.querySelector('#doc-target-2').remove();
      document.querySelector('#doc-title').remove();
      document.querySelector('#guard-temporary').remove();
      document.querySelector('[data-screen="lazy-result"]').remove();
    });
  });

  await test.step('作用域加载中：一条都不清', async () => {
    await page.evaluate(()=>{document.body.dataset.loading='true';window.pinpoint.render();});
    expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(0);
    const remaining=await page.evaluate(()=>window.pinpoint.marks.map(m=>m.id));
    expect(remaining).toEqual(expect.arrayContaining(Object.values(ids)));
  });

  await test.step('加载完成：只清 stale / replaced / temporary 三条（hidden 与 partial、缺席 frame、done 都保留）', async () => {
    await page.evaluate(()=>{delete document.body.dataset.loading;window.pinpoint.render();});
    // 失效重算是异步的一拍：轮询到安定值。done 不计入 countInvalid。
    await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().countInvalid)).toBe(3);
    expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(3);
    const remaining=await page.evaluate(()=>window.pinpoint.marks.map(m=>m.id));
    expect(remaining).toContain(ids.hidden);
    expect(remaining).toContain(ids.partial);
    expect(remaining).toContain(ids.absentScope);
    expect(remaining).toContain(ids.done);
    expect(remaining).not.toContain(ids.stale);
    expect(remaining).not.toContain(ids.replaced);
    expect(remaining).not.toContain(ids.temporary);
  });

  await test.step('清后可重新标注得新 id', async () => {
    await page.locator('#doc-target').click();
    await page.getByRole('textbox',{name:'写标注'}).fill('重新标注：再精简一点');
    await page.getByRole('button',{name:'发送标注',exact:true}).click();
    const fresh=await page.evaluate(()=>window.pinpoint.marks.at(-1));
    expect(fresh.id).not.toBe(ids.replaced);
    expect(fresh.status).toBe('open');
  });
});

test('reviewer inserts a second pill mid-line, pastes an image, and removes it after reload', async ({page}) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));
  await page.locator('#doc-title').click();
  const input=page.getByRole('textbox',{name:'写标注'});
  await input.fill('第一行\n第二行尾');
  await input.press('End');await input.press('ArrowLeft');
  await page.locator('#doc-target').click();
  await expect(input.locator('[data-target-ref]')).toHaveCount(2);
  await input.evaluate(el=>{
    const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3x8AAAAASUVORK5CYII='),c=>c.charCodeAt(0));
    const data=new DataTransfer();data.items.add(new File([bytes],'reference.png',{type:'image/png'}));
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  });
  await expect(page.locator('#ann-imgs img')).toHaveCount(1);
  await expect.poll(()=>page.locator('#ann-imgs img').evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
  const imageBox=await page.locator('#ann-imgs').boundingBox(),inputBox=await input.boundingBox();
  expect(imageBox.y+imageBox.height).toBeLessThanOrEqual(inputBox.y);
  await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const saved=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  expect(saved.content).toContain('第一行\n第二行[@t:i2] 尾');
  expect(saved.images).toHaveLength(1);
  await page.reload();await page.waitForFunction(()=>window.pinpoint?.getState().connected);
  await page.evaluate(n=>window.pinpoint.openMark(n),saved.n);
  await expect(page.locator('#ann-imgs img')).toHaveCount(1);
  await page.locator('#ann-imgs .x').click();
  await expect(page.locator('#ann-imgs img')).toHaveCount(0);
  await page.locator('#ann-save').click();
  const edited=await page.evaluate(id=>window.pinpoint.marks.find(m=>m.id===id),saved.id);
  expect(edited.images).toBeUndefined();expect(edited.content).toBe(saved.content);
});

test('锚点失效后 lastRect 出幽灵框，列表行仍跳到最后位置；失效不等于已解决', async ({page}) => {
  await page.goto('/sites/e2e-dir/doc.html');await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));await page.locator('#doc-target-2').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('这个目标会走');await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const before=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  const oldRect=await page.locator('#doc-target-2').boundingBox();
  const oldAbs=await page.evaluate(y=>window.scrollY+y,oldRect.y);

  await page.evaluate(()=>{document.querySelector('#doc-target-2').remove();});
  // 幽灵框：虚线框 + 序号钉出现在目标原来的位置（按文档绝对坐标比：滚动不算误差）。
  const ghost=page.locator('.ann-ghost-rect');
  await expect(ghost).toHaveCount(1);
  await expect(page.locator('#ann-marks .ann-badge').filter({hasText:new RegExp('^'+before.n+'$')})).toBeVisible();
  const g=await ghost.boundingBox();
  const gAbs=await page.evaluate(y=>window.scrollY+y,g.y);
  expect(Math.abs(g.x-oldRect.x)).toBeLessThan(6);
  expect(Math.abs(gAbs-oldAbs)).toBeLessThan(6);

  // 点列表行仍跳到最后位置（页面滚回幽灵处）；行上的「锚点失效」标由
  // ann-sidebar 的注入侧栏用例守。
  await page.keyboard.press('s');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+before.n+'"] .wb-ann-item-main').click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);

  // 行点击打开了 composer；clearInvalid 在有草稿时拒动 —— 先关掉。
  await page.evaluate(()=>window.pinpoint.cancelDraft());

  // 失效不等于已解决：幽灵框不是免死牌，clearInvalid 照样清它。
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().countInvalid)).toBe(1);
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(1);
  await expect(page.locator('.ann-ghost-rect')).toHaveCount(0);
});


test('annotation number stays visible while editing and follows the target after scrolling', async ({page}) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(()=>window.pinpoint);
  await page.addStyleTag({content:'body{min-height:2000px} h1{position:absolute;left:240px;top:300px;width:180px;height:100px;margin:0}'});
  await page.evaluate(()=>window.pinpoint.setMode(true));
  await page.locator('#doc-title').click({position:{x:10,y:10}});
  await page.locator('#ann-input').press('End');
  await page.keyboard.insertText('保留序号');
  await page.locator('#ann-save').click();
  const mark=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  await expect(page.locator('.ann-badge')).toHaveCount(1);
  await page.evaluate(n=>window.pinpoint.openMark(n),mark.n);
  await expect(page.locator('#ann-box')).toBeVisible();
  const badgeDocTop=()=>page.evaluate(()=>{
    const badge=document.querySelector('.ann-badge');
    return badge ? badge.getBoundingClientRect().top + window.scrollY : null;
  });
  // 滚动事件驱动的 overlay 重绘排在自己的 rAF 上，与测试发起的 rAF 之间的先后
  // 没有契约：负载下基准若在重绘落地前取，会拿到差一个滚动量的陈旧位置
  // （实测差 143px）。所以基线取「跨帧不再变化」的文档坐标（视口 y + scrollY，
  // 滚动不变量），等首测量 settle，不加固定等待。
  const settledDocTop=async()=>{
    let prev=await badgeDocTop();
    for(let i=0;i<20&&prev!==null;i++){
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const cur=await badgeDocTop();
      if(cur===prev) return cur;
      prev=cur;
    }
    return prev;
  };
  const badge=page.locator('.ann-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveText(String(mark.n));
  const before=await settledDocTop();
  await page.evaluate(()=>window.scrollTo({top:100, behavior:'instant'}));
  await expect.poll(badgeDocTop).toBe(before);
  await expect(badge).toBeVisible();
  await page.locator('#ann-cancel').click();
  await expect(badge).toHaveCount(1);
  expect((await page.evaluate(()=>window.pinpoint.marks.at(-1))).id).toBe(mark.id);
});

test('annotation jumps center the DOM and composer together without moving while typing', async ({page}) => {
  await page.setViewportSize({width:1500,height:1000});
  await page.goto('/index.html?page=e2e-dir-ios');
  await page.waitForFunction(()=>window.pinpoint?.getState().connected && document.querySelector('#wbsection-nav .wb-section-nav-item'));
  await page.evaluate(()=>window.workbench.whenScrollSettled());
  await page.evaluate(()=>window.pinpoint.setMode(true));
  await page.locator('[data-screen="cards"] [data-card]').first().click();
  // 画布上 composer 贴在目标旁（placement=anchor），且整个框不与目标矩形重叠
  // ——空的全屏 dock 容器不把它拽走。
  const box=page.locator('#ann-box');
  await expect(box).toHaveAttribute('data-placement','anchor');
  const cardBox=await page.locator('[data-screen="cards"] [data-card]').first().boundingBox();
  const composerBox=await box.boundingBox();
  expect(composerBox.x+composerBox.width<=cardBox.x || composerBox.x>=cardBox.x+cardBox.width || composerBox.y+composerBox.height<=cardBox.y || composerBox.y>=cardBox.y+cardBox.height).toBe(true);
  await page.locator('#ann-input').press('End');
  await page.keyboard.insertText('检查组合居中');
  await page.locator('#ann-save').click();
  // n 要等保存应答回来再取（M1）：画布账本桶不被本用例清空，桶级计数器里
  // 留着上个 spec 的号，服务端发的号会覆盖客户端的临时号，侧栏行的
  // data-ann-n 随之而变。
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const n=await page.evaluate(()=>window.pinpoint.marks.at(-1).n);
  for(let i=0;i<2;i++) {
    if (i === 1) {
      await page.locator('#wbside-toggle').click();
      // 栏宽过渡期间浏览器会夹紧 stage 的 scrollLeft，正好打断跳转的弹簧动画
      // （外部改动 >1px 即取消）：等 clientWidth 两次采样相等再点行。
      await expect.poll(()=>page.evaluate(async ()=>{
        const stage=document.querySelector('#wbstage');
        const before=stage.clientWidth;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        return stage.clientWidth===before;
      })).toBe(true);
    }
    await page.locator('#wbann-count').click();
    await page.locator('.wb-ann-item-main[data-ann-n="'+n+'"]').click();
    await expect(page.locator('#ann-box')).toBeVisible();
    await expect(page.locator('#wbann-pop')).toBeVisible();
    await page.locator('#wbann-count').click();
    await expect(page.locator('#wbann-pop')).toHaveCount(0);
    await expect(page.locator('#ann-box')).toBeVisible();
    // 几何读取包进轮询：composer 在弹簧动画期间 visibility:hidden，落定后才
    // 可见，但 scroll 位置被外部改动 >1px 时动画会提前取消、几何停在半路 ——
    // 一次性读取在负载下会读到中间态，轮询等到落定值为止；scroll 位置取
    // 落定那一拍，给后面「输入不移画布」当基准。
    const settled={left:0,top:0};
    await expect.poll(async ()=>{
      const g=await page.evaluate(()=>{
        const t=document.querySelector('.ann-draft-target').getBoundingClientRect(),c=document.querySelector('#ann-box').getBoundingClientRect(),strip=document.querySelector('#wbstrip').getBoundingClientRect(),stage=document.querySelector('#wbstage');
        const sr=stage.getBoundingClientRect();
        return {x:(Math.min(t.left,c.left)+Math.max(t.right,c.right))/2,y:(Math.min(t.top,c.top)+Math.max(t.bottom,c.bottom))/2,wantX:(sr.left+sr.right)/2,wantY:(sr.top+24+Math.min(sr.bottom-24,strip.top-12))/2,left:stage.scrollLeft,top:stage.scrollTop};
      });
      settled.left=g.left;settled.top=g.top;
      return Math.max(Math.abs(g.x-g.wantX),Math.abs(g.y-g.wantY));
    }).toBeLessThan(5);
    await page.locator('#ann-input').press('End');
    await page.keyboard.insertText('\n继续输入，不移动画布\n第三行');
    await expect.poll(()=>page.evaluate(()=>({left:document.querySelector('#wbstage').scrollLeft,top:document.querySelector('#wbstage').scrollTop}))).toEqual({left:settled.left,top:settled.top});
    await page.locator('#ann-cancel').click();
  }
});
