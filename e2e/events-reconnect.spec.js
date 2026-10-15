import { expect, test } from './lib/fixtures.js';
import { closeSettled } from './ledger-settle.js';
import { pageKeyFromPathname } from '../src/shared/annotate-page-key.js';

const ENTRY = 'e2e-html_pages';
const DOC_PATH = `/sites/${ENTRY}/long-page.html`;
const KEY = pageKeyFromPathname(DOC_PATH);
const row = { id: 'p3-reconnect', type: 'element', selector: '#top-title', text: '标题', content: '原稿', status: 'open' };

test.afterEach(async ({ page }) => { await closeSettled(page); });

for (const shared of [true, false]) {
  test(`${shared ? '共享' : '独立'} SSE 重连补读漏掉的 revision，保留补读期间的本地编辑与 agent 回复`, async ({ page, request }) => {
    const markId = `${row.id}-${shared ? 'shared' : 'own'}`;
    const read = async () => (await request.get(`/annotations/${KEY}?entry=${ENTRY}`)).json();
    const save = async (annotations, revision) => {
      const res = await request.post('/save', { data: { entry: ENTRY, page: KEY, path: DOC_PATH, baseRevision: revision, annotations } });
      expect(res.ok()).toBe(true);
      return res.json();
    };
    const reply = async (text, revision) => {
      const res = await request.post(`/annotations/${KEY}/${markId}/reply`, { data: { entry: ENTRY, baseRevision: revision, text } });
      expect(res.ok()).toBe(true);
      return read();
    };
    const initial = await save([{ ...row, id: markId }], (await read()).revision);
    await page.addInitScript(() => {
      window.EventSource = class {
        static OPEN = 1;
        readyState = 1;
        constructor() { window.__eventSource = this; queueMicrotask(() => this.onopen?.()); }
        addEventListener() {}
        close() {}
      };
    });
    await page.route('**/p3-reconnect-harness', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <script>var listeners = new Set(); window.workbench = { subscribeEvents(fn) { listeners.add(fn); fn({type:'status',online:true}); return () => listeners.delete(fn); } };
      window.statusToChild = online => listeners.forEach(fn => fn({type:'status',online}));</script>
      <iframe ${shared ? 'data-pp-parent-events' : ''} style="width:800px;height:700px" src="${DOC_PATH}"></iframe>` }));
    await page.goto('/p3-reconnect-harness');
    const frame = page.frameLocator('iframe');
    const state = () => frame.locator('body').evaluate(() => window.pinpoint?.getState());
    await expect.poll(async () => (await state())?.connected).toBe(true);
    await expect.poll(async () => (await state())?.revision).toBe(initial.revision);
    const status = async online => {
      if (shared) await page.evaluate(on => window.statusToChild(on), online);
      else await frame.locator('body').evaluate((_, on) => {
        window.__eventSource.readyState = on ? 1 : 0;
        window.__eventSource[on ? 'onopen' : 'onerror']();
      }, online);
    };
    await expect.poll(async () => { const s = await state(); return !s.syncing && !s.lastRectPending; }).toBe(true);
    const settled = await read();
    await status(false);
    const missed = await reply('断线期间的回复', settled.revision);
    await status(true);
    await expect.poll(async () => (await state()).revision).toBe(missed.revision);
    expect(await frame.locator('body').evaluate(() => window.pinpoint.annotations[0].messages.find(m => m.who === 'agent').text)).toBe('断线期间的回复');

    await status(false);
    const remote = await reply('第二条回复', (await read()).revision);
    let releaseRead, releaseSave;
    const readGate = new Promise(resolve => { releaseRead = resolve; });
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    let requested = false, saving = false;
    await page.route('**/annotations/**', async route => { requested = true; await readGate; await route.fulfill({ json: remote }); });
    await page.route('**/save', async route => { saving = true; await saveGate; await route.continue(); });
    try {
      await status(true);
      await expect.poll(() => requested).toBe(true);
      await frame.locator('body').evaluate(() => window.pinpoint.openMark(window.pinpoint.annotations[0].n));
      await frame.locator('#ann-input').fill('补读期间的本地编辑');
      await frame.locator('#ann-close').click();
      await expect.poll(() => saving).toBe(true);
      releaseRead();
      await expect.poll(async () => (await state()).connected).toBe(true);
      expect(await frame.locator('body').evaluate(() => window.pinpoint.annotations[0].content)).toContain('补读期间的本地编辑');
      releaseSave();
      await expect.poll(async () => (await read()).annotations[0].content).toContain('补读期间的本地编辑');
      expect((await read()).annotations[0].messages.filter(m => m.who === 'agent').map(m => m.text)).toEqual(['断线期间的回复', '第二条回复']);
    } finally { releaseRead(); releaseSave(); }
  });
}
