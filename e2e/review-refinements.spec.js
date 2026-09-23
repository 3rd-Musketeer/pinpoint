import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_DATA_DIR } from './env.js';
import { pageKeyFromPathname } from '../src/shared/annotate-page-key.js';

// These stories deliberately create and invalidate DOM targets. Their ledger
// must not survive into another story with a fresh document.
test.beforeEach(() => fs.rmSync(path.join(E2E_DATA_DIR, 'e2e-dir'), { recursive: true, force: true }));
test.afterEach(async ({page}) => {
  if (!page.isClosed()) {
    await page.waitForFunction(() => !window.pinpoint || !window.pinpoint.getState().syncing);
    await page.close();
  }
});

// A reviewer keeps a frequently used page handy, hides it after review, and
// later restores it without changing its source or registration.
test('page pin, archive and restore survive reload without deleting the page', async ({ page, request }) => {
  const before = await (await request.get('/registry')).json();
  await page.goto('/index.html?page=e2e-dir-ios');
  const row = page.locator('[data-vpage="e2e-dir-ios"]');
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.locator('[data-pin-page="e2e-dir-ios"]').click();
  await expect(page.locator('.wb-pinned-pages [data-vpage="e2e-dir-ios"]')).toBeVisible();
  await row.click({ button: 'right' });
  await page.locator('[data-archive-page="e2e-dir-ios"]').click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('tab', {name:'已归档'})).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.getByRole('tab', {name:'已归档'}).click();
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.locator('[data-archive-page="e2e-dir-ios"]').click();
  await expect(row).toHaveCount(0);
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await expect(page.locator('.wb-pinned-pages [data-vpage="e2e-dir-ios"]')).toBeVisible();
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await expect(row).not.toBeVisible();
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  const sidebar = await page.locator('#wbside').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(sidebar.x);
  expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
  // 钉/存档/恢复不该动登记表：比内容，不比 dir 条目的 mtime——那是登记目录
  // 本身的 mtime，并行跑时另一组 runner 往仓库根写产物就会顶新它（与登记表
  // 是否被改写无关）。
  const withoutMtime = (doc) => JSON.stringify(doc.entries.map(({ mtime, ...rest }) => rest));
  expect(withoutMtime(await (await request.get('/registry')).json())).toBe(withoutMtime(before));
  await page.screenshot({ path: test.info().outputPath('navigation.png') });
});

// Exercise the shipped export CLI against the isolated running application.
test('reviewer exports a frame as an actual PNG', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const fs = await import('node:fs/promises');
  const { E2E_BASE_URL } = await import('./env.js');
  const output = test.info().outputPath('export-cards.png');
  const result = await promisify(execFile)(process.execPath, [
    'scripts/export-preview.mjs', '--url', E2E_BASE_URL,
    '--page', 'e2e-dir-ios', '--section', 'main', '--frame', 'cards',
    '--output', output,
  ]);
  expect(result.stdout).toContain('image/png');
  const bytes = await fs.readFile(output);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.readUInt32BE(16)).toBeGreaterThan(300);
  expect(bytes.readUInt32BE(20)).toBeGreaterThan(500);
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

test('composer remains clickable above the reviewed page popup', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(() => {
    const popup=document.createElement('div'); popup.id='reviewed-popup';
    popup.style.cssText='position:fixed;inset:0;background:#eee;z-index:2147483647';
    popup.innerHTML='<button id="popup-target" style="position:absolute;left:180px;top:200px;width:180px;height:60px">页面弹窗按钮</button>';
    document.body.appendChild(popup);
    window.pinpoint.setMode(true);
  });
  await page.locator('#popup-target').click();
  const input=page.getByRole('textbox',{name:'写标注'});
  await input.fill('弹窗按钮改成继续');
  const send=page.getByRole('button',{name:'发送标注',exact:true});
  const hit=await send.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  expect(hit).toBe(true);
  await send.click();
  expect(await page.evaluate(()=>window.pinpoint.marks.at(-1).content)).toContain('弹窗按钮改成继续');
});

