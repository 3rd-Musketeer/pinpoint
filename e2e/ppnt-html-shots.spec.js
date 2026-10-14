import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR, E2E_SITES_DIR } from './env.js';
import { ppntResult, ROOT } from './lib/cli.js';
import { countColorPixels } from './png-probe.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// ppnt 对 HTML 页面的三处修复（2026-10-14，hosted-pages 迁成文章之后撞上的）：
// 1. 孤儿标注（所在的文档屏和文件都删了）comments 列得出来，mark / reply 也要指得到；
// 2. 文章只有 HTML 帧时 shot --canvas 不再给一条窄边的画布图，改成逐帧截整页并说明；
// 3. HTML 帧整页截图前放开视口外的懒加载 iframe（含嵌套一层）和图片，等它们加载完。
// 文章固件 e2e/html-site/docs/pinpoint/articles/docs-only/（project e2e-html 常驻共享 registry，只读）；
// 存量页固件是 tabs-doc-site 的一份副本，id 只给本 spec 用，删掉一屏造出孤儿账本。
// 这些都只走 CLI 和服务的 /sites/、/annotations/，不拉起文章站点。
const ARTICLE = 'e2e-html/docs-only';
const ARTICLE_PAGE_ID = 'e2e-html_docs-only';
const ARTICLE_BUCKET = path.join(E2E_DATA_DIR, ARTICLE_PAGE_ID);
const SHOT_DIR = path.join(E2E_DATA_DIR, 'shot', ARTICLE_PAGE_ID);
const DOC_PAGE_ID = 'e2e-orphan-doc';
const DOC_SITE = path.join(E2E_SITES_DIR, 'orphan-doc-site');
const DOC_BUCKET = path.join(E2E_DATA_DIR, DOC_PAGE_ID);

// 退出码由用例自己断言：失败也返回 { code, stdout, stderr }。截图要起浏览器，给足时间。
const ppnt = (args) => ppntResult(args, { timeout: 150_000 });

function writeLedger(bucket, name, doc) {
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, `${name}.json`), JSON.stringify({ page: name, revision: 1, ...doc }));
}

const readLedger = (bucket, name) => JSON.parse(fs.readFileSync(path.join(bucket, `${name}.json`), 'utf8'));

test.afterEach(async ({ request }) => {
  await restoreRegistryFixture(request);
  for (const dir of [DOC_BUCKET, DOC_SITE, ARTICLE_BUCKET, SHOT_DIR]) fs.rmSync(dir, { recursive: true, force: true });
});

