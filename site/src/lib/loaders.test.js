import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mdx from '@astrojs/mdx';
import { articlesLoader, conceptsLoader, watchAll } from './loaders.js';

// watchAll 是站点内容重读的唯一入口：登记表或 project 目录一变就重读。这里用假 watcher 和假“磁盘”
// 摆出 2026-10-15 满载下的两种时序（docs/debugging.md 同日案例）：
//   ① 两次重读交叠，慢的旧一次后结束，把监听清单换回没有新 project 的那份，新文章的事件被丢掉；
//   ② 重读读盘时新 project 还是空的，文章在它被加进监听之前写进去，不会再来事件。
// 两种都会让新文章一直 404。

const REG = '/reg/registry.json';
const NEW_DIR = '/sites/new/docs/pinpoint';
const OLD_DIR = '/sites/old/docs/pinpoint';
const ARTICLE = `${NEW_DIR}/articles/hello/index.mdx`;

function harness() {
  const watcher = new EventEmitter();
  watcher.added = [];
  watcher.add = (paths) => { watcher.added.push(...[].concat(paths)); };
  const ctx = { watcher, logger: { error: (message) => { throw new Error(message); } } };
  // 磁盘：登记了哪些 project、新 project 下有哪些文章。reload 读盘后可以被挂住（慢的那一次）。
  const disk = { projects: [{ id: 'old', dir: OLD_DIR, articles: ['a'] }] };
  const snapshot = () => ({ registryPath: REG, projects: disk.projects.map((p) => ({ ...p, articles: [...p.articles] })) });
  const runs = [];
  const reload = () => {
    const seen = snapshot();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const run = { seen, released: false, done: gate.then(() => seen) };
    run.release = () => { run.released = true; release(); };
    runs.push(run);
    return run.done;
  };
  return { ctx, watcher, disk, runs, reload, snapshot };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
/** 等事件的 50ms 去抖过去，重读开始。 */
const settle = () => tick(120);
const latest = (runs) => runs.at(-1);

test('articlesLoader：异步重读保留快照，坏 YAML 只影响本篇，修复和删除都能更新', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-loader-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const oldRegistry = process.env.PINPOINT_REGISTRY;
  t.after(() => { if (oldRegistry === undefined) delete process.env.PINPOINT_REGISTRY; else process.env.PINPOINT_REGISTRY = oldRegistry; });
  const dir = path.join(root, 'docs/pinpoint');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ id: 'loader', title: 'loader' }));
  const files = ['a', 'b'].map((id) => {
    const folder = path.join(dir, 'articles', id);
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'index.mdx');
    fs.writeFileSync(file, `---\ntitle: ${id}\n---\n正文 ${id}`);
    return file;
  });
  const registry = path.join(root, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [{ id: 'loader', kind: 'project', path: root }] }));
  process.env.PINPOINT_REGISTRY = registry;
  let parser;
  await mdx().hooks['astro:config:setup']({ config: {}, updateConfig() {}, addPageExtension() {}, addContentEntryType(type) { parser = type; }, addRenderer() {} });
  const entries = new Map();
  const errors = [];
  let committed = () => {};
  const watcher = new EventEmitter();
  watcher.add = () => {};
  let gate;
  let entered;
  const ctx = {
    config: { root: pathToFileURL(root + '/') }, watcher,
    entryTypes: new Map([['.mdx', { getEntryInfo: async (input) => { if (gate) { entered(); await gate; } return parser.getEntryInfo(input); } }]]),
    store: { clear: () => { entries.clear(); queueMicrotask(() => committed()); }, set: (entry) => entries.set(entry.id, entry) },
    parseData: async ({ data }) => data, generateDigest: (text) => text,
    logger: { error: (message) => errors.push(message), warn: (message) => errors.push(message) },
  };
  await articlesLoader().load(ctx);
  const reload = (event, file) => new Promise((resolve) => { committed = resolve; watcher.emit(event, file); });
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const finished = reload('change', files[0]);
  await started;
  // 读取尚未完成时，下游仍能取到上一份完整内容，而不是空集合。
  const during = [...entries.keys()];
  gate = null;
  release();
  await finished;
  assert.deepEqual(during, ['loader/a', 'loader/b']);

  fs.writeFileSync(files[0], '---\ntitle: [\n---\n正文 a');
  await reload('change', files[0]);
  assert.equal(entries.get('loader/b')?.data.title, 'b');
  assert.match(entries.get('loader/a')?.data.loadError || '', /articles[/\\]a[/\\]index.mdx/);
  assert.equal(entries.get('loader/a').deferredRender, undefined, '坏文件不能交给 Astro 编译');
  assert.ok(errors.some((message) => message.includes(files[0])));

  // 冷启动也能载入健康文章，不依赖旧快照。
  entries.clear();
  await articlesLoader().load({ ...ctx, watcher: undefined });
  assert.equal(entries.get('loader/b')?.data.title, 'b');

  fs.writeFileSync(files[0], '---\ntitle: 恢复\n---\n修好的正文');
  await reload('change', files[0]);
  assert.equal(entries.get('loader/a')?.data.title, '恢复');
  assert.equal(entries.get('loader/a')?.data.loadError, undefined);
  fs.rmSync(path.dirname(files[0]), { recursive: true });
  await reload('unlink', files[0]);
  assert.deepEqual([...entries.keys()], ['loader/b']);
});
/** 把挂着的重读从新到旧放行，直到不再有新的重读：交叠时新的先结束、旧的后结束（满载下观察到的顺序）。 */
async function drain(runs) {
  for (let round = 0; round < 20; round++) {
    const pending = runs.filter((run) => !run.released).reverse();
    if (!pending.length) return;
    for (const run of pending) { run.release(); await tick(); }
    await settle();
  }
  throw new Error('重读停不下来');
}

