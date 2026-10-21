import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mdx from '@astrojs/mdx';
import { articlesLoader, conceptsLoader, projectsLoader, watchAll } from './loaders.js';

// 从实际安装的 Astro 入口定位，不复制 scopedStore 的 digest/规范化实现。
const { MutableDataStore } = await import(new URL('content/mutable-data-store.js', import.meta.resolve('astro')));
function storeProbe(name) {
  const writes = [];
  class ObservedStore extends MutableDataStore {
    set(...args) { writes.push('set'); return super.set(...args); }
    clear(...args) { writes.push('clear'); return super.clear(...args); }
    delete(...args) { writes.push('delete'); return super.delete(...args); }
    addAssetImports(...args) { writes.push('assets'); return super.addAssetImports(...args); }
    addModuleImport(...args) { writes.push('modules'); return super.addModuleImport(...args); }
  }
  const store = new ObservedStore().scopedStore(name);
  const outcomes = [];
  const set = store.set;
  store.set = (entry) => { const changed = set(entry); outcomes.push(changed); return changed; };
  return { store, writes, outcomes, reset() { writes.length = 0; outcomes.length = 0; } };
}

// track 在同步提交之后被调用；微任务时已完成整个批次，不依赖 clear 或固定等待。
function reloadWatcher() {
  const watcher = new EventEmitter();
  let committed = () => {};
  watcher.add = () => queueMicrotask(() => committed());
  watcher.reload = (event, file) => new Promise((resolve) => { committed = resolve; watcher.emit(event, file); });
  return watcher;
}

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
  const frame = path.join(path.dirname(files[0]), 'frame.jsx');
  fs.writeFileSync(frame, 'export default () => <div>旧帧正文</div>');
  const registry = path.join(root, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [{ id: 'loader', kind: 'project', path: root }] }));
  process.env.PINPOINT_REGISTRY = registry;
  let parser;
  await mdx().hooks['astro:config:setup']({ config: {}, updateConfig() {}, addPageExtension() {}, addContentEntryType(type) { parser = type; }, addRenderer() {} });
  const probe = storeProbe('articles');
  const entries = probe.store;
  const errors = [];
  const watcher = reloadWatcher();
  let gate;
  let entered;
  const ctx = {
    config: { root: pathToFileURL(root + '/') }, watcher,
    entryTypes: new Map([['.mdx', { getEntryInfo: async (input) => { if (gate) { entered(); await gate; } return parser.getEntryInfo(input); } }]]),
    store: entries,
    parseData: async ({ data }) => data, generateDigest: (text) => text,
    logger: { error: (message) => errors.push(message), warn: (message) => errors.push(message) },
  };
  await articlesLoader().load(ctx);
  const reload = watcher.reload;
  const original = entries.get('loader/a');
  probe.reset();
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
  assert.strictEqual(entries.get('loader/a'), original, '不变重读应复用实际 stored entry');
  assert.deepEqual(probe.outcomes, [false, false]);
  assert.deepEqual(probe.writes, [], '不进入 Astro 底层 set/clear/delete 或 assets/modules 脏路径');

  fs.writeFileSync(frame, 'export default () => <div>新帧正文</div>');
  probe.reset();
  await reload('change', frame);
  assert.strictEqual(entries.get('loader/a'), original, '纯帧正文事件不重建 MDX entry');
  assert.deepEqual(probe.outcomes, [false, false]);
  assert.deepEqual(probe.writes, []);

  const contents = fs.readFileSync(files[0], 'utf8');
  const nextTime = new Date(fs.statSync(files[0]).mtimeMs + 2000);
  fs.utimesSync(files[0], nextTime, nextTime);
  await reload('change', files[0]);
  assert.equal(fs.readFileSync(files[0], 'utf8'), contents);
  assert.notStrictEqual(entries.get('loader/a'), original, '同正文但 mtime 改变仍采用');
  assert.equal(entries.get('loader/a').data.mtimeMs, fs.statSync(files[0]).mtimeMs);

  ctx.parseData = async ({ data }) => ({ ...data, derived: '新派生值' });
  await reload('change', frame);
  assert.equal(entries.get('loader/a').data.derived, '新派生值');

  fs.writeFileSync(files[0], '---\ntitle: [\n---\n正文 a');
  await reload('change', files[0]);
  assert.equal(entries.get('loader/b')?.data.title, 'b');
  assert.match(entries.get('loader/a')?.data.loadError || '', /articles[/\\]a[/\\]index.mdx/);
  assert.equal(entries.get('loader/a').deferredRender, undefined, '坏文件不能交给 Astro 编译');
  assert.ok(errors.some((message) => message.includes(files[0])));
  const broken = entries.get('loader/a');
  probe.reset();
  await reload('change', frame);
  assert.strictEqual(entries.get('loader/a'), broken, '错误 entry 也应有稳定 digest');
  assert.deepEqual(probe.writes, []);

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
  fs.mkdirSync(path.dirname(files[0]));
  fs.writeFileSync(files[0], '---\ntitle: 新增\n---\n新增正文');
  await reload('add', files[0]);
  assert.equal(entries.get('loader/a').data.title, '新增');
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

