// Site build test (npm run test:site): builds the fixture projects with a temp
// registry and checks routes, [[ ]] resolution (incl. empty and cross-project
// refs), sections/TOC, llms.txt, the section canvas cards (frame iframes, canvas
// links, the section overlay's markup hooks), and that a namespace collision or a canvas error fails the build.
// Also: two dev servers from this checkout keep separate content stores.
// Not in the default `npm test`: the real Astro builds and dev servers take ~15 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { articlePageId } from './src/lib/canvas-source.js';

const SITE = fileURLToPath(new URL('.', import.meta.url));
const ASTRO = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));
const FIX = path.join(SITE, 'fixtures', 'projects');

function build(t, ids) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-site-build-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const registry = path.join(tmp, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: ids.map((id) => ({ id, kind: 'project', path: path.join(FIX, id) })) }));
  const out = path.join(tmp, 'dist');
  const r = spawnSync(process.execPath, [ASTRO, 'build'], {
    cwd: SITE,
    encoding: 'utf8',
    env: { ...process.env, PINPOINT_REGISTRY: registry, PINPOINT_SITE_OUT: out, PINPOINT_SITE_CACHE: path.join(tmp, 'cache'), ASTRO_TELEMETRY_DISABLED: '1' },
  });
  const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');
  return { status: r.status, log: `${r.stdout}\n${r.stderr}`, out, read };
}

const refs = (html) => [...html.matchAll(/<(?:a|span) class="cref( empty)?"[^>]*data-kind="(\w+)" data-name="([^"]*)" data-project="([^"]*)"[^>]*>([^<]*)</g)]
  .map((m) => ({ kind: m[2], name: m[3], project: m[4], label: m[5] }));

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Canvas cards in document order: each card runs to the next card, section or </main>. */
const cardsOf = (html) => [...html.matchAll(/<div class="canvas-card" data-pp-canvas data-page="([^"]*)" data-pp-section(?:="([^"]*)")?[^>]*?data-frames(?:="([^"]*)")?>([\s\S]*?)(?=<div class="canvas-card"|<\/section>|<\/main>)/g)]
  .map((m) => ({ page: m[1], section: m[2] || '', frames: m[3] || '', html: m[0] }));
const iframesOf = (html) => [...html.matchAll(/<iframe src="([^"]+)"/g)].map((m) => m[1]);
const linksOf = (html) => [...html.matchAll(/<a class="(?:btn|cc-hit)"[^>]*href="([^"]+)"/g)].map((m) => m[1]);