test('pp2 状态机：mark 端点 open → check → done 带 note，非法转换 409，编辑回 open', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));
  await page.locator('#doc-title').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('增加气泡、修改正文、移动标题，并删除旧按钮');
  await page.getByRole('button',{name:'发送标注',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const original=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  expect(original.status).toBe('open');
  expect(original.n).toBeGreaterThanOrEqual(1);
  const ledger=pageKeyFromPathname('/sites/e2e-dir/doc.html');

  // open → check（带 note）
  let rev=await page.evaluate(()=>window.pinpoint.getState().revision);
  let res=await page.request.post(`/annotations/${ledger}/${original.n}/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'check',note:'看过，不改'}});
  expect(res.status()).toBe(200);
  let body=await res.json();
  expect(body.annotation.status).toBe('check');
  expect(body.annotation.note).toBe('看过，不改');

  // check → done
  rev=await page.evaluate(()=>window.pinpoint.getState().revision);
  res=await page.request.post(`/annotations/${ledger}/${original.n}/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'done'}});
  expect(res.status()).toBe(200);
  expect((await res.json()).annotation.status).toBe('done');

  // 非法：done → done / 端点写 close / 未知 id / 过期 revision
  rev=await page.evaluate(()=>window.pinpoint.getState().revision);
  expect((await page.request.post(`/annotations/${ledger}/${original.n}/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'done'}})).status()).toBe(409);
  expect((await page.request.post(`/annotations/${ledger}/${original.n}/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'close'}})).status()).toBe(400);
  expect((await page.request.post(`/annotations/${ledger}/999/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'check'}})).status()).toBe(404);
  expect((await page.request.post(`/annotations/${ledger}/${original.n}/status`,{data:{entry:'e2e-dir',baseRevision:0,status:'check'}})).status()).toBe(409);

  // 列表行出 #n 序号 + done 灰标 + hover note
  await page.keyboard.press('s');
  const row=page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+original.n+'"]');
  await expect(row.locator('.wb-ann-status-tag')).toHaveText('done');
  await expect(row).toHaveAttribute('title','看过，不改');

  // owner 编辑正文 → 自动回 open
  await page.evaluate(n=>window.pinpoint.openMark(n),original.n);
  await page.locator('#ann-input').fill('改过的正文');
  await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(id=>window.pinpoint.marks.find(m=>m.id===id).status,original.id)).toBe('open');
});

test('pp2 状态机：done 行点完成 → toast（已完成）撤销回 done；close 收进「已关闭 n」开关组', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));
  await page.locator('#doc-title').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('走完关闭流程的意见');
  await page.getByRole('button',{name:'发送标注',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const n=await page.evaluate(()=>window.pinpoint.marks.at(-1).n);
  const ledger=pageKeyFromPathname('/sites/e2e-dir/doc.html');

  // open → check → done（只经 mark 端点，SSE 把变更推回页面）
  let rev=await page.evaluate(()=>window.pinpoint.getState().revision);
  await page.request.post(`/annotations/${ledger}/${n}/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'check'}});
  rev=await page.evaluate(()=>window.pinpoint.getState().revision);
  await page.request.post(`/annotations/${ledger}/${n}/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'done'}});
  await page.keyboard.press('s');
  const row=page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+n+'"]');
  await expect(row.locator('.wb-ann-status-tag')).toHaveText('done');

  // done 行「完成」勾单击 → 行退出 open 列表（close 收起），toast 出「撤销」
  // （acts 列 hover 才 pointer-events:auto，先 hover 行再点）
  await row.hover();
  await row.locator('.wb-ann-done').click();
  await expect(page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+n+'"]')).toHaveCount(0);
  await expect(page.locator('#ann-sidebar .wb-ann-closed-toggle')).toHaveText(/已关闭 1/);
  const toast=page.locator('#ann-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('已完成 #'+n);

  // 撤销 → close 回关闭前的原态（这行关前是 done），行回到列表，toast 收起
  await toast.locator('button').click();
  await expect.poll(()=>page.evaluate(n=>window.pinpoint.marks.find(m=>m.n===n).status,n)).toBe('done');
  await expect(page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+n+'"]')).toHaveCount(1);
  await expect(toast).toBeHidden();
  // 撤销触发的 save 回包落定、revision 归位后再做下一步写状态动作。
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);

  // 不撤销再来一遍（撤销后行已是 done，直接再点「完成」）：行收进「已关闭 1」，点开关展开可见
  await expect(page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+n+'"] .wb-ann-done')).toBeVisible();
  await page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+n+'"]').hover();
  await page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+n+'"] .wb-ann-done').click();
  await expect(page.locator('#ann-sidebar .wb-ann-closed-toggle')).toHaveText(/已关闭 1/);
  await page.locator('#ann-sidebar .wb-ann-closed-toggle').click();
  await expect(page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+n+'"]')).toHaveCount(1);
});

test('reviewer clears only wholly invalid annotations and can delete then reannotate', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(()=>{
    window.pinpoint.setMode(true);
    ['stale','hidden','replaced'].forEach(id=>{
      const el=document.createElement('button');el.id='review-'+id;el.textContent=id;el.style.margin='20px';document.querySelector('#doc-target').after(el);
    });
  });
  const ids={};
  for (const kind of ['stale','hidden','replaced']) {
    await page.locator('#review-'+kind).click();
    await page.getByRole('textbox',{name:'写标注'}).fill('修改 '+kind);
    await page.getByRole('button',{name:'发送标注',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
    ids[kind]=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
  }
  await page.evaluate(()=>{
    document.querySelector('#review-stale').remove();
    document.querySelector('#review-replaced').remove();
    document.querySelector('#review-hidden').style.display='none';
    window.pinpoint.render();
  });
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().countInvalid)).toBe(2);
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(2);
  const remaining=await page.evaluate(()=>window.pinpoint.marks.map(m=>m.id));
  expect(remaining).not.toContain(ids.stale);
  expect(remaining).toContain(ids.hidden);
  expect(remaining).not.toContain(ids.replaced);
  await page.locator('#doc-target').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('重新标注：再精简一点');
  await page.getByRole('button',{name:'发送标注',exact:true}).click();
  const fresh=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  expect(fresh.id).not.toBe(ids.replaced);
  expect(fresh.status).toBe('open');
});


test('canvas composer fits beside its DOM target despite an empty fullscreen dock container', async ({page}) => {
  await page.goto('/index.html?page=e2e-dir-ios');
  await page.waitForFunction(()=>window.workbench && window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));
  const target=page.locator('[data-screen="cards"] [data-card]').first();
  await target.click();
  const box=page.locator('#ann-box');
  await expect(box).toHaveAttribute('data-placement','anchor');
  const a=await target.boundingBox(), b=await box.boundingBox();
  expect(b.x+b.width<=a.x || b.x>=a.x+a.width || b.y+b.height<=a.y || b.y>=a.y+a.height).toBe(true);
});


test('reviewer can type and save on a native modal dialog, then annotate the page again', async ({page}) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>{
    const dialog=document.createElement('dialog');dialog.id='review-native-dialog';
    dialog.innerHTML='<button id="review-native-button">确认选择</button>';
    dialog.style.cssText='padding:60px';document.body.appendChild(dialog);dialog.showModal();
    window.pinpoint.setMode(true);
  });
  await page.locator('#review-native-button').click();
  const input=page.getByRole('textbox',{name:'写标注'});
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

test('a concurrent ledger write rejects a stale status write without overwriting the other edit', async ({page,request}) => {
  await page.goto('/sites/e2e-dir/doc.html');await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));await page.locator('#doc-title').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('请改标题');await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const mark=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  const staleRev=await page.evaluate(()=>window.pinpoint.getState().revision);

  // 另一个窗口先把账本推进一格（正文改写 + revision+1）。
  const ledger=pageKeyFromPathname('/sites/e2e-dir/doc.html');
  const doc=await page.request.get(`/annotations/${ledger}?entry=e2e-dir`).then(r=>r.json());
  const other=await request.post('/save',{data:{page:ledger,entry:'e2e-dir',path:'/sites/e2e-dir/doc.html',baseRevision:staleRev,annotations:doc.annotations.map(m=>({...m,content:'另一窗口更新后的意见'}))}});
  expect(other.ok()).toBe(true);

  // 拿着旧 revision 的 mark 写入被 409 拒掉，另一窗口的改动原样保留。
  const stale=await request.post(`/annotations/${ledger}/${mark.n}/status`,{data:{entry:'e2e-dir',baseRevision:staleRev,status:'check'}});
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toBe('revision_conflict');
  const after=await page.request.get(`/annotations/${ledger}?entry=e2e-dir`).then(r=>r.json());
  expect(after.annotations[0].content).toBe('另一窗口更新后的意见');
  expect(after.annotations[0].status).toBe('open');
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

  // 点列表行仍跳到最后位置（页面滚回幽灵处），行标「锚点失效」照旧。
  await page.keyboard.press('s');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+before.n+'"] .wb-ann-item-main').click();
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('#ann-sidebar .wb-ann-item[data-ann-n="'+before.n+'"] .wb-ann-broken-tag')).toHaveText('锚点失效');

  // 行点击打开了 composer；clearInvalid 在有草稿时拒动 —— 先关掉。
  await page.evaluate(()=>window.pinpoint.cancelDraft());

  // 失效不等于已解决：幽灵框不是免死牌，clearInvalid 照样清它。
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().countInvalid)).toBe(1);
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(1);
  await expect(page.locator('.ann-ghost-rect')).toHaveCount(0);
});

test('R5：done / close 的失效标注不被 clearInvalid 清掉（执行历史留给 owner 验收）', async ({page}) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));
  await page.locator('#doc-target-2').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('按标注删掉这个目标');
  await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const mark=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  const ledger=pageKeyFromPathname('/sites/e2e-dir/doc.html');
  // agent 干完活：mark 端点推进到 done。
  let rev=await page.evaluate(()=>window.pinpoint.getState().revision);
  const res=await page.request.post(`/annotations/${ledger}/${mark.n}/status`,{data:{entry:'e2e-dir',baseRevision:rev,status:'done'}});
  expect(res.status()).toBe(200);
  await expect.poll(()=>page.evaluate(id=>window.pinpoint.marks.find(m=>m.id===id).status,mark.id)).toBe('done');
  // 目标按标注删掉 → 锚点失效是干完活的常态形态，但 done 的账不能一键清掉。
  // 失效重算是异步的一拍：轮询到安定值，不用固定等待。
  await page.evaluate(()=>{document.querySelector('#doc-target-2').remove();});
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().countInvalid)).toBe(0);
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(0);
  expect(await page.evaluate(id=>window.pinpoint.marks.some(m=>m.id===id),mark.id)).toBe(true);
});

test('invalid cleanup retains partial targets and scopes that are loading or temporarily absent', async ({page}) => {
  await page.goto('/sites/e2e-dir/doc.html');await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>{
    window.pinpoint.setMode(true);
    const el=document.createElement('button');el.id='guard-temporary';el.textContent='temporary';document.body.appendChild(el);
    const frame=document.createElement('div');frame.className='wb-screen';frame.dataset.screen='lazy-result';
    frame.innerHTML='<div id="lazy-result-target">执行后的内容</div>';document.body.appendChild(frame);
  });
  await page.locator('#doc-title').click();
  const input=page.getByRole('textbox',{name:'写标注'});
  await input.fill('保留第二个目标仍有效的意见');
  await page.locator('#doc-target').click();
  await expect(input.locator('[data-target-ref]')).toHaveCount(2);
  await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const partial=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
  await page.locator('#guard-temporary').click();await input.fill('修改 temporary');await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const temporary=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
  // 蓝框退役前，缺席作用域经 recordResults 的结果目标表达；现在直接把标注打进
  // 稍后会缺席的 frame，clearInvalid 的保守判定同一规则：frame 未加载不清理。
  await page.locator('#lazy-result-target').click();await input.fill('标在将缺席的 frame 里');await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const absentScope=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
  await page.evaluate(()=>{
    document.querySelector('#doc-title').remove();
    document.querySelector('#guard-temporary').remove();
    document.querySelector('[data-screen="lazy-result"]').remove();
    document.body.dataset.loading='true';window.pinpoint.render();
  });
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(0);
  await page.evaluate(()=>{delete document.body.dataset.loading;window.pinpoint.render();});
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(1);
  const remaining=await page.evaluate(()=>window.pinpoint.marks.map(m=>m.id));
  expect(remaining).toContain(partial);expect(remaining).toContain(absentScope);expect(remaining).not.toContain(temporary);
});


test('the injected sidebar opens annotations, rows complete instead of deleting and can toggle while composing', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/sites/e2e-dir/doc.html');await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));await page.locator('#doc-title').click();
  const input=page.getByRole('textbox',{name:'写标注'});await input.fill('直接网页标注');
  await page.evaluate(()=>window.pinpoint.toggleSidebar());
  await expect(input).toBeVisible();await expect(page.locator('#ann-sidebar')).toBeVisible();
  await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const mark=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  await page.locator('#ann-sidebar .wb-ann-item-main').click();
  await expect(input).toBeVisible();await expect(page.locator('#ann-sidebar')).toBeVisible();
  await page.locator('#ann-cancel').click();
  // 行级删除退役（与工作台弹层一致）：行尾是「完成 #n」勾，没有垃圾桶与两段确认。
  await page.locator('#ann-sidebar .wb-ann-item').hover();
  await expect(page.getByRole('button',{name:'完成 #'+mark.n,exact:true})).toBeVisible();
  await expect(page.locator('#ann-sidebar .ann-sb-del')).toHaveCount(0);
  // 行上删不掉了；单条删除收进 composer 的删除钮。
  await page.locator('#ann-sidebar .wb-ann-item-main').click();
  await page.locator('#ann-del').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.marks.length)).toBe(0);
  expect(errors).toEqual([]);
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
  await page.locator('#ann-input').press('End');
  await page.keyboard.insertText('检查组合居中');
  await page.locator('#ann-save').click();
  // n 要等保存应答回来再取（M1）：画布账本桶不被本用例清空，桶级计数器里
  // 留着上个 spec 的号，服务端发的号会覆盖客户端的临时号，侧栏行的
  // data-ann-n 随之而变。
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const n=await page.evaluate(()=>window.pinpoint.marks.at(-1).n);
  for(let i=0;i<2;i++) {
    if (i === 1) await page.locator('#wbside-toggle').click();
    await page.locator('#wbann-count').click();
    await page.locator('.wb-ann-item-main[data-ann-n="'+n+'"]').click();
    await expect(page.locator('#ann-box')).toBeVisible();
    await expect(page.locator('#wbann-pop')).toBeVisible();
    await page.locator('#wbann-count').click();
    await expect(page.locator('#wbann-pop')).toHaveCount(0);
    await expect(page.locator('#ann-box')).toBeVisible();
    const geometry=await page.evaluate(()=>{
      const t=document.querySelector('.ann-draft-target').getBoundingClientRect(),c=document.querySelector('#ann-box').getBoundingClientRect(),strip=document.querySelector('#wbstrip').getBoundingClientRect(),stage=document.querySelector('#wbstage');
      const sr=stage.getBoundingClientRect();
      return {x:(Math.min(t.left,c.left)+Math.max(t.right,c.right))/2,y:(Math.min(t.top,c.top)+Math.max(t.bottom,c.bottom))/2,wantX:(sr.left+sr.right)/2,wantY:(sr.top+24+Math.min(sr.bottom-24,strip.top-12))/2,left:stage.scrollLeft,top:stage.scrollTop};
    });
    expect(Math.abs(geometry.x-geometry.wantX)).toBeLessThan(5);
    expect(Math.abs(geometry.y-geometry.wantY)).toBeLessThan(5);
    await page.locator('#ann-input').press('End');
    await page.keyboard.insertText('\n继续输入，不移动画布\n第三行');
    await expect.poll(()=>page.evaluate(()=>({left:document.querySelector('#wbstage').scrollLeft,top:document.querySelector('#wbstage').scrollTop}))).toEqual({left:geometry.left,top:geometry.top});
    await page.locator('#ann-cancel').click();
  }
});