test('watchAll：登记 alias 根（symlink）时，真实路径形态的 change/add/unlink 同样触发重读；相似前缀兄弟不触发', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-watch-alias-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const real = path.join(tmp, 'real');
  const dir = path.join(real, 'docs', 'pinpoint');
  fs.mkdirSync(path.join(dir, 'articles', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'articles', 'a', 'index.mdx'), 'a');
  fs.writeFileSync(path.join(real, 'registry.json'), '{}');
  const alias = path.join(tmp, 'alias');
  fs.symlinkSync(real, alias, 'dir');
  const aliasDir = path.join(alias, 'docs', 'pinpoint');
  const aliasReg = path.join(alias, 'registry.json');
  // watcher 交付的事件可以是同一实体的真实路径形态（macOS 上 /var → /private/var；
  // 这里用显式 symlink 复现这一对等价根）。
  const realDir = fs.realpathSync(aliasDir);

  const watcher = new EventEmitter();
  watcher.added = [];
  watcher.add = (paths) => { watcher.added.push(...[].concat(paths)); };
  const ctx = { watcher, logger: { error: (m) => { throw new Error(m); } } };
  const source = { registryPath: aliasReg, projects: [{ id: 'p', dir: aliasDir }] };
  let runs = 0;
  const reload = () => { runs++; return Promise.resolve(source); };
  watchAll(ctx, source, reload);

  // 注册进 watcher 的仍只有原 roots：realpath 前缀只用于事件匹配，不改变注册清单。
  assert.deepEqual(watcher.added, [aliasReg, aliasDir]);

  for (const event of ['change', 'add']) {
    const before = runs;
    watcher.emit(event, path.join(realDir, 'articles', 'a', 'index.mdx'));
    await settle();
    assert.ok(runs > before, `${event}（真实路径形态）被丢掉：没有重读`);
  }
  // 删除后文件已不存在，unlink 事件只能靠登记时记下的等价前缀匹配。
  fs.rmSync(path.join(dir, 'articles', 'a', 'index.mdx'));
  const before = runs;
  watcher.emit('unlink', path.join(realDir, 'articles', 'a', 'index.mdx'));
  await settle();
  assert.ok(runs > before, 'unlink（真实路径形态）被丢掉：没有重读');

  // 前缀相似的无关兄弟不触发：匹配不能放松成裸字符串前缀。
  const siblingBefore = runs;
  watcher.emit('change', `${realDir}-sibling/articles/a/index.mdx`);
  await settle();
  assert.equal(runs, siblingBefore);
});

