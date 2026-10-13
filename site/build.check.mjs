// Site build test (npm run test:site): builds the fixture projects with a temp
// registry and checks routes, [[ ]] resolution (incl. empty and cross-project
// refs), sections/TOC, llms.txt, and that a namespace collision fails the build.
// Not in the default `npm test`: two real Astro builds take ~10 s.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

test('fixture site builds every route and resolves [[ ]]', (t) => {
  const b = build(t, ['demo', 'other']);
  assert.equal(b.status, 0, b.log);

  for (const rel of [
    'demo/index.html', 'demo/payments/index.html', 'demo/basics/index.html', 'demo/concepts/确认卡/index.html', 'demo/llms.txt',
    'other/index.html', 'other/intro/index.html', 'other/concepts/收款方/index.html', 'other/llms.txt',
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
  // Popup data per kind: article → title + summary; concept → definition, status, used-by.
  assert.match(article, /data-kind="article"[^>]*data-href="\/demo\/basics\/" data-title="基础篇" data-summary="没有 section 的短文。"/);
  assert.match(article, /data-kind="concept" data-name="确认卡"[^>]*data-status="已固定"[^>]*data-def="对外动作执行前[^"]*"[^>]*data-used="[^"]*基础篇/);
  // Sections: stable ids, letters, TOC.
  assert.deepEqual([...article.matchAll(/<section class="sec" id="([^"]+)"[^>]*data-letter="([A-Z])"/g)].map((m) => `${m[2]}:${m[1]}`), ['A:overview', 'B:flow', 'C:mech']);
  assert.deepEqual([...article.matchAll(/<a href="#([^"]+)"><span class="n">([A-Z])<\/span>/g)].map((m) => `${m[2]}:${m[1]}`), ['A:overview', 'B:flow', 'C:mech']);
  assert.match(article, /data-pp-canvas>画布卡片（M1）</);

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

test('an article id that equals a concept name fails the build', (t) => {
  const b = build(t, ['clash']);
  assert.notEqual(b.status, 0);
  assert.match(b.log, /project "clash": name "confirm-card" is used by article .*confirm-card[\\/]index\.mdx and concept .*confirm-card\.md/);
});
