import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { E2E_DATA_DIR } from './env.js';

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
  await expect(page.locator('[data-show-archived]')).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.locator('[data-show-archived]').click();
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.locator('[data-archive-page="e2e-dir-ios"]').click();
  await expect(row).toHaveCount(0);
  await page.locator('[data-show-archived]').click();
  await expect(page.locator('.wb-pinned-pages [data-vpage="e2e-dir-ios"]')).toBeVisible();
  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  await expect(row).not.toBeVisible();
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  const sidebar = await page.locator('#wbside').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(sidebar.x);
  expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
  expect(await (await request.get('/registry')).json()).toEqual(before);
  await page.screenshot({ path: '.tmp/review-refinements/navigation.png' });
});

// Exercise the shipped export CLI against the isolated running application.
test('reviewer exports a frame as an actual PNG', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const fs = await import('node:fs/promises');
  const { E2E_BASE_URL } = await import('./env.js');
  const output = '.tmp/review-refinements/export-cards.png';
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
  await page.screenshot({path:'.tmp/review-refinements/composer-dock.png'});
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
  await page.screenshot({path:'.tmp/review-refinements/composer-rich.png'});
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

test('agent reports added, modified, moved and deleted results without replacing the original annotation', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));
  await page.locator('#doc-title').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('增加气泡、修改正文、移动标题，并删除旧按钮');
  await page.getByRole('button',{name:'发送标注',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const original=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  await page.evaluate(()=>{
    const bubble=document.createElement('div');bubble.id='agent-added-bubble';bubble.textContent='新增的对话气泡';bubble.style.cssText='margin:20px;padding:20px;background:#dbeafe';document.querySelector('#doc-target').after(bubble);
    document.querySelector('#doc-target').textContent='修改后的正文';
    document.querySelector('#doc-title').style.marginLeft='80px';
  });
  const report=await page.evaluate(async id=>{
    return window.pinpoint.recordResults(id,[
      {action:'add',targets:[{selector:'#agent-added-bubble'}]},
      {action:'modify',targets:[{selector:'#doc-target'}]},
      {action:'move',targets:[{selector:'#doc-title'}]},
      {action:'delete',targets:[]},
    ],{baseRevision:window.pinpoint.getState().revision});
  },original.id);
  expect(report.id).toBe(original.id);
  const updated=await page.evaluate(id=>window.pinpoint.marks.find(m=>m.id===id),original.id);
  expect(updated.content).toBe(original.content);
  expect(updated.targets).toEqual(original.targets);
  await expect(page.locator('[data-result-annotation="'+original.id+'"]')).toHaveCount(3);
  const invalid=await page.evaluate(async id=>{
    try { await window.pinpoint.recordResults(id,[{action:'add',targets:[{selector:'p'}]}],{baseRevision:window.pinpoint.getState().revision});return ''; } catch(e) {return e.message;}
  },original.id);
  expect(invalid).toContain('unique');
  const stale=await page.evaluate(async id=>{
    try { await window.pinpoint.recordResults(id,[{action:'delete'}],{baseRevision:0});return ''; } catch(e) {return e.message;}
  },original.id);
  expect(stale).toContain('revision_conflict');
  await page.evaluate(id=>window.pinpoint.openMark(window.pinpoint.marks.find(m=>m.id===id).n),original.id);
  await expect(page.locator('[data-result-summary]')).toHaveText('已增加 · 已修改 · 已移动 · 已删除');
  await page.screenshot({path:'.tmp/review-refinements/result-indicators.png'});
});

test('reviewer clears only wholly invalid annotations and can delete then reannotate a result', async ({ page }) => {
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
  await page.evaluate(async id=>{
    await window.pinpoint.recordResults(id,[{action:'modify',targets:[{selector:'#doc-target'}]}],{baseRevision:window.pinpoint.getState().revision});
    document.querySelector('#review-stale').remove();
    document.querySelector('#review-replaced').remove();
    document.querySelector('#review-hidden').style.display='none';
    window.pinpoint.render();
  },ids.replaced);
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().countInvalid)).toBe(1);
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(1);
  const remaining=await page.evaluate(()=>window.pinpoint.marks.map(m=>m.id));
  expect(remaining).not.toContain(ids.stale);
  expect(remaining).toContain(ids.hidden);
  expect(remaining).toContain(ids.replaced);
  await page.evaluate(id=>window.pinpoint.removeMark(window.pinpoint.marks.find(m=>m.id===id).n),ids.replaced);
  await expect(page.locator('[data-result-annotation="'+ids.replaced+'"]')).toHaveCount(0);
  await page.locator('#doc-target').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('重新标注：再精简一点');
  await page.getByRole('button',{name:'发送标注',exact:true}).click();
  const fresh=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  expect(fresh.id).not.toBe(ids.replaced);
  expect(fresh.result).toBeUndefined();
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