test('fixture site builds every route and resolves [[ ]]', (t) => {
  const b = build(t, ['demo', 'other']);
  assert.equal(b.status, 0, b.log);

  for (const rel of [
    'demo/index.html', 'demo/payments/index.html', 'demo/basics/index.html', 'demo/concepts/确认卡/index.html', 'demo/llms.txt',
    'other/index.html', 'other/intro/index.html', 'other/concepts/payee/index.html', 'other/llms.txt',
  ]) assert.ok(fs.existsSync(path.join(b.out, rel)), `missing route ${rel}`);

  const article = b.read('demo/payments/index.html');
  assert.deepEqual(refs(article), [
    { kind: 'concept', name: '确认卡', project: 'demo', label: '确认卡' },
    { kind: 'article', name: 'basics', project: 'demo', label: '基础篇' },
    { kind: 'empty', name: '付款授权', project: 'demo', label: '付款授权' },
    { kind: 'concept', name: '确认卡', project: 'demo', label: '确认卡' },
    { kind: 'concept', name: '收款方', project: 'other', label: '收款方' },
    { kind: 'empty', name: '支付页识别', project: 'demo', label: '支付页识别' },
    { kind: 'empty', name: '不存在', project: 'other', label: '不存在' },
  ]);
  assert.match(article, /<code>\[\[不是引用\]\]<\/code>/);
  // Concept URLs use the file name (slug), the ref still resolves by name.
  assert.match(article, /href="\/other\/concepts\/payee\/" data-kind="concept" data-name="收款方" data-project="other"/);
  // Popup data per kind: article → title + summary; concept → definition, status, used-by.
  assert.match(article, /data-kind="article"[^>]*data-href="\/demo\/basics\/" data-title="基础篇" data-summary="没有 section 的短文。"/);
  assert.match(article, /data-kind="concept" data-name="确认卡"[^>]*data-status="已固定"[^>]*data-def="对外动作执行前[^"]*"[^>]*data-used="[^"]*基础篇/);
  // Sections: stable ids, letters, TOC.
  assert.deepEqual([...article.matchAll(/<section class="sec" id="([^"]+)"[^>]*data-letter="([A-Z])"/g)].map((m) => `${m[2]}:${m[1]}`), ['A:overview', 'B:flow', 'C:mech']);
  assert.deepEqual([...article.matchAll(/<a href="#([^"]+)"><span class="n">([A-Z])<\/span>/g)].map((m) => `${m[2]}:${m[1]}`), ['A:overview', 'B:flow', 'C:mech']);

  // Canvas cards: one per Section with a <Canvas>, only that section's frames; lazy, inert iframes; links open the canvas at the section.
  const page = articlePageId('demo', 'payments');
  const q = (s) => s.replace(/&/g, '&amp;');
  const cards = cardsOf(article);
  assert.deepEqual(cards.map((c) => [c.page, c.section, c.frames]), [[page, 'flow', 'ask confirm confirm-card'], [page, 'mech', 'pay-button']]);
  const [flow, mech] = cards;
  assert.match(flow.html, /<span class="ref">B<\/span><span class="t">付款前的确认<\/span><span class="meta">B1–B3 · 3 帧<\/span>/);
  assert.deepEqual(iframesOf(flow.html), ['ask', 'confirm', 'confirm-card'].map((f) => q(`/api/frame?page=${encodeURIComponent(page)}&screen=${f}&annotate=off&embed=card`)));
  for (const tag of flow.html.match(/<iframe [^>]*>/g)) {
    assert.match(tag, /loading="lazy"/);
    assert.match(tag, /tabindex="-1"/);
  }
  const open = q(`/?page=${encodeURIComponent(page)}&section=flow`);
  // 打开画布 goes to the canvas; each frame opens the section overlay on the article (#overlay=<section>&frame=<frame>), no navigation.
  assert.deepEqual(linksOf(flow.html), [open, ...['ask', 'confirm', 'confirm-card'].map((f) => q(`#overlay=flow&frame=${f}`))]);
  assert.match(flow.html, /class="btn" data-pp-open href="[^"]+" target="_top">打开画布 →</);
  assert.equal((flow.html.match(/<a class="cc-hit" data-pp-frame-open href="#overlay=/g) || []).length, 3);
  // data-section belongs to <Section> only (one hit per section); the card carries data-pp-section.
  assert.doesNotMatch(article, /class="canvas-card"[^>]*\sdata-section=/);
  assert.equal((article.match(/\sdata-section="flow"/g) || []).length, 1);
  assert.doesNotMatch(flow.html, /class="cc-hit"[^>]*target=/);
  // What the overlay reads from the card: section letter / title / meta / canvas link, and per frame ref, title, src.
  assert.match(flow.html, new RegExp(`data-pp-section="flow" data-letter="B" data-title="付款前的确认" data-meta="B1–B3 · 3 帧" data-href="${escRe(open)}"`));
  assert.match(flow.html, new RegExp(`<figure class="cc-frame" data-screen="ask" data-ref="B1" data-title="ask" data-src="${escRe(q(`/api/frame?page=${encodeURIComponent(page)}&screen=ask&annotate=off&embed=card`))}">`));
  assert.deepEqual([...flow.html.matchAll(/<figcaption class="cap"><b>([A-Z]\d+)<\/b>/g)].map((m) => m[1]), ['B1', 'B2', 'B3']);
  assert.match(flow.html, /class="cc-box phone"[^>]*style="width:158px;height:328px"/);
  // Mixed shells in one card: the phone frames are phones, confirm-card (its own `export const shell = "comp"`) is a bare component box.
  const boxes = [...flow.html.matchAll(/<figure class="cc-frame" data-screen="([^"]+)"( data-shell="([^"]*)")?[^>]*>[\s\S]*?class="cc-box (\w+)" data-scale="([^"]*)"[^>]*style="([^"]*)"/g)]
    .map((m) => [m[1], m[3] || '', m[4], m[6], m[5]]);
  assert.deepEqual([...new Set(boxes.map((b) => b.pop()))], [String(158 / 438)]); // every frame in the card: the same scale
  assert.deepEqual(boxes, [
    // One scale per card (the phone's, 158 / 438): the comp frame's starting box 480×320 at that scale, not 0.75.
    ['ask', '', 'phone', 'width:158px;height:328px'],
    ['confirm', '', 'phone', 'width:158px;height:328px'],
    ['confirm-card', 'comp', 'natural', 'width:173px;height:115px'],
  ]);
  assert.doesNotMatch(flow.html.slice(0, flow.html.indexOf('<figure')), /data-shell=/); // the section itself has no shell
  assert.match(flow.html, /data-pp-badge hidden>/); // badge filled only from the live annotation ledger
  assert.doesNotMatch(article, /data-pp-canvas-errors|data-pp-missing|class="errors"/); // the fixture's canvas is clean
  // A non-phone shell is not sized as a 393×852 phone.
  assert.match(mech.html, /data-shell="comp"/);
  assert.match(mech.html, /class="cc-box natural"/);
  assert.doesNotMatch(mech.html, /width:393px|class="cc-box phone"/);
  assert.deepEqual(linksOf(mech.html), [q(`/?page=${encodeURIComponent(page)}&section=mech`), '#overlay=mech&amp;frame=pay-button']);
  // The section overlay: one empty shell per article with a canvas, outside #article, excluded from prose comments.
  const ov = article.match(/<dialog class="pp-ov" id="pp-overlay" data-pp-overlay data-pp-nocomment aria-labelledby="pp-ov-title">[\s\S]*?<\/dialog>/);
  assert.ok(ov, 'overlay shell');
  for (const hook of ['data-ov-letter', 'id="pp-ov-title" data-ov-title', 'data-ov-meta', 'data-ov-prev aria-label="上一节"', 'data-ov-next aria-label="下一节"',
    'data-ov-canvas href="/" target="_top">打开画布 →', 'data-ov-close aria-label="关闭"', 'class="ov-strip" data-ov-strip tabindex="-1" autofocus']) {
    assert.ok(ov[0].includes(hook), `overlay hook ${hook}`);
  }
  assert.doesNotMatch(ov[0], /<iframe/); // frames are created when it opens
  assert.ok(article.indexOf('<dialog class="pp-ov"') > article.indexOf('</main>'), 'overlay is outside #article');
  assert.equal((article.match(/<dialog /g) || []).length, 1);
  // Top bar: the article's canvas view.
  assert.match(article, new RegExp(`id="btn-canvas" href="${escRe(q(`/?page=${encodeURIComponent(page)}`))}" target="_top">画布视图<`));
  assert.doesNotMatch(b.read('demo/basics/index.html'), /btn-canvas|data-pp-canvas|data-pp-overlay/); // no Canvas, no canvas view, no overlay

  const home = b.read('demo/index.html');
  assert.deepEqual([...home.matchAll(/data-empty-ref="([^"]+)"/g)].map((m) => m[1]), ['付款授权', '撤回窗口', '支付页识别']);
  assert.match(home, /href="\/demo\/payments\/"/);
  assert.match(home, /href="\/demo\/concepts\/%E7%A1%AE%E8%AE%A4%E5%8D%A1\/"/);
  assert.deepEqual([...b.read('other/index.html').matchAll(/data-empty-ref="([^"]+)"/g)].map((m) => m[1]), ['不存在']);

  const concept = b.read('demo/concepts/确认卡/index.html');
  assert.deepEqual(refs(concept).map((r) => `${r.kind}:${r.name}`), ['article:payments', 'empty:撤回窗口']);
  assert.match(concept, /id="used-by"[\s\S]*浏览器任务里的付款[\s\S]*基础篇/);

  assert.deepEqual(refs(b.read('other/intro/index.html')).map((r) => `${r.kind}:${r.project}:${r.name}`), ['article:demo:payments']);

  const llms = b.read('demo/llms.txt');
  assert.match(llms, /^# Demo 项目/);
  assert.match(llms, /- \*\*确认卡\*\*（已固定）：对外动作执行前/);
  assert.match(llms, /## 文章：浏览器任务里的付款（\[\[payments\]\]）\n\n开头一段：这篇引用 \[\[确认卡\]\]/);
  assert.match(llms, /- 付款授权：浏览器任务里的付款、基础篇/);
});

// A canvas error is a project error (docs/projects.md「文章的画布 · 错误」), and
// project errors fail the production build. Which error lands in the card and
// which in the banner is covered in src/lib/canvas-card.test.js.
test('canvas errors fail the build, each with its line', (t) => {
  const b = build(t, ['broken']);
  assert.notEqual(b.status, 0);
  assert.match(b.log, /project "broken": articles\/broken-canvas\/index\.mdx：第 7 行：<Canvas> 必须写在 <Section> 里/);
  assert.match(b.log, /project "broken": articles\/broken-canvas\/index\.mdx：第 13 行：.*引用了别的页的帧 "browser-e2e-flow\/ask".*先把帧迁进本篇目录/);
  assert.match(b.log, /project "broken": articles\/broken-canvas\/index\.mdx：第 13 行：.*帧 "gone" 没有源文件/);
});

test('an article id that equals a concept name fails the build', (t) => {
  const b = build(t, ['clash']);
  assert.notEqual(b.status, 0);
  assert.match(b.log, /project "clash": name "confirm-card" is used by article .*confirm-card[\\/]index\.mdx and concept .*confirm-card\.md/);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** One `astro dev` the way the pinpoint service starts it (vite base /_astro/), with its own registry. */
async function devServer(t, id) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-site-dev-'));
  const port = await freePort();
  const registry = path.join(tmp, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [{ id, kind: 'project', path: path.join(FIX, id) }] }));
  const child = spawn(process.execPath, [ASTRO, 'dev', '--port', String(port), '--host', '127.0.0.1', '--ignore-lock'], {
    cwd: SITE,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PINPOINT_REGISTRY: registry, PINPOINT_SITE_PORT: String(port), PINPOINT_SITE_VITE_BASE: '/_astro/', PINPOINT_SITE_CACHE: path.join(tmp, 'cache'), ASTRO_TELEMETRY_DISABLED: '1' },
  });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(path.join(SITE, '.astro-cache', String(port)), { recursive: true, force: true });
  });
  const get = async (pathname) => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { signal: AbortSignal.timeout(5000) });
      return { status: res.status, text: await res.text() };
    } catch {
      return null;
    }
  };
  const deadline = Date.now() + 60_000;
  while (!(await get('/_astro/@vite/client'))) {
    if (Date.now() > deadline) throw new Error(`astro dev for ${id} not ready on ${port}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return { port, get };
}

// Astro keeps the dev content store in <root>/.astro/. With root at site/ two
// sites from one checkout shared it, and one served the other's registry: the
// article 404'd (2026-10-13 fresh-reader). astro.config gives each port its own root.
test('two dev servers from one checkout each serve their own registry', async (t) => {
  const [demo, other] = await Promise.all([devServer(t, 'demo'), devServer(t, 'other')]);
  for (let round = 0; round < 3; round++) {
    const [a, b] = await Promise.all([demo.get('/demo/payments/'), other.get('/other/intro/')]);
    assert.equal(a?.status, 200, `demo round ${round}`);
    assert.match(a.text, /浏览器任务里的付款/);
    assert.equal(b?.status, 200, `other round ${round}`);
    assert.match(b.text, /Other 介绍/);
    assert.equal((await demo.get('/other/intro/'))?.status, 404);
  }
  // Page modules now live outside the Astro root (srcDir = site/src) and load through /_astro/@fs/.
  const page = await demo.get('/demo/payments/');
  const scripts = [...page.text.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0, 'page has module scripts');
  for (const src of scripts) assert.equal((await demo.get(src))?.status, 200, src);
  assert.ok(!fs.existsSync(path.join(SITE, '.astro', 'data-store.json')), 'no shared site/.astro content store');
});