test('watchAll：交叠的旧重读后结束，不能把新 project 从监听清单里挤掉（新文章要读到）', async () => {
  const h = harness();
  watchAll(h.ctx, h.snapshot(), h.reload);

  // 旧 project 改了一个文件 → 第一次重读开始，读到的是还没有新 project 的磁盘，然后卡住（满载下慢）。
  h.watcher.emit('change', `${OLD_DIR}/articles/a/index.mdx`);
  await settle();
  assert.equal(h.runs.length, 1);

  // 这时登记了新 project：登记表一变，又该重读一次，读到新 project（还没有文章）。
  h.disk.projects.push({ id: 'new', dir: NEW_DIR, articles: [] });
  h.watcher.emit('change', REG);
  await settle();
  await drain(h.runs);

  // 新文章写进新 project：这个事件必须触发一次重读，且那次重读读到它。
  h.disk.projects[1].articles.push('hello');
  const before = h.runs.length;
  h.watcher.emit('add', ARTICLE);
  await settle();
  await drain(h.runs);
  assert.ok(h.runs.length > before, '新 project 里新文章的事件被丢掉了：没有再重读');
  assert.deepEqual(latest(h.runs).seen.projects.find((p) => p.id === 'new').articles, ['hello']);
});

test('watchAll：新 project 加进监听之前就写好的文章，加完之后重读一遍读到它', async () => {
  const h = harness();
  watchAll(h.ctx, h.snapshot(), h.reload);

  // 登记新 project → 重读读盘：新 project 还没有文章。
  h.disk.projects.push({ id: 'new', dir: NEW_DIR, articles: [] });
  h.watcher.emit('change', REG);
  await settle();
  assert.equal(h.runs.length, 1);
  // 读完盘、还没把新目录加进监听时，文章写进来了：watcher 还没盯这个目录，不会有事件。
  h.disk.projects[1].articles.push('hello');
  await drain(h.runs);

  assert.ok(h.watcher.added.includes(NEW_DIR), '新 project 目录要加进监听');
  assert.deepEqual(latest(h.runs).seen.projects.find((p) => p.id === 'new').articles, ['hello'],
    '加进监听之前写好的文章没有读到：站点会一直 404');
});

test('conceptsLoader：wiki 正文 render 失败保留路由并带 renderError，页面有得显示（r5 T5）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-concepts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pin = path.join(dir, 'wt', 'docs', 'pinpoint');
  fs.mkdirSync(path.join(pin, 'wiki'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'wt', 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id: 'wt', title: 'WT' }));
  fs.writeFileSync(path.join(pin, 'wiki', 'ok.md'), '好的词条。\n');
  fs.writeFileSync(path.join(pin, 'wiki', 'broken.md'), '坏掉的词条。\n');
  const prevRegistry = process.env.PINPOINT_REGISTRY;
  process.env.PINPOINT_REGISTRY = path.join(dir, 'registry.json');
  t.after(() => { if (prevRegistry === undefined) delete process.env.PINPOINT_REGISTRY; else process.env.PINPOINT_REGISTRY = prevRegistry; });
  fs.writeFileSync(process.env.PINPOINT_REGISTRY, JSON.stringify({ version: 1, entries: [{ id: 'wt', kind: 'project', path: path.join(dir, 'wt') }] }));

  const store = { entries: [], clear() { this.entries = []; }, set(e) { this.entries.push(e); } };
  const errors = [];
  const ctx = {
    watcher: null,
    config: { root: pathToFileURL(path.join(dir, 'site')) },
    logger: { error: (message) => errors.push(message), warn: () => {} },
    store,
    parseData: async ({ data }) => data,
    generateDigest: () => 'd0',
    entryTypes: new Map([['.md', {
      getEntryInfo: async ({ contents }) => ({ body: contents, data: {} }),
      getRenderFunction: async () => async (entry) => {
        if (entry.filePath.endsWith('broken.md')) throw new Error('render boom');
        return { html: '<p>好的词条。</p>' };
      },
    }]]),
  };
  await conceptsLoader().load(ctx);
  const bySlug = new Map(store.entries.map((e) => [e.id, e]));
  assert.equal(bySlug.get('wt/ok').rendered.html, '<p>好的词条。</p>');
  assert.equal(bySlug.get('wt/ok').data.renderError, undefined);
  // 坏的保留路由（页面还在），错误进 entry 数据让页面亮出来，而不是静默没正文。
  assert.equal(bySlug.get('wt/broken').rendered, undefined);
  assert.match(bySlug.get('wt/broken').data.renderError, /broken\.md: render boom/);
  assert.ok(errors.some((m) => m.includes('broken.md')), '服务端日志仍要有一行');
});