test('concepts/projectsLoader：复用不变条目，wiki render 失败与恢复、渲染变化和 project 布局删增仍更新', async (t) => {
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

  const probe = storeProbe('concepts');
  const store = probe.store;
  const errors = [];
  let broken = true;
  let html = '<p>好的词条。</p>';
  const ctx = {
    watcher: reloadWatcher(),
    config: { root: pathToFileURL(path.join(dir, 'site')) },
    logger: { error: (message) => errors.push(message), warn: () => {} },
    store,
    parseData: async ({ data }) => data,
    generateDigest: (text) => text,
    entryTypes: new Map([['.md', {
      getEntryInfo: async ({ contents }) => ({ body: contents, data: {} }),
      getRenderFunction: async () => async (entry) => {
        if (broken && entry.filePath.endsWith('broken.md')) throw new Error('render boom');
        return { html };
      },
    }]]),
  };
  await conceptsLoader().load(ctx);
  const bySlug = new Map(store.entries());
  assert.equal(bySlug.get('wt/ok').rendered.html, '<p>好的词条。</p>');
  assert.equal(bySlug.get('wt/ok').data.renderError, undefined);
  // 坏的保留路由（页面还在），错误进 entry 数据让页面亮出来，而不是静默没正文。
  assert.equal(bySlug.get('wt/broken').rendered, undefined);
  assert.match(bySlug.get('wt/broken').data.renderError, /broken\.md: render boom/);
  assert.ok(errors.some((m) => m.includes('broken.md')), '服务端日志仍要有一行');
  probe.reset();
  const frame = path.join(pin, 'frame.jsx');
  await ctx.watcher.reload('change', frame);
  assert.strictEqual(store.get('wt/ok'), bySlug.get('wt/ok'));
  assert.strictEqual(store.get('wt/broken'), bySlug.get('wt/broken'));
  assert.deepEqual(probe.outcomes, [false, false]);
  assert.deepEqual(probe.writes, []);
  broken = false;
  await ctx.watcher.reload('change', frame);
  assert.equal(store.get('wt/broken').data.renderError, undefined, '正文不变，renderError 仍可恢复');
  assert.equal(store.get('wt/broken').rendered.html, html);
  assert.strictEqual(store.get('wt/ok'), bySlug.get('wt/ok'));
  html = '<p>新的渲染结果</p>';
  await ctx.watcher.reload('change', frame);
  assert.equal(store.get('wt/ok').rendered.html, html, '正文不变，渲染结果变化仍采用');

  const projectProbe = storeProbe('projects');
  const projectCtx = { ...ctx, store: projectProbe.store, watcher: reloadWatcher() };
  await projectsLoader().load(projectCtx);
  const project = projectCtx.store.get('wt');
  projectProbe.reset();
  await projectCtx.watcher.reload('change', frame);
  assert.strictEqual(projectCtx.store.get('wt'), project);
  assert.deepEqual(projectProbe.outcomes, [false]);
  assert.deepEqual(projectProbe.writes, []);
  // 新出现的布局错误属于派生 data，不能被不变 project.json 的 digest 遮掉。
  const badLayout = path.join(pin, 'articles', 'stray.txt');
  fs.mkdirSync(path.dirname(badLayout), { recursive: true });
  fs.writeFileSync(badLayout, '布局错误');
  await projectCtx.watcher.reload('add', badLayout);
  assert.ok(projectCtx.store.get('wt').data.errors.some((e) => e.code === 'article_not_dir'));
  fs.rmSync(badLayout);
  await projectCtx.watcher.reload('unlink', badLayout);
  assert.deepEqual(projectCtx.store.get('wt').data.errors, project.data.errors);
  fs.writeFileSync(process.env.PINPOINT_REGISTRY, JSON.stringify({ version: 1, entries: [] }));
  await projectCtx.watcher.reload('change', process.env.PINPOINT_REGISTRY);
  assert.deepEqual(projectCtx.store.keys(), [], '空集合删除所有缺席 project');
});
