import { expect, test } from './lib/fixtures.js';
import fs from 'node:fs/promises';
import { E2E_DATA_DIR } from './env.js';
test('canvas diagnostics survive reload and export bounded metadata without page content',async({page})=>{
  await page.goto('/workbench/?page=e2e-ios');
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
  // 扣住 reload 的板直到首次读取诊断采样，确定性覆盖“诊断对象先于板就绪”。
  let releaseBoard;
  const boardGate=new Promise(resolve=>{releaseBoard=resolve;});
  let boardHits=0;
  await page.route('**/board.json',async route=>{boardHits++;await boardGate;await route.continue();});
  await page.exposeFunction('releaseDiagnosticBoard',()=>releaseBoard());
  try {
    await page.reload();
    await page.waitForFunction(()=>window.workbench?.diagnostics);
    await expect.poll(()=>boardHits).toBeGreaterThan(0);
    await page.evaluate(()=>{
      const diagnostics=window.workbench.diagnostics, snapshot=diagnostics.snapshot;
      diagnostics.snapshot=()=>{window.releaseDiagnosticBoard();return snapshot();};
    });
    await page.waitForFunction(()=>{
      const report=window.workbench.diagnostics.snapshot();
      return Boolean(document.querySelector('.wb-zoom-wrap .wb-screen')) &&
        report.current.events.some(e=>e.type==='viewport'&&e.wrap?.rect.length===4);
    });
    await page.locator('#wbgear').click();
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'导出诊断日志',exact:true}).click();
    const report=JSON.parse(await fs.readFile(await (await download).path(),'utf8'));
    expect(report.previous.started).toBe(before.current.started);
    expect(report.current.events.some(e=>e.type==='incident')).toBe(true);
    expect(report.current.events.length).toBeLessThanOrEqual(720);
    expect(report.current.events.some(e=>e.type==='viewport'&&e.wrap?.rect.length===4)).toBe(true);
  } finally {releaseBoard();await page.unroute('**/board.json');}
});