test('a concurrent ledger write rejects stale agent results without overwriting the other edit', async ({page,request}) => {
  await page.goto('/sites/e2e-dir/doc.html');await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));await page.locator('#doc-title').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('请改标题');await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  let held;
  await page.route('**/save',route=>{held=route;});
  await page.evaluate(()=>{
    const mark=window.pinpoint.marks.at(-1);
    window.reportPromise=window.pinpoint.recordResults(mark.id,[{action:'modify',targets:[{selector:'#doc-title'}]}],{baseRevision:window.pinpoint.getState().revision}).then(()=>({ok:true}),e=>({error:e.message}));
  });
  await expect.poll(()=>!!held).toBe(true);
  const pending=held.request().postDataJSON();
  const other={...pending,annotations:pending.annotations.map(m=>{const copy={...m,content:'另一窗口更新后的意见'};delete copy.result;return copy;})};
  const response=await request.post('/save',{data:other});expect(response.ok()).toBe(true);
  await held.continue();
  const result=await page.evaluate(()=>window.reportPromise);expect(result.error).toContain('revision_conflict');
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.marks.at(-1).content)).toBe('另一窗口更新后的意见');
  expect(await page.evaluate(()=>window.pinpoint.marks.at(-1).result)).toBeUndefined();
  await page.unroute('**/save');
});


test('an intentional deletion remains an execution result instead of an invalid annotation to clear', async ({page}) => {
  await page.goto('/sites/e2e-dir/doc.html');await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>window.pinpoint.setMode(true));await page.locator('#doc-title').click();
  await page.getByRole('textbox',{name:'写标注'}).fill('删除这个标题');await page.locator('#ann-save').click();
  await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
  const before=await page.evaluate(()=>window.pinpoint.marks.at(-1));
  await page.evaluate(async id=>{
    document.querySelector('#doc-title').remove();
    await window.pinpoint.recordResults(id,[{action:'delete'}],{baseRevision:window.pinpoint.getState().revision});
  },before.id);
  expect(await page.evaluate(()=>window.pinpoint.getState().countInvalid)).toBe(0);
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(0);
  await page.evaluate(n=>window.pinpoint.openMark(n),before.n);
  await expect(page.locator('[data-result-summary]')).toHaveText('已删除');
  await expect(page.locator('#ann-box')).not.toContainText('锚点失效');
  expect(await page.evaluate(()=>window.pinpoint.marks.at(-1).content)).toBe(before.content);
});

test('invalid cleanup retains partial targets and scopes that are loading or temporarily absent', async ({page}) => {
  await page.goto('/sites/e2e-dir/doc.html');await page.waitForFunction(()=>window.pinpoint);
  await page.evaluate(()=>{
    window.pinpoint.setMode(true);
    for(const id of ['temporary','absent']){const el=document.createElement('button');el.id='guard-'+id;el.textContent=id;document.body.appendChild(el);}
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
  const ids={};
  for(const kind of ['temporary','absent']){
    await page.locator('#guard-'+kind).click();await input.fill('修改 '+kind);await page.locator('#ann-save').click();
    await expect.poll(()=>page.evaluate(()=>window.pinpoint.getState().syncing)).toBe(false);
    ids[kind]=await page.evaluate(()=>window.pinpoint.marks.at(-1).id);
  }
  await page.evaluate(async id=>{
    await window.pinpoint.recordResults(id,[{action:'modify',targets:[{screenId:'lazy-result',selector:'#lazy-result-target'}]}],{baseRevision:window.pinpoint.getState().revision});
    document.querySelector('#doc-title').remove();
    document.querySelector('#guard-temporary').remove();document.querySelector('#guard-absent').remove();
    document.querySelector('[data-screen="lazy-result"]').remove();
    document.body.dataset.loading='true';window.pinpoint.render();
  },ids.absent);
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(0);
  await page.evaluate(()=>{delete document.body.dataset.loading;window.pinpoint.render();});
  expect(await page.evaluate(()=>window.pinpoint.clearInvalid())).toBe(1);
  const remaining=await page.evaluate(()=>window.pinpoint.marks.map(m=>m.id));
  expect(remaining).toContain(partial);expect(remaining).toContain(ids.absent);expect(remaining).not.toContain(ids.temporary);
});


test('the injected sidebar opens annotations, confirms deletion and can toggle while composing', async ({page}) => {
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
  await page.locator('#ann-sidebar .wb-ann-item').hover();
  const del=page.getByRole('button',{name:'删除标注 '+mark.n,exact:true});
  await expect(del.locator('svg path')).toHaveCount(1);await del.click();
  await expect(page.getByRole('button',{name:'确认删除标注 '+mark.n,exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.pinpoint.marks.length)).toBe(1);
  await page.locator('.ann-sb-close').click();await page.evaluate(()=>window.pinpoint.toggleSidebar());
  await page.locator('#ann-sidebar .wb-ann-item').hover();
  await expect(del).toBeVisible();await del.click();
  await page.getByRole('button',{name:'确认删除标注 '+mark.n,exact:true}).click();
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
  await page.evaluate(()=>window.scrollTo(0,0));
  const badge=page.locator('.ann-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toHaveText(String(mark.n));
  const before=await badge.boundingBox();
  await page.evaluate(()=>window.scrollTo(0,100));
  await expect.poll(async()=>(await badge.boundingBox()).y).toBeCloseTo(before.y-100,0);
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
