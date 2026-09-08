import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import { E2E_DATA_DIR } from './env.js';
test('canvas diagnostics survive reload and export bounded metadata without page content',async({page})=>{
  await page.goto('/index.html?page=library');
  await page.waitForFunction(()=>window.workbench?.diagnostics);
  await page.evaluate(()=>{
    const stage=document.getElementById('wbstage');
    const secret=document.createElement('p');secret.textContent='PRIVATE-DIAGNOSTIC-TEXT';stage.append(secret);
    for(let i=0;i<100;i++)stage.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(()=>page.evaluate(()=>window.workbench.diagnostics.snapshot().current.events.filter(e=>e.type==='viewport').length)).toBeGreaterThan(0);
  const before=await page.evaluate(()=>window.workbench.diagnostics.snapshot());
  expect(before.current.events.length).toBeLessThan(50);
  expect(JSON.stringify(before)).not.toContain('PRIVATE-DIAGNOSTIC-TEXT');
  await expect.poll(async()=>{
    const text=await fs.readFile(`${E2E_DATA_DIR}/diagnostics/canvas.ndjson`,'utf8').catch(()=> '');
    expect(text).not.toContain('PRIVATE-DIAGNOSTIC-TEXT');
    return text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))
      .some(batch=>batch.started===before.current.started&&batch.events.some(e=>e.type==='viewport'));
  }).toBe(true);
  await page.reload();
  await page.waitForFunction(()=>window.workbench?.diagnostics);
  await page.locator('#wbgear').click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出诊断日志',exact:true}).click();
  const report=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));
  expect(report.previous.started).toBe(before.current.started);
  expect(report.current.events.some(e=>e.type==='incident')).toBe(true);
  expect(report.current.events.length).toBeLessThanOrEqual(720);
  expect(report.current.events.some(e=>e.type==='viewport'&&e.wrap?.rect.length===4)).toBe(true);
});