test('孤儿标注：屏和文件都删了，comments 列在孤儿里，mark --note / reply / @a: 都能写回它的账本', async ({ request }) => {
  test.setTimeout(120_000);
  fs.rmSync(DOC_SITE, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'e2e', 'tabs-doc-site'), DOC_SITE, { recursive: true });
  // v2 这一屏从 board 里删掉、文件也删掉：它的账本就成了孤儿（lib/orphans.js 的第 1 种）。
  const boardFile = path.join(DOC_SITE, 'board.json');
  const board = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
  board.tabs[0].sections[0].screens = board.tabs[0].sections[0].screens.filter((screen) => screen.id !== 'v2');
  fs.writeFileSync(boardFile, JSON.stringify(board));
  fs.rmSync(path.join(DOC_SITE, 'v2.html'));
  const ledger = 'v2.html_e2eorf';
  writeLedger(DOC_BUCKET, ledger, {
    path: `/sites/${DOC_PAGE_ID}/v2.html`,
    annotations: [
      { id: 'orf001', n: 1, type: 'element', selector: 'h1', text: '第二版', targets: [{ ref: 'i1', selector: 'h1', text: '第二版' }], content: '[@t:i1] 标题再短一点', status: 'open' },
      { id: 'orf002', n: 2, type: 'element', selector: 'p', text: '正文', targets: [{ ref: 'i1', selector: 'p', text: '正文' }], content: '[@t:i1] 这段要列表', status: 'check' },
    ],
  });
  fs.writeFileSync(path.join(DOC_BUCKET, '_seq.json'), JSON.stringify({ next: 3 }));
  appendRegistryEntry({ id: DOC_PAGE_ID, title: 'E2E Orphan Doc', kind: 'dir', path: DOC_SITE, board: 'html' });
  await request.post('/registry/reload');

  await test.step('comments --status all 把两条列在孤儿里', async () => {
    const res = await ppnt(['comments', DOC_PAGE_ID, '--status', 'all']);
    expect(res.code, res.stderr).toBe(0);
    const orphans = res.stdout.slice(res.stdout.indexOf('孤儿标注'));
    expect(res.stdout).toContain('孤儿标注');
    expect(orphans).toContain('[#1]');
    expect(orphans).toContain('[#2]');
  });

  await test.step('mark #1 check --note：回复和状态都写进孤儿账本', async () => {
    const res = await ppnt(['mark', DOC_PAGE_ID, '#1', 'check', '--note', '标题缩成两个字了']);
    expect(res.code, `${res.stdout}\n${res.stderr}`).toBe(0);
    expect(res.stdout).toContain('#1 → check');
    const row = readLedger(DOC_BUCKET, ledger).annotations.find((a) => a.n === 1);
    expect(row.status).toBe('check');
    expect(row.messages.map((m) => [m.who, m.text])).toEqual([['agent', '标题缩成两个字了']]);
  });

  await test.step('reply @a:orf002 只回复；mark @a:orf002 done 写状态', async () => {
    const replied = await ppnt(['reply', DOC_PAGE_ID, '@a:orf002', '改成列表了']);
    expect(replied.code, `${replied.stdout}\n${replied.stderr}`).toBe(0);
    const marked = await ppnt(['mark', DOC_PAGE_ID, '@a:orf002', 'done']);
    expect(marked.code, `${marked.stdout}\n${marked.stderr}`).toBe(0);
    const row = readLedger(DOC_BUCKET, ledger).annotations.find((a) => a.n === 2);
    expect(row.status).toBe('done');
    expect(row.messages.map((m) => m.text)).toEqual(['改成列表了']);
  });

  await test.step('comments 里看得到回复和新状态', async () => {
    const res = await ppnt(['comments', `${DOC_PAGE_ID}#2`]);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/\[#2\].*· done/);
    expect(res.stdout).toContain('改成列表了');
  });

  await test.step('文章里删掉的 HTML 帧：账本留在桶里，comments 列得出，mark 写得回', async () => {
    const articleLedger = 'removed.html_e2eorf';
    writeLedger(ARTICLE_BUCKET, articleLedger, {
      path: `/sites/${ARTICLE_PAGE_ID}/removed.html`,
      annotations: [{ id: 'rmv001', n: 1, type: 'element', selector: 'h1', text: '旧页', targets: [{ ref: 'i1', selector: 'h1', text: '旧页' }], content: '[@t:i1] 旧页的意见', status: 'open' }],
    });
    fs.writeFileSync(path.join(ARTICLE_BUCKET, '_seq.json'), JSON.stringify({ next: 2 }));
    const listed = await ppnt(['comments', ARTICLE, '--status', 'all']);
    expect(listed.code, listed.stderr).toBe(0);
    expect(listed.stdout).toContain('旧页的意见');
    const res = await ppnt(['mark', ARTICLE, '#1', 'check', '--note', '那一帧已经删了']);
    expect(res.code, `${res.stdout}\n${res.stderr}`).toBe(0);
    const row = readLedger(ARTICLE_BUCKET, articleLedger).annotations[0];
    expect(row.status).toBe('check');
    expect(row.messages.map((m) => m.text)).toEqual(['那一帧已经删了']);
  });
});

test('shot --canvas：只有 HTML 帧的文章不出画布视图图，逐帧截整页，并说明为什么', async () => {
  test.setTimeout(150_000);
  const res = await ppnt(['shot', ARTICLE, '--canvas']);
  expect(res.code, `${res.stdout}\n${res.stderr}`).toBe(0);
  expect(res.stdout).toMatch(/说明：e2e-html\/docs-only 的 2 帧都是 HTML 帧（文档条目）.*不出画布视图图/);
  expect(res.stdout).toContain(`A1 · lazy-page → ${path.join(SHOT_DIR, 'lazy-page.png')} · 402×`);
  expect(res.stdout).toContain(`A2 · short-page → ${path.join(SHOT_DIR, 'short-page.png')} · 402×`);
  expect(fs.existsSync(path.join(SHOT_DIR, `${ARTICLE_PAGE_ID}.png`))).toBe(false);

  const json = await ppnt(['shot', ARTICLE, '--canvas', '--json']);
  expect(json.code, json.stderr).toBe(0);
  const parsed = JSON.parse(json.stdout);
  expect(parsed.notes).toHaveLength(1);
  expect(parsed.shots.map((shot) => [shot.kind, shot.label])).toEqual([['doc', 'A1 · lazy-page'], ['doc', 'A2 · short-page']]);
});

test('shot A1：视口外的懒加载 iframe（含里面再嵌的一层）和图片都加载完才截', async ({ context }) => {
  test.setTimeout(150_000);
  const res = await ppnt(['shot', ARTICLE, 'A1']);
  expect(res.code, `${res.stdout}\n${res.stderr}`).toBe(0);
  expect(res.stderr).not.toContain('没加载完');
  const png = fs.readFileSync(path.join(SHOT_DIR, 'lazy-page.png'));
  expect(png.readUInt32BE(20)).toBeGreaterThan(6000);
  // 外层 iframe 整块绿、内层整块粉、图片整块蓝：三种颜色都在图里才说明三样都加载出来了。
  expect(await countColorPixels(context, png, [0, 160, 80], 6)).toBeGreaterThan(10_000);
  expect(await countColorPixels(context, png, [230, 40, 140], 6)).toBeGreaterThan(10_000);
  expect(await countColorPixels(context, png, [30, 90, 220], 6)).toBeGreaterThan(10_000);
});
