import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { compilePage, distStatus } from './page-compiler.js';
import { findDrift, isWatchedSource, planPageRecompile, planRecompile } from './recompile-plan.js';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-recompile-plan-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SCREENS = ['home', 'detail', 'about'];

/** 上一次全绿 build.json 的手写样子：home/detail 共享 components/Shared.jsx。 */
function greenBuild() {
  return {
    builtAt: 1000,
    sources: {
      home: { file: 'home.jsx', mtimeMs: 900, deps: [{ file: 'components/Shared.jsx', mtimeMs: 800 }] },
      detail: { file: 'detail.jsx', mtimeMs: 900, deps: [{ file: 'components/Shared.jsx', mtimeMs: 800 }] },
      about: { file: 'about.html', mtimeMs: 900 },
    },
    errors: {},
  };
}

const abs = (rel) => path.join(tmp, 'page', ...rel.split('/'));

describe('planRecompile：该编的屏', () => {
  test('变更文件是某屏的 file → 只编该屏', () => {
    const plan = planRecompile({ build: greenBuild(), changedFiles: [abs('detail.jsx')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: false, screens: ['detail'] });
  });

  test('共享依赖命中多屏：全部命中的屏都重编，没引用的屏不动', () => {
    const plan = planRecompile({ build: greenBuild(), changedFiles: [abs('components/Shared.jsx')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: false, screens: ['home', 'detail'] });
  });

  test('kit 印章这类页外依赖（../ 相对链）也能认领到屏', () => {
    const build = greenBuild();
    build.sources.about = { file: 'about.html', mtimeMs: 900, deps: [{ file: '../content/kits/ios/jsx/Bubble.jsx', mtimeMs: 800 }] };
    const plan = planRecompile({ build, changedFiles: [path.join(tmp, 'content', 'kits', 'ios', 'jsx', 'Bubble.jsx')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: false, screens: ['about'] });
  });

  test('一批多个文件命中不同屏：并集一次编齐', () => {
    const plan = planRecompile({ build: greenBuild(), changedFiles: [abs('detail.jsx'), abs('about.html')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: false, screens: ['detail', 'about'] });
  });
});

describe('planRecompile：一律全编', () => {
  test('没有 build.json', () => {
    assert.deepEqual(planRecompile({ build: null, changedFiles: [abs('home.jsx')], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });

  test('build.json 解析失败（调用方传进来的残缺对象同罪）', () => {
    assert.deepEqual(planRecompile({ build: { builtAt: 1 }, changedFiles: [abs('home.jsx')], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });

  test('board.json 变了 → 全编', () => {
    const plan = planRecompile({ build: greenBuild(), changedFiles: [abs('home.jsx'), abs('board.json')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: true });
  });

  test('屏增删：板屏清单与 build.json 记录不一致 → 全编', () => {
    // 加了一屏
    assert.deepEqual(
      planRecompile({ build: greenBuild(), changedFiles: [abs('home.jsx')], screenIds: [...SCREENS, 'extra'], pageDir: abs('') }),
      { all: true },
    );
    // 删了一屏
    assert.deepEqual(
      planRecompile({ build: greenBuild(), changedFiles: [abs('home.jsx')], screenIds: ['home', 'detail'], pageDir: abs('') }),
      { all: true },
    );
  });

  test('变更文件不属于任何屏的 file/deps 但在页目录里（新增文件/assets/样式）→ 全编', () => {
    for (const rel of ['new-screen.jsx', 'pk.css', 'sidecar.js', 'components/board.json']) {
      assert.deepEqual(
        planRecompile({ build: greenBuild(), changedFiles: [abs(rel)], screenIds: SCREENS, pageDir: abs('') }),
        { all: true },
        rel,
      );
    }
  });

  test('上次编译有失败屏 → 全编', () => {
    const build = greenBuild();
    build.errors.about = 'about.html: 顶层只允许 import';
    assert.deepEqual(planRecompile({ build, changedFiles: [abs('home.jsx')], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });

  test('fs.watch 拿不到文件名（null）→ 全编', () => {
    assert.deepEqual(planRecompile({ build: greenBuild(), changedFiles: [null], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });

  test('空变更批次 → 全编（空列表跳过编译会让 dist 假 fresh）', () => {
    assert.deepEqual(planRecompile({ build: greenBuild(), changedFiles: [], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });
});

describe('planPageRecompile：读盘包装', () => {
  function makePage(name, files) {
    const pageDir = path.join(tmp, name);
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(pageDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    return { entryId: name, pageDir, urlBase: `/sites/${name}/`, kind: 'dir' };
  }

  const BOARD = {
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }],
  };

  test('真页 + 真 build.json：只编命中的屏；板读不到回落全编', async () => {
    const target = makePage('real-page', {
      'board.json': JSON.stringify(BOARD),
      'a.html': '<div class="ios-app">a</div>\n',
      'b.html': '<div class="ios-app">b</div>\n',
    });
    const distRoot = path.join(tmp, 'dist');
    await compilePage(target, { distRoot });
    const changed = path.join(target.pageDir, 'a.html');
    fs.writeFileSync(changed, '<div class="ios-app">a2</div>\n');
    // 改 a → 计划是 [a]；拿这个计划走增量编译，b 的产物不被重写。
    const before = fs.statSync(path.join(distRoot, 'real-page', 'b.html')).mtimeMs;
    const plan = planPageRecompile(target, [changed], { distRoot });
    assert.deepEqual(plan, { all: false, screens: ['a'] });
    await compilePage(target, { distRoot, onlyScreens: plan.screens });
    assert.equal(fs.statSync(path.join(distRoot, 'real-page', 'b.html')).mtimeMs, before);

    // 板没了 → 全编（compilePage 那边会报板错误，同一条保守路）。
    fs.rmSync(path.join(target.pageDir, 'board.json'));
    assert.deepEqual(planPageRecompile(target, [changed], { distRoot }), { all: true });
  });
});

describe('findDrift：build.json 与盘上对不上的文件', () => {
  // 盘上 mtime 的替身：按页相对路径查表，表里没有 = 文件消失。
  const disk = (table) => (file) => {
    const rel = path.relative(abs(''), file).split(path.sep).join('/');
    return Object.hasOwn(table, rel) ? table[rel] : null;
  };
  const SAME = { 'home.jsx': 900, 'detail.jsx': 900, 'about.html': 900, 'components/Shared.jsx': 800, 'board.json': 500 };

  test('全部与记录一致、board.json 早于 builtAt → 无漂移', () => {
    assert.equal(findDrift({ build: greenBuild(), exempt: [], pageDir: abs(''), mtimeOf: disk(SAME) }), null);
  });

  test('记录了 mtime 的文件：变了（含往回拨）或消失 → 漂移', () => {
    assert.equal(findDrift({ build: greenBuild(), pageDir: abs(''), mtimeOf: disk({ ...SAME, 'components/Shared.jsx': 801 }) }), 'components/Shared.jsx');
    assert.equal(findDrift({ build: greenBuild(), pageDir: abs(''), mtimeOf: disk({ ...SAME, 'about.html': 10 }) }), 'about.html');
    const gone = { ...SAME };
    delete gone['detail.jsx'];
    assert.equal(findDrift({ build: greenBuild(), pageDir: abs(''), mtimeOf: disk(gone) }), 'detail.jsx');
  });

  test('这批变更里的文件不算漂移（它的屏正要重编）', () => {
    const moved = { ...SAME, 'components/Shared.jsx': 801 };
    assert.equal(findDrift({ build: greenBuild(), exempt: [abs('components/Shared.jsx')], pageDir: abs(''), mtimeOf: disk(moved) }), null);
  });

  test('没有 mtime 记录的文件（board.json、旧格式记录）与 builtAt 比', () => {
    assert.equal(findDrift({ build: greenBuild(), pageDir: abs(''), mtimeOf: disk({ ...SAME, 'board.json': 1001 }) }), 'board.json');
    const legacy = greenBuild();
    delete legacy.sources.about.mtimeMs;
    assert.equal(findDrift({ build: legacy, pageDir: abs(''), mtimeOf: disk({ ...SAME, 'about.html': 999 }) }), null);
    assert.equal(findDrift({ build: legacy, pageDir: abs(''), mtimeOf: disk({ ...SAME, 'about.html': 1001 }) }), 'about.html');
  });
});

describe('isWatchedSource：watch 盯哪些文件（review 必须修 2）', () => {
  test('deps 可能出现的类型都盯', () => {
    for (const rel of ['a.jsx', 'a.html', 'board.json', 'pk.css', 'pk.js', 'data.json', 'util.ts', 'Card.tsx', 'lib.mjs', 'lib.cjs', 'components/x/y.json']) {
      assert.equal(isWatchedSource(rel), true, rel);
    }
  });

  test('编译产物、依赖目录、非 deps 类型不盯', () => {
    for (const rel of ['build.json', 'sub/build.json', 'node_modules/p/index.js', '.git/HEAD.json', 'notes.txt', 'shot.png', 'README.md']) {
      assert.equal(isWatchedSource(rel), false, rel);
    }
    const distRoot = path.join(tmp, 'page', '.dist');
    assert.equal(isWatchedSource(path.join(distRoot, 'p', 'a.html'), { distRoot }), false);
    assert.equal(isWatchedSource(path.join(tmp, 'page', 'a.html'), { distRoot }), true);
  });
});

describe('planPageRecompile：漂移校验把 watch 漏掉的改动拉回全编（review 必须修 1）', () => {
  const FRAME = (body, head = '') => `${head}export default function F() {\n  return <div className="ios-app">${body}</div>;\n}\n`;
  const BOARD = (ids) => JSON.stringify({ sections: [{ id: 'main', title: 'Main', layout: 'row', screens: ids.map((id) => ({ id, title: id })) }] });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function compiled(name, files) {
    const pageDir = path.join(tmp, name);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(pageDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(pageDir, rel), content);
    }
    const target = { entryId: name, pageDir, urlBase: `/sites/${name}/`, kind: 'dir' };
    const distRoot = path.join(tmp, 'dist');
    await compilePage(target, { distRoot });
    const write = (rel, content) => fs.writeFileSync(path.join(pageDir, rel), content);
    const dist = (id) => fs.readFileSync(path.join(distRoot, name, `${id}.html`), 'utf8');
    return { target, distRoot, pageDir, write, dist };
  }

  // 走一拍 watch 的完整流程：算计划 → 按计划编 → 回报计划与编完后的 stale。
  async function beat(page, changed, extra = {}) {
    const plan = planPageRecompile(page.target, changed.map((rel) => path.join(page.pageDir, rel)), { distRoot: page.distRoot, ...extra });
    if (!plan.noop) await compilePage(page.target, { distRoot: page.distRoot, ...(plan.all ? {} : { onlyScreens: plan.screens }) });
    return { plan, stale: distStatus(page.target.entryId, page.pageDir, { distRoot: page.distRoot }).stale };
  }

  test('帧 import 的 data.json 改了没事件，接着改另一帧 → 全编，旧画面被纠正', async () => {
    const page = await compiled('json-dep', {
      'board.json': BOARD(['a', 'b']),
      'data.json': JSON.stringify({ text: 'data-v1' }),
      'a.jsx': FRAME('<p>{data.text}</p>', "import data from './data.json';\n"),
      'b.jsx': FRAME('<p>b-v1</p>'),
    });
    page.write('data.json', JSON.stringify({ text: 'data-v2' }));
    page.write('b.jsx', FRAME('<p>b-v2</p>'));
    const { plan, stale } = await beat(page, ['b.jsx']);
    assert.deepEqual(plan, { all: true, drift: 'data.json' });
    assert.match(page.dist('a'), /data-v2/);
    assert.match(page.dist('b'), /b-v2/);
    assert.equal(stale, false);
  });

  test('丢了 a.jsx 的事件，接着 b.jsx 正常一拍 → 全编，a 不停在旧版', async () => {
    const page = await compiled('lost-event', {
      'board.json': BOARD(['a', 'b']),
      'a.jsx': FRAME('<p>a-v1</p>'),
      'b.jsx': FRAME('<p>b-v1</p>'),
    });
    page.write('a.jsx', FRAME('<p>a-v2</p>'));
    page.write('b.jsx', FRAME('<p>b-v2</p>'));
    const { plan, stale } = await beat(page, ['b.jsx']);
    assert.deepEqual(plan, { all: true, drift: 'a.jsx' });
    assert.match(page.dist('a'), /a-v2/);
    assert.equal(stale, false);
  });

  test('共享组件带外改了，另一屏的 html 事件到达 → 全编，引用组件的屏更新', async () => {
    const page = await compiled('oob-component', {
      'board.json': BOARD(['a', 'e']),
      'a.jsx': FRAME('<Chip />', "import { Chip } from './components/Chip.jsx';\n"),
      'components/Chip.jsx': 'export function Chip() {\n  return <span>chip-v1</span>;\n}\n',
      'e.html': '<div class="ios-app">e1</div>\n',
    });
    page.write('components/Chip.jsx', 'export function Chip() {\n  return <span>chip-v2</span>;\n}\n');
    page.write('e.html', '<div class="ios-app">e2</div>\n');
    const { plan, stale } = await beat(page, ['e.html']);
    assert.deepEqual(plan, { all: true, drift: 'components/Chip.jsx' });
    assert.match(page.dist('a'), /chip-v2/);
    assert.match(page.dist('e'), /e2/);
    assert.equal(stale, false);
  });

  test('board.json 在上次编译之后改过却没进这批 → 全编', async () => {
    const page = await compiled('board-drift', {
      'board.json': BOARD(['a', 'b']),
      'a.jsx': FRAME('<p>a</p>'),
      'b.jsx': FRAME('<p>b</p>'),
    });
    await sleep(20); // board.json 没有 mtime 记录，与 builtAt 比；拉开间隔免得同拍
    page.write('board.json', BOARD(['a', 'b']));
    page.write('a.jsx', FRAME('<p>a2</p>'));
    assert.deepEqual((await beat(page, ['a.jsx'])).plan, { all: true, drift: 'board.json' });
  });

  test('排在下一批的文件（pendingFiles）不算漂移：各拍各编，没改的屏不动', async () => {
    const page = await compiled('pending', {
      'board.json': BOARD(['a', 'b', 'c']),
      'a.jsx': FRAME('<p>a1</p>'),
      'b.jsx': FRAME('<p>b1</p>'),
      'c.jsx': FRAME('<p>c1</p>'),
    });
    const cBefore = fs.statSync(path.join(page.distRoot, 'pending', 'c.html')).mtimeMs;
    page.write('a.jsx', FRAME('<p>a2</p>'));
    page.write('b.jsx', FRAME('<p>b2</p>'));
    const first = await beat(page, ['a.jsx'], { pendingFiles: [path.join(page.pageDir, 'b.jsx')] });
    assert.deepEqual(first.plan, { all: false, screens: ['a'] });
    const second = await beat(page, ['b.jsx']);
    assert.deepEqual(second.plan, { all: false, screens: ['b'] });
    assert.match(page.dist('b'), /b2/);
    assert.equal(second.stale, false);
    assert.equal(fs.statSync(path.join(page.distRoot, 'pending', 'c.html')).mtimeMs, cBefore, '没改的屏不重编');
  });
});

test('已消费 change：混批只编真改稿；同戳字节、共享依赖与板各按原范围更新', async () => {
  const pageDir = path.join(tmp, 'consumed');
  const distRoot = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(pageDir, 'components'), { recursive: true });
  const write = (file, text) => fs.writeFileSync(path.join(pageDir, file), text);
  const frame = (text) => `import { Chip } from './components/Chip.jsx';\nexport default function F(){return <div>${text}<Chip /></div>}\n`;
  const chip = (text) => `export function Chip(){return <span>${text}</span>}\n`;
  const board = JSON.stringify({ sections: [{ id: 's', title: 'one', screens: [{ id: 'alpha' }, { id: 'beta' }] }] });
  write('board.json', board);
  write('alpha.jsx', frame('a1')); write('beta.jsx', frame('b1')); write('components/Chip.jsx', chip('c1'));
  for (const file of ['board.json', 'alpha.jsx', 'beta.jsx', 'components/Chip.jsx']) fs.utimesSync(path.join(pageDir, file), 1700000000, 1700000000);
  const target = { entryId: 'consumed', pageDir, kind: 'dir', urlBase: '/sites/consumed/' };
  const compiled = await compilePage(target, { distRoot });
  assert.equal(compiled.ok, true);
  const files = ['board.json', 'beta.jsx', 'components/Chip.jsx', 'alpha.jsx'].map(file => path.join(pageDir, file));
  const options = { distRoot, eventKinds: new Map(files.map(file => [file, 'change'])) };
  const plan = () => planPageRecompile(target, files, options);
  const buildPath = path.join(distRoot, 'consumed', 'build.json');
  const before = fs.readFileSync(buildPath, 'utf8');
  assert.deepEqual(plan(), { all: false, screens: [], noop: true });
  assert.equal(fs.readFileSync(buildPath, 'utf8'), before);
  const sameStamp = (file, text) => {
    const abs = path.join(pageDir, file); const stat = fs.statSync(abs);
    write(file, text); fs.utimesSync(abs, stat.atimeMs / 1000, stat.mtimeMs / 1000);
    assert.equal(fs.statSync(abs).mtimeMs, stat.mtimeMs, '精确相同 mtime');
    assert.equal(fs.statSync(abs).size, stat.size, '精确相同 size');
  };
  sameStamp('alpha.jsx', frame('a2'));
  assert.deepEqual(plan(), { all: false, screens: ['alpha'] });
  const betaPath = path.join(distRoot, 'consumed', 'beta.html');
  const betaStat = fs.statSync(betaPath);
  await compilePage(target, { distRoot, onlyScreens: ['alpha'] });
  assert.equal(fs.statSync(betaPath).mtimeMs, betaStat.mtimeMs);
  assert.match(fs.readFileSync(path.join(distRoot, 'consumed', 'alpha.html'), 'utf8'), /a2/);
  sameStamp('components/Chip.jsx', chip('c2'));
  assert.deepEqual(plan(), { all: false, screens: ['alpha', 'beta'] });
  await compilePage(target, { distRoot, onlyScreens: ['alpha'] });
  assert.deepEqual(plan(), { all: false, screens: ['alpha', 'beta'] }, '未编兄弟不能继承共享依赖的新摘要');
  await compilePage(target, { distRoot });
  sameStamp('board.json', board.replace('one', 'two'));
  assert.deepEqual(plan(), { all: true });
  await compilePage(target, { distRoot, onlyScreens: ['alpha'] });
  assert.deepEqual(plan(), { all: true }, '部分编译不能给兄弟认证新版板');
  await compilePage(target, { distRoot });
  options.eventKinds.set(files[0], 'add');
  assert.deepEqual(plan(), { all: true }, 'add 不能过滤为重复 change');
  options.eventKinds.set(files[0], 'change');
  const build = JSON.parse(fs.readFileSync(buildPath));
  delete build.sources.beta.sha256;
  fs.writeFileSync(buildPath, JSON.stringify(build));
  assert.deepEqual(plan(), { all: true }, '混合不完整账目保守');
});

test('过滤前健康门：旧/坏账目、失败、缺输入或产物、新文件与身份/候选变化均不 noop', async () => {
  const pageDir = path.join(tmp, 'guards'); const distRoot = path.join(tmp, 'dist');
  fs.mkdirSync(pageDir, { recursive: true });
  const write = (file, bytes) => fs.writeFileSync(path.join(pageDir, file), bytes);
  write('board.json', JSON.stringify({ sections: [{ id: 's', screens: [{ id: 'a' }, { id: 'b' }] }] }));
  write('a.html', '<div>a</div>'); write('b.html', '<div>b</div>');
  const target = { entryId: 'guards', pageDir, kind: 'dir', urlBase: '/sites/guards/' };
  await compilePage(target, { distRoot });
  const a = path.join(pageDir, 'a.html');
  const eventKinds = new Map([[a, 'change']]);
  const plan = files => planPageRecompile(target, files || [a], { distRoot, eventKinds });
  assert.equal(plan().noop, true);
  const buildPath = path.join(distRoot, 'guards', 'build.json');
  const good = fs.readFileSync(buildPath, 'utf8');
  for (const mutate of [
    build => { delete build.sources.a.sha256; },
    build => { delete build.boardInput; },
    build => { build.tool = 'old'; },
    build => { build.errors.b = 'failed'; },
    build => { build.sources.b.deps = {}; },
    build => { build.sources.b.mtimeMs = null; },
  ]) {
    const build = JSON.parse(good); mutate(build); fs.writeFileSync(buildPath, JSON.stringify(build));
    assert.deepEqual(plan(), { all: true });
  }
  fs.writeFileSync(buildPath, '{broken'); assert.deepEqual(plan(), { all: true });
  fs.writeFileSync(buildPath, good);
  const bDist = path.join(distRoot, 'guards', 'b.html');
  fs.rmSync(bDist); assert.deepEqual(plan(), { all: true }); fs.writeFileSync(bDist, '<div>b</div>');
  fs.rmSync(path.join(pageDir, 'b.html')); assert.deepEqual(plan(), { all: true }); write('b.html', '<div>b</div>');
  await compilePage(target, { distRoot });
  const unknown = path.join(pageDir, 'new.jsx'); eventKinds.set(unknown, 'change');
  write('new.jsx', 'export default function F(){return <div/>}');
  assert.deepEqual(plan([unknown]), { all: true });
  fs.rmSync(unknown);
  // b.html 的相同 bytes 改由另一个真实路径提供，不能用 a 的重复事件绕过身份校验。
  write('b-copy.html', '<div>b</div>'); fs.rmSync(path.join(pageDir, 'b.html'));
  fs.symlinkSync(path.join(pageDir, 'b-copy.html'), path.join(pageDir, 'b.html'));
  assert.deepEqual(plan(), { all: true });
  fs.rmSync(path.join(pageDir, 'b.html')); write('b.html', '<div>b</div>');
  await compilePage(target, { distRoot });
  write('b.jsx', 'export default function F(){return <div>jsx</div>}');
  assert.deepEqual(plan(), { all: true }, '新 JSX 优先于已消费 HTML');
  fs.rmSync(path.join(pageDir, 'b.jsx'));
  // 全过滤后仍执行原 drift 门：未收到事件的 b 改动不能被重复 a 掩盖。
  write('b.html', '<div>b2</div>');
  fs.utimesSync(path.join(pageDir, 'b.html'), new Date(0), new Date(0));
  assert.deepEqual(plan(), { all: true, drift: 'b.html' });
});

test('R1 普通相对 import 候选切换：重复帧 change 不能吞掉 NEW_TS', async () => {
  // 精确复用 reviewer A candidate.mjs 的 OLD_JS → 新增优先 label.ts、只投 a.jsx change。
  const pageDir = path.join(tmp, 'candidate'); const distRoot = path.join(tmp, 'dist');
  fs.mkdirSync(pageDir);
  const write = (file, text) => fs.writeFileSync(path.join(pageDir, file), text);
  write('board.json', JSON.stringify({ sections: [{ id: 's', screens: [{ id: 'a' }] }] }));
  write('a.jsx', "import { text } from './label';\nexport default function F(){return <div>{text}</div>}\n");
  write('label.js', 'export const text = "OLD_JS";');
  const target = { kind: 'dir', entryId: 'review-a', pageDir, urlBase: '/sites/review-a/' };
  assert.equal((await compilePage(target, { distRoot })).ok, true);
  const frame = path.join(pageDir, 'a.jsx');
  const htmlFile = path.join(distRoot, target.entryId, 'a.html');
  assert.match(fs.readFileSync(htmlFile, 'utf8'), /OLD_JS/);
  write('label.ts', 'export const text: string = "NEW_TS";');
  const legacyPlan = planPageRecompile(target, [frame], { distRoot });
  assert.deepEqual(legacyPlan, { all: false, screens: ['a'] });
  const plan = planPageRecompile(target, [frame], { distRoot, eventKinds: new Map([[frame, 'change']]) });
  assert.notEqual(plan.noop, true, '默认解析身份未证明稳定，必须保留重编');
  assert.equal((await compilePage(target, { distRoot, ...(plan.all ? {} : { onlyScreens: plan.screens }) })).ok, true);
  assert.match(fs.readFileSync(htmlFile, 'utf8'), /NEW_TS/, '真实产物必须消费新的 label.ts');
  assert.doesNotMatch(fs.readFileSync(htmlFile, 'utf8'), /OLD_JS/);

  // 显式 Chip.jsx 内部仍可能有未知默认解析；必须核对整个实际 import 图。
  fs.rmSync(path.join(pageDir, 'label.ts'));
  fs.mkdirSync(path.join(pageDir, 'components'));
  write('a.jsx', "import { Chip } from './components/Chip.jsx';\nexport default function F(){return <Chip />}\n");
  write('components/Chip.jsx', "import { text } from '../label';\nexport function Chip(){return <span>{text}</span>}\n");
  assert.equal((await compilePage(target, { distRoot })).ok, true);
  assert.match(fs.readFileSync(htmlFile, 'utf8'), /OLD_JS/);
  write('label.ts', 'export const text: string = "NEW_TS";');
  const transitive = planPageRecompile(target, [frame], { distRoot, eventKinds: new Map([[frame, 'change']]) });
  assert.notEqual(transitive.noop, true, '传递依赖的未知解析也不能认证');
  assert.equal((await compilePage(target, { distRoot, ...(transitive.all ? {} : { onlyScreens: transitive.screens }) })).ok, true);
  assert.match(fs.readFileSync(htmlFile, 'utf8'), /NEW_TS/);

  // 明确扩展且实际读入精确文件时仍可认证；强制重编核对 esbuild 确实继续选择 JS。
  write('a.jsx', "import { text } from './label.js';\nexport default function F(){return <div>{text}</div>}\n");
  assert.equal((await compilePage(target, { distRoot })).ok, true);
  assert.equal(planPageRecompile(target, [frame], { distRoot, eventKinds: new Map([[frame, 'change']]) }).noop, true);
  const exact = await compilePage(target, { writeDist: false, includeFrames: true });
  assert.equal(exact.ok, true);
  assert.match(exact.frames.a.html, /OLD_JS/);
  assert.doesNotMatch(exact.frames.a.html, /NEW_TS/);
});
